import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderCallWrapupCounts, renderCallWrapupQueue } from "./call-wrapup-queue.js";

const html = renderCallWrapupQueue({
  items: [{
    callRecordId: "ocr_1",
    targetLabel: "客户",
    name: "Nordic <script>",
    maskedNumber: "*******2333",
    endedAgoLabel: "2小时"
  }],
  skipped: [{
    callRecordId: "ocr_2",
    targetLabel: "线索",
    name: "Example",
    maskedNumber: "*******8000",
    endedAgoLabel: "30分钟",
    reasonLabel: "未接通"
  }],
  reasons: [{ code: "missed", label: "未接通" }]
});
assert.match(html, /data-call-wrapup-open="ocr_1"/);
assert.match(html, /data-call-wrapup-queue-row="ocr_1"/);
assert.match(html, /data-call-wrapup-number="ocr_1">\*\*\*\*\*\*\*2333/);
assert.match(html, /data-call-wrapup-age="ocr_1">2小时/);
assert.match(html, /客户 · Nordic &lt;script&gt;/);
assert.match(html, /data-call-wrapup-skip-form="ocr_1"/);
assert.match(html, /无需小结/);
assert.match(html, /data-call-wrapup-restore="ocr_2"/);
assert.match(html, /撤销/);
assert.match(html, /未接通/);
assert.equal(html.includes("<script>"), false);
assert.equal(html.includes(">外呼<"), false);
assert.equal(html.includes("data-outbound-call"), false);

const empty = renderCallWrapupQueue({ items: [], skipped: [] });
assert.match(empty, /没有待小结的通话/);
assert.match(empty, /没有已标记无需小结的通话/);

const counts = renderCallWrapupCounts({
  empty: false,
  rows: [
    { agentId: "agent-a", agentLabel: "Shirley坐席", pendingCount: 2 },
    { agentId: "", agentLabel: "未分配坐席", pendingCount: 1 }
  ]
});
assert.match(counts, /data-call-wrapup-count="agent-a">2/);
assert.match(counts, /未分配坐席/);
assert.equal(counts.includes(">外呼<"), false);
assert.match(renderCallWrapupCounts({ empty: true, rows: [] }), /没有可显示的坐席/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(page, /id="dashboardCallWrapupQueue"/);
assert.match(api, /\/api\/call-wrapup-queue/);
assert.match(api, /data-call-wrapup-open/);
assert.match(api, /data-call-wrapup-skip-form/);
assert.match(api, /data-call-wrapup-restore/);
assert.match(api, /\/api\/call-wrapup-queue\/counts/);
assert.match(api, /data-call-wrapup-panel/);
assert.equal(api.includes("call-wrapup-queue/${encodeURIComponent(recordId)}/skip"), true);

console.log("call wrapup queue frontend tests passed");
