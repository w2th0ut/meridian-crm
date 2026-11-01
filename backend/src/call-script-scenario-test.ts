import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CALL_SCRIPT_SCENARIO_NAME_MAX,
  CALL_SCRIPT_SCENARIO_SORT_MAX,
  enabledScenarioCodes,
  formatCallScriptScenarioValue,
  importCallScriptScenariosFromTemplates,
  importedCallScriptScenarioId,
  knownScenarioCodes,
  parseCallScriptScenarioCreate,
  parseCallScriptScenarioDisable,
  parseCallScriptScenarioQuery,
  parseCallScriptScenarioRename,
  parseCallScriptScenarioReorder,
  scenarioViews
} from "./call-script-scenario.js";
import type { CallScriptScenarioRow, CallScriptTemplate } from "./types.js";

assert.equal(parseCallScriptScenarioCreate({ name: " 续约 " }).ok, true);
assert.equal(parseCallScriptScenarioCreate({ name: "" }).ok, false);
assert.equal(parseCallScriptScenarioCreate({ name: "名".repeat(CALL_SCRIPT_SCENARIO_NAME_MAX + 1) }).ok, false);
assert.equal(parseCallScriptScenarioCreate({ name: "续约", scenarios: [] }).ok, false);
assert.equal(parseCallScriptScenarioRename({ code: "first_call", name: "初次联系" }).ok, true);
assert.equal(parseCallScriptScenarioRename({ code: "First", name: "初次联系" }).ok, false);
assert.equal(parseCallScriptScenarioReorder({ code: "follow_up", sortOrder: 0 }).ok, true);
assert.equal(parseCallScriptScenarioReorder({ code: "follow_up", sortOrder: CALL_SCRIPT_SCENARIO_SORT_MAX }).ok, true);
assert.equal(parseCallScriptScenarioReorder({ code: "follow_up", sortOrder: CALL_SCRIPT_SCENARIO_SORT_MAX + 1 }).ok, false);
assert.equal(parseCallScriptScenarioReorder({ code: "follow_up", sortOrder: 1.5 }).ok, false);
assert.equal(parseCallScriptScenarioReorder({ code: "follow_up", sortOrder: "1" }).ok, false);
assert.equal(parseCallScriptScenarioDisable({ code: "objection" }).ok, true);
assert.equal(parseCallScriptScenarioDisable({ code: "objection", name: "异议" }).ok, false);
assert.equal(parseCallScriptScenarioDisable({ codes: ["objection"] }).ok, false);
assert.equal(parseCallScriptScenarioQuery({}).ok, true);
assert.equal(parseCallScriptScenarioQuery({ scenario: "first_call" }).ok, false);

const value = formatCallScriptScenarioValue({ enabled: true, code: "first_call", sortOrder: 10, name: "首呼" });
assert.match(value, /^enabled=1\ncode=first_call\nsort=10\nname=首呼$/);
assert.equal(value.includes("13800138000"), false);

function template(partial: Partial<CallScriptTemplate> & Pick<CallScriptTemplate, "id" | "teamId" | "scenario">): CallScriptTemplate {
  return {
    title: partial.id,
    language: "",
    body: "正文不进场景表",
    enabled: true,
    createdBy: "u_admin",
    updatedBy: "u_admin",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    disabledAt: "",
    ...partial
  };
}

const before = template({ id: "cst_1", teamId: "europe", scenario: "first_call" });
const snapshot = JSON.stringify(before);
const store = {
  callScriptTemplates: [
    before,
    template({ id: "cst_2", teamId: "europe", scenario: "first_call" }),
    template({ id: "cst_3", teamId: "europe", scenario: "follow_up" }),
    template({ id: "cst_asia", teamId: "asia", scenario: "first_call", body: "亚洲正文勿出现" })
  ],
  callScriptScenarios: [] as CallScriptScenarioRow[]
};
assert.equal(importCallScriptScenariosFromTemplates(store), 3);
assert.equal(importCallScriptScenariosFromTemplates(store), 0);
assert.equal(store.callScriptScenarios.length, 3);
assert.equal(JSON.stringify(before), snapshot);
assert.equal(store.callScriptScenarios.filter((item) => item.teamId === "europe" && item.code === "first_call").length, 1);
assert.equal(store.callScriptScenarios.find((item) => item.code === "first_call" && item.teamId === "europe")?.name, "首呼");
assert.equal(store.callScriptScenarios.find((item) => item.teamId === "europe" && item.code === "first_call")?.id, importedCallScriptScenarioId("europe", "first_call"));
assert.equal(JSON.stringify(store.callScriptScenarios).includes("亚洲正文勿出现"), false);
assert.equal(JSON.stringify(store.callScriptScenarios).includes("正文不进场景表"), false);

store.callScriptScenarios.find((item) => item.teamId === "europe" && item.code === "follow_up")!.enabled = false;
store.callScriptScenarios.find((item) => item.teamId === "europe" && item.code === "follow_up")!.name = "再访";
const views = scenarioViews(store, "europe").map((item) => item.code);
assert.deepEqual(views, ["first_call", "follow_up", "missed_callback", "objection"]);
assert.equal(scenarioViews(store, "europe").find((item) => item.code === "follow_up")?.name, "再访");
assert.equal(enabledScenarioCodes(store, "europe").has("follow_up"), false);
assert.equal(enabledScenarioCodes(store, "europe").has("first_call"), true);
assert.equal(knownScenarioCodes(store, "europe").has("follow_up"), true);
assert.equal(knownScenarioCodes(store, "europe").has("nope"), false);
assert.equal(enabledScenarioCodes(store, "asia").has("first_call"), true);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_script_scenarios \(/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_script_scenario_audits \(/);
assert.match(schema, /INSERT INTO call_script_scenarios/);
assert.match(schema, /WHERE NOT EXISTS/);
assert.equal(schema.includes("CREATE TABLE call_script_scenarios"), false);
assert.equal(schema.includes("DROP TABLE call_script_scenarios"), false);
assert.equal(schema.includes("DROP TABLE call_script_templates"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS call_script_templates"), false);
assert.equal(schema.includes("ALTER TABLE call_script_templates"), false);
assert.match(schema, /uniq_call_script_scenarios_code/);

const source = readFileSync(new URL("./call-script-scenario.ts", import.meta.url), "utf8");
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("requestOutboundCall"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);

console.log("call script scenario unit tests passed");
