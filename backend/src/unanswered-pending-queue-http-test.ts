import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { outboundInstant, setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { AliyunAgentMapping, CallbackSchedule, OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start unanswered pending queue test server");
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
    contactDisposition: "NoAnswer",
    earlyMediaState: "",
    callDurationRaw: "",
    establishedTimeRaw: "",
    releaseTimeRaw: "",
    startTimeRaw: "",
    agentIds: "agent@ccc-upq-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "",
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
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...partial
  };
}

try {
  const store = getStore();
  const instant = new Date("2026-11-04T02:30:00.000Z");
  setOutboundNowForTests(instant);
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  const ago = (seconds: number) => String(instant.getTime() - seconds * 1000);
  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  assert.ok(shirleyUser && miaUser);
  store.users.push({
    ...shirleyUser,
    id: "u_upq_no_read",
    name: "No Read",
    email: "no-upq-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    if (actor.id !== "u_upq_no_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };
  const noRead = await login("no-upq-read@keduoduo.com");
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
  store.aliyunAgentMappings.push(
    mapping({ crmUserId: shirleyUser.id, cccUserId: "agent@ccc-upq-a", displayName: "Shirley坐席" }),
    mapping({ crmUserId: miaUser.id, cccUserId: "agent@ccc-upq-b", displayName: "Mia坐席" })
  );
  const customer = store.customers.find((item) => item.id === "c1");
  const scheduledCustomer = store.customers.find((item) => item.id === "c2");
  const miaCustomer = store.customers.find((item) => item.id === "c3");
  const blankCustomer = store.customers.find((item) => item.id === "c4");
  const followed = store.customers.find((item) => item.id === "c5");
  const lead = store.leads.find((item) => item.id === "l2");
  const prospect = store.websiteOpportunities.find((item) => item.id === "web_seed_1");
  assert.ok(customer && scheduledCustomer && miaCustomer && blankCustomer && followed && lead && prospect);
  customer.nextReminder = "";
  scheduledCustomer.nextReminder = "";
  miaCustomer.nextReminder = "";
  blankCustomer.nextReminder = "";
  lead.nextFollowAt = "";
  prospect.nextFollowAt = "";
  const keptReminder = followed.nextReminder;
  const leadTemplate = store.leads.find((item) => item.id === "l1");
  assert.ok(leadTemplate);
  store.leads.push({
    ...leadTemplate,
    id: "l_upq_deleted",
    company: "已删除线索",
    nextFollowAt: "",
    deletedAt: "2026-11-01T00:00:00.000Z"
  }, {
    ...leadTemplate,
    id: "l_upq_undated",
    company: "没有开始时间",
    nextFollowAt: "",
    deletedAt: ""
  }, {
    ...leadTemplate,
    id: "l_upq_future",
    company: "还没到的未接通",
    nextFollowAt: "",
    deletedAt: ""
  });
  store.callbackSchedules.push({
    id: "cbs_upq_c2",
    teamId: "europe",
    targetType: "customer",
    targetId: "c2",
    scheduledAt: "2026-11-20 09:00",
    note: "不要进队列",
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z",
    sourceCallRecordId: ""
  } satisfies CallbackSchedule);
  store.outboundCallRecords.push(
    record({ id: "ocr_upq_c1_old", targetType: "customer", targetId: "c1", startTimeRaw: ago(20 * 86400), maskedNumber: "13800138000" }),
    record({ id: "ocr_upq_c1", targetType: "customer", targetId: "c1", startTimeRaw: ago(8 * 86400), maskedNumber: "13800138000", contactDisposition: "Success", agentIds: "agent@ccc-upq-a" }),
    record({ id: "ocr_upq_c1_answered", targetType: "customer", targetId: "c1", startTimeRaw: ago(3600), establishedTimeRaw: "1", contactDisposition: "Success" }),
    record({ id: "ocr_upq_c2", targetType: "customer", targetId: "c2", startTimeRaw: ago(86400) }),
    record({ id: "ocr_upq_c3", targetType: "customer", targetId: "c3", startTimeRaw: ago(86400), agentIds: "agent@ccc-upq-b", maskedNumber: "****3000" }),
    record({ id: "ocr_upq_c4", targetType: "customer", targetId: "c4", startTimeRaw: ago(7200), agentIds: "" }),
    record({ id: "ocr_upq_c5", targetType: "customer", targetId: "c5", startTimeRaw: ago(86400) }),
    record({ id: "ocr_upq_l2", targetType: "lead", targetId: "l2", startTimeRaw: ago(30 * 60), maskedNumber: "****8000" }),
    record({ id: "ocr_upq_web", targetType: "prospect", targetId: "web_seed_1", startTimeRaw: ago(7 * 86400), establishedTimeRaw: "   ", contactDisposition: "Success" }),
    record({ id: "ocr_upq_deleted", targetType: "lead", targetId: "l_upq_deleted", startTimeRaw: ago(86400) }),
    record({ id: "ocr_upq_undated", targetType: "lead", targetId: "l_upq_undated", startTimeRaw: "not-a-time" }),
    record({ id: "ocr_upq_future", targetType: "lead", targetId: "l_upq_future", startTimeRaw: String(instant.getTime() + 3600 * 1000) }),
    record({ id: "ocr_upq_asia", teamId: "asia", targetType: "customer", targetId: "c_asia", startTimeRaw: ago(86400), maskedNumber: "不要出现" })
  );
  const leadsBefore = store.leads.length;
  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions);
  const callAuditsBefore = store.outboundCallAudits.length;
  const establishedBefore = store.outboundCallRecords.find((item) => item.id === "ocr_upq_c1")?.establishedTimeRaw;

  const mine = await request("/api/unanswered-pending-queue?scope=mine", shirley);
  assert.equal(mine.response.status, 200);
  assert.equal(mine.json.timeZone, "Asia/Shanghai");
  assert.equal(mine.json.scope, "mine");
  assert.equal(mine.json.empty, false);
  assert.equal("connectRate" in mine.json, false);
  assert.equal("totalCalls" in mine.json, false);
  const mineIds = mine.json.items.map((item: { targetId: string }) => item.targetId);
  assert.deepEqual(mineIds, ["c1", "web_seed_1", "l2", "l_upq_future", "l_upq_undated"]);
  const c1 = mine.json.items[0];
  assert.equal(c1.callRecordId, "ocr_upq_c1");
  assert.equal(c1.name, "Nordic Tools AB");
  assert.equal(c1.targetLabel, "客户");
  assert.equal(c1.unansweredAt, "2026-10-27 10:30");
  assert.equal(c1.ageLabel, "8天");
  assert.equal(c1.agentLabel, "Shirley坐席");
  assert.equal(String(c1.maskedNumber).includes("13800138000"), false);
  assert.equal(String(c1.maskedNumber).endsWith("8000"), true);
  const web = mine.json.items.find((item: { targetId: string }) => item.targetId === "web_seed_1");
  assert.equal(web.ageSeconds, 7 * 86400);
  assert.equal(web.ageLabel, "7天");
  const future = mine.json.items.find((item: { targetId: string }) => item.targetId === "l_upq_future");
  assert.equal(future.ageLabel, "0秒");
  const undated = mine.json.items.find((item: { targetId: string }) => item.targetId === "l_upq_undated");
  assert.equal(undated.ageSeconds, null);
  assert.equal(undated.ageLabel, "—");
  assert.equal(undated.unansweredAt, "");
  assert.equal(JSON.stringify(mine.json).includes("不要出现"), false);
  assert.equal(JSON.stringify(mine.json).includes("13800138000"), false);
  assert.equal(store.unansweredPendingQueueAudits.filter((item) => item.actorId === shirleyUser.id && item.result === "read").length, 1);

  const over = await request("/api/unanswered-pending-queue?scope=mine&age=over7", shirley);
  assert.deepEqual(over.json.items.map((item: { targetId: string }) => item.targetId), ["c1"]);
  const within = await request("/api/unanswered-pending-queue?scope=mine&age=within7", shirley);
  assert.deepEqual(within.json.items.map((item: { targetId: string }) => item.targetId), ["web_seed_1", "l2", "l_upq_future"]);

  const miaMine = await request("/api/unanswered-pending-queue?scope=mine", mia);
  assert.deepEqual(miaMine.json.items.map((item: { targetId: string }) => item.targetId), ["c3"]);
  assert.equal(miaMine.json.items[0].agentLabel, "Mia坐席");
  const miaTeam = await request("/api/unanswered-pending-queue?scope=team", mia);
  assert.equal(miaTeam.response.status, 403);
  assert.equal(miaTeam.json.items, undefined);
  assert.equal(store.unansweredPendingQueueAudits.some((item) => item.actorId === miaUser.id && item.scope === "team" && item.result === "rejected" && item.reason === "forbidden" && item.rowCount === 0), true);

  const team = await request("/api/unanswered-pending-queue?scope=team", alex);
  assert.equal(team.response.status, 200);
  const teamIds = team.json.items.map((item: { targetId: string }) => item.targetId);
  assert.equal(teamIds.includes("c1"), true);
  assert.equal(teamIds.includes("c3"), true);
  assert.equal(teamIds.includes("c4"), false);
  assert.equal(teamIds.includes("c2"), false);
  assert.equal(teamIds.includes("c5"), false);
  assert.equal(teamIds.includes("l_upq_deleted"), false);
  const adminTeam = await request("/api/unanswered-pending-queue?scope=team", admin);
  assert.equal(adminTeam.json.items.some((item: { targetId: string }) => item.targetId === "c4"), true);
  const alexMine = await request("/api/unanswered-pending-queue?scope=mine", alex);
  assert.equal(alexMine.response.status, 200);
  assert.equal(alexMine.json.empty, true);
  assert.deepEqual(alexMine.json.items, []);

  setTenantTimezoneOverride(store, "europe", "America/New_York");
  const ny = await request("/api/unanswered-pending-queue?scope=mine", shirley);
  const nyLead = ny.json.items.find((item: { targetId: string }) => item.targetId === "l2");
  assert.equal(nyLead.unansweredAt, "2026-11-03 21:00");
  assert.equal(nyLead.ageSeconds, 30 * 60);
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");

  const again = await request("/api/unanswered-pending-queue?scope=mine", shirley);
  assert.equal(store.unansweredPendingQueueAudits.filter((item) => item.actorId === shirleyUser.id && item.action === "read" && item.scope === "mine" && item.result === "read").length >= 2, true);
  assert.equal(again.json.items[0].targetId, "c1");

  const auditsAfterOk = store.unansweredPendingQueueAudits.length;
  const bad = await request("/api/unanswered-pending-queue?scope=all", shirley);
  assert.equal(bad.response.status, 400);
  const extra = await request("/api/unanswered-pending-queue?scope=mine&owner=mine", shirley);
  assert.equal(extra.response.status, 400);
  const badAge = await request("/api/unanswered-pending-queue?scope=mine&age=7", shirley);
  assert.equal(badAge.response.status, 400);
  const anon = await request("/api/unanswered-pending-queue?scope=mine", "");
  assert.equal(anon.response.status, 401);
  assert.equal(store.unansweredPendingQueueAudits.length, auditsAfterOk);
  const denied = await request("/api/unanswered-pending-queue?scope=mine", noRead);
  assert.equal(denied.response.status, 403);
  assert.equal(store.unansweredPendingQueueAudits.length, auditsAfterOk);

  const generated = await request("/api/outbound-call-records/ocr_upq_c1/next-follow-up", shirley, "POST", { nextFollowAt: "2026-11-05 09:00" });
  assert.equal(generated.response.status, 201);
  assert.equal(customer.nextReminder, "2026-11-05 09:00");
  const afterFollow = await request("/api/unanswered-pending-queue?scope=mine", shirley);
  assert.equal(afterFollow.json.items.some((item: { targetId: string }) => item.targetId === "c1"), false);
  const scheduled = await request("/api/outbound-call-records/ocr_upq_web/callback-schedule", shirley, "POST", { scheduledAt: "2026-11-06 10:00", note: "回拨" });
  assert.equal(scheduled.response.status, 200, JSON.stringify(scheduled.json));
  assert.equal(prospect.nextFollowAt || "", "");
  assert.equal(store.callbackSchedules.some((item) => item.targetType === "prospect" && item.targetId === "web_seed_1" && item.scheduledAt === "2026-11-06 10:00"), true);
  const afterSchedule = await request("/api/unanswered-pending-queue?scope=mine", shirley);
  assert.equal(afterSchedule.json.items.some((item: { targetId: string }) => item.targetId === "web_seed_1"), false);

  assert.equal(followed.nextReminder, keptReminder);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_upq_c1")?.establishedTimeRaw, establishedBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), false);
  assert.equal(aliyunHits, 0);
  const auditText = JSON.stringify(store.unansweredPendingQueueAudits);
  assert.equal(auditText.includes("13800138000"), false);
  assert.equal(auditText.includes("不要出现"), false);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("回拨"), false);
  assert.equal(outboundInstant().toISOString(), instant.toISOString());
  console.log("unanswered pending queue http tests passed");
} finally {
  setOutboundNowForTests(undefined);
  const store = getStore();
  setTenantTimezoneOverride(store, "europe", undefined);
  globalThis.fetch = originalFetch;
  server.close();
}
