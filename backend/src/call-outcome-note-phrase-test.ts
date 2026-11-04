import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { importCallScriptScenariosFromTemplates } from "./call-script-scenario.js";
import { isSpokenCallScript } from "./call-script.js";
import {
  CALL_OUTCOME_NOTE_PHRASE_MAX,
  createOutcomeNotePhrase,
  disableOutcomeNotePhrase,
  formatOutcomeNotePhraseValue,
  listOutcomeNotePhrases,
  parseOutcomeNotePhraseCreate,
  parseOutcomeNotePhraseDisable,
  parseOutcomeNotePhraseQuery
} from "./call-outcome-note-phrase.js";
import type { CrmStore } from "./store.js";
import type { CallScriptAudit, CallScriptTemplate, SessionUser } from "./types.js";

assert.equal(isSpokenCallScript({}), true);
assert.equal(isSpokenCallScript({ usageKind: "script" }), true);
assert.equal(isSpokenCallScript({ usageKind: "outcome_note" }), false);
assert.equal(CALL_OUTCOME_NOTE_PHRASE_MAX, 200);
assert.equal(formatOutcomeNotePhraseValue(null), "");
assert.match(formatOutcomeNotePhraseValue({ enabled: true, scope: "team", text: "要样品" }), /^enabled=1\nscope=team\n---\n要样品$/);

const created = parseOutcomeNotePhraseCreate({ text: "  要样品  ", scope: "personal" });
assert.equal(created.ok && created.text, "要样品");
assert.equal(created.ok && created.scope, "personal");
assert.equal(parseOutcomeNotePhraseCreate({ text: "文".repeat(200), scope: "team" }).ok, true);
for (const body of [
  { text: "要样品", scope: "team", phrases: [] },
  { text: "要样品", scope: "team", ids: ["a"] },
  [{ text: "要样品", scope: "personal" }],
  { text: "", scope: "personal" },
  { text: "要\n样品", scope: "personal" },
  { text: "文".repeat(201), scope: "team" },
  { text: 12, scope: "team" },
  { text: "要样品" },
  { text: "要样品", scope: "org" },
  { text: "要样品", scope: "personal", note: "x" }
]) {
  assert.equal(parseOutcomeNotePhraseCreate(body).ok, false);
}
assert.equal(parseOutcomeNotePhraseDisable({ id: "csp_demo" }).ok, true);
assert.equal(parseOutcomeNotePhraseDisable({ id: "csp_demo", text: "要样品" }).ok, false);
assert.equal(parseOutcomeNotePhraseDisable({ ids: ["csp_demo"] }).ok, false);
assert.deepEqual(parseOutcomeNotePhraseQuery({}), { ok: true, includeDisabled: false });
assert.deepEqual(parseOutcomeNotePhraseQuery({ includeDisabled: "1" }), { ok: true, includeDisabled: true });
assert.equal(parseOutcomeNotePhraseQuery({ includeDisabled: "yes" }).ok, false);
assert.equal(parseOutcomeNotePhraseQuery({ includeDisabled: ["1"] }).ok, false);
assert.equal(parseOutcomeNotePhraseQuery({ scope: "team" }).ok, false);

const scenarios = {
  callScriptTemplates: [{
    id: "csp_scene",
    teamId: "europe",
    title: "要样品",
    scenario: "note_phrase",
    language: "",
    body: "要样品",
    enabled: true,
    createdBy: "u1",
    updatedBy: "u1",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    disabledAt: "",
    usageKind: "outcome_note" as const,
    ownerId: ""
  }],
  callScriptScenarios: []
};
assert.equal(importCallScriptScenariosFromTemplates(scenarios), 0);
assert.equal(scenarios.callScriptScenarios.length, 0);

const read = { "communication.read": ["self" as const] };
const shirley = { id: "u_sales_shirley", teamId: "europe", role: "sales", name: "Shirley", iamPermissions: read } as SessionUser;
const mia = { id: "u_sales_mia", teamId: "europe", role: "sales", name: "Mia", iamPermissions: read } as SessionUser;
const alex = { id: "u_manager_alex", teamId: "europe", role: "manager", name: "Alex", iamPermissions: { "communication.read": ["org_subtree" as const] } } as SessionUser;
const templates: CallScriptTemplate[] = [];
const audits: CallScriptAudit[] = [];
const store = { callScriptTemplates: templates, callScriptAudits: audits, persist: async () => undefined } as unknown as CrmStore;

