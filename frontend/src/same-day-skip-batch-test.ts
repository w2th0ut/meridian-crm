import assert from "node:assert/strict";
import { renderIntentFollowupQueue } from "./intent-followup-queue.js";
import { renderNegativeOutcomeFollowup } from "./negative-outcome-followup.js";
import { renderOtherOutcomeFollowup } from "./other-outcome-followup.js";
import { sameDaySkipBatchBody, sameDaySkipBatchForm, sameDaySkipBatchPick } from "./same-day-skip-batch.js";
import { renderTodayFollowNext } from "./today-follow-advance.js";
import { renderUnansweredPendingQueue } from "./unanswered-pending-queue.js";
import { renderUnlabeledConnectedFollowup } from "./unlabeled-connected-followup.js";

const form = sameDaySkipBatchForm(true);
assert.match(form, /data-same-day-skip-batch="1"/);
assert.match(form, /今日不再拨/);
assert.match(form, /data-same-day-skip-batch-reason="1"/);
assert.match(form, /data-same-day-skip-batch-resume="1"/);
assert.match(form, /对方要求改日再打/);
assert.match(form, /不会拨出/);
assert.equal(form.includes("外呼"), false);
assert.equal(form.includes("MakeCall"), false);
assert.equal(form.includes('value="2026-'), false);
assert.equal(sameDaySkipBatchForm(false), "");

const pick = sameDaySkipBatchPick("customer", "c<1>", true);
assert.match(pick, /data-same-day-skip-batch-pick="1"/);
assert.match(pick, /value="customer:c&lt;1&gt;"/);
assert.equal(sameDaySkipBatchPick("customer", "c1", false), "");
assert.equal(sameDaySkipBatchPick("other", "c1", true), "");

const body = sameDaySkipBatchBody({
  targets: [{ targetType: "lead", targetId: "l1" }],
  reason: " asked_later ",
  note: "  改日  ",
  resumeOn: "  "
});
assert.equal(body.reason, "asked_later");
assert.equal(body.note, "改日");
assert.equal("resumeOn" in body, false);
assert.deepEqual(sameDaySkipBatchBody({
  targets: [{ targetType: "prospect", targetId: "p1" }],
  reason: "other",
  resumeOn: "2026-11-20"
}).resumeOn, "2026-11-20");

const row = {
  targetType: "customer",
  targetId: "c1",
  name: "Nordic <Tools>",
  callRecordId: "ocr_1",
  outcome: "无意向",
  nextFollowAt: "2026-11-10 09:00"
};
const negative = renderNegativeOutcomeFollowup({ scope: "mine", items: [row] }, undefined, true);
assert.match(negative, /data-same-day-skip-batch="1"/);
assert.match(negative, /data-same-day-skip-batch-pick="1"/);
assert.match(negative, /清除下次跟进/);
assert.match(negative, /Nordic &lt;Tools&gt;/);
assert.equal(negative.includes("外呼"), false);
assert.equal(renderNegativeOutcomeFollowup({ scope: "mine", items: [row] }).includes("data-same-day-skip-batch"), false);

const other = renderOtherOutcomeFollowup({ scope: "mine", items: [{ ...row, outcome: "其他" }] }, undefined, true);
assert.match(other, /data-missing-next-followup-batch="1"/);
assert.match(other, /data-same-day-skip-batch="1"/);
assert.match(other, /记下下次跟进/);
assert.match(renderUnlabeledConnectedFollowup({ scope: "mine", items: [row] }, undefined, true), /data-same-day-skip-batch-pick="1"/);
assert.match(renderUnansweredPendingQueue({
  scope: "mine",
  items: [{ targetType: "lead", targetId: "l1", name: "线索", callRecordId: "ocr_2" }]
}, undefined, true), /value="lead:l1"/);
assert.equal(renderUnansweredPendingQueue({
  scope: "mine",
  items: [{ targetType: "lead", targetId: "l1", name: "线索", callRecordId: "ocr_2" }]
}).includes("data-same-day-skip-batch"), false);

const intent = renderIntentFollowupQueue({
  suggestedNextFollowAt: "2026-11-02 09:00",
  items: [{ targetType: "customer", targetId: "c1", name: "有意向 <A>", outcome: "有意向" }]
}, undefined, true);
assert.match(intent, /data-same-day-skip-batch="1"/);
assert.match(intent, /安排跟进/);
assert.match(intent, /有意向 &lt;A&gt;/);
assert.equal(renderIntentFollowupQueue({
  items: [{ targetType: "customer", targetId: "c-skip", name: "已忽略", outcome: "有意向", ignored: true }]
}, undefined, true).includes("data-same-day-skip-batch-pick"), false);

const today = renderTodayFollowNext({
  next: { targetType: "customer", targetId: "c1", name: "今天 <B>", nextFollowAt: "2026-11-04 09:00", maskedNumber: "****8000", preferred: true }
}, undefined, true);
assert.match(today, /data-same-day-skip-batch="1"/);
assert.match(today, /今天 &lt;B&gt;/);
assert.match(today, /不会自动拨号/);
assert.equal(today.includes("MakeCall"), false);
assert.equal(renderTodayFollowNext({
  next: { targetType: "customer", targetId: "c1", name: "今天", nextFollowAt: "2026-11-04 09:00" }
}).includes("data-same-day-skip-batch"), false);

console.log("same-day skip batch frontend tests passed");
