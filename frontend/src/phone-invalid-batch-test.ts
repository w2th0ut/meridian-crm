import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderIntentFollowupQueue } from "./intent-followup-queue.js";
import { renderNegativeOutcomeFollowup } from "./negative-outcome-followup.js";
import { renderOtherOutcomeFollowup } from "./other-outcome-followup.js";
import { phoneInvalidBatchBody, phoneInvalidBatchForm, phoneInvalidBatchPick } from "./phone-invalid-batch.js";
import { renderTodayFollowNext } from "./today-follow-advance.js";
import { renderUnansweredPendingQueue } from "./unanswered-pending-queue.js";
import { renderUnlabeledConnectedFollowup } from "./unlabeled-connected-followup.js";

const view = { customer: true, lead: true, prospect: true };
const form = phoneInvalidBatchForm(view);
assert.match(form, /data-phone-invalid-batch="1"/);
assert.match(form, /标号码无效/);
assert.match(form, /空号/);
assert.match(form, /停机/);
assert.match(form, /号码错误/);
assert.match(form, /value="bad_number"/);
assert.match(form, /value="out_of_service"/);
assert.match(form, /value="wrong_number"/);
assert.match(form, /不会拨出/);
assert.equal(form.includes("外呼"), false);
assert.equal(form.includes("MakeCall"), false);
assert.equal(phoneInvalidBatchForm({ customer: false, lead: false, prospect: false }), "");
assert.equal(phoneInvalidBatchForm(undefined), "");

const pick = phoneInvalidBatchPick("customer", "c<1>", view);
assert.match(pick, /data-phone-invalid-batch-pick="1"/);
assert.match(pick, /value="customer:c&lt;1&gt;"/);
assert.equal(phoneInvalidBatchPick("customer", "c1", { customer: false, lead: true, prospect: true }), "");
assert.equal(phoneInvalidBatchPick("prospect", "p1", { customer: true, lead: true, prospect: false }), "");
assert.equal(phoneInvalidBatchPick("other", "c1", view), "");

assert.deepEqual(phoneInvalidBatchBody({
  targets: [{ targetType: "lead", targetId: "l1" }],
  reason: " bad_number "
}), {
  targets: [{ targetType: "lead", targetId: "l1" }],
  reason: "bad_number"
});

const row = {
  targetType: "customer",
  targetId: "c1",
  name: "Nordic <Tools>",
  callRecordId: "ocr_1",
  outcome: "无意向",
  nextFollowAt: "2026-11-10 09:00"
};
const negative = renderNegativeOutcomeFollowup({ scope: "mine", items: [row] }, undefined, false, view);
assert.match(negative, /data-phone-invalid-batch="1"/);
assert.match(negative, /data-phone-invalid-batch-pick="1"/);
assert.match(negative, /清除下次跟进/);
assert.match(negative, /Nordic &lt;Tools&gt;/);
assert.equal(negative.includes("外呼"), false);
assert.equal(renderNegativeOutcomeFollowup({ scope: "mine", items: [row] }).includes("data-phone-invalid-batch"), false);

const other = renderOtherOutcomeFollowup({ scope: "mine", items: [{ ...row, outcome: "其他" }] }, undefined, false, view);
assert.match(other, /data-missing-next-followup-batch="1"/);
assert.match(other, /data-phone-invalid-batch="1"/);
assert.match(other, /记下下次跟进/);
assert.match(renderUnlabeledConnectedFollowup({ scope: "mine", items: [row] }, undefined, false, view), /data-phone-invalid-batch-pick="1"/);
assert.match(renderUnansweredPendingQueue({
  scope: "mine",
  items: [{ targetType: "lead", targetId: "l1", name: "线索", callRecordId: "ocr_2" }]
}, undefined, false, view), /value="lead:l1"/);
assert.equal(renderUnansweredPendingQueue({
  scope: "mine",
  items: [{ targetType: "lead", targetId: "l1", name: "线索", callRecordId: "ocr_2" }]
}).includes("data-phone-invalid-batch"), false);

const intent = renderIntentFollowupQueue({
  suggestedNextFollowAt: "2026-11-02 09:00",
  items: [{ targetType: "customer", targetId: "c1", name: "有意向 <A>", outcome: "有意向" }]
}, undefined, false, view);
assert.match(intent, /data-phone-invalid-batch="1"/);
assert.match(intent, /安排跟进/);
assert.match(intent, /有意向 &lt;A&gt;/);
assert.equal(renderIntentFollowupQueue({
  items: [{ targetType: "customer", targetId: "c-skip", name: "已忽略", outcome: "有意向", ignored: true }]
}, undefined, false, view).includes("data-phone-invalid-batch-pick"), false);

const today = renderTodayFollowNext({
  next: { targetType: "prospect", targetId: "p1", name: "今天 <B>", nextFollowAt: "2026-11-04 09:00", maskedNumber: "****8000", preferred: true }
}, undefined, false, view);
assert.match(today, /data-phone-invalid-batch="1"/);
assert.match(today, /今天 &lt;B&gt;/);
assert.match(today, /不会自动拨号/);
assert.equal(today.includes("MakeCall"), false);
assert.equal(renderTodayFollowNext({
  next: { targetType: "customer", targetId: "c1", name: "今天", nextFollowAt: "2026-11-04 09:00" }
}).includes("data-phone-invalid-batch"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/phone-validity\/batch/);
assert.match(api, /phoneInvalidBatchBody/);
assert.match(api, /bindPhoneInvalidBatch/);

console.log("phone invalid batch frontend tests passed");
