import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  callScriptScenarioCreateBody,
  callScriptScenarioDisableBody,
  callScriptScenarioRenameBody,
  callScriptScenarioReorderBody,
  readCallScriptDraft,
  renderCallScriptAside,
  renderCallScriptScenarioAdmin,
  renderCallScriptScenarioOptions
} from "./call-script.js";
import { renderCallScriptReportScenarioOptions } from "./call-script-report.js";

const scenarios = [
  { id: "objection", label: "异议<script>", code: "objection", name: "异议<script>", sortOrder: 0, enabled: true },
  { id: "first_call", label: "初次联系", code: "first_call", name: "初次联系", sortOrder: 10, enabled: true },
  { id: "follow_up", label: "回访", code: "follow_up", name: "回访", sortOrder: 20, enabled: false }
];

const options = renderCallScriptScenarioOptions("", true, scenarios);
assert.match(options, /value="objection"/);
assert.ok(options.indexOf("value=\"objection\"") < options.indexOf("value=\"first_call\""));
assert.ok(options.indexOf("value=\"first_call\"") < options.indexOf("value=\"follow_up\""));
assert.match(options, /异议&lt;script&gt;/);
assert.equal(options.includes("<script>"), false);

const writable = renderCallScriptScenarioOptions("first_call", false, scenarios, true);
assert.match(writable, /初次联系/);
assert.equal(writable.includes("回访"), false);
assert.equal(writable.includes("value=\"follow_up\""), false);

const aside = renderCallScriptAside([
  { id: "cst_a", title: "开场", scenario: "first_call", scenarioLabel: "初次联系", body: "正文", enabled: true }
], "first_call", {}, scenarios);
assert.match(aside, /初次联系/);
assert.match(aside, /data-call-script-scenario/);
assert.equal(aside.includes("<script>"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(aside), false);

const admin = renderCallScriptScenarioAdmin(scenarios);
assert.match(admin, /data-call-script-scenario-row="objection"/);
assert.match(admin, /data-call-script-scenario-rename="first_call"/);
assert.match(admin, /data-call-script-scenario-reorder="follow_up"/);
assert.match(admin, /data-call-script-scenario-disable="objection"/);
assert.equal(admin.includes("data-call-script-scenario-disable=\"follow_up\""), false);
assert.match(admin, /已停用/);
assert.equal(admin.includes("<script>"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(admin), false);

const report = renderCallScriptReportScenarioOptions(scenarios, "first_call");
assert.match(report, /全部/);
assert.ok(report.indexOf("异议") < report.indexOf("初次联系"));
assert.match(report, /回访/);
assert.match(report, /selected/);

assert.equal(readCallScriptDraft("开场", "first_call", "正文", "", scenarios).ok, true);
assert.equal(readCallScriptDraft("开场", "follow_up", "正文", "", scenarios).ok, false);
assert.deepEqual(callScriptScenarioCreateBody(" 续约 "), { name: "续约" });
assert.deepEqual(callScriptScenarioRenameBody("first_call", " 初次 "), { code: "first_call", name: "初次" });
assert.deepEqual(callScriptScenarioReorderBody("objection", 0), { code: "objection", sortOrder: 0 });
assert.deepEqual(callScriptScenarioDisableBody("follow_up"), { code: "follow_up" });

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = page.indexOf('id="dashboardCallScripts"');
const end = page.indexOf('id="dashboardCallScriptReport"');
assert.equal(start > 0 && end > start, true);
const view = page.slice(start, end);
assert.match(view, /id="dashboardCallScriptScenarios" hidden/);
assert.match(view, /id="dashboardCallScriptScenarioCreate"/);
assert.match(view, /新增场景/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/call-script-scenarios/);
assert.match(api, /callScriptScenarioCreateBody/);
assert.match(api, /renderCallScriptScenarioAdmin/);
assert.match(api, /renderCallScriptReportScenarioOptions/);
const handlerStart = api.indexOf("async function createDashboardCallScriptScenario");
const handlerEnd = api.indexOf("function clearDashboardCallScriptForm", handlerStart);
assert.equal(handlerStart > 0 && handlerEnd > handlerStart, true);
const handler = api.slice(handlerStart, handlerEnd);
assert.equal(handler.includes("aliyuncs.com"), false);
assert.equal(handler.includes("MakeCall"), false);
assert.equal(handler.includes("/api/call-script-scenarios"), true);

console.log("call script scenario frontend tests passed");
