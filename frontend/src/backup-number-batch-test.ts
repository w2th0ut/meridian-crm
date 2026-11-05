import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  backupNumberBatchBody,
  backupNumberBatchForm,
  backupNumberBatchPick,
  renderBackupNumberPreview
} from "./backup-number-batch.js";
import { renderIntentFollowupQueue } from "./intent-followup-queue.js";
import { renderNegativeOutcomeFollowup } from "./negative-outcome-followup.js";
import { renderOtherOutcomeFollowup } from "./other-outcome-followup.js";
import { renderTodayFollowNext } from "./today-follow-advance.js";
import { renderUnansweredPendingQueue } from "./unanswered-pending-queue.js";
import { renderUnlabeledConnectedFollowup } from "./unlabeled-connected-followup.js";

const view = { customer: true, lead: true, prospect: true };
const form = backupNumberBatchForm(view);
assert.match(form, /data-backup-number-batch="1"/);
assert.match(form, /预览备用号/);
assert.match(form, /确认切换/);
assert.match(form, /disabled/);
assert.match(form, /没有备用号的会列出来，并且不切换/);
assert.match(form, /不会拨出/);
assert.equal(form.includes("外呼"), false);
assert.equal(form.includes("MakeCall"), false);
assert.equal(backupNumberBatchForm({ customer: false, lead: false, prospect: false }), "");
assert.equal(backupNumberBatchForm(undefined), "");

const pick = backupNumberBatchPick("customer", "c<1>", view);
assert.match(pick, /data-backup-number-batch-pick="1"/);
assert.match(pick, /value="customer:c&lt;1&gt;"/);
assert.equal(backupNumberBatchPick("customer", "c1", { customer: false, lead: true, prospect: true }), "");
assert.equal(backupNumberBatchPick("prospect", "p1", { customer: true, lead: true, prospect: false }), "");
assert.equal(backupNumberBatchPick("other", "c1", view), "");

assert.deepEqual(backupNumberBatchBody({
  targets: [{ targetType: "lead", targetId: "l1" }]
}), {
  targets: [{ targetType: "lead", targetId: "l1" }]
});

const preview = renderBackupNumberPreview([
  { targetType: "customer", targetId: "c1", name: "Nordic <Tools>", status: "ready", maskedCurrent: "****0021", maskedNext: "****0022" },
  { targetType: "customer", targetId: "c2", name: "Only <Buyer>", status: "no_backup", maskedCurrent: "****0023", maskedNext: "" }
]);
assert.match(preview, /data-backup-number-batch-ready="1"/);
assert.match(preview, /Nordic &lt;Tools&gt;/);
assert.match(preview, /\*\*\*\*0021 → \*\*\*\*0022/);
assert.match(preview, /data-backup-number-batch-skip="1"/);
assert.match(preview, /Only &lt;Buyer&gt; 没有备用号，不切换/);
assert.equal(preview.includes("+46"), false);

const row = {
  targetType: "customer",
  targetId: "c1",
  name: "Nordic <Tools>",
  callRecordId: "ocr_1",
  outcome: "无意向",
  nextFollowAt: "2026-11-10 09:00"
};
const negative = renderNegativeOutcomeFollowup({ scope: "mine", items: [row] }, undefined, false, view);
assert.match(negative, /data-backup-number-batch="1"/);
assert.match(negative, /data-backup-number-batch-pick="1"/);
assert.match(negative, /清除下次跟进/);
assert.match(negative, /Nordic &lt;Tools&gt;/);
assert.equal(negative.includes("外呼"), false);
assert.equal(renderNegativeOutcomeFollowup({ scope: "mine", items: [row] }).includes("data-backup-number-batch"), false);

const other = renderOtherOutcomeFollowup({ scope: "mine", items: [{ ...row, outcome: "其他" }] }, undefined, false, view);
assert.match(other, /data-backup-number-batch="1"/);
assert.match(other, /记下下次跟进/);
assert.match(renderUnlabeledConnectedFollowup({ scope: "mine", items: [row] }, undefined, false, view), /data-backup-number-batch-pick="1"/);
assert.match(renderUnansweredPendingQueue({
  scope: "mine",
  items: [{ targetType: "lead", targetId: "l1", name: "线索", callRecordId: "ocr_2" }]
}, undefined, false, view), /value="lead:l1"/);
assert.equal(renderUnansweredPendingQueue({
  scope: "mine",
  items: [{ targetType: "lead", targetId: "l1", name: "线索", callRecordId: "ocr_2" }]
}).includes("data-backup-number-batch"), false);

const intent = renderIntentFollowupQueue({
  suggestedNextFollowAt: "2026-11-02 09:00",
  items: [{ targetType: "customer", targetId: "c1", name: "有意向 <A>", outcome: "有意向" }]
}, undefined, false, view);
assert.match(intent, /data-backup-number-batch="1"/);
assert.match(intent, /安排跟进/);
assert.equal(renderIntentFollowupQueue({
  items: [{ targetType: "customer", targetId: "c-skip", name: "已忽略", outcome: "有意向", ignored: true }]
}, undefined, false, view).includes("data-backup-number-batch-pick"), false);

const today = renderTodayFollowNext({
  next: { targetType: "prospect", targetId: "p1", name: "今天 <B>", nextFollowAt: "2026-11-04 09:00", maskedNumber: "****8000", preferred: true }
}, undefined, false, view);
assert.match(today, /data-backup-number-batch="1"/);
assert.match(today, /今天 &lt;B&gt;/);
assert.match(today, /不会自动拨号/);
assert.equal(today.includes("MakeCall"), false);
assert.equal(renderTodayFollowNext({
  next: { targetType: "customer", targetId: "c1", name: "今天", nextFollowAt: "2026-11-04 09:00" }
}).includes("data-backup-number-batch"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/preferred-phones\/batch-backup\/preview/);
assert.match(api, /\/api\/preferred-phones\/batch-backup"/);
assert.match(api, /backupNumberBatchBody/);
assert.match(api, /bindBackupNumberBatch/);
assert.match(api, /renderBackupNumberPreview/);

console.log("backup number batch frontend tests passed");
