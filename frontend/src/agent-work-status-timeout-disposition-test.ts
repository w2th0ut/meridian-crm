import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  agentWorkStatusTimeoutDispositionBody,
  agentWorkStatusTimeoutDispositionQuery,
  renderAgentWorkStatusTimeoutDispositionAgents,
  renderAgentWorkStatusTimeoutDispositions
} from "./agent-work-status-timeout-disposition.js";

assert.equal(agentWorkStatusTimeoutDispositionQuery({}), "");
assert.equal(agentWorkStatusTimeoutDispositionQuery({ from: "2026-11-04", to: "2026-11-04", disposition: "noted" }), "?from=2026-11-04&to=2026-11-04&disposition=noted");
assert.equal(agentWorkStatusTimeoutDispositionQuery({ from: "bad", disposition: "available" }), "");
assert.deepEqual(agentWorkStatusTimeoutDispositionBody({ agentId: "agent@ccc-a", disposition: "reminded", note: "已提醒" }), {
  agentId: "agent@ccc-a",
  disposition: "reminded",
  note: "已提醒"
});

const options = renderAgentWorkStatusTimeoutDispositionAgents([
  { agentId: "agent@ccc-a", label: "甲<script>", status: "break" }
], "agent@ccc-a");
assert.match(options, /甲&lt;script&gt;/);
assert.match(options, /value="agent@ccc-a" selected/);
assert.match(options, /小休/);

const html = renderAgentWorkStatusTimeoutDispositions({
  rowCount: 1,
  rows: [{
    id: "awstda_1",
    agentId: "agent@ccc-a",
    label: "甲<script>",
    status: "break",
    disposition: "noted",
    note: "=备注<script>",
    atText: "2026-11-04 10:31",
    elapsedSeconds: 1800,
    thresholdSeconds: 900,
    actorLabel: "主管<script>"
  }]
});
assert.match(html, /data-agent-work-status-timeout-disposition="1"/);
assert.match(html, /甲&lt;script&gt;/);
assert.match(html, /=备注&lt;script&gt;/);
assert.match(html, /主管&lt;script&gt;/);
assert.match(html, /备注/);
assert.match(html, /30分钟/);
assert.match(html, /15分钟/);
assert.match(html, /data-elapsed="1800"/);
assert.equal(html.includes("0秒"), false);
assert.equal(html.includes("接通率"), false);
assert.equal(html.includes("超时率"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(html), false);

const empty = renderAgentWorkStatusTimeoutDispositions({ rowCount: 0, rows: [] });
assert.match(empty, /data-agent-work-status-timeout-disposition-empty="1"/);
assert.equal(empty.includes(">0<"), false);
assert.equal(empty.includes("0秒"), false);

const missing = renderAgentWorkStatusTimeoutDispositions({
  rows: [{ agentId: "agent@ccc-a", label: "甲", elapsedSeconds: null, thresholdSeconds: null, atText: "" }]
});
assert.match(missing, /data-elapsed="—"/);
assert.match(missing, /data-threshold="—"/);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = page.indexOf('id="dashboardAgentWorkStatusTimeoutDisposition"');
const end = page.indexOf('id="kdBoard"', start);
const timeout = page.indexOf('id="dashboardAgentWorkStatusTimeout"');
assert.equal(timeout > 0 && start > timeout && end > start, true);
const view = page.slice(start, end);
assert.match(view, /坐席状态超时处置/);
assert.match(view, /hidden/);
assert.match(view, /id="dashboardAgentWorkStatusTimeoutDispositionView"/);
assert.match(view, /id="dashboardAgentWorkStatusTimeoutDispositionAgent"/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);
assert.equal(view.includes("MakeCall"), false);
assert.equal(view.includes("aliyuncs.com"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/agent-work-status-timeout-dispositions/);
assert.match(api, /renderAgentWorkStatusTimeoutDispositions/);
const refreshStart = api.indexOf("async function refreshDashboardOnly");
const refreshEnd = api.indexOf("function requestDashboardRefresh", refreshStart);
assert.equal(refreshStart > 0 && refreshEnd > refreshStart, true);
assert.equal(api.slice(refreshStart, refreshEnd).includes("/api/agent-work-status-timeout-dispositions"), false);
const loadStart = api.indexOf("async function loadAgentWorkStatusTimeoutDispositions");
const loadEnd = api.indexOf("async function syncCampaignRoster", loadStart);
assert.equal(loadStart > 0 && loadEnd > loadStart, true);
const load = api.slice(loadStart, loadEnd);
assert.equal(load.includes("aliyuncs.com"), false);
assert.equal(load.includes("MakeCall"), false);
assert.equal(load.includes("/api/outbound-calls"), false);
assert.equal(load.includes("setInterval"), false);
assert.equal(load.includes("mailto:"), false);
assert.equal(load.includes("WebSocket"), false);

console.log("agent work status timeout disposition frontend tests passed");
