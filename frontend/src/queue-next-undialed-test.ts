import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  chooseQueueUndialedFocus,
  queueUndialedKey,
  readQueueTodayCallCount,
  type QueueUndialedCandidate
} from "./queue-next-undialed.js";

function row(targetType: string, targetId: string, todayCallCount: number | null): QueueUndialedCandidate {
  return { targetType, targetId, todayCallCount };
}

const rows = [
  row("customer", "a", 0),
  row("lead", "b", 0),
  row("prospect", "c", 2),
  row("customer", "d", 0),
  row("lead", "hidden", null)
];
const keys = rows.map((item) => queueUndialedKey(item));

assert.equal(readQueueTodayCallCount("今日已拨 0 次"), 0);
assert.equal(readQueueTodayCallCount("今日已拨 2 次"), 2);
assert.equal(readQueueTodayCallCount(null), null);
assert.equal(readQueueTodayCallCount("未标注"), null);
assert.equal(readQueueTodayCallCount("今日已拨 1.5 次"), null);

assert.equal(chooseQueueUndialedFocus(rows, { targetType: "customer", targetId: "a" }, keys.slice(1), keys), 1);
assert.equal(chooseQueueUndialedFocus(rows, { targetType: "prospect", targetId: "c" }, keys.slice(3), keys), 3);
assert.equal(chooseQueueUndialedFocus(rows, { targetType: "customer", targetId: "d" }, [], keys), 3);
assert.equal(chooseQueueUndialedFocus(rows, { targetType: "lead", targetId: "hidden" }, [], keys), 4);

const dialed = [
  row("customer", "a", 1),
  row("lead", "b", 0),
  row("prospect", "c", 0)
];
const dialedKeys = dialed.map((item) => queueUndialedKey(item));
assert.equal(chooseQueueUndialedFocus(dialed, { targetType: "customer", targetId: "a" }, dialedKeys.slice(1), dialedKeys), 1);

const stayed = [
  row("customer", "a", 0),
  row("lead", "b", 3)
];
assert.equal(
  chooseQueueUndialedFocus(stayed, { targetType: "lead", targetId: "b" }, [], stayed.map((item) => queueUndialedKey(item))),
  1
);

const dropped = [
  row("customer", "a", 0),
  row("lead", "c", 1),
  row("prospect", "d", 0)
];
assert.equal(
  chooseQueueUndialedFocus(
    dropped,
    { targetType: "lead", targetId: "gone" },
    [queueUndialedKey(dropped[1]), queueUndialedKey(dropped[2])],
    [queueUndialedKey(row("customer", "a", 0)), queueUndialedKey(row("lead", "gone", 0)), ...dropped.slice(1).map((item) => queueUndialedKey(item))]
  ),
  2
);

const onlyLaterCalled = [row("customer", "a", 0), row("lead", "c", 2)];
assert.equal(
  chooseQueueUndialedFocus(
    onlyLaterCalled,
    { targetType: "lead", targetId: "gone" },
    [queueUndialedKey(onlyLaterCalled[1])],
    [queueUndialedKey(row("lead", "gone", 0)), queueUndialedKey(onlyLaterCalled[1])]
  ),
  1
);

assert.equal(
  chooseQueueUndialedFocus(
    [row("customer", "a", 0), row("lead", "b", 0)],
    { targetType: "prospect", targetId: "last" },
    [],
    [queueUndialedKey(row("customer", "a", 0)), queueUndialedKey(row("lead", "b", 0)), queueUndialedKey(row("prospect", "last", 0))]
  ),
  -1
);

const replaced = [row("lead", "next", 0)];
assert.equal(
  chooseQueueUndialedFocus(replaced, { targetType: "customer", targetId: "current" }, [], [queueUndialedKey(row("customer", "current", 0))]),
  0
);
assert.equal(
  chooseQueueUndialedFocus([row("lead", "next", 4)], { targetType: "customer", targetId: "current" }, [], [queueUndialedKey(row("customer", "current", 0))]),
  0
);
assert.equal(chooseQueueUndialedFocus([], { targetType: "customer", targetId: "a" }, []), -1);
assert.equal(chooseQueueUndialedFocus(rows, { targetType: " ", targetId: " " }, [], keys), -1);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
for (const id of [
  "dashboardUnansweredPendingNote",
  "dashboardNegativeOutcomeFollowupNote",
  "dashboardOtherOutcomeFollowupNote",
  "dashboardUnlabeledConnectedFollowupNote",
  "dashboardTodayFollowNextNote"
]) {
  const start = page.indexOf(`id="${id}"`);
  const end = page.indexOf("</p>", start);
  assert.ok(start > 0 && end > start, id);
  const note = page.slice(start, end);
  assert.match(note, /下一条今日未拨/);
  assert.match(note, /不打开详情/);
  assert.match(note, /打开工作台本身不拉这一份/);
}
const intentStart = page.indexOf('id="intent-followup-queue"');
const intentEnd = page.indexOf('id="phone-strategies"', intentStart);
const intent = page.slice(intentStart, intentEnd);
assert.match(intent, /data-intent-followup-open|点名称打开这个对象/);
assert.match(intent, /下一条今日未拨/);
assert.match(intent, /不能拨号/);
assert.equal(intent.includes(">拨号<"), false);
const batch = page.slice(page.indexOf('id="dashboardCallOutcomeBatchNote"'), page.indexOf('id="dashboardTodayFollowNext"'));
assert.equal(batch.includes("下一条今日未拨"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /function applyQueueUndialedFocus/);
assert.match(api, /function armQueueUndialedFromOutcome/);
assert.match(api, /chooseQueueUndialedFocus/);
assert.match(api, /data-queue-undialed-focus/);
assert.match(api, /data-intent-followup-open/);
assert.match(api, /openNextTodayFollow\(form\.dataset\.targetType/);
assert.match(api, /openDetail !== false/);
for (const id of [
  "intentFollowup",
  "dashboardUnansweredPending",
  "dashboardNegativeOutcomeFollowup",
  "dashboardOtherOutcomeFollowup",
  "dashboardUnlabeledConnectedFollowup",
  "dashboardTodayFollowNext"
]) {
  assert.match(api, new RegExp(`applyQueueUndialedFocus\\("${id}"\\)`));
}
const focusStart = api.indexOf("function applyQueueUndialedFocus");
const focusEnd = api.indexOf("\nfunction ", focusStart + 1);
const focus = api.slice(focusStart, focusEnd);
assert.equal(focus.includes("fetch("), false);
assert.equal(focus.includes("api("), false);
assert.equal(focus.includes("toast("), false);
assert.equal(focus.includes("openCallbackDueObject"), false);
assert.equal(focus.includes("MakeCall"), false);
assert.equal(focus.includes("/api/"), false);
const openerStart = api.indexOf("async function openNextTodayFollow");
const openerEnd = api.indexOf("async function loadIntentFollowupQueue", openerStart);
const opener = api.slice(openerStart, openerEnd);
assert.match(opener, /openCallbackDueObject/);
assert.match(opener, /\/api\/today-follow-next/);
assert.doesNotMatch(opener, /MakeCall|aliyuncs/);
assert.equal(readFileSync(new URL("./queue-next-undialed.ts", import.meta.url), "utf8").includes("CREATE TABLE"), false);

const css = readFileSync(new URL("./theme-keduoduo.css", import.meta.url), "utf8");
assert.match(css, /\[data-queue-undialed-focus="1"\]/);

console.log("queue next undialed focus tests passed");
