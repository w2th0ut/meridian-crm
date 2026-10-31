import assert from "node:assert/strict";
import { presentOutreachReply } from "./prospect-outreach-reply.js";
import {
  REPLY_AGE_LIMIT,
  REPLY_AGE_WINDOW_DAYS,
  formatReplyAgeAt,
  listReplyAgeQueue,
  presentReplyAge,
  replyAgeEntryLabel,
  replyAgeLineLabel,
  replyAgeListFilterForOpen,
  replyAgeMatchesFilter,
  replyAgeRank,
  replyAgeStatusLabel,
  replyAgeSummary,
  type ReplyAgeInput
} from "./prospect-reply-age.js";

const clock = new Date("2026-10-30T12:00:00.000Z");
const at = (offsetMs: number) => new Date(clock.getTime() + offsetMs).toISOString();
const day = 86_400_000;
const forbidden = /空档|已到期|静默|跟进空档|逾期|有回复|即将到期|未临近|无序列到期|近期有外联|无外联记录|有动作|新近|未加入|近期有跟进|无记录|缺邮箱|卡住|积压较久|积压较新|无待处理回复|较久|待放已久|待放未久|无待放行|抑制超七日|抑制七日内|无抑制日龄|失败超七日|失败七日内|无失败日龄|打开超七日|打开七日内|无打开日龄|无失败记录|发送失败|开发信退信|无打开或点击|有打开\/点击/;

function input(atValue: string, replied = true): ReplyAgeInput {
  return { replied, at: atValue };
}

function fromProjection(replyAt: string, replied: boolean) {
  return presentReplyAge({ replied, at: replyAt }, clock);
}

const none = presentReplyAge(input("  ", false), clock);
assert.equal(none.kind, "none");
assert.equal(none.atMs, 0);
assert.equal(replyAgeLineLabel(none), "无回复日龄");
assert.equal(replyAgeStatusLabel(none), "无回复日龄");
assert.equal(replyAgeEntryLabel(), "查看开发信回复");
assert.match(replyAgeSummary(none), /^无回复日龄。/);
assert.match(replyAgeSummary(none), /超过 7 天算回复超七日/);
assert.match(replyAgeSummary(none), /刚好 7 天仍算回复七日内/);
assert.match(replyAgeSummary(none), /这不是打开或点击日龄，也不是失败退信日龄，也不是抑制名单日龄，也不是待放行批次，也不是回复待处理积压，也不是序列下一步到期，也不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄/);
assert.match(replyAgeSummary(none), /也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口/);
assert.match(replyAgeSummary(none), /也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住/);
assert.match(replyAgeSummary(none), /也不是待记跟进或今日到期，也不是待发草稿、外联序列进度/);
assert.match(replyAgeSummary(none), /也不是打开或点击、失败或退信、收信同步/);
assert.match(replyAgeSummary(none), /不替代开发信回复那一块，也不替代回复待处理积压/);
assert.match(replyAgeSummary(none), /不会发信，不会自动回复，不会标成已处理，不会解除抑制，不会推进序列，不会放行批次，不会改名单，也不会改 convert_to_lead 或 approved_contactable/);
assert.match(replyAgeSummary(none), /打开或点击的发生时间不算这次回复的时间/);
assert.match(replyAgeSummary(none), /失败或退信的发生时间不算这次回复的时间/);
assert.match(replyAgeSummary(none), /抑制或退订的生效时间不算这次回复的时间/);
assert.match(replyAgeSummary(none), /待放行批次的更新时间不算这次回复的时间/);
assert.match(replyAgeSummary(none), /跟进记录不算这次回复的时间/);
assert.match(replyAgeSummary(none), /加入短名单的时间不算这次回复的时间/);
assert.match(replyAgeSummary(none), /下次跟进那种时间不算这次回复的时间/);
assert.match(replyAgeSummary(none), /最近一封开发信的发出时间不算这次回复的时间/);
assert.match(replyAgeSummary(none), /序列下一步的计划时间不算这次回复的时间/);
assert.match(replyAgeSummary(none), /最近触达（含话机）不算这次回复的时间/);
assert.match(replyAgeSummary(none), /收信同步的账号状态不算这次回复的时间/);
assert.match(replyAgeSummary(none), /只有摘要、没有回复时间时也不编造/);
assert.doesNotMatch(replyAgeLineLabel(none), forbidden);
assert.equal(replyAgeMatchesFilter(none, "long"), false);
assert.equal(replyAgeMatchesFilter(none, "all"), true);
assert.equal(replyAgeRank(none), 2);
assert.equal(replyAgeListFilterForOpen(none), "all");
assert.equal(presentReplyAge(input("", true), clock).kind, "none");
assert.equal(presentReplyAge(input("刚刚", true), clock).kind, "none");
assert.equal(presentReplyAge(input("不是时间", true), clock).kind, "none");
assert.equal(presentReplyAge(input(at(-30 * day), false), clock).kind, "none", "没有回复时，即使带了时间也是无回复日龄");

