import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { formatCallScriptValue } from "./call-script.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call script test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

async function request(path: string, token: string, method = "GET", body?: unknown) {
  const response = await originalFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) as Record<string, any> : {};
  return { response, json, text };
}

async function login(email: string) {
  const response = await originalFetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "keduoduo123" })
  });
  const json = await response.json() as { token?: string };
  assert.equal(response.status, 200, `登录失败：${email}`);
  return String(json.token);
}

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const adminUser = store.users.find((item) => item.email === "admin@keduoduo.com");
  assert.ok(shirleyUser && adminUser);
  store.users.push({
    ...shirleyUser,
    id: "u_no_script_read",
    name: "No Script Read",
    email: "no-script-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...adminUser,
    id: "u_script_asia_admin",
    name: "Asia Script Admin",
    email: "asia-script-admin@keduoduo.com",
    role: "admin",
    teamId: "asia",
    status: "active"
  }, {
    ...adminUser,
    id: "u_script_super",
    name: "Europe Script Super",
    email: "europe-script-super@keduoduo.com",
    role: "super_admin",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_no_script_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };

  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const sequencesBefore = store.outreachSequences.length;
  const plansBefore = store.prospectOutreachPlans.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const recordsBefore = store.outboundCallRecords.map((item) => JSON.stringify(item));
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  const scriptsBefore = store.callScriptTemplates.length;

  const admin = await login("admin@keduoduo.com");
  const shirley = await login("shirley@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const noRead = await login("no-script-read@keduoduo.com");
  const asia = await login("asia-script-admin@keduoduo.com");
  const superAdmin = await login("europe-script-super@keduoduo.com");

  const auditsBeforeInvalid = store.callScriptAudits.length;
  for (const body of [
    [{ title: "开场", scenario: "first_call", body: "正文" }],
    { title: "开场", scenario: "first_call", body: "正文", templates: [] },
    { title: "开场", scenario: "first_call", body: "正文", ids: ["a"] },
    { title: "", scenario: "first_call", body: "正文" },
    { title: "标".repeat(81), scenario: "first_call", body: "正文" },
    { title: "开场", scenario: "later", body: "正文" },
    { title: "开场", scenario: "first_call", body: "   " },
    { title: "开场", scenario: "first_call", body: "文".repeat(2001) },
    { title: "开场", scenario: "first_call", body: "正文", language: "中文" }
  ]) {
    const rejected = await request("/api/call-script-templates", admin, "POST", body);
    assert.equal(rejected.response.status, 400);
  }
  assert.equal(store.callScriptAudits.length, auditsBeforeInvalid);
  assert.equal(store.callScriptTemplates.length, scriptsBefore);

  const created = await request("/api/call-script-templates", admin, "POST", {
    title: " 开场 ",
    scenario: "first_call",
    body: "您好，<script>alert(1)</script>",
    language: "zh-CN"
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.json.result, "created");
  assert.equal(created.json.template.title, "开场");
  assert.equal(created.json.template.body, "您好，<script>alert(1)</script>");
  assert.equal(created.json.template.language, "zh-CN");
  assert.equal(created.json.template.enabled, true);
  assert.match(String(created.response.headers.get("content-type")), /json/);
  const templateId = String(created.json.template.id);
  const createAudit = store.callScriptAudits.find((item) => item.templateId === templateId && item.action === "create");
  assert.ok(createAudit);
  assert.equal(createAudit.actorId, adminUser.id);
  assert.equal(createAudit.previousValue, "");
  assert.equal(createAudit.nextValue, formatCallScriptValue({
    title: "开场",
    scenario: "first_call",
    language: "zh-CN",
    body: "您好，<script>alert(1)</script>",
    enabled: true
  }));
  assert.equal(createAudit.result, "updated");
  assert.ok(createAudit.at);

  const longTitle = await request("/api/call-script-templates", admin, "POST", {
    title: "题".repeat(80),
    scenario: "objection",
    body: "正".repeat(2000)
  });
  assert.equal(longTitle.response.status, 200);
  const longId = String(longTitle.json.template.id);

  const follow = await request("/api/call-script-templates", superAdmin, "POST", {
    title: "回访开场",
    scenario: "follow_up",
    body: "上次聊到认证。"
  });
  assert.equal(follow.response.status, 200);
  assert.equal(follow.json.template.language, "");

  const auditsBeforeSame = store.callScriptAudits.length;
  const same = await request("/api/call-script-templates/update", admin, "POST", {
    id: templateId,
    title: "开场",
    scenario: "first_call",
    body: "您好，<script>alert(1)</script>",
    language: "zh-CN"
  });
  assert.equal(same.response.status, 200);
  assert.equal(same.json.result, "unchanged");
  assert.equal(store.callScriptAudits.length, auditsBeforeSame);

  const edited = await request("/api/call-script-templates/update", admin, "POST", {
    id: templateId,
    title: "开场改",
    scenario: "missed_callback",
    body: "刚才没接到，我再打来。",
    language: ""
  });
  assert.equal(edited.response.status, 200);
  assert.equal(edited.json.result, "updated");
  const updateAudit = store.callScriptAudits.find((item) => item.templateId === templateId && item.action === "update");
  assert.ok(updateAudit);
  assert.match(updateAudit.previousValue, /title=开场/);
  assert.match(updateAudit.nextValue, /scenario=missed_callback/);
  assert.match(updateAudit.nextValue, /刚才没接到/);
  assert.equal(updateAudit.actorId, adminUser.id);

  const disabled = await request("/api/call-script-templates/disable", admin, "POST", { id: longId });
  assert.equal(disabled.response.status, 200);
  assert.equal(disabled.json.result, "disabled");
  assert.equal(disabled.json.template.enabled, false);
  const row = store.callScriptTemplates.find((item) => item.id === longId);
  assert.ok(row);
  assert.equal(row.enabled, false);
  assert.equal(row.body, "正".repeat(2000));
  const disableAudit = store.callScriptAudits.find((item) => item.templateId === longId && item.action === "disable");
  assert.ok(disableAudit);
  assert.match(disableAudit.previousValue, /enabled=1/);
  assert.match(disableAudit.nextValue, /enabled=0/);

  const auditsBeforeRepeat = store.callScriptAudits.length;
  const disabledAgain = await request("/api/call-script-templates/disable", admin, "POST", { id: longId });
  assert.equal(disabledAgain.response.status, 200);
  assert.equal(disabledAgain.json.result, "unchanged");
  assert.equal(store.callScriptAudits.length, auditsBeforeRepeat);
  const editDisabled = await request("/api/call-script-templates/update", admin, "POST", {
    id: longId,
    title: "不能改",
    scenario: "objection",
    body: "新正文"
  });
  assert.equal(editDisabled.response.status, 400);
  assert.equal(editDisabled.json.reason, "disabled");
  assert.equal(store.callScriptAudits.length, auditsBeforeRepeat);
  assert.equal(store.callScriptTemplates.find((item) => item.id === longId)?.body, "正".repeat(2000));

  const salesCreate = await request("/api/call-script-templates", shirley, "POST", {
    title: "越权",
    scenario: "first_call",
    body: "不该写上"
  });
  assert.equal(salesCreate.response.status, 403);
  const salesAudit = store.callScriptAudits.find((item) => item.actorId === shirleyUser.id && item.action === "create" && item.result === "rejected");
  assert.ok(salesAudit);
  assert.equal(salesAudit.reason, "forbidden");
  assert.equal(store.callScriptTemplates.some((item) => item.title === "越权"), false);

  const managerDisable = await request("/api/call-script-templates/disable", alex, "POST", { id: templateId });
  assert.equal(managerDisable.response.status, 403);
  assert.equal(store.callScriptTemplates.find((item) => item.id === templateId)?.enabled, true);
  assert.equal(store.callScriptAudits.some((item) => item.actorId === "u_manager_alex" && item.action === "disable" && item.result === "rejected"), true);

  const noReadList = await request("/api/call-script-templates", noRead);
  assert.equal(noReadList.response.status, 403);
  assert.equal(store.callScriptAudits.some((item) => item.actorId === "u_no_script_read" && item.action === "read" && item.result === "rejected"), true);

  const salesList = await request("/api/call-script-templates?includeDisabled=1", shirley);
  assert.equal(salesList.response.status, 200);
  assert.equal(salesList.json.canManage, false);
  assert.equal(salesList.json.templates.some((item: { id: string }) => item.id === longId), false);
  assert.equal(salesList.json.templates.some((item: { id: string }) => item.id === templateId), true);
  assert.equal(JSON.stringify(salesList.json).includes("<form"), false);

  const filtered = await request("/api/call-script-templates?scenario=follow_up", shirley);
  assert.equal(filtered.response.status, 200);
  assert.deepEqual(filtered.json.templates.map((item: { title: string }) => item.title), ["回访开场"]);

  const badFilter = await request("/api/call-script-templates?scenario=nope", shirley);
  assert.equal(badFilter.response.status, 400);
  const badFlag = await request("/api/call-script-templates?includeDisabled=yes", admin);
  assert.equal(badFlag.response.status, 400);

  const adminAll = await request("/api/call-script-templates?includeDisabled=1", admin);
  assert.equal(adminAll.response.status, 200);
  assert.equal(adminAll.json.canManage, true);
  assert.equal(adminAll.json.templates.some((item: { id: string; enabled: boolean }) => item.id === longId && item.enabled === false), true);

  const marker = "EUROPE-SCRIPT-SECRET";
  const secret = await request("/api/call-script-templates/update", admin, "POST", {
    id: templateId,
    title: "开场改",
    scenario: "missed_callback",
    body: marker
  });
  assert.equal(secret.response.status, 200);
  const asiaUpdate = await request("/api/call-script-templates/update", asia, "POST", {
    id: templateId,
    title: "别的租户",
    scenario: "first_call",
    body: "不该改到"
  });
  assert.equal(asiaUpdate.response.status, 404);
  assert.equal(store.callScriptTemplates.find((item) => item.id === templateId)?.body, marker);
  const asiaAudits = store.callScriptAudits.filter((item) => item.teamId === "asia");
  assert.equal(asiaAudits.some((item) => item.reason === "not_found" && item.templateId === templateId), true);
  assert.equal(asiaAudits.some((item) => item.previousValue.includes(marker) || item.nextValue.includes(marker)), false);

  const asiaOwn = await request("/api/call-script-templates", asia, "POST", {
    title: "亚洲话术",
    scenario: "first_call",
    body: "只在亚洲。"
  });
  assert.equal(asiaOwn.response.status, 200);
  const europeList = await request("/api/call-script-templates?includeDisabled=1", admin);
  assert.equal(europeList.json.templates.some((item: { title: string }) => item.title === "亚洲话术"), false);

  assert.equal(aliyunHits, 0);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outreachSequences.length, sequencesBefore);
  assert.equal(store.prospectOutreachPlans.length, plansBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.deepEqual(store.outboundCallRecords.map((item) => JSON.stringify(item)), recordsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  const auditText = JSON.stringify(store.callScriptAudits);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("aliyuncs"), false);

  console.log("call script http tests passed");
} finally {
  const store = getStore();
  store.callScriptTemplates = store.callScriptTemplates.filter((item) => item.teamId !== "europe" && item.teamId !== "asia" || !item.id.startsWith("cst_"));
  store.callScriptAudits = store.callScriptAudits.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.users = store.users.filter((item) => !["u_no_script_read", "u_script_asia_admin", "u_script_super"].includes(item.id));
  globalThis.fetch = originalFetch;
  server.close();
}
