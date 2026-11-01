import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  renderCallbackReminderList,
  renderCallbackScheduleForm,
  toCallbackDateTimeLocal
} from "./callback-schedule.js";
import { renderIntentFollowupQueue } from "./intent-followup-queue.js";
import { renderOutboundCallRecordDetail, renderOutboundCallRecordList } from "./outbound-call-records.js";

assert.equal(toCallbackDateTimeLocal("2026-11-01 10:30"), "2026-11-01T10:30");

const form = renderCallbackScheduleForm({
  targetType: "customer",
  targetId: "c1",
  scheduledAt: "2026-11-01 10:30",
  note: "下午",
  due: "today"
});
assert.match(form, /data-callback-schedule-form="1"/);
assert.match(form, /data-target-id="c1"/);
assert.match(form, /保存回拨/);
assert.match(form, /data-callback-cancel="1"/);
assert.match(form, /data-callback-due="today"/);
assert.match(form, /今日到期/);
assert.equal(form.includes("data-outbound-call"), false);
assert.equal(form.includes("MakeCall"), false);
assert.equal(form.includes("拨号"), false);

const bare = renderCallbackScheduleForm({ recordId: "ocr_1", targetType: "lead", targetId: "l1" });
assert.match(bare, /data-callback-record="ocr_1"/);
assert.equal(bare.includes("data-callback-cancel"), false);
assert.equal(renderCallbackScheduleForm({}), "");

const reminders = renderCallbackReminderList([
  { targetType: "customer", targetId: "c1", targetLabel: "客户", name: "北欧", scheduledAt: "2026-10-31 09:00", note: "逾期备注", due: "overdue" },
  { targetType: "lead", targetId: "l1", targetLabel: "线索", name: "灯具", scheduledAt: "2026-11-01 10:00", due: "today" }
]);
assert.match(reminders, /data-callback-reminder="1"/);
assert.match(reminders, /data-callback-due="overdue"/);
assert.match(reminders, /已逾期/);
assert.match(reminders, /data-callback-open="intent-followup-queue"/);
assert.equal(reminders.includes("data-outbound-call"), false);
assert.equal(reminders.includes("/api/outbound-calls"), false);
assert.equal(reminders.includes("MakeCall"), false);
assert.match(renderCallbackReminderList([]), /data-callback-reminder-empty="1"/);
assert.equal(renderCallbackReminderList([]).includes(">0<"), false);

const many = renderCallbackReminderList(Array.from({ length: 9 }, (_, index) => ({
  targetType: "customer",
  targetId: `c${index}`,
  name: `客户${index}`,
  scheduledAt: "2026-11-01 10:00",
  due: "today" as const
})));
assert.equal((many.match(/data-callback-reminder="1"/g) || []).length, 8);
assert.match(many, /data-callback-reminder-more="1"/);
assert.match(many, /不会自动拨号/);
assert.match(many, /不会批量拨号/);

const queue = renderIntentFollowupQueue({
  filters: { callbackDue: "today" },
  items: []
});
assert.match(queue, /data-callback-filter-empty="1"/);
assert.equal(queue.includes("拨号"), false);

const row = renderIntentFollowupQueue({
  items: [{
    targetType: "customer",
    targetId: "c-intent",
    name: "有意向客户",
    outcome: "有意向",
    callbackScheduledAt: "2026-11-01 10:00",
    callbackNote: "记得打",
    callbackDue: "overdue"
  }]
});
assert.match(row, /data-callback-schedule-form="1"/);
assert.match(row, /data-callback-due="overdue"/);
assert.match(row, /记得打/);
assert.equal(row.includes("data-outbound-call"), false);
assert.equal(row.includes("拨号"), false);

const list = renderOutboundCallRecordList([{
  id: "ocr_1",
  targetType: "customer",
  targetId: "c1",
  callbackScheduledAt: "2026-11-01 10:00",
  callbackDue: "today",
  established: false
}]);
assert.match(list, /data-callback-record="ocr_1"/);
assert.match(list, /保存回拨/);
assert.equal(list.includes("data-outbound-call"), false);

const detail = renderOutboundCallRecordDetail({
  record: {
    id: "ocr_1",
    targetType: "lead",
    targetId: "l1",
    established: true,
    callbackScheduledAt: "2026-11-02 09:00",
    callbackDue: "later"
  }
});
assert.match(detail, /data-callback-schedule-panel="1"/);
assert.match(detail, /未到/);
assert.equal(detail.includes("MakeCall"), false);
assert.equal(detail.includes("data-outbound-call"), false);

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /id="dashboardCallbackSchedules"/);
assert.match(html, /id="dashboardCallbackScheduleDue"/);
assert.match(html, /今日到期回拨/);
assert.match(html, /已逾期回拨/);
assert.match(html, /id="intentFollowupCallbackDue"/);
assert.match(html, /不会自动拨号，也不会批量拨号/);
const dashboardStart = html.indexOf('id="dashboardCallbackSchedules"');
const dashboardEnd = html.indexOf('id="kdBoard"', dashboardStart);
const dashboard = html.slice(dashboardStart, dashboardEnd);
assert.match(dashboard, /回拨预约/);
assert.equal(dashboard.includes("data-outbound-call"), false);
assert.equal(dashboard.includes(">外呼<"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const submitStart = api.indexOf("async function submitCallbackSchedule");
const submitEnd = api.indexOf("async function loadCallbackReminders");
assert.ok(submitStart > 0 && submitEnd > submitStart);
const submit = api.slice(submitStart, submitEnd);
assert.match(submit, /\/api\/callback-schedules\/cancel/);
assert.match(submit, /\/api\/callback-schedules/);
assert.match(submit, /\/callback-schedule/);
assert.match(submit, /JSON\.stringify\(payload\)/);
assert.doesNotMatch(submit, /\/api\/outbound-calls|MakeCall|aliyuncs|callRecordIds/);
const openStart = api.indexOf('"#dashboardCallbackSchedules"');
const openSlice = api.slice(openStart, openStart + 500);
assert.match(openSlice, /activateNavView/);
assert.doesNotMatch(openSlice, /\/api\/outbound-calls|MakeCall|data-outbound-call/);
assert.match(api, /intentFollowupCallbackDue/);

console.log("callback schedule page tests passed");
