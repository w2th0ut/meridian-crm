import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CALL_SCRIPT_BODY_MAX,
  CALL_SCRIPT_TITLE_MAX,
  canManageCallScripts,
  characterCount,
  formatCallScriptValue,
  parseCallScriptCreate,
  parseCallScriptDisable,
  parseCallScriptQuery,
  parseCallScriptUpdate,
  sameCallScript
} from "./call-script.js";

const snapshot = {
  title: "开场",
  scenario: "first_call" as const,
  language: "zh",
  body: "您好，这里是科多多。",
  enabled: true
};

assert.equal(formatCallScriptValue(null), "");
assert.match(formatCallScriptValue(snapshot), /^enabled=1\nscenario=first_call\nlanguage=zh\ntitle=开场\n---\n您好，这里是科多多。$/);
assert.equal(sameCallScript(snapshot, { ...snapshot }), true);
assert.equal(sameCallScript(snapshot, { ...snapshot, enabled: false }), false);
assert.equal(canManageCallScripts({ role: "admin", teamId: "europe" }), true);
assert.equal(canManageCallScripts({ role: "super_admin", teamId: "europe" }), true);
assert.equal(canManageCallScripts({ role: "manager", teamId: "europe" }), false);
assert.equal(canManageCallScripts({ role: "sales", teamId: "europe" }), false);
assert.equal(canManageCallScripts({ role: "admin", teamId: "all" }), false);

const created = parseCallScriptCreate({ title: " 开场 ", scenario: "follow_up", body: " 回访正文 " });
assert.equal(created.ok && created.snapshot.language, "");
assert.equal(created.ok && created.snapshot.title, "开场");
assert.equal(created.ok && created.snapshot.body, "回访正文");
assert.equal(parseCallScriptCreate({ title: "开场", scenario: "objection", body: "正文", language: "zh-CN" }).ok, true);
assert.equal(parseCallScriptCreate({ title: "标".repeat(CALL_SCRIPT_TITLE_MAX), scenario: "missed_callback", body: "文".repeat(CALL_SCRIPT_BODY_MAX) }).ok, true);

for (const body of [
  { title: "开场", scenario: "first_call", body: "正文", templates: [] },
  { title: "开场", scenario: "first_call", body: "正文", ids: ["a"] },
  [{ title: "开场", scenario: "first_call", body: "正文" }],
  { title: "", scenario: "first_call", body: "正文" },
  { title: "标".repeat(CALL_SCRIPT_TITLE_MAX + 1), scenario: "first_call", body: "正文" },
  { title: "开场\n第二行", scenario: "first_call", body: "正文" },
  { title: "开场", scenario: "other", body: "正文" },
  { title: "开场", scenario: "first_call", body: "" },
  { title: "开场", scenario: "first_call", body: "文".repeat(CALL_SCRIPT_BODY_MAX + 1) },
  { title: "开场", scenario: "first_call", body: 12 },
  { title: "开场", scenario: "first_call", body: "正文", language: "中文" },
  { title: "开场", scenario: "first_call", body: "正文", language: "zh_CN" }
]) {
  assert.equal(parseCallScriptCreate(body).ok, false);
}

const updated = parseCallScriptUpdate({ id: "cst_demo", title: "开场", scenario: "first_call", body: "正文", language: null });
assert.equal(updated.ok && updated.id, "cst_demo");
assert.equal(parseCallScriptUpdate({ id: "bad id", title: "开场", scenario: "first_call", body: "正文" }).ok, false);
assert.equal(parseCallScriptUpdate({ title: "开场", scenario: "first_call", body: "正文" }).ok, false);
assert.equal(parseCallScriptDisable({ id: "cst_demo" }).ok, true);
assert.equal(parseCallScriptDisable({ id: "cst_demo", title: "开场" }).ok, false);
assert.equal(parseCallScriptDisable({ ids: ["cst_demo"] }).ok, false);
assert.deepEqual(parseCallScriptQuery({}), { ok: true, scenario: null, includeDisabled: false });
assert.deepEqual(parseCallScriptQuery({ scenario: "objection", includeDisabled: "1" }), { ok: true, scenario: "objection", includeDisabled: true });
assert.equal(parseCallScriptQuery({ scenario: ["first_call"] }).ok, false);
assert.equal(parseCallScriptQuery({ scenario: "nope" }).ok, false);
assert.equal(parseCallScriptQuery({ includeDisabled: "yes" }).ok, false);
assert.equal(characterCount("文".repeat(3)), 3);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_script_templates \(/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_script_audits \(/);
assert.equal(schema.includes("CREATE TABLE call_script_templates"), false);
assert.equal(schema.includes("CREATE TABLE call_script_audits"), false);
assert.equal(schema.includes("DROP TABLE call_script_templates"), false);
assert.equal(schema.includes("DROP TABLE call_script_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS call_script_templates"), false);
assert.match(schema, /idx_call_script_templates_team/);
assert.match(schema, /previous_value TEXT/);
assert.match(schema, /next_value TEXT/);

const source = readFileSync(new URL("./call-script.ts", import.meta.url), "utf8");
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("requestOutboundCall"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);

console.log("call script unit tests passed");
