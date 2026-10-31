import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CALL_OUTCOME_NOTE_MAX,
  CALL_OUTCOMES,
  outboundCallRecordQuery,
  renderCallOutcomeForm,
  renderOutboundCallOutcomeCounts,
  renderOutboundCallOutcomeFilterEmpty,
  renderOutboundCallRecordDetail,
  renderOutboundCallRecordList,
  renderOutboundCallRecordSummary
} from "./outbound-call-records.js";

assert.deepEqual([...CALL_OUTCOMES], ["有意向", "需回访", "无意向", "号码错误", "其他"]);
assert.equal(CALL_OUTCOME_NOTE_MAX, 200);
assert.equal(outboundCallRecordQuery({ outcome: "有意向" }), "?outcome=%E6%9C%89%E6%84%8F%E5%90%91");
assert.equal(outboundCallRecordQuery({ agentId: "agent@ccc-a", outcome: "需回访" }).includes("outcome="), true);
assert.equal(outboundCallRecordQuery({}).includes("outcome"), false);

const counts = renderOutboundCallOutcomeCounts({
  "有意向": 2,
  "需回访": 0,
  "无意向": 1
});
assert.match(counts, /data-outcome-counts="1"/);
assert.match(counts, /data-outcome="有意向">2/);
assert.match(counts, /data-outcome="需回访">0/);
assert.match(counts, /data-outcome="无意向">1/);
assert.equal(counts.includes("号码错误"), false);
assert.equal(counts.includes("其他"), false);
assert.equal(renderOutboundCallOutcomeCounts(null), "");
assert.equal(renderOutboundCallOutcomeCounts({}), "");

const summary = renderOutboundCallRecordSummary({
  empty: false,
  stats: { totalCalls: 4, connectedCalls: 2, connectRate: 0.5, averageConnectedDurationSeconds: 15 },
  outcomeCounts: { "有意向": 2, "需回访": 1, "无意向": 0, "号码错误": 0, "其他": 0 }
});
assert.match(summary, /data-stat="total">4/);
assert.match(summary, /data-outcome="有意向">2/);
assert.equal(summary.includes("data-outbound-call"), false);

const empty = renderOutboundCallRecordSummary({ empty: true, stats: null, outcomeCounts: { "有意向": 9 } });
assert.match(empty, /data-outbound-record-empty="1"/);
assert.equal(empty.includes("data-outcome-counts"), false);
assert.equal(empty.includes("有意向"), false);
assert.equal(empty.includes(">9<"), false);

const form = renderCallOutcomeForm({ id: "ocr_1", callOutcome: "无意向", callOutcomeNote: "先看看<script>" });
assert.match(form, /data-call-outcome-form="1"/);
assert.match(form, /data-record-id="ocr_1"/);
assert.match(form, /value="无意向" selected/);
assert.match(form, /maxlength="200"/);
assert.match(form, /value="先看看&lt;script&gt;"/);
assert.match(form, /保存标注/);
assert.equal(form.includes("批量"), false);
assert.equal(form.includes("MakeCall"), false);
assert.equal(form.includes(">外呼<"), false);
for (const outcome of CALL_OUTCOMES) assert.match(form, new RegExp(`value="${outcome}"`));

const list = renderOutboundCallRecordList([
  { id: "ocr_1", established: true, callOutcome: "有意向", callOutcomeNote: "样品" }
]);
assert.match(list, /data-call-outcome-form="1"/);
assert.match(list, /保存标注/);
assert.equal(list.includes("批量"), false);
assert.equal(list.includes(">外呼<"), false);

const detail = renderOutboundCallRecordDetail({
  record: { id: "ocr_1", established: true, maskedNumber: "*******2333", callOutcome: "号码错误", callOutcomeNote: "空号" }
});
assert.match(detail, /data-call-outcome-panel="1"/);
assert.match(detail, /value="号码错误" selected/);
assert.match(detail, /value="空号"/);
assert.match(detail, /data-follow-up-established="1"/);
assert.equal(detail.includes("data-generate-missed-follow"), false);
assert.equal(detail.includes("MakeCall"), false);

assert.match(renderOutboundCallOutcomeFilterEmpty(), /data-outcome-filter-empty="1"/);

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const viewStart = html.indexOf('id="outbound-call-records"');
const viewEnd = html.indexOf('id="phone-strategies"', viewStart);
const view = html.slice(viewStart, viewEnd);
assert.match(view, /id="outboundCallRecordOutcome"/);
assert.match(view, /可以给单条记录标注通话结果/);
assert.match(view, /不能拨号/);
assert.match(view, /不能批量生成/);
assert.match(view, /不能批量标注/);
for (const outcome of CALL_OUTCOMES) assert.match(view, new RegExp(`value="${outcome}"`));
assert.equal(view.includes("data-outbound-call"), false);
assert.equal(view.includes(">外呼<"), false);
assert.equal(view.includes("MakeCall"), false);
assert.equal(view.includes("批量标注</button>"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const submitStart = api.indexOf("async function submitCallOutcome");
const submitEnd = api.indexOf("async function loadOutboundCallRecords");
assert.ok(submitStart > 0 && submitEnd > submitStart);
const submit = api.slice(submitStart, submitEnd);
assert.match(submit, /\/api\/outbound-call-records\/\$\{encodeURIComponent\(recordId\)\}\/outcome/);
assert.match(submit, /JSON\.stringify\(\{ outcome, note \}\)/);
assert.doesNotMatch(submit, /MakeCall|aliyuncs|callRecordIds|records":|ids":/);
assert.match(api, /data-call-outcome-form/);
assert.match(api, /outboundCallRecordOutcome/);

console.log("call outcome page tests passed");
