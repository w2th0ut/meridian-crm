import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatAverageSeconds,
  formatConnectRate,
  outboundCallRecordQuery,
  renderOutboundCallAgentOptions,
  renderOutboundCallRecordFailure,
  renderOutboundCallRecordList,
  renderOutboundCallRecordSummary
} from "./outbound-call-records.js";

assert.equal(outboundCallRecordQuery({}), "");
assert.equal(outboundCallRecordQuery({ agentId: "agent@ccc-a", from: "2026-04-04", to: "2026-04-04" }), "?agentId=agent%40ccc-a&from=2026-04-04&to=2026-04-04");
assert.equal(outboundCallRecordQuery({ agentId: "agent@ccc-a" }).includes("dial"), false);

assert.equal(formatConnectRate(0.5), "50%");
assert.equal(formatConnectRate(0), "0%");
assert.equal(formatConnectRate(null), "—");
assert.equal(formatConnectRate(1 / 3), "33.3%");
assert.equal(formatAverageSeconds(15), "15 秒");
assert.equal(formatAverageSeconds(10.5), "10.5 秒");
assert.equal(formatAverageSeconds(null), "—");

const empty = renderOutboundCallRecordSummary({ empty: true, stats: null, records: [] });
assert.match(empty, /data-outbound-record-empty="1"/);
assert.equal(empty.includes("data-outbound-record-stats"), false);
assert.equal(empty.includes("0%"), false);
assert.equal(empty.includes("总拨打"), false);

const stats = renderOutboundCallRecordSummary({
  empty: false,
  stats: {
    totalCalls: 4,
    connectedCalls: 2,
    connectRate: 0.5,
    averageConnectedDurationSeconds: 15
  }
});
assert.match(stats, /data-stat="total">4/);
assert.match(stats, /data-stat="connected">2/);
assert.match(stats, /data-stat="rate">50%/);
assert.match(stats, /data-stat="average">15 秒/);
assert.equal(stats.includes("data-outbound-call"), false);
assert.equal(stats.includes(">外呼<"), false);

const unanswered = renderOutboundCallRecordSummary({
  empty: false,
  stats: {
    totalCalls: 1,
    connectedCalls: 0,
    connectRate: 0,
    averageConnectedDurationSeconds: null
  }
});
assert.match(unanswered, /data-stat="rate">0%/);
assert.match(unanswered, /data-stat="average">—/);

const failure = renderOutboundCallRecordFailure("<script>");
assert.match(failure, /data-outbound-record-empty/);
assert.equal(failure.includes("<script>"), false);

const list = renderOutboundCallRecordList([
  {
    id: "ocr_1",
    localDate: "2026-04-04",
    agentLabel: "Shirley坐席",
    maskedNumber: "*******2333",
    contactDisposition: "Success",
    established: false,
    callDurationRaw: "8",
    targetType: "customer"
  }
]);
assert.match(list, /data-record-id="ocr_1"/);
assert.match(list, />否</);
assert.match(list, />Success</);
assert.equal(list.includes("data-outbound-call"), false);
assert.equal(list.includes(">外呼<"), false);
assert.equal(renderOutboundCallRecordList([]), "");

const selfOptions = renderOutboundCallAgentOptions({
  scope: "self",
  agents: [{ cccUserId: "agent@ccc-a", label: "Shirley坐席" }],
  selected: "agent@ccc-a"
});
assert.match(selfOptions, /Shirley坐席/);
assert.equal(selfOptions.includes("全部"), false);
assert.equal(selfOptions.includes("agent@ccc-b"), false);

const teamOptions = renderOutboundCallAgentOptions({
  scope: "team",
  agents: [
    { cccUserId: "agent@ccc-a", label: "Shirley坐席" },
    { cccUserId: "agent@ccc-b", label: "Mia坐席" }
  ],
  selected: ""
});
assert.match(teamOptions, />全部</);
assert.match(teamOptions, /Mia坐席/);

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const viewStart = html.indexOf('id="outbound-call-records"');
const viewEnd = html.indexOf('id="whatsapp"', viewStart);
assert.ok(viewStart > 0 && viewEnd > viewStart);
const view = html.slice(viewStart, viewEnd);
assert.match(view, /外呼通话记录/);
assert.match(view, /第 9 节/);
assert.match(view, /id="outboundCallRecordFilters"/);
assert.equal(view.includes("data-outbound-call"), false);
assert.equal(view.includes(">外呼<"), false);
assert.equal(view.includes("MakeCall"), false);
assert.match(html, /data-view="outbound-call-records"/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /"outbound-call-records": "communication\.read"/);
assert.match(api, /"outbound-call-records": "外呼记录"/);

console.log("outbound call record page tests passed");