const personal = await createOutcomeNotePhrase(store, shirley, { text: "要样品", scope: "personal" });
assert.equal(personal.status, 200);
assert.equal(personal.body.result, "created");
const personalId = personal.body.phrase && "id" in personal.body.phrase ? personal.body.phrase.id : "";
assert.match(personalId, /^csp_/);
assert.equal(templates[0]?.scenario, "");
assert.equal(templates[0]?.usageKind, "outcome_note");
assert.equal(templates[0]?.ownerId, shirley.id);
assert.equal(audits[0]?.action, "phrase_create");
assert.equal(audits.length, 1);

const again = await createOutcomeNotePhrase(store, shirley, { text: "要样品", scope: "personal" });
assert.equal(again.body.result, "unchanged");
assert.equal(audits.length, 1);
assert.equal(templates.length, 1);

const team = await createOutcomeNotePhrase(store, shirley, { text: "下周再打", scope: "team" });
assert.equal(team.body.result, "created");
const teamId = team.body.phrase && "id" in team.body.phrase ? team.body.phrase.id : "";
assert.equal(templates.find((item) => item.id === teamId)?.ownerId, "");

const sameTeam = await createOutcomeNotePhrase(store, mia, { text: "下周再打", scope: "team" });
assert.equal(sameTeam.body.result, "unchanged");
assert.equal(templates.filter((item) => item.usageKind === "outcome_note").length, 2);

const listed = await listOutcomeNotePhrases(store, mia, {});
assert.equal(listed.status, 200);
const phrases = listed.body.phrases || [];
assert.equal(phrases.some((item) => item.text === "要样品"), false);
assert.equal(phrases.some((item) => item.text === "下周再打" && item.canDisable === false), true);
assert.equal(audits.filter((item) => item.action === "phrase_read").length, 0);

const hidden = await disableOutcomeNotePhrase(store, mia, { id: personalId });
assert.equal(hidden.status, 403);
assert.equal(templates.find((item) => item.id === personalId)?.enabled, true);
assert.equal(audits[0]?.previousValue, "");
assert.equal(audits[0]?.nextValue, "");

const teamDenied = await disableOutcomeNotePhrase(store, mia, { id: teamId });
assert.equal(teamDenied.status, 403);
assert.equal(templates.find((item) => item.id === teamId)?.enabled, true);
assert.equal(audits[0]?.previousValue.includes("下周再打"), true);

const governed = await disableOutcomeNotePhrase(store, alex, { id: teamId });
assert.equal(governed.body.result, "disabled");
assert.equal(templates.find((item) => item.id === teamId)?.enabled, false);
const repeat = await disableOutcomeNotePhrase(store, alex, { id: teamId });
assert.equal(repeat.body.result, "unchanged");
assert.equal(audits.filter((item) => item.action === "phrase_disable" && item.result === "updated").length, 1);

const withDisabled = await listOutcomeNotePhrases(store, alex, { includeDisabled: "1" });
assert.equal(withDisabled.body.phrases?.some((item) => item.id === teamId && item.enabled === false), true);
const withoutDisabled = await listOutcomeNotePhrases(store, shirley, {});
assert.equal(withoutDisabled.body.phrases?.some((item) => item.id === teamId), false);
assert.equal(withoutDisabled.body.phrases?.some((item) => item.text === "要样品"), true);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /ensureColumn\(pool, "call_script_templates", "usage_kind", "VARCHAR\(32\) NOT NULL DEFAULT 'script'"\)/);
assert.match(schema, /ensureColumn\(pool, "call_script_templates", "owner_id", "VARCHAR\(64\) NOT NULL DEFAULT ''"\)/);
assert.match(schema, /usage_kind VARCHAR\(32\) NOT NULL DEFAULT 'script'/);
assert.match(schema, /WHERE scenario <> '' AND usage_kind = 'script'/);
assert.equal(schema.includes("CREATE TABLE IF NOT EXISTS call_outcome_note_phrases"), false);
assert.equal(schema.includes("CREATE TABLE call_outcome_note_phrases"), false);
assert.equal(schema.includes("DROP TABLE call_script_templates"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS call_script_templates"), false);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS call_script_templates \(/g) || []).length, 1);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS call_script_audits \(/g) || []).length, 1);

const source = readFileSync(new URL("./call-outcome-note-phrase.ts", import.meta.url), "utf8");
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("requestOutboundCall"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("CREATE TABLE"), false);

console.log("call outcome note phrase unit tests passed");
