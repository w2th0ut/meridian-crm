import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appendCallOutcomeNote, CALL_NOTE_APPEND_MAX, parseCallNoteAppendBatch } from "./call-note-append-batch.js";
import { intentFollowupLabeledAt } from "./intent-followup-queue.js";
import type { CallOutcomeAudit, OutboundCallRecord } from "./types.js";

assert.deepEqual(appendCallOutcomeNote("", "补一句"), { status: "ready", next: "补一句" });
assert.deepEqual(appendCallOutcomeNote("  原备注  ", "补一句"), { status: "ready", next: "原备注 补一句" });
assert.deepEqual(appendCallOutcomeNote("字".repeat(199), "补"), { status: "too_long" });
assert.equal(appendCallOutcomeNote("", "字".repeat(200)).status, "ready");

const ok = parseCallNoteAppendBatch({ callRecordIds: ["ocr_1"], note: "  补一句  ", phraseId: "csp_1" });
assert.equal(ok.ok, true);
if (ok.ok) {
  assert.deepEqual(ok.callRecordIds, ["ocr_1"]);
  assert.equal(ok.note, "补一句");
  assert.equal(ok.phraseId, "csp_1");
}
assert.equal(parseCallNoteAppendBatch({ callRecordIds: ["ocr_1"], phraseId: "csp_1" }).ok, true);
assert.equal(parseCallNoteAppendBatch({ callRecordIds: [] }).ok, false);
assert.equal(parseCallNoteAppendBatch({ callRecordIds: ["ocr_1", "ocr_1"], note: "补" }).ok, false);
assert.equal(parseCallNoteAppendBatch({ callRecordIds: ["ocr_1"], note: "字".repeat(201) }).ok, false);
assert.equal(parseCallNoteAppendBatch({
  callRecordIds: Array.from({ length: CALL_NOTE_APPEND_MAX + 1 }, (_, index) => `c${index}`),
  note: "补"
}).ok, false);
assert.equal(parseCallNoteAppendBatch({ callRecordIds: ["ocr_1"], note: "补", outcome: "其他" }).ok, false);
assert.equal(parseCallNoteAppendBatch({ callRecordIds: ["ocr_1"], note: "补", targets: [] }).ok, false);
assert.equal(parseCallNoteAppendBatch({ records: ["ocr_1"], note: "补" }).ok, false);
assert.equal(parseCallNoteAppendBatch({ callRecordIds: ["ocr_1"], phraseId: "有空格" }).ok, false);
assert.equal(parseCallNoteAppendBatch({ callRecordIds: ["bad id"], note: "补" }).ok, false);

const record = {
  teamId: "europe",
  id: "ocr_label",
  callOutcome: "有意向",
  updatedAt: "2026-04-01T00:00:00.000Z",
  createdAt: "2026-04-01T00:00:00.000Z"
} as OutboundCallRecord;
const labeledAt = intentFollowupLabeledAt(record, [
  { teamId: "europe", callRecordId: "ocr_label", nextOutcome: "有意向", at: "2026-04-02T00:00:00.000Z", action: "" },
  { teamId: "europe", callRecordId: "ocr_label", nextOutcome: "有意向", at: "2026-04-03T00:00:00.000Z", action: "append" },
  { teamId: "europe", callRecordId: "ocr_label", nextOutcome: "有意向", at: "2026-04-04T00:00:00.000Z", action: "read" }
] as CallOutcomeAudit[]);
assert.equal(labeledAt, "2026-04-02T00:00:00.000Z");

const source = readFileSync(new URL("./call-note-append-batch.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(source, /action: "append"/);
assert.equal(source.includes("ensureColumn"), false);
assert.equal(source.includes("CREATE TABLE"), false);
assert.equal(schema.includes("CREATE TABLE call_outcome_note"), false);
assert.equal(schema.includes("CREATE TABLE call_note_append"), false);
assert.equal(schema.includes("DROP TABLE call_outcome_audits"), false);
assert.equal(schema.includes("DROP TABLE call_script_templates"), false);
assert.equal(schema.includes("DROP COLUMN batch_id"), false);

console.log("call note append batch tests passed");
