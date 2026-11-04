import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderCallOutcomeForm } from "./outbound-call-records.js";
import { callOutcomeMarkInvalidVisible } from "./call-outcome-wrong-number.js";

assert.equal(callOutcomeMarkInvalidVisible("号码错误"), true);
assert.equal(callOutcomeMarkInvalidVisible(" 号码错误 "), true);
assert.equal(callOutcomeMarkInvalidVisible("无意向"), false);
assert.equal(callOutcomeMarkInvalidVisible(""), false);

const wrong = renderCallOutcomeForm({ id: "ocr_wn", callOutcome: "号码错误", targetType: "customer", targetId: "c1" });
assert.match(wrong, /data-call-outcome-mark-invalid-wrap="1"/);
assert.equal(wrong.includes('data-call-outcome-mark-invalid-wrap="1" hidden'), false);
assert.match(wrong, /data-call-outcome-mark-invalid="1" checked/);
assert.match(wrong, /同时把这个号码标为无效/);
assert.match(wrong, /不会拨出/);
assert.match(wrong, /保存标注/);
assert.equal(wrong.includes(">外呼<"), false);
assert.equal(wrong.includes("MakeCall"), false);
assert.equal(wrong.includes("/api/"), false);

const other = renderCallOutcomeForm({ id: "ocr_other", callOutcome: "有意向" });
assert.match(other, /data-call-outcome-mark-invalid-wrap="1" hidden/);
assert.equal(other.includes('data-call-outcome-mark-invalid="1" checked'), false);
assert.match(other, /同时把这个号码标为无效/);

const batch = readFileSync(new URL("./call-outcome-batch.ts", import.meta.url), "utf8");
assert.equal(batch.includes("data-call-outcome-mark-invalid"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const submitStart = api.indexOf("async function submitCallOutcome");
const submitEnd = api.indexOf("let todayFollowNextPending", submitStart);
assert.ok(submitStart > 0 && submitEnd > submitStart);
const submit = api.slice(submitStart, submitEnd);
assert.match(submit, /data-call-outcome-mark-invalid/);
assert.match(submit, /markNumberInvalid/);
assert.match(submit, /JSON\.stringify\(\{ outcome, note, nextFollowChoice, markNumberInvalid \}\)/);
assert.match(submit, /\/api\/outbound-call-records\/\$\{encodeURIComponent\(recordId\)\}\/outcome/);
assert.equal(submit.includes("MakeCall"), false);
assert.equal(submit.includes("/api/outbound-calls"), false);

const shortcutStart = api.indexOf("function applyCallOutcomeShortcut");
const shortcutEnd = api.indexOf("async function saveOutcomeNotePhrase", shortcutStart);
const shortcut = api.slice(shortcutStart, shortcutEnd);
assert.match(shortcut, /syncCallOutcomeMarkInvalid\(form\)/);
assert.match(shortcut, /tag === "INPUT"/);
assert.match(api, /bindCallOutcomeMarkInvalid\(outcomeListRoot\)/);
assert.match(api, /bindCallOutcomeMarkInvalid\(outcomeDetailRoot\)/);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const recordsStart = page.indexOf('id="outbound-call-records"');
const recordsEnd = page.indexOf('id="phone-strategies"', recordsStart);
const records = page.slice(recordsStart, recordsEnd);
assert.match(records, /同时把这个号码标为无效/);
assert.match(records, /不会因此拨出/);
assert.match(records, /不能批量标注/);
assert.equal(records.includes(">外呼<"), false);

console.log("call outcome wrong number frontend tests passed");
