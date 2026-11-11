import assert from "node:assert/strict";
import { parseQueueCallWallMinute } from "./queue-call-glance.js";
import {
  applyQueueCallGlanceView,
  parseQueueCallGlanceView,
  queueCallGlanceClock,
  takeQueueCallGlanceView,
  type QueueCallGlanceView
} from "./queue-call-glance-view.js";

const blank = { todayCalls: "", lastOutcome: "", todayCallSort: "", lastCallWithin: "", lastCallSort: "" } as const;

assert.deepEqual(parseQueueCallGlanceView({}), blank);
assert.deepEqual(parseQueueCallGlanceView({ todayCalls: " 0 ", lastOutcome: " 未标注 ", todayCallSort: "uncalled" }), {
  ...blank,
  todayCalls: "0",
  lastOutcome: "未标注",
  todayCallSort: "uncalled"
});
assert.deepEqual(parseQueueCallGlanceView({ lastCallWithin: " 1h ", lastCallSort: "older" }), {
  ...blank,
  lastCallWithin: "1h",
  lastCallSort: "older"
});
assert.equal(parseQueueCallGlanceView({ todayCalls: "3" }), null);
assert.equal(parseQueueCallGlanceView({ todayCalls: ["0"] }), null);
assert.equal(parseQueueCallGlanceView({ lastOutcome: "Success" }), null);
assert.equal(parseQueueCallGlanceView({ todayCallSort: "asc" }), null);
assert.equal(parseQueueCallGlanceView({ todayCalls: "2" }), null);
assert.equal(parseQueueCallGlanceView({ lastCallWithin: "2h" }), null);
assert.equal(parseQueueCallGlanceView({ lastCallSort: "asc" }), null);
assert.equal(parseQueueCallGlanceView({ lastCallWithin: ["1h"] }), null);

const hidden = { id: "hidden", targetType: "customer", targetId: "h" };
const zero = { id: "zero", targetType: "customer", targetId: "z", todayCallCount: 0, lastCallOutcome: "无意向" };
const once = { id: "once", targetType: "customer", targetId: "o", todayCallCount: 1, lastCallOutcome: "未标注" };
const twice = { id: "twice", targetType: "customer", targetId: "t", todayCallCount: 2, lastCallOutcome: "需回访" };
const rows = [hidden, twice, zero, once];

function view(partial: Partial<QueueCallGlanceView> = {}): QueueCallGlanceView {
  return { ...blank, ...partial };
}

assert.deepEqual(applyQueueCallGlanceView(rows, view()).map((row) => row.id), ["hidden", "twice", "zero", "once"]);
assert.deepEqual(applyQueueCallGlanceView(rows, view({ todayCalls: "0" })).map((row) => row.id), ["zero"]);
assert.deepEqual(applyQueueCallGlanceView(rows, view({ todayCalls: "1" })).map((row) => row.id), ["once"]);
assert.deepEqual(applyQueueCallGlanceView(rows, view({ todayCalls: "2+" })).map((row) => row.id), ["twice"]);
assert.deepEqual(applyQueueCallGlanceView(rows, view({ lastOutcome: "未标注" })).map((row) => row.id), ["once"]);
assert.deepEqual(applyQueueCallGlanceView(rows, view({ lastOutcome: "需回访", todayCallSort: "called" })).map((row) => row.id), ["twice"]);
assert.deepEqual(applyQueueCallGlanceView(rows, view({ todayCallSort: "uncalled" })).map((row) => row.id), ["zero", "once", "twice", "hidden"]);
assert.deepEqual(applyQueueCallGlanceView(rows, view({ todayCallSort: "called" })).map((row) => row.id), ["twice", "once", "zero", "hidden"]);
assert.deepEqual(applyQueueCallGlanceView([
  { id: "a", todayCallCount: 0, lastCallOutcome: "未标注" },
  { id: "b", todayCallCount: 0, lastCallOutcome: "有意向" }
], view({ todayCallSort: "uncalled" })).map((row) => row.id), ["a", "b"]);

const now = new Date("2026-11-04T02:30:00.000Z");
const clock = queueCallGlanceClock(now, "Asia/Shanghai");
assert.equal(parseQueueCallWallMinute("2026-11-04 10:00", "Asia/Shanghai"), Date.parse("2026-11-04T02:00:00.000Z"));
assert.equal(parseQueueCallWallMinute("2026-11-04 09:30", "Asia/Shanghai"), Date.parse("2026-11-04T01:30:00.000Z"));
assert.equal(parseQueueCallWallMinute("—", "Asia/Shanghai"), null);
assert.equal(parseQueueCallWallMinute("2026-11-04 10:00", "Not/AZone"), null);

