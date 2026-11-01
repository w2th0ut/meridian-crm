import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CALL_NOTE_MAX } from "./call-note.js";
import {
  CALL_WRAPUP_EDIT_WINDOW_HOURS,
  parseCallWrapupEditRequest,
  parseCallWrapupEditWindowRequest
} from "./call-wrapup-edit.js";
import { CALL_OUTCOME_NOTE_MAX } from "./outbound-call-records.js";

const ok = parseCallWrapupEditRequest({
  note: " 改正纪要 ",
  outcome: { outcome: " 无意向 ", note: " 备注 " },
  callTag: { tagId: "ctag_a", action: "remove" },
  callTags: [{ tagId: "ctag_b" }],
  nextFollowAt: "2026-11-02T10:15"
});
assert.equal(ok.ok, true);
if (ok.ok) {
  assert.equal(ok.edit.note, "改正纪要");
  assert.deepEqual(ok.edit.outcome, { outcome: "无意向", note: "备注" });
  assert.deepEqual(ok.edit.callTags, [
    { tagId: "ctag_a", action: "remove" },
    { tagId: "ctag_b", action: "add" }
  ]);
  assert.equal(ok.edit.nextFollowAt, "2026-11-02 10:15");
}
const keepNote = parseCallWrapupEditRequest({ outcome: { outcome: "其他" } });
assert.equal(keepNote.ok, true);
if (keepNote.ok) assert.equal(keepNote.edit.outcome?.note, null);
assert.equal(parseCallWrapupEditRequest({ nextFollowAt: "" }).ok, true);
assert.equal(parseCallWrapupEditRequest({}).ok, false);
assert.equal(parseCallWrapupEditRequest([]).ok, false);
assert.equal(parseCallWrapupEditRequest({ note: "字".repeat(CALL_NOTE_MAX + 1) }).ok, false);
assert.equal(parseCallWrapupEditRequest({ outcome: { outcome: "成交" } }).ok, false);
assert.equal(parseCallWrapupEditRequest({ outcome: { outcome: "其他", note: "字".repeat(CALL_OUTCOME_NOTE_MAX + 1) } }).ok, false);
assert.equal(parseCallWrapupEditRequest({ callTags: [] }).ok, false);
assert.equal(parseCallWrapupEditRequest({ callTags: [{ tagId: "ctag_a" }, { tagId: "ctag_a", action: "remove" }] }).ok, false);
assert.equal(parseCallWrapupEditRequest({
  callTags: Array.from({ length: 11 }, (_, index) => ({ tagId: `ctag_${index}` }))
}).ok, false);
assert.equal(parseCallWrapupEditRequest({ nextFollowAt: "明天" }).ok, false);
assert.equal(parseCallWrapupEditRequest({ note: "a", script: { templateId: "cst_a" } }).ok, false);
assert.equal(parseCallWrapupEditRequest({ note: "a", tags: ["需求"] }).ok, false);
assert.equal(parseCallWrapupEditRequest({ note: "a", records: ["ocr_1"] }).ok, false);

const windowOk = parseCallWrapupEditWindowRequest({ windowHours: CALL_WRAPUP_EDIT_WINDOW_HOURS });
assert.equal(windowOk.ok, true);
assert.equal(parseCallWrapupEditWindowRequest({ windowHours: 0 }).ok, false);
assert.equal(parseCallWrapupEditWindowRequest({ windowHours: 169 }).ok, false);
assert.equal(parseCallWrapupEditWindowRequest({ windowHours: 1.5 }).ok, false);
assert.equal(parseCallWrapupEditWindowRequest({ windowHours: "24" }).ok, false);
assert.equal(parseCallWrapupEditWindowRequest({}).ok, false);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_wrapup_edit_audits \(/);
assert.match(schema, /before_json TEXT NOT NULL/);
assert.match(schema, /after_json TEXT NOT NULL/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_wrapup_edit_windows \(/);
assert.match(schema, /window_hours INT NOT NULL DEFAULT 24/);
assert.match(schema, /INSERT INTO call_wrapup_edit_windows/);
assert.match(schema, /WHERE NOT EXISTS/);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS call_wrapup_edit_audits \(/g) || []).length, 1);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS call_wrapup_edit_windows \(/g) || []).length, 1);
assert.equal(schema.includes("CREATE TABLE call_wrapup_edit_audits"), false);
assert.equal(schema.includes("DROP TABLE call_wrapup_edit_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS call_wrapup_edit_audits"), false);
assert.equal(schema.includes("DROP TABLE call_wrapup_edit_windows"), false);
assert.equal(schema.includes("ALTER TABLE call_wrapup_edit_audits"), false);
assert.equal(schema.includes("ALTER TABLE call_wrapup_edit_windows"), false);
assert.equal(schema.includes("ALTER TABLE call_wrapup_audits"), false);
assert.equal(schema.includes("UPDATE call_wrapup_edit_windows"), false);
assert.equal(schema.includes("DROP COLUMN"), false);

const source = readFileSync(new URL("./call-wrapup-edit.ts", import.meta.url), "utf8");
assert.match(source, /labelCallOutcome\(/);
assert.match(source, /saveCallNote\(/);
assert.match(source, /addCallRecordTag\(/);
assert.match(source, /removeCallRecordTag\(/);
assert.match(source, /allowDisabledRemove: true/);
assert.match(source, /beforeJson/);
assert.match(source, /afterJson/);
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("requestOutboundCall"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("openai"), false);

console.log("call wrapup edit unit tests passed");
