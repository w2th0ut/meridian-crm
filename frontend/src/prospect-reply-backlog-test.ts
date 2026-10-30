import assert from "node:assert/strict";
import {
  REPLY_BACKLOG_LIMIT,
  REPLY_BACKLOG_WINDOW_DAYS,
  formatReplyBacklogAt,
  listReplyBacklogQueue,
  presentReplyBacklog,
  replyBacklogEntryLabel,
  replyBacklogLineLabel,
  replyBacklogListFilterForOpen,
  replyBacklogMatchesFilter,
  replyBacklogRank,
  replyBacklogStatusLabel,
  replyBacklogSummary,
  type ReplyBacklogInput
} from "./prospect-reply-backlog.js";

const clock = new Date("2026-10-30T12:00:00.000Z");
const at = (offsetMs: number) => new Date(clock.getTime() + offsetMs).toISOString();
const day = 86_400_000;
const forbidden = /空档|已到期|静默|跟进空档|逾期|有回复|即将到期|未临近|无序列到期|近期有外联|无外联记录|有动作|新近|未加入|近期有跟进|无记录|缺邮箱|卡住/;

function input(replyAt: string): ReplyBacklogInput {
  return { replyAt };
}

const none = presentReplyBacklog(input("  "), clock);
assert.equal(none.kind, "none");
assert.equal(none.replyMs, 0);
assert.equal(replyBacklogLineLabel(none), "无待处理回复");
assert.equal(replyBacklogStatusLabel(none), "无待处理回复");
assert.equal(replyBacklogEntryLabel(), "查看最近回复");
assert.match(replyBacklogSummary(none), /^无待处理回复。/);
assert.match(replyBacklogSummary(none), /超过 7 天算积压较久/);
assert.match(replyBacklogSummary(none), /刚好 7 天仍算积压较新/);
assert.match(replyBacklogSummary(none), /这不是序列下一步到期，也不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄/);
assert.match(replyBacklogSummary(none), /也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口/);
assert.match(replyBacklogSummary(none), /也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住/);
assert.match(replyBacklogSummary(none), /也不是待记跟进或今日到期，也不是待发草稿，也不是外联序列进度/);
assert.match(replyBacklogSummary(none), /也不是打开或点击、失败或抑制、收信同步/);
assert.match(replyBacklogSummary(none), /不替代开发信回复那一块/);
assert.match(replyBacklogSummary(none), /不会发信，不会自动回复，不会标成已处理，不会改名单，也不会改 convert_to_lead 或 approved_contactable/);
assert.match(replyBacklogSummary(none), /跟进记录不算这封回复的时间/);
assert.match(replyBacklogSummary(none), /加入短名单的时间不算这封回复的时间/);
assert.match(replyBacklogSummary(none), /下次跟进那种时间不算这封回复的时间/);
assert.match(replyBacklogSummary(none), /最近一封开发信的发出时间不算这封回复的时间/);
assert.match(replyBacklogSummary(none), /序列下一步的计划时间不算这封回复的时间/);
assert.match(replyBacklogSummary(none), /最近触达（含话机）不算这封回复的时间/);
assert.match(replyBacklogSummary(none), /收信同步的账号状态不算这封回复的时间/);
assert.doesNotMatch(replyBacklogLineLabel(none), forbidden);
assert.equal(replyBacklogMatchesFilter(none, "stale"), false);
assert.equal(replyBacklogMatchesFilter(none, "all"), true);
assert.equal(replyBacklogRank(none), 2);
assert.equal(replyBacklogListFilterForOpen(none), "all");
assert.equal(presentReplyBacklog(input(""), clock).kind, "none");
assert.equal(presentReplyBacklog(input("刚刚"), clock).kind, "none");
assert.equal(presentReplyBacklog(input("不是时间"), clock).kind, "none");

const staleAt = new Date(clock.getTime() - 8 * day);
const stale = presentReplyBacklog(input(staleAt.toISOString()), clock);
assert.equal(stale.kind, "stale");
assert.equal(stale.replyMs, staleAt.getTime());
assert.equal(formatReplyBacklogAt(stale.replyMs), formatReplyBacklogAt(staleAt.getTime()));
assert.equal(replyBacklogLineLabel(stale), `积压较久 · ${formatReplyBacklogAt(stale.replyMs)}`);
assert.match(replyBacklogSummary(stale), /^积压较久 /);
assert.doesNotMatch(replyBacklogLineLabel(stale), forbidden);
assert.doesNotMatch(replyBacklogLineLabel(stale), /积压较新|无待处理回复/);
assert.equal(replyBacklogMatchesFilter(stale, "stale"), true);
assert.equal(replyBacklogRank(stale), 0);
assert.equal(replyBacklogStatusLabel(stale), "积压较久");
assert.equal(replyBacklogListFilterForOpen(stale), "stale");

const justOver = presentReplyBacklog(input(at(-(REPLY_BACKLOG_WINDOW_DAYS * day + 1))), clock);
assert.equal(justOver.kind, "stale", "超过 7 天算积压较久");

