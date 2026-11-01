import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { importedCallScriptScenarioId } from "./call-script-scenario.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call script scenario test server");
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
    id: "u_no_scenario_read",
    name: "No Scenario Read",
    email: "no-scenario-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...adminUser,
    id: "u_scenario_asia_admin",
    name: "Asia Scenario Admin",
    email: "asia-scenario-admin@keduoduo.com",
    role: "admin",
    teamId: "asia",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_no_scenario_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };

  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const sequencesBefore = store.outreachSequences.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  const scenarioBefore = new Map(store.callScriptTemplates.map((item) => [item.id, item.scenario]));

  const admin = await login("admin@keduoduo.com");
  const shirley = await login("shirley@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const noRead = await login("no-scenario-read@keduoduo.com");
  const asia = await login("asia-scenario-admin@keduoduo.com");

  const auditsBeforeInvalid = store.callScriptScenarioAudits.length;
  const bad = await request("/api/call-script-scenarios", admin, "POST", { name: "续约", scenarios: [] });
  assert.equal(bad.response.status, 400);
  assert.equal(store.callScriptScenarioAudits.length, auditsBeforeInvalid);
  const badSort = await request("/api/call-script-scenarios/reorder", admin, "POST", { code: "first_call", sortOrder: "1" });
  assert.equal(badSort.response.status, 400);
  assert.equal(store.callScriptScenarioAudits.length, auditsBeforeInvalid);
  const badQuery = await request("/api/call-script-scenarios?includeDisabled=1", admin);
  assert.equal(badQuery.response.status, 400);
  assert.equal(store.callScriptScenarioAudits.length, auditsBeforeInvalid);

  const createdTemplate = await request("/api/call-script-templates", admin, "POST", {
    title: "场景带入",
    scenario: "first_call",
    body: "场景正文<script>alert(1)</script>",
    language: "zh"
  });
  assert.equal(createdTemplate.response.status, 200);
  const templateId = String(createdTemplate.json.template.id);
  const templateScenario = store.callScriptTemplates.find((item) => item.id === templateId)?.scenario;
  assert.equal(templateScenario, "first_call");

  const listed = await request("/api/call-script-scenarios", admin);
  assert.equal(listed.response.status, 200);
  assert.equal(listed.json.canManage, true);
  const europeFirst = listed.json.scenarios.find((item: { code: string }) => item.code === "first_call");
  assert.equal(europeFirst.name, "首呼");
  assert.equal(europeFirst.enabled, true);
  assert.equal(store.callScriptScenarios.filter((item) => item.teamId === "europe" && item.code === "first_call").length, 1);
  assert.equal(store.callScriptScenarios.find((item) => item.teamId === "europe" && item.code === "first_call")?.id, importedCallScriptScenarioId("europe", "first_call"));
  const again = await request("/api/call-script-scenarios", admin);
  assert.equal(store.callScriptScenarios.filter((item) => item.teamId === "europe" && item.code === "first_call").length, 1);
  assert.equal(again.json.scenarios.map((item: { code: string }) => item.code).filter((code: string) => code === "first_call").length, 1);
  assert.equal(store.callScriptScenarioAudits.some((item) => item.action === "read" && item.result === "updated"), false);

  const sameRename = await request("/api/call-script-scenarios/rename", admin, "POST", { code: "first_call", name: "首呼" });
  assert.equal(sameRename.json.result, "unchanged");
  const renamed = await request("/api/call-script-scenarios/rename", admin, "POST", { code: "first_call", name: "初次联系" });
  assert.equal(renamed.json.result, "renamed");
  assert.equal(renamed.json.scenario.name, "初次联系");
  assert.equal(store.callScriptTemplates.find((item) => item.id === templateId)?.scenario, "first_call");
  const renameAudit = store.callScriptScenarioAudits.find((item) => item.action === "rename" && item.result === "updated");
  assert.ok(renameAudit);
  assert.match(renameAudit.previousValue, /name=首呼/);
  assert.match(renameAudit.nextValue, /name=初次联系/);
  assert.equal(renameAudit.previousValue.includes("场景正文"), false);

  const sameOrder = await request("/api/call-script-scenarios/reorder", admin, "POST", { code: "objection", sortOrder: 40 });
  assert.equal(sameOrder.json.result, "unchanged");
  const reordered = await request("/api/call-script-scenarios/reorder", admin, "POST", { code: "objection", sortOrder: 0 });
  assert.equal(reordered.json.result, "reordered");
  const ordered = await request("/api/call-script-scenarios", admin);
  assert.equal(ordered.json.scenarios[0].code, "objection");
  assert.equal(ordered.json.scenarios[0].name, "异议处理");

  const followTemplate = await request("/api/call-script-templates", admin, "POST", {
    title: "回访话术",
    scenario: "follow_up",
    body: "回访正文"
  });
  assert.equal(followTemplate.response.status, 200);
  const followId = String(followTemplate.json.template.id);
  const disabled = await request("/api/call-script-scenarios/disable", admin, "POST", { code: "follow_up" });
  assert.equal(disabled.json.result, "disabled");
  assert.equal(disabled.json.scenario.enabled, false);
  assert.equal(store.callScriptScenarios.find((item) => item.teamId === "europe" && item.code === "follow_up")?.enabled, false);
  assert.equal(store.callScriptTemplates.find((item) => item.id === followId)?.enabled, true);
  assert.equal(store.callScriptTemplates.find((item) => item.id === followId)?.scenario, "follow_up");
  const auditsAfterDisable = store.callScriptScenarioAudits.length;
  const disableAgain = await request("/api/call-script-scenarios/disable", admin, "POST", { code: "follow_up" });
  assert.equal(disableAgain.json.result, "unchanged");
  assert.equal(store.callScriptScenarioAudits.length, auditsAfterDisable);

  const templateAuditsBefore = store.callScriptAudits.length;
  const blockedCreate = await request("/api/call-script-templates", admin, "POST", {
    title: "不能选停用场景",
    scenario: "follow_up",
    body: "不再写入"
  });
  assert.equal(blockedCreate.response.status, 400);
  assert.equal(blockedCreate.json.reason, "scenario_disabled");
  assert.equal(store.callScriptAudits.length, templateAuditsBefore);
  const blockedUpdate = await request("/api/call-script-templates/update", admin, "POST", {
    id: followId,
    title: "改标题",
    scenario: "follow_up",
    body: "回访正文"
  });
  assert.equal(blockedUpdate.response.status, 400);
  assert.equal(blockedUpdate.json.reason, "scenario_disabled");
  assert.equal(store.callScriptTemplates.find((item) => item.id === followId)?.title, "回访话术");
  assert.equal(store.callScriptAudits.length, templateAuditsBefore);

  const stillVisible = await request("/api/call-script-templates?scenario=follow_up", shirley);
  assert.equal(stillVisible.response.status, 200);
  assert.equal(stillVisible.json.templates.some((item: { id: string }) => item.id === followId), true);
  assert.equal(stillVisible.json.scenarios.find((item: { code: string }) => item.code === "follow_up")?.name, "回访");
  assert.equal(stillVisible.json.scenarios.find((item: { code: string }) => item.code === "first_call")?.label, "初次联系");
  const writeCodes = stillVisible.json.scenarios.filter((item: { enabled: boolean }) => item.enabled !== false).map((item: { code: string }) => item.code);
  assert.equal(writeCodes.includes("follow_up"), false);

  const moved = await request("/api/call-script-templates/update", admin, "POST", {
    id: followId,
    title: "回访话术",
    scenario: "first_call",
    body: "回访正文"
  });
  assert.equal(moved.response.status, 200);
  assert.equal(store.callScriptTemplates.find((item) => item.id === followId)?.scenario, "first_call");
  await request("/api/call-script-templates/update", admin, "POST", {
    id: followId,
    title: "回访话术",
    scenario: "follow_up",
    body: "回访正文"
  });
  assert.equal(store.callScriptTemplates.find((item) => item.id === followId)?.scenario, "first_call");

  const created = await request("/api/call-script-scenarios", admin, "POST", { name: "续约" });
  assert.equal(created.json.result, "created");
  const renewal = String(created.json.scenario.code);
  assert.match(renewal, /^scn[a-z0-9]+$/);
  const duplicate = await request("/api/call-script-scenarios", admin, "POST", { name: "续约" });
  assert.equal(duplicate.response.status, 400);
  assert.equal(duplicate.json.reason, "duplicate_name");
  const renewalTemplate = await request("/api/call-script-templates", admin, "POST", {
    title: "续约话术",
    scenario: renewal,
    body: "续约正文"
  });
  assert.equal(renewalTemplate.response.status, 200);
  assert.equal(renewalTemplate.json.template.scenarioLabel, "续约");

  const agentList = await request("/api/call-script-scenarios", shirley);
  assert.equal(agentList.response.status, 200);
  assert.equal(agentList.json.canManage, false);
  assert.equal(agentList.json.scenarios[0].code, "objection");
  const rowsBeforeAgent = store.callScriptScenarios.filter((item) => item.teamId === "europe").map((item) => JSON.stringify(item));
  const agentCreate = await request("/api/call-script-scenarios", shirley, "POST", { name: "坐席新增" });
  assert.equal(agentCreate.response.status, 403);
  assert.equal(agentCreate.json.reason, "forbidden");
  const agentRename = await request("/api/call-script-scenarios/rename", alex, "POST", { code: "first_call", name: "主管改名" });
  assert.equal(agentRename.response.status, 403);
  const agentReorder = await request("/api/call-script-scenarios/reorder", shirley, "POST", { code: renewal, sortOrder: 1 });
  assert.equal(agentReorder.response.status, 403);
  const agentDisable = await request("/api/call-script-scenarios/disable", alex, "POST", { code: renewal });
  assert.equal(agentDisable.response.status, 403);
  assert.deepEqual(store.callScriptScenarios.filter((item) => item.teamId === "europe").map((item) => JSON.stringify(item)), rowsBeforeAgent);
  assert.equal(store.callScriptScenarios.find((item) => item.teamId === "europe" && item.code === "first_call")?.name, "初次联系");
  assert.equal(store.callScriptScenarioAudits.some((item) => item.actorId === shirleyUser.id && item.action === "create" && item.result === "rejected"), true);
  assert.equal(store.callScriptScenarioAudits.some((item) => item.action === "rename" && item.result === "rejected" && item.reason === "forbidden"), true);

  const denied = await request("/api/call-script-scenarios", noRead);
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.reason, "forbidden");
  assert.equal(denied.text.includes("续约"), false);
  assert.equal(store.callScriptScenarioAudits.some((item) => item.actorId === "u_no_scenario_read" && item.action === "read" && item.result === "rejected"), true);

  const asiaCreated = await request("/api/call-script-scenarios", asia, "POST", { name: "亚洲场景" });
  assert.equal(asiaCreated.json.result, "created");
  const asiaCode = String(asiaCreated.json.scenario.code);
  const cross = await request("/api/call-script-scenarios/rename", admin, "POST", { code: asiaCode, name: "偷看" });
  assert.equal(cross.response.status, 404);
  assert.equal(cross.json.reason, "not_found");
  assert.equal(store.callScriptScenarios.find((item) => item.teamId === "asia" && item.code === asiaCode)?.name, "亚洲场景");
  assert.equal(JSON.stringify(store.callScriptScenarioAudits.filter((item) => item.teamId === "europe")).includes("亚洲场景"), false);
  const asiaStill = await request("/api/call-script-scenarios", asia);
  assert.equal(asiaStill.json.scenarios.some((item: { code: string; name: string }) => item.code === asiaCode && item.name === "亚洲场景"), true);
  assert.equal(asiaStill.json.scenarios.some((item: { name: string }) => item.name === "初次联系"), false);

  const report = await request("/api/call-script-report", admin);
  assert.equal(report.response.status, 200);
  assert.equal(report.json.scenarios[0].code, "objection");
  assert.equal(report.json.scenarios.find((item: { code: string }) => item.code === "first_call").label, "初次联系");
  assert.equal(report.json.scenarios.some((item: { code: string }) => item.code === "follow_up"), true);
  const filtered = await request(`/api/call-script-report?scenario=${encodeURIComponent(renewal)}`, admin);
  assert.equal(filtered.response.status, 200);
  assert.equal(filtered.json.rows.length > 0, true);
  assert.equal(filtered.json.rows.every((item: { scenario: string }) => item.scenario === renewal), true);
  const nope = await request("/api/call-script-report?scenario=nope", admin);
  assert.equal(nope.response.status, 400);
  for (const [id, scenario] of scenarioBefore) {
    assert.equal(store.callScriptTemplates.find((item) => item.id === id)?.scenario, scenario);
  }

  assert.equal(aliyunHits, 0);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outreachSequences.length, sequencesBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  const auditText = JSON.stringify(store.callScriptScenarioAudits);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("aliyuncs"), false);
  assert.equal(auditText.includes("场景正文"), false);
  assert.equal(auditText.includes("<script>"), false);

  console.log("call script scenario http tests passed");
} finally {
  const store = getStore();
  store.callScriptScenarios = store.callScriptScenarios.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.callScriptScenarioAudits = store.callScriptScenarioAudits.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.callScriptTemplates = store.callScriptTemplates.filter((item) => item.title !== "场景带入" && item.title !== "回访话术" && item.title !== "续约话术" && item.title !== "不能选停用场景");
  store.callScriptAudits = store.callScriptAudits.filter((item) => !item.nextValue.includes("场景带入") && !item.nextValue.includes("回访话术") && !item.nextValue.includes("续约话术"));
  store.callScriptReportAudits = store.callScriptReportAudits.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.users = store.users.filter((item) => !["u_no_scenario_read", "u_scenario_asia_admin"].includes(item.id));
  globalThis.fetch = originalFetch;
  server.close();
}