const longAt = new Date(clock.getTime() - 8 * day);
const long = presentReplyAge(input(longAt.toISOString(), true), clock);
assert.equal(long.kind, "long");
assert.equal(long.atMs, longAt.getTime());
assert.equal(formatReplyAgeAt(long.atMs), formatReplyAgeAt(longAt.getTime()));
assert.equal(replyAgeLineLabel(long), `回复超七日 · ${formatReplyAgeAt(long.atMs)}`);
assert.match(replyAgeSummary(long), /^回复超七日 /);
assert.doesNotMatch(replyAgeLineLabel(long), forbidden);
assert.doesNotMatch(replyAgeLineLabel(long), /回复七日内|无回复日龄/);
assert.equal(replyAgeMatchesFilter(long, "long"), true);
assert.equal(replyAgeRank(long), 0);
assert.equal(replyAgeStatusLabel(long), "回复超七日");
assert.equal(replyAgeListFilterForOpen(long), "long");

const justOver = presentReplyAge(input(at(-(REPLY_AGE_WINDOW_DAYS * day + 1)), true), clock);
assert.equal(justOver.kind, "long", "超过 7 天算回复超七日");

const exact = presentReplyAge(input(at(-REPLY_AGE_WINDOW_DAYS * day), true), clock);
assert.equal(exact.kind, "recent", "刚好 7 天仍算回复七日内");
assert.equal(replyAgeLineLabel(exact).startsWith("回复七日内 · "), true);
assert.equal(replyAgeRank(exact), 1);
assert.equal(replyAgeMatchesFilter(exact, "long"), false);
assert.equal(replyAgeStatusLabel(exact), "回复七日内");
assert.equal(replyAgeListFilterForOpen(exact), "all");
assert.doesNotMatch(replyAgeLineLabel(exact), forbidden);
assert.doesNotMatch(replyAgeLineLabel(exact), /回复超七日|无回复日龄/);

const justInside = presentReplyAge(input(at(-(REPLY_AGE_WINDOW_DAYS * day - 1)), true), clock);
assert.equal(justInside.kind, "recent");

const exactNow = presentReplyAge(input(at(0), true), clock);
assert.equal(exactNow.kind, "recent", "此刻仍算回复七日内");
assert.equal(replyAgeMatchesFilter(exactNow, "long"), false);

const future = presentReplyAge(input(at(day), true), clock);
assert.equal(future.kind, "recent", "比现在更晚的可解析回复时间仍算回复七日内");

const recent = presentReplyAge(input(at(-2 * day), true), clock);
assert.equal(recent.kind, "recent");
assert.match(replyAgeSummary(recent), /^回复七日内 /);

const frozenSource = input(at(-8 * day), true);
const frozen = Object.freeze(frozenSource);
presentReplyAge(frozen, clock);
assert.equal(frozen.at, frozenSource.at);
assert.equal(frozen.replied, true);

const rows = [
  { id: "recent-later", at: at(-1 * day), replied: true },
  { id: "long-later", at: at(-9 * day), replied: true },
  { id: "long-earlier", at: at(-12 * day), replied: true },
  { id: "none", at: "", replied: true },
  { id: "clear", at: at(-20 * day), replied: false },
  { id: "invalid", at: "不是时间", replied: true },
  { id: "recent-earlier", at: at(-6 * day), replied: true },
  { id: "exact", at: at(-7 * day), replied: true }
];
const queue = listReplyAgeQueue(rows, (row) => presentReplyAge(input(row.at, row.replied), clock));
assert.deepEqual(queue.rows.map((row) => row.id), [
  "long-earlier",
  "long-later",
  "exact",
  "recent-earlier",
  "recent-later"
]);
assert.equal(queue.total, 5);
assert.equal(REPLY_AGE_LIMIT, 8);
assert.equal(REPLY_AGE_WINDOW_DAYS, 7);

