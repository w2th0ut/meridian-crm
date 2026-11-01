import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  callWrapupEditReportQuery,
  renderCallWrapupEditReport,
  renderCallWrapupEditReportAgentOptions
} from "./call-wrapup-edit-report.js";

assert.equal(callWrapupEditReportQuery({}), "");
assert.equal(
  callWrapupEditReportQuery({ from: "2026-04-04", to: "2026-04-05", agentId: "agent@ccc-a", field: "note" }),
  "?from=2026-04-04&to=2026-04-05&agentId=agent%40ccc-a&field=note"
);

const html = renderCallWrapupEditReport({
  metrics: { correctionCount: true },
  rowCount: 2,
  counts: [
    { agentId: "agent@ccc-a", label: "=甲<script>", correctionCount: 2 },
    { agentId: "none", label: "未分配坐席", correctionCount: 1 }
  ],
  rows: [
    {
      id: "cwe_a",
      at: "2026-04-03T16:30:00.000Z",
      callRecordId: "ocr_a",
      actorId: "u_sales",
      actorLabel: "Shirley",
      agentIds: ["agent@ccc-a"],
      agentLabel: "=甲<script>",
      changedFields: ["note", "tagIds"],
      before: { note: "旧纪要", outcome: "", outcomeNote: "", tagIds: ["t_old"], nextFollowAt: "" },
      after: { note: "=新纪要", outcome: "有意向", outcomeNote: "", tagIds: ["t_old", "t_new"], nextFollowAt: "" }
    },
    {
      id: "cwe_b",
      at: "2026-04-03T15:00:00.000Z",
      callRecordId: "ocr_b",
      actorLabel: "Alex",
      agentLabel: "未分配坐席",
      changedFields: [],
      before: { note: "一样" },
      after: { note: "一样" }
    }
  ]
});
assert.match(html, /data-wrapup-edit-report="1"/);
assert.match(html, /data-wrapup-edit-report-rows="2"/);
assert.match(html, /这一筛有 2 条改正/);
assert.match(html, /data-wrapup-edit-report-count="agent@ccc-a"/);
assert.match(html, /data-wrapup-edit-report-count="none"/);
assert.match(html, /data-correction-count="1">2/);
assert.match(html, /data-wrapup-edit-report-row="cwe_a"/);
assert.match(html, /data-before-field="note" data-changed="1">纪要正文：旧纪要/);
assert.match(html, /data-after-field="note" data-changed="1">纪要正文：=新纪要/);
assert.match(html, /data-after-field="tagIds" data-changed="1">通话标签：t_old、t_new/);
assert.match(html, /=甲&lt;script&gt;/);
assert.equal(html.includes("<script>"), false);
assert.equal(html.includes("接通率"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(html), false);
const countAt = html.indexOf('data-wrapup-edit-report-count="agent@ccc-a"');
const detailAt = html.indexOf('data-wrapup-edit-report-row="cwe_a"');
assert.equal(countAt > 0 && detailAt > countAt, true);

const hidden = renderCallWrapupEditReport({
  metrics: {},
  rowCount: 1,
  counts: [{ agentId: "agent@ccc-a", label: "甲", correctionCount: 1 }],
  rows: [{ id: "cwe_c", at: "2026-04-04T00:00:00.000Z", before: { note: "只看前值" }, after: { note: "只看后值" }, changedFields: ["note"] }]
});
assert.equal(hidden.includes("改正次数"), false);
assert.equal(hidden.includes("data-correction-count"), false);
assert.match(hidden, /data-wrapup-edit-report-row="cwe_c"/);
assert.match(hidden, /纪要正文：只看前值/);
assert.match(hidden, /纪要正文：只看后值/);

assert.match(renderCallWrapupEditReport({ metrics: { correctionCount: true }, rows: [] }), /data-wrapup-edit-report-empty/);
assert.match(renderCallWrapupEditReportAgentOptions([{ id: "agent@ccc-a", label: "甲<script>" }], "agent@ccc-a"), /甲&lt;script&gt;/);
assert.match(renderCallWrapupEditReportAgentOptions([{ id: "none", label: "未分配坐席" }], "none"), /selected/);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = page.indexOf('id="dashboardCallWrapupEditReport"');
const end = page.indexOf('id="dashboardAcquisitionTodoSummary"', start);
assert.equal(start > 0 && end > start, true);
const view = page.slice(start, end);
assert.match(view, /通话小结改正/);
assert.match(view, /id="dashboardCallWrapupEditReportFilters"/);
assert.match(view, /id="dashboardCallWrapupEditReportField"/);
assert.match(view, /id="dashboardCallWrapupEditReportExport"/);
assert.match(view, /hidden/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);
assert.equal(view.includes("MakeCall"), false);
assert.match(page, /call-wrapup-edit-report-table/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/call-wrapup-edit-report/);
assert.match(api, /renderCallWrapupEditReport/);
assert.match(api, /callWrapupEditReportQuery/);
const gate = api.indexOf("function canViewCallWrapupEditReport");
assert.equal(gate > 0, true);
assert.match(api.slice(gate, gate + 280), /role === "manager"/);
assert.match(api.slice(gate, gate + 280), /role === "admin"/);
assert.match(api.slice(gate, gate + 280), /super_admin/);
const dashStart = api.indexOf("async function loadDashboardCallScripts");
const dashEnd = api.indexOf("async function loadCallWrapupEditReport");
assert.equal(dashStart > 0 && dashEnd > dashStart, true);
assert.equal(api.slice(dashStart, dashEnd).includes("/api/call-wrapup-edit-report"), false);
const reportStart = api.indexOf("async function loadCallWrapupEditReport");
const reportEnd = api.indexOf("function paintCallScriptUsage", reportStart);
assert.equal(reportStart > 0 && reportEnd > reportStart, true);
assert.equal(api.slice(reportStart, reportEnd).includes("aliyuncs.com"), false);
assert.equal(api.slice(reportStart, reportEnd).includes("MakeCall"), false);
assert.match(api, /data-wrapup-edit-report-count/);

console.log("call wrapup edit report frontend tests passed");
