import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  callScriptCreateBody,
  callScriptDisableBody,
  callScriptUpdateBody,
  escapeCallScriptText,
  filterEnabledCallScripts,
  readCallScriptDraft,
  renderCallScriptAside,
  renderCallScriptList,
  renderCallScriptManageList
} from "./call-script.js";

const templates = [
  { id: "cst_a", title: "开场", scenario: "first_call", body: "您好，<script>alert(1)</script>", language: "zh", enabled: true },
  { id: "cst_b", title: "回访", scenario: "follow_up", body: "上次聊过。", enabled: true },
  { id: "cst_c", title: "旧异议", scenario: "objection", body: "已经停用", enabled: false }
];

assert.equal(escapeCallScriptText(`<script>alert("x")</script>`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
assert.deepEqual(filterEnabledCallScripts(templates, "first_call").map((item) => item.id), ["cst_a"]);
assert.deepEqual(filterEnabledCallScripts(templates, "").map((item) => item.id), ["cst_a", "cst_b"]);

const list = renderCallScriptList(templates, "first_call");
assert.match(list, /data-call-script="cst_a"/);
assert.match(list, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.equal(list.includes("<script>"), false);
assert.equal(list.includes("<button"), false);
assert.equal(list.includes("外呼"), false);
assert.match(renderCallScriptList(templates, "objection"), /data-call-script-empty/);

const aside = renderCallScriptAside(templates, "follow_up");
assert.match(aside, /data-call-script-aside="1"/);
assert.match(aside, /data-call-script-scenario/);
assert.match(aside, /回访/);
assert.equal(aside.includes("<button"), false);
assert.equal(aside.includes("aliyuncs.com"), false);

const manage = renderCallScriptManageList(templates);
assert.match(manage, /data-call-script-edit="cst_a"/);
assert.equal(manage.includes("data-call-script-edit=\"cst_c\""), false);
assert.match(manage, /已停用/);
assert.equal(manage.includes("<script>"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(manage), false);

assert.equal(readCallScriptDraft(" 开场 ", "first_call", " 正文 ", "").ok, true);
assert.equal(readCallScriptDraft("", "first_call", "正文", "").ok, false);
assert.equal(readCallScriptDraft("开场", "first_call", "文".repeat(2001), "").ok, false);
assert.equal(readCallScriptDraft("开场", "first_call", "正文", "中文").ok, false);
assert.deepEqual(callScriptCreateBody({ title: "开场", scenario: "first_call", body: "正文", language: " zh " }), {
  title: "开场",
  scenario: "first_call",
  body: "正文",
  language: "zh"
});
assert.equal(callScriptUpdateBody({ id: "cst_a", title: "开场", scenario: "first_call", body: "正文", language: "" }).id, "cst_a");
assert.deepEqual(callScriptDisableBody("cst_a"), { id: "cst_a" });

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const viewStart = page.indexOf('id="dashboardCallScripts"');
const viewEnd = page.indexOf('id="dashboardAcquisitionTodoSummary"');
assert.equal(viewStart > 0, true);
assert.equal(viewEnd > viewStart, true);
const view = page.slice(viewStart, viewEnd);
assert.match(view, /外呼话术/);
assert.match(view, /id="dashboardCallScriptList"/);
assert.match(view, /id="dashboardCallScriptForm" hidden/);
assert.match(view, /保存话术/);
assert.match(view, /停用/);
assert.match(view, /不会自动拨号/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);
assert.equal(view.includes("mailto:"), false);
assert.match(page, /id="cccCallScripts"/);
assert.match(page, /id="outboundCallRecordScripts"/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const loadStart = api.indexOf("function bindDashboardCallScripts");
const loadEnd = api.indexOf("async function loadBadges", loadStart);
assert.equal(loadStart > 0, true);
const body = api.slice(loadStart, loadEnd);
assert.match(body, /\/api\/call-script-templates/);
assert.match(body, /callScriptCreateBody/);
assert.match(body, /callScriptUpdateBody/);
assert.match(body, /callScriptDisableBody/);
assert.match(body, /renderCallScriptList/);
assert.match(body, /renderCallScriptAside/);
assert.match(body, /includeDisabled=1/);
assert.match(api, /loadDashboardCallScripts\(\)/);
assert.equal(body.includes("aliyuncs.com"), false);
assert.equal(body.includes("requestOutboundCall"), false);
assert.equal(body.includes("MakeCall"), false);

console.log("call script frontend tests passed");
