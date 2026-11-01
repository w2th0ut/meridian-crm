import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCallWrapupEditReport,
  buildCallWrapupEditReportCsv,
  callWrapupEditReportFiltersText,
  parseCallWrapupEditReportQuery
} from "./call-wrapup-edit-report.js";
import type { AliyunAgentMapping, CallWrapupEditAudit, CrmStore, OutboundCallRecord, User } from "./types.js";

assert.deepEqual(parseCallWrapupEditReportQuery({}), { from: null, to: null, agentId: null, field: null });
assert.deepEqual(parseCallWrapupEditReportQuery({
  from: "2026-04-04",
  to: "2026-04-05",
  agentId: "agent@ccc-a",
  field: "note"
}), {
  from: "2026-04-04",
  to: "2026-04-05",
  agentId: "agent@ccc-a",
  field: "note"
});
assert.equal(parseCallWrapupEditReportQuery({ agentId: "none" })?.agentId, "none");
assert.equal(parseCallWrapupEditReportQuery({ from: "2026-04-06", to: "2026-04-05" }), null);
assert.equal(parseCallWrapupEditReportQuery({ from: "2026-02-31" }), null);
assert.equal(parseCallWrapupEditReportQuery({ agentId: "bad id" }), null);
assert.equal(parseCallWrapupEditReportQuery({ field: "script" }), null);
assert.equal(parseCallWrapupEditReportQuery({ from: ["2026-04-04"] }), null);
assert.equal(parseCallWrapupEditReportQuery({ tag: "ctag_a" }), null);
assert.equal(callWrapupEditReportFiltersText({ from: "2026-04-04", to: null, agentId: null, field: "note" }).includes("13800138000"), false);
assert.equal(callWrapupEditReportFiltersText({ from: null, to: null, agentId: "agent@ccc-a", field: null }).includes("旧纪要"), false);

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    targetType: "customer",
    targetId: "c1",
    maskedNumber: "*******8000",
    contactType: "OUTBOUND",
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "10",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: String(Date.parse("2026-04-03T16:30:00.000Z")),
    agentIds: "agent@ccc-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/do-not-leak-edit-report",
    recordingDurationRaw: "99",
    followUpActivityId: "",
    callOutcome: "",
    callOutcomeNote: "",
    callNote: "话单纪要不要出现",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

function snapshot(partial: Partial<{ note: string; outcome: string; outcomeNote: string; tagIds: string[]; nextFollowAt: string }> = {}) {
  return JSON.stringify({
    note: "",
    outcome: "",
    outcomeNote: "",
    tagIds: [],
    nextFollowAt: "",
    ...partial
  });
}

function audit(partial: Partial<CallWrapupEditAudit> & Pick<CallWrapupEditAudit, "id">): CallWrapupEditAudit {
  return {
    teamId: "europe",
    actorId: "u_sales_shirley",
    at: "2026-04-03T16:30:00.000Z",
    callRecordId: "ocr_a",
    beforeJson: snapshot({ note: "旧纪要" }),
    afterJson: snapshot({ note: "新纪要" }),
    result: "updated",
    reason: "",
    ...partial
  };
}

