import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  callScriptRestoreBody,
  renderCallScriptAside,
  renderCallScriptList,
  renderCallScriptManageList,
  renderCallScriptVersionPanel
} from "./call-script.js";

const templates = [
  { id: "cst_a", title: "开场<script>", scenario: "first_call", body: "当前正文", enabled: true },
  { id: "cst_c", title: "旧异议", scenario: "objection", body: "已经停用", enabled: false }
];

const aside = renderCallScriptAside(templates, "first_call");
const list = renderCallScriptList(templates, "first_call");
assert.equal(aside.includes("data-call-script-version"), false);
assert.equal(list.includes("data-call-script-version"), false);
assert.equal(aside.includes("恢复此版"), false);
assert.equal(list.includes("恢复此版"), false);
assert.equal(aside.includes("<button"), false);

const manage = renderCallScriptManageList(templates);
assert.match(manage, /data-call-script-versions="cst_a"/);
assert.match(manage, /data-call-script-versions="cst_c"/);
assert.match(manage, /data-call-script-edit="cst_a"/);
assert.equal(manage.includes("data-call-script-edit=\"cst_c\""), false);
assert.equal(manage.includes("<script>"), false);

const versions = [
  { id: "csver_2", versionNo: 2, title: "开场二", scenario: "follow_up", source: "edit", savedAt: "2026-04-04T00:00:00.000Z" },
  { id: "csver_1", versionNo: 1, title: "开场<script>", scenario: "first_call", source: "restore", savedAt: "2026-04-03T00:00:00.000Z" }
];
const panel = renderCallScriptVersionPanel({
  templateId: "cst_a",
  title: "当前<script>",
  canRestore: true,
  versions,
  openedBody: "旧版<script>alert(1)</script>"
});
assert.match(panel, /data-call-script-version-panel="1"/);
assert.match(panel, /话术详情/);
assert.match(panel, /data-call-script-version-view="csver_1"/);
assert.match(panel, /data-call-script-version-restore="csver_1"/);
assert.match(panel, /data-call-script-version-restore="csver_2"/);
assert.match(panel, /data-call-script-version-body="1"/);
assert.match(panel, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.match(panel, /开场&lt;script&gt;/);
assert.equal(panel.includes("<script>"), false);
assert.equal(panel.includes("批量"), false);
assert.equal((panel.match(/恢复此版/g) || []).length, 2);
assert.equal(/<button[^>]*>[^<]*外呼/.test(panel), false);

const disabled = renderCallScriptVersionPanel({
  templateId: "cst_c",
  title: "旧异议",
  canRestore: false,
  versions,
  openedBody: null
});
assert.match(disabled, /查看正文/);
assert.equal(disabled.includes("恢复此版"), false);
assert.match(renderCallScriptVersionPanel({
  templateId: "cst_a",
  title: "开场",
  canRestore: true,
  versions: [],
  openedBody: null
}), /data-call-script-versions-empty/);

assert.deepEqual(callScriptRestoreBody("cst_a", "csver_1"), { templateId: "cst_a", versionId: "csver_1" });

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const viewStart = page.indexOf('id="dashboardCallScripts"');
const viewEnd = page.indexOf('id="dashboardAcquisitionTodoSummary"');
const view = page.slice(viewStart, viewEnd);
assert.match(view, /id="dashboardCallScriptVersions" hidden/);
assert.match(view, /历史版本/);
assert.match(view, /不能看历史版本或恢复/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const loadStart = api.indexOf("async function loadCallScriptVersions");
const loadEnd = api.indexOf("async function openCallScriptVersionBody", loadStart);
assert.equal(loadStart > 0, true);
const loader = api.slice(loadStart, loadEnd);
assert.match(loader, /if \(!callScriptCanManage \|\| !templateId\)/);
assert.match(loader, /\/api\/call-script-templates\/\$\{encodeURIComponent\(templateId\)\}\/versions/);
assert.match(api, /\/api\/call-script-templates\/restore/);
assert.match(api, /callScriptRestoreBody/);
assert.match(api, /renderCallScriptVersionPanel/);
assert.equal(loader.includes("aliyuncs.com"), false);
assert.equal(loader.includes("requestOutboundCall"), false);
assert.equal(loader.includes("MakeCall"), false);

console.log("call script version frontend tests passed");
