import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderUnlabeledConnectedFollowup, unlabeledConnectedFollowupQuery } from "./unlabeled-connected-followup.js";

assert.equal(unlabeledConnectedFollowupQuery({ scope: "mine" }), "?scope=mine");
assert.equal(unlabeledConnectedFollowupQuery({ scope: "team" }), "?scope=team");

const html = renderUnlabeledConnectedFollowup({
  scope: "mine",
  items: [
    {
      targetType: "customer",
      targetId: "c1",
      targetLabel: "客户",
      name: "Nordic <Tools>",
      callRecordId: "ocr_1",
      outcome: "未标注",
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
assert.match(html, /data-unlabeled-connected-followup="1"/);
assert.match(html, /data-unlabeled-connected-followup-row="1"/);
assert.match(html, /Nordic &lt;Tools&gt;/);
assert.match(html, /data-unlabeled-connected-followup-open="1"/);
assert.match(html, /data-unlabeled-connected-followup-schedule="1"/);
assert.match(html, /记下下次跟进/);
assert.match(html, /data-unlabeled-connected-follow-at/);
assert.match(html, /data-unlabeled-connected-followup-outcome="1">未标注/);
assert.match(html, /data-unlabeled-connected-followup-outcome="1">—/);
assert.match(html, /data-unlabeled-connected-followup-at="1">—/);
assert.match(html, /data-unlabeled-connected-followup-next="1">—/);
assert.match(html, /通话坐席 Shirley坐席/);
assert.match(html, /通话坐席 —/);
assert.match(html, /\*\*\*\*8000/);
assert.match(html, /不改变抑制状态/);
assert.equal(html.includes("MakeCall"), false);
assert.equal(html.includes("Success"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(html), false);
assert.equal(html.includes("data-outbound-call"), false);
assert.equal((html.match(/data-unlabeled-connected-followup-row="1"/g) || []).length, 2);
assert.match(renderUnlabeledConnectedFollowup({ items: [] }), /data-unlabeled-connected-followup-empty="1"/);
assert.equal(renderUnlabeledConnectedFollowup({ items: [] }).includes(">0<"), false);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = page.indexOf('id="dashboardUnlabeledConnectedFollowup"');
const end = page.indexOf('id="dashboardAgentWorkStatusReport"', start);
assert.equal(start > 0 && end > start, true);
const view = page.slice(start, end);
assert.match(view, /已接通未标注还没有下次跟进/);
assert.match(view, /hidden/);
assert.match(view, /id="dashboardUnlabeledConnectedFollowupMine"/);
assert.match(view, /id="dashboardUnlabeledConnectedFollowupTeam"/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);
assert.equal(view.includes("MakeCall"), false);
assert.equal(view.includes("data-outbound-call"), false);
const previous = page.slice(page.indexOf('id="dashboardOtherOutcomeFollowup"'), start);
assert.match(previous, /其他结果还没有下次跟进/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/unlabeled-connected-followups/);
assert.match(api, /\/api\/unlabeled-connected-followups\/schedule/);
assert.match(api, /renderUnlabeledConnectedFollowup/);
assert.match(api, /openCallbackDueObject/);
const gate = api.indexOf("function canViewUnlabeledConnectedFollowupTeam");
assert.equal(gate > 0, true);
assert.match(api.slice(gate, gate + 320), /role === "manager"/);
const refreshStart = api.indexOf("async function refreshDashboardOnly");
const refreshEnd = api.indexOf("function requestDashboardRefresh", refreshStart);
assert.equal(refreshStart > 0 && refreshEnd > refreshStart, true);
assert.equal(api.slice(refreshStart, refreshEnd).includes("/api/unlabeled-connected-followups"), false);
const loadStart = api.indexOf("async function loadUnlabeledConnectedFollowups");
const loadEnd = api.indexOf("async function scheduleUnlabeledConnectedFollowup", loadStart);
assert.equal(loadStart > 0 && loadEnd > loadStart, true);
assert.equal(api.slice(loadStart, loadEnd).includes("aliyuncs.com"), false);
assert.equal(api.slice(loadStart, loadEnd).includes("MakeCall"), false);
assert.equal(api.slice(loadStart, loadEnd).includes("/api/outbound-calls"), false);

console.log("unlabeled connected follow-up frontend tests passed");
