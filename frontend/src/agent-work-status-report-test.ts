import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  agentWorkStatusReportQuery,
  formatAgentWorkStatusReportDuration,
  renderAgentWorkStatusReport
} from "./agent-work-status-report.js";

assert.equal(formatAgentWorkStatusReportDuration(null), "—");
assert.equal(formatAgentWorkStatusReportDuration(0), "0秒");
assert.equal(formatAgentWorkStatusReportDuration(59), "59秒");
assert.equal(formatAgentWorkStatusReportDuration(60), "1分钟");
assert.equal(formatAgentWorkStatusReportDuration(90), "1分钟30秒");
assert.equal(formatAgentWorkStatusReportDuration(600), "10分钟");
assert.equal(agentWorkStatusReportQuery({}), "");
assert.equal(agentWorkStatusReportQuery({ from: "2026-11-04", to: "2026-11-04", agentId: "agent@ccc-a" }), "?from=2026-11-04&to=2026-11-04&agentId=agent%40ccc-a");

const html = renderAgentWorkStatusReport({
  today: "2026-11-04",
  metrics: { available: true, busy: true, break: true },
  rowCount: 2,
  agents: [
    {
      agentId: "agent@ccc-a",
      label: "甲<script>",
      availableSeconds: 600,
      busySeconds: 0,
      breakSeconds: null
    },
    {
      agentId: "agent@ccc-b",
      label: "乙",
      availableSeconds: null,
      busySeconds: null,
      breakSeconds: null
    }
  ],
  timeline: [
    {
      id: "awsl_break",
      kind: "change",
      at: "2026-11-04T02:00:00.000Z",
      status: "break",
      source: "manager",
      reason: "=休息",
      actorLabel: "主管",
      previousStatus: "busy",
      counted: true
    },
    {
      id: "awsa_reject",
      kind: "rejected",
      at: "2026-11-04T01:00:00.000Z",
      status: "available",
      source: "manager",
      reason: "",
      actorLabel: "主管",
      previousStatus: "",
      counted: false
    }
  ]
});
assert.match(html, /data-agent-work-status-report="1"/);
assert.match(html, /甲&lt;script&gt;/);
assert.match(html, /data-available="600"/);
assert.match(html, /10分钟/);
assert.match(html, /data-busy="0"/);
assert.match(html, /0秒/);
assert.match(html, /data-break="—"/);
assert.match(html, /data-agent-work-status-report-agent="agent@ccc-b"/);
assert.match(html, /data-available="—"/);
assert.match(html, /data-agent-work-status-report-open="agent@ccc-a"/);
assert.match(html, /变更时间线/);
assert.match(html, /data-agent-work-status-report-timeline="1"/);
assert.match(html, /data-previous="1">忙碌/);
assert.match(html, /=休息/);
assert.match(html, /data-counted="否"/);
assert.match(html, /未生效的改回/);
assert.match(html, /只看汇总/);
assert.equal(html.includes("接通率"), false);
assert.equal(html.includes("利用率"), false);
assert.equal(html.includes("MakeCall"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(html), false);

const missing = renderAgentWorkStatusReport({
  metrics: {},
  agents: [{ agentId: "agent@ccc-a", label: "甲", availableSeconds: 0, busySeconds: 0, breakSeconds: 0 }]
});
assert.match(missing, /data-available="—"/);
assert.equal(missing.includes("0秒"), false);
assert.match(missing, /data-agent-work-status-report-rows="—"/);
assert.match(missing, /data-agent-work-status-report-today="—"/);
assert.equal(missing.includes("data-agent-work-status-report-timeline"), false);

const emptyTimeline = renderAgentWorkStatusReport({
  metrics: { available: true, busy: true, break: true },
  rowCount: 0,
  agents: [],
  timeline: []
});
assert.match(emptyTimeline, /data-agent-work-status-report-empty="1"/);
assert.match(emptyTimeline, /data-agent-work-status-report-timeline-empty="1"/);
assert.equal(emptyTimeline.includes("0秒"), false);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = page.indexOf('id="dashboardAgentWorkStatusReport"');
const end = page.indexOf('id="kdBoard"', start);
assert.equal(start > 0 && end > start, true);
const view = page.slice(start, end);
assert.match(view, /坐席工作状态时长/);
assert.match(view, /hidden/);
assert.match(view, /id="dashboardAgentWorkStatusReportFrom"/);
assert.match(view, /id="dashboardAgentWorkStatusReportExport"/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);
assert.equal(view.includes("MakeCall"), false);
const queue = page.slice(page.indexOf('id="dashboardUnansweredPendingQueue"'), start);
assert.match(queue, /未接通待处理/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/agent-work-status-report/);
assert.match(api, /\/api\/agent-work-status-report\/export/);
assert.match(api, /renderAgentWorkStatusReport/);
assert.match(api, /坐席工作状态时长\.csv/);
const gate = api.indexOf("function canViewAgentWorkStatusReport");
assert.equal(gate > 0, true);
assert.match(api.slice(gate, gate + 240), /role === "manager"/);
const refreshStart = api.indexOf("async function refreshDashboardOnly");
const refreshEnd = api.indexOf("function requestDashboardRefresh", refreshStart);
assert.equal(refreshStart > 0 && refreshEnd > refreshStart, true);
assert.equal(api.slice(refreshStart, refreshEnd).includes("/api/agent-work-status-report"), false);
const loadStart = api.indexOf("async function loadAgentWorkStatusReport");
const loadEnd = api.indexOf("async function syncCampaignRoster", loadStart);
assert.equal(loadStart > 0 && loadEnd > loadStart, true);
assert.equal(api.slice(loadStart, loadEnd).includes("aliyuncs.com"), false);
assert.equal(api.slice(loadStart, loadEnd).includes("MakeCall"), false);
assert.equal(api.slice(loadStart, loadEnd).includes("/api/outbound-calls"), false);

console.log("agent work status report frontend tests passed");
