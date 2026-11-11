import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { queueCallGlanceMarkup } from "./queue-call-glance.js";
import { renderIntentFollowupRows } from "./intent-followup-queue.js";
import { renderNegativeOutcomeFollowup } from "./negative-outcome-followup.js";
import { renderOtherOutcomeFollowup } from "./other-outcome-followup.js";
import { renderTodayFollowNext } from "./today-follow-advance.js";
import { renderUnansweredPendingQueue } from "./unanswered-pending-queue.js";
import { renderUnlabeledConnectedFollowup } from "./unlabeled-connected-followup.js";

assert.equal(queueCallGlanceMarkup(undefined), "");
assert.equal(queueCallGlanceMarkup({}), "");
assert.equal(queueCallGlanceMarkup({ todayCallCount: 1.5, lastCallOutcome: "有意向" }), "");
assert.equal(queueCallGlanceMarkup({ todayCallCount: -1, lastCallOutcome: "有意向" }), "");

const marked = queueCallGlanceMarkup({ todayCallCount: 2, lastCallOutcome: "需回访", lastCallAt: "2026-11-04 16:00" });
assert.match(marked, /data-queue-call-glance="1">今日已拨 2 次/);
assert.match(marked, /data-queue-call-last-outcome="1">需回访/);
assert.match(marked, /data-queue-call-last-at="1">最近一次通话 2026-11-04 16:00/);
assert.equal(marked.includes("<button"), false);
assert.equal(marked.includes("外呼"), false);
assert.equal(marked.includes("拨打"), false);

const zero = queueCallGlanceMarkup({ todayCallCount: 0, lastCallOutcome: "" });
assert.match(zero, /今日已拨 0 次/);
assert.match(zero, /data-queue-call-last-outcome="1">未标注/);
assert.match(zero, /data-queue-call-last-at="1">最近一次通话 —/);

const escaped = queueCallGlanceMarkup({ todayCallCount: 1, lastCallOutcome: "<img>", lastCallAt: "<img>" });
assert.match(escaped, /&lt;img&gt;/);
assert.equal(escaped.includes("<img>"), false);

const unanswered = renderUnansweredPendingQueue({
  scope: "mine",
  items: [{
    targetType: "customer",
    targetId: "c1",
    name: "Nordic",
    callRecordId: "ocr1",
    todayCallCount: 2,
    lastCallOutcome: "需回访",
    lastCallAt: "2026-11-04 16:00",
    unansweredAt: "2026-11-02 10:00"
  }]
});
assert.match(unanswered, /data-unanswered-pending-row="1"/);
assert.match(unanswered, /data-queue-call-glance="1">今日已拨 2 次/);
assert.match(unanswered, /data-queue-call-last-outcome="1">需回访/);
assert.match(unanswered, /data-queue-call-last-at="1">最近一次通话 2026-11-04 16:00/);
assert.match(unanswered, /data-unanswered-pending-at="1">2026-11-02 10:00/);
assert.equal(unanswered.includes("拨打"), false);

const plain = renderUnansweredPendingQueue({
  scope: "mine",
  items: [{ targetType: "customer", targetId: "c2", name: "Hidden", callRecordId: "ocr2" }]
});
assert.match(plain, /data-unanswered-pending-row="1"/);
assert.equal(plain.includes("data-queue-call-glance"), false);
assert.equal(plain.includes("data-queue-call-last-outcome"), false);
assert.equal(plain.includes("data-queue-call-last-at"), false);

const today = renderTodayFollowNext({
  next: {
    targetType: "customer",
    targetId: "c1",
    name: "Early <Co>",
    nextFollowAt: "2026-11-04 09:00",
    preferred: true,
    maskedNumber: "****8000",
    todayCallCount: 0,
    lastCallOutcome: "未标注",
    lastCallAt: "—"
  }
});
assert.match(today, /data-today-follow-next-open="1"/);
assert.match(today, /今日已拨 0 次/);
assert.match(today, /data-queue-call-last-outcome="1">未标注/);
assert.match(today, /data-queue-call-last-at="1">最近一次通话 —/);
assert.match(today, /Early &lt;Co&gt;/);
assert.equal(today.includes("自动拨号"), true);
const todayPlain = renderTodayFollowNext({
  next: { targetType: "customer", targetId: "c1", name: "Early" }
});
assert.equal(todayPlain.includes("data-queue-call-glance"), false);
assert.equal(todayPlain.includes("data-queue-call-last-at"), false);

const intent = renderIntentFollowupRows([{
  targetType: "lead",
  targetId: "l1",
  name: "Lead",
  outcome: "有意向",
  todayCallCount: 1,
  lastCallOutcome: "有意向",
  lastCallAt: "2026-11-04 09:00"
}], "");
assert.match(intent, /data-intent-followup-row="1"/);
assert.match(intent, /今日已拨 1 次/);
assert.match(intent, /data-queue-call-last-outcome="1">有意向/);
assert.match(intent, /data-queue-call-last-at="1">最近一次通话 2026-11-04 09:00/);

const negative = renderNegativeOutcomeFollowup({
  items: [{
    targetType: "customer",
    targetId: "c1",
    name: "Neg",
    callRecordId: "ocr",
    outcome: "无意向",
    todayCallCount: 3,
    lastCallOutcome: "无意向",
    lastCallAt: "2026-11-04 16:00"
  }]
});
assert.match(negative, /今日已拨 3 次/);
assert.match(negative, /data-negative-outcome-followup-outcome="1">无意向/);
assert.match(negative, /data-queue-call-last-at="1">最近一次通话 2026-11-04 16:00/);

const other = renderOtherOutcomeFollowup({
  items: [{
    targetType: "prospect",
    targetId: "p1",
    name: "Other",
    callRecordId: "ocr",
    outcome: "其他",
    todayCallCount: 1,
    lastCallOutcome: "其他",
    lastCallAt: "2026-11-03 18:00"
  }]
});
assert.match(other, /data-queue-call-last-outcome="1">其他/);
assert.match(other, /data-queue-call-last-at="1">最近一次通话 2026-11-03 18:00/);

const unlabeled = renderUnlabeledConnectedFollowup({
  items: [{
    targetType: "customer",
    targetId: "c1",
    name: "Open",
    callRecordId: "ocr",
    outcome: "未标注",
    todayCallCount: 1,
    lastCallOutcome: "未标注",
    lastCallAt: "2026-11-04 09:00"
  }]
});
assert.match(unlabeled, /data-unlabeled-connected-followup-outcome="1">未标注/);
assert.match(unlabeled, /data-queue-call-last-outcome="1">未标注/);
assert.match(unlabeled, /今日已拨 1 次/);
assert.match(unlabeled, /data-queue-call-last-at="1">最近一次通话 2026-11-04 09:00/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /renderUnansweredPendingQueue\(data/);
assert.match(api, /renderTodayFollowNext\(/);
assert.equal(api.includes("queue-call-glance-dial"), false);

console.log("queue call glance frontend tests passed");
