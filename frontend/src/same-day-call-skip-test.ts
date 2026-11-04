import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  renderSameDayCallSkipControl,
  renderSameDayCallSkipEmpty,
  renderSameDayCallSkips,
  sameDayCallSkipQuery
} from "./same-day-call-skip.js";

assert.equal(sameDayCallSkipQuery({ scope: "mine" }), "?scope=mine");
assert.equal(sameDayCallSkipQuery({ scope: "team" }), "?scope=team");

const control = renderSameDayCallSkipControl("customer", "c1");
assert.match(control, /data-same-day-call-skip="1"/);
assert.match(control, /data-target-type="customer"/);
assert.match(control, /data-target-id="c1"/);
assert.match(control, /data-same-day-skip-reason="1"/);
assert.match(control, /今天已经联系上/);
assert.match(control, /对方要求改日再打/);
assert.match(control, /现在不方便/);
assert.match(control, /data-same-day-skip-set="1"/);
assert.equal(control.includes("data-outbound-call"), false);
assert.equal(control.includes("/api/outbound-calls"), false);
assert.equal(control.includes("MakeCall"), false);

const html = renderSameDayCallSkips({
  scope: "team",
  items: [
    {
      targetType: "customer",
      targetId: "c1",
      targetLabel: "客户",
      name: "Nordic <Tools>",
      reason: "reached",
      reasonLabel: "今天已经联系上",
      note: "改日 <再打>",
      skipOn: "2026-11-04",
      actorLabel: "Shirley",
      updatedAt: "2026-11-04T04:00:00.000Z"
    },
    {
      targetType: "lead",
      targetId: "l2",
      targetLabel: "线索",
      name: "灯具",
      reasonLabel: "",
      note: "   ",
      actorLabel: "",
      updatedAt: ""
    }
  ]
});
assert.match(html, /data-same-day-call-skip-list="1"/);
assert.match(html, /data-same-day-call-skip-row="1"/);
assert.match(html, /Nordic &lt;Tools&gt;/);
assert.match(html, /改日 &lt;再打&gt;/);
assert.match(html, /data-same-day-call-skip-open="1"/);
assert.match(html, /data-same-day-call-skip-clear="1"/);
assert.match(html, /今天已经联系上/);
assert.match(html, /data-same-day-call-skip-note="1">—/);
assert.match(html, /data-same-day-call-skip-at="1">—/);
assert.match(html, /Shirley/);
assert.equal(html.includes("data-outbound-call"), false);
assert.equal(html.includes("MakeCall"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(html), false);
assert.equal((html.match(/data-same-day-call-skip-row="1"/g) || []).length, 2);
assert.match(renderSameDayCallSkipEmpty(), /data-same-day-call-skip-empty="1"/);
assert.equal(renderSameDayCallSkips({ items: [] }).includes(">0<"), false);
assert.equal(renderSameDayCallSkips(undefined).includes(">0<"), false);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = page.indexOf('id="dashboardSameDayCallSkip"');
const end = page.indexOf('id="dashboardAgentWorkStatusReport"', start);
assert.equal(start > 0 && end > start, true);
const view = page.slice(start, end);
assert.match(view, /今日不再拨/);
assert.match(view, /hidden/);
assert.match(view, /id="dashboardSameDayCallSkipMine"/);
assert.match(view, /id="dashboardSameDayCallSkipTeam"/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);
assert.equal(view.includes("MakeCall"), false);
assert.equal(view.includes("data-outbound-call"), false);
const previous = page.slice(page.indexOf('id="dashboardUnlabeledConnectedFollowup"'), start);
assert.match(previous, /已接通未标注还没有下次跟进/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /renderSameDayCallSkipControl\(first\.targetType, first\.targetId\)/);
assert.match(api, /\/api\/same-day-call-skips/);
assert.match(api, /\/api\/same-day-call-skips\/clear/);
assert.match(api, /renderSameDayCallSkips/);
assert.match(api, /openCallbackDueObject/);
const gate = api.indexOf("function canViewSameDayCallSkipTeam");
assert.equal(gate > 0, true);
assert.match(api.slice(gate, gate + 280), /role === "manager"/);
const refreshStart = api.indexOf("async function refreshDashboardOnly");
const refreshEnd = api.indexOf("function requestDashboardRefresh", refreshStart);
assert.equal(refreshStart > 0 && refreshEnd > refreshStart, true);
assert.equal(api.slice(refreshStart, refreshEnd).includes("/api/same-day-call-skips"), false);
const loadStart = api.indexOf("async function loadSameDayCallSkips");
const loadEnd = api.indexOf("function markSameDayCallSkipped", loadStart);
assert.equal(loadStart > 0 && loadEnd > loadStart, true);
assert.equal(api.slice(loadStart, loadEnd).includes("aliyuncs.com"), false);
assert.equal(api.slice(loadStart, loadEnd).includes("MakeCall"), false);
assert.equal(api.slice(loadStart, loadEnd).includes('"/api/outbound-calls"'), false);
const submitStart = api.indexOf("async function submitSameDayCallSkip");
const submitEnd = api.indexOf("async function clearSameDayCallSkip", submitStart);
assert.equal(submitStart > 0 && submitEnd > submitStart, true);
assert.match(api.slice(submitStart, submitEnd), /\/api\/same-day-call-skips/);
assert.equal(api.slice(submitStart, submitEnd).includes('"/api/outbound-calls"'), false);

console.log("same-day call skip frontend tests passed");
