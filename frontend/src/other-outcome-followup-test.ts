import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { otherOutcomeFollowupQuery, renderOtherOutcomeFollowup } from "./other-outcome-followup.js";

assert.equal(otherOutcomeFollowupQuery({ scope: "mine" }), "?scope=mine");
assert.equal(otherOutcomeFollowupQuery({ scope: "team" }), "?scope=team");

const html = renderOtherOutcomeFollowup({
  scope: "mine",
  items: [
    {
      targetType: "customer",
      targetId: "c1",
      targetLabel: "客户",
      name: "Nordic <Tools>",
      callRecordId: "ocr_1",
      outcome: "其他",
      labeledAt: "2026-11-04T01:00:00.000Z",
      nextFollowAt: "",
      agentLabel: "Shirley坐席",
      maskedNumber: "****8000",
      suppressionNotice: "这次只记下下次跟进，不改变抑制状态。"
    },
    {
      targetType: "lead",
      targetId: "l2",
      targetLabel: "线索",
      name: "灯具",
      callRecordId: "ocr_2",
      outcome: "",
      labeledAt: "",
      nextFollowAt: "   ",
      agentLabel: "",
      maskedNumber: ""
    }
  ]
});
assert.match(html, /data-other-outcome-followup="1"/);
assert.match(html, /data-other-outcome-followup-row="1"/);
assert.match(html, /Nordic &lt;Tools&gt;/);
assert.match(html, /data-other-outcome-followup-open="1"/);
assert.match(html, /data-other-outcome-followup-schedule="1"/);
assert.match(html, /记下下次跟进/);
assert.match(html, /data-other-outcome-follow-at/);
assert.match(html, /data-other-outcome-followup-outcome="1">其他/);
assert.match(html, /data-other-outcome-followup-outcome="1">—/);
assert.match(html, /data-other-outcome-followup-at="1">—/);
assert.match(html, /data-other-outcome-followup-next="1">—/);
assert.match(html, /通话坐席 Shirley坐席/);
assert.match(html, /通话坐席 —/);
assert.match(html, /\*\*\*\*8000/);
assert.match(html, /不改变抑制状态/);
assert.equal(html.includes("MakeCall"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(html), false);
assert.equal(html.includes("data-outbound-call"), false);
assert.equal((html.match(/data-other-outcome-followup-row="1"/g) || []).length, 2);
assert.match(renderOtherOutcomeFollowup({ items: [] }), /data-other-outcome-followup-empty="1"/);
assert.equal(renderOtherOutcomeFollowup({ items: [] }).includes(">0<"), false);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = page.indexOf('id="dashboardOtherOutcomeFollowup"');
const end = page.indexOf('id="dashboardAgentWorkStatusReport"', start);
assert.equal(start > 0 && end > start, true);
const view = page.slice(start, end);
assert.match(view, /其他结果还没有下次跟进/);
assert.match(view, /hidden/);
assert.match(view, /id="dashboardOtherOutcomeFollowupMine"/);
assert.match(view, /id="dashboardOtherOutcomeFollowupTeam"/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);
assert.equal(view.includes("MakeCall"), false);
assert.equal(view.includes("data-outbound-call"), false);
const previous = page.slice(page.indexOf('id="dashboardNegativeOutcomeFollowup"'), start);
assert.match(previous, /负向结果仍有下次跟进/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/other-outcome-followups/);
assert.match(api, /\/api\/other-outcome-followups\/schedule/);
assert.match(api, /renderOtherOutcomeFollowup/);
assert.match(api, /openCallbackDueObject/);
const gate = api.indexOf("function canViewOtherOutcomeFollowupTeam");
assert.equal(gate > 0, true);
assert.match(api.slice(gate, gate + 280), /role === "manager"/);
const refreshStart = api.indexOf("async function refreshDashboardOnly");
const refreshEnd = api.indexOf("function requestDashboardRefresh", refreshStart);
assert.equal(refreshStart > 0 && refreshEnd > refreshStart, true);
assert.equal(api.slice(refreshStart, refreshEnd).includes("/api/other-outcome-followups"), false);
const loadStart = api.indexOf("async function loadOtherOutcomeFollowups");
const loadEnd = api.indexOf("async function scheduleOtherOutcomeFollowup", loadStart);
assert.equal(loadStart > 0 && loadEnd > loadStart, true);
assert.equal(api.slice(loadStart, loadEnd).includes("aliyuncs.com"), false);
assert.equal(api.slice(loadStart, loadEnd).includes("MakeCall"), false);
assert.equal(api.slice(loadStart, loadEnd).includes("/api/outbound-calls"), false);

console.log("other outcome follow-up frontend tests passed");
