import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { callWorkloadQuery, readWrapupTargetCount, renderCallWorkload } from "./call-workload.js";

assert.equal(callWorkloadQuery({ scope: "self" }), "?scope=self");
assert.equal(callWorkloadQuery({ scope: "team", agentId: "agent@ccc-a" }), "?scope=team&agentId=agent%40ccc-a");

const html = renderCallWorkload({
  scope: "team",
  today: "2026-04-04",
  metrics: {
    callsMade: true,
    wrapupCompleted: true,
    wrapupPending: true,
    wrapupSkipped: true,
    correctionsMade: true,
    talkTimeSeconds: true
  },
  rows: [
    {
      agentId: "agent@ccc-a",
      label: "=甲<script>",
      callsMade: 2,
      wrapupCompleted: 1,
      wrapupPending: 0,
      wrapupSkipped: 0,
      correctionsMade: 1,
      talkTimeSeconds: null
    },
    {
      agentId: "none",
      label: "未分配坐席",
      callsMade: 0,
      wrapupCompleted: 0,
      wrapupPending: 0,
      wrapupSkipped: 0,
      correctionsMade: 0,
      talkTimeSeconds: 0
    }
  ]
});
assert.match(html, /data-call-workload="1"/);
assert.match(html, /data-call-workload-today="2026-04-04"/);
assert.match(html, /团队/);
assert.match(html, /data-call-workload-row="agent@ccc-a"/);
assert.match(html, /data-workload-callsMade="2"/);
assert.match(html, /data-workload-wrapupPending="0"/);
assert.match(html, /data-workload-talkTimeSeconds="—"/);
assert.match(html, /data-workload-talkTimeSeconds="0秒"/);
assert.match(html, /=甲&lt;script&gt;/);
assert.equal(html.includes("<script>"), false);
assert.equal(html.includes("接通率"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(html), false);

const missing = renderCallWorkload({
  scope: "self",
  metrics: { callsMade: true },
  rows: [{ agentId: "agent@ccc-a", label: "甲", callsMade: null, talkTimeSeconds: 8 }]
});
assert.match(missing, /data-workload-callsMade="—"/);
assert.equal(missing.includes("通话时长"), false);
assert.equal(missing.includes("0秒"), false);
assert.equal(missing.includes("data-workload-talkTimeSeconds"), false);

const progress = renderCallWorkload({
  scope: "team",
  canEditWrapupTarget: true,
  metrics: { callsMade: true, wrapupCompleted: true, callsTarget: true, wrapupTarget: true },
  rows: [
    { agentId: "agent@ccc-a", label: "甲", callsMade: 2, wrapupCompleted: 1, callsTarget: 20, wrapupTarget: null },
    { agentId: "none", label: "未分配坐席", callsMade: 1, wrapupCompleted: 0, callsTarget: null, wrapupTarget: 3 }
  ]
});
assert.match(progress, /人工拨打\/拨打目标/);
assert.match(progress, /小结完成\/小结目标/);
assert.match(progress, /data-workload-callsTarget="2\/20"/);
assert.match(progress, /data-workload-wrapupTarget="—"/);
assert.match(progress, /data-call-wrapup-target-form="agent@ccc-a"/);
assert.match(progress, /保存小结目标/);
assert.equal(progress.includes('data-call-wrapup-target-form="none"'), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(progress), false);

const zeroTarget = renderCallWorkload({
  scope: "self",
  canEditWrapupTarget: false,
  metrics: { callsTarget: true, wrapupTarget: true },
  rows: [{ agentId: "agent@ccc-a", label: "甲", callsMade: 0, wrapupCompleted: 0, callsTarget: 0, wrapupTarget: 0 }]
});
assert.match(zeroTarget, /data-workload-callsTarget="0\/0"/);
assert.match(zeroTarget, /data-workload-wrapupTarget="0\/0"/);
assert.equal(zeroTarget.includes("data-call-wrapup-target-form"), false);

const emptyWrap = readWrapupTargetCount("");
assert.equal(emptyWrap.ok, true);
assert.equal(emptyWrap.ok && emptyWrap.wrapupTarget, null);
const zeroWrap = readWrapupTargetCount("0");
assert.equal(zeroWrap.ok, true);
assert.equal(zeroWrap.ok && zeroWrap.wrapupTarget, 0);
assert.equal(readWrapupTargetCount("10000").ok, true);
assert.equal(readWrapupTargetCount("10001").ok, false);
assert.equal(readWrapupTargetCount("1.5").ok, false);

assert.match(renderCallWorkload({ scope: "self", unmapped: true, metrics: { callsMade: true }, rows: [] }), /data-call-workload-unmapped/);
assert.match(renderCallWorkload({ scope: "team", metrics: { callsMade: true }, rows: [] }), /data-call-workload-empty/);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = page.indexOf('id="dashboardCallWorkload"');
const end = page.indexOf('id="dashboardCallWrapupEditReport"', start);
assert.equal(start > 0 && end > start, true);
const view = page.slice(start, end);
assert.match(view, /今日通话负荷/);
assert.match(view, /id="dashboardCallWorkloadSelf"/);
assert.match(view, /id="dashboardCallWorkloadTeam"/);
assert.match(view, /hidden/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);
assert.equal(view.includes("MakeCall"), false);
assert.match(page, /call-workload-table/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/call-workload/);
assert.match(api, /renderCallWorkload/);
assert.match(api, /callWorkloadQuery/);
const gate = api.indexOf("function canViewCallWorkloadTeam");
assert.equal(gate > 0, true);
assert.match(api.slice(gate, gate + 280), /role === "manager"/);
assert.match(api.slice(gate, gate + 280), /role === "admin"/);
assert.match(api.slice(gate, gate + 280), /super_admin/);
const dashStart = api.indexOf("async function loadDashboardCallScripts");
const dashEnd = api.indexOf("async function loadCallWorkload");
assert.equal(dashStart > 0 && dashEnd > dashStart, true);
assert.equal(api.slice(dashStart, dashEnd).includes("/api/call-workload"), false);
const loadStart = api.indexOf("async function loadCallWorkload");
const loadEnd = api.indexOf("async function exportCallWrapupEditReport", loadStart);
assert.equal(loadStart > 0 && loadEnd > loadStart, true);
assert.equal(api.slice(loadStart, loadEnd).includes("aliyuncs.com"), false);
assert.equal(api.slice(loadStart, loadEnd).includes("MakeCall"), false);
assert.match(api.slice(loadStart, loadEnd), /\/api\/agent-call-targets/);
assert.match(api.slice(loadStart, loadEnd), /wrapupTarget/);

console.log("call workload frontend tests passed");
