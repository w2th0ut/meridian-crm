import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderCallbackReminderList } from "./callback-schedule.js";
import { intentFollowupQuery, renderIntentFollowupQueue, renderIntentFollowupRows } from "./intent-followup-queue.js";
import { outboundOwnerAssignBody, outboundOwnerClearBody, renderOutboundOwnerPanel } from "./outbound-owner.js";

const shown = renderOutboundOwnerPanel({
  targetType: "customer",
  targetId: "c1",
  ownerAgentId: "agent@ccc-a",
  ownerAgentLabel: "Shirley坐席",
  canManage: false
});
assert.match(shown, /data-outbound-owner="1"/);
assert.match(shown, /data-owner-agent="agent@ccc-a"/);
assert.match(shown, /外呼负责坐席：Shirley坐席/);
assert.equal(shown.includes("保存负责坐席"), false);
assert.equal(shown.includes("拨号"), false);
assert.equal(shown.includes("<button"), false);

const form = renderOutboundOwnerPanel({
  targetType: "lead",
  targetId: "l1",
  ownerAgentId: "",
  canManage: true,
  agents: [{ agentId: "agent@ccc-a", displayName: "Shirley坐席" }]
});
assert.match(form, /data-outbound-owner-form="1"/);
assert.match(form, /data-target-type="lead"/);
assert.match(form, /未指派/);
assert.match(form, /保存负责坐席/);
assert.match(form, /不会拨号/);
assert.equal(form.includes("MakeCall"), false);
assert.equal(form.includes("/api/outbound-calls"), false);
assert.deepEqual(outboundOwnerAssignBody({ targetType: "customer", targetId: "c1", agentId: "agent@ccc-a" }), {
  targetType: "customer",
  targetId: "c1",
  agentId: "agent@ccc-a"
});
assert.deepEqual(outboundOwnerClearBody({ targetType: "prospect", targetId: "web_seed_1" }), {
  targetType: "prospect",
  targetId: "web_seed_1"
});

const rows = renderIntentFollowupRows([{
  targetType: "customer",
  targetId: "c-own",
  name: "负责客户",
  outcome: "有意向",
  agentLabel: "甲坐席",
  ownerAgentId: "agent@ccc-a",
  ownerAgentLabel: "Shirley坐席"
}], "");
assert.match(rows, /负责坐席/);
assert.match(rows, /data-owner-agent="agent@ccc-a"/);
assert.match(rows, /Shirley坐席/);
assert.equal(rows.includes("拨号"), false);
assert.match(renderIntentFollowupRows([{ targetType: "lead", targetId: "l1", outcome: "需回访" }], ""), /未指派/);
const mineEmpty = renderIntentFollowupQueue({ filters: { owner: "mine" }, items: [] });
assert.match(mineEmpty, /data-owner-filter-empty="1"/);
assert.match(mineEmpty, /没有我负责的对象/);
assert.equal(mineEmpty.includes(">0<"), false);
assert.equal(intentFollowupQuery({ owner: "mine" }), "?owner=mine");
assert.equal(intentFollowupQuery({}), "");
assert.equal(intentFollowupQuery({ owner: "all" }), "");

const reminders = renderCallbackReminderList([{
  targetType: "customer",
  targetId: "c1",
  name: "北欧",
  scheduledAt: "2026-11-01 10:00",
  due: "today",
  ownerAgentId: "agent@ccc-a",
  ownerAgentLabel: "Shirley坐席"
}]);
assert.match(reminders, /负责坐席 Shirley坐席/);
assert.match(reminders, /data-owner-agent="agent@ccc-a"/);
assert.match(reminders, /data-callback-open="intent-followup-queue"/);
assert.equal(reminders.includes("data-outbound-call"), false);
assert.equal(reminders.includes("MakeCall"), false);
assert.match(renderCallbackReminderList([{ targetType: "lead", targetId: "l1", name: "灯具", scheduledAt: "2026-11-01 10:00", due: "overdue" }]), /负责坐席 未指派/);

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /id="intentFollowupOwner"/);
assert.match(html, /id="dashboardCallbackScheduleOwner"/);
assert.match(html, /我负责的/);
const dashboardStart = html.indexOf('id="dashboardCallbackSchedules"');
const dashboardEnd = html.indexOf('id="kdBoard"', dashboardStart);
const dashboard = html.slice(dashboardStart, dashboardEnd);
assert.match(dashboard, /我负责的/);
assert.equal(dashboard.includes("data-outbound-call"), false);
assert.equal(dashboard.includes(">外呼<"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/outbound-owners/);
assert.match(api, /outboundOwnerAssignBody/);
assert.match(api, /outboundOwnerClearBody/);
assert.match(api, /renderOutboundOwnerPanel/);
assert.match(api, /data-outbound-owner-host/);
assert.match(api, /intentFollowupOwner/);
assert.match(api, /dashboardCallbackScheduleOwner/);
const saveStart = api.indexOf("async function saveOutboundOwner");
const saveEnd = api.indexOf("async function loadCallbackReminders", saveStart);
assert.ok(saveStart > 0 && saveEnd > saveStart);
const save = api.slice(saveStart, saveEnd);
assert.match(save, /\/api\/outbound-owners\/clear/);
assert.match(save, /\/api\/outbound-owners/);
assert.doesNotMatch(save, /\/api\/outbound-calls|MakeCall|aliyuncs/);

console.log("outbound owner frontend tests passed");
