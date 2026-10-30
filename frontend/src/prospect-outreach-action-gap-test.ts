import assert from "node:assert/strict";
import {
  OUTREACH_ACTION_GAP_LIMIT,
  OUTREACH_ACTION_GAP_WINDOW_DAYS,
  formatOutreachActionGapAt,
  listOutreachActionGapQueue,
  outreachActionGapEntryLabel,
  outreachActionGapLineLabel,
  outreachActionGapListFilterForOpen,
  outreachActionGapMatchesFilter,
  outreachActionGapRank,
  outreachActionGapStatusLabel,
  outreachActionGapSummary,
  presentOutreachActionGap,
  type OutreachActionGapInput
} from "./prospect-outreach-action-gap.js";

const clock = new Date("2026-10-30T12:00:00.000Z");
const at = (offsetMs: number) => new Date(clock.getTime() + offsetMs).toISOString();
const day = 86_400_000;

function input(atValue: string): OutreachActionGapInput {
  return { at: atValue };
}

const none = presentOutreachActionGap(input("  "), clock);
assert.equal(none.kind, "none");
assert.equal(none.atMs, 0);
assert.equal(outreachActionGapLineLabel(none), "无外联记录");
assert.equal(outreachActionGapStatusLabel(none), "无外联记录");
assert.equal(outreachActionGapEntryLabel(), "查看最近开发信");
assert.match(outreachActionGapSummary(none), /^无外联记录。/);
assert.match(outreachActionGapSummary(none), /这不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄/);
assert.match(outreachActionGapSummary(none), /也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口/);
assert.match(outreachActionGapSummary(none), /也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住/);
assert.match(outreachActionGapSummary(none), /也不是待记跟进或今日到期，也不是待发草稿、外联序列、回复、打开或点击、失败或抑制、收信同步/);
assert.match(outreachActionGapSummary(none), /不会发信，不会改名单，不会推进序列，不会自动记下跟进，也不会改 convert_to_lead 或 approved_contactable/);
assert.match(outreachActionGapSummary(none), /超过 7 天算空档/);
assert.match(outreachActionGapSummary(none), /刚好 7 天仍算近期有外联/);
assert.match(outreachActionGapSummary(none), /跟进记录不算开发信时间/);
assert.match(outreachActionGapSummary(none), /加入短名单的时间不算开发信时间/);
assert.match(outreachActionGapSummary(none), /下次跟进那种时间不算开发信时间/);
assert.match(outreachActionGapSummary(none), /最近触达（含话机）不算开发信时间/);
assert.doesNotMatch(outreachActionGapLineLabel(none), /静默|有动作|无动作时间|较久|新近|未加入|近期有跟进|无记录|缺邮箱|卡住|逾期|覆盖池/);
assert.equal(outreachActionGapMatchesFilter(none, "gap"), false);
assert.equal(outreachActionGapMatchesFilter(none, "all"), true);
assert.equal(outreachActionGapRank(none), 2);
assert.equal(outreachActionGapListFilterForOpen(none), "all");
assert.equal(presentOutreachActionGap(input(""), clock).kind, "none");
assert.equal(presentOutreachActionGap(input("刚刚"), clock).kind, "none");
assert.equal(presentOutreachActionGap(input("明天"), clock).kind, "none");
assert.equal(presentOutreachActionGap(input("不是时间"), clock).kind, "none");

const wallClock = presentOutreachActionGap(input("2026-10-01 09:00"), clock);
assert.equal(wallClock.kind, "none", "下次跟进那种时间不是开发信时间");
assert.equal(outreachActionGapLineLabel(wallClock), "无外联记录");
assert.equal(outreachActionGapMatchesFilter(wallClock, "gap"), false);

