import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCallbackDueQueueCsv,
  callbackDueAgeSeconds,
  callbackWallClockEpochMs,
  formatCallbackDueAge,
  parseCallbackDueComplete,
  parseCallbackDueQueueQuery,
  type CallbackDueQueueItem
} from "./callback-due-queue.js";

const now = new Date("2026-11-04T02:30:00.000Z");
assert.equal(callbackDueAgeSeconds("2026-11-04 10:00", "Asia/Shanghai", now), 30 * 60);
assert.equal(formatCallbackDueAge(30 * 60), "30分钟");
assert.equal(callbackDueAgeSeconds("2026-11-04 18:00", "Asia/Shanghai", now), 0);
assert.equal(formatCallbackDueAge(0), "0秒");
assert.equal(callbackDueAgeSeconds("2026-11-03 10:00", "Asia/Shanghai", now), 86400 + 30 * 60);
assert.equal(formatCallbackDueAge(86400), "1天");
assert.equal(formatCallbackDueAge(60), "1分钟");
assert.equal(formatCallbackDueAge(3600), "1小时");
assert.equal(callbackDueAgeSeconds("不是时间", "Asia/Shanghai", now), null);
assert.equal(formatCallbackDueAge(null), "—");
assert.equal(callbackWallClockEpochMs("2026-11-04 10:00", "America/New_York"), Date.parse("2026-11-04T15:00:00.000Z"));

assert.deepEqual(parseCallbackDueQueueQuery({ scope: "mine" }), { scope: "mine", overdueOnly: false });
assert.deepEqual(parseCallbackDueQueueQuery({ scope: "team", overdue: "1" }), { scope: "team", overdueOnly: true });
assert.equal(parseCallbackDueQueueQuery({ scope: "all" }), null);
assert.equal(parseCallbackDueQueueQuery({ scope: "mine", overdue: "0" }), null);
assert.equal(parseCallbackDueQueueQuery({ scope: "mine", extra: "1" }), null);
assert.equal(parseCallbackDueQueueQuery({ scope: ["mine"] }), null);
assert.equal(parseCallbackDueComplete({ targetType: "customer", targetId: "c1", reason: "reached" }).ok, true);
assert.equal(parseCallbackDueComplete({ targetType: "customer", targetId: "c1" }).ok, false);
assert.equal(parseCallbackDueComplete({ targetType: "customer", targetId: "c1", reason: "已回拨" }).ok, false);
assert.equal(parseCallbackDueComplete({ targetType: "customer", targetId: "c1", reason: "reached", ids: ["c1"] }).ok, false);

const row: CallbackDueQueueItem = {
  targetType: "customer",
  targetId: "c1",
  targetLabel: "客户",
  name: "Nordic",
  scheduledAt: "2026-11-03 10:00",
  note: "=改期",
  due: "overdue",
  ownerAgentId: "",
  ownerAgentLabel: "",
  ageSeconds: 86400,
  ageLabel: "1天"
};
const csv = buildCallbackDueQueueCsv([row]);
assert.equal(csv.startsWith("\uFEFF"), true);
assert.match(csv, /对象类型,对象,预约时间,备注,负责坐席,已过多久,到期/);
assert.match(csv, /'=改期/);
assert.match(csv, /未指派/);
assert.equal(csv.includes("\n") && csv.includes("\r\n"), true);
assert.equal(csv.includes("phone"), false);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS callback_due_queue_audits \(/);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS callback_due_queue_audits \(/g) || []).length, 1);
assert.match(schema, /INSERT INTO callback_due_queue_audits/);
assert.match(schema, /WHERE NOT EXISTS/);
assert.match(schema, /team_id = ''/);
assert.equal(schema.includes("DROP TABLE callback_due_queue_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS callback_due_queue_audits"), false);
assert.equal(schema.includes("ALTER TABLE callback_schedules"), false);
assert.equal(schema.includes("CREATE TABLE callback_due_schedules"), false);

const source = readFileSync(new URL("./callback-due-queue.ts", import.meta.url), "utf8");
assert.match(source, /listCallbackSchedules/);
assert.match(source, /cancelDueCallback/);
assert.equal(source.includes("CREATE TABLE"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);

console.log("callback due queue tests passed");
