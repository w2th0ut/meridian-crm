import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  renderTodayFollowNext,
  renderTodayFollowNextEmpty,
  renderTodayFollowNextFailure,
  todayFollowNextQuery
} from "./today-follow-advance.js";
import { renderCallOutcomeForm } from "./outbound-call-records.js";

assert.equal(todayFollowNextQuery({ scope: "mine" }), "?scope=mine");
assert.equal(
  todayFollowNextQuery({ scope: "mine", afterType: "customer", afterId: "c1" }),
  "?scope=mine&afterType=customer&afterId=c1"
);
assert.equal(todayFollowNextQuery({ scope: "team", afterType: "customer", afterId: "" }), "?scope=team");

assert.match(renderTodayFollowNextEmpty(), /data-today-follow-next-empty="1"/);
assert.equal(renderTodayFollowNextEmpty().includes(">0<"), false);
assert.match(renderTodayFollowNextFailure("读不到"), /data-today-follow-next-error="1"/);

const html = renderTodayFollowNext({
  next: {
    targetType: "customer",
    targetId: "c1",
    targetLabel: "客户",
    name: "Early <Co>",
    nextFollowAt: "2026-11-04 09:00",
    phoneId: "extra-1",
    preferred: true,
    maskedNumber: "*******8000"
  }
});
assert.match(html, /data-today-follow-next="1"/);
assert.match(html, /data-today-follow-next-open="1"/);
assert.match(html, /Early &lt;Co&gt;/);
assert.match(html, /data-today-follow-next-phone="1" data-preferred="1"/);
assert.match(html, /首选 \*\*\*\*\*\*\*8000/);
assert.match(html, /不会自动拨号/);
assert.equal(html.includes("data-outbound-call"), false);
assert.equal(html.includes(">外呼<"), false);
assert.equal(html.includes("MakeCall"), false);
assert.equal(renderTodayFollowNext({ empty: true, next: null }).includes("data-today-follow-next-open"), false);

const form = renderCallOutcomeForm({
  id: "ocr_1",
  callOutcome: "有意向",
  targetType: "customer",
  targetId: "c1"
});
assert.match(form, /data-target-type="customer"/);
assert.match(form, /data-target-id="c1"/);
assert.match(form, /保存标注/);
assert.equal(form.includes(">外呼<"), false);
const plain = renderCallOutcomeForm({ id: "ocr_2" });
assert.equal(plain.includes("data-target-type"), false);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = page.indexOf('id="dashboardTodayFollowNext"');
const end = page.indexOf('id="dashboardAgentWorkStatusReport"', start);
assert.ok(start > 0 && end > start);
const section = page.slice(start, end);
assert.match(section, /标完即到下一位/);
assert.match(section, /id="dashboardTodayFollowNextMine"/);
assert.match(section, /id="dashboardTodayFollowNextTeam"/);
assert.match(section, /data-today-follow-next-idle="1"/);
assert.match(section, /打开工作台本身不请求/);
assert.match(section, /不会自动拨号/);
assert.equal(section.includes("data-outbound-call"), false);
assert.equal(section.includes(">外呼<"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const submitStart = api.indexOf("async function submitCallOutcome");
const submitEnd = api.indexOf("async function openNextTodayFollow");
assert.ok(submitStart > 0 && submitEnd > submitStart);
const submit = api.slice(submitStart, submitEnd);
assert.match(submit, /\/api\/outbound-call-records\/\$\{encodeURIComponent\(recordId\)\}\/outcome/);
assert.match(submit, /openNextTodayFollow\(form\.dataset\.targetType/);
assert.doesNotMatch(submit, /MakeCall|aliyuncs|\/api\/outbound-calls|callRecordIds/);
const opener = api.slice(submitEnd, api.indexOf("async function loadIntentFollowupQueue", submitEnd));
assert.match(opener, /\/api\/today-follow-next/);
assert.match(opener, /openCallbackDueObject/);
assert.doesNotMatch(opener, /MakeCall|aliyuncs|\/api\/outbound-calls/);
assert.match(api, /dashboardTodayFollowNextMine/);
assert.match(api, /function paintTodayFollowNextAccess/);

console.log("today follow advance page tests passed");
