import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  outboundCallHoldQuery,
  renderOutboundCallHoldControl,
  renderOutboundCallHoldEmpty,
  renderOutboundCallHolds
} from "./outbound-call-hold.js";

assert.equal(outboundCallHoldQuery({ scope: "mine" }), "?scope=mine");
assert.equal(outboundCallHoldQuery({ scope: "team" }), "?scope=team");

const control = renderOutboundCallHoldControl("customer", "c1");
assert.match(control, /data-call-hold="1"/);
assert.match(control, /data-call-hold-until="1"/);
assert.match(control, /data-call-hold-reason="1"/);
assert.match(control, /约了以后再联系/);
assert.match(control, /先走别的渠道/);
assert.match(control, /同事正在跟/);
assert.match(control, /data-call-hold-set="1"/);
assert.match(control, /记下暂停/);
assert.equal(control.includes("data-outbound-call"), false);
assert.equal(control.includes("MakeCall"), false);

const html = renderOutboundCallHolds({
  scope: "team",
  items: [
    {
      targetType: "customer",
      targetId: "c1",
      targetLabel: "客户",
      name: "甲<公司>",
      reasonLabel: "约了以后再联系",
      note: "",
      untilOn: "2026-11-06",
      actorLabel: "Shirley",
      updatedAt: ""
    },
    {
      targetType: "lead",
      targetId: "l1",
      name: "乙",
      reasonLabel: "同事正在跟",
      note: "=备注",
      untilOn: "2026-12-01",
      actorLabel: "Alex",
      updatedAt: "not-a-date"
    }
  ]
});
assert.match(html, /data-call-hold-list="1"/);
assert.match(html, /data-call-hold-row="1"/);
assert.match(html, /甲&lt;公司&gt;/);
assert.match(html, /data-call-hold-open="1"/);
assert.match(html, /data-call-hold-clear="1"/);
assert.match(html, /data-call-hold-until="1">2026-11-06/);
assert.match(html, /data-call-hold-note="1">—/);
assert.match(html, /data-call-hold-at="1">—/);
assert.match(html, /=备注/);
assert.equal(html.includes("data-outbound-call"), false);
assert.equal(html.includes("MakeCall"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(html), false);
assert.equal((html.match(/data-call-hold-row="1"/g) || []).length, 2);
assert.match(renderOutboundCallHoldEmpty(), /data-call-hold-empty="1"/);
assert.equal(renderOutboundCallHolds({ items: [] }).includes(">0<"), false);
assert.equal(renderOutboundCallHolds(undefined).includes(">0<"), false);
assert.match(renderOutboundCallHolds({ items: [{ targetType: "customer", targetId: "c9", untilOn: "tomorrow" }] }), /data-call-hold-until="1">—/);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = page.indexOf('id="dashboardOutboundCallHold"');
const end = page.indexOf('id="dashboardAgentWorkStatusReport"', start);
assert.equal(start > 0 && end > start, true);
const view = page.slice(start, end);
assert.match(view, /暂停外呼直到指定日/);
assert.match(view, /hidden/);
assert.match(view, /id="dashboardOutboundCallHoldMine"/);
assert.match(view, /id="dashboardOutboundCallHoldTeam"/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);
assert.equal(view.includes("MakeCall"), false);
assert.equal(view.includes("data-outbound-call"), false);
const previous = page.slice(page.indexOf('id="dashboardSameDayCallSkip"'), start);
assert.match(previous, /今日不再拨/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /renderOutboundCallHoldControl\(first\.targetType, first\.targetId\)/);
assert.match(api, /\/api\/outbound-call-holds/);
assert.match(api, /\/api\/outbound-call-holds\/clear/);
assert.match(api, /renderOutboundCallHolds/);
assert.match(api, /openCallbackDueObject/);
const gate = api.indexOf("function canViewOutboundCallHoldTeam");
assert.equal(gate > 0, true);
assert.match(api.slice(gate, gate + 280), /role === "manager"/);
const refreshStart = api.indexOf("async function refreshDashboardOnly");
const refreshEnd = api.indexOf("function requestDashboardRefresh", refreshStart);
assert.equal(refreshStart > 0 && refreshEnd > refreshStart, true);
assert.equal(api.slice(refreshStart, refreshEnd).includes("/api/outbound-call-holds"), false);
const loadStart = api.indexOf("async function loadOutboundCallHolds");
const loadEnd = api.indexOf("function markOutboundCallHeld", loadStart);
assert.equal(loadStart > 0 && loadEnd > loadStart, true);
assert.equal(api.slice(loadStart, loadEnd).includes("aliyuncs.com"), false);
assert.equal(api.slice(loadStart, loadEnd).includes("MakeCall"), false);
assert.equal(api.slice(loadStart, loadEnd).includes('"/api/outbound-calls"'), false);
const submitStart = api.indexOf("async function submitOutboundCallHold");
const submitEnd = api.indexOf("async function clearOutboundCallHold", submitStart);
assert.equal(submitStart > 0 && submitEnd > submitStart, true);
assert.match(api.slice(submitStart, submitEnd), /\/api\/outbound-call-holds/);
assert.equal(api.slice(submitStart, submitEnd).includes('"/api/outbound-calls"'), false);

console.log("outbound call hold frontend tests passed");
