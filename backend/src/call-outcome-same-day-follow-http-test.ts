import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { AliyunAgentMapping, OutboundCallRecord, SameDayCallSkip } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start same day follow test server");
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
    startTimeRaw: "2000",
    agentIds: "agent@ccc-sdf-a",
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
let windowStartBefore: string | undefined;
let windowEndBefore: string | undefined;
let createdWindowConfig = false;
let originalSnapshot: typeof storeForCleanup.getIamCapabilitySnapshot;
const savedReminders = new Map<string, string>();
const savedLeadFollows = new Map<string, string>();
const savedProspectFollows = new Map<string, string>();

try {
  const store = storeForCleanup;
  setOutboundNowForTests(new Date("2026-11-04T02:00:00.000Z"));
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  const shirley = await login("shirley@keduoduo.com");
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  assert.ok(shirleyUser);
  store.users.push({
    ...shirleyUser,
    id: "u_sdf_no_read",
    name: "No Read",
    email: "no-sdf-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_sdf_no_update",
    name: "No Update",
    email: "no-sdf-update@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_sdf_no_read" && actor.id !== "u_sdf_no_update") return snapshot;
    const permissions = { ...snapshot.permissions };
    if (actor.id === "u_sdf_no_read") delete permissions["communication.read"];
    if (actor.id === "u_sdf_no_update") delete permissions["customer.update"];
    return { ...snapshot, permissions };
  };
  const noRead = await login("no-sdf-read@keduoduo.com");
  const noUpdate = await login("no-sdf-update@keduoduo.com");
  const mapping = (partial: Partial<AliyunAgentMapping> & Pick<AliyunAgentMapping, "crmUserId" | "cccUserId">): AliyunAgentMapping => ({
    id: `map_sdf_${partial.cccUserId}`,
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
    mapping({ crmUserId: shirleyUser.id, cccUserId: "agent@ccc-sdf-a", displayName: "Shirley坐席" }),
    mapping({ crmUserId: "u_sdf_no_update", cccUserId: "agent@ccc-sdf-noupdate", displayName: "No Update坐席" })
  );
  const customerTemplate = store.customers.find((item) => item.id === "c1" && item.teamId === "europe");
  const leadTemplate = store.leads.find((item) => item.id === "l1" && item.teamId === "europe");
  assert.ok(customerTemplate && leadTemplate);
  for (const item of store.customers) savedReminders.set(item.id, item.nextReminder || "");
  for (const item of store.leads) savedLeadFollows.set(item.id, item.nextFollowAt || "");
  for (const item of store.websiteOpportunities) savedProspectFollows.set(item.id, item.nextFollowAt || "");
  for (const item of store.customers) item.nextReminder = "";
  for (const item of store.leads) item.nextFollowAt = "";
  for (const item of store.websiteOpportunities) item.nextFollowAt = "";
  const activitiesBefore = store.customerActivities.length;
  const leadActivitiesBefore = store.leadActivities.length;
  const leadsBefore = store.leads.length;
  const callsBefore = store.outboundCallAudits.length;
  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions);
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  let europeConfig = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe");
  windowStartBefore = europeConfig?.callWindowStart;
  windowEndBefore = europeConfig?.callWindowEnd;
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
  europeConfig.callWindowStart = "09:00";
  europeConfig.callWindowEnd = "20:00";
  store.customers.push({
    ...customerTemplate,
    id: "c_sdf_open",
    company: "当天再跟",
    teamId: "europe",
    ownerId: shirleyUser.id,
    phone: "+8613800138000",
    nextReminder: "",
    poolStatus: "owned"
  }, {
    ...customerTemplate,
    id: "c_sdf_paused",
    company: "暂停中",
    teamId: "europe",
    ownerId: shirleyUser.id,
    phone: "+8613800138111",
    nextReminder: "2026-11-04 11:00",
    poolStatus: "owned"
  }, {
    ...customerTemplate,
    id: "c_sdf_locked",
    company: "无权",
    teamId: "europe",
    ownerId: "u_sdf_no_update",
    phone: "+8613800138222",
    nextReminder: "保持无权",
    poolStatus: "owned"
  });
  store.leads.push({
    ...leadTemplate,
    id: "l_sdf_ok",
    company: "当天线索",
    teamId: "europe",
    ownerId: shirleyUser.id,
    phone: "+8613700001111",
    nextFollowAt: "",
    deletedAt: ""
  });
  const leadStatusBefore = store.leads.find((item) => item.id === "l_sdf_ok")?.status;
  const skip: SameDayCallSkip = {
    id: "skip_sdf_paused",
    teamId: "europe",
    targetType: "customer",
    targetId: "c_sdf_paused",
    skipOn: "2026-11-04",
    resumeOn: "2026-11-20",
    reason: "asked_later",
    note: "暂停备注不要出现",
    active: true,
    actorId: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z"
  };
  store.sameDayCallSkips.push(skip);
  store.outboundCallRecords.push(
    record({ id: "ocr_sdf_open", targetType: "customer", targetId: "c_sdf_open" }),
    record({ id: "ocr_sdf_blank", targetType: "customer", targetId: "c_sdf_open", establishedTimeRaw: "   " }),
    record({ id: "ocr_sdf_success", targetType: "customer", targetId: "c_sdf_open", establishedTimeRaw: "", contactDisposition: "Success" }),
    record({ id: "ocr_sdf_connected", targetType: "customer", targetId: "c_sdf_open", establishedTimeRaw: "1", contactDisposition: "Success" }),
    record({ id: "ocr_sdf_paused", targetType: "customer", targetId: "c_sdf_paused" }),
    record({ id: "ocr_sdf_lead", targetType: "lead", targetId: "l_sdf_ok" }),
    record({ id: "ocr_sdf_locked", targetType: "customer", targetId: "c_sdf_locked", agentIds: "agent@ccc-sdf-noupdate" })
  );

  async function queueIds(token: string) {
    const ids: string[] = [];
    let after = "";
    for (let i = 0; i < 30; i += 1) {
      const path = after ? `/api/today-follow-next?scope=mine&${after}` : "/api/today-follow-next?scope=mine";
      const step = await request(path, token);
      assert.equal(step.response.status, 200, step.text);
      const next = step.json.next as { targetType?: string; targetId?: string; maskedNumber?: string } | null;
      if (!next?.targetId) break;
      ids.push(`${next.targetType}:${next.targetId}`);
      assert.equal(JSON.stringify(next).includes("13800138000"), false);
      assert.equal(JSON.stringify(next).includes("暂停备注不要出现"), false);
      assert.equal(JSON.stringify(next).includes("do-not-leak"), false);
      after = `afterType=${encodeURIComponent(next.targetType || "")}&afterId=${encodeURIComponent(next.targetId)}`;
    }
    return ids;
  }

  const before = await queueIds(shirley);
  assert.equal(before.includes("customer:c_sdf_paused"), false);
  assert.equal(before.includes("customer:c_sdf_open"), false);

  const saved = await request("/api/outbound-call-records/ocr_sdf_open/outcome", shirley, "POST", {
    outcome: "其他",
    note: "  稍后再打  ",
    nextFollowChoice: "plus2h"
  });
  assert.equal(saved.response.status, 200, saved.text);
  assert.equal(saved.json.result, "updated");
  assert.equal(saved.json.nextFollowChoice, "plus2h");
  assert.equal(saved.json.nextFollowAt, "2026-11-04 12:00");
  assert.equal(saved.json.nextFollowResult, "updated");
  assert.equal(store.customers.find((item) => item.id === "c_sdf_open")?.nextReminder, "2026-11-04 12:00");
  assert.equal(JSON.stringify(saved.json).includes("13800138000"), false);
  assert.equal(JSON.stringify(saved.json).includes("do-not-leak"), false);
  const followAudit = store.nextFollowUpAudits.find((item) => item.callRecordId === "ocr_sdf_open");
  assert.equal(followAudit?.action, "set_next_follow_up");
  assert.equal(followAudit?.newValue, "2026-11-04 12:00");
  assert.equal(followAudit?.objectType, "customer");
  const afterSave = await queueIds(shirley);
  assert.equal(afterSave.includes("customer:c_sdf_open"), true);
  assert.equal(afterSave.includes("customer:c_sdf_paused"), false);

  const again = await request("/api/outbound-call-records/ocr_sdf_open/outcome", shirley, "POST", {
    outcome: "其他",
    note: "稍后再打",
    nextFollowChoice: "2 小时后"
  });
  assert.equal(again.response.status, 200, again.text);
  assert.equal(again.json.result, "unchanged");
  assert.equal(store.nextFollowUpAudits.filter((item) => item.callRecordId === "ocr_sdf_open" && item.action === "set_next_follow_up").length, 1);

  const openSkip: SameDayCallSkip = {
    id: "skip_sdf_open",
    teamId: "europe",
    targetType: "customer",
    targetId: "c_sdf_open",
    skipOn: "2026-11-04",
    resumeOn: "2026-11-20",
    reason: "wrong_time",
    note: "先暂停",
    active: true,
    actorId: shirleyUser.id,
    updatedAt: "2026-11-04T01:00:00.000Z"
  };
  store.sameDayCallSkips.push(openSkip);
  const pausedQueue = await queueIds(shirley);
  assert.equal(pausedQueue.includes("customer:c_sdf_open"), false);
  assert.equal(store.customers.find((item) => item.id === "c_sdf_open")?.nextReminder, "2026-11-04 12:00");
  assert.equal(store.sameDayCallSkips.find((item) => item.id === "skip_sdf_open")?.resumeOn, "2026-11-20");

  const pausedSave = await request("/api/outbound-call-records/ocr_sdf_paused/outcome", shirley, "POST", {
    outcome: "需回访",
    nextFollowChoice: "plus4h"
  });
  assert.equal(pausedSave.response.status, 200, pausedSave.text);
  assert.equal(pausedSave.json.nextFollowAt, "2026-11-04 14:00");
  assert.equal(store.customers.find((item) => item.id === "c_sdf_paused")?.nextReminder, "2026-11-04 14:00");
  assert.equal(store.sameDayCallSkips.find((item) => item.id === "skip_sdf_paused")?.resumeOn, "2026-11-20");
  assert.equal(store.sameDayCallSkips.find((item) => item.id === "skip_sdf_paused")?.skipOn, "2026-11-04");
  const stillPaused = await queueIds(shirley);
  assert.equal(stillPaused.includes("customer:c_sdf_paused"), false);
  assert.equal(store.outboundCallAudits.length, callsBefore);

  const connected = await request("/api/outbound-call-records/ocr_sdf_connected/outcome", shirley, "POST", {
    outcome: "有意向",
    nextFollowChoice: "plus2h"
  });
  assert.equal(connected.response.status, 400, connected.text);
  assert.equal(connected.json.reason, "not_unanswered");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_sdf_connected")?.callOutcome || "", "");
  assert.equal(store.nextFollowUpAudits.some((item) => item.callRecordId === "ocr_sdf_connected"), false);
  assert.equal(store.customers.find((item) => item.id === "c_sdf_open")?.nextReminder, "2026-11-04 12:00");

  store.sameDayCallSkips = store.sameDayCallSkips.filter((item) => item.id !== "skip_sdf_open");
  const blank = await request("/api/outbound-call-records/ocr_sdf_blank/outcome", shirley, "POST", {
    outcome: "其他",
    note: "稍后再打",
    nextFollowChoice: "4 小时后"
  });
  assert.equal(blank.response.status, 200, blank.text);
  assert.equal(blank.json.nextFollowAt, "2026-11-04 14:00");
  const successOnly = await request("/api/outbound-call-records/ocr_sdf_success/outcome", shirley, "POST", {
    outcome: "其他",
    note: "稍后再打",
    nextFollowChoice: "plus4h"
  });
  assert.equal(successOnly.response.status, 200, successOnly.text);
  assert.equal(successOnly.json.nextFollowAt, "2026-11-04 14:00");
  assert.equal(successOnly.json.nextFollowResult, "unchanged");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_sdf_success")?.contactDisposition, "Success");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_sdf_success")?.establishedTimeRaw, "");

  const leadSaved = await request("/api/outbound-call-records/ocr_sdf_lead/outcome", shirley, "POST", {
    outcome: "需回访",
    nextFollowChoice: "plus4h"
  });
  assert.equal(leadSaved.response.status, 200, leadSaved.text);
  assert.equal(leadSaved.json.nextFollowAt, "2026-11-04 14:00");
  assert.equal(store.leads.find((item) => item.id === "l_sdf_ok")?.nextFollowAt, "2026-11-04 14:00");
  assert.equal(store.leads.find((item) => item.id === "l_sdf_ok")?.status, leadStatusBefore);
  assert.equal(store.nextFollowUpAudits.find((item) => item.callRecordId === "ocr_sdf_lead")?.objectType, "lead");
  const withLead = await queueIds(shirley);
  assert.equal(withLead.includes("lead:l_sdf_ok"), true);

  setOutboundNowForTests(new Date("2026-11-04T10:30:00.000Z"));
  const bumped = await request("/api/outbound-call-records/ocr_sdf_lead/outcome", shirley, "POST", {
    outcome: "需回访",
    nextFollowChoice: "plus2h"
  });
  assert.equal(bumped.response.status, 200, bumped.text);
  assert.equal(bumped.json.nextFollowAt, "2026-11-05 09:00");
  const notToday = await queueIds(shirley);
  assert.equal(notToday.includes("lead:l_sdf_ok"), false);

  const denied = await request("/api/outbound-call-records/ocr_sdf_locked/outcome", noUpdate, "POST", {
    outcome: "其他",
    nextFollowChoice: "plus2h"
  });
  assert.equal(denied.response.status, 403, denied.text);
  assert.equal(denied.json.reason, "forbidden");
  assert.equal(store.customers.find((item) => item.id === "c_sdf_locked")?.nextReminder, "保持无权");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_sdf_locked")?.callOutcome || "", "");
  assert.equal(store.nextFollowUpAudits.some((item) => item.callRecordId === "ocr_sdf_locked" && item.action === "reject_forbidden"), true);

  const followAuditsBeforeHidden = store.nextFollowUpAudits.length;
  const hidden = await request("/api/outbound-call-records/ocr_sdf_open/outcome", noRead, "POST", {
    outcome: "其他",
    nextFollowChoice: "plus2h"
  });
  assert.equal(hidden.response.status, 403, hidden.text);
  assert.equal(store.nextFollowUpAudits.length, followAuditsBeforeHidden);
  const anon = await request("/api/outbound-call-records/ocr_sdf_open/outcome", "", "POST", {
    outcome: "其他",
    nextFollowChoice: "plus2h"
  });
  assert.equal(anon.response.status, 401);
  assert.equal(store.nextFollowUpAudits.length, followAuditsBeforeHidden);

  const bad = await request("/api/outbound-call-records/ocr_sdf_open/outcome", shirley, "POST", {
    outcome: "其他",
    nextFollowChoice: "2小时"
  });
  assert.equal(bad.response.status, 400);
  assert.equal(bad.json.reason, "invalid_next_follow");
  const rawTime = await request("/api/outbound-call-records/ocr_sdf_open/outcome", shirley, "POST", {
    outcome: "其他",
    nextFollowAt: "2026-11-04 12:00",
    nextFollowChoice: "plus2h"
  });
  assert.equal(rawTime.response.status, 400);
  assert.equal(rawTime.json.reason, "invalid_request");
  const batch = await request("/api/unlabeled-connected-calls/label", shirley, "POST", {
    callRecordIds: ["ocr_sdf_connected"],
    outcome: "其他",
    nextFollowChoice: "plus2h"
  });
  assert.equal(batch.response.status, 400);

  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.leadActivities.length, leadActivitiesBefore);
  assert.equal(store.leads.length, leadsBefore + 1);
  assert.equal(store.outboundCallAudits.length, callsBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  assert.equal(aliyunHits, 0);
  assert.equal(JSON.stringify(store.nextFollowUpAudits.filter((item) => (item.callRecordId || "").startsWith("ocr_sdf_"))).includes("do-not-leak"), false);
  console.log("call outcome same day follow http tests passed");
} finally {
  setOutboundNowForTests(undefined);
  const store = storeForCleanup;
  setTenantTimezoneOverride(store, "europe", undefined);
  const europeConfig = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe");
  if (createdWindowConfig) {
    store.aliyunOutboundConfigs = store.aliyunOutboundConfigs.filter((item) => item !== europeConfig);
  } else if (europeConfig) {
    if (windowStartBefore !== undefined) europeConfig.callWindowStart = windowStartBefore;
    if (windowEndBefore !== undefined) europeConfig.callWindowEnd = windowEndBefore;
  }
  if (originalSnapshot) store.getIamCapabilitySnapshot = originalSnapshot;
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_sdf_"));
  store.callOutcomeAudits = store.callOutcomeAudits.filter((item) => !item.callRecordId.startsWith("ocr_sdf_"));
  store.nextFollowUpAudits = store.nextFollowUpAudits.filter((item) => !(item.callRecordId || "").startsWith("ocr_sdf_"));
  store.sameDayCallSkips = store.sameDayCallSkips.filter((item) => !item.id.startsWith("skip_sdf_"));
  store.customers = store.customers.filter((item) => !item.id.startsWith("c_sdf_"));
  store.leads = store.leads.filter((item) => !item.id.startsWith("l_sdf_"));
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_sdf_"));
  store.users = store.users.filter((item) => item.id !== "u_sdf_no_read" && item.id !== "u_sdf_no_update");
  for (const item of store.customers) {
    if (savedReminders.has(item.id)) item.nextReminder = savedReminders.get(item.id) || "";
  }
  for (const item of store.leads) {
    if (savedLeadFollows.has(item.id)) item.nextFollowAt = savedLeadFollows.get(item.id) || "";
  }
  for (const item of store.websiteOpportunities) {
    if (savedProspectFollows.has(item.id)) item.nextFollowAt = savedProspectFollows.get(item.id) || "";
  }
  globalThis.fetch = originalFetch;
  server.close();
}
