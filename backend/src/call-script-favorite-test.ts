import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { callScriptPickerChoices, parseCallScriptFavoriteBody, parseCallScriptFavoriteQuery } from "./call-script-favorite.js";
import type { CallScriptFavorite, CallScriptTemplate, CrmStore } from "./types.js";

assert.deepEqual(parseCallScriptFavoriteBody({ templateId: "cst_demo" }), { ok: true, templateId: "cst_demo", actorId: null });
assert.deepEqual(parseCallScriptFavoriteBody({ templateId: "cst_demo", actorId: "" }), { ok: true, templateId: "cst_demo", actorId: null });
assert.deepEqual(parseCallScriptFavoriteBody({ templateId: "cst_demo", actorId: "u_sales_shirley" }), { ok: true, templateId: "cst_demo", actorId: "u_sales_shirley" });
assert.deepEqual(parseCallScriptFavoriteQuery({}), { ok: true, actorId: null });
assert.deepEqual(parseCallScriptFavoriteQuery({ actorId: "u_sales_mia" }), { ok: true, actorId: "u_sales_mia" });

for (const body of [
  [{ templateId: "cst_demo" }],
  { templateId: "cst_demo", favorites: [] },
  { templateId: "cst_demo", favoriteIds: ["cst_demo"] },
  { templateId: "cst_demo", templates: [] },
  { templateId: "bad id" },
  { actorId: "u_sales_shirley" },
  { templateId: "cst_demo", actorId: "bad id" },
  {}
]) {
  assert.equal(parseCallScriptFavoriteBody(body).ok, false);
}
assert.equal(parseCallScriptFavoriteQuery({ actorId: ["u_sales_mia"] }).ok, false);
assert.equal(parseCallScriptFavoriteQuery({ includeDisabled: "1" }).ok, false);
assert.equal(parseCallScriptFavoriteQuery({ actorId: "bad id" }).ok, false);

function template(partial: Partial<CallScriptTemplate> & Pick<CallScriptTemplate, "id" | "title" | "enabled">): CallScriptTemplate {
  return {
    teamId: "europe",
    scenario: "first_call",
    language: "zh",
    body: `${partial.title}正文`,
    createdBy: "u_admin",
    updatedBy: "u_admin",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    disabledAt: partial.enabled ? "" : "2026-04-02T00:00:00.000Z",
    ...partial
  };
}

function favorite(partial: Partial<CallScriptFavorite> & Pick<CallScriptFavorite, "actorId" | "templateId" | "createdAt">): CallScriptFavorite {
  return {
    id: `csf_${partial.actorId}_${partial.templateId}`,
    teamId: "europe",
    ...partial
  };
}

const store = {
  callScriptTemplates: [
    template({ id: "cst_b", title: "回访", enabled: true, scenario: "follow_up" }),
    template({ id: "cst_a", title: "开场", enabled: true }),
    template({ id: "cst_c", title: "旧话术", enabled: false }),
    template({ id: "cst_asia", title: "亚洲", enabled: true, teamId: "asia", body: "亚洲正文勿出现" })
  ],
  callScriptFavorites: [
    favorite({ actorId: "u_sales_shirley", templateId: "cst_a", createdAt: "2026-04-03T00:00:00.000Z" }),
    favorite({ actorId: "u_sales_shirley", templateId: "cst_c", createdAt: "2026-04-04T00:00:00.000Z" }),
    favorite({ actorId: "u_sales_mia", templateId: "cst_b", createdAt: "2026-04-05T00:00:00.000Z" }),
    favorite({ actorId: "u_asia", templateId: "cst_asia", createdAt: "2026-04-04T00:00:00.000Z", teamId: "asia" })
  ]
} as Pick<CrmStore, "callScriptTemplates" | "callScriptFavorites">;

const choices = callScriptPickerChoices(store, "europe", "u_sales_shirley");
assert.deepEqual(choices.map((item) => item.id), ["cst_c", "cst_a", "cst_b"]);
assert.equal(choices[0]?.selectable, false);
assert.equal(choices[0]?.enabled, false);
assert.equal(choices[0]?.favorited, true);
assert.equal(choices[1]?.selectable, true);
assert.equal(choices[2]?.favorited, false);
assert.equal(choices.some((item) => item.id === "cst_asia"), false);
assert.equal(JSON.stringify(choices).includes("亚洲正文勿出现"), false);
assert.deepEqual(callScriptPickerChoices(store, "europe", "u_sales_mia").map((item) => item.id), ["cst_b", "cst_a"]);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_script_favorites \(/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_script_favorite_audits \(/);
assert.match(schema, /uniq_call_script_favorites_actor/);
assert.match(schema, /idx_call_script_favorites_team/);
assert.match(schema, /idx_call_script_favorite_audits_team/);
assert.equal(schema.includes("CREATE TABLE call_script_favorites"), false);
assert.equal(schema.includes("CREATE TABLE call_script_favorite_audits"), false);
assert.equal(schema.includes("DROP TABLE call_script_favorites"), false);
assert.equal(schema.includes("DROP TABLE call_script_favorite_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS call_script_favorites"), false);
assert.equal(schema.includes("DROP TABLE call_script_templates"), false);
assert.equal(schema.includes("ALTER TABLE call_script_templates"), false);
assert.equal(schema.includes("ALTER TABLE call_script_favorites"), false);
assert.equal(schema.includes("ALTER TABLE outbound_call_records"), false);

const source = readFileSync(new URL("./call-script-favorite.ts", import.meta.url), "utf8");
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("requestOutboundCall"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("fetch("), false);
assert.match(source, /callScriptFavorites = store\.callScriptFavorites\.filter/);

console.log("call script favorite unit tests passed");
