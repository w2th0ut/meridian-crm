import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderCallOutcomeForm } from "./outbound-call-records.js";
import {
  defaultCallOutcomeNextFollow,
  renderCallOutcomeNextFollow
} from "./call-outcome-next-follow.js";

assert.equal(defaultCallOutcomeNextFollow("无意向"), "none");
assert.equal(defaultCallOutcomeNextFollow(" 号码错误 "), "none");
assert.equal(defaultCallOutcomeNextFollow("有意向"), "tomorrow");
assert.equal(defaultCallOutcomeNextFollow("需回访"), "tomorrow");
assert.equal(defaultCallOutcomeNextFollow("其他"), "tomorrow");
assert.equal(defaultCallOutcomeNextFollow(""), "tomorrow");

const negative = renderCallOutcomeNextFollow("无意向");
assert.match(negative, /data-call-outcome-next-follow/);
assert.match(negative, /value="none" selected/);
assert.match(negative, />不设</);
assert.match(negative, />明天</);
assert.match(negative, />3 天后</);
assert.match(negative, />1 周后</);
assert.equal(negative.includes('value="tomorrow" selected'), false);
assert.equal(negative.includes("MakeCall"), false);
assert.equal(negative.includes(">外呼<"), false);
assert.equal(negative.includes("/api/"), false);

const positive = renderCallOutcomeForm({ id: "ocr_1", callOutcome: "有意向", callOutcomeNote: "样品" });
assert.match(positive, /data-call-outcome-next-follow/);
assert.match(positive, /value="tomorrow" selected/);
assert.match(positive, /data-call-outcome-next-follow-note="1"/);
assert.match(positive, /不设不改已有下次跟进/);
assert.match(positive, /保存标注/);
assert.equal(positive.includes('value="none" selected'), false);
assert.equal(positive.includes(">外呼<"), false);

const wrongNumber = renderCallOutcomeForm({ id: "ocr_2", callOutcome: "号码错误" });
assert.match(wrongNumber, /value="none" selected/);

const batch = readFileSync(new URL("./call-outcome-batch.ts", import.meta.url), "utf8");
assert.equal(batch.includes("data-call-outcome-next-follow"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const submitStart = api.indexOf("async function submitCallOutcome");
const submitEnd = api.indexOf("let todayFollowNextPending", submitStart);
assert.ok(submitStart > 0 && submitEnd > submitStart);
const submit = api.slice(submitStart, submitEnd);
assert.match(submit, /data-call-outcome-next-follow/);
assert.match(submit, /nextFollowChoice/);
assert.match(submit, /\/api\/outbound-call-records\/\$\{encodeURIComponent\(recordId\)\}\/outcome/);
assert.equal(submit.includes("MakeCall"), false);
assert.equal(submit.includes("today-follow-next"), false);

const shortcutStart = api.indexOf("function applyCallOutcomeShortcut");
const shortcutEnd = api.indexOf("async function saveOutcomeNotePhrase", shortcutStart);
const shortcut = api.slice(shortcutStart, shortcutEnd);
assert.match(shortcut, /syncCallOutcomeNextFollow\(form\)/);
assert.match(api, /bindCallOutcomeNextFollowDefaults\(outcomeListRoot\)/);
assert.match(api, /bindCallOutcomeNextFollowDefaults\(outcomeDetailRoot\)/);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const recordsStart = page.indexOf('id="outbound-call-records"');
const recordsEnd = page.indexOf('id="phone-strategies"', recordsStart);
const records = page.slice(recordsStart, recordsEnd);
assert.match(records, /明天、3 天后、1 周后或不设/);
assert.match(records, /无意向和号码错误默认不设/);
assert.match(records, /不能批量标注/);
assert.equal(records.includes(">外呼<"), false);

console.log("call outcome next follow frontend tests passed");
