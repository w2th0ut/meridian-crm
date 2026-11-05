import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  endFollowBatchBody,
  endFollowBatchForm,
  endFollowBatchPick,
  renderEndFollowPreview
} from "./end-follow-batch.js";
import { renderIntentFollowupQueue } from "./intent-followup-queue.js";
import { renderNegativeOutcomeFollowup } from "./negative-outcome-followup.js";
import { renderOtherOutcomeFollowup } from "./other-outcome-followup.js";
import { renderTodayFollowNext } from "./today-follow-advance.js";
import { renderUnansweredPendingQueue } from "./unanswered-pending-queue.js";
import { renderUnlabeledConnectedFollowup } from "./unlabeled-connected-followup.js";

const view = { customer: true, lead: true, prospect: true };
const form = endFollowBatchForm(view);
assert.match(form, /data-end-follow-batch="1"/);
assert.match(form, /预览结束跟进/);
assert.match(form, /确认结束跟进/);
assert.match(form, /disabled/);
assert.match(form, /原因可以不填/);
assert.match(form, /不会拨出/);
assert.equal(form.includes("外呼"), false);
assert.equal(form.includes("MakeCall"), false);
assert.equal(endFollowBatchForm({ customer: false, lead: false, prospect: false }), "");
assert.equal(endFollowBatchForm(undefined), "");

const pick = endFollowBatchPick("customer", "c<1>", view);
assert.match(pick, /data-end-follow-batch-pick="1"/);
assert.match(pick, /value="customer:c&lt;1&gt;"/);
assert.equal(endFollowBatchPick("customer", "c1", { customer: false, lead: true, prospect: true }), "");
assert.equal(endFollowBatchPick("prospect", "p1", { customer: true, lead: true, prospect: false }), "");
assert.equal(endFollowBatchPick("other", "c1", view), "");

assert.deepEqual(endFollowBatchBody({
  targets: [{ targetType: "lead", targetId: "l1" }],
  reason: "  结束  "
}), {
  targets: [{ targetType: "lead", targetId: "l1" }],
  reason: "结束"
});
assert.deepEqual(endFollowBatchBody({
  targets: [{ targetType: "lead", targetId: "l1" }]
}), {
  targets: [{ targetType: "lead", targetId: "l1" }]
});

const preview = renderEndFollowPreview([
  { targetType: "customer", targetId: "c1", name: "Nordic <Tools>", status: "ready", nextFollowAt: "2026-11-10 09:00", reason: "不再跟 <进>" },
  { targetType: "customer", targetId: "c2", name: "Only <Buyer>", status: "already_clear", nextFollowAt: "" }
]);
assert.match(preview, /data-end-follow-batch-ready="1"/);
assert.match(preview, /Nordic &lt;Tools&gt;/);
assert.match(preview, /下次跟进 2026-11-10 09:00 将清空/);
assert.match(preview, /data-end-follow-batch-reason="1"/);
assert.match(preview, /不再跟 &lt;进&gt;/);
assert.match(preview, /data-end-follow-batch-skip="1"/);
assert.match(preview, /Only &lt;Buyer&gt; 没有下次跟进，不清空/);
assert.equal(preview.includes("+46"), false);

const row = {
  targetType: "customer",
  targetId: "c1",
  name: "Nordic <Tools>",
  callRecordId: "ocr_1",
  outcome: "无意向",
  nextFollowAt: "2026-11-10 09:00"
};
const negative = renderNegativeOutcomeFollowup({ scope: "mine", items: [row] }, undefined, false, view, view);
assert.match(negative, /data-end-follow-batch="1"/);
assert.match(negative, /data-end-follow-batch-pick="1"/);
assert.match(negative, /清除下次跟进/);
assert.match(negative, /Nordic &lt;Tools&gt;/);
assert.equal(negative.includes("MakeCall"), false);
assert.equal(renderNegativeOutcomeFollowup({ scope: "mine", items: [row] }).includes("data-end-follow-batch"), false);

assert.equal(renderOtherOutcomeFollowup({ scope: "mine", items: [{ ...row, outcome: "其他" }] }, undefined, false, view).includes("data-end-follow-batch"), false);
assert.equal(renderUnlabeledConnectedFollowup({ scope: "mine", items: [row] }, undefined, false, view).includes("data-end-follow-batch"), false);
assert.equal(renderUnansweredPendingQueue({
  scope: "mine",
  items: [{ targetType: "lead", targetId: "l1", name: "线索", callRecordId: "ocr_2" }]
}, undefined, false, view).includes("data-end-follow-batch"), false);
assert.equal(renderIntentFollowupQueue({
  suggestedNextFollowAt: "2026-11-02 09:00",
  items: [{ targetType: "customer", targetId: "c1", name: "有意向 <A>", outcome: "有意向" }]
}, undefined, false, view).includes("data-end-follow-batch"), false);

const today = renderTodayFollowNext({
  next: { targetType: "prospect", targetId: "p1", name: "今天 <B>", nextFollowAt: "2026-11-04 09:00", maskedNumber: "****8000", preferred: true }
}, undefined, false, view, view);
assert.match(today, /data-end-follow-batch="1"/);
assert.match(today, /今天 &lt;B&gt;/);
assert.match(today, /不会自动拨号/);
assert.equal(today.includes("MakeCall"), false);
assert.equal(renderTodayFollowNext({
  next: { targetType: "customer", targetId: "c1", name: "今天", nextFollowAt: "2026-11-04 09:00" }
}).includes("data-end-follow-batch"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/next-follow-ups\/batch-clear\/preview/);
assert.match(api, /\/api\/next-follow-ups\/batch-clear"/);
assert.match(api, /endFollowBatchBody/);
assert.match(api, /bindEndFollowBatch/);
assert.match(api, /renderEndFollowPreview/);
const loadStart = api.indexOf("async function loadNegativeOutcomeFollowups");
const loadEnd = api.indexOf("async function clearNegativeOutcomeFollowup", loadStart);
assert.equal(loadStart > 0 && loadEnd > loadStart, true);
assert.equal(api.slice(loadStart, loadEnd).includes("/api/next-follow-ups/batch-clear"), false);
const todayStart = api.indexOf("async function openNextTodayFollow");
const todayEnd = api.indexOf("let intentFollowupPending", todayStart);
assert.equal(todayStart > 0 && todayEnd > todayStart, true);
assert.equal(api.slice(todayStart, todayEnd).includes("/api/next-follow-ups/batch-clear"), false);
const refreshStart = api.indexOf("async function refreshDashboardOnly");
const refreshEnd = api.indexOf("function requestDashboardRefresh", refreshStart);
assert.equal(refreshStart > 0 && refreshEnd > refreshStart, true);
assert.equal(api.slice(refreshStart, refreshEnd).includes("/api/next-follow-ups/batch-clear"), false);

console.log("end follow batch frontend tests passed");
