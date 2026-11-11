import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { outboundInstant, setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { AliyunAgentMapping, OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start queue call glance test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

async function request(path: string, token = "") {
  const response = await originalFetch(`${baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
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

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "targetId">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    targetType: "customer",
    maskedNumber: "****8000",
    contactType: "OUTBOUND",
    contactDisposition: "NoAnswer",
    earlyMediaState: "",
    callDurationRaw: "",
    establishedTimeRaw: "",
    releaseTimeRaw: "",
    startTimeRaw: "",
    agentIds: "agent@ccc-glance-a",
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
  const shirley = await login("shirley@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const template = store.customers.find((item) => item.id === "c1");
  assert.ok(shirleyUser && miaUser && template);
  store.users.push({
    ...shirleyUser,
    id: "u_glance_no_read",
    name: "No Read",
    email: "no-glance-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    if (actor.id !== "u_glance_no_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };
  const noRead = await login("no-glance-read@keduoduo.com");
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
    mapping({ crmUserId: shirleyUser.id, cccUserId: "agent@ccc-glance-a", displayName: "Shirley坐席" }),
    mapping({ crmUserId: miaUser.id, cccUserId: "agent@ccc-glance-b", displayName: "Mia坐席" })
  );
  store.customers.push({
    ...template,
    id: "c_glance_own",
    company: "Own <Co>",
    ownerId: shirleyUser.id,
    teamId: "europe",
    poolStatus: "owned",
    phone: "+8613800138800",
    nextReminder: ""
  }, {
    ...template,
    id: "c_glance_other",
    company: "Other Owner",
    ownerId: miaUser.id,
    teamId: "europe",
    poolStatus: "owned",
    phone: "+8613800138811",
    nextReminder: ""
  }, {
    ...template,
    id: "c_glance_today",
    company: "Today Follow",
    ownerId: shirleyUser.id,
    teamId: "europe",
    poolStatus: "owned",
    phone: "+8613800138822",
    nextReminder: "2026-11-04 09:00"
  });
  const early = String(Date.parse("2026-11-04T01:00:00.000Z"));
  const late = String(Date.parse("2026-11-04T08:00:00.000Z"));
  const old = String(Date.parse("2026-11-02T02:00:00.000Z"));
  store.outboundCallRecords.push(
    record({ id: "ocr_glance_old", targetId: "c_glance_own", startTimeRaw: old, callOutcome: "无意向" }),
    record({ id: "ocr_glance_early", targetId: "c_glance_own", startTimeRaw: early, callOutcome: "有意向", establishedTimeRaw: "1", contactDisposition: "Success" }),
    record({ id: "ocr_glance_late", targetId: "c_glance_own", startTimeRaw: late, callOutcome: " 需回访 ", establishedTimeRaw: "1", contactDisposition: "Success" }),
    record({ id: "ocr_glance_hidden", targetId: "c_glance_own", startTimeRaw: String(Date.parse("2026-11-04T01:30:00.000Z")), callOutcome: "号码错误", agentIds: "agent@ccc-glance-b", establishedTimeRaw: "1", contactDisposition: "Success" }),
    record({ id: "ocr_glance_other", targetId: "c_glance_other", startTimeRaw: old, callOutcome: "无意向" }),
    record({ id: "ocr_glance_today", targetId: "c_glance_today", startTimeRaw: early, callOutcome: "有意向", establishedTimeRaw: "1", contactDisposition: "Success" })
  );
  const callsBefore = JSON.stringify(store.outboundCallRecords.map((item) => [item.id, item.callOutcome, item.establishedTimeRaw]));
  const auditsBefore = store.outboundCallAudits.length;
  const skipsBefore = store.sameDayCallSkips.length;
  const leadsBefore = store.leads.length;
  const queueAuditsBefore = (store.unansweredPendingQueueAudits || []).length;
  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions);

  const denied = await request("/api/unanswered-pending-queue?scope=mine", noRead);
  assert.equal(denied.response.status, 403);
  assert.equal(denied.text.includes("todayCallCount"), false);
  assert.equal(denied.text.includes("lastCallAt"), false);
  assert.equal(denied.text.includes("c_glance_own"), false);

  const teamDenied = await request("/api/unanswered-pending-queue?scope=team", shirley);
  assert.equal(teamDenied.response.status, 403);
  assert.equal(teamDenied.text.includes("todayCallCount"), false);
  assert.equal(teamDenied.text.includes("lastCallAt"), false);

  const mine = await request("/api/unanswered-pending-queue?scope=mine", shirley);
  assert.equal(mine.response.status, 200, JSON.stringify(mine.json));
  const own = mine.json.items.find((item: { targetId: string }) => item.targetId === "c_glance_own");
  const other = mine.json.items.find((item: { targetId: string }) => item.targetId === "c_glance_other");
  assert.ok(own && other);
  assert.equal(own.callRecordId, "ocr_glance_old");
  assert.equal(own.todayCallCount, 2);
  assert.equal(own.lastCallOutcome, "需回访");
  assert.equal(own.lastCallAt, "2026-11-04 16:00");
  assert.equal(own.unansweredAt, "2026-11-02 10:00");
  assert.equal("todayCallCount" in other, false);
  assert.equal("lastCallOutcome" in other, false);
  assert.equal("lastCallAt" in other, false);
  assert.equal(mine.text.includes("号码错误"), false);
  assert.equal(mine.text.includes("13800138800"), false);
  assert.equal((store.unansweredPendingQueueAudits || []).length, queueAuditsBefore + 2);

  const team = await request("/api/unanswered-pending-queue?scope=team", alex);
  assert.equal(team.response.status, 200, JSON.stringify(team.json));
  const teamOwn = team.json.items.find((item: { targetId: string }) => item.targetId === "c_glance_own");
  const teamOther = team.json.items.find((item: { targetId: string }) => item.targetId === "c_glance_other");
  assert.ok(teamOwn && teamOther);
  assert.equal(teamOwn.todayCallCount, 3);
  assert.equal(teamOwn.lastCallOutcome, "需回访");
  assert.equal(teamOwn.lastCallAt, "2026-11-04 16:00");
  assert.equal(teamOther.todayCallCount, 0);
  assert.equal(teamOther.lastCallOutcome, "无意向");
  assert.equal(teamOther.lastCallAt, "2026-11-02 10:00");

  setTenantTimezoneOverride(store, "europe", "America/New_York");
  const ny = await request("/api/unanswered-pending-queue?scope=mine", shirley);
  const nyOwn = ny.json.items.find((item: { targetId: string }) => item.targetId === "c_glance_own");
  assert.equal(nyOwn.todayCallCount, 1);
  assert.equal(nyOwn.lastCallOutcome, "需回访");
  assert.equal(nyOwn.lastCallAt, "2026-11-04 03:00");
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");

  const today = await request("/api/today-follow-next?scope=mine", shirley);
  assert.equal(today.response.status, 200, JSON.stringify(today.json));
  assert.equal(today.json.next?.targetId, "c_glance_today");
  assert.equal(today.json.next?.todayCallCount, 1);
  assert.equal(today.json.next?.lastCallOutcome, "有意向");
  assert.equal(today.json.next?.lastCallAt, "2026-11-04 09:00");
  assert.equal(String(today.json.next?.maskedNumber).includes("13800138822"), false);
  const todayDenied = await request("/api/today-follow-next?scope=mine", noRead);
  assert.equal(todayDenied.response.status, 403);
  assert.equal(todayDenied.text.includes("todayCallCount"), false);
  assert.equal(todayDenied.text.includes("lastCallAt"), false);

  assert.equal(JSON.stringify(store.outboundCallRecords.map((item) => [item.id, item.callOutcome, item.establishedTimeRaw])), callsBefore);
  assert.equal(store.outboundCallAudits.length, auditsBefore);
  assert.equal(store.sameDayCallSkips.length, skipsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(store.customers.find((item) => item.id === "c_glance_own")?.nextReminder, "");
  assert.equal(store.customers.find((item) => item.id === "c_glance_today")?.nextReminder, "2026-11-04 09:00");
  assert.equal((store.unansweredPendingQueueAudits || []).length, queueAuditsBefore + 4);
  const addedAudits = JSON.stringify((store.unansweredPendingQueueAudits || []).slice(0, 4));
  assert.equal(addedAudits.includes("lastCallAt"), false);
  assert.equal(addedAudits.includes("16:00"), false);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), false);
  assert.equal(aliyunHits, 0);
  assert.equal(outboundInstant().toISOString(), instant.toISOString());
  console.log("queue call glance http tests passed");
} finally {
  setOutboundNowForTests(undefined);
  const store = getStore();
  setTenantTimezoneOverride(store, "europe", undefined);
  globalThis.fetch = originalFetch;
  server.close();
}
