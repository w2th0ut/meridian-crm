import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CALL_OUTCOME_NOTE_MAX,
  callOutcomeBatchBody,
  renderCallOutcomeBatchOptions,
  renderUnlabeledConnectedCallEmpty,
  renderUnlabeledConnectedCalls,
  unlabeledConnectedCallQuery
} from "./call-outcome-batch.js";

assert.equal(unlabeledConnectedCallQuery({ scope: "mine" }), "?scope=mine");
assert.equal(unlabeledConnectedCallQuery({ scope: "team" }), "?scope=team");
assert.deepEqual(callOutcomeBatchBody({ callRecordIds: ["a", "b"], outcome: "需回访", note: "  下午  " }), {
  callRecordIds: ["a", "b"],
  outcome: "需回访",
  note: "下午"
});
assert.deepEqual(callOutcomeBatchBody({ callRecordIds: ["a"], outcome: "其他", note: "   " }), {
  callRecordIds: ["a"],
  outcome: "其他"
});
assert.equal(CALL_OUTCOME_NOTE_MAX, 200);
for (const outcome of ["有意向", "需回访", "无意向", "号码错误", "其他"]) {
  assert.match(renderCallOutcomeBatchOptions(), new RegExp(`value="${outcome}"`));
}

const html = renderUnlabeledConnectedCalls({
  scope: "team",
  items: [
    {
      callRecordId: "ocr_1",
      outcome: "Success",
      name: "Nordic <Tools>",
      targetLabel: "客户",
      maskedNumber: "*******2333",
      agentLabel: "Shirley坐席",
      startedAt: "2026-04-04T04:00:00.000Z"
    },
    {
      callRecordId: "ocr_2",
      name: "",
      targetLabel: "",
      maskedNumber: "",
      agentLabel: "",
      startedAt: ""
    }
  ]
});
assert.match(html, /data-call-outcome-batch-list="1"/);
assert.match(html, /data-call-outcome-batch-row="1"/);
assert.match(html, /data-call-outcome-batch-id="ocr_1"/);
assert.match(html, /data-call-outcome-batch-all="1"/);
assert.match(html, /Nordic &lt;Tools&gt;/);
assert.match(html, /data-call-outcome-batch-outcome="1">未标注/);
assert.equal(html.includes("Success"), false);
assert.match(html, /data-call-outcome-batch-open="1"/);
assert.match(html, /data-call-outcome-batch-at="1">—/);
assert.match(html, /\*\*\*\*\*\*\*2333/);
assert.equal(html.includes("data-outbound-call"), false);
assert.equal(html.includes("MakeCall"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(html), false);
assert.equal((html.match(/data-call-outcome-batch-row="1"/g) || []).length, 2);
assert.match(renderUnlabeledConnectedCallEmpty(), /data-call-outcome-batch-empty="1"/);
assert.equal(renderUnlabeledConnectedCalls({ items: [] }).includes(">0<"), false);
assert.equal(renderUnlabeledConnectedCalls(undefined).includes(">0<"), false);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = page.indexOf('id="dashboardCallOutcomeBatch"');
const end = page.indexOf('id="dashboardAgentWorkStatusReport"', start);
assert.equal(start > 0 && end > start, true);
const view = page.slice(start, end);
assert.match(view, /已接通未标注/);
assert.match(view, /hidden/);
assert.match(view, /id="dashboardCallOutcomeBatchMine"/);
assert.match(view, /id="dashboardCallOutcomeBatchTeam"/);
assert.match(view, /data-call-outcome-batch-outcome/);
assert.match(view, /data-call-outcome-batch-submit/);
assert.match(view, /标注所选/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);
assert.equal(view.includes("MakeCall"), false);
assert.equal(view.includes("data-outbound-call"), false);
const previous = page.slice(page.indexOf('id="dashboardSameDayCallSkip"'), start);
assert.match(previous, /暂停外呼至/);
const recordsStart = page.indexOf('id="outbound-call-records"');
const recordsEnd = page.indexOf('id="phone-strategies"', recordsStart);
assert.match(page.slice(recordsStart, recordsEnd), /不能批量标注/);
assert.equal(page.slice(recordsStart, recordsEnd).includes("标注所选"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/unlabeled-connected-calls/);
assert.match(api, /\/api\/unlabeled-connected-calls\/label/);
assert.match(api, /renderUnlabeledConnectedCalls/);
assert.match(api, /openOutboundCallRecord/);
const gate = api.indexOf("function canViewCallOutcomeBatchTeam");
assert.equal(gate > 0, true);
assert.match(api.slice(gate, gate + 280), /role === "manager"/);
const refreshStart = api.indexOf("async function refreshDashboardOnly");
const refreshEnd = api.indexOf("function requestDashboardRefresh", refreshStart);
assert.equal(refreshStart > 0 && refreshEnd > refreshStart, true);
assert.equal(api.slice(refreshStart, refreshEnd).includes("/api/unlabeled-connected-calls"), false);
const loadStart = api.indexOf("async function loadUnlabeledConnectedCalls");
const loadEnd = api.indexOf("async function submitCallOutcomeBatch", loadStart);
assert.equal(loadStart > 0 && loadEnd > loadStart, true);
assert.equal(api.slice(loadStart, loadEnd).includes("aliyuncs.com"), false);
assert.equal(api.slice(loadStart, loadEnd).includes("MakeCall"), false);
assert.equal(api.slice(loadStart, loadEnd).includes('"/api/outbound-calls"'), false);
const submitStart = api.indexOf("async function submitCallOutcomeBatch");
const submitEnd = api.indexOf("let agentWorkStatusReportAgentId", submitStart);
assert.equal(submitStart > 0 && submitEnd > submitStart, true);
assert.match(api.slice(submitStart, submitEnd), /\/api\/unlabeled-connected-calls\/label/);
assert.match(api.slice(submitStart, submitEnd), /callOutcomeBatchBody/);
assert.equal(api.slice(submitStart, submitEnd).includes('"/api/outbound-calls"'), false);
assert.equal(api.slice(submitStart, submitEnd).includes("MakeCall"), false);

console.log("call outcome batch frontend tests passed");
