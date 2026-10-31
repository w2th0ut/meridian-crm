import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PROSPECT_NOTE_BATCH_LIMIT,
  PROSPECT_NOTE_TEXT_MAX,
  buildProspectNoteBody,
  showProspectNoteEntry,
  summarizeProspectNoteChange
} from "./prospect-batch-notes.js";

assert.equal(showProspectNoteEntry(false), false);
assert.equal(showProspectNoteEntry(true), true);

const empty = buildProspectNoteBody([], "已电话确认");
assert.equal(empty.ok, false);
if (!empty.ok) assert.equal(empty.message, "请先选择候选");

const missing = buildProspectNoteBody(["web_seed_1"], "  \n ");
assert.equal(missing.ok, false);
if (!missing.ok) assert.equal(missing.message, "请填写备注");

const tooLong = buildProspectNoteBody(["web_seed_1"], "备".repeat(PROSPECT_NOTE_TEXT_MAX + 1));
assert.equal(tooLong.ok, false);
if (!tooLong.ok) assert.equal(tooLong.message, "备注过长");

const overRows = buildProspectNoteBody(
  Array.from({ length: PROSPECT_NOTE_BATCH_LIMIT + 1 }, (_, index) => `web_${index}`),
  "已电话确认"
);
assert.equal(overRows.ok, false);
if (!overRows.ok) assert.match(overRows.message, /100/);

const built = buildProspectNoteBody([" web_a ", "web_a", "web_b"], "  已电话确认  ");
assert.equal(built.ok, true);
if (built.ok) {
  assert.deepEqual(built.body, {
    ids: ["web_a", "web_b"],
    note: "已电话确认"
  });
}

const maxed = buildProspectNoteBody(["web_a"], ` ${"备".repeat(PROSPECT_NOTE_TEXT_MAX)} `);
assert.equal(maxed.ok, true);
if (maxed.ok) assert.equal(maxed.body.note.length, PROSPECT_NOTE_TEXT_MAX);

assert.equal(summarizeProspectNoteChange([
  { ok: true },
  { ok: true }
]), "已为 2 条追加备注");
assert.equal(summarizeProspectNoteChange([
  { ok: true },
  { ok: false, reason: "无权追加该候选的备注" }
]), "已为 1 条追加备注。未改 1 条：无权追加该候选的备注");

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /id="prospectAppendNotesButton"[^>]*hidden/);
assert.match(html, /批量追加备注/);
const apiLayer = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(apiLayer, /\/api\/prospect-list\/notes/);
assert.match(apiLayer, /showProspectNoteEntry/);
assert.match(apiLayer, /confirmProspectNotesButton/);
assert.match(apiLayer, /data-prospect-notes/);
assert.doesNotMatch(apiLayer, /submitProspectNotes[\s\S]{0,900}outbound|submitProspectNotes[\s\S]{0,500}\/api\/prospect-list\/batch|submitProspectNotes[\s\S]{0,700}send-development-email|submitProspectNotes[\s\S]{0,700}convert-to-lead/);

console.log("prospect batch notes frontend tests passed");
