import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { IamActor } from "./auth.js";
import {
  PROSPECT_NOTE_DENIED,
  PROSPECT_NOTE_TEXT_MAX,
  appendProspectNote,
  normalizeProspectNote,
  prospectNoteBlock
} from "./prospect-notes.js";

const trimmed = normalizeProspectNote("  已电话确认  ");
assert.equal(trimmed.ok, true);
if (trimmed.ok) assert.equal(trimmed.note, "已电话确认");

const blank = normalizeProspectNote("  \n\t ");
assert.equal(blank.ok, false);
if (!blank.ok) assert.equal(blank.message, "请填写备注");

const maxed = normalizeProspectNote(`  ${"备".repeat(PROSPECT_NOTE_TEXT_MAX)}  `);
assert.equal(maxed.ok, true);
if (maxed.ok) assert.equal(maxed.note.length, PROSPECT_NOTE_TEXT_MAX);

const tooLong = normalizeProspectNote("备".repeat(PROSPECT_NOTE_TEXT_MAX + 1));
assert.equal(tooLong.ok, false);
if (!tooLong.ok) assert.equal(tooLong.message, "备注过长");

const first = appendProspectNote(undefined, "第一条");
assert.equal(first.changed, true);
assert.equal(first.notes, "第一条");

const kept = appendProspectNote("  已有备注  ", "新备注");
assert.equal(kept.changed, true);
assert.equal(kept.notes, "  已有备注  \n新备注");
assert.equal(kept.appended, "新备注");

const again = appendProspectNote(kept.notes, "新备注");
assert.equal(again.notes, "  已有备注  \n新备注\n新备注");

const emptyAppend = appendProspectNote("已有", "");
assert.equal(emptyAppend.changed, false);
assert.equal(emptyAppend.notes, "已有");

const sales: IamActor = { id: "u_sales", teamId: "europe", role: "sales" };
const manager: IamActor = { id: "u_manager", teamId: "europe", role: "manager" };
const noExecute: IamActor = {
  id: "u_sales",
  teamId: "europe",
  role: "sales",
  iamPermissions: { "prospect.read": ["self"] }
};
assert.equal(prospectNoteBlock(sales, undefined), PROSPECT_NOTE_DENIED);
assert.equal(prospectNoteBlock(noExecute, { ownerId: "u_sales", teamId: "europe" }), PROSPECT_NOTE_DENIED);
assert.equal(prospectNoteBlock(sales, { ownerId: "u_other", teamId: "europe" }), PROSPECT_NOTE_DENIED);
assert.equal(prospectNoteBlock(sales, { ownerId: "u_sales", teamId: "middle-east" }), PROSPECT_NOTE_DENIED);
assert.equal(prospectNoteBlock(manager, { ownerId: "u_sales", teamId: "middle-east" }), PROSPECT_NOTE_DENIED);
assert.equal(prospectNoteBlock(sales, { ownerId: "u_sales", teamId: "europe" }), null);
assert.equal(prospectNoteBlock(manager, { ownerId: "u_sales", teamId: "europe" }), null);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS prospect_note_audits \(/);
assert.equal(schema.includes("CREATE TABLE prospect_note_audits"), false);
assert.match(schema, /ensureColumn\(pool, "website_opportunities", "notes", "TEXT"\)/);

console.log("prospect note tests passed");
