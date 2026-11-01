import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CALL_NOTE_MAX } from "./call-note.js";
import { parseCallWrapupRequest } from "./call-wrapup.js";
import { CALL_OUTCOME_NOTE_MAX } from "./outbound-call-records.js";

const ok = parseCallWrapupRequest({
  outcome: { outcome: " 需回访 ", note: " 下午 " },
  note: { note: "要样品", tags: ["需求"] },
  script: { templateId: "cst_a" },
  callTag: { tagId: "ctag_a" },
  callback: { scheduledAt: "2026-12-01 09:30", note: "约好了" }
});
assert.equal(ok.ok, true);
if (ok.ok) {
  assert.deepEqual(ok.parts, ["outcome", "note", "script", "callTag", "callback"]);
  assert.equal(ok.callTagAction, "add");
}
const remove = parseCallWrapupRequest({ callTag: { tagId: "ctag_a", action: "remove" } });
assert.equal(remove.ok, true);
if (remove.ok) assert.equal(remove.callTagAction, "remove");
assert.equal(parseCallWrapupRequest({}).ok, false);
assert.equal(parseCallWrapupRequest([]).ok, false);
assert.equal(parseCallWrapupRequest({ outcome: { outcome: "成交" } }).ok, false);
assert.equal(parseCallWrapupRequest({ outcome: { outcome: "其他", note: "字".repeat(CALL_OUTCOME_NOTE_MAX + 1) } }).ok, false);
assert.equal(parseCallWrapupRequest({ note: { note: "字".repeat(CALL_NOTE_MAX + 1), tags: [] } }).ok, false);
assert.equal(parseCallWrapupRequest({ note: { note: "a", tags: ["价格"] } }).ok, false);
assert.equal(parseCallWrapupRequest({ script: {} }).ok, false);
assert.equal(parseCallWrapupRequest({ callTag: { tagId: "ctag_a", action: "rename" } }).ok, false);
assert.equal(parseCallWrapupRequest({ callTag: { tagIds: ["ctag_a"] } }).ok, false);
assert.equal(parseCallWrapupRequest({ callback: { scheduledAt: "明天" } }).ok, false);
assert.equal(parseCallWrapupRequest({ outcome: { outcome: "其他" }, records: ["a"] }).ok, false);
assert.equal(parseCallWrapupRequest({ outcome: { outcome: "其他" }, tags: ["a"] }).ok, false);
assert.equal(parseCallWrapupRequest({ outcome: { outcome: "其他" }, tagIds: ["a"] }).ok, false);
assert.equal(parseCallWrapupRequest({ extra: true, outcome: { outcome: "其他" } }).ok, false);
assert.equal(parseCallWrapupRequest({ outcome: { outcome: "其他", note: "字".repeat(CALL_OUTCOME_NOTE_MAX) } }).ok, true);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_wrapup_audits \(/);
assert.match(schema, /parts_json VARCHAR\(1000\)/);
assert.equal(schema.includes("CREATE TABLE call_wrapup_audits"), false);
assert.equal(schema.includes("DROP TABLE call_wrapup_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS call_wrapup_audits"), false);
assert.equal(schema.includes("ALTER TABLE call_wrapup_audits"), false);
assert.equal(schema.includes("ALTER TABLE call_outcome_audits"), false);
assert.equal(schema.includes("ALTER TABLE call_note_audits"), false);
assert.equal(schema.includes("ALTER TABLE call_script_usage_audits"), false);
assert.equal(schema.includes("ALTER TABLE call_tag_audits"), false);
assert.equal(schema.includes("ALTER TABLE callback_schedule_audits"), false);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS call_wrapup_audits \(/g) || []).length, 1);

const source = readFileSync(new URL("./call-wrapup.ts", import.meta.url), "utf8");
assert.match(source, /labelCallOutcome\(/);
assert.match(source, /saveCallNote\(/);
assert.match(source, /saveCallScriptUsage\(/);
assert.match(source, /addCallRecordTag\(/);
assert.match(source, /removeCallRecordTag\(/);
assert.match(source, /scheduleCallbackOnCall\(/);
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("requestOutboundCall"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("openai"), false);

console.log("call wrapup unit tests passed");
