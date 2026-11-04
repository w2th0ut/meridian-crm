import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { AliyunAgentMapping, OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call outcome next follow test server");
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
    maskedNumber: "****8000",
    contactType: "OUTBOUND",
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "12",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: "2000",
    agentIds: "agent@ccc-cof-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://secret.example/do-not-leak",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "",
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

const storeForCleanup = getStore();
let windowBefore: string | undefined;
let createdWindowConfig = false;
let originalSnapshot: typeof storeForCleanup.getIamCapabilitySnapshot;

try {
  const store = storeForCleanup;
  setOutboundNowForTests(new Date("2026-11-06T02:30:00.000Z"));
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  const shirley = await login("shirley@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const alexUser = store.users.find((item) => item.email === "alex@keduoduo.com");
  assert.ok(shirleyUser && alexUser);
  store.users.push({
    ...shirleyUser,
    id: "u_cof_no_read",
    name: "No Read",
    email: "no-cof-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_cof_no_update",
    name: "No Update",
    email: "no-cof-update@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    if (actor.id !== "u_cof_no_read" && actor.id !== "u_cof_no_update") return snapshot;
    const permissions = { ...snapshot.permissions };
    if (actor.id === "u_cof_no_read") delete permissions["communication.read"];
    if (actor.id === "u_cof_no_update") delete permissions["customer.update"];
    return { ...snapshot, permissions };
  };
  const noRead = await login("no-cof-read@keduoduo.com");
  const noUpdate = await login("no-cof-update@keduoduo.com");
  const mapping = (partial: Partial<AliyunAgentMapping> & Pick<AliyunAgentMapping, "crmUserId" | "cccUserId">): AliyunAgentMapping => ({
    id: `map_cof_${partial.cccUserId}`,
    teamId: "europe",
    loginName: "",
    displayName: partial.displayName || "",
    extension: "",
    workMode: "",
    updatedBy: "",
    updatedAt: "",
    ...partial
  });
  store.aliyunAgentMappings.push(
    mapping({ crmUserId: shirleyUser.id, cccUserId: "agent@ccc-cof-a", displayName: "Shirley坐席" }),
    mapping({ crmUserId: "u_cof_no_update", cccUserId: "agent@ccc-cof-noupdate", displayName: "No Update坐席" })
  );
  const customerTemplate = store.customers.find((item) => item.id === "c1");
  const leadTemplate = store.leads.find((item) => item.id === "l1");
  const prospectTemplate = store.websiteOpportunities.find((item) => item.id === "web_seed_1");
  assert.ok(customerTemplate && leadTemplate && prospectTemplate);
  const activitiesBefore = store.customerActivities.length;
  const leadActivitiesBefore = store.leadActivities.length;
  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  let europeConfig = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe");
  windowBefore = europeConfig?.callWindowStart;
  if (!europeConfig) {
    createdWindowConfig = true;
    europeConfig = {
      teamId: "europe",
      aliyunOutboundEnabled: false,
      instanceId: "",
      region: "",
      callerNumber: "",
      callWindowStart: "09:00",
      callWindowEnd: "20:00",
      accessKeyIdEncrypted: "",
      accessKeySecretEncrypted: "",
      callbackPathTokenEncrypted: "",
      updatedBy: "",
      updatedAt: ""
    };
    store.aliyunOutboundConfigs.push(europeConfig);
  }
  store.customers.push({
    ...customerTemplate,
    id: "c_cof_open",
    company: "Nordic <Tools>",
    teamId: "europe",
    ownerId: shirleyUser.id,
    nextReminder: "保持",
    poolStatus: "owned"
  }, {
    ...customerTemplate,
    id: "c_cof_pool",
    company: "公池",
    teamId: "europe",
    ownerId: shirleyUser.id,
    nextReminder: "公池原值",
    poolStatus: "public"
  }, {
    ...customerTemplate,
    id: "c_cof_other",
    company: "别人的客户",
    teamId: "europe",
    ownerId: alexUser.id,
    nextReminder: "别人的时间",
    poolStatus: "owned"
  }, {
    ...customerTemplate,
    id: "c_cof_noupdate",
    company: "无权客户",
    teamId: "europe",
    ownerId: "u_cof_no_update",
    nextReminder: "无权原值",
    poolStatus: "owned"
  }, {
    ...customerTemplate,
    id: "c_cof_hold",
    company: "抑制客户",
    teamId: "europe",
    ownerId: shirleyUser.id,
    nextReminder: "",
    poolStatus: "owned"
  });
  store.leads.push({
    ...leadTemplate,
    id: "l_cof_ok",
    company: "跟进线索",
    teamId: "europe",
    ownerId: shirleyUser.id,
    nextFollowAt: "",
    status: leadTemplate.status,
    deletedAt: ""
  }, {
    ...leadTemplate,
    id: "l_cof_deleted",
    company: "已删除",
    teamId: "europe",
    ownerId: shirleyUser.id,
    nextFollowAt: "不要改",
    deletedAt: "2026-11-01T00:00:00.000Z"
  }, {
    ...leadTemplate,
    id: "l_cof_sync",
    company: "同步线索",
    teamId: "europe",
    ownerId: shirleyUser.id,
    nextFollowAt: "",
    status: "new",
    deletedAt: ""
  });
  store.websiteOpportunities.push({
    ...prospectTemplate,
    id: "p_cof_ok",
    company: "可联系候选",
    teamId: "europe",
    ownerId: shirleyUser.id,
    status: "contacted",
    leadId: "l_cof_sync",
    nextFollowAt: "",
    outreachState: "uncontacted"
  }, {
    ...prospectTemplate,
    id: "p_cof_excluded",
    company: "已排除",
    teamId: "europe",
    ownerId: shirleyUser.id,
    status: "excluded",
    leadId: "",
    nextFollowAt: "排除原值",
    outreachState: "uncontacted"
  }, {
    ...prospectTemplate,
    id: "p_cof_hold",
    company: "抑制候选",
    teamId: "europe",
    ownerId: shirleyUser.id,
    customerId: "c_cof_hold",
    status: "contacted",
    leadId: "",
    nextFollowAt: "",
    outreachState: "suppressed"
  });
  store.outboundCallRecords.push(
    record({ id: "ocr_cof_customer", targetType: "customer", targetId: "c_cof_open" }),
    record({ id: "ocr_cof_plain", targetType: "customer", targetId: "c_cof_open" }),
    record({ id: "ocr_cof_negative", targetType: "customer", targetId: "c_cof_open" }),
    record({ id: "ocr_cof_pool", targetType: "customer", targetId: "c_cof_pool" }),
    record({ id: "ocr_cof_other", targetType: "customer", targetId: "c_cof_other" }),
    record({ id: "ocr_cof_noupdate", targetType: "customer", targetId: "c_cof_noupdate", agentIds: "agent@ccc-cof-noupdate" }),
    record({ id: "ocr_cof_hold", targetType: "customer", targetId: "c_cof_hold" }),
    record({ id: "ocr_cof_lead", targetType: "lead", targetId: "l_cof_ok" }),
    record({ id: "ocr_cof_deleted", targetType: "lead", targetId: "l_cof_deleted" }),
    record({ id: "ocr_cof_prospect", targetType: "prospect", targetId: "p_cof_ok" }),
    record({ id: "ocr_cof_excluded", targetType: "prospect", targetId: "p_cof_excluded" }),
    record({ id: "ocr_cof_none", targetType: "", targetId: "" })
  );

  const customer = () => store.customers.find((item) => item.id === "c_cof_open");
  const followAudits = () => store.nextFollowUpAudits.filter((item) => (item.callRecordId || "").startsWith("ocr_cof_"));

  const omitted = await request("/api/outbound-call-records/ocr_cof_plain/outcome", shirley, "POST", { outcome: "有意向", note: "样品" });
  assert.equal(omitted.response.status, 200, omitted.text);
  assert.equal(omitted.json.result, "updated");
  assert.equal(omitted.json.nextFollowChoice, "none");
  assert.equal(omitted.json.nextFollowResult, "skipped");
  assert.equal(customer()?.nextReminder, "保持");
  assert.equal(followAudits().length, 0);

  const kept = await request("/api/outbound-call-records/ocr_cof_negative/outcome", shirley, "POST", {
    outcome: "无意向",
    nextFollowChoice: "none"
  });
  assert.equal(kept.response.status, 200, kept.text);
  assert.equal(customer()?.nextReminder, "保持");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cof_negative")?.callOutcome, "无意向");
  assert.equal(followAudits().length, 0);

  const friday = await request("/api/outbound-call-records/ocr_cof_customer/outcome", shirley, "POST", {
    outcome: "有意向",
    note: "  想要样品  ",
    nextFollowChoice: "tomorrow"
  });
  assert.equal(friday.response.status, 200, friday.text);
  assert.equal(friday.json.result, "updated");
  assert.equal(friday.json.message, "已保存通话结果，并记下下次跟进");
  assert.equal(friday.json.nextFollowAt, "2026-11-07 09:00");
  assert.equal(friday.json.nextFollowAt.includes("2026-11-09"), false);
  assert.equal(customer()?.nextReminder, "2026-11-07 09:00");
  assert.equal(JSON.stringify(friday.json).includes("do-not-leak"), false);
  const outcomeAudit = store.callOutcomeAudits.find((item) => item.callRecordId === "ocr_cof_customer");
  assert.equal(outcomeAudit?.previousOutcome, "");
  assert.equal(outcomeAudit?.nextOutcome, "有意向");
  assert.equal(outcomeAudit?.nextNote, "想要样品");
  const followAudit = followAudits().find((item) => item.callRecordId === "ocr_cof_customer");
  assert.equal(followAudit?.action, "set_next_follow_up");
  assert.equal(followAudit?.objectType, "customer");
  assert.equal(followAudit?.oldValue, "保持");
  assert.equal(followAudit?.newValue, "2026-11-07 09:00");
  assert.equal(followAudit?.batchId || "", "");
  assert.equal(followAudit?.actorId, shirleyUser.id);

  const again = await request("/api/outbound-call-records/ocr_cof_customer/outcome", shirley, "POST", {
    outcome: "有意向",
    note: "想要样品",
    nextFollowChoice: "tomorrow"
  });
  assert.equal(again.response.status, 200, again.text);
  assert.equal(again.json.result, "unchanged");
  assert.equal(followAudits().filter((item) => item.callRecordId === "ocr_cof_customer").length, 1);
  assert.equal(store.callOutcomeAudits.filter((item) => item.callRecordId === "ocr_cof_customer").length, 1);

  const explicitNegative = await request("/api/outbound-call-records/ocr_cof_negative/outcome", shirley, "POST", {
    outcome: "无意向",
    nextFollowChoice: "plus3"
  });
  assert.equal(explicitNegative.response.status, 200, explicitNegative.text);
  assert.equal(explicitNegative.json.nextFollowAt, "2026-11-09 09:00");
  assert.equal(customer()?.nextReminder, "2026-11-09 09:00");
  assert.equal(store.callOutcomeAudits.filter((item) => item.callRecordId === "ocr_cof_negative").length, 1);

  if (europeConfig) europeConfig.callWindowStart = "10:30";
  const windowed = await request("/api/outbound-call-records/ocr_cof_lead/outcome", shirley, "POST", {
    outcome: "需回访",
    nextFollowChoice: "plus7"
  });
  assert.equal(windowed.response.status, 200, windowed.text);
  assert.equal(windowed.json.nextFollowAt, "2026-11-13 10:30");
  const lead = store.leads.find((item) => item.id === "l_cof_ok");
  assert.equal(lead?.nextFollowAt, "2026-11-13 10:30");
  assert.equal(lead?.status, leadTemplate.status);
  if (europeConfig) europeConfig.callWindowStart = windowBefore;

  setTenantTimezoneOverride(store, "europe", "America/New_York");
  const ny = await request("/api/outbound-call-records/ocr_cof_hold/outcome", shirley, "POST", {
    outcome: "其他",
    nextFollowChoice: "明天"
  });
  assert.equal(ny.response.status, 200, ny.text);
  assert.equal(ny.json.nextFollowAt, "2026-11-06 09:00");
  assert.match(ny.json.suppressionNotice || "", /不改变抑制状态/);
  assert.equal(store.customers.find((item) => item.id === "c_cof_hold")?.nextReminder, "2026-11-06 09:00");
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");

  const leadStatusBefore = store.leads.find((item) => item.id === "l_cof_sync")?.status;
  const prospect = await request("/api/outbound-call-records/ocr_cof_prospect/outcome", shirley, "POST", {
    outcome: "有意向",
    nextFollowChoice: "plus3"
  });
  assert.equal(prospect.response.status, 200, prospect.text);
  assert.equal(prospect.json.nextFollowAt, "2026-11-09 09:00");
  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_cof_ok")?.nextFollowAt, "2026-11-09 09:00");
  assert.equal(store.leads.find((item) => item.id === "l_cof_sync")?.nextFollowAt, "2026-11-09 09:00");
  assert.equal(store.leads.find((item) => item.id === "l_cof_sync")?.status, leadStatusBefore);
  assert.equal(store.leadActivities.length, leadActivitiesBefore);

  const noReadResult = await request("/api/outbound-call-records/ocr_cof_customer/outcome", noRead, "POST", {
    outcome: "其他",
    nextFollowChoice: "tomorrow"
  });
  assert.equal(noReadResult.response.status, 403);
  assert.equal(followAudits().some((item) => item.actorId === "u_cof_no_read"), false);

  const anonymous = await request("/api/outbound-call-records/ocr_cof_customer/outcome", "", "POST", {
    outcome: "其他",
    nextFollowChoice: "tomorrow"
  });
  assert.equal(anonymous.response.status, 401);

  const forbidden = await request("/api/outbound-call-records/ocr_cof_noupdate/outcome", noUpdate, "POST", {
    outcome: "有意向",
    nextFollowChoice: "tomorrow"
  });
  assert.equal(forbidden.response.status, 403, forbidden.text);
  assert.equal(forbidden.json.reason, "forbidden");
  assert.equal(store.customers.find((item) => item.id === "c_cof_noupdate")?.nextReminder, "无权原值");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cof_noupdate")?.callOutcome, "");
  assert.equal(followAudits().find((item) => item.callRecordId === "ocr_cof_noupdate")?.action, "reject_forbidden");

  const pool = await request("/api/outbound-call-records/ocr_cof_pool/outcome", shirley, "POST", {
    outcome: "有意向",
    nextFollowChoice: "tomorrow"
  });
  assert.equal(pool.response.status, 409, pool.text);
  assert.equal(pool.json.reason, "public_pool");
  assert.equal(store.customers.find((item) => item.id === "c_cof_pool")?.nextReminder, "公池原值");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cof_pool")?.callOutcome, "");
  assert.equal(followAudits().find((item) => item.callRecordId === "ocr_cof_pool")?.action, "reject_public_pool");

  const hidden = await request("/api/outbound-call-records/ocr_cof_other/outcome", shirley, "POST", {
    outcome: "有意向",
    nextFollowChoice: "tomorrow"
  });
  assert.equal(hidden.response.status, 404, hidden.text);
  assert.equal(store.customers.find((item) => item.id === "c_cof_other")?.nextReminder, "别人的时间");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cof_other")?.callOutcome, "");

  const deleted = await request("/api/outbound-call-records/ocr_cof_deleted/outcome", shirley, "POST", {
    outcome: "有意向",
    nextFollowChoice: "tomorrow"
  });
  assert.equal(deleted.response.status, 404, deleted.text);
  assert.equal(store.leads.find((item) => item.id === "l_cof_deleted")?.nextFollowAt, "不要改");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cof_deleted")?.callOutcome, "");
  assert.equal(followAudits().find((item) => item.callRecordId === "ocr_cof_deleted")?.action, "reject_not_found");

  const excluded = await request("/api/outbound-call-records/ocr_cof_excluded/outcome", shirley, "POST", {
    outcome: "有意向",
    nextFollowChoice: "tomorrow"
  });
  assert.equal(excluded.response.status, 409, excluded.text);
  assert.equal(excluded.json.reason, "not_contactable");
  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_cof_excluded")?.nextFollowAt, "排除原值");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cof_excluded")?.callOutcome, "");
  assert.equal(followAudits().find((item) => item.callRecordId === "ocr_cof_excluded")?.action, "reject_not_contactable");
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);

  const noTarget = await request("/api/outbound-call-records/ocr_cof_none/outcome", shirley, "POST", {
    outcome: "其他",
    nextFollowChoice: "tomorrow"
  });
  assert.equal(noTarget.response.status, 400, noTarget.text);
  assert.equal(noTarget.json.reason, "no_target");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cof_none")?.callOutcome, "");
  assert.equal(followAudits().some((item) => item.callRecordId === "ocr_cof_none"), false);

  const badChoice = await request("/api/outbound-call-records/ocr_cof_customer/outcome", shirley, "POST", {
    outcome: "有意向",
    nextFollowChoice: "下周一"
  });
  assert.equal(badChoice.response.status, 400);
  assert.equal(badChoice.json.reason, "invalid_next_follow");
  const rawTime = await request("/api/outbound-call-records/ocr_cof_customer/outcome", shirley, "POST", {
    outcome: "有意向",
    nextFollowAt: "2026-12-01 09:00"
  });
  assert.equal(rawTime.response.status, 400);
  assert.equal(rawTime.json.reason, "invalid_request");
  const batch = await request("/api/outbound-call-records/ocr_cof_customer/outcome", shirley, "POST", {
    outcome: "有意向",
    records: ["ocr_cof_customer"]
  });
  assert.equal(batch.response.status, 400);
  const batchLabel = await request("/api/unlabeled-connected-calls/label", shirley, "POST", {
    callRecordIds: ["ocr_cof_customer"],
    outcome: "其他",
    nextFollowChoice: "tomorrow"
  });
  assert.equal(batchLabel.response.status, 400);
  assert.equal(customer()?.nextReminder, "2026-11-09 09:00");

  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.leadActivities.length, leadActivitiesBefore);
  assert.equal(store.leads.length, leadsBefore + 3);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  assert.equal(aliyunHits, 0);
  assert.equal(JSON.stringify(followAudits()).includes("do-not-leak"), false);
  assert.equal(JSON.stringify(store.callOutcomeAudits).includes("do-not-leak"), false);
  console.log("call outcome next follow http tests passed");
} finally {
  setOutboundNowForTests(undefined);
  const store = storeForCleanup;
  setTenantTimezoneOverride(store, "europe", undefined);
  if (createdWindowConfig) {
    store.aliyunOutboundConfigs = store.aliyunOutboundConfigs.filter((item) => item.teamId !== "europe" || item.updatedAt !== "" || item.instanceId !== "");
  } else {
    const europeConfig = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe");
    if (europeConfig) europeConfig.callWindowStart = windowBefore;
  }
  if (originalSnapshot) store.getIamCapabilitySnapshot = originalSnapshot;
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_cof_"));
  store.callOutcomeAudits = store.callOutcomeAudits.filter((item) => !item.callRecordId.startsWith("ocr_cof_"));
  store.nextFollowUpAudits = store.nextFollowUpAudits.filter((item) => !(item.callRecordId || "").startsWith("ocr_cof_"));
  store.customers = store.customers.filter((item) => !item.id.startsWith("c_cof_"));
  store.leads = store.leads.filter((item) => !item.id.startsWith("l_cof_"));
  store.websiteOpportunities = store.websiteOpportunities.filter((item) => !item.id.startsWith("p_cof_"));
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_cof_"));
  store.users = store.users.filter((item) => item.id !== "u_cof_no_read" && item.id !== "u_cof_no_update");
  globalThis.fetch = originalFetch;
  server.close();
}
