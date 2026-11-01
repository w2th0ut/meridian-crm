import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  callTagReportQuery,
  renderCallTagReport,
  renderCallTagReportAgentOptions
} from "./call-tag-report.js";

assert.equal(callTagReportQuery({}), "");
assert.equal(callTagReportQuery({ from: "2026-04-04", to: "2026-04-05", agentId: "agent@ccc-a" }), "?from=2026-04-04&to=2026-04-05&agentId=agent%40ccc-a");

const html = renderCallTagReport({
  metrics: {
    applyCount: true,
    callCount: true,
    customerCount: true,
    leadCount: true
  },
  rows: [
    { tagId: "ctag_a", name: "=敏感<script>", enabled: true, applyCount: 2, callCount: 2, customerCount: 1, leadCount: 1 },
    { tagId: "ctag_old", name: "啊旧", enabled: false, applyCount: 1, callCount: 1, customerCount: 1, leadCount: 0 },
    { tagId: "ctag_zero", name: "未使用", enabled: true, applyCount: 0, callCount: 0, customerCount: 0, leadCount: 0 }
  ]
});
assert.match(html, /data-call-tag-report="1"/);
assert.match(html, /data-call-tag-report-row="ctag_a"/);
assert.match(html, /data-call-tag-report-row="ctag_old"/);
assert.match(html, /data-call-tag-report-group="disabled"/);
assert.match(html, /data-call-tag-report-disabled="1"/);
assert.match(html, /call-tag-report-disabled/);
assert.match(html, /已停用/);
assert.match(html, /=敏感&lt;script&gt;/);
assert.equal(html.includes("<script>"), false);
assert.match(html, /data-apply-count="1">2/);
assert.match(html, /data-call-count="1">2/);
assert.match(html, /data-customer-count="1">1/);
assert.match(html, /data-lead-count="1">1/);
assert.match(html, /data-apply-count="1">0/);
assert.equal(html.includes("接通率"), false);
assert.equal(html.includes("搜客"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(html), false);
const enabledAt = html.indexOf('data-call-tag-report-row="ctag_a"');
const disabledAt = html.indexOf('data-call-tag-report-row="ctag_old"');
assert.equal(enabledAt > 0 && disabledAt > enabledAt, true);

const hidden = renderCallTagReport({
  metrics: { applyCount: true },
  rows: [{ tagId: "ctag_b", name: "价格敏感", enabled: true, applyCount: 3 }]
});
assert.match(hidden, /被打上的次数/);
assert.equal(hidden.includes("关联通话数"), false);
assert.equal(hidden.includes("涉及客户数"), false);
assert.equal(hidden.includes("涉及线索数"), false);
assert.equal(hidden.includes("data-call-tag-report-group=\"disabled\""), false);

assert.match(renderCallTagReport({ metrics: {}, rows: [] }), /data-call-tag-report-empty/);
assert.match(renderCallTagReportAgentOptions([{ id: "agent@ccc-a", label: "甲<script>" }], "agent@ccc-a"), /甲&lt;script&gt;/);
assert.match(renderCallTagReportAgentOptions([{ id: "agent@ccc-a", label: "甲" }], "agent@ccc-a"), /selected/);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = page.indexOf('id="dashboardCallTagReport"');
const end = page.indexOf('id="dashboardAcquisitionTodoSummary"');
assert.equal(start > 0 && end > start, true);
const view = page.slice(start, end);
assert.match(view, /通话标签使用统计/);
assert.match(view, /id="dashboardCallTagReportFilters"/);
assert.match(view, /id="dashboardCallTagReportExport"/);
assert.match(view, /hidden/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);
assert.equal(view.includes("MakeCall"), false);
assert.match(page, /call-tag-report-disabled/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/call-tag-report/);
assert.match(api, /renderCallTagReport/);
assert.match(api, /callTagReportQuery/);
const loadStart = api.indexOf("async function loadDashboardCallScripts");
const loadEnd = api.indexOf("function paintCallScriptUsage", loadStart);
assert.equal(loadStart > 0 && loadEnd > loadStart, true);
assert.equal(api.slice(loadStart, loadEnd).includes("/api/call-tag-report"), false);
const reportStart = api.indexOf("async function loadCallTagReport");
const reportEnd = api.indexOf("async function loadDashboardCallScripts", reportStart);
assert.equal(reportStart > 0 && reportEnd > reportStart, true);
assert.equal(api.slice(reportStart, reportEnd).includes("aliyuncs.com"), false);
assert.equal(api.slice(reportStart, reportEnd).includes("MakeCall"), false);

console.log("call tag report frontend tests passed");
