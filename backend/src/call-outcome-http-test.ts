import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { CALL_OUTCOME_NOTE_MAX } from "./outbound-call-records.js";
import type { OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call outcome test server");
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
    releaseTimeRaw: "",
    startTimeRaw: String(Date.parse("2026-04-04T04:00:00.000Z")),
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/do-not-leak-outcome",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "",
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
    id: "u_no_outcome_read",
    name: "No Outcome Read",
    email: "no-outcome-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_outcome_asia",
    name: "Asia Outcome",
    email: "asia-outcome@keduoduo.com",
    role: "sales",
    teamId: "asia",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_no_outcome_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };

  const reminderBefore = store.customers.find((item) => item.id === "c1")?.nextReminder;
  const activitiesBefore = store.customerActivities.length;
  const leadActivitiesBefore = store.leadActivities.length;
  const followAuditsBefore = store.followUpAudits.length;
  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const sequencesBefore = store.outreachSequences.length;
  const plansBefore = store.prospectOutreachPlans.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const missedBefore = store.outboundMissedFollowUps.length;
  const missedAuditsBefore = store.outboundMissedFollowUpAudits.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);

  store.aliyunAgentMappings.push(
    {
      id: "map_outcome_shirley",
      teamId: "europe",
      crmUserId: shirleyUser.id,
      cccUserId: "agent@ccc-outcome-a",
      loginName: "shirley",
      displayName: "Shirley坐席",
      extension: "8101",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_outcome_mia",
      teamId: "europe",
      crmUserId: miaUser.id,
      cccUserId: "agent@ccc-outcome-b",
      loginName: "mia",
      displayName: "Mia坐席",
      extension: "8102",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_outcome_asia",
      teamId: "asia",
      crmUserId: "u_outcome_asia",
      cccUserId: "agent@ccc-outcome-asia",
      loginName: "asia",
      displayName: "亚洲坐席",
      extension: "8103",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    }
  );
  store.outboundCallRecords.push(
    record({ id: "ocr_out_a1", agentIds: "agent@ccc-outcome-a", callDurationRaw: "10", establishedTimeRaw: "1" }),
    record({ id: "ocr_out_a2", agentIds: "agent@ccc-outcome-a", callDurationRaw: "10", establishedTimeRaw: "1" }),
    record({ id: "ocr_out_a3", agentIds: "agent@ccc-outcome-a", callDurationRaw: "99", establishedTimeRaw: "" }),
    record({ id: "ocr_out_a4", agentIds: "agent@ccc-outcome-a", callDurationRaw: "20", establishedTimeRaw: "1" }),
    record({ id: "ocr_out_mia", agentIds: "agent@ccc-outcome-b", callDurationRaw: "30", establishedTimeRaw: "1" }),
    record({ id: "ocr_out_none", agentIds: "", callDurationRaw: "4", establishedTimeRaw: "1" }),
    record({ id: "ocr_out_asia", teamId: "asia", agentIds: "agent@ccc-outcome-asia", callDurationRaw: "8", establishedTimeRaw: "1" })
  );

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const noRead = await login("no-outcome-read@keduoduo.com");
  const asia = await login("asia-outcome@keduoduo.com");

  const denied = await request("/api/outbound-call-records/ocr_out_a1/outcome", noRead, "POST", { outcome: "有意向" });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.permissionCode, "communication.read");
  assert.equal(store.callOutcomeAudits.length, 0);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_out_a1")?.callOutcome, "");

  const anonymous = await request("/api/outbound-call-records/ocr_out_a1/outcome", "", "POST", { outcome: "有意向" });
  assert.equal(anonymous.response.status, 401);

  const badEnum = await request("/api/outbound-call-records/ocr_out_a1/outcome", shirley, "POST", { outcome: "有兴趣" });
  assert.equal(badEnum.response.status, 400);
  assert.equal(badEnum.json.reason, "invalid_outcome");
  const successEnum = await request("/api/outbound-call-records/ocr_out_a1/outcome", shirley, "POST", { outcome: "Success" });
  assert.equal(successEnum.response.status, 400);
  assert.equal(successEnum.json.reason, "invalid_outcome");
  assert.equal(store.callOutcomeAudits.length, 0);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_out_a1")?.callOutcome, "");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_out_a1")?.contactDisposition, "NoAnswer");

  const tooLong = await request("/api/outbound-call-records/ocr_out_a1/outcome", shirley, "POST", {
    outcome: "有意向",
    note: "字".repeat(CALL_OUTCOME_NOTE_MAX + 1)
  });
  assert.equal(tooLong.response.status, 400);
  assert.equal(tooLong.json.reason, "note_too_long");
  assert.equal(store.callOutcomeAudits.length, 0);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_out_a1")?.callOutcomeNote, "");

  const badNote = await request("/api/outbound-call-records/ocr_out_a1/outcome", shirley, "POST", { outcome: "有意向", note: 12 });
  assert.equal(badNote.response.status, 400);
  assert.equal(badNote.json.reason, "invalid_note");
  const batch = await request("/api/outbound-call-records/ocr_out_a1/outcome", shirley, "POST", { outcome: "有意向", records: ["ocr_out_a1"] });
  assert.equal(batch.response.status, 400);
  assert.equal(batch.json.reason, "invalid_request");
  const batchList = await request("/api/outbound-call-records/ocr_out_a1/outcome", shirley, "POST", ["有意向"]);
  assert.equal(batchList.response.status, 400);
  assert.equal(store.callOutcomeAudits.length, 0);

  const created = await request("/api/outbound-call-records/ocr_out_a1/outcome", shirley, "POST", {
    outcome: "有意向",
    note: "  想要样品  "
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.json.result, "updated");
  assert.equal(created.json.outcome, "有意向");
  assert.equal(created.json.note, "想要样品");
  assert.equal(JSON.stringify(created.json).includes("do-not-leak-outcome"), false);
  const first = store.callOutcomeAudits.find((item) => item.callRecordId === "ocr_out_a1");
  assert.equal(first?.actorId, shirleyUser.id);
  assert.equal(first?.teamId, "europe");
  assert.equal(first?.previousOutcome, "");
  assert.equal(first?.previousNote, "");
  assert.equal(first?.nextOutcome, "有意向");
  assert.equal(first?.nextNote, "想要样品");
  assert.match(first?.at || "", /T/);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_out_a1")?.contactDisposition, "NoAnswer");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_out_a1")?.establishedTimeRaw, "1");

  const same = await request("/api/outbound-call-records/ocr_out_a1/outcome", shirley, "POST", { outcome: "有意向", note: "想要样品" });
  assert.equal(same.response.status, 200);
  assert.equal(same.json.result, "unchanged");
  assert.equal(store.callOutcomeAudits.filter((item) => item.callRecordId === "ocr_out_a1").length, 1);

  const noteOnly = await request("/api/outbound-call-records/ocr_out_a1/outcome", shirley, "POST", { outcome: "有意向", note: "改备注" });
  assert.equal(noteOnly.response.status, 200);
  assert.equal(noteOnly.json.result, "updated");
  const noteAudit = store.callOutcomeAudits.find((item) => item.callRecordId === "ocr_out_a1" && item.nextNote === "改备注");
  assert.equal(noteAudit?.previousOutcome, "有意向");
  assert.equal(noteAudit?.nextOutcome, "有意向");
  assert.equal(noteAudit?.previousNote, "想要样品");
  assert.equal(noteAudit?.actorId, shirleyUser.id);

  const changed = await request("/api/outbound-call-records/ocr_out_a1/outcome", shirley, "POST", { outcome: "无意向", note: "改备注" });
  assert.equal(changed.response.status, 200);
  const changeAudit = store.callOutcomeAudits.find((item) => item.callRecordId === "ocr_out_a1" && item.nextOutcome === "无意向");
  assert.equal(changeAudit?.previousOutcome, "有意向");
  assert.equal(changeAudit?.previousNote, "改备注");
  assert.equal(changeAudit?.nextOutcome, "无意向");
  assert.equal(changeAudit?.nextNote, "改备注");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_out_a1")?.callOutcome, "无意向");

  const longNote = "字".repeat(CALL_OUTCOME_NOTE_MAX);
  const capped = await request("/api/outbound-call-records/ocr_out_a2/outcome", shirley, "POST", { outcome: "其他", note: ` ${longNote} ` });
  assert.equal(capped.response.status, 200);
  assert.equal(capped.json.note, longNote);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_out_a2")?.callOutcomeNote, longNote);
  const cleared = await request("/api/outbound-call-records/ocr_out_a2/outcome", shirley, "POST", { outcome: "有意向", note: "" });
  assert.equal(cleared.response.status, 200);
  const clearAudit = store.callOutcomeAudits.find((item) => item.callRecordId === "ocr_out_a2" && item.nextOutcome === "有意向");
  assert.equal(clearAudit?.previousOutcome, "其他");
  assert.equal(clearAudit?.previousNote, longNote);
  assert.equal(clearAudit?.nextNote, "");

  const fourth = await request("/api/outbound-call-records/ocr_out_a4/outcome", shirley, "POST", { outcome: "有意向", note: "  第二条  " });
  assert.equal(fourth.response.status, 200);
  assert.equal(fourth.json.note, "第二条");

  const each = await request("/api/outbound-call-records/ocr_out_a3/outcome", shirley, "POST", { outcome: "需回访", note: "   " });
  assert.equal(each.response.status, 200);
  assert.equal(each.json.note, "");
  const wrongNumber = await request("/api/outbound-call-records/ocr_out_a3/outcome", shirley, "POST", { outcome: "号码错误" });
  assert.equal(wrongNumber.response.status, 200);
  const other = await request("/api/outbound-call-records/ocr_out_a3/outcome", shirley, "POST", { outcome: "其他", note: "" });
  assert.equal(other.response.status, 200);
  const backToBlankIntent = await request("/api/outbound-call-records/ocr_out_a3/outcome", shirley, "POST", { outcome: "需回访", note: "" });
  assert.equal(backToBlankIntent.json.result, "updated");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_out_a3")?.callOutcome, "需回访");

  const hiddenSeat = await request("/api/outbound-call-records/ocr_out_mia/outcome", shirley, "POST", { outcome: "有意向" });
  assert.equal(hiddenSeat.response.status, 404);
  assert.equal(hiddenSeat.json.reason, "not_found");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_out_mia")?.callOutcome, "");
  const auditsAfterHidden = store.callOutcomeAudits.length;

  const manager = await request("/api/outbound-call-records/ocr_out_mia/outcome", alex, "POST", { outcome: "号码错误", note: "空号" });
  assert.equal(manager.response.status, 200);
  assert.equal(manager.json.result, "updated");
  const managerAudit = store.callOutcomeAudits.find((item) => item.callRecordId === "ocr_out_mia");
  assert.equal(managerAudit?.actorId, "u_manager_alex");
  assert.equal(managerAudit?.previousOutcome, "");
  assert.equal(managerAudit?.nextOutcome, "号码错误");
  assert.equal(managerAudit?.nextNote, "空号");
  assert.equal(store.callOutcomeAudits.length, auditsAfterHidden + 1);

  const miaDenied = await request("/api/outbound-call-records/ocr_out_a1/outcome", mia, "POST", { outcome: "其他" });
  assert.equal(miaDenied.response.status, 404);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_out_a1")?.callOutcome, "无意向");

  const unmapped = await request("/api/outbound-call-records/ocr_out_none/outcome", shirley, "POST", { outcome: "其他" });
  assert.equal(unmapped.response.status, 404);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_out_none")?.callOutcome, "");
  const adminLabel = await request("/api/outbound-call-records/ocr_out_none/outcome", admin, "POST", { outcome: "其他", note: "没有坐席" });
  assert.equal(adminLabel.response.status, 200);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_out_none")?.callOutcome, "其他");
  const adminAudit = store.callOutcomeAudits.find((item) => item.callRecordId === "ocr_out_none");
  assert.equal(adminAudit?.previousOutcome, "");
  assert.equal(adminAudit?.nextOutcome, "其他");

  const foreign = await request("/api/outbound-call-records/ocr_out_asia/outcome", shirley, "POST", { outcome: "有意向", note: "不该写" });
  assert.equal(foreign.response.status, 404);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_out_asia")?.callOutcome, "");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_out_asia")?.callOutcomeNote, "");
  const reverse = await request("/api/outbound-call-records/ocr_out_a1/outcome", asia, "POST", { outcome: "其他", note: "跨租户" });
  assert.equal(reverse.response.status, 404);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_out_a1")?.callOutcome, "无意向");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_out_a1")?.callOutcomeNote, "改备注");
  const ownAsia = await request("/api/outbound-call-records/ocr_out_asia/outcome", asia, "POST", { outcome: "有意向", note: "本租户" });
  assert.equal(ownAsia.response.status, 200);
  const asiaAudit = store.callOutcomeAudits.find((item) => item.callRecordId === "ocr_out_asia");
  assert.equal(asiaAudit?.teamId, "asia");
  assert.equal(asiaAudit?.actorId, "u_outcome_asia");
  assert.equal(asiaAudit?.previousOutcome, "");
  assert.equal(asiaAudit?.nextOutcome, "有意向");
  const asiaSeesEurope = await request("/api/outbound-call-records", asia);
  assert.equal(asiaSeesEurope.json.records.some((item: { id: string }) => item.id === "ocr_out_a1"), false);

  const baseline = await request("/api/outbound-call-records", shirley);
  assert.equal(baseline.response.status, 200);
  assert.equal(baseline.json.empty, false);
  assert.deepEqual(baseline.json.stats, {
    totalCalls: 4,
    connectedCalls: 3,
    connectRate: 3 / 4,
    averageConnectedDurationSeconds: (10 + 10 + 20) / 3
  });
  assert.deepEqual(baseline.json.outcomeCounts, {
    "有意向": 2,
    "需回访": 1,
    "无意向": 1,
    "号码错误": 0,
    "其他": 0
  });
  assert.equal(baseline.json.records.some((item: { id: string }) => item.id === "ocr_out_mia" || item.id === "ocr_out_asia" || item.id === "ocr_out_none"), false);
  const unlabeled = baseline.json.records.find((item: { id: string }) => item.id === "ocr_out_a3");
  assert.equal(unlabeled.callOutcome, "需回访");

  const filtered = await request(`/api/outbound-call-records?outcome=${encodeURIComponent("有意向")}`, shirley);
  assert.equal(filtered.response.status, 200);
  assert.deepEqual(filtered.json.records.map((item: { id: string }) => item.id).sort(), ["ocr_out_a2", "ocr_out_a4"]);
  assert.deepEqual(filtered.json.stats, baseline.json.stats);
  assert.deepEqual(filtered.json.outcomeCounts, baseline.json.outcomeCounts);
  assert.equal(filtered.json.records.every((item: { callOutcome: string }) => item.callOutcome === "有意向"), true);

  const noneOf = await request(`/api/outbound-call-records?outcome=${encodeURIComponent("号码错误")}`, shirley);
  assert.equal(noneOf.response.status, 200);
  assert.equal(noneOf.json.empty, false);
  assert.deepEqual(noneOf.json.records, []);
  assert.deepEqual(noneOf.json.stats, baseline.json.stats);
  assert.equal(noneOf.json.outcomeCounts["号码错误"], 0);

  const badFilter = await request("/api/outbound-call-records?outcome=Success", shirley);
  assert.equal(badFilter.response.status, 400);
  assert.equal(badFilter.json.reason, "invalid_request");

  const blankRange = await request("/api/outbound-call-records?from=1999-01-01&to=1999-01-02", shirley);
  assert.equal(blankRange.json.empty, true);
  assert.equal(blankRange.json.stats, null);
  assert.equal(blankRange.json.outcomeCounts, null);

  const detail = await request("/api/outbound-call-records/ocr_out_a1", shirley);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.json.record.callOutcome, "无意向");
  assert.equal(detail.json.record.callOutcomeNote, "改备注");
  assert.equal(JSON.stringify(detail.json).includes("do-not-leak-outcome"), false);
  const foreignDetail = await request("/api/outbound-call-records/ocr_out_asia", shirley);
  assert.equal(foreignDetail.response.status, 404);

  assert.equal(aliyunHits, 0);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.leadActivities.length, leadActivitiesBefore);
  assert.equal(store.followUpAudits.length, followAuditsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outreachSequences.length, sequencesBefore);
  assert.equal(store.prospectOutreachPlans.length, plansBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.outboundMissedFollowUps.length, missedBefore);
  assert.equal(store.outboundMissedFollowUpAudits.length, missedAuditsBefore);
  assert.equal(store.customers.find((item) => item.id === "c1")?.nextReminder, reminderBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  assert.equal(JSON.stringify(store.callOutcomeAudits).includes("AccessKey"), false);
  assert.equal(JSON.stringify(store.callOutcomeAudits).includes("do-not-leak-outcome"), false);
  assert.equal(JSON.stringify(store.callOutcomeAudits).includes("aliyuncs"), false);

  console.log("call outcome http tests passed");
} finally {
  const store = getStore();
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_out_"));
  store.callOutcomeAudits = store.callOutcomeAudits.filter((item) => !item.callRecordId.startsWith("ocr_out_"));
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_outcome_"));
  store.users = store.users.filter((item) => item.id !== "u_no_outcome_read" && item.id !== "u_outcome_asia");
  globalThis.fetch = originalFetch;
  server.close();
}
