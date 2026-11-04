import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseProspectCallNoteQuery, prospectCallNotesForCandidate } from "./prospect-call-notes.js";
import type { OutboundCallRecord } from "./types.js";

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
    callDurationRaw: "",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: "2000",
    agentIds: "agent-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://secret.example/rec",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "有意向",
    callOutcomeNote: "不要带出结果备注",
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

assert.deepEqual(parseProspectCallNoteQuery({ candidateId: " web_1 " }), { candidateId: "web_1" });
assert.equal(parseProspectCallNoteQuery({}), null);
assert.equal(parseProspectCallNoteQuery({ candidateId: "" }), null);
assert.equal(parseProspectCallNoteQuery({ candidateId: "bad id" }), null);
assert.equal(parseProspectCallNoteQuery({ candidateId: ["web_1"] }), null);
assert.equal(parseProspectCallNoteQuery({ candidateId: "web_1", outcome: "其他" }), null);

const records = [
  record({ id: "older", targetType: "prospect", targetId: "p1", callNote: " 先看样品 ", callNoteTags: "预算,需求", callNoteUpdatedAt: "2026-11-01T00:00:00.000Z", maskedNumber: "13800138000" }),
  record({ id: "newer", targetType: "prospect", targetId: "p1", callNote: "", callNoteTags: "异议", callNoteUpdatedAt: "2026-11-03T00:00:00.000Z" }),
  record({ id: "blank", targetType: "prospect", targetId: "p1", callNote: "   ", callNoteTags: "" }),
  record({ id: "hidden", targetType: "prospect", targetId: "p1", callNote: "别人的纪要", callNoteUpdatedAt: "2026-11-04T00:00:00.000Z" }),
  record({ id: "other-prospect", targetType: "prospect", targetId: "p2", callNote: "另一家" }),
  record({ id: "customer", targetType: "customer", targetId: "p1", callNote: "客户纪要" }),
  record({ id: "asia", teamId: "asia", targetType: "prospect", targetId: "p1", callNote: "别的租户" }),
  record({ id: "junk-tag", targetType: "prospect", targetId: "p1", callNote: "", callNoteTags: "不是要点" })
];

const items = prospectCallNotesForCandidate({
  teamId: "europe",
  candidateId: "p1",
  records,
  visible: (item) => item.id !== "hidden"
});
assert.deepEqual(items.map((item) => item.callRecordId), ["newer", "older"]);
assert.deepEqual(items[1]?.tags, ["需求", "预算"]);
assert.equal(items[1]?.note, "先看样品");
assert.equal(items[0]?.note, "");
assert.equal(items[0]?.at, "2026-11-03T00:00:00.000Z");
assert.equal(String(items[1]?.maskedNumber).includes("13800138000"), false);
assert.equal(JSON.stringify(items).includes("secret.example"), false);
assert.equal(JSON.stringify(items).includes("有意向"), false);
assert.equal(JSON.stringify(items).includes("不要带出结果备注"), false);
assert.equal(JSON.stringify(items).includes("别人的纪要"), false);
assert.equal(JSON.stringify(items).includes("客户纪要"), false);
assert.equal(JSON.stringify(items).includes("别的租户"), false);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS prospect_call_note_view_audits \(/);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS prospect_call_note_view_audits \(/g) || []).length, 1);
assert.match(schema, /INSERT INTO prospect_call_note_view_audits/);
assert.match(schema, /WHERE NOT EXISTS/);
assert.match(schema, /team_id = ''/);
assert.equal(schema.includes("DROP TABLE prospect_call_note_view_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS prospect_call_note_view_audits"), false);
assert.equal(schema.includes("ALTER TABLE outbound_call_records"), false);

const source = readFileSync(new URL("./prospect-call-notes.ts", import.meta.url), "utf8");
assert.match(source, /recordHasCallNote/);
assert.match(source, /displayMaskedNumber/);
assert.match(source, /communication\.read/);
assert.match(source, /prospect\.read/);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("nextFollowAt"), false);
assert.equal(source.includes("setProspectNextFollowAt"), false);

console.log("prospect call note tests passed");
