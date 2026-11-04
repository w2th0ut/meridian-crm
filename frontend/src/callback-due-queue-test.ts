import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { callbackDueQueueQuery, renderCallbackDueQueue } from "./callback-due-queue.js";

assert.equal(callbackDueQueueQuery({ scope: "mine" }), "?scope=mine");
assert.equal(callbackDueQueueQuery({ scope: "team", overdueOnly: true }), "?scope=team&overdue=1");

const html = renderCallbackDueQueue({
  scope: "mine",
  today: "2026-11-04",
  items: [
    {
      targetType: "customer",
      targetId: "c1",
      targetLabel: "客户",
      name: "Nordic <Tools>",
      scheduledAt: "2026-11-03 10:00",
      note: "=改期",
      due: "overdue",
      ownerAgentId: "agent@ccc-a",
      ownerAgentLabel: "Shirley坐席",
      ageLabel: "1天"
    },
    {
      targetType: "lead",
      targetId: "l2",
      targetLabel: "线索",
      name: "灯具",
      scheduledAt: "2026-11-04 18:00",
      note: "",
      due: "today",
      ageLabel: ""
    }
  ]
});
assert.match(html, /data-callback-due-queue="1"/);
assert.match(html, /data-callback-due-row="1"/);
assert.match(html, /Nordic &lt;Tools&gt;/);
assert.match(html, /data-callback-due-open="1"/);
assert.match(html, /data-callback-due-complete="1"/);
assert.match(html, /data-callback-due-reschedule="1"/);
assert.match(html, /data-callback-due-age="1">1天/);
assert.match(html, /data-callback-due-age="1">—/);
assert.match(html, /负责坐席 Shirley坐席/);
assert.match(html, /负责坐席 未指派/);
assert.match(html, /value="reached"/);
assert.equal(html.includes("data-callback-open=\"intent-followup-queue\""), false);
assert.equal(html.includes("MakeCall"), false);
assert.equal(/外呼</.test(html), false);
assert.equal((html.match(/data-callback-due-row="1"/g) || []).length, 2);
assert.match(renderCallbackDueQueue({ items: [] }), /data-callback-due-empty="1"/);
assert.equal(renderCallbackDueQueue({ items: [] }).includes(">0<"), false);
const many = renderCallbackDueQueue({
  items: Array.from({ length: 9 }, (_, index) => ({
    targetType: "customer",
    targetId: `c${index}`,
    name: `客户${index}`,
    scheduledAt: "2026-11-04 10:00",
    due: "today" as const,
    ageLabel: "1小时"
  }))
});
assert.equal((many.match(/data-callback-due-row="1"/g) || []).length, 9);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = page.indexOf('id="dashboardCallbackDueQueue"');
const end = page.indexOf('id="kdBoard"', start);
assert.equal(start > 0 && end > start, true);
const view = page.slice(start, end);
assert.match(view, /回拨到期队列/);
assert.match(view, /id="dashboardCallbackDueMine"/);
assert.match(view, /id="dashboardCallbackDueTeam"/);
assert.match(view, /hidden/);
assert.match(view, /id="dashboardCallbackDueOverdueOnly"/);
assert.match(view, /id="dashboardCallbackDueExport"/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);
assert.equal(view.includes("MakeCall"), false);
const reminder = page.slice(page.indexOf('id="dashboardCallbackSchedules"'), start);
assert.match(reminder, /意向回访/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/callback-due-queue/);
assert.match(api, /\/api\/callback-due-queue\/complete/);
assert.match(api, /\/api\/callback-due-queue\/export/);
assert.match(api, /\/api\/callback-schedules/);
assert.match(api, /renderCallbackDueQueue/);
assert.match(api, /openCallbackDueObject/);
assert.match(api, /activateNavView\("customers"/);
assert.match(api, /activateNavView\("leads"/);
assert.match(api, /activateNavView\("prospect-list"/);
const gate = api.indexOf("function canViewCallbackDueQueueTeam");
assert.equal(gate > 0, true);
assert.match(api.slice(gate, gate + 240), /role === "manager"/);
const refreshStart = api.indexOf("async function refreshDashboardOnly");
const refreshEnd = api.indexOf("function requestDashboardRefresh", refreshStart);
assert.equal(refreshStart > 0 && refreshEnd > refreshStart, true);
assert.equal(api.slice(refreshStart, refreshEnd).includes("/api/callback-due-queue"), false);
const loadStart = api.indexOf("async function loadCallbackDueQueue");
const loadEnd = api.indexOf("async function syncCampaignRoster", loadStart);
assert.equal(loadStart > 0 && loadEnd > loadStart, true);
assert.equal(api.slice(loadStart, loadEnd).includes("aliyuncs.com"), false);
assert.equal(api.slice(loadStart, loadEnd).includes("MakeCall"), false);

console.log("callback due queue frontend tests passed");
