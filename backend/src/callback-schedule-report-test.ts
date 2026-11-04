import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCallbackScheduleReport,
  buildCallbackScheduleReportCsv,
  callbackScheduleReportFiltersText,
  callbackScheduleReportLocalDate,
  parseCallbackScheduleReportQuery,
  type CallbackScheduleReportSource
} from "./callback-schedule-report.js";
import type { CallbackDueQueueAudit, CallbackSchedule, CallbackScheduleAudit } from "./types.js";

assert.deepEqual(parseCallbackScheduleReportQuery({}), { from: null, to: null });
assert.deepEqual(parseCallbackScheduleReportQuery({ from: "2026-11-04", to: "2026-11-04" }), {
  from: "2026-11-04",
  to: "2026-11-04"
});
assert.equal(parseCallbackScheduleReportQuery({ from: "2026-11-05", to: "2026-11-04" }), null);
assert.equal(parseCallbackScheduleReportQuery({ from: "2026-02-31" }), null);
assert.equal(parseCallbackScheduleReportQuery({ from: ["2026-11-04"] }), null);
assert.equal(parseCallbackScheduleReportQuery({ agentId: "agent@ccc-a" }), null);
assert.equal(callbackScheduleReportFiltersText({ from: "2026-11-04", to: null }).includes("=改期"), false);
assert.equal(callbackScheduleReportFiltersText({ from: null, to: null }).includes("13800138000"), false);
assert.equal(callbackScheduleReportLocalDate("2026-11-03T16:30:00.000Z", "Asia/Shanghai"), "2026-11-04");
assert.equal(callbackScheduleReportLocalDate("2026-11-03T16:30:00.000Z", "America/New_York"), "2026-11-03");
assert.equal(callbackScheduleReportLocalDate("not-a-date", "Asia/Shanghai"), null);
assert.equal(callbackScheduleReportLocalDate("", "Asia/Shanghai"), null);

function schedule(partial: Partial<CallbackSchedule> & Pick<CallbackSchedule, "id" | "scheduledAt">): CallbackSchedule {
  return {
    teamId: "europe",
    targetType: "customer",
    targetId: "c1",
    note: "",
    updatedBy: "u_sales_shirley",
    updatedAt: "2026-11-04T01:00:00.000Z",
    sourceCallRecordId: "",
    ...partial
  };
}

function audit(partial: Partial<CallbackScheduleAudit> & Pick<CallbackScheduleAudit, "id" | "action">): CallbackScheduleAudit {
  return {
    teamId: "europe",
    actorId: "u_sales_shirley",
    at: "2026-11-03T16:30:00.000Z",
    targetType: "customer",
    targetId: "c1",
    previousScheduledAt: "2026-11-03 10:00",
    nextScheduledAt: "",
    previousNote: "",
    nextNote: "",
    result: "updated",
    reason: "",
    sourceCallRecordId: "",
    ...partial
  };
}

function queue(partial: Partial<CallbackDueQueueAudit> & Pick<CallbackDueQueueAudit, "id" | "action" | "result">): CallbackDueQueueAudit {
  return {
    teamId: "europe",
    actorId: "u_manager_alex",
    at: "2026-11-03T16:30:00.000Z",
    scope: "team",
    overdueOnly: false,
    rowCount: 0,
    reason: "",
    ...partial
  };
}

