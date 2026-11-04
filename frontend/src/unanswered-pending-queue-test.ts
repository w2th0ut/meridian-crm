import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderUnansweredPendingQueue, unansweredPendingQueueQuery } from "./unanswered-pending-queue.js";

assert.equal(unansweredPendingQueueQuery({ scope: "mine" }), "?scope=mine");
assert.equal(unansweredPendingQueueQuery({ scope: "team", age: "over7" }), "?scope=team&age=over7");
assert.equal(unansweredPendingQueueQuery({ scope: "mine", age: "" }), "?scope=mine");

const html = renderUnansweredPendingQueue({
  scope: "mine",
  age: "within7",
  items: [
    {
      targetType: "customer",
      targetId: "c1",
      targetLabel: "客户",
      name: "Nordic <Tools>",
      callRecordId: "ocr_1",
      unansweredAt: "2026-11-03 10:00",
      ageLabel: "1天",
      agentLabel: "Shirley坐席",
      maskedNumber: "****8000"
    },
    {
      targetType: "lead",
      targetId: "l2",
      targetLabel: "线索",
      name: "灯具",
      callRecordId: "ocr_2",
      unansweredAt: "",
      ageLabel: "",
      agentLabel: "",
      maskedNumber: ""
    }
  ]
});
assert.match(html, /data-unanswered-pending-queue="1"/);
assert.match(html, /data-unanswered-pending-row="1"/);
assert.match(html, /Nordic &lt;Tools&gt;/);
assert.match(html, /data-unanswered-pending-open="1"/);
assert.match(html, /data-unanswered-pending-follow-up="1"/);
assert.match(html, /data-unanswered-pending-callback="1"/);
assert.match(html, /生成下次跟进/);
assert.match(html, /保存回拨预约/);
assert.match(html, /data-unanswered-pending-age="1">1天/);
assert.match(html, /data-unanswered-pending-age="1">—/);
assert.match(html, /data-unanswered-pending-at="1">—/);
assert.match(html, /通话坐席 Shirley坐席/);
assert.match(html, /通话坐席 —/);
assert.match(html, /\*\*\*\*8000/);
assert.match(html, /七日及以内/);
assert.equal(html.includes("MakeCall"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(html), false);
assert.equal(html.includes("data-outbound-call"), false);
assert.equal((html.match(/data-unanswered-pending-row="1"/g) || []).length, 2);
assert.match(renderUnansweredPendingQueue({ items: [] }), /data-unanswered-pending-empty="1"/);
assert.equal(renderUnansweredPendingQueue({ items: [] }).includes(">0<"), false);
const many = renderUnansweredPendingQueue({
  items: Array.from({ length: 9 }, (_, index) => ({
    targetType: "customer",
    targetId: `c${index}`,
    name: `客户${index}`,
    callRecordId: `ocr_${index}`,
    unansweredAt: "2026-11-04 10:00",
    ageLabel: "1小时"
  }))
});
assert.equal((many.match(/data-unanswered-pending-row="1"/g) || []).length, 9);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = page.indexOf('id="dashboardUnansweredPendingQueue"');
const end = page.indexOf('id="kdBoard"', start);
assert.equal(start > 0 && end > start, true);
const view = page.slice(start, end);
assert.match(view, /未接通待处理/);
assert.match(view, /hidden/);
assert.match(view, /id="dashboardUnansweredPendingMine"/);
assert.match(view, /id="dashboardUnansweredPendingTeam"/);
assert.match(view, /id="dashboardUnansweredPendingAge"/);
assert.match(view, /within7/);
assert.match(view, /over7/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);
assert.equal(view.includes("MakeCall"), false);
assert.equal(view.includes("data-outbound-call"), false);
const report = page.slice(page.indexOf('id="dashboardCallbackScheduleReport"'), start);
assert.match(report, /回拨预约报表/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/unanswered-pending-queue/);
assert.match(api, /\/api\/outbound-call-records\/\$\{encodeURIComponent\(recordId\)\}\/next-follow-up/);
assert.match(api, /\/api\/outbound-call-records\/\$\{encodeURIComponent\(recordId\)\}\/callback-schedule/);
assert.match(api, /renderUnansweredPendingQueue/);
assert.match(api, /openCallbackDueObject/);
const gate = api.indexOf("function canViewUnansweredPendingTeam");
assert.equal(gate > 0, true);
assert.match(api.slice(gate, gate + 240), /role === "manager"/);
const refreshStart = api.indexOf("async function refreshDashboardOnly");
const refreshEnd = api.indexOf("function requestDashboardRefresh", refreshStart);
assert.equal(refreshStart > 0 && refreshEnd > refreshStart, true);
assert.equal(api.slice(refreshStart, refreshEnd).includes("/api/unanswered-pending-queue"), false);
const loadStart = api.indexOf("async function loadUnansweredPendingQueue");
const loadEnd = api.indexOf("async function syncCampaignRoster", loadStart);
assert.equal(loadStart > 0 && loadEnd > loadStart, true);
assert.equal(api.slice(loadStart, loadEnd).includes("aliyuncs.com"), false);
assert.equal(api.slice(loadStart, loadEnd).includes("MakeCall"), false);
assert.equal(api.slice(loadStart, loadEnd).includes("/api/outbound-calls"), false);

console.log("unanswered pending queue frontend tests passed");
