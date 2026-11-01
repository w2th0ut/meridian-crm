import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readAgentWorkStatusInput, renderAgentWorkStatusSummary } from "./agent-work-status.js";
import { renderCallWorkload } from "./call-workload.js";

const empty = readAgentWorkStatusInput("available", "  ");
assert.equal(empty.ok, true);
assert.equal(empty.ok && empty.reason, "");
assert.equal(readAgentWorkStatusInput("ON_SITE", "").ok, false);
assert.equal(readAgentWorkStatusInput("busy", "x".repeat(201)).ok, false);

const summary = renderAgentWorkStatusSummary({
  status: "busy",
  reason: "<午饭>",
  availableSeconds: 0,
  busySeconds: 120,
  breakSeconds: null
});
assert.match(summary, /data-agent-work-status="busy"/);
assert.match(summary, /忙碌/);
assert.match(summary, /&lt;午饭&gt;/);
assert.match(summary, /0秒/);
assert.match(summary, /120秒/);
assert.match(summary, /小休 —/);
assert.equal(summary.includes("<午饭>"), false);
assert.match(renderAgentWorkStatusSummary(null), /data-agent-work-status-empty/);

const html = renderCallWorkload({
  scope: "team",
  canResetWorkStatus: true,
  metrics: {
    callsMade: true,
    workStatus: true,
    availableSeconds: true,
    busySeconds: true,
    breakSeconds: true
  },
  rows: [
    {
      agentId: "agent@ccc-a",
      label: "=甲<script>",
      callsMade: 2,
      workStatus: "break",
      workStatusReason: "<休息>",
      availableSeconds: 0,
      busySeconds: null,
      breakSeconds: 30
    },
    {
      agentId: "none",
      label: "未分配坐席",
      callsMade: 0,
      workStatus: null,
      availableSeconds: null,
      busySeconds: null,
      breakSeconds: null
    }
  ]
});
assert.match(html, /data-workload-workStatus="小休"/);
assert.match(html, /data-workload-availableSeconds="0秒"/);
assert.match(html, /data-workload-busySeconds="—"/);
assert.match(html, /data-workload-breakSeconds="30秒"/);
assert.match(html, /data-workload-workStatus="—"/);
assert.match(html, /data-agent-work-status-reset="agent@ccc-a"/);
assert.match(html, /改回状态/);
assert.match(html, /&lt;休息&gt;/);
assert.equal(html.includes('data-agent-work-status-reset="none"'), false);
assert.equal(html.includes("<script>"), false);
assert.equal(html.includes("<休息>"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(html), false);

const readonly = renderCallWorkload({
  scope: "self",
  canResetWorkStatus: false,
  metrics: { workStatus: true, availableSeconds: true },
  rows: [{ agentId: "agent@ccc-a", label: "甲", workStatus: null, availableSeconds: null }]
});
assert.match(readonly, /data-workload-workStatus="—"/);
assert.match(readonly, /data-workload-availableSeconds="—"/);
assert.equal(readonly.includes("data-agent-work-status-reset"), false);
assert.equal(readonly.includes("0秒"), false);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = page.indexOf('id="dashboardCallWorkload"');
const end = page.indexOf('id="dashboardCallWrapupEditReport"', start);
assert.equal(start > 0 && end > start, true);
const view = page.slice(start, end);
assert.match(view, /id="dashboardAgentWorkStatusForm"/);
assert.match(view, /保存我的状态/);
assert.match(view, /可接听/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);
const softphone = page.slice(page.indexOf('id="cccSoftphone"'), page.indexOf('id="cccScreenPopStack"'));
assert.match(softphone, /id="cccAgentWorkStatusForm"/);
assert.match(softphone, /id="cccAgentWorkStatusSummary"/);
assert.match(softphone, /点开软电话后显示本地工作状态/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const refreshStart = api.indexOf("async function refreshCccSoftphone");
const refreshEnd = api.indexOf("const aiEngineSourceMeta", refreshStart);
assert.equal(refreshStart > 0 && refreshEnd > refreshStart, true);
assert.equal(api.slice(refreshStart, refreshEnd).includes("/api/agent-work-status"), false);
const toggle = api.indexOf('"#cccSoftphoneToggle"');
assert.equal(toggle > 0, true);
assert.match(api.slice(toggle, toggle + 700), /loadCccAgentWorkStatus/);
assert.match(api, /\/api\/agent-work-status\/reset/);
const loadStart = api.indexOf("async function loadCallWorkload");
const loadEnd = api.indexOf("async function exportCallWrapupEditReport", loadStart);
assert.equal(api.slice(loadStart, loadEnd).includes("aliyuncs.com"), false);
assert.equal(api.slice(loadStart, loadEnd).includes("MakeCall"), false);

const moduleSource = readFileSync(new URL("./agent-work-status.ts", import.meta.url), "utf8");
assert.equal(moduleSource.includes("aliyuncs.com"), false);
assert.equal(moduleSource.includes("MakeCall"), false);
assert.equal(moduleSource.includes("fetch("), false);

console.log("agent work status frontend tests passed");
