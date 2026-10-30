import assert from "node:assert/strict";
import {
  RELEASE_BATCH_AGE_LIMIT,
  RELEASE_BATCH_AGE_WINDOW_DAYS,
  formatReleaseBatchAgeAt,
  listReleaseBatchAgeQueue,
  presentReleaseBatchAge,
  releaseBatchAgeEntryLabel,
  releaseBatchAgeLineLabel,
  releaseBatchAgeListFilterForOpen,
  releaseBatchAgeMatchesFilter,
  releaseBatchAgeRank,
  releaseBatchAgeStatusLabel,
  releaseBatchAgeSummary,
  type ReleaseBatchAgeInput
} from "./prospect-release-batch-age.js";

const clock = new Date("2026-10-30T12:00:00.000Z");
const at = (offsetMs: number) => new Date(clock.getTime() + offsetMs).toISOString();
const day = 86_400_000;
const forbidden = /空档|已到期|静默|跟进空档|逾期|有回复|即将到期|未临近|无序列到期|近期有外联|无外联记录|有动作|新近|未加入|近期有跟进|无记录|缺邮箱|卡住|积压较久|积压较新|无待处理回复|较久/;

function input(updatedAt: string, pending = true): ReleaseBatchAgeInput {
  return { pending, updatedAt };
}

const none = presentReleaseBatchAge(input("  ", false), clock);
assert.equal(none.kind, "none");
assert.equal(none.updatedMs, 0);
assert.equal(releaseBatchAgeLineLabel(none), "无待放行");
assert.equal(releaseBatchAgeStatusLabel(none), "无待放行");
assert.equal(releaseBatchAgeEntryLabel(), "查看待放行批次");
assert.match(releaseBatchAgeSummary(none), /^无待放行。/);
assert.match(releaseBatchAgeSummary(none), /超过 7 天算待放已久/);
assert.match(releaseBatchAgeSummary(none), /刚好 7 天仍算待放未久/);
assert.match(releaseBatchAgeSummary(none), /这不是回复待处理积压，也不是序列下一步到期，也不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄/);
assert.match(releaseBatchAgeSummary(none), /也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口/);
assert.match(releaseBatchAgeSummary(none), /也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住/);
assert.match(releaseBatchAgeSummary(none), /也不是待记跟进或今日到期，也不是外联序列进度/);
assert.match(releaseBatchAgeSummary(none), /也不是打开或点击、失败或抑制、收信同步/);
assert.match(releaseBatchAgeSummary(none), /不替代待发草稿那一块/);
assert.match(releaseBatchAgeSummary(none), /不会放行批次，不会发信，不会推进序列，不会改名单，也不会改 convert_to_lead 或 approved_contactable/);
assert.match(releaseBatchAgeSummary(none), /已放行的批次不算待放行/);
assert.match(releaseBatchAgeSummary(none), /跟进记录不算这批的时间/);
assert.match(releaseBatchAgeSummary(none), /加入短名单的时间不算这批的时间/);
assert.match(releaseBatchAgeSummary(none), /下次跟进那种时间不算这批的时间/);
assert.match(releaseBatchAgeSummary(none), /最近一封开发信的发出时间不算这批的时间/);
assert.match(releaseBatchAgeSummary(none), /序列下一步的计划时间不算这批的时间/);
assert.match(releaseBatchAgeSummary(none), /最近一次开发信回复的时间不算这批的时间/);
assert.match(releaseBatchAgeSummary(none), /最近触达（含话机）不算这批的时间/);
assert.match(releaseBatchAgeSummary(none), /收信同步的账号状态不算这批的时间/);
assert.doesNotMatch(releaseBatchAgeLineLabel(none), forbidden);
assert.equal(releaseBatchAgeMatchesFilter(none, "held"), false);
assert.equal(releaseBatchAgeMatchesFilter(none, "all"), true);
assert.equal(releaseBatchAgeRank(none), 2);
assert.equal(releaseBatchAgeListFilterForOpen(none), "all");
assert.equal(presentReleaseBatchAge(input("", true), clock).kind, "none");
assert.equal(presentReleaseBatchAge(input("刚刚", true), clock).kind, "none");
assert.equal(presentReleaseBatchAge(input("不是时间", true), clock).kind, "none");
assert.equal(presentReleaseBatchAge(input(at(-30 * day), false), clock).kind, "none", "已放行或没有待放行批次时，即使带了时间也是无待放行");

const heldAt = new Date(clock.getTime() - 8 * day);
const held = presentReleaseBatchAge(input(heldAt.toISOString(), true), clock);
assert.equal(held.kind, "held");
assert.equal(held.updatedMs, heldAt.getTime());
assert.equal(formatReleaseBatchAgeAt(held.updatedMs), formatReleaseBatchAgeAt(heldAt.getTime()));
assert.equal(releaseBatchAgeLineLabel(held), `待放已久 · ${formatReleaseBatchAgeAt(held.updatedMs)}`);
assert.match(releaseBatchAgeSummary(held), /^待放已久 /);
assert.doesNotMatch(releaseBatchAgeLineLabel(held), forbidden);
assert.doesNotMatch(releaseBatchAgeLineLabel(held), /待放未久|无待放行/);
assert.equal(releaseBatchAgeMatchesFilter(held, "held"), true);
assert.equal(releaseBatchAgeRank(held), 0);
assert.equal(releaseBatchAgeStatusLabel(held), "待放已久");
assert.equal(releaseBatchAgeListFilterForOpen(held), "held");

const justOver = presentReleaseBatchAge(input(at(-(RELEASE_BATCH_AGE_WINDOW_DAYS * day + 1)), true), clock);
assert.equal(justOver.kind, "held", "超过 7 天算待放已久");

