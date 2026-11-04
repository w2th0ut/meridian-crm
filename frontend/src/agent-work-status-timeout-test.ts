import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  agentWorkStatusTimeoutQuery,
  formatAgentWorkStatusTimeoutAge,
  formatAgentWorkStatusTimeoutThreshold,
  renderAgentWorkStatusTimeouts
} from "./agent-work-status-timeout.js";

assert.equal(formatAgentWorkStatusTimeoutAge(null), "—");
assert.equal(formatAgentWorkStatusTimeoutAge(-1), "—");
assert.equal(formatAgentWorkStatusTimeoutAge(0), "0秒");
assert.equal(formatAgentWorkStatusTimeoutAge(59), "59秒");
assert.equal(formatAgentWorkStatusTimeoutAge(60), "1分钟");
assert.equal(formatAgentWorkStatusTimeoutAge(119), "1分钟");
assert.equal(formatAgentWorkStatusTimeoutAge(3600), "1小时");
assert.equal(formatAgentWorkStatusTimeoutAge(86400), "1天");
assert.equal(formatAgentWorkStatusTimeoutThreshold(null), "未设置");
assert.equal(formatAgentWorkStatusTimeoutThreshold(0), "未设置");
assert.equal(formatAgentWorkStatusTimeoutThreshold(59), "未设置");
assert.equal(formatAgentWorkStatusTimeoutThreshold(900), "15分钟");
assert.equal(agentWorkStatusTimeoutQuery(""), "");
assert.equal(agentWorkStatusTimeoutQuery("break"), "?status=break");
assert.equal(agentWorkStatusTimeoutQuery("available"), "");

const html = renderAgentWorkStatusTimeouts({
  thresholds: { break: 900, busy: null },
  rowCount: 1,
  rows: [
    {
      id: "awsl_break",
      agentId: "agent@ccc-a",
      label: "甲<script>",
      status: "break",
      reason: "=小休",
      sinceText: "2026-11-04 10:00",
      elapsedSeconds: 1800,
      thresholdSeconds: 900
    }
  ]
});
assert.match(html, /data-agent-work-status-timeout="1"/);
assert.match(html, /甲&lt;script&gt;/);
assert.match(html, /data-agent-work-status-timeout-break="15分钟"/);
assert.match(html, /data-agent-work-status-timeout-busy="未设置"/);
assert.match(html, /data-elapsed="1800"/);
assert.match(html, /30分钟/);
assert.match(html, /=小休/);
assert.match(html, /小休/);
assert.equal(html.includes("0秒"), false);
assert.equal(html.includes("接通率"), false);
assert.equal(html.includes("超时率"), false);
assert.equal(html.includes("MakeCall"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(html), false);

const empty = renderAgentWorkStatusTimeouts({
  thresholds: { break: null, busy: null },
  rowCount: 0,
  rows: []
});
assert.match(empty, /data-agent-work-status-timeout-empty="1"/);
assert.match(empty, /未设置/);
assert.equal(empty.includes("0秒"), false);
assert.equal(empty.includes(">0<"), false);

const missing = renderAgentWorkStatusTimeouts({
  rows: [{ agentId: "agent@ccc-a", label: "甲", status: "busy", elapsedSeconds: null, thresholdSeconds: null }]
});
assert.match(missing, /data-elapsed="—"/);
assert.match(missing, /data-threshold="—"/);
assert.equal(missing.includes("0秒"), false);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = page.indexOf('id="dashboardAgentWorkStatusTimeout"');
const end = page.indexOf('id="kdBoard"', start);
assert.equal(start > 0 && end > start, true);
const view = page.slice(start, end);
assert.match(view, /坐席状态超时/);
assert.match(view, /hidden/);
assert.match(view, /id="dashboardAgentWorkStatusTimeoutView"/);
assert.match(view, /id="dashboardAgentWorkStatusTimeoutSeconds"/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);
assert.equal(view.includes("MakeCall"), false);
assert.equal(view.includes("aliyuncs.com"), false);
const report = page.slice(page.indexOf('id="dashboardAgentWorkStatusReport"'), start);
assert.match(report, /坐席工作状态时长/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/agent-work-status-timeouts/);
assert.match(api, /renderAgentWorkStatusTimeouts/);
const gate = api.indexOf("function canViewAgentWorkStatusTimeout");
assert.equal(gate > 0, true);
assert.match(api.slice(gate, gate + 280), /role === "manager"/);
const refreshStart = api.indexOf("async function refreshDashboardOnly");
const refreshEnd = api.indexOf("function requestDashboardRefresh", refreshStart);
assert.equal(refreshStart > 0 && refreshEnd > refreshStart, true);
assert.equal(api.slice(refreshStart, refreshEnd).includes("/api/agent-work-status-timeouts"), false);
const loadStart = api.indexOf("async function loadAgentWorkStatusTimeouts");
const loadEnd = api.indexOf("async function syncCampaignRoster", loadStart);
assert.equal(loadStart > 0 && loadEnd > loadStart, true);
const load = api.slice(loadStart, loadEnd);
assert.equal(load.includes("aliyuncs.com"), false);
assert.equal(load.includes("MakeCall"), false);
assert.equal(load.includes("/api/outbound-calls"), false);
assert.equal(load.includes("setInterval"), false);
assert.equal(load.includes("mailto:"), false);
assert.equal(load.includes("WebSocket"), false);

console.log("agent work status timeout frontend tests passed");
