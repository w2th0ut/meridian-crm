import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderIntentFollowupRows } from "./intent-followup-queue.js";
import { renderNegativeOutcomeFollowup } from "./negative-outcome-followup.js";
import { renderOtherOutcomeFollowup } from "./other-outcome-followup.js";
import {
  isQueueCallOutcomeChoice,
  queueCallOutcomeBody,
  queueCallOutcomeSelection,
  renderQueueCallOutcomeForm
} from "./queue-call-outcome.js";
import { renderTodayFollowNext } from "./today-follow-advance.js";
import { renderUnansweredPendingQueue } from "./unanswered-pending-queue.js";
import { renderUnlabeledConnectedFollowup } from "./unlabeled-connected-followup.js";

assert.equal(queueCallOutcomeSelection(" 需回访 "), "需回访");
assert.equal(queueCallOutcomeSelection("Success"), "未标注");
assert.equal(queueCallOutcomeSelection(""), "未标注");
assert.deepEqual(queueCallOutcomeBody("未标注"), { outcome: "未标注", preserveNote: true });
assert.equal(isQueueCallOutcomeChoice("号码错误"), true);
assert.equal(isQueueCallOutcomeChoice("未标注"), true);
assert.equal(isQueueCallOutcomeChoice("Success"), false);
assert.equal(isQueueCallOutcomeChoice(""), false);

const form = renderQueueCallOutcomeForm({
  callRecordId: "ocr_1",
  targetType: "customer",
  targetId: "c1",
  outcome: "有意向"
});
assert.match(form, /data-queue-call-outcome="1"/);
assert.match(form, /data-call-record-id="ocr_1"/);
assert.match(form, /data-target-type="customer"/);
assert.match(form, /data-target-id="c1"/);
assert.match(form, /本次通话结果/);
assert.match(form, /<option value="未标注">未标注<\/option>/);
for (const label of ["有意向", "需回访", "无意向", "号码错误", "其他"]) {
  assert.match(form, new RegExp(`<option value="${label}"`));
}
assert.match(form, /value="有意向" selected/);
assert.match(form, />登记结果</);
assert.equal(form.includes("拨号"), false);
assert.equal(form.includes("外呼"), false);
assert.equal(form.includes("MakeCall"), false);
assert.equal(form.includes("data-call-outcome-form"), false);
assert.equal(renderQueueCallOutcomeForm({ targetType: "customer", targetId: "c1", outcome: "有意向" }), "");
assert.equal(renderQueueCallOutcomeForm({ callRecordId: "ocr_1", targetType: "customer", targetId: "c1", outcome: "Nordic <x>" }).includes("未标注\" selected") || renderQueueCallOutcomeForm({ callRecordId: "ocr_1", targetType: "customer", targetId: "c1", outcome: "Success" }).includes("value=\"未标注\" selected"), true);
assert.equal(renderQueueCallOutcomeForm({ callRecordId: "ocr_1", targetType: "customer", targetId: "c<script>", outcome: "有意向" }).includes("<script>"), false);

const intent = renderIntentFollowupRows([{
  targetType: "customer",
  targetId: "c1",
  name: "甲",
  callRecordId: "ocr_intent",
  outcome: "需回访"
}], "");
assert.match(intent, /data-queue-call-outcome="1"/);
assert.match(intent, /data-call-record-id="ocr_intent"/);
assert.match(intent, /value="需回访" selected/);
const intentHidden = renderIntentFollowupRows([{
  targetType: "customer",
  targetId: "c1",
  name: "甲",
  outcome: "有意向"
}], "");
assert.equal(intentHidden.includes("data-queue-call-outcome"), false);

const unanswered = renderUnansweredPendingQueue({
  scope: "mine",
  items: [{ targetType: "lead", targetId: "l1", name: "线索", callRecordId: "ocr_miss", outcome: "未标注" }]
});
assert.match(unanswered, /data-queue-call-outcome="1"/);
assert.match(unanswered, /value="未标注" selected/);
assert.equal(unanswered.includes("拨号"), false);

const negative = renderNegativeOutcomeFollowup({
  scope: "mine",
  items: [{ targetType: "customer", targetId: "c2", name: "乙", callRecordId: "ocr_neg", outcome: "无意向" }]
});
assert.match(negative, /data-queue-call-outcome="1"/);
assert.match(negative, /value="无意向" selected/);

const other = renderOtherOutcomeFollowup({
  scope: "mine",
  items: [{ targetType: "prospect", targetId: "p1", name: "丙", callRecordId: "ocr_other", outcome: "其他" }]
});
assert.match(other, /data-queue-call-outcome="1"/);
assert.match(other, /value="其他" selected/);

const unlabeled = renderUnlabeledConnectedFollowup({
  scope: "mine",
  items: [{ targetType: "customer", targetId: "c3", name: "丁", callRecordId: "ocr_open", outcome: "未标注" }]
});
assert.match(unlabeled, /data-queue-call-outcome="1"/);
assert.match(unlabeled, /value="未标注" selected/);

const today = renderTodayFollowNext({
  next: {
    targetType: "customer",
    targetId: "c9",
    name: "今日",
    callRecordId: "ocr_today",
    lastCallOutcome: "号码错误",
    maskedNumber: "****8000"
  }
});
assert.match(today, /data-queue-call-outcome="1"/);
assert.match(today, /data-call-record-id="ocr_today"/);
assert.match(today, /value="号码错误" selected/);
assert.equal(renderTodayFollowNext({
  next: { targetType: "customer", targetId: "c9", name: "今日", maskedNumber: "****8000" }
}).includes("data-queue-call-outcome"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const submitStart = api.indexOf("async function submitQueueCallOutcome");
const submitEnd = api.indexOf("\nfunction unansweredPendingAge", submitStart);
assert.ok(submitStart > 0 && submitEnd > submitStart);
const submit = api.slice(submitStart, submitEnd);
assert.match(submit, /queueCallOutcomeBody/);
assert.match(submit, /\/api\/outbound-call-records\/\$\{encodeURIComponent\(recordId\)\}\/outcome/);
assert.match(submit, /settleInlineQueueCallOutcome/);
assert.equal(submit.includes("openCallbackDueObject"), false);
assert.equal(submit.includes("openNextTodayFollow"), false);
assert.equal(submit.includes("MakeCall"), false);
assert.equal(submit.includes("aliyuncs"), false);
const settleStart = api.indexOf("async function settleInlineQueueCallOutcome");
const settleEnd = api.indexOf("\nlet queueCallOutcomePending", settleStart);
assert.ok(settleStart > 0 && settleEnd > settleStart);
const settle = api.slice(settleStart, settleEnd);
assert.match(settle, /armQueueUndialedFromOutcome/);
assert.match(settle, /openNextTodayFollow\("", "", todayFollowNextScope, false\)/);
assert.equal(settle.includes("openCallbackDueObject"), false);
assert.equal(settle.includes("MakeCall"), false);

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
  assert.match(page.slice(start, end), /登记这一通的通话结果/);
}
const intentStart = page.indexOf('id="intent-followup-queue"');
const intentEnd = page.indexOf('id="phone-strategies"', intentStart);
assert.match(page.slice(intentStart, intentEnd), /登记这一通的通话结果/);

const doc = readFileSync(new URL("../../docs/acquisition-outreach-acceptance.md", import.meta.url), "utf8");
assert.match(doc, /## 125\. 本地演示：名单行上登记本次通话结果/);

console.log("queue inline call outcome tests passed");