const exact = presentReplyBacklog(input(at(-REPLY_BACKLOG_WINDOW_DAYS * day)), clock);
assert.equal(exact.kind, "fresh", "刚好 7 天仍算积压较新");
assert.equal(replyBacklogLineLabel(exact).startsWith("积压较新 · "), true);
assert.equal(replyBacklogRank(exact), 1);
assert.equal(replyBacklogMatchesFilter(exact, "stale"), false);
assert.equal(replyBacklogStatusLabel(exact), "积压较新");
assert.equal(replyBacklogListFilterForOpen(exact), "all");
assert.doesNotMatch(replyBacklogLineLabel(exact), forbidden);
assert.doesNotMatch(replyBacklogLineLabel(exact), /积压较久|无待处理回复/);

const justInside = presentReplyBacklog(input(at(-(REPLY_BACKLOG_WINDOW_DAYS * day - 1))), clock);
assert.equal(justInside.kind, "fresh");

const exactNow = presentReplyBacklog(input(at(0)), clock);
assert.equal(exactNow.kind, "fresh", "此刻仍算积压较新");
assert.equal(replyBacklogMatchesFilter(exactNow, "stale"), false);

const future = presentReplyBacklog(input(at(day)), clock);
assert.equal(future.kind, "fresh", "比现在更晚的可解析回复仍算积压较新");

const fresh = presentReplyBacklog(input(at(-2 * day)), clock);
assert.equal(fresh.kind, "fresh");
assert.match(replyBacklogSummary(fresh), /^积压较新 /);

const frozenSource = input(at(-8 * day));
const frozen = Object.freeze(frozenSource);
presentReplyBacklog(frozen, clock);
assert.equal(frozen.replyAt, frozenSource.replyAt);

const rows = [
  { id: "fresh-later", replyAt: at(-1 * day) },
  { id: "stale-later", replyAt: at(-9 * day) },
  { id: "stale-earlier", replyAt: at(-12 * day) },
  { id: "none", replyAt: "" },
  { id: "invalid", replyAt: "不是时间" },
  { id: "fresh-earlier", replyAt: at(-6 * day) },
  { id: "exact", replyAt: at(-7 * day) }
];
const queue = listReplyBacklogQueue(rows, (row) => presentReplyBacklog(input(row.replyAt), clock));
assert.deepEqual(queue.rows.map((row) => row.id), [
  "stale-earlier",
  "stale-later",
  "exact",
  "fresh-earlier",
  "fresh-later"
]);
assert.equal(queue.total, 5);
assert.equal(REPLY_BACKLOG_LIMIT, 8);
assert.equal(REPLY_BACKLOG_WINDOW_DAYS, 7);

const many = Array.from({ length: 9 }, (_, index) => ({
  id: `s${index}`,
  replyAt: at(-(20 - index) * day)
}));
const capped = listReplyBacklogQueue(many, (row) => presentReplyBacklog(input(row.replyAt), clock));
assert.equal(capped.total, 9);
assert.equal(capped.rows.length, 8);
assert.deepEqual(capped.rows.map((row) => row.id), ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
assert.equal(presentReplyBacklog(input(capped.rows[0]?.replyAt || ""), clock).kind, "stale");

const tied = listReplyBacklogQueue(
  [
    { id: "b", replyAt: at(-10 * day) },
    { id: "a", replyAt: at(-10 * day) }
  ],
  (row) => presentReplyBacklog(input(row.replyAt), clock)
);
assert.deepEqual(tied.rows.map((row) => row.id), ["a", "b"]);

const onlyNone = listReplyBacklogQueue(
  [
    { id: "blank", replyAt: "" },
    { id: "bad", replyAt: "刚刚" }
  ],
  (row) => presentReplyBacklog(input(row.replyAt), clock)
);
assert.equal(onlyNone.total, 0);
assert.deepEqual(onlyNone.rows, []);

const mixedCap = listReplyBacklogQueue(
  [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `due${index}`, replyAt: at(-(index + 8) * day) })),
    { id: "none", replyAt: "" }
  ],
  (row) => presentReplyBacklog(input(row.replyAt), clock)
);
assert.equal(mixedCap.total, 8);
assert.equal(mixedCap.rows.some((row) => row.id === "none"), false);

const freshDoesNotCrowd = listReplyBacklogQueue(
  [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `old${index}`, replyAt: at(-(index + 9) * day) })),
    { id: "new", replyAt: at(-1 * day) },
    { id: "blank", replyAt: "" }
  ],
  (row) => presentReplyBacklog(input(row.replyAt), clock),
  8
);
assert.equal(freshDoesNotCrowd.rows.some((row) => row.id === "new"), false);
assert.equal(freshDoesNotCrowd.rows.some((row) => row.id === "blank"), false);
assert.equal(freshDoesNotCrowd.rows[0]?.id, "old7");

console.log("prospect-reply-backlog-test: ok");
