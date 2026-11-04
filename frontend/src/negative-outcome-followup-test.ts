import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { negativeOutcomeFollowupQuery, renderNegativeOutcomeFollowup } from "./negative-outcome-followup.js";

assert.equal(negativeOutcomeFollowupQuery({ scope: "mine" }), "?scope=mine");
assert.equal(negativeOutcomeFollowupQuery({ scope: "team", outcome: "无意向" }), "?scope=team&outcome=%E6%97%A0%E6%84%8F%E5%90%91");
assert.equal(negativeOutcomeFollowupQuery({ scope: "mine", outcome: "" }), "?scope=mine");

const html = renderNegativeOutcomeFollowup({
  scope: "mine",
  outcome: "号码错误",
  items: [
    {
      targetType: "customer",
      targetId: "c1",
      targetLabel: "客户",
      name: "Nordic <Tools>",
      callRecordId: "ocr_1",
      outcome: "号码错误",
      labeledAt: "2026-11-04T01:00:00.000Z",
      nextFollowAt: "已逾期",
      agentLabel: "Shirley坐席",
      maskedNumber: "****8000",
      suppressionNotice: "这次只清除下次跟进，不改变抑制状态。"
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
assert.match(html, /data-negative-outcome-followup="1"/);
assert.match(html, /data-negative-outcome-followup-row="1"/);
assert.match(html, /Nordic &lt;Tools&gt;/);
assert.match(html, /data-negative-outcome-followup-open="1"/);
assert.match(html, /data-negative-outcome-followup-clear="1"/);
assert.match(html, /清除下次跟进/);
assert.match(html, /data-negative-outcome-followup-outcome="1">号码错误/);
assert.match(html, /data-negative-outcome-followup-outcome="1">—/);
assert.match(html, /data-negative-outcome-followup-at="1">—/);
assert.match(html, /data-negative-outcome-followup-next="1">已逾期/);
assert.match(html, /data-negative-outcome-followup-next="1">—/);
assert.match(html, /通话坐席 Shirley坐席/);
assert.match(html, /通话坐席 —/);
assert.match(html, /\*\*\*\*8000/);
assert.match(html, /不改变抑制状态/);
assert.match(html, /号码错误/);
assert.equal(html.includes("MakeCall"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(html), false);
assert.equal(html.includes("data-outbound-call"), false);
assert.equal((html.match(/data-negative-outcome-followup-row="1"/g) || []).length, 2);
assert.match(renderNegativeOutcomeFollowup({ items: [] }), /data-negative-outcome-followup-empty="1"/);
assert.equal(renderNegativeOutcomeFollowup({ items: [] }).includes(">0<"), false);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = page.indexOf('id="dashboardNegativeOutcomeFollowup"');
const end = page.indexOf('id="dashboardAgentWorkStatusReport"', start);
assert.equal(start > 0 && end > start, true);
const view = page.slice(start, end);
assert.match(view, /负向结果仍有下次跟进/);
assert.match(view, /hidden/);
assert.match(view, /id="dashboardNegativeOutcomeFollowupMine"/);
assert.match(view, /id="dashboardNegativeOutcomeFollowupTeam"/);
assert.match(view, /id="dashboardNegativeOutcomeFollowupOutcome"/);
assert.match(view, /无意向/);
assert.match(view, /号码错误/);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);
assert.equal(view.includes("MakeCall"), false);
assert.equal(view.includes("data-outbound-call"), false);
const queue = page.slice(page.indexOf('id="dashboardUnansweredPendingQueue"'), start);
assert.match(queue, /未接通待处理/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/negative-outcome-followups/);
assert.match(api, /\/api\/negative-outcome-followups\/clear/);
assert.match(api, /renderNegativeOutcomeFollowup/);
assert.match(api, /openCallbackDueObject/);
const gate = api.indexOf("function canViewNegativeOutcomeFollowupTeam");
assert.equal(gate > 0, true);
assert.match(api.slice(gate, gate + 280), /role === "manager"/);
const refreshStart = api.indexOf("async function refreshDashboardOnly");
const refreshEnd = api.indexOf("function requestDashboardRefresh", refreshStart);
assert.equal(refreshStart > 0 && refreshEnd > refreshStart, true);
assert.equal(api.slice(refreshStart, refreshEnd).includes("/api/negative-outcome-followups"), false);
const loadStart = api.indexOf("async function loadNegativeOutcomeFollowups");
const loadEnd = api.indexOf("let agentWorkStatusReportAgentId", loadStart);
assert.equal(loadStart > 0 && loadEnd > loadStart, true);
assert.equal(api.slice(loadStart, loadEnd).includes("aliyuncs.com"), false);
assert.equal(api.slice(loadStart, loadEnd).includes("MakeCall"), false);
assert.equal(api.slice(loadStart, loadEnd).includes("/api/outbound-calls"), false);

console.log("negative outcome follow-up frontend tests passed");
