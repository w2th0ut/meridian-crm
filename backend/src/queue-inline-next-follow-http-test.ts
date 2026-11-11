import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { AliyunAgentMapping, OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start inline next follow test server");
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
    agentIds: "agent@ccc-qnf-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://secret.example/do-not-leak",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "",
    callOutcomeNote: "原备注",
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
    id: "u_qnf_no_read",
    name: "No Read",
    email: "no-qnf-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_qnf_no_update",
    name: "No Update",
    email: "no-qnf-update@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    if (actor.id !== "u_qnf_no_read" && actor.id !== "u_qnf_no_update") return snapshot;
    const permissions = { ...snapshot.permissions };
    if (actor.id === "u_qnf_no_read") delete permissions["communication.read"];
    if (actor.id === "u_qnf_no_update") delete permissions["customer.update"];
    return { ...snapshot, permissions };
  };
  const noRead = await login("no-qnf-read@keduoduo.com");
  const noUpdate = await login("no-qnf-update@keduoduo.com");
  const mapping = (partial: Partial<AliyunAgentMapping> & Pick<AliyunAgentMapping, "crmUserId" | "cccUserId">): AliyunAgentMapping => ({
    id: `map_qnf_${partial.cccUserId}`,
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
    mapping({ crmUserId: shirleyUser.id, cccUserId: "agent@ccc-qnf-a", displayName: "Shirley坐席" }),
    mapping({ crmUserId: "u_qnf_no_update", cccUserId: "agent@ccc-qnf-noupdate", displayName: "No Update坐席" })
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
  store.customers.push({
    ...customerTemplate,
    id: "c_qnf_open",
    company: "Nordic <Tools>",
    teamId: "europe",
    ownerId: shirleyUser.id,
    nextReminder: "保持",
    poolStatus: "owned"
  }, {
    ...customerTemplate,
    id: "c_qnf_pool",
    company: "公池",
    teamId: "europe",
    ownerId: shirleyUser.id,
    nextReminder: "公池原值",
    poolStatus: "public"
  }, {
    ...customerTemplate,
    id: "c_qnf_other",
    company: "别人的客户",
    teamId: "europe",
    ownerId: alexUser.id,
    nextReminder: "别人的时间",
    poolStatus: "owned"
  }, {
    ...customerTemplate,
    id: "c_qnf_noupdate",
    company: "无权客户",
    teamId: "europe",
    ownerId: "u_qnf_no_update",
    nextReminder: "无权原值",
    poolStatus: "owned"
  }, {
    ...customerTemplate,
    id: "c_qnf_hold",
    company: "抑制客户",
    teamId: "europe",
    ownerId: shirleyUser.id,
    nextReminder: "抑制原值",
    poolStatus: "owned"
  });
  store.leads.push({
    ...leadTemplate,
    id: "l_qnf_ok",
    company: "跟进线索",
    teamId: "europe",
    ownerId: shirleyUser.id,
    nextFollowAt: "线索原值",
    status: leadTemplate.status,
    deletedAt: ""
  }, {
    ...leadTemplate,
    id: "l_qnf_deleted",
    company: "已删除",
    teamId: "europe",
    ownerId: shirleyUser.id,
    nextFollowAt: "不要改",
    deletedAt: "2026-11-01T00:00:00.000Z"
  }, {
    ...leadTemplate,
    id: "l_qnf_sync",
    company: "同步线索",
    teamId: "europe",
    ownerId: shirleyUser.id,
    nextFollowAt: "同步原值",
    status: "new",
    deletedAt: ""
  });
  store.websiteOpportunities.push({
    ...prospectTemplate,
    id: "p_qnf_ok",
    company: "可联系候选",
    teamId: "europe",
    ownerId: shirleyUser.id,
    status: "contacted",
    leadId: "l_qnf_sync",
    nextFollowAt: "候选原值",
    outreachState: "uncontacted"
  }, {
    ...prospectTemplate,
    id: "p_qnf_excluded",
    company: "已排除",
    teamId: "europe",
    ownerId: shirleyUser.id,
    status: "excluded",
    leadId: "",
    nextFollowAt: "排除原值",
    outreachState: "uncontacted"
  }, {
    ...prospectTemplate,
    id: "p_qnf_hold",
    company: "抑制候选",
    teamId: "europe",
    ownerId: shirleyUser.id,
    customerId: "c_qnf_hold",
    status: "contacted",
    leadId: "",
    nextFollowAt: "",
    outreachState: "suppressed"
  });
  store.outboundCallRecords.push(
    record({ id: "ocr_qnf_customer", targetType: "customer", targetId: "c_qnf_open" }),
    record({ id: "ocr_qnf_plain", targetType: "customer", targetId: "c_qnf_open" }),
    record({ id: "ocr_qnf_pool", targetType: "customer", targetId: "c_qnf_pool" }),
    record({ id: "ocr_qnf_other", targetType: "customer", targetId: "c_qnf_other" }),
    record({ id: "ocr_qnf_noupdate", targetType: "customer", targetId: "c_qnf_noupdate", agentIds: "agent@ccc-qnf-noupdate" }),
    record({ id: "ocr_qnf_hold", targetType: "customer", targetId: "c_qnf_hold" }),
    record({ id: "ocr_qnf_lead", targetType: "lead", targetId: "l_qnf_ok" }),
    record({ id: "ocr_qnf_deleted", targetType: "lead", targetId: "l_qnf_deleted" }),
    record({ id: "ocr_qnf_prospect", targetType: "prospect", targetId: "p_qnf_ok" }),
    record({ id: "ocr_qnf_excluded", targetType: "prospect", targetId: "p_qnf_excluded" }),
    record({ id: "ocr_qnf_none", targetType: "", targetId: "" })
  );

  const customer = () => store.customers.find((item) => item.id === "c_qnf_open");
  const followAudits = () => store.nextFollowUpAudits.filter((item) => (item.callRecordId || "").startsWith("ocr_qnf_"));

  const omitted = await request("/api/outbound-call-records/ocr_qnf_plain/outcome", shirley, "POST", {
    outcome: "有意向",
    preserveNote: true
  });
  assert.equal(omitted.response.status, 200, omitted.text);
  assert.equal(omitted.json.result, "updated");
  assert.equal(omitted.json.nextFollowResult, "skipped");
  assert.equal(omitted.json.note, "原备注");
  assert.equal(customer()?.nextReminder, "保持");
  assert.equal(followAudits().length, 0);

  const blank = await request("/api/outbound-call-records/ocr_qnf_plain/outcome", shirley, "POST", {
    outcome: "需回访",
    preserveNote: true,
    inlineNextFollow: "   "
  });
  assert.equal(blank.response.status, 200, blank.text);
  assert.equal(customer()?.nextReminder, "保持");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_qnf_plain")?.callOutcomeNote, "原备注");
  assert.equal(followAudits().length, 0);

  const saved = await request("/api/outbound-call-records/ocr_qnf_customer/outcome", shirley, "POST", {
    outcome: "需回访",
    preserveNote: true,
    inlineNextFollow: "2026-11-07 15:30"
  });
  assert.equal(saved.response.status, 200, saved.text);
  assert.equal(saved.json.result, "updated");
  assert.equal(saved.json.message, "已保存通话结果，并记下下次跟进");
  assert.equal(saved.json.nextFollowAt, "2026-11-07 15:30");
  assert.equal(saved.json.nextFollowResult, "updated");
  assert.equal(saved.json.note, "原备注");
  assert.equal(customer()?.nextReminder, "2026-11-07 15:30");
  assert.equal(JSON.stringify(saved.json).includes("do-not-leak"), false);
  const followAudit = followAudits().find((item) => item.callRecordId === "ocr_qnf_customer");
  assert.equal(followAudit?.action, "set_next_follow_up");
  assert.equal(followAudit?.objectType, "customer");
  assert.equal(followAudit?.oldValue, "保持");
  assert.equal(followAudit?.newValue, "2026-11-07 15:30");
  assert.equal(followAudit?.callRecordId, "ocr_qnf_customer");
  assert.equal(followAudit?.batchId || "", "");

  const again = await request("/api/outbound-call-records/ocr_qnf_customer/outcome", shirley, "POST", {
    outcome: "需回访",
    preserveNote: true,
    inlineNextFollow: "2026-11-07 15:30"
  });
  assert.equal(again.response.status, 200, again.text);
  assert.equal(again.json.result, "unchanged");
  assert.equal(again.json.nextFollowResult, "unchanged");
  assert.equal(followAudits().filter((item) => item.callRecordId === "ocr_qnf_customer").length, 1);

  setTenantTimezoneOverride(store, "europe", "America/New_York");
  const ny = await request("/api/outbound-call-records/ocr_qnf_hold/outcome", shirley, "POST", {
    outcome: "其他",
    preserveNote: true,
    inlineNextFollow: "2026-11-06 09:00"
  });
  assert.equal(ny.response.status, 200, ny.text);
  assert.equal(ny.json.nextFollowAt, "2026-11-06 09:00");
  assert.equal(store.customers.find((item) => item.id === "c_qnf_hold")?.nextReminder, "2026-11-06 09:00");
  assert.match(ny.json.suppressionNotice || "", /不改变抑制状态/);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");

  const cleared = await request("/api/outbound-call-records/ocr_qnf_customer/outcome", shirley, "POST", {
    outcome: "未标注",
    preserveNote: true,
    clearInlineNextFollow: true
  });
  assert.equal(cleared.response.status, 200, cleared.text);
  assert.equal(cleared.json.result, "updated");
  assert.equal(cleared.json.outcome, "");
  assert.equal(cleared.json.note, "原备注");
  assert.equal(cleared.json.message, "已保存通话结果，已清除下次跟进");
  assert.equal(cleared.json.nextFollowAt, "");
  assert.equal(customer()?.nextReminder, "");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_qnf_customer")?.callOutcome, "");
  const clearAudit = followAudits().find((item) => item.callRecordId === "ocr_qnf_customer" && item.action === "clear_next_follow_up");
  assert.equal(clearAudit?.oldValue, "2026-11-07 15:30");
  assert.equal(clearAudit?.newValue, "");

  const clearAgain = await request("/api/outbound-call-records/ocr_qnf_customer/outcome", shirley, "POST", {
    outcome: "未标注",
    preserveNote: true,
    clearInlineNextFollow: true
  });
  assert.equal(clearAgain.response.status, 200, clearAgain.text);
  assert.equal(clearAgain.json.result, "unchanged");
  assert.equal(followAudits().filter((item) => item.action === "clear_next_follow_up" && item.callRecordId === "ocr_qnf_customer").length, 1);

  const leadStatusBefore = store.leads.find((item) => item.id === "l_qnf_ok")?.status;
  const leadSaved = await request("/api/outbound-call-records/ocr_qnf_lead/outcome", shirley, "POST", {
    outcome: "有意向",
    preserveNote: true,
    inlineNextFollow: "2026-11-08 10:00"
  });
  assert.equal(leadSaved.response.status, 200, leadSaved.text);
  assert.equal(store.leads.find((item) => item.id === "l_qnf_ok")?.nextFollowAt, "2026-11-08 10:00");
  assert.equal(store.leads.find((item) => item.id === "l_qnf_ok")?.status, leadStatusBefore);
  assert.equal(followAudits().find((item) => item.callRecordId === "ocr_qnf_lead")?.objectType, "lead");

  const prospectStatusBefore = store.leads.find((item) => item.id === "l_qnf_sync")?.status;
  const prospect = await request("/api/outbound-call-records/ocr_qnf_prospect/outcome", shirley, "POST", {
    outcome: "其他",
    preserveNote: true,
    clearInlineNextFollow: true
  });
  assert.equal(prospect.response.status, 200, prospect.text);
  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_qnf_ok")?.nextFollowAt, "");
  assert.equal(store.leads.find((item) => item.id === "l_qnf_sync")?.nextFollowAt, "");
  assert.equal(store.leads.find((item) => item.id === "l_qnf_sync")?.status, prospectStatusBefore);
  assert.equal(followAudits().find((item) => item.callRecordId === "ocr_qnf_prospect")?.action, "clear_next_follow_up");
  assert.equal(store.leadActivities.length, leadActivitiesBefore);

  const badTime = await request("/api/outbound-call-records/ocr_qnf_lead/outcome", shirley, "POST", {
    outcome: "无意向",
    preserveNote: true,
    inlineNextFollow: "明天"
  });
  assert.equal(badTime.response.status, 400);
  assert.equal(badTime.json.reason, "invalid_next_follow");
  assert.equal(store.leads.find((item) => item.id === "l_qnf_ok")?.nextFollowAt, "2026-11-08 10:00");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_qnf_lead")?.callOutcome, "有意向");

  const both = await request("/api/outbound-call-records/ocr_qnf_lead/outcome", shirley, "POST", {
    outcome: "无意向",
    preserveNote: true,
    inlineNextFollow: "2026-11-09 09:00",
    clearInlineNextFollow: true
  });
  assert.equal(both.response.status, 400);
  assert.equal(both.json.reason, "invalid_request");
  const rawTime = await request("/api/outbound-call-records/ocr_qnf_lead/outcome", shirley, "POST", {
    outcome: "无意向",
    preserveNote: true,
    nextFollowAt: "2026-11-09 09:00"
  });
  assert.equal(rawTime.response.status, 400);
  assert.equal(rawTime.json.reason, "invalid_request");
  const mixedChoice = await request("/api/outbound-call-records/ocr_qnf_lead/outcome", shirley, "POST", {
    outcome: "无意向",
    preserveNote: true,
    nextFollowChoice: "tomorrow",
    inlineNextFollow: "2026-11-09 09:00"
  });
  assert.equal(mixedChoice.response.status, 400);
  assert.equal(mixedChoice.json.reason, "invalid_request");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_qnf_lead")?.callOutcome, "有意向");
  assert.equal(store.leads.find((item) => item.id === "l_qnf_ok")?.nextFollowAt, "2026-11-08 10:00");

  const forbidden = await request("/api/outbound-call-records/ocr_qnf_noupdate/outcome", noUpdate, "POST", {
    outcome: "有意向",
    preserveNote: true,
    inlineNextFollow: "2026-11-09 09:00"
  });
  assert.equal(forbidden.response.status, 403, forbidden.text);
  assert.equal(forbidden.json.reason, "forbidden");
  assert.equal(store.customers.find((item) => item.id === "c_qnf_noupdate")?.nextReminder, "无权原值");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_qnf_noupdate")?.callOutcome, "");
  assert.equal(followAudits().find((item) => item.callRecordId === "ocr_qnf_noupdate")?.action, "reject_forbidden");

  const pool = await request("/api/outbound-call-records/ocr_qnf_pool/outcome", shirley, "POST", {
    outcome: "有意向",
    preserveNote: true,
    clearInlineNextFollow: true
  });
  assert.equal(pool.response.status, 409, pool.text);
  assert.equal(pool.json.reason, "public_pool");
  assert.equal(store.customers.find((item) => item.id === "c_qnf_pool")?.nextReminder, "公池原值");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_qnf_pool")?.callOutcome, "");

  const hiddenOwner = await request("/api/outbound-call-records/ocr_qnf_other/outcome", shirley, "POST", {
    outcome: "有意向",
    preserveNote: true,
    inlineNextFollow: "2026-11-09 09:00"
  });
  assert.equal(hiddenOwner.response.status, 404, hiddenOwner.text);
  assert.equal(store.customers.find((item) => item.id === "c_qnf_other")?.nextReminder, "别人的时间");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_qnf_other")?.callOutcome, "");
  assert.equal(JSON.stringify(hiddenOwner.json).includes("别人的时间"), false);

  const deleted = await request("/api/outbound-call-records/ocr_qnf_deleted/outcome", shirley, "POST", {
    outcome: "有意向",
    preserveNote: true,
    inlineNextFollow: "2026-11-09 09:00"
  });
  assert.equal(deleted.response.status, 404, deleted.text);
  assert.equal(store.leads.find((item) => item.id === "l_qnf_deleted")?.nextFollowAt, "不要改");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_qnf_deleted")?.callOutcome, "");

  const excluded = await request("/api/outbound-call-records/ocr_qnf_excluded/outcome", shirley, "POST", {
    outcome: "有意向",
    preserveNote: true,
    inlineNextFollow: "2026-11-09 09:00"
  });
  assert.equal(excluded.response.status, 409, excluded.text);
  assert.equal(excluded.json.reason, "not_contactable");
  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_qnf_excluded")?.nextFollowAt, "排除原值");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_qnf_excluded")?.callOutcome, "");
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);

  const noTarget = await request("/api/outbound-call-records/ocr_qnf_none/outcome", shirley, "POST", {
    outcome: "其他",
    preserveNote: true,
    inlineNextFollow: "2026-11-09 09:00"
  });
  assert.equal(noTarget.response.status, 400, noTarget.text);
  assert.equal(noTarget.json.reason, "no_target");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_qnf_none")?.callOutcome, "");

  const noReadResult = await request("/api/outbound-call-records/ocr_qnf_customer/outcome", noRead, "POST", {
    outcome: "其他",
    preserveNote: true,
    inlineNextFollow: "2026-11-10 09:00"
  });
  assert.equal(noReadResult.response.status, 403);
  assert.equal(followAudits().some((item) => item.actorId === "u_qnf_no_read"), false);
  assert.equal(customer()?.nextReminder, "");

  const anonymous = await request("/api/outbound-call-records/ocr_qnf_customer/outcome", "", "POST", {
    outcome: "其他",
    preserveNote: true,
    clearInlineNextFollow: true
  });
  assert.equal(anonymous.response.status, 401);

  const negativeZone = await request("/api/negative-outcome-followups?scope=mine", shirley);
  assert.equal(negativeZone.response.status, 200, negativeZone.text);
  assert.equal(typeof negativeZone.json.timeZone, "string");
  assert.ok(negativeZone.json.timeZone);
  const otherZone = await request("/api/other-outcome-followups?scope=mine", shirley);
  assert.equal(typeof otherZone.json.timeZone, "string");
  const unlabeledZone = await request("/api/unlabeled-connected-followups?scope=mine", shirley);
  assert.equal(typeof unlabeledZone.json.timeZone, "string");

  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.leadActivities.length, leadActivitiesBefore);
  assert.equal(store.leads.length, leadsBefore + 3);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  assert.equal(aliyunHits, 0);
  assert.equal(JSON.stringify(followAudits()).includes("do-not-leak"), false);
  console.log("queue inline next follow http tests passed");
} finally {
  setOutboundNowForTests(undefined);
  const store = storeForCleanup;
  setTenantTimezoneOverride(store, "europe", undefined);
  if (originalSnapshot) store.getIamCapabilitySnapshot = originalSnapshot;
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_qnf_"));
  store.callOutcomeAudits = store.callOutcomeAudits.filter((item) => !item.callRecordId.startsWith("ocr_qnf_"));
  store.nextFollowUpAudits = store.nextFollowUpAudits.filter((item) => !(item.callRecordId || "").startsWith("ocr_qnf_"));
  store.customers = store.customers.filter((item) => !item.id.startsWith("c_qnf_"));
  store.leads = store.leads.filter((item) => !item.id.startsWith("l_qnf_"));
  store.websiteOpportunities = store.websiteOpportunities.filter((item) => !item.id.startsWith("p_qnf_"));
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_qnf_"));
  store.users = store.users.filter((item) => item.id !== "u_qnf_no_read" && item.id !== "u_qnf_no_update");
  globalThis.fetch = originalFetch;
  server.close();
}
