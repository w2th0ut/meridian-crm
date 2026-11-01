import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatCallTagLatestAt,
  renderCallTagFilterOptions,
  renderCallTagObjectSummary,
  renderCallTagTargetNote,
  renderOutboundCallTargetFilterEmpty
} from "./call-tag-view.js";
import { outboundCallRecordQuery } from "./outbound-call-records.js";

const summary = renderCallTagObjectSummary([
  { id: "ctag_price", name: "价格敏感", enabled: true, count: 2, latestAt: "2026-04-03T00:00:00.000Z" },
  { id: "ctag_sample", name: "要样品<script>", enabled: false, count: 1, latestAt: "" }
]);
assert.match(summary, /data-call-tag-open="ctag_price"/);
assert.match(summary, /data-call-tag-count="2"/);
assert.match(summary, /2 次/);
assert.match(summary, /data-call-tag-disabled="0"/);
assert.match(summary, /class="call-tag-chip is-disabled"/);
assert.match(summary, /data-call-tag-disabled="1"/);
assert.match(summary, /要样品&lt;script&gt;/);
assert.match(summary, /最近 —/);
assert.equal(summary.includes("<script>"), false);
assert.match(renderCallTagObjectSummary([]), /data-call-tag-summary-empty="1"/);
assert.match(renderCallTagObjectSummary(undefined), /还没有标签/);

const options = renderCallTagFilterOptions([
  { id: "ctag_price", name: "价格敏感", enabled: true },
  { id: "ctag_sample", name: "要样品", enabled: false }
], "ctag_sample");
assert.match(options, /全部通话标签/);
assert.match(options, /要样品（已停用）/);
assert.match(options, /data-call-tag-disabled="1"/);
assert.match(options, /selected/);

assert.match(renderCallTagTargetNote({ targetType: "customer", targetId: "c1", tag: "ctag_price" }), /这个客户/);
assert.match(renderCallTagTargetNote({ targetType: "customer", targetId: "c1", tag: "ctag_price" }), /data-clear-call-target="1"/);
assert.equal(renderCallTagTargetNote({}), "");
assert.match(renderOutboundCallTargetFilterEmpty(), /data-call-tag-target-empty="1"/);
assert.equal(formatCallTagLatestAt(""), "—");
assert.match(outboundCallRecordQuery({ tag: "ctag_price", targetType: "customer", targetId: "c1" }), /targetType=customer/);
assert.match(outboundCallRecordQuery({ tag: "ctag_price", targetType: "customer", targetId: "c1" }), /targetId=c1/);
assert.equal(outboundCallRecordQuery({}).includes("targetType"), false);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(page, /id="customerCallTagFilter"/);
assert.match(page, /id="leadCallTagFilter"/);
assert.match(page, /id="outboundCallRecordTargetNote"/);
assert.match(api, /\/call-tags/);
assert.match(api, /data-call-tag-summary/);
assert.match(api, /openCallRecordsForObjectTag/);
const viewSource = readFileSync(new URL("./call-tag-view.ts", import.meta.url), "utf8");
assert.equal(viewSource.includes("aliyuncs.com"), false);
assert.equal(viewSource.includes("convert_to_lead"), false);

console.log("call tag view frontend tests passed");
