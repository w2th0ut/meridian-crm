import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planCallOutcomeShortcut } from "./call-outcome-keys.js";
import { renderCallOutcomeTransfer, showCallOutcomeTransfer } from "./call-outcome-transfer.js";
import { renderCallOutcomeForm, renderOutboundCallRecordDetail, renderOutboundCallRecordList } from "./outbound-call-records.js";

const view = {
  assignees: [
    { id: "u_mia", name: "Mia<script>" },
    { id: "u_alex", name: "Alex" }
  ],
  customer: true,
  lead: true
};
const customerOnly = { assignees: view.assignees, customer: true, lead: false };
const record = { targetType: "customer", targetId: "c1" };

assert.equal(showCallOutcomeTransfer(record, undefined), false);
assert.equal(showCallOutcomeTransfer({ targetType: "customer", targetId: "" }, view), false);
assert.equal(showCallOutcomeTransfer({ targetType: "customer", targetId: "c1" }, { ...view, customer: false, lead: false }), false);
assert.equal(showCallOutcomeTransfer({ targetType: "lead", targetId: "l1" }, customerOnly), false);
assert.equal(showCallOutcomeTransfer({ targetType: "prospect", targetId: "p1" }, customerOnly), false);
assert.equal(showCallOutcomeTransfer({ targetType: "customer", targetId: "c1" }, customerOnly), true);
assert.equal(showCallOutcomeTransfer({ targetType: "prospect", targetId: "p1" }, view), true);

const html = renderCallOutcomeTransfer(record, view);
assert.match(html, /转交给/);
assert.match(html, /data-call-outcome-transfer="1"/);
assert.match(html, /不转交/);
assert.match(html, /value="u_mia"/);
assert.match(html, /Mia&lt;script&gt;/);
assert.match(html, /不会拨出/);
assert.equal(html.includes(">外呼<"), false);
assert.equal(html.includes("MakeCall"), false);
assert.equal(renderCallOutcomeTransfer(record, { ...view, customer: false }), "");

const plain = renderCallOutcomeForm({ id: "ocr_1", callOutcome: "有意向", targetType: "customer", targetId: "c1" });
assert.equal(plain.includes("data-call-outcome-transfer"), false);
assert.equal(plain.includes("不转交"), false);

const form = renderCallOutcomeForm({ id: "ocr_1", callOutcome: "有意向", targetType: "customer", targetId: "c1" }, view);
assert.match(form, /data-call-outcome-form="1"/);
assert.match(form, /转交给/);
assert.match(form, /保存标注/);
assert.equal(form.includes(">外呼<"), false);

const list = renderOutboundCallRecordList([{
  id: "ocr_1",
  targetType: "lead",
  targetId: "l1",
  maskedNumber: "0222",
  contactDisposition: "Success"
}], view);
assert.match(list, /data-call-outcome-transfer="1"/);
const detail = renderOutboundCallRecordDetail({
  record: { id: "ocr_1", targetType: "prospect", targetId: "p1", maskedNumber: "0222", contactDisposition: "Success" }
}, view);
assert.match(detail, /转交给/);

const hiddenLead = renderCallOutcomeForm({ id: "ocr_2", targetType: "lead", targetId: "l1" }, customerOnly);
assert.equal(hiddenLead.includes("data-call-outcome-transfer"), false);

assert.deepEqual(planCallOutcomeShortcut({
  key: "1",
  insideForm: true,
  typing: true,
  activateOnEnter: true
}), { action: "none" });

const batch = readFileSync(new URL("./call-outcome-batch.ts", import.meta.url), "utf8");
assert.equal(batch.includes("data-call-outcome-transfer"), false);
assert.equal(batch.includes("转交给"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const submitStart = api.indexOf("async function submitCallOutcome");
const submitEnd = api.indexOf("let todayFollowNextPending", submitStart);
assert.ok(submitStart > 0 && submitEnd > submitStart);
const submit = api.slice(submitStart, submitEnd);
assert.match(submit, /data-call-outcome-transfer/);
assert.match(submit, /if \(transferTo\) body\.transferTo = transferTo/);
assert.match(submit, /JSON\.stringify\(body\)/);
assert.equal(submit.includes("MakeCall"), false);
assert.equal(submit.includes("/api/outbound-calls"), false);
assert.match(api, /function callOutcomeTransferView/);
assert.match(api, /customer\.assign/);
assert.match(api, /lead\.assign/);
assert.match(api, /renderOutboundCallRecordList\(records, callOutcomeTransferView\(\)\)/);
assert.match(api, /renderOutboundCallRecordDetail\(result, callOutcomeTransferView\(\)\)/);

const shortcutStart = api.indexOf("function applyCallOutcomeShortcut");
const shortcutEnd = api.indexOf("async function saveOutcomeNotePhrase", shortcutStart);
const shortcut = api.slice(shortcutStart, shortcutEnd);
assert.match(shortcut, /tag === "SELECT"/);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const recordsStart = page.indexOf('id="outbound-call-records"');
const recordsEnd = page.indexOf('id="phone-strategies"', recordsStart);
const records = page.slice(recordsStart, recordsEnd);
assert.match(records, /转交给/);
assert.match(records, /没有分配权限时不显示/);
assert.match(records, /不会因此拨出/);
assert.match(records, /不能批量标注/);
assert.equal(records.includes(">外呼<"), false);

console.log("call outcome transfer frontend tests passed");
