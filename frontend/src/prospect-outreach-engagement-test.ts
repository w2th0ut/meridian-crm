import assert from "node:assert/strict";
import {
  emptyOutreachEngagement,
  outreachEngagementLatestAt,
  outreachEngagementMatchesFilter,
  outreachEngagementSignalLabel,
  outreachEngagementSummary,
  presentOutreachEngagement
} from "./prospect-outreach-engagement.js";

const none = emptyOutreachEngagement();
assert.equal(none.status, "none");
assert.equal(none.open.count, 0);
assert.equal(none.click.count, 0);
assert.match(outreachEngagementSummary(none), /无打开或点击/);
assert.match(outreachEngagementSummary(none), /这不是失败条，也不是抑制条/);
assert.match(outreachEngagementSummary(none), /仓内没有送达回执/);
assert.match(outreachEngagementSummary(none), /不会自动跟进，也不会自动发下一封/);
assert.doesNotMatch(outreachEngagementSummary(none), /原因未回传|已退信|解除抑制|自动重发/);
assert.equal(outreachEngagementMatchesFilter(none, "clear"), true);
assert.equal(outreachEngagementMatchesFilter(none, "hit"), false);
assert.equal(outreachEngagementSignalLabel("打开", none.open), "无打开");
assert.equal(outreachEngagementSignalLabel("点击", none.click), "无点击");

assert.equal(presentOutreachEngagement(null).status, "none");
assert.equal(presentOutreachEngagement({
  status: "hit",
  kind: "bounced",
  reason: "550 user unknown",
  at: "2026-10-03T08:00:00.000Z"
}).status, "none");
assert.equal(presentOutreachEngagement({
  status: "hit",
  reason: "暂停外发",
  open: { count: 2, at: "2026-10-03T08:00:00.000Z" }
}).status, "none");
assert.equal(presentOutreachEngagement({
  status: "none",
  open: { count: 9, at: "2026-10-03T08:00:00.000Z" }
}).status, "none");

const opened = presentOutreachEngagement({
  status: "hit",
  open: { count: 3, at: "2026-10-03T08:00:00.000Z" },
  click: { count: 0, at: "" },
  deliveredAt: "2026-10-03T07:00:00.000Z"
});
assert.equal(opened.status, "hit");
assert.equal(opened.open.count, 3);
assert.equal(opened.open.at, "2026-10-03T08:00:00.000Z");
assert.equal(opened.click.count, 0);
assert.equal(outreachEngagementSignalLabel("打开", opened.open, "2026-10-03 16:00"), "打开 3 次 · 2026-10-03 16:00");
assert.equal(outreachEngagementSignalLabel("点击", opened.click), "无点击");
assert.match(outreachEngagementSummary(opened, "2026-10-03 16:00", ""), /打开 3 次，最近 2026-10-03 16:00/);
assert.match(outreachEngagementSummary(opened, "2026-10-03 16:00", ""), /无点击/);
assert.match(outreachEngagementSummary(opened, "", ""), /仓内没有送达回执，发送成功不算送达/);
assert.equal(outreachEngagementMatchesFilter(opened, "hit"), true);
assert.equal(outreachEngagementMatchesFilter(opened, "all"), true);
assert.equal(outreachEngagementMatchesFilter(opened, "clear"), false);
assert.equal(outreachEngagementLatestAt(opened), Date.parse("2026-10-03T08:00:00.000Z"));

const both = presentOutreachEngagement({
  status: "hit",
  open: { count: 1.9, at: "not-a-date" },
  click: { count: 4, at: "2026-10-09T01:00:00.000Z" }
});
assert.equal(both.open.count, 1);
assert.equal(both.open.at, "");
assert.equal(both.click.count, 4);
assert.equal(outreachEngagementLatestAt(both), Date.parse("2026-10-09T01:00:00.000Z"));
assert.match(outreachEngagementSummary(both, "", "2026-10-09 09:00"), /点击 4 次，最近 2026-10-09 09:00/);

console.log("prospect-outreach-engagement-test: ok");
