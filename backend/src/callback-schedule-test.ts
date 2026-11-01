import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  callbackScheduleDue,
  callbackScheduleView,
  normalizeCallbackNote,
  parseCallbackScheduledAt
} from "./callback-schedule-state.js";
import {
  parseCallCallbackRequest,
  parseCallbackCancelRequest,
  parseCallbackDueFilter,
  parseCallbackScheduleRequest
} from "./callback-schedule.js";

assert.equal(parseCallbackScheduledAt("2026-11-01 09:30"), "2026-11-01 09:30");
assert.equal(parseCallbackScheduledAt(" 2026-02-28 00:00 "), "2026-02-28 00:00");
assert.equal(parseCallbackScheduledAt("2026-02-29 10:00"), null);
assert.equal(parseCallbackScheduledAt("2026-11-01T09:30"), null);
assert.equal(parseCallbackScheduledAt("2026-11-01 24:00"), null);
assert.equal(parseCallbackScheduledAt("明天 10:00"), null);

assert.equal(normalizeCallbackNote(undefined).ok, true);
assert.equal(normalizeCallbackNote("  回访 ").ok && normalizeCallbackNote("  回访 ").note, "回访");
assert.equal(normalizeCallbackNote("注".repeat(200)).ok, true);
assert.equal(normalizeCallbackNote("注".repeat(201)).ok, false);
assert.equal(normalizeCallbackNote(12).ok, false);

assert.equal(callbackScheduleDue("2026-11-01 09:00", "2026-11-01"), "today");
assert.equal(callbackScheduleDue("2026-10-31 23:59", "2026-11-01"), "overdue");
assert.equal(callbackScheduleDue("2026-11-02 00:00", "2026-11-01"), "later");
assert.equal(callbackScheduleDue("2026-11-01 00:00", "2026-11-01"), "today");

assert.equal(parseCallbackDueFilter(undefined), "due");
assert.equal(parseCallbackDueFilter("today"), "today");
assert.equal(parseCallbackDueFilter("overdue"), "overdue");
assert.equal(parseCallbackDueFilter("later"), null);
assert.equal(parseCallbackDueFilter(["today"]), null);

const parsed = parseCallbackScheduleRequest({
  targetType: "customer",
  targetId: "c1",
  scheduledAt: "2026-11-01 10:00",
  note: " 下午回 "
});
assert.equal(parsed.ok, true);
if (parsed.ok) assert.equal(parsed.note, "下午回");
assert.equal(parseCallbackScheduleRequest({ targetType: "customer", targetId: "c1", scheduledAt: "2026-11-01 10:00", records: [] }).ok, false);
assert.equal(parseCallbackScheduleRequest({ targetType: "vendor", targetId: "c1", scheduledAt: "2026-11-01 10:00" }).ok, false);
assert.equal(parseCallbackCancelRequest({ targetType: "lead", targetId: "l1" }).ok, true);
assert.equal(parseCallbackCancelRequest({ targetType: "lead", targetId: "l1", scheduledAt: "2026-11-01 10:00" }).ok, false);
assert.equal(parseCallCallbackRequest({ cancel: true }).ok, true);
assert.equal(parseCallCallbackRequest({ cancel: true, note: "x" }).ok, false);
assert.equal(parseCallCallbackRequest({ scheduledAt: "2026-11-01 10:00" }).ok, true);

const view = callbackScheduleView({
  callbackSchedules: [{
    id: "cbs_1",
    teamId: "europe",
    targetType: "customer",
    targetId: "c1",
    scheduledAt: "2026-10-31 09:00",
    note: "旧",
    updatedBy: "u1",
    updatedAt: "2026-10-01T00:00:00.000Z",
    sourceCallRecordId: ""
  }]
}, "europe", "customer", "c1", "2026-11-01");
assert.equal(view.callbackDue, "overdue");
assert.equal(view.callbackNote, "旧");
assert.equal(callbackScheduleView({ callbackSchedules: [] }, "europe", "customer", "c1", "2026-11-01").callbackScheduledAt, "");

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS callback_schedules \(/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS callback_schedule_audits \(/);
assert.equal(schema.includes("CREATE TABLE callback_schedule_audits"), false);
assert.equal(schema.includes("CREATE TABLE callback_schedules ("), false);
const source = readFileSync(new URL("./callback-schedule.ts", import.meta.url), "utf8");
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("convert_to_lead"), false);

console.log("callback schedule tests passed");
