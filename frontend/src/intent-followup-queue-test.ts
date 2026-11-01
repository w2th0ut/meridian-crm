import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  renderIntentFollowupEmpty,
  renderIntentFollowupQueue,
  renderIntentFollowupRows
} from "./intent-followup-queue.js";

const empty = renderIntentFollowupQueue({ empty: true, items: [] });
assert.match(empty, /data-intent-followup-empty="1"/);
assert.match(empty, /这个范围内还没有待回访的对象/);
assert.equal(empty.includes("data-intent-followup-row"), false);
assert.equal(empty.includes(">0<"), false);
assert.equal(renderIntentFollowupEmpty().includes("拨号"), false);
assert.equal(empty.includes("忽略"), false);

const rows = renderIntentFollowupRows([{
  targetType: "customer",
  targetId: "c-intent",
  targetLabel: "客户",
  name: "有意向客户",
  outcome: "有意向",
  labeledAt: "2026-10-21T08:30:00.000Z",
  agentLabel: "甲坐席",
  maskedNumber: "*******2333",
  suppressionNotice: "该对象在抑制或退订名单中。这次只记下下次跟进，不改变抑制状态。"
}], "2026-11-02 09:00");
assert.match(rows, /data-intent-followup-row="1"/);
assert.match(rows, /安排跟进/);
assert.equal(rows.includes("data-intent-ignore"), false);
assert.match(rows, /data-labeled-at="2026-10-21T08:30:00.000Z"/);
assert.match(rows, /data-agent-label="甲坐席"/);
assert.match(rows, /data-follow-up-notice="1"/);
assert.match(rows, /value="2026-11-02T09:00"/);
assert.equal(rows.includes("批量"), false);
assert.equal(rows.includes("拨号"), false);
assert.equal(rows.includes("MakeCall"), false);

const page = renderIntentFollowupQueue({
  suggestedNextFollowAt: "2026-11-02 09:00",
  items: [{
    targetType: "lead",
    targetId: "l-open",
    targetLabel: "线索",
    name: "线索",
    outcome: "需回访",
    labeledAt: "2026-10-20T00:00:00.000Z",
    agentLabel: "乙坐席"
  }]
});
assert.match(page, /data-intent-followup-row="1"/);
assert.equal(page.includes("data-intent-followup-empty"), false);
assert.equal(page.includes("忽略"), false);
assert.equal(page.includes("批量"), false);

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const viewStart = html.indexOf('id="intent-followup-queue"');
const viewEnd = html.indexOf('id="phone-strategies"', viewStart);
assert.ok(viewStart > 0 && viewEnd > viewStart);
const view = html.slice(viewStart, viewEnd);
assert.match(view, /意向回访队列/);
assert.match(view, /data-intent-followup-empty="1"/);
assert.match(view, /不能拨号/);
assert.match(view, /不能批量操作/);
assert.equal(view.includes("id=\"intentFollowupOutcome\""), false);
assert.equal(view.includes("忽略"), false);
assert.equal(view.includes("MakeCall"), false);
assert.equal(view.includes(">拨号<"), false);
assert.match(html, /data-view="intent-followup-queue"/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /"intent-followup-queue": "communication\.read"/);
assert.match(api, /"intent-followup-queue": "意向回访"/);
const submitStart = api.indexOf("async function submitIntentFollowup");
const submitEnd = api.indexOf("async function loadOutboundCallRecords");
assert.ok(submitStart > 0 && submitEnd > submitStart);
const submit = api.slice(submitStart, submitEnd);
assert.match(submit, /\/api\/intent-followup-queue\/schedule/);
assert.match(submit, /JSON\.stringify\(body\)/);
assert.doesNotMatch(submit, /MakeCall|aliyuncs|callRecordIds|\/ignore|\/restore/);

console.log("intent follow-up queue page tests passed");
