import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  callScriptUsageBody,
  renderCallScriptUsageForm,
  renderCallScriptUsageStats
} from "./call-script-usage.js";
import {
  outboundCallRecordQuery,
  renderOutboundCallRecordDetail,
  renderOutboundCallRecordList,
  renderOutboundCallScriptOptions
} from "./outbound-call-records.js";

assert.deepEqual(callScriptUsageBody("cst_a"), { templateId: "cst_a" });
assert.deepEqual(callScriptUsageBody(""), { templateId: null });
assert.deepEqual(callScriptUsageBody(null), { templateId: null });

const form = renderCallScriptUsageForm(
  { id: "ocr_1", callScriptTemplateId: "cst_a", callScriptTitle: "=开场<script>", callScriptEnabled: true },
  [{ id: "cst_a", title: "=开场<script>", scenarioLabel: "首呼" }, { id: "cst_b", title: "回访", scenarioLabel: "回访" }]
);
assert.match(form, /data-call-script-usage-form="1"/);
assert.match(form, /data-record-id="ocr_1"/);
assert.match(form, /保存话术/);
assert.match(form, /data-call-script-usage-clear="1"/);
assert.match(form, /&lt;script&gt;/);
assert.equal(form.includes("<script>"), false);
assert.equal(form.includes(">外呼<"), false);
assert.equal(form.includes("aliyuncs.com"), false);

const stale = renderCallScriptUsageForm(
  { id: "ocr_2", callScriptTemplateId: "cst_old", callScriptTitle: "", callScriptEnabled: false },
  []
);
assert.match(stale, /找不到话术/);
assert.equal(stale.includes(">cst_old<"), false);

const stats = renderCallScriptUsageStats([
  { id: "cst_a", title: "开场", scenarioLabel: "首呼", enabled: true, usageCount: 2 },
  { id: "cst_b", title: "旧话术", scenarioLabel: "异议处理", enabled: false, usageCount: 0 }
]);
assert.match(stats, /data-call-script-usage-stats="1"/);
assert.match(stats, /data-usage-count="2"/);
assert.match(stats, /data-usage-count="0"/);
assert.equal(stats.includes("<button"), false);
assert.equal(stats.includes("usageRate"), false);
assert.match(renderCallScriptUsageStats([]), /data-call-script-usage-empty/);
assert.match(renderCallScriptUsageStats([{ id: "cst_x", title: "缺次数" }]), /data-usage-count="—"/);

const list = renderOutboundCallRecordList([
  { id: "ocr_1", callScriptTitle: "=开场<script>", established: true },
  { id: "ocr_2" }
]);
assert.match(list, /所用话术/);
assert.match(list, /data-call-script-usage-label="ocr_1"/);
assert.match(list, /&lt;script&gt;/);
assert.match(list, />未选用</);
assert.equal(list.includes("<script>"), false);
assert.equal(list.includes("data-call-script-usage-form"), false);
assert.equal(list.includes(">外呼<"), false);

const detail = renderOutboundCallRecordDetail({
  record: { id: "ocr_1", established: true, maskedNumber: "*******2333", callScriptTitle: "开场", callScriptTemplateId: "cst_a", callScriptEnabled: true },
  scriptChoices: [{ id: "cst_a", title: "开场", scenarioLabel: "首呼" }]
});
assert.match(detail, /data-call-script-usage-panel="1"/);
assert.match(detail, /data-call-script-usage-form="1"/);
assert.equal(detail.includes(">外呼<"), false);

const options = renderOutboundCallScriptOptions([{ id: "cst_a", title: "开场" }], "none");
assert.match(options, /全部/);
assert.match(options, /未选用/);
assert.match(options, /开场/);
assert.match(outboundCallRecordQuery({ script: "cst_a", note: "has" }), /script=cst_a/);
assert.equal(outboundCallRecordQuery({}).includes("script"), false);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const viewStart = page.indexOf('id="outbound-call-records"');
const viewEnd = page.indexOf('id="intent-followup-queue"');
const view = page.slice(viewStart, viewEnd);
assert.match(view, /id="outboundCallRecordScript"/);
assert.match(view, /所用话术/);
assert.match(view, /未选用/);
assert.equal(view.includes(">外呼<"), false);
assert.equal(view.includes("MakeCall"), false);

const dashStart = page.indexOf('id="dashboardCallScripts"');
const dashEnd = page.indexOf('id="dashboardAcquisitionTodoSummary"');
const dash = page.slice(dashStart, dashEnd);
assert.match(dash, /id="dashboardCallScriptUsage"/);
assert.match(dash, /使用次数/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(dash), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/call-script-usage/);
assert.match(api, /\/script`/);
assert.match(api, /callScriptUsageBody/);
assert.match(api, /renderCallScriptUsageStats/);
const submitStart = api.indexOf("async function submitCallScriptUsage");
const submitEnd = api.indexOf("function rememberCallNote", submitStart);
assert.equal(submitStart > 0 && submitEnd > submitStart, true);
assert.equal(api.slice(submitStart, submitEnd).includes("aliyuncs.com"), false);

console.log("call script usage frontend tests passed");