const exact = presentReleaseBatchAge(input(at(-RELEASE_BATCH_AGE_WINDOW_DAYS * day), true), clock);
assert.equal(exact.kind, "recent", "刚好 7 天仍算待放未久");
assert.equal(releaseBatchAgeLineLabel(exact).startsWith("待放未久 · "), true);
assert.equal(releaseBatchAgeRank(exact), 1);
assert.equal(releaseBatchAgeMatchesFilter(exact, "held"), false);
assert.equal(releaseBatchAgeStatusLabel(exact), "待放未久");
assert.equal(releaseBatchAgeListFilterForOpen(exact), "all");
assert.doesNotMatch(releaseBatchAgeLineLabel(exact), forbidden);
assert.doesNotMatch(releaseBatchAgeLineLabel(exact), /待放已久|无待放行/);

const justInside = presentReleaseBatchAge(input(at(-(RELEASE_BATCH_AGE_WINDOW_DAYS * day - 1)), true), clock);
assert.equal(justInside.kind, "recent");

const exactNow = presentReleaseBatchAge(input(at(0), true), clock);
assert.equal(exactNow.kind, "recent", "此刻仍算待放未久");
assert.equal(releaseBatchAgeMatchesFilter(exactNow, "held"), false);

const future = presentReleaseBatchAge(input(at(day), true), clock);
assert.equal(future.kind, "recent", "比现在更晚的可解析批次时间仍算待放未久");

const recent = presentReleaseBatchAge(input(at(-2 * day), true), clock);
assert.equal(recent.kind, "recent");
assert.match(releaseBatchAgeSummary(recent), /^待放未久 /);

const frozenSource = input(at(-8 * day), true);
const frozen = Object.freeze(frozenSource);
presentReleaseBatchAge(frozen, clock);
assert.equal(frozen.updatedAt, frozenSource.updatedAt);
assert.equal(frozen.pending, true);

const rows = [
  { id: "recent-later", updatedAt: at(-1 * day), pending: true },
  { id: "held-later", updatedAt: at(-9 * day), pending: true },
  { id: "held-earlier", updatedAt: at(-12 * day), pending: true },
  { id: "none", updatedAt: "", pending: true },
  { id: "released", updatedAt: at(-20 * day), pending: false },
  { id: "invalid", updatedAt: "不是时间", pending: true },
  { id: "recent-earlier", updatedAt: at(-6 * day), pending: true },
  { id: "exact", updatedAt: at(-7 * day), pending: true }
];
const queue = listReleaseBatchAgeQueue(rows, (row) => presentReleaseBatchAge(input(row.updatedAt, row.pending), clock));
assert.deepEqual(queue.rows.map((row) => row.id), [
  "held-earlier",
  "held-later",
  "exact",
  "recent-earlier",
  "recent-later"
]);
assert.equal(queue.total, 5);
assert.equal(RELEASE_BATCH_AGE_LIMIT, 8);
assert.equal(RELEASE_BATCH_AGE_WINDOW_DAYS, 7);

const many = Array.from({ length: 9 }, (_, index) => ({
  id: `s${index}`,
  updatedAt: at(-(20 - index) * day),
  pending: true
}));
const capped = listReleaseBatchAgeQueue(many, (row) => presentReleaseBatchAge(input(row.updatedAt, row.pending), clock));
assert.equal(capped.total, 9);
assert.equal(capped.rows.length, 8);
assert.deepEqual(capped.rows.map((row) => row.id), ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
assert.equal(presentReleaseBatchAge(input(capped.rows[0]?.updatedAt || "", true), clock).kind, "held");

const tied = listReleaseBatchAgeQueue(
  [
    { id: "b", updatedAt: at(-10 * day), pending: true },
    { id: "a", updatedAt: at(-10 * day), pending: true }
  ],
  (row) => presentReleaseBatchAge(input(row.updatedAt, row.pending), clock)
);
assert.deepEqual(tied.rows.map((row) => row.id), ["a", "b"]);

const onlyNone = listReleaseBatchAgeQueue(
  [
    { id: "blank", updatedAt: "", pending: true },
    { id: "bad", updatedAt: "刚刚", pending: true },
    { id: "released", updatedAt: at(-12 * day), pending: false }
  ],
  (row) => presentReleaseBatchAge(input(row.updatedAt, row.pending), clock)
);
assert.equal(onlyNone.total, 0);
assert.deepEqual(onlyNone.rows, []);

const mixedCap = listReleaseBatchAgeQueue(
  [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `due${index}`, updatedAt: at(-(index + 8) * day), pending: true })),
    { id: "none", updatedAt: "", pending: false }
  ],
  (row) => presentReleaseBatchAge(input(row.updatedAt, row.pending), clock)
);
assert.equal(mixedCap.total, 8);
assert.equal(mixedCap.rows.some((row) => row.id === "none"), false);

const recentDoesNotCrowd = listReleaseBatchAgeQueue(
  [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `old${index}`, updatedAt: at(-(index + 9) * day), pending: true })),
    { id: "new", updatedAt: at(-1 * day), pending: true },
    { id: "blank", updatedAt: "", pending: true }
  ],
  (row) => presentReleaseBatchAge(input(row.updatedAt, row.pending), clock),
  8
);
assert.equal(recentDoesNotCrowd.rows.some((row) => row.id === "new"), false);
assert.equal(recentDoesNotCrowd.rows.some((row) => row.id === "blank"), false);
assert.equal(recentDoesNotCrowd.rows[0]?.id, "old7");

console.log("prospect-release-batch-age-test: ok");