const store = {
  users: [
    { id: "u_sales_shirley", teamId: "europe", name: "Shirley" },
    { id: "u_asia", teamId: "asia", name: "亚洲人" }
  ] as User[],
  aliyunAgentMappings: [
    { teamId: "europe", cccUserId: "agent@ccc-a", displayName: "=坐席", loginName: "a" },
    { teamId: "europe", cccUserId: "agent@ccc-b", displayName: "乙坐席", loginName: "b" }
  ] as AliyunAgentMapping[],
  outboundCallRecords: [
    record({ id: "ocr_a" }),
    record({ id: "ocr_a2" }),
    record({ id: "ocr_multi", agentIds: "agent@ccc-a,agent@ccc-b" }),
    record({ id: "ocr_b", agentIds: "agent@ccc-b" }),
    record({ id: "ocr_old" }),
    record({ id: "ocr_bad" }),
    record({ id: "ocr_blank", agentIds: "" }),
    record({ id: "ocr_eq" }),
    record({ id: "ocr_same" }),
    record({ id: "ocr_tag" }),
    record({ id: "ocr_asia", teamId: "asia", agentIds: "agent@ccc-asia" })
  ],
  callWrapupEditAudits: [
    audit({ id: "cwe_new", callRecordId: "ocr_a", beforeJson: snapshot({ note: "旧纪要", tagIds: ["t_old"] }), afterJson: snapshot({ note: "新纪要", outcome: "有意向", tagIds: ["t_old", "t_new"] }) }),
    audit({ id: "cwe_same_call", at: "2026-04-03T18:00:00.000Z", callRecordId: "ocr_a2", beforeJson: snapshot({ nextFollowAt: "2026-04-05 09:00" }), afterJson: snapshot({ nextFollowAt: "2026-04-06 09:00" }) }),
    audit({ id: "cwe_multi", at: "2026-04-03T17:00:00.000Z", callRecordId: "ocr_multi", beforeJson: snapshot({ outcomeNote: "旧备注" }), afterJson: snapshot({ outcomeNote: "新备注" }) }),
    audit({ id: "cwe_b", callRecordId: "ocr_b" }),
    audit({ id: "cwe_old", at: "2026-04-03T15:00:00.000Z", callRecordId: "ocr_old" }),
    audit({ id: "cwe_bad", at: "not-a-time", callRecordId: "ocr_bad" }),
    audit({ id: "cwe_blank", callRecordId: "ocr_blank" }),
    audit({ id: "cwe_missing", callRecordId: "ocr_missing" }),
    audit({ id: "cwe_rejected", result: "rejected", reason: "window_closed", beforeJson: snapshot({ note: "拒绝前" }), afterJson: snapshot({ note: "拒绝后" }) }),
    audit({ id: "cwe_same", callRecordId: "ocr_same", beforeJson: snapshot({ note: "一样" }), afterJson: snapshot({ note: "一样" }) }),
    audit({ id: "cwe_tag", callRecordId: "ocr_tag", beforeJson: snapshot({ note: "序", tagIds: ["b", "a"] }), afterJson: snapshot({ note: "序", tagIds: ["a", "b"] }) }),
    audit({ id: "cwe_eq", callRecordId: "ocr_eq", beforeJson: snapshot({ note: "普通" }), afterJson: snapshot({ note: "=公式" }) }),
    audit({ id: "cwe_asia", teamId: "asia", actorId: "u_asia", callRecordId: "ocr_asia", beforeJson: snapshot({ note: "亚洲纪要不要出现" }), afterJson: snapshot({ note: "亚洲后值" }) })
  ]
} as Pick<CrmStore, "aliyunAgentMappings" | "callWrapupEditAudits" | "outboundCallRecords" | "users">;

const day = buildCallWrapupEditReport({
  store,
  teamId: "europe",
  query: { from: "2026-04-04", to: "2026-04-04", agentId: null, field: null },
  timeZone: "Asia/Shanghai"
});
assert.deepEqual(day.rows.map((item) => item.id), [
  "cwe_same_call",
  "cwe_multi",
  "cwe_tag",
  "cwe_same",
  "cwe_new",
  "cwe_missing",
  "cwe_eq",
  "cwe_blank",
  "cwe_b"
]);
assert.equal(day.rows.some((item) => item.id === "cwe_rejected" || item.id === "cwe_asia" || item.id === "cwe_old" || item.id === "cwe_bad"), false);
const agentA = day.counts.find((item) => item.agentId === "agent@ccc-a");
const agentB = day.counts.find((item) => item.agentId === "agent@ccc-b");
const none = day.counts.find((item) => item.agentId === "none");
assert.equal(agentA?.correctionCount, 6);
assert.equal(agentA?.label, "=坐席");
assert.equal(agentB?.correctionCount, 2);
assert.equal(none?.correctionCount, 2);
assert.equal(day.counts.reduce((sum, item) => sum + item.correctionCount, 0), 10);
assert.equal(day.rows.length, 9);
assert.equal(day.counts.some((item) => item.correctionCount === 0), false);
const changed = day.rows.find((item) => item.id === "cwe_new");
assert.deepEqual(changed?.changedFields, ["note", "outcome", "tagIds"]);
assert.equal(changed?.before.note, "旧纪要");
assert.equal(changed?.after.outcome, "有意向");
assert.deepEqual(changed?.after.tagIds, ["t_old", "t_new"]);
assert.equal(changed?.actorLabel, "Shirley");
assert.equal(day.rows.find((item) => item.id === "cwe_tag")?.changedFields.length, 0);
assert.equal(JSON.stringify(day).includes("话单纪要不要出现"), false);
assert.equal(JSON.stringify(day).includes("do-not-leak-edit-report"), false);
assert.equal(JSON.stringify(day).includes("*******8000"), false);
assert.equal(JSON.stringify(day).includes("亚洲纪要不要出现"), false);
assert.equal(JSON.stringify(day).includes("亚洲人"), false);

