import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CALL_NOTE_MAX,
  CALL_NOTE_TAGS,
  callNoteAction,
  callNoteLength,
  normalizeCallNoteTags,
  parseCallNoteRequest,
  recordHasCallNote
} from "./call-note.js";
import { parseOutboundCallRecordQuery, recordsMatchingNote } from "./outbound-call-records.js";

assert.deepEqual([...CALL_NOTE_TAGS], ["需求", "预算", "决策人", "竞品", "异议"]);
assert.equal(CALL_NOTE_MAX, 1000);
assert.equal(callNoteLength("字".repeat(3)), 3);

assert.deepEqual(parseCallNoteRequest({ note: "  要样品  ", tags: ["竞品", "需求", "需求"] }), {
  ok: true,
  note: "要样品",
  tags: "需求,竞品"
});
assert.deepEqual(parseCallNoteRequest({}), { ok: true, note: "", tags: "" });
assert.deepEqual(parseCallNoteRequest({ note: null, tags: null }), { ok: true, note: "", tags: "" });
assert.equal(parseCallNoteRequest({ note: 1 }).ok, false);
assert.equal(parseCallNoteRequest({ tags: "需求" }).ok, false);
assert.equal(parseCallNoteRequest({ tags: ["价格"] }).ok, false);
assert.equal(parseCallNoteRequest(["纪要"]).ok, false);
assert.equal(parseCallNoteRequest({ note: "一条", records: ["a"] }).ok, false);
assert.equal(parseCallNoteRequest({ note: "一条", ids: ["a"] }).ok, false);
assert.equal(parseCallNoteRequest({ note: "一条", outcomes: ["有意向"] }).ok, false);
assert.equal(parseCallNoteRequest({ note: "一条", extra: true }).ok, false);

const exact = "字".repeat(CALL_NOTE_MAX);
const tooLong = parseCallNoteRequest({ note: `  ${"字".repeat(CALL_NOTE_MAX + 1)}  ` });
assert.equal(parseCallNoteRequest({ note: `  ${exact}  ` }).ok, true);
assert.equal(tooLong.ok, false);
if (!tooLong.ok) assert.equal(tooLong.reason, "note_too_long");
assert.equal(normalizeCallNoteTags([]).ok, true);

assert.equal(callNoteAction("", "", "有", ""), "create");
assert.equal(callNoteAction("有", "", "改", ""), "update");
assert.equal(callNoteAction("有", "需求", "", ""), "clear");
assert.equal(callNoteAction("", "", "", "需求"), "create");
assert.equal(recordHasCallNote({ callNote: "  ", callNoteTags: "" }), false);
assert.equal(recordHasCallNote({ callNote: "", callNoteTags: "预算" }), true);

const rows = [
  { id: "a", callNote: "有", callNoteTags: "" },
  { id: "b", callNote: "", callNoteTags: "" },
  { id: "c", callNote: "", callNoteTags: "异议" }
];
assert.deepEqual(recordsMatchingNote(rows, null).map((item) => item.id), ["a", "b", "c"]);
assert.deepEqual(recordsMatchingNote(rows, "has").map((item) => item.id), ["a", "c"]);
assert.deepEqual(recordsMatchingNote(rows, "none").map((item) => item.id), ["b"]);

assert.equal(parseOutboundCallRecordQuery({ note: "has" })?.note, "has");
assert.equal(parseOutboundCallRecordQuery({ note: " none " })?.note, "none");
assert.equal(parseOutboundCallRecordQuery({ note: "" })?.note, null);
assert.equal(parseOutboundCallRecordQuery({ note: "all" }), null);
assert.equal(parseOutboundCallRecordQuery({ note: ["has"] }), null);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_note_audits \(/);
assert.equal(schema.includes("CREATE TABLE call_note_audits"), false);
assert.match(schema, /call_note VARCHAR\(1000\) NOT NULL DEFAULT ''/);
assert.match(schema, /call_note_tags VARCHAR\(64\) NOT NULL DEFAULT ''/);
assert.match(schema, /call_note_updated_at VARCHAR\(40\) NOT NULL DEFAULT ''/);
assert.match(schema, /ensureColumn\(pool, "outbound_call_records", "call_note", "VARCHAR\(1000\) NOT NULL DEFAULT ''"\)/);
assert.match(schema, /ensureColumn\(pool, "outbound_call_records", "call_note_tags", "VARCHAR\(64\) NOT NULL DEFAULT ''"\)/);
assert.match(schema, /ensureColumn\(pool, "outbound_call_records", "call_note_updated_at", "VARCHAR\(40\) NOT NULL DEFAULT ''"\)/);
assert.match(schema, /previous_note VARCHAR\(1000\) NOT NULL DEFAULT ''/);
assert.match(schema, /next_tags VARCHAR\(64\) NOT NULL DEFAULT ''/);

const source = readFileSync(new URL("./call-note.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /makeCall|MakeCall|aliyuncs|convert_to_lead|convertProspect|approved_contactable|unsuppress|send-development-email|fetch\(/i);
assert.match(source, /previousNote/);
assert.match(source, /nextNote/);
assert.match(source, /previousTags/);
assert.match(source, /nextTags/);
assert.match(source, /callNotesForTarget/);

console.log("call note tests passed");
