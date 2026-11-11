import assert from "node:assert/strict";
import {
  applyQueueCallGlanceView,
  parseQueueCallGlanceView,
  takeQueueCallGlanceView
} from "./queue-call-glance-view.js";

assert.deepEqual(parseQueueCallGlanceView({}), { todayCalls: "", lastOutcome: "", todayCallSort: "" });
assert.deepEqual(parseQueueCallGlanceView({ todayCalls: " 0 ", lastOutcome: " 未标注 ", todayCallSort: "uncalled" }), {
  todayCalls: "0",
  lastOutcome: "未标注",
  todayCallSort: "uncalled"
});
assert.equal(parseQueueCallGlanceView({ todayCalls: "3" }), null);
assert.equal(parseQueueCallGlanceView({ todayCalls: ["0"] }), null);
assert.equal(parseQueueCallGlanceView({ lastOutcome: "Success" }), null);
assert.equal(parseQueueCallGlanceView({ todayCallSort: "asc" }), null);
assert.equal(parseQueueCallGlanceView({ todayCalls: "2" }), null);

const hidden = { id: "hidden", targetType: "customer", targetId: "h" };
const zero = { id: "zero", targetType: "customer", targetId: "z", todayCallCount: 0, lastCallOutcome: "无意向" };
const once = { id: "once", targetType: "customer", targetId: "o", todayCallCount: 1, lastCallOutcome: "未标注" };
const twice = { id: "twice", targetType: "customer", targetId: "t", todayCallCount: 2, lastCallOutcome: "需回访" };
const rows = [hidden, twice, zero, once];

assert.deepEqual(applyQueueCallGlanceView(rows, { todayCalls: "", lastOutcome: "", todayCallSort: "" }).map((row) => row.id), ["hidden", "twice", "zero", "once"]);
assert.deepEqual(applyQueueCallGlanceView(rows, { todayCalls: "0", lastOutcome: "", todayCallSort: "" }).map((row) => row.id), ["zero"]);
assert.deepEqual(applyQueueCallGlanceView(rows, { todayCalls: "1", lastOutcome: "", todayCallSort: "" }).map((row) => row.id), ["once"]);
assert.deepEqual(applyQueueCallGlanceView(rows, { todayCalls: "2+", lastOutcome: "", todayCallSort: "" }).map((row) => row.id), ["twice"]);
assert.deepEqual(applyQueueCallGlanceView(rows, { todayCalls: "", lastOutcome: "未标注", todayCallSort: "" }).map((row) => row.id), ["once"]);
assert.deepEqual(applyQueueCallGlanceView(rows, { todayCalls: "", lastOutcome: "需回访", todayCallSort: "called" }).map((row) => row.id), ["twice"]);
assert.deepEqual(applyQueueCallGlanceView(rows, { todayCalls: "", lastOutcome: "", todayCallSort: "uncalled" }).map((row) => row.id), ["zero", "once", "twice", "hidden"]);
assert.deepEqual(applyQueueCallGlanceView(rows, { todayCalls: "", lastOutcome: "", todayCallSort: "called" }).map((row) => row.id), ["twice", "once", "zero", "hidden"]);
assert.deepEqual(applyQueueCallGlanceView([
  { id: "a", todayCallCount: 0, lastCallOutcome: "未标注" },
  { id: "b", todayCallCount: 0, lastCallOutcome: "有意向" }
], { todayCalls: "", lastOutcome: "", todayCallSort: "uncalled" }).map((row) => row.id), ["a", "b"]);

const taken = takeQueueCallGlanceView({ scope: "mine", todayCalls: "0", extra: "1" });
assert.equal(taken.ok, true);
if (taken.ok) {
  assert.deepEqual(taken.view, { todayCalls: "0", lastOutcome: "", todayCallSort: "" });
  assert.deepEqual(taken.rest, { scope: "mine", extra: "1" });
}
assert.equal(takeQueueCallGlanceView({ todayCalls: "0", lastOutcome: ["未标注"] }).ok, false);

console.log("queue call glance view tests passed");
