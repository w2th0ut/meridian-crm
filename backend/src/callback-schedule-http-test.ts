import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { outboundInstant, setOutboundNowForTests, setTenantTimezoneOverride, zonedDateKey } from "./outbound-call.js";
import type { OutboundCallRecord, WebsiteOpportunity } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start callback schedule test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

function shiftDate(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${mm}-${dd}`;
}

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

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "agentIds">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    targetType: "customer",
    targetId: "c1",
    maskedNumber: "*******2333",
    contactType: "OUTBOUND",
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "10",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: String(Date.parse("2026-04-04T04:00:00.000Z")),
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "有意向",
    callOutcomeNote: "",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  assert.ok(shirleyUser && miaUser);
  store.users.push({
    ...shirleyUser,
    id: "u_cb_no_read",
    name: "No Callback Read",
    email: "cb-no-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_cb_no_update",
    name: "No Callback Update",
    email: "cb-no-update@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_cb_asia",
    name: "Asia Callback",
    email: "cb-asia@keduoduo.com",
    role: "sales",
    teamId: "asia",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    if (actor.id !== "u_cb_no_read" && actor.id !== "u_cb_no_update") return snapshot;
    const permissions = { ...snapshot.permissions };
    if (actor.id === "u_cb_no_read") delete permissions["communication.read"];
    if (actor.id === "u_cb_no_update") delete permissions["customer.update"];
    return { ...snapshot, permissions };
  };

  const customer = store.customers.find((item) => item.id === "c1");
  const pooled = store.customers.find((item) => item.id === "c2");
  const lead = store.leads.find((item) => item.id === "l1");
  assert.ok(customer && pooled && lead);
  const reminderBefore = customer.nextReminder;
  const leadFollowBefore = lead.nextFollowAt;
  const poolBefore = pooled.poolStatus;
  store.customers.push({
    ...customer,
    id: "c_cb_open",
    company: "Open Callback Co",
    nextReminder: "",
    ownerId: shirleyUser.id
  }, {
    ...customer,
    id: "c_cb_mia",
    company: "Mia Callback Co",
    nextReminder: "",
    ownerId: miaUser.id
  }, {
    ...customer,
    id: "c_cb_asia",
    company: "Asia Callback Co",
    teamId: "asia",
    nextReminder: "",
    ownerId: "u_cb_asia"
  });
  store.websiteOpportunities.push({
    id: "cand-callback",
    company: "Callback Buyer",
    business: "",
    country: "瑞典",
    website: "",
    contact: "",
    contactInfo: "",
    description: "",
    ownerId: shirleyUser.id,
    teamId: "europe",
    status: "contactable",
    createdAt: "2026-11-01T00:00:00.000Z",
    tenantProspectId: "tp-callback"
  } satisfies WebsiteOpportunity);

  store.aliyunAgentMappings.push({
    id: "map_cb_shirley",
    teamId: "europe",
    crmUserId: shirleyUser.id,
    cccUserId: "agent@ccc-cb-a",
    loginName: "shirley-cb",
    displayName: "Shirley回拨",
    extension: "8301",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-11-01T00:00:00.000Z"
  }, {
    id: "map_cb_mia",
    teamId: "europe",
    crmUserId: miaUser.id,
    cccUserId: "agent@ccc-cb-b",
    loginName: "mia-cb",
    displayName: "Mia回拨",
    extension: "8302",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-11-01T00:00:00.000Z"
  }, {
    id: "map_cb_noupd",
    teamId: "europe",
    crmUserId: "u_cb_no_update",
    cccUserId: "agent@ccc-cb-c",
    loginName: "noupd-cb",
    displayName: "无维护回拨",
    extension: "8303",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-11-01T00:00:00.000Z"
  });
  store.outboundCallRecords.push(
    record({ id: "ocr_cb_c1", agentIds: "agent@ccc-cb-a", targetId: "c1" }),
    record({ id: "ocr_cb_open", agentIds: "agent@ccc-cb-a", targetId: "c_cb_open", maskedNumber: "*******1001" }),
    record({ id: "ocr_cb_mia", agentIds: "agent@ccc-cb-b", targetId: "c_cb_mia", maskedNumber: "*******1002" }),
    record({ id: "ocr_cb_noupd", agentIds: "agent@ccc-cb-c", targetId: "c1" })
  );

  const instant = new Date("2026-11-01T03:30:00.000Z");
  setOutboundNowForTests(instant);
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  setTenantTimezoneOverride(store, "asia", "Asia/Shanghai");
  const shanghaiToday = zonedDateKey(instant, "Asia/Shanghai");
  const nyToday = zonedDateKey(instant, "America/New_York");
  assert.notEqual(shanghaiToday, nyToday);
  const todayAt = `${shanghaiToday} 10:00`;
  const overdueAt = `${shiftDate(shanghaiToday, -1)} 09:00`;
  const laterAt = `${shiftDate(shanghaiToday, 1)} 11:00`;

  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions);
  const leadsBefore = store.leads.length;
  const sequencesBefore = JSON.stringify(store.outreachSequences);
  const followBefore = store.followUpAudits.length;
  const activitiesBefore = store.customerActivities.length;
  const dialAuditsBefore = store.outboundCallAudits.length;
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), false);

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const noRead = await login("cb-no-read@keduoduo.com");
  const noUpdate = await login("cb-no-update@keduoduo.com");
  const asia = await login("cb-asia@keduoduo.com");

  const badTime = await request("/api/callback-schedules", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    scheduledAt: "2026-11-01T10:00"
  });
  assert.equal(badTime.response.status, 400);
  assert.equal(store.callbackScheduleAudits.length, 0);
  assert.equal(store.callbackSchedules.length, 0);

  const batch = await request("/api/callback-schedules", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    scheduledAt: todayAt,
    records: ["c1"]
  });
  assert.equal(batch.response.status, 400);
  assert.equal(store.callbackScheduleAudits.length, 0);

  const longNote = await request("/api/callback-schedules", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    scheduledAt: todayAt,
    note: "注".repeat(201)
  });
  assert.equal(longNote.response.status, 400);
  assert.equal(store.callbackScheduleAudits.length, 0);

  const created = await request("/api/callback-schedules", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    scheduledAt: todayAt,
    note: "  下午再打  "
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.json.result, "updated");
  assert.equal(created.json.action, "set");
  assert.equal(created.json.scheduledAt, todayAt);
  assert.equal(created.json.note, "下午再打");
  assert.equal(created.json.previousScheduledAt, "");
  assert.equal(JSON.stringify(created.json).includes("jobId"), false);
  const firstAudit = store.callbackScheduleAudits[0];
  assert.ok(firstAudit);
  assert.equal(firstAudit.actorId, shirleyUser.id);
  assert.equal(firstAudit.teamId, "europe");
  assert.equal(firstAudit.targetType, "customer");
  assert.equal(firstAudit.targetId, "c1");
  assert.equal(firstAudit.action, "set");
  assert.equal(firstAudit.previousScheduledAt, "");
  assert.equal(firstAudit.nextScheduledAt, todayAt);
  assert.equal(firstAudit.previousNote, "");
  assert.equal(firstAudit.nextNote, "下午再打");
  assert.equal(firstAudit.result, "updated");
  assert.ok(firstAudit.at);

  const same = await request("/api/callback-schedules", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    scheduledAt: todayAt,
    note: "下午再打"
  });
  assert.equal(same.response.status, 200);
  assert.equal(same.json.result, "unchanged");
  assert.equal(store.callbackScheduleAudits.length, 1);

  const updated = await request("/api/outbound-call-records/ocr_cb_c1/callback-schedule", shirley, "POST", {
    scheduledAt: overdueAt,
    note: "改期"
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.json.action, "update");
  assert.equal(updated.json.previousScheduledAt, todayAt);
  assert.equal(updated.json.scheduledAt, overdueAt);
  assert.equal(updated.json.sourceCallRecordId, "ocr_cb_c1");
  const updateAudit = store.callbackScheduleAudits.find((item) => item.action === "update" && item.targetId === "c1");
  assert.ok(updateAudit);
  assert.equal(updateAudit.previousScheduledAt, todayAt);
  assert.equal(updateAudit.nextScheduledAt, overdueAt);
  assert.equal(updateAudit.previousNote, "下午再打");
  assert.equal(updateAudit.nextNote, "改期");
  assert.equal(updateAudit.actorId, shirleyUser.id);
  assert.equal(updateAudit.sourceCallRecordId, "ocr_cb_c1");
  assert.equal(store.callbackSchedules.find((item) => item.targetId === "c1")?.scheduledAt, overdueAt);

  const miaDenied = await request("/api/callback-schedules", mia, "POST", {
    targetType: "customer",
    targetId: "c1",
    scheduledAt: todayAt,
    note: "越权"
  });
  assert.equal(miaDenied.response.status, 403);
  assert.equal(miaDenied.json.reason, "forbidden");
  assert.equal(JSON.stringify(miaDenied.json).includes(overdueAt), false);
  const miaAudit = store.callbackScheduleAudits.find((item) => item.actorId === miaUser.id && item.targetId === "c1");
  assert.ok(miaAudit);
  assert.equal(miaAudit.result, "rejected");
  assert.equal(miaAudit.reason, "forbidden");
  assert.equal(miaAudit.previousScheduledAt, overdueAt);
  assert.equal(miaAudit.nextScheduledAt, todayAt);
  assert.equal(store.callbackSchedules.find((item) => item.targetId === "c1")?.scheduledAt, overdueAt);
  assert.equal(store.callbackSchedules.find((item) => item.targetId === "c1")?.note, "改期");

  const hiddenCall = await request("/api/outbound-call-records/ocr_cb_c1/callback-schedule", mia, "POST", {
    cancel: true
  });
  assert.equal(hiddenCall.response.status, 403);
  assert.equal(store.callbackScheduleAudits.some((item) => item.actorId === miaUser.id && item.sourceCallRecordId === "ocr_cb_c1" && item.result === "rejected"), true);
  assert.equal(store.callbackSchedules.find((item) => item.targetId === "c1")?.scheduledAt, overdueAt);

  const noReadDenied = await request("/api/outbound-call-records/ocr_cb_c1/callback-schedule", noRead, "POST", {
    scheduledAt: todayAt
  });
  assert.equal(noReadDenied.response.status, 403);
  assert.equal(store.callbackScheduleAudits.some((item) => item.actorId === "u_cb_no_read" && item.result === "rejected" && item.reason === "forbidden"), true);
  assert.equal(store.callbackSchedules.find((item) => item.targetId === "c1")?.note, "改期");

  const noUpdateDenied = await request("/api/outbound-call-records/ocr_cb_noupd/callback-schedule", noUpdate, "POST", {
    scheduledAt: todayAt,
    note: "无权"
  });
  assert.equal(noUpdateDenied.response.status, 403);
  assert.equal(store.callbackScheduleAudits.some((item) => item.actorId === "u_cb_no_update" && item.result === "rejected"), true);
  assert.equal(store.callbackSchedules.find((item) => item.targetId === "c1")?.scheduledAt, overdueAt);

  const cross = await request("/api/callback-schedules", asia, "POST", {
    targetType: "customer",
    targetId: "c1",
    scheduledAt: todayAt
  });
  assert.equal(cross.response.status, 404);
  assert.equal(store.callbackScheduleAudits.some((item) => item.actorId === "u_cb_asia" && item.teamId === "asia" && item.result === "rejected" && item.reason === "not_found"), true);
  assert.equal(store.callbackSchedules.filter((item) => item.teamId === "europe" && item.targetId === "c1").length, 1);

  const asiaOwn = await request("/api/callback-schedules", asia, "POST", {
    targetType: "customer",
    targetId: "c_cb_asia",
    scheduledAt: laterAt,
    note: "亚洲"
  });
  assert.equal(asiaOwn.response.status, 200);
  assert.equal(store.callbackSchedules.find((item) => item.targetId === "c_cb_asia")?.teamId, "asia");

  pooled.poolStatus = "public";
  const auditsBeforePool = store.callbackScheduleAudits.length;
  const poolDenied = await request("/api/callback-schedules", shirley, "POST", {
    targetType: "customer",
    targetId: "c2",
    scheduledAt: todayAt
  });
  assert.equal(poolDenied.response.status, 409);
  assert.equal(poolDenied.json.reason, "public_pool");
  assert.equal(store.callbackSchedules.some((item) => item.targetId === "c2"), false);
  assert.equal(store.callbackScheduleAudits.length, auditsBeforePool + 1);
  assert.equal(store.callbackScheduleAudits.find((item) => item.targetId === "c2")?.reason, "public_pool");
  pooled.poolStatus = poolBefore;

  const leadSet = await request("/api/callback-schedules", shirley, "POST", {
    targetType: "lead",
    targetId: "l1",
    scheduledAt: todayAt,
    note: "线索回拨"
  });
  assert.equal(leadSet.response.status, 200);
  assert.equal(leadSet.json.action, "set");
  const prospectSet = await request("/api/callback-schedules", shirley, "POST", {
    targetType: "prospect",
    targetId: "cand-callback",
    scheduledAt: overdueAt
  });
  assert.equal(prospectSet.response.status, 200);
  const prospectDenied = await request("/api/callback-schedules", mia, "POST", {
    targetType: "prospect",
    targetId: "cand-callback",
    scheduledAt: todayAt
  });
  assert.equal(prospectDenied.response.status, 403);
  assert.equal(store.callbackSchedules.find((item) => item.targetId === "cand-callback")?.scheduledAt, overdueAt);

  const openSet = await request("/api/callback-schedules", shirley, "POST", {
    targetType: "customer",
    targetId: "c_cb_open",
    scheduledAt: todayAt,
    note: "队列里"
  });
  assert.equal(openSet.response.status, 200);

  const dueToday = await request("/api/callback-schedules?due=today", shirley);
  assert.equal(dueToday.response.status, 200);
  assert.equal(dueToday.json.items.some((item: { targetId: string }) => item.targetId === "c_cb_open"), true);
  assert.equal(dueToday.json.items.some((item: { targetId: string }) => item.targetId === "c1"), false);
  assert.equal(dueToday.json.items.some((item: { targetId: string }) => item.targetId === "l1"), true);
  const dueOverdue = await request("/api/callback-schedules?due=overdue", shirley);
  assert.equal(dueOverdue.json.items.some((item: { targetId: string; due: string }) => item.targetId === "c1" && item.due === "overdue"), true);
  assert.equal(dueOverdue.json.items.some((item: { targetId: string }) => item.targetId === "c_cb_open"), false);
  const dueAll = await request("/api/callback-schedules", shirley);
  assert.equal(dueAll.json.items.some((item: { targetId: string }) => item.targetId === "c_cb_asia"), false);
  assert.equal(dueAll.json.items.some((item: { targetId: string }) => item.targetId === "c1"), true);
  assert.equal(dueAll.json.items[0]?.due, "overdue");
  assert.equal(JSON.stringify(dueAll.json).includes("*******"), false);
  const miaList = await request("/api/callback-schedules", mia);
  assert.equal(miaList.json.items.some((item: { targetId: string }) => item.targetId === "c1"), false);
  const badDue = await request("/api/callback-schedules?due=later", shirley);
  assert.equal(badDue.response.status, 400);

  setTenantTimezoneOverride(store, "europe", "America/New_York");
  const nyList = await request("/api/callback-schedules?due=today", shirley);
  assert.equal(nyList.json.today, nyToday);
  assert.equal(nyList.json.items.some((item: { targetId: string }) => item.targetId === "c1"), true);
  assert.equal(nyList.json.items.some((item: { targetId: string }) => item.targetId === "c_cb_open"), false);
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");

  const queueAll = await request("/api/intent-followup-queue", shirley);
  assert.equal(queueAll.response.status, 200);
  const openRow = (queueAll.json.items || []).find((item: { targetId: string }) => item.targetId === "c_cb_open");
  assert.ok(openRow);
  assert.equal(openRow.callbackScheduledAt, todayAt);
  assert.equal(openRow.callbackDue, "today");
  const queueToday = await request("/api/intent-followup-queue?callbackDue=today", shirley);
  assert.equal(queueToday.json.items.every((item: { callbackDue: string }) => item.callbackDue === "today"), true);
  assert.equal(queueToday.json.items.some((item: { targetId: string }) => item.targetId === "c_cb_open"), true);
  const queueOverdue = await request("/api/intent-followup-queue?callbackDue=overdue", shirley);
  assert.equal(queueOverdue.json.items.some((item: { targetId: string }) => item.targetId === "c_cb_open"), false);
  const badQueue = await request("/api/intent-followup-queue?callbackDue=无意向", shirley);
  assert.equal(badQueue.response.status, 400);

  const detail = await request("/api/outbound-call-records/ocr_cb_open", shirley);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.json.record.callbackScheduledAt, todayAt);
  assert.equal(detail.json.record.callbackDue, "today");

  const cancelled = await request("/api/callback-schedules/cancel", shirley, "POST", {
    targetType: "customer",
    targetId: "c1"
  });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.json.action, "cancel");
  assert.equal(cancelled.json.previousScheduledAt, overdueAt);
  assert.equal(cancelled.json.scheduledAt, "");
  assert.equal(store.callbackSchedules.some((item) => item.targetId === "c1"), false);
  const cancelAudit = store.callbackScheduleAudits.find((item) => item.action === "cancel" && item.targetId === "c1" && item.result === "updated");
  assert.ok(cancelAudit);
  assert.equal(cancelAudit.previousScheduledAt, overdueAt);
  assert.equal(cancelAudit.nextScheduledAt, "");
  assert.equal(cancelAudit.previousNote, "改期");
  assert.equal(cancelAudit.nextNote, "");
  assert.equal(cancelAudit.actorId, shirleyUser.id);
  const cancelAgain = await request("/api/callback-schedules/cancel", shirley, "POST", {
    targetType: "customer",
    targetId: "c1"
  });
  assert.equal(cancelAgain.response.status, 200);
  assert.equal(cancelAgain.json.result, "unchanged");
  assert.equal(store.callbackScheduleAudits.filter((item) => item.action === "cancel" && item.targetId === "c1" && item.result === "updated").length, 1);

  const callCancel = await request("/api/outbound-call-records/ocr_cb_open/callback-schedule", shirley, "POST", { cancel: true });
  assert.equal(callCancel.response.status, 200);
  assert.equal(callCancel.json.action, "cancel");
  assert.equal(store.callbackSchedules.some((item) => item.targetId === "c_cb_open"), false);

  assert.equal(customer.nextReminder, reminderBefore);
  assert.equal(lead.nextFollowAt, leadFollowBefore);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.followUpAudits.length, followBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.outboundCallAudits.length, dialAuditsBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(JSON.stringify(store.outreachSequences), sequencesBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), false);
  assert.equal(aliyunHits, 0);
  assert.equal(JSON.stringify(store.callbackScheduleAudits).includes("AccessKey"), false);
  assert.equal(outboundInstant().toISOString(), instant.toISOString());

  console.log("callback schedule http tests passed");
} finally {
  setOutboundNowForTests(undefined);
  const store = getStore();
  setTenantTimezoneOverride(store, "europe", undefined);
  setTenantTimezoneOverride(store, "asia", undefined);
  globalThis.fetch = originalFetch;
  server.close();
}
