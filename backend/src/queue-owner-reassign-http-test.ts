import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundDialerForTests, setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { MakeCallParams } from "./aliyun-ccc-make-call.js";
import type { AliyunAgentMapping, OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start queue owner reassign test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

const calls: MakeCallParams[] = [];
setOutboundDialerForTests({
  async makeCall(params) {
    calls.push({ ...params });
    return { jobId: "job-qor", callType: "OUTBOUND" };
  }
});

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
  const type = response.headers.get("content-type") || "";
  const json = type.includes("json") && text ? JSON.parse(text) as Record<string, any> : {};
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

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "targetType" | "targetId">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    maskedNumber: "13800138000",
    contactType: "OUTBOUND",
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: "2000",
    agentIds: "agent@ccc-qor",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://secret.example/rec",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "无意向",
    callOutcomeNote: "",
    callNote: "",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
    ...partial
  };
}

try {
  const store = getStore();
  setOutboundNowForTests(new Date("2026-11-04T04:00:00.000Z"));
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const alexUser = store.users.find((item) => item.email === "alex@keduoduo.com");
  const customerTemplate = store.customers.find((item) => item.id === "c1");
  const leadTemplate = store.leads.find((item) => item.id === "l1");
  const prospectTemplate = store.websiteOpportunities.find((item) => item.id === "web_seed_1");
  assert.ok(shirleyUser && miaUser && alexUser && customerTemplate && leadTemplate && prospectTemplate);
  store.users.push({
    ...shirleyUser,
    id: "u_qor_no_read",
    name: "No Read",
    email: "no-qor-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...alexUser,
    id: "u_qor_customer_only",
    name: "Customer Only",
    email: "qor-customer-only@keduoduo.com",
    role: "manager",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_qor_off",
    name: "Off",
    email: "qor-off@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "disabled"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    if (actor.id !== "u_qor_no_read" && actor.id !== "u_qor_customer_only") return snapshot;
    const permissions = { ...snapshot.permissions };
    if (actor.id === "u_qor_no_read") delete permissions["communication.read"];
    if (actor.id === "u_qor_customer_only") delete permissions["lead.assign"];
    return { ...snapshot, permissions };
  };
  const shirley = await login("shirley@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const noRead = await login("no-qor-read@keduoduo.com");
  const customerOnly = await login("qor-customer-only@keduoduo.com");
  const mapping = (partial: Partial<AliyunAgentMapping> & Pick<AliyunAgentMapping, "crmUserId" | "cccUserId">): AliyunAgentMapping => ({
    id: `map_${partial.cccUserId}`,
    teamId: "europe",
    loginName: "",
    displayName: partial.displayName || "",
    extension: "",
    workMode: "",
    updatedBy: "",
    updatedAt: "",
    ...partial
  });
  store.aliyunAgentMappings.push(mapping({
    crmUserId: shirleyUser.id,
    cccUserId: "agent@ccc-qor",
    displayName: "Shirley坐席"
  }));
  const customer = (id: string, extra: Partial<typeof customerTemplate> = {}) => {
    store.customers.push({
      ...customerTemplate,
      company: id,
      teamId: "europe",
      nextReminder: "2026-11-10 09:00",
      poolStatus: "owned",
      ownerId: shirleyUser.id,
      phone: "",
      ...extra,
      id
    });
  };
  customer("c_qor_neg", { company: "Nordic <Tools>" });
  customer("c_qor_pool", { poolStatus: "public", company: "公池" });
  customer("c_qor_plain", { nextReminder: "", company: "不在名单" });
  customer("c_qor_today", { nextReminder: "2026-11-04 09:00", phone: "+8613800138999", company: "今日" });
  store.leads.push({
    ...leadTemplate,
    id: "l_qor_neg",
    company: "批量线索",
    teamId: "europe",
    ownerId: shirleyUser.id,
    nextFollowAt: "2026-11-10 09:00",
    status: "new",
    deletedAt: ""
  });
  store.websiteOpportunities.push({
    ...prospectTemplate,
    id: "p_qor_ok",
    company: "可转交搜客",
    teamId: "europe",
    ownerId: shirleyUser.id,
    status: "contacted",
    leadId: "",
    nextFollowAt: "2026-11-10 09:00",
    outreachState: "suppressed"
  }, {
    ...prospectTemplate,
    id: "p_qor_synced",
    company: "已入线索",
    teamId: "europe",
    ownerId: shirleyUser.id,
    status: "synced",
    leadId: "l_qor_neg",
    nextFollowAt: "2026-11-10 09:00",
    outreachState: "uncontacted"
  });
  store.outboundCallRecords.push(
    record({ id: "ocr_qor_neg", targetType: "customer", targetId: "c_qor_neg", maskedNumber: "13800138000", startTimeRaw: "4100" }),
    record({ id: "ocr_qor_pool", targetType: "customer", targetId: "c_qor_pool", startTimeRaw: "4000" }),
    record({ id: "ocr_qor_lead", targetType: "lead", targetId: "l_qor_neg", startTimeRaw: "3900" }),
    record({ id: "ocr_qor_prospect", targetType: "prospect", targetId: "p_qor_ok", startTimeRaw: "3800" }),
    record({ id: "ocr_qor_synced", targetType: "prospect", targetId: "p_qor_synced", startTimeRaw: "3700" })
  );

  const path = "/api/queue-owner-reassign";
  const one = (targetType: string, targetId: string) => ({ targetType, targetId });
  const ownerOf = (id: string) => store.customers.find((item) => item.id === id)?.ownerId || "";
  const auditsAt = () => store.ownerReassignAudits.length;
  const leadsBefore = store.leads.length;
  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents || []);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions || []);
  const enabledBefore = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled;
  const reminderBefore = store.customers.find((item) => item.id === "c_qor_neg")?.nextReminder;
  const outcomeBefore = store.outboundCallRecords.find((item) => item.id === "ocr_qor_neg")?.callOutcome;

  const invalid = await request(path, alex, "POST", { targets: [], transferTo: miaUser.id });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.json.reason, "invalid_request");
  const tooMany = await request(path, alex, "POST", {
    targets: Array.from({ length: 101 }, (_, index) => one("customer", `c_qor_x${index}`)),
    transferTo: miaUser.id
  });
  assert.equal(tooMany.response.status, 400);
  assert.equal(tooMany.json.reason, "too_many");
  const duplicate = await request(path, alex, "POST", {
    targets: [one("customer", "c_qor_neg"), one("customer", "c_qor_neg")],
    transferTo: miaUser.id
  });
  assert.equal(duplicate.response.status, 400);
  const extra = await request(path, alex, "POST", {
    targets: [one("customer", "c_qor_neg")],
    transferTo: miaUser.id,
    ownerIds: [miaUser.id]
  });
  assert.equal(extra.response.status, 400);
  const blank = await request(path, alex, "POST", { targets: [one("customer", "c_qor_neg")], transferTo: "  " });
  assert.equal(blank.response.status, 400);
  const foreign = await request(path, alex, "POST", { targets: [one("customer", "c_qor_neg")], transferTo: "u_qor_off" });
  assert.equal(foreign.response.status, 400);
  assert.equal(foreign.json.reason, "invalid_assignee");
  assert.equal(ownerOf("c_qor_neg"), shirleyUser.id);
  assert.equal(store.ownerReassignAudits.some((item) => item.objectId === "c_qor_neg"), false);

  const beforeHidden = auditsAt();
  const hidden = await request(path, alex, "POST", {
    targets: [one("customer", "c_qor_neg"), one("customer", "c_qor_missing")],
    transferTo: miaUser.id
  });
  assert.equal(hidden.response.status, 404);
  assert.equal(hidden.json.reason, "not_found");
  assert.equal(ownerOf("c_qor_neg"), shirleyUser.id);
  assert.equal(auditsAt(), beforeHidden);

  const beforePending = auditsAt();
  const notPending = await request(path, alex, "POST", {
    targets: [one("customer", "c_qor_neg"), one("customer", "c_qor_plain")],
    transferTo: miaUser.id
  });
  assert.equal(notPending.response.status, 400, notPending.text);
  assert.equal(notPending.json.reason, "not_pending");
  assert.equal(ownerOf("c_qor_neg"), shirleyUser.id);
  assert.equal(ownerOf("c_qor_plain"), shirleyUser.id);
  assert.equal(auditsAt(), beforePending);

  const beforePool = auditsAt();
  const pooled = await request(path, alex, "POST", {
    targets: [one("customer", "c_qor_neg"), one("customer", "c_qor_pool")],
    transferTo: miaUser.id
  });
  assert.equal(pooled.response.status, 409, pooled.text);
  assert.equal(pooled.json.reason, "public_pool");
  assert.equal(ownerOf("c_qor_neg"), shirleyUser.id);
  assert.equal(store.customers.find((item) => item.id === "c_qor_pool")?.poolStatus, "public");
  const poolAudit = store.ownerReassignAudits.find((item) => item.objectId === "c_qor_pool");
  assert.equal(poolAudit?.action, "reject_public_pool");
  assert.equal(Boolean(poolAudit?.batchId), true);
  assert.equal(poolAudit?.callRecordId || "", "");
  assert.equal(store.ownerReassignAudits.some((item) => item.objectId === "c_qor_neg" && item.action === "reassign_owner"), false);
  assert.equal(auditsAt(), beforePool + 1);

  const beforeSynced = auditsAt();
  const synced = await request(path, alex, "POST", {
    targets: [one("customer", "c_qor_neg"), one("prospect", "p_qor_synced")],
    transferTo: miaUser.id
  });
  assert.equal(synced.response.status, 400, synced.text);
  assert.equal(synced.json.reason, "synced");
  assert.equal(ownerOf("c_qor_neg"), shirleyUser.id);
  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_qor_synced")?.ownerId, shirleyUser.id);
  assert.equal(auditsAt(), beforeSynced);

  const beforeDenied = auditsAt();
  const denied = await request(path, shirley, "POST", {
    targets: [one("customer", "c_qor_neg")],
    transferTo: miaUser.id
  });
  assert.equal(denied.response.status, 403, denied.text);
  assert.equal(denied.json.reason, "forbidden");
  assert.equal(ownerOf("c_qor_neg"), shirleyUser.id);
  const deniedAudit = store.ownerReassignAudits.find((item) => item.objectId === "c_qor_neg" && item.action === "reject_forbidden");
  assert.ok(deniedAudit);
  assert.equal(Boolean(deniedAudit.batchId), true);
  assert.equal(auditsAt(), beforeDenied + 1);

  const beforeRead = auditsAt();
  const unread = await request(path, noRead, "POST", {
    targets: [one("customer", "c_qor_neg")],
    transferTo: miaUser.id
  });
  assert.equal(unread.response.status, 403);
  assert.equal(auditsAt(), beforeRead);
  const anon = await request(path, "", "POST", {
    targets: [one("customer", "c_qor_neg")],
    transferTo: miaUser.id
  });
  assert.equal(anon.response.status, 401);

  const beforePartial = auditsAt();
  const partial = await request(path, customerOnly, "POST", {
    targets: [one("customer", "c_qor_neg"), one("lead", "l_qor_neg")],
    transferTo: miaUser.id
  });
  assert.equal(partial.response.status, 403, partial.text);
  assert.equal(partial.json.reason, "forbidden");
  assert.equal(ownerOf("c_qor_neg"), shirleyUser.id);
  assert.equal(store.leads.find((item) => item.id === "l_qor_neg")?.ownerId, shirleyUser.id);
  assert.equal(store.ownerReassignAudits.some((item) => item.objectId === "l_qor_neg" && item.action === "reject_forbidden"), true);
  assert.equal(store.ownerReassignAudits.filter((item) => item.objectId === "c_qor_neg" && item.action === "reassign_owner").length, 0);
  assert.equal(auditsAt(), beforePartial + 1);

  const single = await request("/api/outbound-call-records/ocr_qor_neg/outcome", alex, "POST", {
    outcome: "无意向",
    note: "",
    targets: [one("customer", "c_qor_neg")],
    transferTo: miaUser.id
  });
  assert.equal(single.response.status, 400);
  assert.equal(ownerOf("c_qor_neg"), shirleyUser.id);

  const saved = await request(path, alex, "POST", {
    targets: [one("customer", "c_qor_neg"), one("lead", "l_qor_neg"), one("prospect", "p_qor_ok")],
    transferTo: miaUser.id
  });
  assert.equal(saved.response.status, 200, saved.text);
  assert.equal(saved.json.result, "updated");
  assert.equal(saved.json.count, 3);
  assert.equal(ownerOf("c_qor_neg"), miaUser.id);
  assert.equal(store.leads.find((item) => item.id === "l_qor_neg")?.ownerId, miaUser.id);
  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_qor_ok")?.ownerId, miaUser.id);
  assert.equal(store.leads.find((item) => item.id === "l_qor_neg")?.status, "new");
  assert.equal(store.customers.find((item) => item.id === "c_qor_neg")?.nextReminder, reminderBefore);
  const successAudits = store.ownerReassignAudits.filter((item) => item.batchId === saved.json.batchId && item.action === "reassign_owner");
  assert.equal(successAudits.length, 3);
  assert.equal(new Set(successAudits.map((item) => item.batchId)).size, 1);
  assert.equal(successAudits.every((item) => (item.callRecordId || "") === "" && item.previousOwnerId === shirleyUser.id && item.nextOwnerId === miaUser.id), true);
  assert.equal(successAudits.find((item) => item.objectId === "c_qor_neg")?.objectType, "customer");
  assert.equal(successAudits.find((item) => item.objectId === "l_qor_neg")?.objectType, "lead");
  assert.equal(successAudits.find((item) => item.objectId === "p_qor_ok")?.objectType, "prospect_candidate");
  assert.equal(JSON.stringify(saved.json).includes("secret.example"), false);
  assert.equal(JSON.stringify(saved.json).includes("13800138000"), false);

  const again = await request(path, alex, "POST", {
    targets: [one("customer", "c_qor_neg")],
    transferTo: miaUser.id
  });
  assert.equal(again.response.status, 200, again.text);
  assert.equal(again.json.result, "unchanged");
  assert.equal(store.ownerReassignAudits.filter((item) => item.objectId === "c_qor_neg" && item.action === "reassign_owner").length, 1);

  const today = await request(path, alex, "POST", {
    targets: [one("customer", "c_qor_today")],
    transferTo: miaUser.id
  });
  assert.equal(today.response.status, 200, today.text);
  assert.equal(today.json.result, "updated");
  assert.equal(ownerOf("c_qor_today"), miaUser.id);
  assert.equal(store.customers.find((item) => item.id === "c_qor_today")?.nextReminder, "2026-11-04 09:00");

  assert.equal(store.leads.length, leadsBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents || []), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions || []), decisionsBefore);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_qor_neg")?.callOutcome, outcomeBefore);
  assert.equal(store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled, enabledBefore);
  assert.equal(aliyunHits, 0);
  assert.equal(calls.length, 0);
  console.log("queue owner reassign http tests passed");
} finally {
  setOutboundNowForTests(undefined);
  setOutboundDialerForTests(undefined);
  setTenantTimezoneOverride(getStore(), "europe", undefined);
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
