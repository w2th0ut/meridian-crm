import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { missingNextFollowupBatchBody, missingNextFollowupBatchForm, missingNextFollowupPick } from "./missing-next-followup-batch.js";
import { renderNegativeOutcomeFollowup } from "./negative-outcome-followup.js";
import { renderOtherOutcomeFollowup } from "./other-outcome-followup.js";

const form = missingNextFollowupBatchForm();
assert.match(form, /data-missing-next-followup-batch="1"/);
assert.match(form, /批量设置下次跟进/);
assert.match(form, /data-missing-next-follow-at/);
assert.match(form, /data-missing-next-follow-note/);
assert.match(form, /不会拨出/);
assert.equal(form.includes("外呼"), false);
assert.equal(form.includes("MakeCall"), false);

const pick = missingNextFollowupPick("customer", "c<1>");
assert.match(pick, /data-missing-next-followup-pick="1"/);
assert.match(pick, /value="customer:c&lt;1&gt;"/);

const body = missingNextFollowupBatchBody({
  targets: [{ targetType: "lead", targetId: "l1" }],
  nextFollowAt: "2026-11-06 09:00",
  note: "  备注  "
});
assert.equal(body.note, "备注");
assert.equal("note" in missingNextFollowupBatchBody({
  targets: [{ targetType: "lead", targetId: "l1" }],
  nextFollowAt: "2026-11-06 09:00",
  note: "   "
}), false);

const html = renderOtherOutcomeFollowup({
  scope: "mine",
  items: [{
    targetType: "customer",
    targetId: "c1",
    name: "Nordic <Tools>",
    callRecordId: "ocr_1",
    outcome: "其他"
  }]
});
assert.match(html, /data-missing-next-followup-batch="1"/);
assert.match(html, /data-missing-next-followup-pick="1"/);
assert.match(html, /记下下次跟进/);
assert.match(html, /Nordic &lt;Tools&gt;/);
assert.equal(html.includes("MakeCall"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(html), false);

const negative = renderNegativeOutcomeFollowup({
  scope: "mine",
  items: [{
    targetType: "customer",
    targetId: "c1",
    name: "仍有跟进",
    callRecordId: "ocr_2",
    outcome: "无意向",
    nextFollowAt: "2026-11-01 09:00"
  }]
});
assert.equal(negative.includes("data-missing-next-followup-batch"), false);
assert.equal(negative.includes("批量设置下次跟进"), false);
assert.match(negative, /清除下次跟进/);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const other = page.slice(page.indexOf('id="dashboardOtherOutcomeFollowup"'), page.indexOf('id="dashboardUnlabeledConnectedFollowup"'));
assert.match(other, /勾选多条可以一次设置同一个下次跟进时间和备注/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(other), false);
const negativePage = page.slice(page.indexOf('id="dashboardNegativeOutcomeFollowup"'), page.indexOf('id="dashboardOtherOutcomeFollowup"'));
assert.equal(negativePage.includes("批量设置下次跟进"), false);

console.log("missing next follow-up batch frontend tests passed");