const gapAt = new Date(clock.getTime() - 8 * day);
const gap = presentOutreachActionGap(input(gapAt.toISOString()), clock);
assert.equal(gap.kind, "gap");
assert.equal(gap.atMs, gapAt.getTime());
assert.equal(formatOutreachActionGapAt(gap.atMs), formatOutreachActionGapAt(gapAt.getTime()));
assert.equal(outreachActionGapLineLabel(gap), `空档 · ${formatOutreachActionGapAt(gap.atMs)}`);
assert.match(outreachActionGapSummary(gap), /^空档 /);
assert.doesNotMatch(outreachActionGapLineLabel(gap), /静默|有动作|近期有跟进|无记录|较久|新近/);
assert.equal(outreachActionGapMatchesFilter(gap, "gap"), true);
assert.equal(outreachActionGapRank(gap), 0);
assert.equal(outreachActionGapStatusLabel(gap), "空档");
assert.equal(outreachActionGapListFilterForOpen(gap), "gap");

const justOver = presentOutreachActionGap(input(at(-OUTREACH_ACTION_GAP_WINDOW_DAYS * day - 1)), clock);
assert.equal(justOver.kind, "gap", "超过 7 天算空档");

const exact = presentOutreachActionGap(input(at(-OUTREACH_ACTION_GAP_WINDOW_DAYS * day)), clock);
assert.equal(exact.kind, "recent", "刚好 7 天仍算近期有外联");
assert.equal(outreachActionGapLineLabel(exact).startsWith("近期有外联 · "), true);
assert.equal(outreachActionGapMatchesFilter(exact, "gap"), false);
assert.equal(outreachActionGapRank(exact), 1);
assert.equal(outreachActionGapStatusLabel(exact), "近期有外联");
assert.equal(outreachActionGapListFilterForOpen(exact), "all");

const recent = presentOutreachActionGap(input(at(-2 * day)), clock);
assert.equal(recent.kind, "recent");

const nowish = presentOutreachActionGap(input(at(0)), clock);
assert.equal(nowish.kind, "recent");

const future = presentOutreachActionGap(input(at(day)), clock);
assert.equal(future.kind, "recent");

const frozenSource = input(at(-8 * day));
const frozen = Object.freeze(frozenSource);
presentOutreachActionGap(frozen, clock);
assert.equal(frozen.at, frozenSource.at);

const rows = [
  { id: "recent", at: at(-1 * day) },
  { id: "gap-later", at: at(-9 * day) },
  { id: "gap-earlier", at: at(-12 * day) },
  { id: "none", at: "" },
  { id: "wall", at: "2026-09-01 09:00" },
  { id: "exact", at: at(-7 * day) }
];
const queue = listOutreachActionGapQueue(rows, (row) => presentOutreachActionGap(input(row.at), clock));
assert.deepEqual(queue.rows.map((row) => row.id), ["gap-earlier", "gap-later", "exact", "recent"]);
assert.equal(queue.total, 4);
assert.equal(OUTREACH_ACTION_GAP_LIMIT, 8);
assert.equal(OUTREACH_ACTION_GAP_WINDOW_DAYS, 7);

const many = Array.from({ length: 9 }, (_, index) => ({
  id: `g${index}`,
  at: at(-(20 - index) * day)
}));
const capped = listOutreachActionGapQueue(many, (row) => presentOutreachActionGap(input(row.at), clock));
assert.equal(capped.total, 9);
assert.equal(capped.rows.length, 8);
assert.deepEqual(capped.rows.map((row) => row.id), ["g0", "g1", "g2", "g3", "g4", "g5", "g6", "g7"]);
assert.equal(presentOutreachActionGap(input(capped.rows[0]?.at || ""), clock).kind, "gap");

const tied = listOutreachActionGapQueue(
  [
    { id: "b", at: at(-10 * day) },
    { id: "a", at: at(-10 * day) }
  ],
  (row) => presentOutreachActionGap(input(row.at), clock)
);
assert.deepEqual(tied.rows.map((row) => row.id), ["a", "b"]);

const onlyNone = listOutreachActionGapQueue(
  [
    { id: "blank", at: "" },
    { id: "wall", at: "2026-10-01 09:00" }
  ],
  (row) => presentOutreachActionGap(input(row.at), clock)
);
assert.equal(onlyNone.total, 0);
assert.deepEqual(onlyNone.rows, []);

console.log("prospect-outreach-action-gap-test: ok");
