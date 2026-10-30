import assert from "node:assert/strict";
import {
  emptyOutreachReply,
  outreachReplyFollowLabel,
  outreachReplyHistoryLabel,
  outreachReplyLatestAt,
  outreachReplyLineLabel,
  outreachReplyMatchesFilter,
  outreachReplySummary,
  presentOutreachReply
} from "./prospect-outreach-reply.js";

const none = emptyOutreachReply();
assert.equal(none.status, "none");
assert.equal(none.at, "");
assert.equal(none.excerpt, "");
assert.equal(outreachReplyLineLabel(none), "无回复");
assert.equal(outreachReplyFollowLabel(none), "");
assert.equal(outreachReplyHistoryLabel(none), "");
assert.match(outreachReplySummary(none), /无回复/);
assert.match(outreachReplySummary(none), /这不是打开或点击条，也不是失败条，也不是抑制条/);
assert.match(outreachReplySummary(none), /不会自动跟进，也不会自动发下一封/);
assert.doesNotMatch(outreachReplySummary(none), /原因未回传|已退信|解除抑制|无打开|发送失败/);
assert.equal(outreachReplyMatchesFilter(none, "clear"), true);
assert.equal(outreachReplyMatchesFilter(none, "hit"), false);

assert.equal(presentOutreachReply(null).status, "none");
assert.equal(presentOutreachReply({
  status: "hit",
  kind: "bounced",
  reason: "550 user unknown",
  at: "2026-10-03T08:00:00.000Z"
}).status, "none");
assert.equal(presentOutreachReply({
  status: "hit",
  open: { count: 2, at: "2026-10-03T08:00:00.000Z" },
  click: { count: 0, at: "" }
}).status, "none");
assert.equal(presentOutreachReply({
  status: "hit",
  reason: "暂停外发",
  at: "2026-10-03T08:00:00.000Z",
  excerpt: "不要当成回复"
}).status, "none");
assert.equal(presentOutreachReply({
  status: "none",
  at: "2026-10-03T08:00:00.000Z",
  excerpt: "没有回复"
}).status, "none");
assert.equal(presentOutreachReply({ status: "hit", at: "", excerpt: "" }).status, "none");

const timeOnly = presentOutreachReply({
  status: "hit",
  at: "2026-10-04T08:00:00.000Z",
  excerpt: ""
});
assert.equal(timeOnly.status, "hit");
assert.equal(timeOnly.excerpt, "");
assert.equal(outreachReplyLineLabel(timeOnly, "2026-10-04 16:00"), "最近回复 · 2026-10-04 16:00 · 有回复");
assert.match(outreachReplySummary(timeOnly, "2026-10-04 16:00"), /最近回复 2026-10-04 16:00/);
assert.match(outreachReplySummary(timeOnly, "2026-10-04 16:00"), /有回复/);
assert.doesNotMatch(outreachReplySummary(timeOnly, "2026-10-04 16:00"), /无打开|发送失败|已退订/);
assert.equal(outreachReplyFollowLabel(timeOnly), "去跟进记录");
assert.equal(outreachReplyHistoryLabel(timeOnly), "查看回复记录");
assert.equal(outreachReplyMatchesFilter(timeOnly, "hit"), true);
assert.equal(outreachReplyMatchesFilter(timeOnly, "all"), true);
assert.equal(outreachReplyMatchesFilter(timeOnly, "clear"), false);
assert.equal(outreachReplyLatestAt(timeOnly), Date.parse("2026-10-04T08:00:00.000Z"));

const excerpted = presentOutreachReply({
  status: "hit",
  at: "not-a-date",
  excerpt: `  ${"乙".repeat(60)}  `
});
assert.equal(excerpted.at, "");
assert.equal(excerpted.excerpt, `${"乙".repeat(48)}…`);
assert.equal(outreachReplyLineLabel(excerpted), `最近回复 · ${"乙".repeat(48)}…`);
assert.match(outreachReplySummary(excerpted), /有回复|乙/);
assert.match(outreachReplySummary(excerpted), new RegExp(`${"乙".repeat(48)}…`));
assert.equal(outreachReplyLatestAt(excerpted), 0);

console.log("prospect-outreach-reply-test: ok");
