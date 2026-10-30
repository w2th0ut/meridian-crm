import assert from "node:assert/strict";
import {
  FOLLOW_UP_GAP_LIMIT,
  FOLLOW_UP_GAP_WINDOW_DAYS,
  followUpGapEntryLabel,
  followUpGapLineLabel,
  followUpGapMatchesFilter,
  followUpGapRank,
  followUpGapStatusLabel,
  followUpGapSummary,
  formatFollowUpGapAt,
  listFollowUpGapQueue,
  presentFollowUpGap,
  type FollowUpGapInput
} from "./prospect-follow-up-gap.js";

const clock = new Date("2026-10-30T12:00:00.000Z");
const at = (offsetMs: number) => new Date(clock.getTime() + offsetMs).toISOString();
const day = 86_400_000;

function input(atValue: string): FollowUpGapInput {
  return { at: atValue };
}

const none = presentFollowUpGap(input("  "), clock);
assert.equal(none.kind, "none");
assert.equal(none.atMs, 0);
assert.equal(followUpGapLineLabel(none), "无记录");
assert.equal(followUpGapStatusLabel(none), "无记录");
assert.equal(followUpGapEntryLabel(), "去跟进记录");
assert.match(followUpGapSummary(none), /^无记录。/);
assert.match(followUpGapSummary(none), /这不是下次跟进逾期，也不是转化阶段卡住，也不是获客待办摘要/);
assert.match(followUpGapSummary(none), /也不是待记跟进或今日到期，也不是待发草稿、外联序列、回复、打开或点击、失败或抑制、收信同步/);
assert.match(followUpGapSummary(none), /不会自动记下跟进，不会改下次跟进，不会发信，也不会改 convert_to_lead 或 approved_contactable/);
assert.match(followUpGapSummary(none), /超过 7 天算空档/);
assert.match(followUpGapSummary(none), /下次跟进那种时间不算跟进记录/);
assert.doesNotMatch(followUpGapLineLabel(none), /逾期|今日到期|无下次跟进|卡住|推进中|无阶段|获客待办|已逾期|未设下次跟进|暂无跟进/);
assert.equal(followUpGapMatchesFilter(none, "gap"), false);
assert.equal(followUpGapMatchesFilter(none, "all"), true);
assert.equal(presentFollowUpGap(input(""), clock).kind, "none");
assert.equal(presentFollowUpGap(input("刚刚"), clock).kind, "none");
assert.equal(presentFollowUpGap(input("明天"), clock).kind, "none");

const wallClock = presentFollowUpGap(input("2026-10-01 09:00"), clock);
assert.equal(wallClock.kind, "none", "下次跟进那种时间不是跟进记录");
assert.equal(followUpGapLineLabel(wallClock), "无记录");
assert.equal(followUpGapMatchesFilter(wallClock, "gap"), false);

const gapAt = new Date(clock.getTime() - 8 * day);
const gap = presentFollowUpGap(input(gapAt.toISOString()), clock);
assert.equal(gap.kind, "gap");
assert.equal(gap.atMs, gapAt.getTime());
assert.equal(formatFollowUpGapAt(gap.atMs), formatFollowUpGapAt(gapAt.getTime()));
assert.equal(followUpGapLineLabel(gap), `空档 · ${formatFollowUpGapAt(gap.atMs)}`);
assert.match(followUpGapSummary(gap), /^空档 /);
assert.doesNotMatch(followUpGapLineLabel(gap), /逾期|今日到期|无下次跟进|卡住|推进中|无阶段|获客待办/);
assert.equal(followUpGapMatchesFilter(gap, "gap"), true);
assert.equal(followUpGapRank(gap), 0);
assert.equal(followUpGapStatusLabel(gap), "空档");

const justOver = presentFollowUpGap(input(at(-FOLLOW_UP_GAP_WINDOW_DAYS * day - 1)), clock);
assert.equal(justOver.kind, "gap", "超过 7 天算空档");

const exact = presentFollowUpGap(input(at(-FOLLOW_UP_GAP_WINDOW_DAYS * day)), clock);
assert.equal(exact.kind, "recent", "刚好 7 天仍算近期有跟进");
assert.equal(followUpGapLineLabel(exact).startsWith("近期有跟进 · "), true);
assert.equal(followUpGapMatchesFilter(exact, "gap"), false);
assert.equal(followUpGapRank(exact), 1);
assert.equal(followUpGapStatusLabel(exact), "近期有跟进");

const recent = presentFollowUpGap(input(at(-2 * day)), clock);
assert.equal(recent.kind, "recent");

const future = presentFollowUpGap(input(at(day)), clock);
assert.equal(future.kind, "recent");

const frozenSource = input(at(-8 * day));
const frozen = Object.freeze(frozenSource);
presentFollowUpGap(frozen, clock);
assert.equal(frozen.at, frozenSource.at);

const rows = [
  { id: "recent", at: at(-1 * day) },
  { id: "gap-later", at: at(-9 * day) },
  { id: "gap-earlier", at: at(-12 * day) },
  { id: "none", at: "" },
  { id: "wall", at: "2026-09-01 09:00" },
  { id: "exact", at: at(-7 * day) }
];
const queue = listFollowUpGapQueue(rows, (row) => presentFollowUpGap(input(row.at), clock));
assert.deepEqual(queue.rows.map((row) => row.id), ["gap-earlier", "gap-later", "exact", "recent"]);
assert.equal(queue.total, 4);
assert.equal(FOLLOW_UP_GAP_LIMIT, 8);
assert.equal(FOLLOW_UP_GAP_WINDOW_DAYS, 7);

const many = Array.from({ length: 9 }, (_, index) => ({
  id: `g${index}`,
  at: at(-(20 - index) * day)
}));
const capped = listFollowUpGapQueue(many, (row) => presentFollowUpGap(input(row.at), clock));
assert.equal(capped.total, 9);
assert.equal(capped.rows.length, 8);
assert.deepEqual(capped.rows.map((row) => row.id), ["g0", "g1", "g2", "g3", "g4", "g5", "g6", "g7"]);
assert.equal(presentFollowUpGap(input(capped.rows[0]?.at || ""), clock).kind, "gap");

const tied = listFollowUpGapQueue(
  [
    { id: "b", at: at(-10 * day) },
    { id: "a", at: at(-10 * day) }
  ],
  (row) => presentFollowUpGap(input(row.at), clock)
);
assert.deepEqual(tied.rows.map((row) => row.id), ["a", "b"]);

console.log("prospect-follow-up-gap-test: ok");