const recent = { id: "recent", todayCallCount: 1, lastCallOutcome: "有意向", lastCallAt: "2026-11-04 10:10" };
const half = { id: "half", todayCallCount: 1, lastCallOutcome: "有意向", lastCallAt: "2026-11-04 10:00" };
const halfOut = { id: "halfOut", todayCallCount: 1, lastCallOutcome: "有意向", lastCallAt: "2026-11-04 09:59" };
const hour = { id: "hour", todayCallCount: 1, lastCallOutcome: "需回访", lastCallAt: "2026-11-04 09:30" };
const hourOut = { id: "hourOut", todayCallCount: 1, lastCallOutcome: "有意向", lastCallAt: "2026-11-04 09:29" };
const future = { id: "future", todayCallCount: 1, lastCallOutcome: "有意向", lastCallAt: "2026-11-04 10:31" };
const yesterday = { id: "yesterday", todayCallCount: 0, lastCallOutcome: "无意向", lastCallAt: "2026-11-03 10:30" };
const dash = { id: "dash", todayCallCount: 0, lastCallOutcome: "未标注", lastCallAt: "—" };
const sameA = { id: "sameA", todayCallCount: 1, lastCallOutcome: "有意向", lastCallAt: "2026-11-04 09:30" };
const sameB = { id: "sameB", todayCallCount: 4, lastCallOutcome: "有意向", lastCallAt: "2026-11-04 09:30" };
const timedRows = [hidden, dash, future, recent, yesterday, hourOut, hour, halfOut, half, sameA, sameB];

assert.deepEqual(applyQueueCallGlanceView(timedRows, view({ lastCallWithin: "30m" }), clock).map((row) => row.id), ["recent", "half"]);
assert.deepEqual(applyQueueCallGlanceView(timedRows, view({ lastCallWithin: "1h" }), clock).map((row) => row.id), ["recent", "hour", "halfOut", "half", "sameA", "sameB"]);
assert.deepEqual(applyQueueCallGlanceView(timedRows, view({ lastCallWithin: "today" }), clock).map((row) => row.id), ["future", "recent", "hourOut", "hour", "halfOut", "half", "sameA", "sameB"]);
assert.equal(applyQueueCallGlanceView(timedRows, view({ lastCallWithin: "1h" }), clock).some((row) => row.id === "hidden" || row.id === "dash"), false);
assert.deepEqual(applyQueueCallGlanceView(timedRows, view({ lastCallWithin: "today", todayCalls: "0" }), clock).map((row) => row.id), []);
assert.deepEqual(applyQueueCallGlanceView(timedRows, view({ lastCallSort: "older" }), clock).map((row) => row.id), ["yesterday", "hourOut", "hour", "sameA", "sameB", "halfOut", "half", "recent", "future", "hidden", "dash"]);
assert.deepEqual(applyQueueCallGlanceView(timedRows, view({ lastCallSort: "newer" }), clock).map((row) => row.id), ["future", "recent", "half", "halfOut", "hour", "sameA", "sameB", "hourOut", "yesterday", "hidden", "dash"]);
assert.deepEqual(applyQueueCallGlanceView(timedRows, view({ lastCallSort: "older", todayCallSort: "called" }), clock).map((row) => row.id), ["yesterday", "hourOut", "sameB", "hour", "sameA", "halfOut", "half", "recent", "future", "dash", "hidden"]);
assert.deepEqual(applyQueueCallGlanceView(timedRows, view({ lastCallWithin: "1h", todayCallSort: "uncalled" }), clock).map((row) => row.id), ["recent", "hour", "halfOut", "half", "sameA", "sameB"]);
assert.deepEqual(applyQueueCallGlanceView(timedRows, view(), clock).map((row) => row.id), timedRows.map((row) => row.id));
const ny = queueCallGlanceClock(now, "America/New_York");
assert.equal(parseQueueCallWallMinute("2026-11-03 10:00", "America/New_York"), Date.parse("2026-11-03T15:00:00.000Z"));
assert.deepEqual(applyQueueCallGlanceView([
  { id: "nyToday", todayCallCount: 1, lastCallOutcome: "有意向", lastCallAt: "2026-11-03 10:00" },
  { id: "nyYest", todayCallCount: 0, lastCallOutcome: "无意向", lastCallAt: "2026-11-02 21:30" }
], view({ lastCallWithin: "today" }), ny).map((row) => row.id), ["nyToday"]);

const taken = takeQueueCallGlanceView({ scope: "mine", todayCalls: "0", lastCallWithin: "30m", extra: "1" });
assert.equal(taken.ok, true);
if (taken.ok) {
  assert.deepEqual(taken.view, { ...blank, todayCalls: "0", lastCallWithin: "30m" });
  assert.deepEqual(taken.rest, { scope: "mine", extra: "1" });
}
assert.equal(takeQueueCallGlanceView({ todayCalls: "0", lastOutcome: ["未标注"] }).ok, false);
assert.equal(takeQueueCallGlanceView({ lastCallSort: ["older"] }).ok, false);

console.log("queue call glance view tests passed");