const notes = buildCallWrapupEditReport({
  store,
  teamId: "europe",
  query: { from: "2026-04-04", to: "2026-04-04", agentId: null, field: "note" },
  timeZone: "Asia/Shanghai"
});
assert.deepEqual(notes.rows.map((item) => item.id), ["cwe_new", "cwe_missing", "cwe_eq", "cwe_blank", "cwe_b"]);
assert.equal(notes.counts.find((item) => item.agentId === "agent@ccc-a")?.correctionCount, 2);
assert.equal(notes.counts.find((item) => item.agentId === "agent@ccc-b")?.correctionCount, 1);
assert.equal(notes.counts.find((item) => item.agentId === "none")?.correctionCount, 2);

const onlyB = buildCallWrapupEditReport({
  store,
  teamId: "europe",
  query: { from: "2026-04-04", to: "2026-04-04", agentId: "agent@ccc-b", field: null },
  timeZone: "Asia/Shanghai"
});
assert.deepEqual(onlyB.rows.map((item) => item.id), ["cwe_multi", "cwe_b"]);
assert.deepEqual(onlyB.counts.map((item) => item.agentId), ["agent@ccc-b"]);
assert.equal(onlyB.counts[0]?.correctionCount, 2);

const unassigned = buildCallWrapupEditReport({
  store,
  teamId: "europe",
  query: { from: "2026-04-04", to: "2026-04-04", agentId: "none", field: null },
  timeZone: "Asia/Shanghai"
});
assert.deepEqual(unassigned.rows.map((item) => item.id), ["cwe_missing", "cwe_blank"]);
assert.equal(unassigned.counts[0]?.label, "未分配坐席");
assert.equal(unassigned.counts[0]?.correctionCount, 2);

const open = buildCallWrapupEditReport({
  store,
  teamId: "europe",
  query: { from: null, to: null, agentId: null, field: null },
  timeZone: "Asia/Shanghai"
});
assert.equal(open.rows.some((item) => item.id === "cwe_old"), true);
assert.equal(open.rows.some((item) => item.id === "cwe_bad"), true);
assert.equal(open.rows.some((item) => item.id === "cwe_rejected"), false);

const asia = buildCallWrapupEditReport({
  store,
  teamId: "asia",
  query: { from: null, to: null, agentId: null, field: null },
  timeZone: "Asia/Shanghai"
});
assert.deepEqual(asia.rows.map((item) => item.id), ["cwe_asia"]);
assert.equal(asia.rows[0]?.actorLabel, "亚洲人");
assert.equal(JSON.stringify(asia).includes("旧纪要"), false);

const csv = buildCallWrapupEditReportCsv(day.rows);
assert.equal(csv.charCodeAt(0), 0xfeff);
assert.match(csv, /时间,坐席,操作人,通话记录,变更字段,改正前纪要,改正后纪要/);
assert.match(csv, /'=坐席/);
assert.match(csv, /'=公式/);
assert.match(csv, /旧纪要,新纪要/);
assert.equal(csv.includes("do-not-leak-edit-report"), false);
assert.equal(csv.includes("*******8000"), false);
assert.equal(csv.includes("13800138000"), false);
assert.equal(csv.includes("话单纪要不要出现"), false);
assert.equal(csv.includes("亚洲纪要不要出现"), false);
assert.equal(csv.includes("接通率"), false);
assert.match(csv, /\r\n/);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_wrapup_edit_report_audits \(/);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS call_wrapup_edit_report_audits \(/g) || []).length, 1);
assert.equal(schema.includes("INSERT INTO call_wrapup_edit_report_audits"), false);
assert.equal(schema.includes("DROP TABLE call_wrapup_edit_report_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS call_wrapup_edit_report_audits"), false);
assert.equal(schema.includes("ALTER TABLE call_wrapup_edit_report_audits"), false);
assert.equal(schema.includes("ALTER TABLE call_wrapup_edit_audits"), false);
assert.equal(schema.includes("DROP TABLE call_wrapup_edit_audits"), false);
assert.equal(schema.includes("UPDATE call_wrapup_edit_windows"), false);

const source = readFileSync(new URL("./call-wrapup-edit-report.ts", import.meta.url), "utf8");
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("requestOutboundCall"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("openai"), false);
assert.equal(source.includes("connectRate"), false);
assert.equal(source.includes("callWrapupEditAudits.unshift"), false);
assert.equal(source.includes("callWrapupAudits"), false);

console.log("call wrapup edit report unit tests passed");
