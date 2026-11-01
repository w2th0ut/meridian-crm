import assert from "node:assert/strict";
import { CALL_NOTE_MAX } from "./call-note.js";
import { app } from "./server.js";
import { getStore } from "./store.js";
import type { OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call note test server");
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
    recordingUrl: "https://oss.example/do-not-leak-note",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "有意向",
    callOutcomeNote: "原标注",
    callNote: "",
    callNoteTags: "",
    callNoteUpdatedAt: "",
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
    id: "u_no_note_read",
    name: "No Note Read",
    email: "no-note-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_note_asia",
    name: "Asia Note",
    email: "asia-note@keduoduo.com",
    role: "sales",
    teamId: "asia",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_no_note_read") return snapshot;
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
  const outcomeAuditsBefore = store.callOutcomeAudits.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);

  store.aliyunAgentMappings.push(
    {
      id: "map_note_shirley",
      teamId: "europe",
      crmUserId: shirleyUser.id,
      cccUserId: "agent@ccc-note-a",
      loginName: "shirley",
      displayName: "Shirley坐席",
      extension: "8201",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_note_mia",
      teamId: "europe",
      crmUserId: miaUser.id,
      cccUserId: "agent@ccc-note-b",
      loginName: "mia",
      displayName: "Mia坐席",
      extension: "8202",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_note_asia",
      teamId: "asia",
      crmUserId: "u_note_asia",
      cccUserId: "agent@ccc-note-asia",
      loginName: "asia",
      displayName: "亚洲坐席",
      extension: "8203",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    }
  );
  store.outboundCallRecords.push(
    record({ id: "ocr_note_a1", agentIds: "agent@ccc-note-a" }),
    record({ id: "ocr_note_a2", agentIds: "agent@ccc-note-a", callDurationRaw: "20" }),
    record({ id: "ocr_note_blank", agentIds: "agent@ccc-note-a", establishedTimeRaw: "" }),
    record({
      id: "ocr_note_mia",
      agentIds: "agent@ccc-note-b",
      targetId: "c2",
      callNote: "对方原纪要",
      callNoteTags: "预算",
      callNoteUpdatedAt: "2026-04-04T01:00:00.000Z"
    }),
    record({ id: "ocr_note_none", agentIds: "", targetType: "lead", targetId: "l1" }),
    record({ id: "ocr_note_asia", teamId: "asia", agentIds: "agent@ccc-note-asia", targetId: "c_asia", callNote: "亚洲纪要", callNoteTags: "需求" }),
    record({ id: "ocr_note_prospect", agentIds: "agent@ccc-note-a", targetType: "prospect", targetId: "p_note" })
  );

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const noRead = await login("no-note-read@keduoduo.com");
  const asia = await login("asia-note@keduoduo.com");

  const invalid = await request("/api/outbound-call-records/ocr_note_a1/note", shirley, "POST", { note: "字".repeat(CALL_NOTE_MAX + 1) });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.json.reason, "note_too_long");
  assert.equal(store.callNoteAudits.length, 0);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_note_a1")?.callNote, "");

  const badType = await request("/api/outbound-call-records/ocr_note_a1/note", shirley, "POST", { note: 8 });
  assert.equal(badType.response.status, 400);
  assert.equal(store.callNoteAudits.length, 0);
  const badTag = await request("/api/outbound-call-records/ocr_note_a1/note", shirley, "POST", { tags: ["价格"] });
  assert.equal(badTag.response.status, 400);
  assert.equal(badTag.json.reason, "invalid_tags");
  const batch = await request("/api/outbound-call-records/ocr_note_a1/note", shirley, "POST", { note: "批量", records: ["ocr_note_a1"] });
  assert.equal(batch.response.status, 400);
  assert.equal(store.callNoteAudits.length, 0);

  const created = await request("/api/outbound-call-records/ocr_note_a1/note", shirley, "POST", {
    note: "  要样品，预算未定  ",
    tags: ["竞品", "需求", "需求"]
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.json.result, "updated");
  assert.equal(created.json.action, "create");
  assert.equal(created.json.note, "要样品，预算未定");
  assert.deepEqual(created.json.tags, ["需求", "竞品"]);
  assert.equal(created.json.record.recordingUrl, undefined);
  assert.equal(JSON.stringify(created.json).includes("do-not-leak-note"), false);
  const saved = store.outboundCallRecords.find((item) => item.id === "ocr_note_a1");
  assert.equal(saved?.callNote, "要样品，预算未定");
  assert.equal(saved?.callNoteTags, "需求,竞品");
  assert.equal(saved?.updatedAt, "2026-04-04T00:00:00.000Z");
  assert.equal(saved?.callOutcome, "有意向");
  assert.equal(saved?.contactDisposition, "NoAnswer");
  const first = store.callNoteAudits.find((item) => item.callRecordId === "ocr_note_a1");
  assert.equal(first?.actorId, shirleyUser.id);
  assert.equal(first?.teamId, "europe");
  assert.equal(first?.action, "create");
  assert.equal(first?.result, "updated");
  assert.equal(first?.previousNote, "");
  assert.equal(first?.previousTags, "");
  assert.equal(first?.nextNote, "要样品，预算未定");
  assert.equal(first?.nextTags, "需求,竞品");
  assert.ok(first?.at);

  const same = await request("/api/outbound-call-records/ocr_note_a1/note", shirley, "POST", {
    note: "要样品，预算未定",
    tags: ["需求", "竞品"]
  });
  assert.equal(same.json.result, "unchanged");
  assert.equal(store.callNoteAudits.filter((item) => item.callRecordId === "ocr_note_a1" && item.result === "updated").length, 1);

  const edited = await request("/api/outbound-call-records/ocr_note_a1/note", shirley, "POST", {
    note: "要样品，预算未定",
    tags: ["预算"]
  });
  assert.equal(edited.json.action, "update");
  const editAudit = store.callNoteAudits.find((item) => item.callRecordId === "ocr_note_a1" && item.nextTags === "预算");
  assert.equal(editAudit?.previousNote, "要样品，预算未定");
  assert.equal(editAudit?.nextNote, "要样品，预算未定");
  assert.equal(editAudit?.previousTags, "需求,竞品");

  const exact = await request("/api/outbound-call-records/ocr_note_a2/note", shirley, "POST", { note: "字".repeat(CALL_NOTE_MAX), tags: [] });
  assert.equal(exact.response.status, 200);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_note_a2")?.callNote.length, CALL_NOTE_MAX);

  const cleared = await request("/api/outbound-call-records/ocr_note_a2/note", shirley, "POST", { note: "   ", tags: [] });
  assert.equal(cleared.json.action, "clear");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_note_a2")?.callNote, "");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_note_a2")?.callNoteTags, "");
  const clearAgain = await request("/api/outbound-call-records/ocr_note_a2/note", shirley, "POST", {});
  assert.equal(clearAgain.json.result, "unchanged");
  assert.equal(store.callNoteAudits.filter((item) => item.callRecordId === "ocr_note_a2" && item.action === "clear").length, 1);

  const deniedRead = await request("/api/outbound-call-records/ocr_note_a1/note", noRead, "POST", { note: "无权" });
  assert.equal(deniedRead.response.status, 403);
  assert.equal(deniedRead.json.reason, "forbidden");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_note_a1")?.callNote, "要样品，预算未定");
  const deniedAudit = store.callNoteAudits.find((item) => item.actorId === "u_no_note_read");
  assert.equal(deniedAudit?.result, "rejected");
  assert.equal(deniedAudit?.callRecordId, "ocr_note_a1");
  assert.equal(deniedAudit?.previousNote, "要样品，预算未定");
  assert.equal(deniedAudit?.nextNote, "无权");

  const hidden = await request("/api/outbound-call-records/ocr_note_mia/note", shirley, "POST", { note: "改别人的" });
  assert.equal(hidden.response.status, 403);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_note_mia")?.callNote, "对方原纪要");
  const hiddenAudit = store.callNoteAudits.find((item) => item.callRecordId === "ocr_note_mia" && item.actorId === shirleyUser.id);
  assert.equal(hiddenAudit?.result, "rejected");
  assert.equal(hiddenAudit?.previousNote, "对方原纪要");
  assert.equal(hiddenAudit?.previousTags, "预算");
  assert.equal(hidden.json.note, undefined);

  const manager = await request("/api/outbound-call-records/ocr_note_mia/note", alex, "POST", { note: "主管补记", tags: ["决策人"] });
  assert.equal(manager.response.status, 200);
  assert.equal(manager.json.action, "update");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_note_mia")?.callNote, "主管补记");

  const unmapped = await request("/api/outbound-call-records/ocr_note_none/note", shirley, "POST", { note: "没有坐席" });
  assert.equal(unmapped.response.status, 403);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_note_none")?.callNote, "");
  const adminNote = await request("/api/outbound-call-records/ocr_note_none/note", admin, "POST", { note: "管理员纪要", tags: ["异议"] });
  assert.equal(adminNote.response.status, 200);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_note_none")?.callNote, "管理员纪要");

  const foreign = await request("/api/outbound-call-records/ocr_note_asia/note", shirley, "POST", { note: "不该写" });
  assert.equal(foreign.response.status, 403);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_note_asia")?.callNote, "亚洲纪要");
  const foreignAudit = store.callNoteAudits.find((item) => item.actorId === shirleyUser.id && item.nextNote === "不该写");
  assert.equal(foreignAudit?.teamId, "europe");
  assert.equal(foreignAudit?.previousNote, "");
  assert.equal(foreignAudit?.result, "rejected");
  const reverse = await request("/api/outbound-call-records/ocr_note_a1/note", asia, "POST", { note: "跨租户" });
  assert.equal(reverse.response.status, 403);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_note_a1")?.callNote, "要样品，预算未定");
  const ownAsia = await request("/api/outbound-call-records/ocr_note_asia/note", asia, "POST", { note: "本租户补充", tags: ["需求"] });
  assert.equal(ownAsia.response.status, 200);
  assert.equal(store.callNoteAudits.find((item) => item.callRecordId === "ocr_note_asia" && item.result === "updated")?.teamId, "asia");

  const missing = await request("/api/outbound-call-records/ocr_note_missing/note", shirley, "POST", { note: "不存在" });
  assert.equal(missing.response.status, 403);
  assert.equal(store.callNoteAudits.some((item) => item.callRecordId === "ocr_note_missing" && item.result === "rejected"), true);

  const baseline = await request("/api/outbound-call-records", shirley);
  assert.equal(baseline.response.status, 200);
  assert.equal(baseline.json.stats.totalCalls, 4);
  const withNotes = await request("/api/outbound-call-records?note=has", shirley);
  assert.equal(withNotes.response.status, 200);
  assert.equal(withNotes.json.stats.totalCalls, baseline.json.stats.totalCalls);
  assert.equal(withNotes.json.stats.connectRate, baseline.json.stats.connectRate);
  assert.equal(withNotes.json.records.every((item: { callNote: string; callNoteTags: string[] }) => item.callNote || item.callNoteTags.length), true);
  assert.equal(withNotes.json.records.some((item: { id: string }) => item.id === "ocr_note_a1"), true);
  assert.equal(withNotes.json.records.some((item: { id: string }) => item.id === "ocr_note_blank"), false);
  const withoutNotes = await request("/api/outbound-call-records?note=none", shirley);
  assert.equal(withoutNotes.json.records.every((item: { callNote: string; callNoteTags: string[] }) => !item.callNote && !item.callNoteTags.length), true);
  assert.equal(withoutNotes.json.records.some((item: { id: string }) => item.id === "ocr_note_a2"), true);
  assert.equal(withoutNotes.json.stats.totalCalls, 4);
  const badFilter = await request("/api/outbound-call-records?note=all", shirley);
  assert.equal(badFilter.response.status, 400);

  const detail = await request("/api/outbound-call-records/ocr_note_a1", shirley);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.json.record.callNote, "要样品，预算未定");
  assert.deepEqual(detail.json.record.callNoteTags, ["预算"]);
  assert.equal(detail.json.record.recordingUrl, undefined);

  const customers = await request("/api/customers", shirley);
  const customer = (customers.json.customers as Array<{ id: string; callNotes?: Array<{ callRecordId: string; note: string; tags: string[] }> }>).find((item) => item.id === "c1");
  assert.equal(customer?.callNotes?.some((item) => item.callRecordId === "ocr_note_a1" && item.note === "要样品，预算未定" && item.tags.includes("预算")), true);
  assert.equal(customer?.callNotes?.some((item) => item.callRecordId === "ocr_note_a2"), false);
  const other = (customers.json.customers as Array<{ id: string; callNotes?: Array<{ callRecordId: string }> }>).find((item) => item.id === "c2");
  assert.equal(other?.callNotes?.some((item) => item.callRecordId === "ocr_note_a1"), false);

  const lead = await request("/api/leads/l1", shirley);
  assert.equal(lead.response.status, 200);
  assert.equal(lead.json.callNotes.some((item: { callRecordId: string; note: string; tags: string[] }) => item.callRecordId === "ocr_note_none" && item.note === "管理员纪要" && item.tags.includes("异议")), true);
  assert.equal(store.leadActivities.length, leadActivitiesBefore);

  const prospectTimeline = customer?.callNotes?.some((item) => item.callRecordId === "ocr_note_prospect");
  assert.equal(prospectTimeline, false);

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
  assert.equal(store.callOutcomeAudits.length, outcomeAuditsBefore);
  assert.equal(store.customers.find((item) => item.id === "c1")?.nextReminder, reminderBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  const auditText = JSON.stringify(store.callNoteAudits);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("do-not-leak-note"), false);
  assert.equal(auditText.includes("aliyuncs"), false);
  const europeAudits = JSON.stringify(store.callNoteAudits.filter((item) => item.teamId === "europe"));
  assert.equal(europeAudits.includes("亚洲纪要"), false);

  console.log("call note http tests passed");
} finally {
  const store = getStore();
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_note_"));
  store.callNoteAudits = store.callNoteAudits.filter((item) => !item.callRecordId.startsWith("ocr_note_"));
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_note_"));
  store.users = store.users.filter((item) => item.id !== "u_no_note_read" && item.id !== "u_note_asia");
  globalThis.fetch = originalFetch;
  server.close();
}
