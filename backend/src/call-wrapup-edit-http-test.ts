import assert from "node:assert/strict";
import { setOutboundNowForTests } from "./outbound-call.js";
import { app } from "./server.js";
import { getStore } from "./store.js";
import type { CallRecordTag, CallTag, OutboundCallRecord, OutboundMissedFollowUp } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call wrapup edit test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

const startedAt = new Date("2026-11-01T00:00:00.000Z");
setOutboundNowForTests(startedAt);

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
    contactDisposition: "NoAnswer",
    earlyMediaState: "",
    callDurationRaw: "10",
    establishedTimeRaw: "1",
    releaseTimeRaw: String(Date.parse("2026-04-04T04:00:00.000Z")),
    startTimeRaw: String(Date.parse("2026-04-04T04:00:00.000Z")),
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/do-not-leak-edit",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "有意向",
    callOutcomeNote: "原标注",
    callNote: "",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

function tag(partial: Partial<CallTag> & Pick<CallTag, "id" | "name">): CallTag {
  return {
    teamId: "europe",
    enabled: true,
    createdBy: "u_admin",
    updatedBy: "u_admin",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    disabledAt: "",
    ...partial
  };
}

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const adminUser = store.users.find((item) => item.email === "admin@keduoduo.com");
  assert.ok(shirleyUser && miaUser && adminUser);
  store.users.push({
    ...shirleyUser,
    id: "u_edit_peer",
    name: "Edit Peer",
    email: "peer-edit@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_edit_asia",
    name: "Asia Edit",
    email: "asia-edit@keduoduo.com",
    role: "sales",
    teamId: "asia",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    if (actor.id !== "u_edit_peer") return snapshot;
    return { ...snapshot, permissions: { ...snapshot.permissions, "communication.read": ["tenant"] } };
  };

  const activitiesBefore = store.customerActivities.length;
  const leadActivitiesBefore = store.leadActivities.length;
  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const sequencesBefore = store.outreachSequences.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);

  store.aliyunAgentMappings.push(
    {
      id: "map_edit_shirley",
      teamId: "europe",
      crmUserId: shirleyUser.id,
      cccUserId: "agent@ccc-edit-a",
      loginName: "shirley",
      displayName: "Shirley坐席",
      extension: "8211",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_edit_mia",
      teamId: "europe",
      crmUserId: miaUser.id,
      cccUserId: "agent@ccc-edit-b",
      loginName: "mia",
      displayName: "Mia坐席",
      extension: "8212",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    }
  );
  store.callTags.push(
    tag({ id: "ctag_edit_on", name: "价格敏感" }),
    tag({ id: "ctag_edit_two", name: "要样品" }),
    tag({ id: "ctag_edit_off", name: "停用标签", enabled: false, disabledAt: "2026-04-02T00:00:00.000Z" })
  );
  const linked: CallRecordTag = {
    id: "crt_edit_off",
    teamId: "europe",
    callRecordId: "ocr_edit_a1",
    tagId: "ctag_edit_off",
    createdBy: adminUser.id,
    createdAt: "2026-04-02T00:00:00.000Z"
  };
  store.callRecordTags.push(linked);
  const missed: OutboundMissedFollowUp = {
    id: "omf_edit_a1",
    teamId: "europe",
    actorId: shirleyUser.id,
    at: "2026-04-04T00:00:00.000Z",
    callRecordId: "ocr_edit_a1",
    targetType: "customer",
    targetId: "c1",
    activityId: "act_edit_existing",
    nextFollowAt: "2026-11-01 09:00",
    suppressed: true
  };
  store.outboundMissedFollowUps.push(missed);
  store.outboundCallRecords.push(
    record({ id: "ocr_edit_a1", agentIds: "agent@ccc-edit-a" }),
    record({ id: "ocr_edit_roll", agentIds: "agent@ccc-edit-a", callNote: "回滚纪要", callNoteTags: "预算" }),
    record({ id: "ocr_edit_pending", agentIds: "agent@ccc-edit-a" }),
    record({ id: "ocr_edit_mia", agentIds: "agent@ccc-edit-b", callNote: "对方纪要不要出现" }),
    record({ id: "ocr_edit_asia", teamId: "asia", agentIds: "agent@ccc-edit-asia", callNote: "亚洲纪要不要出现" })
  );

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const peer = await login("peer-edit@keduoduo.com");

  const pendingBefore = await request("/api/call-wrapup-queue", shirley);
  assert.equal(pendingBefore.response.status, 200);
  assert.equal(JSON.stringify(pendingBefore.json).includes("ocr_edit_pending"), true);
  const notSubmitted = await request("/api/outbound-call-records/ocr_edit_pending/wrapup-edit", shirley, "POST", { note: "不该写上" });
  assert.equal(notSubmitted.response.status, 400);
  assert.equal(notSubmitted.json.reason, "not_submitted");
  assert.equal(store.callWrapupEditAudits.some((item) => item.callRecordId === "ocr_edit_pending"), false);
  const pendingAfter = await request("/api/call-wrapup-queue", shirley);
  assert.equal(JSON.stringify(pendingAfter.json).includes("ocr_edit_pending"), true);

  const empty = await request("/api/outbound-call-records/ocr_edit_a1/wrapup-edit", shirley, "POST", {});
  assert.equal(empty.response.status, 400);
  assert.equal(store.callWrapupEditAudits.length, 0);
  const queried = await request("/api/outbound-call-records/ocr_edit_a1/wrapup-edit?x=1", shirley, "POST", { note: "a" });
  assert.equal(queried.response.status, 400);
  assert.equal(store.callWrapupEditAudits.length, 0);

  const wrapBody = {
    outcome: { outcome: "需回访", note: "先记" },
    note: { note: "第一次纪要", tags: ["需求"] },
    callTag: { tagId: "ctag_edit_on", action: "add" }
  };
  const submitted = await request("/api/outbound-call-records/ocr_edit_a1/wrapup", shirley, "POST", wrapBody);
  assert.equal(submitted.response.status, 200, JSON.stringify(submitted.json));
  assert.equal(submitted.json.result, "updated");
  const rollSubmitted = await request("/api/outbound-call-records/ocr_edit_roll/wrapup", shirley, "POST", {
    outcome: { outcome: "需回访", note: "回滚前" }
  });
  assert.equal(rollSubmitted.response.status, 200, JSON.stringify(rollSubmitted.json));
  const wrapupsAfterSubmit = store.callWrapupAudits.filter((item) => item.callRecordId === "ocr_edit_a1" && item.result === "updated").length;
  assert.equal(wrapupsAfterSubmit, 1);

  const savedBody = {
    note: "改正后的纪要",
    outcome: { outcome: "无意向", note: "改备注" },
    callTags: [
      { tagId: "ctag_edit_on", action: "remove" },
      { tagId: "ctag_edit_two", action: "add" },
      { tagId: "ctag_edit_off", action: "remove" }
    ],
    nextFollowAt: "2026-11-02 10:15"
  };
  const saved = await request("/api/outbound-call-records/ocr_edit_a1/wrapup-edit", shirley, "POST", savedBody);
  assert.equal(saved.response.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.result, "updated");
  assert.equal(saved.json.wrapupEdit.edited, true);
  const row = store.outboundCallRecords.find((item) => item.id === "ocr_edit_a1");
  assert.equal(row?.callNote, "改正后的纪要");
  assert.equal(row?.callNoteTags, "需求");
  assert.equal(row?.callOutcome, "无意向");
  assert.equal(row?.callOutcomeNote, "改备注");
  assert.equal(row?.updatedAt, "2026-04-04T00:00:00.000Z");
  assert.equal(missed.nextFollowAt, "2026-11-02 10:15");
  assert.equal(missed.suppressed, true);
  assert.equal(missed.activityId, "act_edit_existing");
  assert.equal(store.customers.find((item) => item.id === "c1")?.nextReminder, "2026-11-02 10:15");
  const tagIds = store.callRecordTags.filter((item) => item.callRecordId === "ocr_edit_a1").map((item) => item.tagId).sort();
  assert.deepEqual(tagIds, ["ctag_edit_two"]);
  const editAudit = store.callWrapupEditAudits.find((item) => item.callRecordId === "ocr_edit_a1" && item.result === "updated");
  assert.ok(editAudit);
  const before = JSON.parse(editAudit.beforeJson);
  const after = JSON.parse(editAudit.afterJson);
  assert.equal(before.note, "第一次纪要");
  assert.equal(before.outcome, "需回访");
  assert.equal(before.outcomeNote, "先记");
  assert.deepEqual(before.tagIds, ["ctag_edit_off", "ctag_edit_on"]);
  assert.equal(before.nextFollowAt, "2026-11-01 09:00");
  assert.equal(after.note, "改正后的纪要");
  assert.equal(after.outcome, "无意向");
  assert.equal(after.outcomeNote, "改备注");
  assert.deepEqual(after.tagIds, ["ctag_edit_two"]);
  assert.equal(after.nextFollowAt, "2026-11-02 10:15");
  assert.equal(editAudit.beforeJson.includes("价格敏感"), false);
  assert.equal(editAudit.beforeJson.includes("do-not-leak-edit"), false);
  assert.equal(store.callWrapupAudits.filter((item) => item.callRecordId === "ocr_edit_a1" && item.result === "updated").length, wrapupsAfterSubmit);
  assert.equal(store.customerActivities.length, activitiesBefore);

  const same = await request("/api/outbound-call-records/ocr_edit_a1/wrapup-edit", shirley, "POST", savedBody);
  assert.equal(same.response.status, 200, JSON.stringify(same.json));
  assert.equal(same.json.result, "unchanged");
  assert.equal(store.callWrapupEditAudits.filter((item) => item.callRecordId === "ocr_edit_a1" && item.result === "updated").length, 1);

  const detail = await request("/api/outbound-call-records/ocr_edit_a1", shirley);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.json.wrapupEdit.edited, true);
  assert.equal(detail.json.wrapupEdit.editable, true);
  assert.equal(detail.json.wrapupEdit.history.length, 1);
  assert.equal(detail.json.wrapupEdit.history[0].before.note, "第一次纪要");
  assert.equal(detail.json.wrapupEdit.history[0].after.nextFollowAt, "2026-11-02 10:15");
  assert.equal(JSON.stringify(detail.json).includes("do-not-leak-edit"), false);

  const outcomeAuditsBeforeBoundary = store.callOutcomeAudits.filter((item) => item.callRecordId === "ocr_edit_a1").length;
  setOutboundNowForTests(new Date(startedAt.getTime() + 24 * 60 * 60 * 1000));
  const boundary = await request("/api/outbound-call-records/ocr_edit_a1/wrapup-edit", shirley, "POST", {
    outcome: { outcome: "其他", note: "刚好一天" }
  });
  assert.equal(boundary.response.status, 200, JSON.stringify(boundary.json));
  assert.equal(boundary.json.result, "updated");
  assert.equal(row?.callOutcome, "其他");

  setOutboundNowForTests(new Date(startedAt.getTime() + 24 * 60 * 60 * 1000 + 1));
  const closed = await request("/api/outbound-call-records/ocr_edit_a1/wrapup-edit", shirley, "POST", {
    note: "超时不该写上"
  });
  assert.equal(closed.response.status, 400);
  assert.equal(closed.json.reason, "window_closed");
  assert.equal(row?.callNote, "改正后的纪要");
  assert.equal(store.callOutcomeAudits.filter((item) => item.callRecordId === "ocr_edit_a1").length, outcomeAuditsBeforeBoundary + 1);
  const closedAudit = store.callWrapupEditAudits.find((item) => item.callRecordId === "ocr_edit_a1" && item.reason === "window_closed");
  assert.ok(closedAudit);
  assert.equal(JSON.parse(closedAudit.afterJson).note, "超时不该写上");
  assert.equal(JSON.parse(closedAudit.beforeJson).note, "改正后的纪要");
  assert.equal(closedAudit.beforeJson.includes("do-not-leak-edit"), false);

  const salesWindow = await request("/api/call-wrapup-edit-window", shirley, "PUT", { windowHours: 48 });
  assert.equal(salesWindow.response.status, 403);
  assert.equal(store.callWrapupEditWindows.some((item) => item.teamId === "europe"), false);
  const opened = await request("/api/call-wrapup-edit-window", admin, "PUT", { windowHours: 48 });
  assert.equal(opened.response.status, 200, JSON.stringify(opened.json));
  assert.equal(opened.json.windowHours, 48);
  const againWindow = await request("/api/call-wrapup-edit-window", alex, "PUT", { windowHours: 48 });
  assert.equal(againWindow.response.status, 200);
  assert.equal(againWindow.json.result, "unchanged");
  assert.equal(store.callWrapupEditWindows.filter((item) => item.teamId === "europe").length, 1);
  const reopened = await request("/api/outbound-call-records/ocr_edit_a1/wrapup-edit", shirley, "POST", { note: "窗口放宽后" });
  assert.equal(reopened.response.status, 200, JSON.stringify(reopened.json));
  assert.equal(row?.callNote, "窗口放宽后");

  const peerDenied = await request("/api/outbound-call-records/ocr_edit_a1/wrapup-edit", peer, "POST", { note: "同事不该改" });
  assert.equal(peerDenied.response.status, 403);
  assert.equal(peerDenied.json.reason, "not_owner");
  assert.equal(row?.callNote, "窗口放宽后");
  const peerAudit = store.callWrapupEditAudits.find((item) => item.actorId === "u_edit_peer" && item.reason === "not_owner");
  assert.ok(peerAudit);
  assert.equal(JSON.parse(peerAudit.beforeJson).note, "窗口放宽后");
  assert.equal(JSON.parse(peerAudit.afterJson).note, "同事不该改");
  assert.equal(peerAudit.beforeJson.includes("do-not-leak-edit"), false);

  const hidden = await request("/api/outbound-call-records/ocr_edit_mia/wrapup-edit", shirley, "POST", { note: "不该看见" });
  assert.equal(hidden.response.status, 403);
  assert.equal(hidden.json.reason, "forbidden");
  const hiddenAudit = store.callWrapupEditAudits.find((item) => item.actorId === shirleyUser.id && item.callRecordId === "ocr_edit_mia");
  assert.ok(hiddenAudit);
  assert.equal(hiddenAudit.beforeJson, "{}");
  assert.equal(hiddenAudit.afterJson, "{}");
  assert.equal(hiddenAudit.beforeJson.includes("对方纪要不要出现"), false);
  const foreign = await request("/api/outbound-call-records/ocr_edit_asia/wrapup-edit", shirley, "POST", { note: "不该看见" });
  assert.equal(foreign.response.status, 403);
  assert.equal(JSON.stringify(store.callWrapupEditAudits).includes("亚洲纪要不要出现"), false);

  const managerEdit = await request("/api/outbound-call-records/ocr_edit_a1/wrapup-edit", alex, "POST", { note: "主管改正" });
  assert.equal(managerEdit.response.status, 200, JSON.stringify(managerEdit.json));
  assert.equal(row?.callNote, "主管改正");

  const rollOutcome = store.outboundCallRecords.find((item) => item.id === "ocr_edit_roll");
  const editsBeforeDisabled = store.callWrapupEditAudits.length;
  const tagsBeforeDisabled = store.callTagAudits.length;
  const disabled = await request("/api/outbound-call-records/ocr_edit_roll/wrapup-edit", shirley, "POST", {
    outcome: { outcome: "号码错误", note: "不要留下" },
    callTags: [{ tagId: "ctag_edit_off", action: "add" }]
  });
  assert.equal(disabled.response.status, 400);
  assert.equal(disabled.json.reason, "disabled");
  assert.equal(rollOutcome?.callOutcome, "需回访");
  assert.equal(rollOutcome?.callOutcomeNote, "回滚前");
  assert.equal(store.callWrapupEditAudits.length, editsBeforeDisabled);
  assert.equal(store.callTagAudits.length, tagsBeforeDisabled);
  assert.equal(store.callRecordTags.some((item) => item.callRecordId === "ocr_edit_roll" && item.tagId === "ctag_edit_off"), false);

  const missing = await request("/api/outbound-call-records/ocr_edit_roll/wrapup-edit", shirley, "POST", {
    outcome: { outcome: "其他", note: "不要留下" },
    callTags: [{ tagId: "ctag_edit_missing", action: "add" }]
  });
  assert.equal(missing.response.status, 404);
  assert.equal(missing.json.reason, "not_found");
  assert.equal(rollOutcome?.callOutcome, "需回访");
  assert.equal(rollOutcome?.callOutcomeNote, "回滚前");
  assert.equal(store.callTagAudits.some((item) => item.callRecordId === "ocr_edit_roll" && item.reason === "not_found"), true);
  const missingEdit = store.callWrapupEditAudits.find((item) => item.callRecordId === "ocr_edit_roll" && item.reason === "not_found");
  assert.ok(missingEdit);
  assert.equal(JSON.parse(missingEdit.afterJson).outcome, "其他");
  assert.equal(JSON.parse(missingEdit.beforeJson).outcome, "需回访");
  assert.equal(missingEdit.afterJson.includes("不要留下"), true);
  assert.equal(rollOutcome?.callNote, "回滚纪要");

  assert.equal(aliyunHits, 0);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.leadActivities.length, leadActivitiesBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outreachSequences.length, sequencesBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  const auditText = JSON.stringify(store.callWrapupEditAudits);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("do-not-leak-edit"), false);
  assert.equal(auditText.includes("aliyuncs"), false);
  assert.equal(auditText.includes("价格敏感"), false);

  console.log("call wrapup edit http tests passed");
} finally {
  setOutboundNowForTests(undefined);
  const store = getStore();
  const customer = store.customers.find((item) => item.id === "c1");
  if (customer) customer.nextReminder = "已逾期";
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_edit_"));
  store.callOutcomeAudits = store.callOutcomeAudits.filter((item) => !item.callRecordId.startsWith("ocr_edit_"));
  store.callNoteAudits = store.callNoteAudits.filter((item) => !item.callRecordId.startsWith("ocr_edit_"));
  store.callTagAudits = store.callTagAudits.filter((item) => !item.callRecordId.startsWith("ocr_edit_") && !item.tagId.startsWith("ctag_edit_"));
  store.callRecordTags = store.callRecordTags.filter((item) => !item.callRecordId.startsWith("ocr_edit_") && !item.tagId.startsWith("ctag_edit_"));
  store.callTags = store.callTags.filter((item) => !item.id.startsWith("ctag_edit_"));
  store.callWrapupAudits = store.callWrapupAudits.filter((item) => !item.callRecordId.startsWith("ocr_edit_"));
  store.callWrapupEditAudits = store.callWrapupEditAudits.filter((item) => !item.callRecordId.startsWith("ocr_edit_"));
  store.callWrapupEditWindows = store.callWrapupEditWindows.filter((item) => item.teamId !== "europe");
  store.outboundMissedFollowUps = store.outboundMissedFollowUps.filter((item) => item.id !== "omf_edit_a1");
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_edit_"));
  store.users = store.users.filter((item) => item.id !== "u_edit_peer" && item.id !== "u_edit_asia");
  globalThis.fetch = originalFetch;
  server.close();
}
