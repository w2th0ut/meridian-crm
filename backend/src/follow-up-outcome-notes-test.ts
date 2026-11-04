import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  followUpOutcomeNoteAt,
  followUpOutcomeNotesForTarget,
  parseFollowUpOutcomeNoteQuery
} from "./follow-up-outcome-notes.js";
import type { CallOutcomeAudit, OutboundCallRecord } from "./types.js";

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
    startTimeRaw: "999999",
    agentIds: "agent-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://secret.example/rec",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "有意向",
    callOutcomeNote: "",
    callNote: "纪要不要出现",
    callNoteTags: "需求",
    callNoteUpdatedAt: "2026-11-04T00:00:00.000Z",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
    ...partial
  };
}

function audit(partial: Partial<CallOutcomeAudit> & Pick<CallOutcomeAudit, "id" | "callRecordId" | "nextNote" | "at">): CallOutcomeAudit {
  return {
    teamId: "europe",
    actorId: "u1",
    previousOutcome: "",
    nextOutcome: "有意向",
    previousNote: "",
    ...partial
  };
}

assert.deepEqual(parseFollowUpOutcomeNoteQuery({ targetType: "customer", targetId: " c1 " }), { targetType: "customer", targetId: "c1" });
assert.deepEqual(parseFollowUpOutcomeNoteQuery({ targetType: "lead", targetId: "l1" }), { targetType: "lead", targetId: "l1" });
assert.equal(parseFollowUpOutcomeNoteQuery({}), null);
assert.equal(parseFollowUpOutcomeNoteQuery({ targetType: "customer" }), null);
assert.equal(parseFollowUpOutcomeNoteQuery({ targetType: "customer", targetId: "" }), null);
assert.equal(parseFollowUpOutcomeNoteQuery({ targetType: "customer", targetId: "bad id" }), null);
assert.equal(parseFollowUpOutcomeNoteQuery({ targetType: "prospect", targetId: "p1" }), null);
assert.equal(parseFollowUpOutcomeNoteQuery({ targetType: "customer", targetId: ["c1"] }), null);
assert.equal(parseFollowUpOutcomeNoteQuery({ targetType: "customer", targetId: "c1", outcome: "其他" }), null);

const records = [
  record({ id: "older", targetType: "customer", targetId: "c1", callOutcomeNote: " 先看样品 ", maskedNumber: "13800138000" }),
  record({ id: "newer", targetType: "customer", targetId: "c1", callOutcome: " 其他 ", callOutcomeNote: "下午再打" }),
  record({ id: "blank", targetType: "customer", targetId: "c1", callOutcomeNote: "   " }),
  record({ id: "hidden", targetType: "customer", targetId: "c1", callOutcomeNote: "别人的备注" }),
  record({ id: "raw", targetType: "customer", targetId: "c1", callOutcome: "NotALabel", callOutcomeNote: "未标也要看", updatedAt: "", createdAt: "2026-10-01T00:00:00.000Z" }),
  record({ id: "other-customer", targetType: "customer", targetId: "c2", callOutcomeNote: "另一家" }),
  record({ id: "lead-row", targetType: "lead", targetId: "c1", callOutcomeNote: "线索备注不要混进客户" }),
  record({ id: "prospect", targetType: "prospect", targetId: "c1", callOutcomeNote: "搜客备注" }),
  record({ id: "asia", teamId: "asia", targetType: "customer", targetId: "c1", callOutcomeNote: "别的租户" })
];
const audits = [
  audit({ id: "a_old", callRecordId: "older", nextNote: "先看样品", at: "2026-11-01T00:00:00.000Z" }),
  audit({ id: "a_old_earlier", callRecordId: "older", nextNote: "先看样品", at: "2026-10-15T00:00:00.000Z" }),
  audit({ id: "a_new", callRecordId: "newer", nextNote: "下午再打", at: "2026-11-03T00:00:00.000Z" }),
  audit({ id: "a_other_note", callRecordId: "newer", nextNote: "旧备注", at: "2026-12-01T00:00:00.000Z" })
];

assert.equal(followUpOutcomeNoteAt(records[0]!, audits), "2026-11-01T00:00:00.000Z");
assert.equal(followUpOutcomeNoteAt(records[4]!, audits), "2026-10-01T00:00:00.000Z");
assert.equal(followUpOutcomeNoteAt(records[4]!, audits).includes("999999"), false);

const items = followUpOutcomeNotesForTarget({
  teamId: "europe",
  targetType: "customer",
  targetId: "c1",
  records,
  audits,
  visible: (item) => item.id !== "hidden"
});
assert.deepEqual(items.map((item) => item.callRecordId), ["newer", "older", "raw"]);
assert.equal(items[0]?.outcomeLabel, "其他");
assert.equal(items[0]?.note, "下午再打");
assert.equal(items[0]?.at, "2026-11-03T00:00:00.000Z");
assert.equal(items[1]?.note, "先看样品");
assert.equal(items[2]?.outcomeLabel, "未标注");
assert.equal(String(items[1]?.maskedNumber).includes("13800138000"), false);
const packed = JSON.stringify(items);
assert.equal(packed.includes("secret.example"), false);
assert.equal(packed.includes("纪要不要出现"), false);
assert.equal(packed.includes("NotALabel"), false);
assert.equal(packed.includes("Success"), false);
assert.equal(packed.includes("999999"), false);
assert.equal(packed.includes("别人的备注"), false);
assert.equal(packed.includes("线索备注不要混进客户"), false);
assert.equal(packed.includes("搜客备注"), false);
assert.equal(packed.includes("别的租户"), false);
assert.equal(packed.includes("另一家"), false);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS follow_up_outcome_note_view_audits \(/);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS follow_up_outcome_note_view_audits \(/g) || []).length, 1);
assert.match(schema, /INSERT INTO follow_up_outcome_note_view_audits/);
assert.match(schema, /WHERE NOT EXISTS/);
assert.match(schema, /team_id = ''/);
assert.equal(schema.includes("DROP TABLE follow_up_outcome_note_view_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS follow_up_outcome_note_view_audits"), false);
assert.equal(schema.includes("ALTER TABLE outbound_call_records"), false);

const source = readFileSync(new URL("./follow-up-outcome-notes.ts", import.meta.url), "utf8");
assert.match(source, /callOutcomeNote/);
assert.match(source, /displayMaskedNumber/);
assert.match(source, /communication\.read/);
assert.match(source, /customer\.read/);
assert.match(source, /lead\.read/);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("nextFollowAt"), false);
assert.equal(source.includes("nextReminder"), false);
assert.equal(source.includes("callNote"), false);

console.log("follow-up outcome note tests passed");