const source: CallbackScheduleReportSource = {
  customers: [
    { id: "c1", teamId: "europe", company: "Nordic <Tools>" },
    { id: "c5", teamId: "europe", company: "Evergreen" }
  ],
  leads: [
    { id: "l1", teamId: "europe", company: "Example Lighting", deletedAt: "2026-11-01T00:00:00.000Z" }
  ],
  websiteOpportunities: [],
  users: [
    { id: "u_sales_shirley", teamId: "europe", name: "Shirley" },
    { id: "u_manager_alex", teamId: "europe", name: "Alex" },
    { id: "u_asia", teamId: "asia", name: "亚洲人" }
  ],
  callbackSchedules: [
    schedule({ id: "cbs_due", scheduledAt: "2026-11-04 10:00", note: "今日" }),
    schedule({ id: "cbs_over", targetId: "c5", scheduledAt: "2026-11-03 09:00", note: "逾期" }),
    schedule({ id: "cbs_early", targetId: "c5", scheduledAt: "2026-11-01 09:00", note: "更早" }),
    schedule({ id: "cbs_later", targetType: "lead", targetId: "l1", scheduledAt: "2026-11-05 09:00", note: "未到" }),
    schedule({ id: "cbs_bad", scheduledAt: "昨天" }),
    schedule({ id: "cbs_asia", teamId: "asia", scheduledAt: "2026-11-03 10:00", note: "亚洲备注不要出现" })
  ],
  callbackScheduleAudits: [
    audit({ id: "cba_done", action: "cancel", reason: "reached", previousNote: "=改期" }),
    audit({ id: "cba_plain", action: "cancel", at: "2026-11-03T17:00:00.000Z", targetId: "missing_rpt", previousScheduledAt: "2026-11-02 10:00" }),
    audit({ id: "cba_old", action: "cancel", at: "2026-11-02T10:00:00.000Z" }),
    audit({ id: "cba_bad_at", action: "cancel", at: "not-a-date" }),
    audit({ id: "cba_reject", action: "cancel", result: "rejected", reason: "forbidden", nextNote: "拒绝备注不要计入" }),
    audit({
      id: "cba_move",
      action: "update",
      at: "2026-11-03T18:00:00.000Z",
      previousScheduledAt: "2026-11-04 09:00",
      nextScheduledAt: "2026-11-06 11:00",
      previousNote: "旧备注",
      nextNote: "新备注"
    }),
    audit({
      id: "cba_note",
      action: "update",
      previousScheduledAt: "2026-11-04 09:00",
      nextScheduledAt: "2026-11-04 09:00",
      previousNote: "只改备注",
      nextNote: "备注新"
    }),
    audit({ id: "cba_set", action: "set", previousScheduledAt: "", nextScheduledAt: "2026-11-04 09:00", nextNote: "第一次" }),
    audit({ id: "cba_asia", teamId: "asia", actorId: "u_asia", action: "cancel", previousNote: "亚洲备注不要出现" })
  ],
  callbackDueQueueAudits: [
    queue({ id: "cdqa_read", action: "read", result: "read", rowCount: 0 }),
    queue({ id: "cdqa_export", action: "export", result: "exported", rowCount: 2, overdueOnly: true }),
    queue({ id: "cdqa_deny", action: "read", result: "rejected", reason: "forbidden", rowCount: 0 }),
    queue({ id: "cdqa_asia", teamId: "asia", action: "read", result: "read" })
  ]
};

const day = buildCallbackScheduleReport({
  source,
  teamId: "europe",
  query: { from: "2026-11-04", to: "2026-11-04" },
  timeZone: "Asia/Shanghai",
  today: "2026-11-04"
});
assert.equal(day.counts.dueCount, 1);
assert.equal(day.counts.overdueCount, 0);
assert.equal(day.counts.completedCount, 2);
assert.equal(day.counts.rescheduledCount, 1);
assert.deepEqual(day.rows.map((row) => row.id), ["cbs_due", "cba_move", "cba_plain", "cdqa_read", "cdqa_export", "cba_done"]);
assert.equal(day.rows.find((row) => row.id === "cba_done")?.reasonLabel, "已回拨");
assert.equal(day.rows.find((row) => row.id === "cba_plain")?.name, "");
assert.equal(day.rows.find((row) => row.id === "cba_plain")?.reasonLabel, "");
assert.equal(day.rows.find((row) => row.id === "cba_done")?.name, "Nordic <Tools>");
assert.equal(day.rows.find((row) => row.id === "cdqa_read")?.queueRowCount, 0);
assert.equal(day.rows.find((row) => row.id === "cdqa_read")?.previousScheduledAt, "");
assert.equal(day.rows.some((row) => row.id === "cba_note" || row.id === "cba_set" || row.id === "cba_reject" || row.id === "cbs_later" || row.id === "cba_asia"), false);
assert.equal(JSON.stringify(day).includes("亚洲备注不要出现"), false);
assert.equal(JSON.stringify(day).includes("拒绝备注不要计入"), false);
assert.equal(JSON.stringify(day).includes("13800138000"), false);
assert.equal("completionRate" in day.counts, false);

const open = buildCallbackScheduleReport({
  source,
  teamId: "europe",
  query: { from: null, to: null },
  timeZone: "Asia/Shanghai",
  today: "2026-11-04"
});
assert.equal(open.counts.dueCount, 1);
assert.equal(open.counts.overdueCount, 2);
assert.equal(open.counts.completedCount, 4);
assert.equal(open.counts.rescheduledCount, 1);
assert.equal(open.rows.some((row) => row.id === "cba_bad_at"), true);
assert.equal(open.rows.some((row) => row.id === "cbs_bad" || row.id === "cbs_later" || row.id === "cba_note"), false);

