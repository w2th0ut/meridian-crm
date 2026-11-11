import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  appendQueueCallGlanceQuery,
  queueCallGlanceFilterEmpty,
  queueCallGlanceQueryFromValues
} from "./queue-call-glance.js";
import { intentFollowupQuery, renderIntentFollowupQueue } from "./intent-followup-queue.js";
import { negativeOutcomeFollowupQuery, renderNegativeOutcomeFollowup } from "./negative-outcome-followup.js";
import { otherOutcomeFollowupQuery } from "./other-outcome-followup.js";
import { todayFollowNextQuery, renderTodayFollowNext } from "./today-follow-advance.js";
import { renderUnansweredPendingQueue, unansweredPendingQueueQuery } from "./unanswered-pending-queue.js";
import { unlabeledConnectedFollowupQuery } from "./unlabeled-connected-followup.js";

assert.equal(unansweredPendingQueueQuery({ scope: "mine" }), "?scope=mine");
assert.equal(unansweredPendingQueueQuery({
  scope: "team",
  age: "over7",
  todayCalls: "0",
  lastOutcome: "未标注",
  todayCallSort: "uncalled"
}), "?scope=team&age=over7&todayCalls=0&lastOutcome=%E6%9C%AA%E6%A0%87%E6%B3%A8&todayCallSort=uncalled");
assert.equal(intentFollowupQuery({}), "");
assert.equal(intentFollowupQuery({ todayCalls: "2+", todayCallSort: "called" }), "?todayCalls=2%2B&todayCallSort=called");
assert.equal(negativeOutcomeFollowupQuery({ scope: "mine", outcome: "无意向", todayCalls: "1" }), "?scope=mine&outcome=%E6%97%A0%E6%84%8F%E5%90%91&todayCalls=1");
assert.equal(otherOutcomeFollowupQuery({ scope: "mine", lastOutcome: "其他" }), "?scope=mine&lastOutcome=%E5%85%B6%E4%BB%96");
assert.equal(unlabeledConnectedFollowupQuery({ scope: "team" }), "?scope=team");
assert.equal(todayFollowNextQuery({ scope: "mine", afterType: "customer", afterId: "c1", todayCallSort: "uncalled" }), "?scope=mine&afterType=customer&afterId=c1&todayCallSort=uncalled");

const params = new URLSearchParams();
appendQueueCallGlanceQuery(params, queueCallGlanceQueryFromValues("9", "Success", "asc"));
assert.equal(params.toString(), "");
assert.deepEqual(queueCallGlanceQueryFromValues("0", "需回访", "uncalled"), {
  todayCalls: "0",
  lastOutcome: "需回访",
  todayCallSort: "uncalled"
});

const empty = queueCallGlanceFilterEmpty('data-unanswered-pending-empty="1"');
assert.match(empty, /data-queue-call-filter-empty="1"/);
assert.equal(empty.includes("0"), false);
assert.equal(empty.includes("<button"), false);
assert.equal(empty.includes("外呼"), false);

const filtered = renderUnansweredPendingQueue({ scope: "mine", todayCalls: "0", items: [] });
assert.match(filtered, /data-queue-call-filter-empty="1"/);
assert.equal(renderUnansweredPendingQueue({ scope: "mine", items: [] }).includes("data-queue-call-filter-empty"), false);
assert.match(renderIntentFollowupQueue({ todayCalls: "1", items: [] }), /data-queue-call-filter-empty="1"/);
assert.match(renderNegativeOutcomeFollowup({ lastOutcome: "无意向", items: [] }), /data-queue-call-filter-empty="1"/);
assert.match(renderTodayFollowNext({ todayCalls: "0", next: null }), /data-queue-call-filter-empty="1"/);
assert.equal(renderTodayFollowNext({ next: null }).includes("data-queue-call-filter-empty"), false);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
for (const id of [
  "dashboardUnansweredPending",
  "dashboardNegativeOutcomeFollowup",
  "dashboardOtherOutcomeFollowup",
  "dashboardUnlabeledConnectedFollowup",
  "dashboardTodayFollowNext",
  "intentFollowup"
]) {
  assert.match(page, new RegExp(`id="${id}TodayCalls"`));
  assert.match(page, new RegExp(`id="${id}LastOutcome"`));
  assert.match(page, new RegExp(`id="${id}TodayCallSort"`));
}
assert.match(page, /今日未拨在前/);
assert.equal(page.includes("queue-call-glance-dial"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /function queueCallGlanceControls/);
assert.match(api, /queueCallGlanceControls\("dashboardUnansweredPending"\)/);
assert.match(api, /queueCallGlanceControls\("intentFollowup"\)/);
assert.match(api, /queueCallGlanceControls\("dashboardTodayFollowNext"\)/);
assert.equal(api.includes("queue-call-glance-dial"), false);

console.log("queue call glance view frontend tests passed");
