import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { callScriptFavoriteBody, renderCallScriptAside, renderCallScriptList } from "./call-script.js";
import { renderCallScriptUsageForm } from "./call-script-usage.js";
import { renderOutboundCallRecordDetail } from "./outbound-call-records.js";

const templates = [
  { id: "cst_b", title: "乙", scenario: "first_call", body: "乙正文", enabled: true },
  { id: "cst_a", title: "甲<script>", scenario: "first_call", body: "甲<script>", enabled: true },
  { id: "cst_c", title: "丙", scenario: "first_call", body: "丙正文", enabled: false }
];

const list = renderCallScriptList(templates, "first_call", { favoriteIds: ["cst_c", "cst_a"], showFavorite: true });
assert.ok(list.indexOf('data-call-script="cst_c"') < list.indexOf('data-call-script="cst_a"'));
assert.ok(list.indexOf('data-call-script="cst_a"') < list.indexOf('data-call-script="cst_b"'));
assert.match(list, /data-call-script-disabled="1"/);
assert.match(list, /已停用/);
assert.equal(list.includes('data-call-script-unfavorite="cst_c"'), false);
assert.equal(list.includes('data-call-script-favorite="cst_c"'), false);
assert.match(list, /data-call-script-unfavorite="cst_a"/);
assert.match(list, /data-call-script-favorite="cst_b"/);
assert.match(list, /&lt;script&gt;/);
assert.equal(list.includes("<script>"), false);
assert.equal(list.includes(">外呼<"), false);
assert.equal(list.includes("aliyuncs.com"), false);

const only = renderCallScriptList(templates, "first_call", { favoriteIds: ["cst_c", "cst_a"], favoritesOnly: true, showFavorite: true });
assert.equal(only.includes("cst_b"), false);
assert.match(only, /cst_c/);
assert.match(only, /cst_a/);
assert.match(renderCallScriptList(templates, "first_call", { favoriteIds: [], favoritesOnly: true, showFavorite: true }), /还没有收藏的话术/);
assert.match(renderCallScriptList(templates, "objection"), /这个场景还没有启用的话术/);

const aside = renderCallScriptAside(templates, "first_call", { favoriteIds: ["cst_a"], showFavorite: true });
assert.match(aside, /data-call-script-aside="1"/);
assert.match(aside, /data-call-script-favorites-only/);
assert.match(aside, /只看收藏/);
assert.match(aside, /data-call-script-unfavorite="cst_a"/);
assert.equal(aside.includes(">外呼<"), false);

assert.deepEqual(callScriptFavoriteBody("cst_a"), { templateId: "cst_a" });

const form = renderCallScriptUsageForm(
  { id: "ocr_1", callScriptTemplateId: "cst_b", callScriptTitle: "乙", callScriptEnabled: true },
  [
    { id: "cst_b", title: "乙", scenarioLabel: "首呼", enabled: true, favorited: false, selectable: true },
    { id: "cst_a", title: "甲<script>", scenarioLabel: "首呼", enabled: true, favorited: true, selectable: true },
    { id: "cst_c", title: "丙", scenarioLabel: "首呼", enabled: false, favorited: true, selectable: false }
  ]
);
assert.ok(form.indexOf('value="cst_a"') < form.indexOf('value="cst_b"'));
assert.match(form, /value="cst_c"[^>]* disabled/);
assert.match(form, /data-call-script-disabled="1"/);
assert.match(form, /data-favorited="1"/);
assert.match(form, /只看收藏/);
assert.match(form, /&lt;script&gt;/);
assert.equal(form.includes("<script>"), false);
assert.equal(form.includes(">外呼<"), false);

const kept = renderCallScriptUsageForm(
  { id: "ocr_2", callScriptTemplateId: "cst_c", callScriptTitle: "丙", callScriptEnabled: false },
  [{ id: "cst_c", title: "丙", enabled: false, favorited: true, selectable: false }]
);
assert.match(kept, /value="cst_c" selected/);
assert.equal(/<option value="cst_c"[^>]* disabled/.test(kept), false);
assert.match(kept, /已停用/);

const detail = renderOutboundCallRecordDetail({
  record: { id: "ocr_1", maskedNumber: "*******2333", established: true, callScriptTemplateId: "cst_a", callScriptTitle: "甲" },
  scriptChoices: [
    { id: "cst_a", title: "甲", favorited: true, enabled: true, selectable: true },
    { id: "cst_c", title: "丙", favorited: true, enabled: false, selectable: false }
  ]
});
assert.match(detail, /data-call-script-usage-form="1"/);
assert.match(detail, /只看收藏/);
assert.match(detail, /value="cst_c"[^>]* disabled/);
assert.equal(detail.includes(">外呼<"), false);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(page, /id="dashboardCallScriptFavoritesOnly"/);
assert.match(page, /id="cccCallScripts"/);
assert.match(page, /id="outboundCallRecordScripts"/);
assert.match(page, /call-script-card\[data-call-script-disabled="1"\]/);
const viewStart = page.indexOf('id="dashboardCallScripts"');
const viewEnd = page.indexOf('id="dashboardAcquisitionTodoSummary"');
const view = page.slice(viewStart, viewEnd);
assert.match(view, /只看收藏/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/call-script-favorites/);
assert.match(api, /callScriptFavoriteBody/);
assert.match(api, /callScriptListOptions\(false\)/);
assert.match(api, /data-call-script-favorites-only/);
assert.equal(api.includes("requestOutboundCall"), false);
const preferred = api.slice(api.indexOf("function preferredOutboundHtml"), api.indexOf("function redrawPreferredPhone"));
assert.match(preferred, /renderCallScriptAside\(callScriptPickerTemplates\(\)/);
assert.equal(preferred.includes("MakeCall"), false);

console.log("call script favorite frontend tests passed");