const shifted = buildCallbackScheduleReport({
  source,
  teamId: "europe",
  query: { from: null, to: null },
  timeZone: "America/New_York",
  today: "2026-11-03"
});
assert.equal(shifted.counts.dueCount, 1);
assert.equal(shifted.rows.find((row) => row.kind === "due")?.id, "cbs_over");
assert.equal(shifted.counts.overdueCount, 1);
assert.equal(shifted.rows.some((row) => row.id === "cbs_due"), false);
assert.equal(shifted.rows.some((row) => row.id === "cba_old"), true);
const shiftedRange = buildCallbackScheduleReport({
  source,
  teamId: "europe",
  query: { from: "2026-11-04", to: "2026-11-04" },
  timeZone: "America/New_York",
  today: "2026-11-03"
});
assert.equal(shiftedRange.counts.dueCount, 0);
assert.equal(shiftedRange.counts.overdueCount, 0);
assert.equal(shiftedRange.counts.completedCount, 0);
assert.equal(shiftedRange.rows.some((row) => row.id === "cba_done"), false);

const missingToday = buildCallbackScheduleReport({
  source,
  teamId: "europe",
  query: { from: null, to: null },
  timeZone: "Asia/Shanghai",
  today: ""
});
assert.equal(missingToday.counts.dueCount, null);
assert.equal(missingToday.counts.overdueCount, null);
assert.equal(missingToday.counts.completedCount, 4);
assert.equal(missingToday.rows.some((row) => row.kind === "due" || row.kind === "overdue"), false);

const csv = buildCallbackScheduleReportCsv(day.rows);
assert.equal(csv.startsWith("\uFEFF"), true);
assert.match(csv, /种类,时间,对象类型,对象,对象 ID,操作人,改前时间,改前备注,改后时间,改后备注,原因,队列范围,只看已逾期,队列行数/);
assert.match(csv, /'=改期/);
assert.match(csv, /已回拨/);
assert.match(csv, /队列查看/);
assert.match(csv, /,0\r\n|,0$/);
assert.equal(csv.includes("\n") && csv.includes("\r\n"), true);
assert.equal(csv.includes("phone"), false);
assert.equal(csv.includes("13800138000"), false);
assert.equal(csv.includes("亚洲备注不要出现"), false);
assert.equal(csv.includes("完成率"), false);
assert.equal(csv.includes("接通率"), false);
const plain = csv.split("\r\n").find((line) => line.includes("2026-11-02 10:00"));
assert.ok(plain);
assert.match(plain, /—/);
const deleted = buildCallbackScheduleReport({
  source: {
    ...source,
    callbackSchedules: [],
    callbackDueQueueAudits: [],
    callbackScheduleAudits: [audit({ id: "cba_lead", action: "cancel", targetType: "lead", targetId: "l1" })]
  },
  teamId: "europe",
  query: { from: null, to: null },
  timeZone: "Asia/Shanghai",
  today: "2026-11-04"
});
assert.equal(deleted.counts.completedCount, 1);
assert.equal(deleted.rows[0]?.name, "");

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS callback_schedule_report_audits \(/);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS callback_schedule_report_audits \(/g) || []).length, 1);
assert.match(schema, /INSERT INTO callback_schedule_report_audits/);
assert.match(schema, /WHERE NOT EXISTS/);
assert.match(schema, /team_id = ''/);
assert.equal(schema.includes("DROP TABLE callback_schedule_report_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS callback_schedule_report_audits"), false);
assert.equal(schema.includes("ALTER TABLE callback_schedules"), false);
assert.equal(schema.includes("ALTER TABLE callback_schedule_audits"), false);
assert.equal(schema.includes("CREATE TABLE callback_schedule_reports"), false);
assert.equal(schema.includes("CREATE TABLE callback_report_schedules"), false);

const reportSource = readFileSync(new URL("./callback-schedule-report.ts", import.meta.url), "utf8");
assert.equal(reportSource.includes("CREATE TABLE"), false);
assert.equal(reportSource.includes("MakeCall"), false);
assert.equal(reportSource.includes("aliyuncs.com"), false);
assert.equal(reportSource.includes("convert_to_lead"), false);
assert.equal(reportSource.includes("approved_contactable"), false);
assert.equal(reportSource.includes("completionRate"), false);

console.log("callback schedule report tests passed");
