import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderIntentFollowupQueue } from "./intent-followup-queue.js";
import { renderNegativeOutcomeFollowup } from "./negative-outcome-followup.js";
import { renderOtherOutcomeFollowup } from "./other-outcome-followup.js";
import { queueOwnerReassignBody, queueOwnerReassignForm, queueOwnerReassignPick } from "./queue-owner-reassign.js";
import { renderTodayFollowNext } from "./today-follow-advance.js";
import { renderUnansweredPendingQueue } from "./unanswered-pending-queue.js";
import { renderUnlabeledConnectedFollowup } from "./unlabeled-connected-followup.js";

const view = {
  assignees: [{ id: "u<1>", name: "Mia <主管>" }],
  customer: true,
  lead: true
};
const customerOnly = { assignees: [{ id: "u_mia", name: "Mia" }], customer: true, lead: false };
const none = { assignees: [], customer: false, lead: false };

const form = queueOwnerReassignForm(view);
assert.match(form, /data-queue-owner-reassign="1"/);
assert.match(form, /批量转交负责人/);
assert.match(form, /data-queue-owner-reassign-to="1"/);
assert.match(form, /不会拨出/);
assert.match(form, /Mia &lt;主管&gt;/);
assert.match(form, /value="u&lt;1&gt;"/);
assert.equal(form.includes("外呼"), false);
assert.equal(form.includes("MakeCall"), false);
assert.equal(queueOwnerReassignForm(none), "");

const pick = queueOwnerReassignPick("customer", "c<1>", view);
assert.match(pick, /data-queue-owner-reassign-pick="1"/);
assert.match(pick, /value="customer:c&lt;1&gt;"/);
assert.equal(queueOwnerReassignPick("lead", "l1", customerOnly), "");
assert.equal(queueOwnerReassignPick("prospect", "p1", customerOnly), "");
assert.match(queueOwnerReassignPick("prospect", "p1", view), /value="prospect:p1"/);
assert.equal(queueOwnerReassignPick("customer", "c1", none), "");

const body = queueOwnerReassignBody({
  targets: [{ targetType: "lead", targetId: "l1" }],
  transferTo: "  u_mia  "
});
assert.equal(body.transferTo, "u_mia");
assert.deepEqual(body.targets, [{ targetType: "lead", targetId: "l1" }]);

const row = {
  targetType: "customer",
  targetId: "c1",
  name: "Nordic <Tools>",
  callRecordId: "ocr_1",
  outcome: "无意向",
  nextFollowAt: "2026-11-10 09:00"
};
const negative = renderNegativeOutcomeFollowup({ scope: "mine", items: [row] }, view);
assert.match(negative, /data-queue-owner-reassign="1"/);
assert.match(negative, /data-queue-owner-reassign-pick="1"/);
assert.match(negative, /清除下次跟进/);
assert.match(negative, /Nordic &lt;Tools&gt;/);
assert.equal(negative.includes("批量设置下次跟进"), false);
assert.equal(renderNegativeOutcomeFollowup({ scope: "mine", items: [row] }).includes("data-queue-owner-reassign"), false);

const other = renderOtherOutcomeFollowup({ scope: "mine", items: [{ ...row, outcome: "其他" }] }, view);
assert.match(other, /data-missing-next-followup-batch="1"/);
assert.match(other, /data-queue-owner-reassign="1"/);
assert.match(renderUnlabeledConnectedFollowup({ scope: "mine", items: [row] }, view), /data-queue-owner-reassign-pick="1"/);
assert.match(renderUnansweredPendingQueue({
  scope: "mine",
  items: [{ targetType: "lead", targetId: "l1", name: "线索", callRecordId: "ocr_2" }]
}, view), /value="lead:l1"/);
assert.match(renderIntentFollowupQueue({
  suggestedNextFollowAt: "2026-11-02 09:00",
  items: [{ targetType: "customer", targetId: "c1", name: "有意向", outcome: "有意向" }]
}, view), /data-queue-owner-reassign="1"/);
assert.equal(renderIntentFollowupQueue({
  items: [{ targetType: "customer", targetId: "c-skip", name: "已忽略", outcome: "有意向", ignored: true }]
}, view).includes("data-queue-owner-reassign-pick"), false);

const today = renderTodayFollowNext({
  next: { targetType: "customer", targetId: "c1", name: "今天", nextFollowAt: "2026-11-04 09:00", maskedNumber: "****8000", preferred: true }
}, view);
assert.match(today, /data-queue-owner-reassign="1"/);
assert.match(today, /data-today-follow-next-open="1"/);
assert.match(today, /不会自动拨号/);
assert.equal(renderTodayFollowNext({
  next: { targetType: "lead", targetId: "l1", name: "线索", nextFollowAt: "2026-11-04 09:00" }
}, customerOnly).includes("data-queue-owner-reassign"), false);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const negativePage = page.slice(page.indexOf('id="dashboardNegativeOutcomeFollowup"'), page.indexOf('id="dashboardOtherOutcomeFollowup"'));
assert.match(negativePage, /一次把负责人转给同一位同租户同事/);
assert.equal(negativePage.includes("批量设置下次跟进"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(negativePage), false);
const todayPage = page.slice(page.indexOf('id="dashboardTodayFollowNext"'), page.indexOf('id="dashboardAgentWorkStatusReport"'));
assert.match(todayPage, /一次把负责人转给同一位同租户同事|把负责人转给同一位同租户同事/);
assert.equal(todayPage.includes(">外呼<"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/queue-owner-reassign/);
assert.match(api, /bindQueueOwnerReassign/);
assert.equal(api.includes("MakeCall"), false);

console.log("queue owner reassign frontend tests passed");