const many = Array.from({ length: 9 }, (_, index) => ({
  id: `s${index}`,
  at: at(-(20 - index) * day),
  replied: true
}));
const capped = listReplyAgeQueue(many, (row) => presentReplyAge(input(row.at, row.replied), clock));
assert.equal(capped.total, 9);
assert.equal(capped.rows.length, 8);
assert.deepEqual(capped.rows.map((row) => row.id), ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
assert.equal(presentReplyAge(input(capped.rows[0]?.at || "", true), clock).kind, "long");

const tied = listReplyAgeQueue(
  [
    { id: "b", at: at(-10 * day), replied: true },
    { id: "a", at: at(-10 * day), replied: true }
  ],
  (row) => presentReplyAge(input(row.at, row.replied), clock)
);
assert.deepEqual(tied.rows.map((row) => row.id), ["a", "b"]);

const onlyNone = listReplyAgeQueue(
  [
    { id: "blank", at: "", replied: true },
    { id: "bad", at: "刚刚", replied: true },
    { id: "clear", at: at(-12 * day), replied: false }
  ],
  (row) => presentReplyAge(input(row.at, row.replied), clock)
);
assert.equal(onlyNone.total, 0);
assert.deepEqual(onlyNone.rows, []);

const mixedCap = listReplyAgeQueue(
  [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `due${index}`, at: at(-(index + 8) * day), replied: true })),
    { id: "none", at: "", replied: false }
  ],
  (row) => presentReplyAge(input(row.at, row.replied), clock)
);
assert.equal(mixedCap.total, 8);
assert.equal(mixedCap.rows.some((row) => row.id === "none"), false);

const recentDoesNotCrowd = listReplyAgeQueue(
  [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `old${index}`, at: at(-(index + 9) * day), replied: true })),
    { id: "new", at: at(-1 * day), replied: true },
    { id: "blank", at: "", replied: true }
  ],
  (row) => presentReplyAge(input(row.at, row.replied), clock),
  8
);
assert.equal(recentDoesNotCrowd.rows.some((row) => row.id === "new"), false);
assert.equal(recentDoesNotCrowd.rows.some((row) => row.id === "blank"), false);
assert.equal(recentDoesNotCrowd.rows[0]?.id, "old7");

const projectedLong = presentOutreachReply({
  status: "hit",
  at: longAt.toISOString(),
  excerpt: ""
});
const projectedLongReplied = projectedLong.status === "hit";
assert.equal(projectedLong.status, "hit");
assert.equal(projectedLong.at, longAt.toISOString());
assert.equal(fromProjection(projectedLong.at, projectedLongReplied).kind, "long", "日龄复用 Day16 回复投影上的同一份回复时间");

const projectedRecent = presentOutreachReply({
  status: "hit",
  at: at(-2 * day),
  excerpt: "方便通个电话"
});
const projectedRecentReplied = projectedRecent.status === "hit";
assert.equal(fromProjection(projectedRecent.at, projectedRecentReplied).kind, "recent");

const projectedClear = presentOutreachReply({
  status: "none",
  at: at(-30 * day),
  excerpt: "没有回复"
});
const projectedClearReplied = projectedClear.status === "hit";
assert.equal(projectedClear.status, "none");
assert.equal(fromProjection(at(-30 * day), projectedClearReplied).kind, "none");

const projectedExcerptOnly = presentOutreachReply({
  status: "hit",
  at: "不是时间",
  excerpt: "只有摘要"
});
const excerptReplied = projectedExcerptOnly.status === "hit";
assert.equal(projectedExcerptOnly.at, "");
assert.equal(excerptReplied, true);
assert.equal(fromProjection(projectedExcerptOnly.at, excerptReplied).kind, "none", "只有摘要、没有回复时间是无回复日龄");

const projectedBounce = presentOutreachReply({
  status: "hit",
  kind: "bounced",
  reason: "mailbox full",
  at: at(-30 * day),
  excerpt: "不要当成回复"
});
const bounceReplied = projectedBounce.status === "hit";
assert.equal(projectedBounce.status, "none");
assert.equal(bounceReplied, false);
assert.equal(fromProjection(at(-30 * day), bounceReplied).kind, "none", "失败或退信不算开发信回复日龄");

const projectedOpen = presentOutreachReply({
  status: "hit",
  open: { count: 2, at: at(-30 * day) },
  click: { count: 1, at: at(-2 * day) }
});
const openReplied = projectedOpen.status === "hit";
assert.equal(projectedOpen.status, "none");
assert.equal(openReplied, false);
assert.equal(fromProjection(at(-2 * day), openReplied).kind, "none", "打开或点击不算开发信回复日龄");

console.log("prospect-reply-age-test: ok");
