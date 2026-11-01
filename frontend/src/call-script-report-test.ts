import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  callScriptReportQuery,
  renderCallScriptReport,
  renderCallScriptReportAgentOptions
} from "./call-script-report.js";

assert.equal(callScriptReportQuery({}), "");
assert.equal(callScriptReportQuery({ from: "2026-04-04", to: "2026-04-05", agentId: "agent@ccc-a", scenario: "first_call" }), "?from=2026-04-04&to=2026-04-05&agentId=agent%40ccc-a&scenario=first_call");

const html = renderCallScriptReport({
  metrics: {
    callCount: true,
    connectedCount: true,
    outcomes: true,
    averageConnectedDurationSeconds: true,
    callbackAppointmentCount: true
  },
  rows: [
    {
      templateId: "cst_a",
      title: "=开场<script>",
      scenarioLabel: "首呼",
      enabled: true,
      linked: true,
      callCount: 2,
      connectedCount: 1,
      outcomes: { 有意向: 1, 需回访: 0, 无意向: 0, 号码错误: 0, 其他: 0, 未标注: 1 },
      averageConnectedDurationSeconds: 10,
      callbackAppointmentCount: 1
    },
    {
      templateId: "",
      title: "未选用",
      scenarioLabel: "",
      enabled: null,
      linked: false,
      callCount: 0,
      connectedCount: 0,
      outcomes: { 有意向: 0, 需回访: 0, 无意向: 0, 号码错误: 0, 其他: 0, 未标注: 0 },
      averageConnectedDurationSeconds: null,
      callbackAppointmentCount: 0
    }
  ]
});
assert.match(html, /data-call-script-report="1"/);
assert.match(html, /data-call-script-report-row="cst_a"/);
assert.match(html, /data-call-script-report-row="none"/);
assert.match(html, /=开场&lt;script&gt;/);
assert.equal(html.includes("<script>"), false);
assert.match(html, /data-call-count="1">2/);
assert.match(html, /data-connected-count="1">1/);
assert.match(html, /data-average="1">10 秒/);
assert.match(html, /data-callback-count="1">1/);
assert.match(html, /data-average="1">—/);
assert.match(html, /未标注/);
assert.equal(html.includes("接通率"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(html), false);

const hidden = renderCallScriptReport({
  metrics: { callCount: true },
  rows: [{ templateId: "cst_b", title: "回访", linked: true, enabled: false, callCount: 0, averageConnectedDurationSeconds: null }]
});
assert.match(hidden, /已停用/);
assert.match(hidden, /通话数/);
assert.equal(hidden.includes("接通数"), false);
assert.equal(hidden.includes("回拨预约数"), false);
assert.equal(hidden.includes("平均通话时长"), false);
assert.equal(hidden.includes(">0<") || hidden.includes(">0</td>"), true);

assert.match(renderCallScriptReport({ metrics: {}, rows: [] }), /data-call-script-report-empty/);
assert.match(renderCallScriptReportAgentOptions([{ id: "agent@ccc-a", label: "甲<script>" }], "agent@ccc-a"), /甲&lt;script&gt;/);
assert.match(renderCallScriptReportAgentOptions([{ id: "agent@ccc-a", label: "甲" }], "agent@ccc-a"), /selected/);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = page.indexOf('id="dashboardCallScriptReport"');
const end = page.indexOf('id="dashboardAcquisitionTodoSummary"');
assert.equal(start > 0 && end > start, true);
const view = page.slice(start, end);
assert.match(view, /话术效果对比/);
assert.match(view, /id="dashboardCallScriptReportFilters"/);
assert.match(view, /id="dashboardCallScriptReportExport"/);
assert.match(view, /hidden/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);
assert.equal(view.includes("MakeCall"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/call-script-report/);
assert.match(api, /renderCallScriptReport/);
assert.match(api, /callScriptReportQuery/);
const loadStart = api.indexOf("async function loadDashboardCallScripts");
const loadEnd = api.indexOf("function clearDashboardCallScriptForm", loadStart);
assert.equal(loadStart > 0 && loadEnd > loadStart, true);
assert.equal(api.slice(loadStart, loadEnd).includes("/api/call-script-report"), false);
const reportStart = api.indexOf("async function loadCallScriptReport");
const reportEnd = api.indexOf("function clearDashboardCallScriptForm", reportStart);
assert.equal(reportStart > 0 && reportEnd > reportStart, true);
assert.equal(api.slice(reportStart, reportEnd).includes("aliyuncs.com"), false);
assert.equal(api.slice(reportStart, reportEnd).includes("MakeCall"), false);

console.log("call script report frontend tests passed");
