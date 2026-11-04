import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { callbackScheduleReportQuery, renderCallbackScheduleReport } from "./callback-schedule-report.js";

assert.equal(callbackScheduleReportQuery({}), "");
assert.equal(callbackScheduleReportQuery({ from: "2026-11-04", to: "2026-11-04" }), "?from=2026-11-04&to=2026-11-04");
assert.equal(callbackScheduleReportQuery({ from: "", to: "2026-11-05" }), "?to=2026-11-05");

const html = renderCallbackScheduleReport({
  today: "2026-11-04",
  metrics: { due: true, overdue: true, completed: true, rescheduled: true },
  counts: { dueCount: 1, overdueCount: 0, completedCount: 2, rescheduledCount: 1 },
  rowCount: 3,
  rows: [
    {
      id: "cba_done",
      kind: "completed",
      at: "2026-11-03T16:30:00.000Z",
      targetLabel: "客户",
      name: "Nordic <Tools>",
      actorLabel: "Shirley",
      previousScheduledAt: "2026-11-03 10:00",
      previousNote: "=改期",
      nextScheduledAt: "",
      nextNote: "",
      reasonLabel: "已回拨"
    },
    {
      id: "cdqa_read",
      kind: "queue_read",
      at: "2026-11-03T16:30:00.000Z",
      actorLabel: "Alex",
      queueScopeLabel: "团队",
      overdueOnly: false,
      queueRowCount: 0
    },
    {
      id: "cbs_due",
      kind: "due",
      at: "",
      targetLabel: "客户",
      name: "",
      nextScheduledAt: "2026-11-04 10:00",
      nextNote: "今日"
    }
  ]
});
assert.match(html, /data-callback-schedule-report="1"/);
assert.match(html, /data-callback-schedule-count="due"/);
assert.match(html, /data-callback-schedule-count="overdue">/);
assert.match(html, /<dd>0<\/dd>/);
assert.match(html, /data-callback-schedule-count="completed"/);
assert.match(html, /data-callback-schedule-count="rescheduled"/);
assert.match(html, /Nordic &lt;Tools&gt;/);
assert.match(html, /data-before="1">2026-11-03 10:00 \/ =改期/);
assert.match(html, /data-after="1">— \/ —/);
assert.match(html, /data-queue="1">团队 · 只看已逾期 否 · 0 行/);
assert.match(html, /data-callback-schedule-report-row="cbs_due"/);
assert.match(html, /data-before="1">— \/ —/);
assert.equal(html.includes("完成率"), false);
assert.equal(html.includes("接通率"), false);
assert.equal(html.includes("MakeCall"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(html), false);

const missing = renderCallbackScheduleReport({
  metrics: {},
  counts: { dueCount: 0, overdueCount: 0, completedCount: 0, rescheduledCount: 0 },
  rows: []
});
assert.match(missing, /data-callback-schedule-count="due"/);
assert.equal(missing.includes("<dd>0</dd>"), false);
assert.match(missing, /<dd>—<\/dd>/);
assert.match(missing, /data-callback-schedule-report-empty="1"/);
assert.match(missing, /data-callback-schedule-report-rows="—"/);
assert.match(missing, /data-callback-schedule-report-today="—"/);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = page.indexOf('id="dashboardCallbackScheduleReport"');
const end = page.indexOf('id="kdBoard"', start);
assert.equal(start > 0 && end > start, true);
const view = page.slice(start, end);
assert.match(view, /回拨预约报表/);
assert.match(view, /hidden/);
assert.match(view, /id="dashboardCallbackScheduleReportFrom"/);
assert.match(view, /id="dashboardCallbackScheduleReportExport"/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);
assert.equal(view.includes("MakeCall"), false);
const queue = page.slice(page.indexOf('id="dashboardCallbackDueQueue"'), start);
assert.match(queue, /回拨到期队列/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/callback-schedule-report/);
assert.match(api, /\/api\/callback-schedule-report\/export/);
assert.match(api, /renderCallbackScheduleReport/);
const gate = api.indexOf("function canViewCallbackScheduleReport");
assert.equal(gate > 0, true);
assert.match(api.slice(gate, gate + 220), /role === "manager"/);
const refreshStart = api.indexOf("async function refreshDashboardOnly");
const refreshEnd = api.indexOf("function requestDashboardRefresh", refreshStart);
assert.equal(refreshStart > 0 && refreshEnd > refreshStart, true);
assert.equal(api.slice(refreshStart, refreshEnd).includes("/api/callback-schedule-report"), false);
const loadStart = api.indexOf("async function loadCallbackScheduleReport");
const loadEnd = api.indexOf("async function loadCallbackReminders", loadStart);
assert.equal(loadStart > 0 && loadEnd > loadStart, true);
assert.equal(api.slice(loadStart, loadEnd).includes("aliyuncs.com"), false);
assert.equal(api.slice(loadStart, loadEnd).includes("MakeCall"), false);
assert.match(api.slice(loadStart, loadEnd), /回拨预约报表\.csv/);

console.log("callback schedule report frontend tests passed");
