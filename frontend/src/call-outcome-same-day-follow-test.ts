import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderCallOutcomeForm, renderOutboundCallRecordDetail, renderOutboundCallRecordList } from "./outbound-call-records.js";
import { defaultCallOutcomeNextFollow, renderCallOutcomeNextFollow } from "./call-outcome-next-follow.js";

assert.equal(defaultCallOutcomeNextFollow("有意向"), "tomorrow");
assert.equal(defaultCallOutcomeNextFollow("无意向"), "none");

const missed = renderCallOutcomeNextFollow("有意向", true);
assert.match(missed, /value="plus2h"/);
assert.match(missed, />2 小时后</);
assert.match(missed, /value="plus4h"/);
assert.match(missed, />4 小时后</);
assert.match(missed, /value="tomorrow" selected/);
assert.match(missed, /顶到下一个允许时段的开始/);
assert.match(missed, /暂停外呼仍优先/);
assert.equal(missed.includes(">外呼<"), false);
assert.equal(missed.includes("MakeCall"), false);
assert.equal(missed.includes("/api/"), false);

const missedNegative = renderCallOutcomeForm({ id: "ocr_miss", callOutcome: "号码错误", established: false });
assert.match(missedNegative, /value="plus2h"/);
assert.match(missedNegative, /value="none" selected/);
assert.equal(missedNegative.includes('value="plus2h" selected'), false);
assert.equal(missedNegative.includes(">外呼<"), false);

const connected = renderCallOutcomeForm({ id: "ocr_ok", callOutcome: "有意向", established: true });
assert.equal(connected.includes("plus2h"), false);
assert.equal(connected.includes("2 小时后"), false);
assert.match(connected, /value="tomorrow" selected/);

const unknown = renderCallOutcomeNextFollow("需回访");
assert.equal(unknown.includes("plus2h"), false);

const list = renderOutboundCallRecordList([
  { id: "ocr_miss", established: false, callOutcome: "其他", targetType: "customer", targetId: "c1" },
  { id: "ocr_ok", established: true, callOutcome: "有意向", targetType: "customer", targetId: "c1" }
]);
const missedRow = list.slice(list.indexOf('data-record-id="ocr_miss"'), list.indexOf('data-record-id="ocr_ok"'));
const connectedRow = list.slice(list.indexOf('data-record-id="ocr_ok"'));
assert.match(missedRow, /2 小时后/);
assert.equal(connectedRow.includes("2 小时后"), false);
assert.equal(list.includes(">外呼<"), false);

const detail = renderOutboundCallRecordDetail({
  record: { id: "ocr_miss", established: false, callOutcome: "其他", maskedNumber: "*******2333" }
});
assert.match(detail, /4 小时后/);
assert.equal(detail.includes(">外呼<"), false);

const batch = readFileSync(new URL("./call-outcome-batch.ts", import.meta.url), "utf8");
assert.equal(batch.includes("plus2h"), false);
assert.equal(batch.includes("data-call-outcome-next-follow"), false);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const recordsStart = page.indexOf('id="outbound-call-records"');
const recordsEnd = page.indexOf('id="phone-strategies"', recordsStart);
const records = page.slice(recordsStart, recordsEnd);
assert.match(records, /2 小时后或 4 小时后/);
assert.match(records, /已接通不能选这两项/);
assert.match(records, /也不会拨出/);
assert.match(records, /明天、3 天后、1 周后或不设/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const submitStart = api.indexOf("async function submitCallOutcome");
const submitEnd = api.indexOf("let todayFollowNextPending", submitStart);
const submit = api.slice(submitStart, submitEnd);
assert.match(submit, /nextFollowChoice/);
assert.equal(submit.includes("MakeCall"), false);
assert.equal(submit.includes("plus2h"), false);

console.log("call outcome same day follow frontend tests passed");
