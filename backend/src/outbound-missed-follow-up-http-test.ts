import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { outboundInstant, setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { Customer, OutboundCallRecord, WebsiteOpportunity } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start missed follow-up test server");
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
  const json = await response.json().catch(() => ({})) as Record<string, any>;
  return { response, json };
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

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "targetType" | "targetId" | "establishedTimeRaw">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    agentIds: "agent@ccc-a",
    maskedNumber: "*******2333",
    contactType: "OUTBOUND",
    contactDisposition: "",
    earlyMediaState: "",
    callDurationRaw: "",
    releaseTimeRaw: "",
    startTimeRaw: String(Date.parse("2026-10-30T03:00:00.000Z")),
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "",
    recordingDurationRaw: "",
    followUpActivityId: "",
    createdAt: "2026-10-30T03:00:00.000Z",
    updatedAt: "2026-10-30T03:00:00.000Z",
    ...partial
  };
}

function candidate(partial: Partial<WebsiteOpportunity> & Pick<WebsiteOpportunity, "id" | "status">): WebsiteOpportunity {
  return {
    company: partial.id,
    business: "",
    country: "",
    website: "",
    contact: "",
    contactInfo: "",
    description: "",
    ownerId: "u_sales_shirley",
    teamId: "europe",
    createdAt: "2026-10-30T00:00:00.000Z",
    ...partial
  };
}

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const customer = store.customers.find((item) => item.id === "c1");
  const lead = store.leads.find((item) => item.id === "l2");
  assert.ok(shirleyUser && miaUser && customer && lead);
  const customerReminder = customer.nextReminder;
  const activitiesBefore = store.customerActivities.length;
  const leadActivitiesBefore = store.leadActivities.length;
  const followAuditsBefore = store.followUpAudits.length;
  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const sequencesBefore = store.outreachSequences.length;
  const plansBefore = store.prospectOutreachPlans.length;
  const enabledBefore = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled === true;

  store.users.push({
    ...shirleyUser,
    id: "u_no_call_read_follow",
    name: "No Call Read",
    email: "no-call-read-follow@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_no_customer_update",
    name: "No Customer Update",
    email: "no-customer-update@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    const permissions = { ...snapshot.permissions };
    if (actor.id === "u_no_call_read_follow") delete permissions["communication.read"];
    if (actor.id === "u_no_customer_update") delete permissions["customer.update"];
    return { ...snapshot, permissions };
  };
  const miaCustomer: Customer = {
    ...customer,
    id: "c_missed_mia",
    company: "Mia Private",
    ownerId: miaUser.id,
    nextReminder: "不要改"
  };
  const publicCustomer: Customer = {
    ...customer,
    id: "c_missed_public",
    company: "Public Pool",
    ownerId: shirleyUser.id,
    poolStatus: "public",
    nextReminder: "公池不动"
  };
  store.customers.push(miaCustomer, publicCustomer);
  store.websiteOpportunities.push(
    candidate({ id: "cand-missed-preview", status: "preview" }),
    candidate({ id: "cand-missed-open", status: "contactable" }),
    candidate({ id: "cand-missed-suppressed", status: "contactable", outreachState: "suppressed" })
  );
  store.aliyunAgentMappings.push({
    id: "map_missed_shirley",
    teamId: "europe",
    crmUserId: shirleyUser.id,
    cccUserId: "agent@ccc-a",
    loginName: "shirley",
    displayName: "Shirley坐席",
    extension: "8001",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  }, {
    id: "map_missed_mia",
    teamId: "europe",
    crmUserId: miaUser.id,
    cccUserId: "agent@ccc-b",
    loginName: "mia",
    displayName: "Mia坐席",
    extension: "8002",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  }, {
    id: "map_missed_noupdate",
    teamId: "europe",
    crmUserId: "u_no_customer_update",
    cccUserId: "agent@ccc-noupdate",
    loginName: "noupdate",
    displayName: "无权维护",
    extension: "8003",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  });
  store.outboundCallRecords.push(
    record({ id: "ocr_missed_customer", targetType: "customer", targetId: "c1", establishedTimeRaw: "" }),
    record({ id: "ocr_missed_established", targetType: "customer", targetId: "c1", establishedTimeRaw: "1" }),
    record({ id: "ocr_missed_success", targetType: "customer", targetId: "c1", establishedTimeRaw: "", contactDisposition: "Success" }),
    record({ id: "ocr_missed_blank", targetType: "customer", targetId: "c1", establishedTimeRaw: "   " }),
    record({ id: "ocr_missed_custom", targetType: "customer", targetId: "c1", establishedTimeRaw: "" }),
    record({ id: "ocr_missed_badtime", targetType: "customer", targetId: "c1", establishedTimeRaw: "" }),
    record({ id: "ocr_missed_mia_owner", targetType: "customer", targetId: "c_missed_mia", establishedTimeRaw: "" }),
    record({ id: "ocr_missed_public", targetType: "customer", targetId: "c_missed_public", establishedTimeRaw: "" }),
    record({ id: "ocr_missed_noupdate", targetType: "customer", targetId: "c1", establishedTimeRaw: "", agentIds: "agent@ccc-noupdate" }),
    record({ id: "ocr_missed_lead", targetType: "lead", targetId: "l2", establishedTimeRaw: "" }),
    record({ id: "ocr_missed_preview", targetType: "prospect", targetId: "cand-missed-preview", establishedTimeRaw: "" }),
    record({ id: "ocr_missed_open", targetType: "prospect", targetId: "cand-missed-open", establishedTimeRaw: "" }),
    record({ id: "ocr_missed_suppressed", targetType: "prospect", targetId: "cand-missed-suppressed", establishedTimeRaw: "" }),
    record({ id: "ocr_missed_hold", targetType: "customer", targetId: "c1", establishedTimeRaw: "" }),
    record({ id: "ocr_missed_other", teamId: "other", targetType: "customer", targetId: "c1", establishedTimeRaw: "" })
  );
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  setOutboundNowForTests(new Date("2026-10-30T03:00:00.000Z"));

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const noRead = await login("no-call-read-follow@keduoduo.com");
  const noUpdate = await login("no-customer-update@keduoduo.com");

  const denied = await request("/api/outbound-call-records/ocr_missed_customer/next-follow-up", noRead, "POST", {});
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.permissionCode, "communication.read");
  assert.equal(store.outboundMissedFollowUps.length, 0);
  assert.equal(store.outboundMissedFollowUpAudits.length, 0);
  assert.equal(store.customerActivities.length, activitiesBefore);

  const hidden = await request("/api/outbound-call-records/ocr_missed_customer/next-follow-up", mia, "POST", {});
  assert.equal(hidden.response.status, 404);
  assert.equal(hidden.json.reason, "not_found");
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.outboundMissedFollowUpAudits[0]?.result, "rejected");
  assert.equal(store.outboundMissedFollowUpAudits[0]?.targetId, "");

  const established = await request("/api/outbound-call-records/ocr_missed_established/next-follow-up", shirley, "POST", {});
  assert.equal(established.response.status, 409);
  assert.equal(established.json.reason, "established");
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.customers.find((item) => item.id === "c1")?.nextReminder, customerReminder);

  const created = await request("/api/outbound-call-records/ocr_missed_customer/next-follow-up", shirley, "POST", {});
  assert.equal(created.response.status, 201);
  assert.equal(created.json.result, "created");
  assert.equal(created.json.replayed, false);
  assert.equal(created.json.nextFollowAt, "2026-11-02 09:00");
  assert.equal(created.json.suppressionNotice, "");
  assert.equal(created.json.targetType, "customer");
  assert.equal(store.customers.find((item) => item.id === "c1")?.nextReminder, "2026-11-02 09:00");
  const activity = store.customerActivities.find((item) => item.id === created.json.activityId);
  assert.equal(activity?.type, "call");
  assert.equal(activity?.nextReminder, "2026-11-02 09:00");
  assert.match(activity?.content || "", /未接通/);
  assert.equal((activity?.content || "").includes("000 000"), false);
  const followAudit = store.followUpAudits.find((item) => item.activityId === created.json.activityId);
  assert.equal(followAudit?.actorId, shirleyUser.id);
  assert.equal(followAudit?.objectType, "customer");
  assert.equal(followAudit?.objectId, "c1");
  const createdAudit = store.outboundMissedFollowUpAudits.find((item) => item.callRecordId === "ocr_missed_customer" && item.result === "created");
  assert.equal(createdAudit?.actorId, shirleyUser.id);
  assert.equal(createdAudit?.teamId, "europe");
  assert.ok(createdAudit?.at);
  assert.equal(JSON.stringify(createdAudit).includes("aliyuncs"), false);

  const again = await request("/api/outbound-call-records/ocr_missed_customer/next-follow-up", shirley, "POST", { nextFollowAt: "2026-12-01 11:00" });
  assert.equal(again.response.status, 200);
  assert.equal(again.json.result, "duplicate");
  assert.equal(again.json.replayed, true);
  assert.equal(again.json.activityId, created.json.activityId);
  assert.equal(again.json.nextFollowAt, "2026-11-02 09:00");
  assert.equal(store.customerActivities.filter((item) => item.customerId === "c1" && item.content.includes("未接通")).length, 1);
  assert.equal(store.customers.find((item) => item.id === "c1")?.nextReminder, "2026-11-02 09:00");
  assert.equal(store.outboundMissedFollowUps.filter((item) => item.callRecordId === "ocr_missed_customer").length, 1);

  const successOnly = await request("/api/outbound-call-records/ocr_missed_success/next-follow-up", shirley, "POST", {});
  assert.equal(successOnly.response.status, 201);
  assert.equal(successOnly.json.nextFollowAt, "2026-11-02 09:00");
  const blank = await request("/api/outbound-call-records/ocr_missed_blank/next-follow-up", shirley, "POST", {});
  assert.equal(blank.response.status, 201);

  const custom = await request("/api/outbound-call-records/ocr_missed_custom/next-follow-up", shirley, "POST", { nextFollowAt: "2026-11-04 15:30" });
  assert.equal(custom.response.status, 201);
  assert.equal(custom.json.nextFollowAt, "2026-11-04 15:30");
  assert.equal(store.customers.find((item) => item.id === "c1")?.nextReminder, "2026-11-04 15:30");

  const badTime = await request("/api/outbound-call-records/ocr_missed_badtime/next-follow-up", shirley, "POST", { nextFollowAt: "明天" });
  assert.equal(badTime.response.status, 400);
  assert.equal(badTime.json.reason, "invalid_request");
  assert.equal(store.outboundMissedFollowUps.some((item) => item.callRecordId === "ocr_missed_badtime"), false);

  const batch = await request("/api/outbound-call-records/ocr_missed_badtime/next-follow-up", shirley, "POST", { records: ["ocr_missed_badtime"] });
  assert.equal(batch.response.status, 400);
  assert.equal(batch.json.reason, "invalid_request");
  const batchList = await request("/api/outbound-call-records/ocr_missed_badtime/next-follow-up", shirley, "POST", ["ocr_missed_badtime"]);
  assert.equal(batchList.response.status, 400);

  const foreignOwner = await request("/api/outbound-call-records/ocr_missed_mia_owner/next-follow-up", shirley, "POST", {});
  assert.equal(foreignOwner.response.status, 404);
  assert.equal(store.customers.find((item) => item.id === "c_missed_mia")?.nextReminder, "不要改");
  assert.equal(store.outboundMissedFollowUpAudits.find((item) => item.callRecordId === "ocr_missed_mia_owner")?.result, "rejected");

  const noWrite = await request("/api/outbound-call-records/ocr_missed_noupdate/next-follow-up", noUpdate, "POST", {});
  assert.equal(noWrite.response.status, 403);
  assert.equal(noWrite.json.reason, "forbidden");
  assert.equal(store.outboundMissedFollowUps.some((item) => item.callRecordId === "ocr_missed_noupdate"), false);

  const pooled = await request("/api/outbound-call-records/ocr_missed_public/next-follow-up", shirley, "POST", {});
  assert.equal(pooled.response.status, 409);
  assert.equal(pooled.json.reason, "public_pool");
  assert.equal(store.customers.find((item) => item.id === "c_missed_public")?.nextReminder, "公池不动");

  setOutboundNowForTests(new Date("2026-10-30T03:00:00.000Z"));
  setTenantTimezoneOverride(store, "europe", "America/New_York");
  const newYork = await request("/api/outbound-call-records/ocr_missed_lead/next-follow-up", shirley, "POST", {});
  assert.equal(newYork.response.status, 201);
  assert.equal(newYork.json.nextFollowAt, "2026-10-30 09:00");
  assert.equal(newYork.json.targetType, "lead");
  assert.equal(store.leads.find((item) => item.id === "l2")?.nextFollowAt, "2026-10-30 09:00");
  assert.equal(store.leads.find((item) => item.id === "l2")?.status, "following");
  const leadActivity = store.leadActivities.find((item) => item.id === newYork.json.activityId);
  assert.equal(leadActivity?.type, "call");
  assert.equal(leadActivity?.nextFollowAt, "2026-10-30 09:00");
  assert.equal(store.followUpAudits.some((item) => item.activityId === newYork.json.activityId), false);

  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  store.aliyunOutboundConfigs.push({
    teamId: "europe",
    aliyunOutboundEnabled: false,
    instanceId: "",
    region: "",
    callerNumber: "",
    callWindowStart: "10:30",
    callWindowEnd: "18:00",
    maxCallsPerNumberPerDay: 3,
    minIntervalMinutes: 30,
    accessKeyIdEncrypted: "",
    accessKeySecretEncrypted: "",
    callbackPathTokenEncrypted: "",
    updatedBy: "",
    updatedAt: ""
  });
  setOutboundNowForTests(new Date("2026-10-31T03:00:00.000Z"));
  const saturday = await request("/api/outbound-call-records/ocr_missed_open/next-follow-up", shirley, "POST", {});
  assert.equal(saturday.response.status, 201);
  assert.equal(saturday.json.nextFollowAt, "2026-11-02 10:30");
  assert.equal(store.websiteOpportunities.find((item) => item.id === "cand-missed-open")?.nextFollowAt, "2026-11-02 10:30");
  assert.equal(store.followUpAudits.some((item) => item.activityId === saturday.json.activityId && item.objectType === "prospect_candidate"), true);
  assert.equal(store.leads.length, leadsBefore);

  const preview = await request("/api/outbound-call-records/ocr_missed_preview/next-follow-up", shirley, "POST", {});
  assert.equal(preview.response.status, 409);
  assert.equal(preview.json.reason, "not_contactable");
  assert.equal(store.websiteOpportunities.find((item) => item.id === "cand-missed-preview")?.nextFollowAt || "", "");
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.outboundMissedFollowUps.some((item) => item.callRecordId === "ocr_missed_preview"), false);

  const suppressed = await request("/api/outbound-call-records/ocr_missed_suppressed/next-follow-up", shirley, "POST", {});
  assert.equal(suppressed.response.status, 201);
  assert.match(suppressed.json.suppressionNotice, /抑制/);
  assert.equal(store.websiteOpportunities.find((item) => item.id === "cand-missed-suppressed")?.outreachState, "suppressed");
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);

  store.websiteOpportunities.push(candidate({
    id: "cand-missed-customer-hold-late",
    status: "preview",
    customerId: "c1",
    outreachState: "suppressed"
  }));
  const held = await request("/api/outbound-call-records/ocr_missed_hold/next-follow-up", shirley, "POST", {});
  assert.equal(held.response.status, 201);
  assert.match(held.json.suppressionNotice, /不改变抑制状态/);
  assert.equal(store.websiteOpportunities.find((item) => item.id === "cand-missed-customer-hold-late")?.outreachState, "suppressed");

  const detail = await request("/api/outbound-call-records/ocr_missed_established", shirley);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.json.record.established, true);
  assert.equal(detail.json.suggestedNextFollowAt, "");
  const missedDetail = await request("/api/outbound-call-records/ocr_missed_suppressed", shirley);
  assert.equal(missedDetail.response.status, 200);
  assert.equal(missedDetail.json.record.established, false);
  assert.equal(missedDetail.json.record.followUpGenerated, true);
  assert.match(missedDetail.json.suppressionNotice, /抑制/);
  const otherDetail = await request("/api/outbound-call-records/ocr_missed_other", shirley);
  assert.equal(otherDetail.response.status, 404);

  const list = await request("/api/outbound-call-records", shirley);
  const establishedRow = list.json.records.find((item: { id: string }) => item.id === "ocr_missed_established");
  const missedRow = list.json.records.find((item: { id: string }) => item.id === "ocr_missed_customer");
  assert.equal(establishedRow.established, true);
  assert.equal(establishedRow.followUpGenerated, false);
  assert.equal(missedRow.established, false);
  assert.equal(missedRow.followUpGenerated, true);

  assert.equal(aliyunHits, 0);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.outreachSequences.length, sequencesBefore);
  assert.equal(store.prospectOutreachPlans.length, plansBefore);
  assert.equal(store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled === true, enabledBefore);
  assert.equal(outboundInstant().toISOString(), "2026-10-31T03:00:00.000Z");
  assert.ok(store.customerActivities.length > activitiesBefore);
  assert.ok(store.leadActivities.length > leadActivitiesBefore);
  assert.ok(store.followUpAudits.length > followAuditsBefore);
  assert.equal(JSON.stringify(store.outboundMissedFollowUpAudits).includes("AccessKey"), false);

  console.log("outbound missed follow-up http tests passed");
} finally {
  const store = getStore();
  setOutboundNowForTests(undefined);
  setTenantTimezoneOverride(store, "europe", undefined);
  const customer = store.customers.find((item) => item.id === "c1");
  if (customer) customer.nextReminder = "已逾期";
  const lead = store.leads.find((item) => item.id === "l2");
  if (lead) {
    lead.nextFollowAt = "今天 15:00";
    lead.status = "new";
    lead.lastActivityAt = "昨天 17:40";
  }
  store.customers = store.customers.filter((item) => item.id !== "c_missed_mia" && item.id !== "c_missed_public");
  store.users = store.users.filter((item) => item.id !== "u_no_call_read_follow" && item.id !== "u_no_customer_update");
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_missed_"));
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_missed_"));
  store.websiteOpportunities = store.websiteOpportunities.filter((item) => !item.id.startsWith("cand-missed-"));
  store.aliyunOutboundConfigs = store.aliyunOutboundConfigs.filter((item) => item.teamId !== "europe" || item.updatedBy !== "");
  store.customerActivities = store.customerActivities.filter((item) => !item.content.startsWith("未接通，已安排下次跟进"));
  store.leadActivities = store.leadActivities.filter((item) => !item.content.startsWith("未接通，已安排下次跟进"));
  store.followUpAudits = store.followUpAudits.filter((item) => !item.activityId.startsWith("ca_") || item.objectId !== "c1");
  store.outboundMissedFollowUps = store.outboundMissedFollowUps.filter((item) => !item.callRecordId.startsWith("ocr_missed_"));
  store.outboundMissedFollowUpAudits = store.outboundMissedFollowUpAudits.filter((item) => !item.callRecordId.startsWith("ocr_missed_"));
  globalThis.fetch = originalFetch;
  server.close();
}
