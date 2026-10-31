import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCallOutcomeRequest } from "./call-outcome.js";
import {
  CALL_OUTCOME_NOTE_MAX,
  CALL_OUTCOMES,
  countCallOutcomes,
  isCallOutcome,
  parseOutboundCallRecordQuery,
  recordsMatchingOutcome
} from "./outbound-call-records.js";

assert.deepEqual([...CALL_OUTCOMES], ["有意向", "需回访", "无意向", "号码错误", "其他"]);
assert.equal(isCallOutcome("有意向"), true);
assert.equal(isCallOutcome("有兴趣"), false);
assert.equal(isCallOutcome("Success"), false);
assert.equal(isCallOutcome(""), false);
assert.equal(CALL_OUTCOME_NOTE_MAX, 200);

assert.deepEqual(parseCallOutcomeRequest({ outcome: " 需回访 ", note: "  回访  " }), {
  ok: true,
  outcome: "需回访",
  note: "回访"
});
assert.deepEqual(parseCallOutcomeRequest({ outcome: "其他" }), { ok: true, outcome: "其他", note: "" });
assert.deepEqual(parseCallOutcomeRequest({ outcome: "其他", note: null }), { ok: true, outcome: "其他", note: "" });
assert.equal(parseCallOutcomeRequest({ outcome: "成交" }).ok, false);
assert.equal(parseCallOutcomeRequest({ outcome: "" }).ok, false);
assert.equal(parseCallOutcomeRequest({ note: "只有备注" }).ok, false);
assert.equal(parseCallOutcomeRequest({ outcome: "有意向", note: 1 }).ok, false);
assert.equal(parseCallOutcomeRequest(["有意向"]).ok, false);
assert.equal(parseCallOutcomeRequest({ outcome: "有意向", records: ["a"] }).ok, false);
assert.equal(parseCallOutcomeRequest({ outcome: "有意向", ids: ["a"] }).ok, false);
assert.equal(parseCallOutcomeRequest({ outcome: "有意向", callRecordIds: ["a"] }).ok, false);
assert.equal(parseCallOutcomeRequest({ outcome: "有意向", outcomes: ["有意向"] }).ok, false);

const exact = "字".repeat(CALL_OUTCOME_NOTE_MAX);
const tooLong = "字".repeat(CALL_OUTCOME_NOTE_MAX + 1);
assert.equal(parseCallOutcomeRequest({ outcome: "号码错误", note: `  ${exact}  ` }).ok, true);
const long = parseCallOutcomeRequest({ outcome: "号码错误", note: tooLong });
assert.equal(long.ok, false);
if (!long.ok) assert.equal(long.reason, "note_too_long");
assert.equal("a".repeat(CALL_OUTCOME_NOTE_MAX).length, CALL_OUTCOME_NOTE_MAX);

assert.deepEqual(countCallOutcomes([
  { callOutcome: "有意向" },
  { callOutcome: "有意向" },
  { callOutcome: "需回访" },
  { callOutcome: "" },
  { callOutcome: "Success" },
  {}
]), {
  "有意向": 2,
  "需回访": 1,
  "无意向": 0,
  "号码错误": 0,
  "其他": 0
});

const rows = [
  { id: "a", callOutcome: "有意向" },
  { id: "b", callOutcome: "" },
  { id: "c", callOutcome: "其他" }
];
assert.deepEqual(recordsMatchingOutcome(rows, null).map((item) => item.id), ["a", "b", "c"]);
assert.deepEqual(recordsMatchingOutcome(rows, "有意向").map((item) => item.id), ["a"]);
assert.deepEqual(recordsMatchingOutcome(rows, "无意向"), []);

assert.equal(parseOutboundCallRecordQuery({ outcome: "有意向" })?.outcome, "有意向");
assert.equal(parseOutboundCallRecordQuery({ outcome: "  " })?.outcome, null);
assert.equal(parseOutboundCallRecordQuery({ outcome: "成交" }), null);
assert.equal(parseOutboundCallRecordQuery({ outcome: ["有意向"] }), null);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_outcome_audits \(/);
assert.equal(schema.includes("CREATE TABLE call_outcome_audits"), false);
assert.match(schema, /call_outcome VARCHAR\(32\) NOT NULL DEFAULT ''/);
assert.match(schema, /call_outcome_note VARCHAR\(200\) NOT NULL DEFAULT ''/);
assert.match(schema, /ensureColumn\(pool, "outbound_call_records", "call_outcome", "VARCHAR\(32\) NOT NULL DEFAULT ''"\)/);
assert.match(schema, /ensureColumn\(pool, "outbound_call_records", "call_outcome_note", "VARCHAR\(200\) NOT NULL DEFAULT ''"\)/);
assert.match(schema, /previous_outcome VARCHAR\(32\) NOT NULL DEFAULT ''/);
assert.match(schema, /next_note VARCHAR\(200\) NOT NULL DEFAULT ''/);

const source = readFileSync(new URL("./call-outcome.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /makeCall|MakeCall|aliyuncs|convert_to_lead|convertProspect|approved_contactable|unsuppress|send-development-email/i);
assert.match(source, /previousOutcome/);
assert.match(source, /nextOutcome/);
assert.match(source, /previousNote/);
assert.match(source, /nextNote/);

console.log("call outcome tests passed");
