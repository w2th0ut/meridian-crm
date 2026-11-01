import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  agentCallTargetSetBody,
  formatAgentCallProgress,
  readAgentCallTargetCounts,
  renderAgentCallTargetList,
  renderAgentCallTargetOptions
} from "./agent-call-target.js";

const row = {
  agentId: "agent@ccc-a",
  displayName: "Shirley坐席",
  dialed: 6,
  connected: 4,
  intent: 1,
  dialTarget: 20,
  connectedTarget: 8,
  intentTarget: null as number | null
};
assert.equal(formatAgentCallProgress(row), "Shirley坐席：已拨 6/20，接通 4/8，意向 1（未设目标）");
assert.equal(formatAgentCallProgress({ ...row, dialTarget: null, connectedTarget: null, intentTarget: 3, dialed: 0, connected: 0, intent: 0 }), "Shirley坐席：已拨 0（未设目标），接通 0（未设目标），意向 0/3");

const list = renderAgentCallTargetList([row]);
assert.match(list, /data-agent-call-target="agent@ccc-a"/);
assert.match(list, /已拨 6\/20/);
assert.equal(list.includes("<button"), false);
assert.equal(list.includes("外呼"), false);
assert.match(renderAgentCallTargetList([]), /data-agent-call-target-empty/);
assert.match(renderAgentCallTargetOptions([row], "agent@ccc-a"), /selected/);

const counts = readAgentCallTargetCounts("20", "8", "");
assert.equal(counts.ok && counts.intentTarget, null);
assert.equal(readAgentCallTargetCounts("0", "10000", "0").ok, true);
assert.equal(readAgentCallTargetCounts("10001", "1", "").ok, false);
assert.equal(readAgentCallTargetCounts("1.5", "1", "").ok, false);
assert.equal(readAgentCallTargetCounts("", "1", "").ok, false);
assert.deepEqual(agentCallTargetSetBody({ agentId: "agent@ccc-a", dialTarget: 20, connectedTarget: 8, intentTarget: null }), {
  agentId: "agent@ccc-a",
  dialTarget: 20,
  connectedTarget: 8,
  intentTarget: null
});

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const viewStart = page.indexOf('id="dashboardAgentCallTargets"');
const viewEnd = page.indexOf('id="dashboardAcquisitionTodoSummary"');
assert.equal(viewStart > 0, true);
assert.equal(viewEnd > viewStart, true);
const view = page.slice(viewStart, viewEnd);
assert.match(view, /今日外呼进度/);
assert.match(view, /Asia\/Shanghai/);
assert.match(view, /EstablishedTime/);
assert.match(view, /有意向/);
assert.match(view, /不会自动拨号/);
assert.match(view, /id="dashboardAgentCallTargetList"/);
assert.match(view, /id="dashboardAgentCallTargetForm" hidden/);
assert.match(view, /保存目标/);
assert.match(view, /清除目标/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);
assert.equal(view.includes("mailto:"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const loadStart = api.indexOf("function bindDashboardAgentCallTargets");
const loadEnd = api.indexOf("async function loadBadges", loadStart);
assert.equal(loadStart > 0, true);
const body = api.slice(loadStart, loadEnd);
assert.match(body, /\/api\/agent-call-targets/);
assert.match(body, /agentCallTargetSetBody/);
assert.match(body, /renderAgentCallTargetList/);
assert.match(body, /intentTarget: counts\.intentTarget/);
assert.match(body, /\/api\/agent-call-targets\/clear/);
assert.match(api, /loadDashboardAgentCallTargets\(\)/);
assert.equal(body.includes("aliyuncs.com"), false);
assert.equal(body.includes("requestOutboundCall"), false);
assert.equal(body.includes("MakeCall"), false);

console.log("agent call target frontend tests passed");
