import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  callNoteAppendBody,
  callNoteAppendForm,
  callNoteAppendPick,
  renderCallNoteAppendPreview
} from "./call-note-append-batch.js";
import { renderIntentFollowupQueue } from "./intent-followup-queue.js";
import { renderNegativeOutcomeFollowup } from "./negative-outcome-followup.js";
import { renderOtherOutcomeFollowup } from "./other-outcome-followup.js";
import { renderTodayFollowNext } from "./today-follow-advance.js";
import { renderUnansweredPendingQueue } from "./unanswered-pending-queue.js";
import { renderUnlabeledConnectedFollowup } from "./unlabeled-connected-followup.js";

const view = { customer: true, lead: true, prospect: true };
const form = callNoteAppendForm(view);
assert.match(form, /data-call-note-append="1"/);
assert.match(form, /预览补备注/);
assert.match(form, /确认补备注/);
assert.match(form, /disabled/);
assert.match(form, /不覆盖原来的备注/);
assert.match(form, /不会拨出/);
assert.match(form, /data-outcome-note-phrases="1"/);
assert.match(form, /常用短语/);
assert.equal(form.includes("外呼"), false);
assert.equal(form.includes("MakeCall"), false);
assert.equal(callNoteAppendForm({ customer: false, lead: false, prospect: false }), "");
assert.equal(callNoteAppendForm(undefined), "");

const pick = callNoteAppendPick("customer", "ocr<1>", view);
assert.match(pick, /data-call-note-append-pick="1"/);
assert.match(pick, /value="ocr&lt;1&gt;"/);
assert.equal(callNoteAppendPick("customer", "ocr_1", { customer: false, lead: true, prospect: true }), "");
assert.equal(callNoteAppendPick("prospect", "ocr_1", { customer: true, lead: true, prospect: false }), "");
assert.equal(callNoteAppendPick("other", "ocr_1", view), "");
assert.equal(callNoteAppendPick("customer", "", view), "");

assert.deepEqual(callNoteAppendBody({ callRecordIds: ["ocr_1"], note: "  补一句  " }), {
  callRecordIds: ["ocr_1"],
  note: "补一句"
});
assert.deepEqual(callNoteAppendBody({ callRecordIds: ["ocr_1"], phraseId: " csp_1 " }), {
  callRecordIds: ["ocr_1"],
  phraseId: "csp_1"
});

const preview = renderCallNoteAppendPreview([
  { callRecordId: "ocr_1", name: "Nordic <Tools>", outcome: "无意向", previousNote: "原备注", nextNote: "原备注 补一句", status: "ready" },
  { callRecordId: "ocr_2", name: "放不下 <B>", outcome: "未接通", previousNote: "很长", status: "too_long" }
]);
assert.match(preview, /data-call-note-append-ready="1"/);
assert.match(preview, /Nordic &lt;Tools&gt;/);
assert.match(preview, /原备注 补一句/);
assert.match(preview, /data-call-note-append-skip="1"/);
assert.match(preview, /放不下 &lt;B&gt;/);
assert.match(preview, /不追加/);
assert.equal(preview.includes("+46"), false);
assert.equal(preview.includes("外呼"), false);

const row = {
  targetType: "customer",
  targetId: "c1",
  name: "Nordic <Tools>",
  callRecordId: "ocr_1",
  outcome: "无意向",
  nextFollowAt: "2026-11-10 09:00"
};
const negative = renderNegativeOutcomeFollowup({ scope: "mine", items: [row] }, undefined, false, view, view);
assert.match(negative, /data-call-note-append="1"/);
assert.match(negative, /data-call-note-append-pick="1"/);
assert.match(negative, /清除下次跟进/);
assert.equal(renderNegativeOutcomeFollowup({ scope: "mine", items: [row] }).includes("data-call-note-append"), false);

const other = renderOtherOutcomeFollowup({ scope: "mine", items: [{ ...row, outcome: "其他" }] }, undefined, false, view);
assert.match(other, /data-call-note-append="1"/);
assert.equal(renderOtherOutcomeFollowup({ scope: "mine", items: [{ ...row, outcome: "其他" }] }).includes("data-call-note-append"), false);

const unanswered = renderUnansweredPendingQueue({
  scope: "mine",
  items: [{ targetType: "lead", targetId: "l1", name: "线索 <A>", callRecordId: "ocr_2" }]
}, undefined, false, view);
assert.match(unanswered, /data-call-note-append="1"/);
assert.match(unanswered, /线索 &lt;A&gt;/);
assert.equal(renderUnansweredPendingQueue({
  scope: "mine",
  items: [{ targetType: "lead", targetId: "l1", name: "线索", callRecordId: "ocr_2" }]
}).includes("data-call-note-append"), false);

const intent = renderIntentFollowupQueue({
  suggestedNextFollowAt: "2026-11-02 09:00",
  items: [{ targetType: "customer", targetId: "c1", name: "有意向 <A>", callRecordId: "ocr_3", outcome: "有意向" }]
}, undefined, false, view);
assert.match(intent, /data-call-note-append="1"/);
assert.match(intent, /有意向 &lt;A&gt;/);
assert.equal(renderIntentFollowupQueue({
  suggestedNextFollowAt: "2026-11-02 09:00",
  items: [{ targetType: "customer", targetId: "c1", name: "有意向", outcome: "有意向" }]
}, undefined, false, view).includes("data-call-note-append"), false);

assert.equal(renderUnlabeledConnectedFollowup({ scope: "mine", items: [row] }, undefined, false, view).includes("data-call-note-append"), false);
assert.equal(renderTodayFollowNext({
  next: { targetType: "prospect", targetId: "p1", name: "今天", nextFollowAt: "2026-11-04 09:00", maskedNumber: "****8000", preferred: true }
}, undefined, false, view, view).includes("data-call-note-append"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/call-outcome-notes\/batch-append\/preview/);
assert.match(api, /\/api\/call-outcome-notes\/batch-append"/);
assert.match(api, /callNoteAppendBody/);
assert.match(api, /bindCallNoteAppend/);
assert.match(api, /renderCallNoteAppendPreview/);
assert.match(api, /data-call-note-append-note/);
assert.match(api, /#dashboardNegativeOutcomeFollowup/);
assert.match(api, /#dashboardOtherOutcomeFollowup/);
assert.match(api, /#dashboardUnansweredPendingQueue/);
assert.match(api, /#intentFollowupQueue/);
const todayBind = api.indexOf("bindEndFollowBatch(qs<HTMLElement>(\"#dashboardTodayFollowNext\")");
const unlabeledBind = api.indexOf("bindPhoneInvalidBatch(qs<HTMLElement>(\"#dashboardUnlabeledConnectedFollowup\")");
assert.equal(todayBind > 0 && unlabeledBind > 0, true);
const bindSlice = api.slice(api.indexOf("function bindCallNoteAppend"), api.indexOf("function bindEndFollowBatch"));
assert.equal(bindSlice.includes("#dashboardTodayFollowNext"), false);
assert.equal(bindSlice.includes("#dashboardUnlabeledConnectedFollowup"), false);
const loadStart = api.indexOf("async function loadNegativeOutcomeFollowups");
const loadEnd = api.indexOf("async function clearNegativeOutcomeFollowup", loadStart);
assert.equal(api.slice(loadStart, loadEnd).includes("/api/call-outcome-notes/batch-append"), false);

console.log("call note append batch frontend tests passed");
