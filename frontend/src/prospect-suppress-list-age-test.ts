import assert from "node:assert/strict";
import {
  SUPPRESS_LIST_AGE_LIMIT,
  SUPPRESS_LIST_AGE_WINDOW_DAYS,
  formatSuppressListAgeAt,
  listSuppressListAgeQueue,
  presentSuppressListAge,
  suppressListAgeEntryLabel,
  suppressListAgeLineLabel,
  suppressListAgeListFilterForOpen,
  suppressListAgeMatchesFilter,
  suppressListAgeRank,
  suppressListAgeStatusLabel,
  suppressListAgeSummary,
  type SuppressListAgeInput
} from "./prospect-suppress-list-age.js";

const clock = new Date("2026-10-30T12:00:00.000Z");
const at = (offsetMs: number) => new Date(clock.getTime() + offsetMs).toISOString();
const day = 86_400_000;
const forbidden = /空档|已到期|静默|跟进空档|逾期|有回复|即将到期|未临近|无序列到期|近期有外联|无外联记录|有动作|新近|未加入|近期有跟进|无记录|缺邮箱|卡住|积压较久|积压较新|无待处理回复|较久|待放已久|待放未久|无待放行/;

function input(effectiveAt: string, held = true): SuppressListAgeInput {
  return { held, effectiveAt };
}

const none = presentSuppressListAge(input("  ", false), clock);
assert.equal(none.kind, "none");
assert.equal(none.effectiveMs, 0);
assert.equal(suppressListAgeLineLabel(none), "无抑制日龄");
assert.equal(suppressListAgeStatusLabel(none), "无抑制日龄");
assert.equal(suppressListAgeEntryLabel(), "查看抑制或退订");
assert.match(suppressListAgeSummary(none), /^无抑制日龄。/);
assert.match(suppressListAgeSummary(none), /超过 7 天算抑制超七日/);
assert.match(suppressListAgeSummary(none), /刚好 7 天仍算抑制七日内/);
assert.match(suppressListAgeSummary(none), /这不是待放行批次，也不是回复待处理积压，也不是序列下一步到期，也不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄/);
assert.match(suppressListAgeSummary(none), /也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口/);
assert.match(suppressListAgeSummary(none), /也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住/);
assert.match(suppressListAgeSummary(none), /也不是待记跟进或今日到期，也不是待发草稿、外联序列进度/);
assert.match(suppressListAgeSummary(none), /也不是打开或点击、失败或退信、收信同步/);
assert.match(suppressListAgeSummary(none), /不替代抑制或退订原因那一块/);
assert.match(suppressListAgeSummary(none), /不会解除抑制，不会发信，不会改名单，也不会改 convert_to_lead 或 approved_contactable/);
assert.match(suppressListAgeSummary(none), /退信和联系方式无效不算抑制名单/);
assert.match(suppressListAgeSummary(none), /跟进记录不算这次抑制的时间/);
assert.match(suppressListAgeSummary(none), /加入短名单的时间不算这次抑制的时间/);
assert.match(suppressListAgeSummary(none), /下次跟进那种时间不算这次抑制的时间/);
assert.match(suppressListAgeSummary(none), /最近一封开发信的发出时间不算这次抑制的时间/);
assert.match(suppressListAgeSummary(none), /序列下一步的计划时间不算这次抑制的时间/);
assert.match(suppressListAgeSummary(none), /最近一次开发信回复的时间不算这次抑制的时间/);
assert.match(suppressListAgeSummary(none), /最近触达（含话机）不算这次抑制的时间/);
assert.match(suppressListAgeSummary(none), /收信同步的账号状态不算这次抑制的时间/);
assert.match(suppressListAgeSummary(none), /待放行批次的更新时间不算这次抑制的时间/);
assert.doesNotMatch(suppressListAgeLineLabel(none), forbidden);
assert.equal(suppressListAgeMatchesFilter(none, "long"), false);
assert.equal(suppressListAgeMatchesFilter(none, "all"), true);
assert.equal(suppressListAgeRank(none), 2);
assert.equal(suppressListAgeListFilterForOpen(none), "all");
assert.equal(presentSuppressListAge(input("", true), clock).kind, "none");
assert.equal(presentSuppressListAge(input("刚刚", true), clock).kind, "none");
assert.equal(presentSuppressListAge(input("不是时间", true), clock).kind, "none");
assert.equal(presentSuppressListAge(input(at(-30 * day), false), clock).kind, "none", "没有抑制或退订时，即使带了时间也是无抑制日龄");

const longAt = new Date(clock.getTime() - 8 * day);
const long = presentSuppressListAge(input(longAt.toISOString(), true), clock);
assert.equal(long.kind, "long");
assert.equal(long.effectiveMs, longAt.getTime());
assert.equal(formatSuppressListAgeAt(long.effectiveMs), formatSuppressListAgeAt(longAt.getTime()));
assert.equal(suppressListAgeLineLabel(long), `抑制超七日 · ${formatSuppressListAgeAt(long.effectiveMs)}`);
assert.match(suppressListAgeSummary(long), /^抑制超七日 /);
assert.doesNotMatch(suppressListAgeLineLabel(long), forbidden);
assert.doesNotMatch(suppressListAgeLineLabel(long), /抑制七日内|无抑制日龄/);
assert.equal(suppressListAgeMatchesFilter(long, "long"), true);
assert.equal(suppressListAgeRank(long), 0);
assert.equal(suppressListAgeStatusLabel(long), "抑制超七日");
assert.equal(suppressListAgeListFilterForOpen(long), "long");

const justOver = presentSuppressListAge(input(at(-(SUPPRESS_LIST_AGE_WINDOW_DAYS * day + 1)), true), clock);
assert.equal(justOver.kind, "long", "超过 7 天算抑制超七日");

const exact = presentSuppressListAge(input(at(-SUPPRESS_LIST_AGE_WINDOW_DAYS * day), true), clock);
assert.equal(exact.kind, "recent", "刚好 7 天仍算抑制七日内");
assert.equal(suppressListAgeLineLabel(exact).startsWith("抑制七日内 · "), true);
assert.equal(suppressListAgeRank(exact), 1);
assert.equal(suppressListAgeMatchesFilter(exact, "long"), false);
assert.equal(suppressListAgeStatusLabel(exact), "抑制七日内");
assert.equal(suppressListAgeListFilterForOpen(exact), "all");
assert.doesNotMatch(suppressListAgeLineLabel(exact), forbidden);
assert.doesNotMatch(suppressListAgeLineLabel(exact), /抑制超七日|无抑制日龄/);

const justInside = presentSuppressListAge(input(at(-(SUPPRESS_LIST_AGE_WINDOW_DAYS * day - 1)), true), clock);
assert.equal(justInside.kind, "recent");

const exactNow = presentSuppressListAge(input(at(0), true), clock);
assert.equal(exactNow.kind, "recent", "此刻仍算抑制七日内");
assert.equal(suppressListAgeMatchesFilter(exactNow, "long"), false);

const future = presentSuppressListAge(input(at(day), true), clock);
assert.equal(future.kind, "recent", "比现在更晚的可解析生效时间仍算抑制七日内");

const recent = presentSuppressListAge(input(at(-2 * day), true), clock);
assert.equal(recent.kind, "recent");
assert.match(suppressListAgeSummary(recent), /^抑制七日内 /);

const frozenSource = input(at(-8 * day), true);
const frozen = Object.freeze(frozenSource);
presentSuppressListAge(frozen, clock);
assert.equal(frozen.effectiveAt, frozenSource.effectiveAt);
assert.equal(frozen.held, true);

const rows = [
  { id: "recent-later", effectiveAt: at(-1 * day), held: true },
  { id: "long-later", effectiveAt: at(-9 * day), held: true },
  { id: "long-earlier", effectiveAt: at(-12 * day), held: true },
  { id: "none", effectiveAt: "", held: true },
  { id: "clear", effectiveAt: at(-20 * day), held: false },
  { id: "invalid", effectiveAt: "不是时间", held: true },
  { id: "recent-earlier", effectiveAt: at(-6 * day), held: true },
  { id: "exact", effectiveAt: at(-7 * day), held: true }
];
const queue = listSuppressListAgeQueue(rows, (row) => presentSuppressListAge(input(row.effectiveAt, row.held), clock));
assert.deepEqual(queue.rows.map((row) => row.id), [
  "long-earlier",
  "long-later",
  "exact",
  "recent-earlier",
  "recent-later"
]);
assert.equal(queue.total, 5);
assert.equal(SUPPRESS_LIST_AGE_LIMIT, 8);
assert.equal(SUPPRESS_LIST_AGE_WINDOW_DAYS, 7);

const many = Array.from({ length: 9 }, (_, index) => ({
  id: `s${index}`,
  effectiveAt: at(-(20 - index) * day),
  held: true
}));
const capped = listSuppressListAgeQueue(many, (row) => presentSuppressListAge(input(row.effectiveAt, row.held), clock));
assert.equal(capped.total, 9);
assert.equal(capped.rows.length, 8);
assert.deepEqual(capped.rows.map((row) => row.id), ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
assert.equal(presentSuppressListAge(input(capped.rows[0]?.effectiveAt || "", true), clock).kind, "long");

const tied = listSuppressListAgeQueue(
  [
    { id: "b", effectiveAt: at(-10 * day), held: true },
    { id: "a", effectiveAt: at(-10 * day), held: true }
  ],
  (row) => presentSuppressListAge(input(row.effectiveAt, row.held), clock)
);
assert.deepEqual(tied.rows.map((row) => row.id), ["a", "b"]);

const onlyNone = listSuppressListAgeQueue(
  [
    { id: "blank", effectiveAt: "", held: true },
    { id: "bad", effectiveAt: "刚刚", held: true },
    { id: "clear", effectiveAt: at(-12 * day), held: false }
  ],
  (row) => presentSuppressListAge(input(row.effectiveAt, row.held), clock)
);
assert.equal(onlyNone.total, 0);
assert.deepEqual(onlyNone.rows, []);

const mixedCap = listSuppressListAgeQueue(
  [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `due${index}`, effectiveAt: at(-(index + 8) * day), held: true })),
    { id: "none", effectiveAt: "", held: false }
  ],
  (row) => presentSuppressListAge(input(row.effectiveAt, row.held), clock)
);
assert.equal(mixedCap.total, 8);
assert.equal(mixedCap.rows.some((row) => row.id === "none"), false);

const recentDoesNotCrowd = listSuppressListAgeQueue(
  [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `old${index}`, effectiveAt: at(-(index + 9) * day), held: true })),
    { id: "new", effectiveAt: at(-1 * day), held: true },
    { id: "blank", effectiveAt: "", held: true }
  ],
  (row) => presentSuppressListAge(input(row.effectiveAt, row.held), clock),
  8
);
assert.equal(recentDoesNotCrowd.rows.some((row) => row.id === "new"), false);
assert.equal(recentDoesNotCrowd.rows.some((row) => row.id === "blank"), false);
assert.equal(recentDoesNotCrowd.rows[0]?.id, "old7");

console.log("prospect-suppress-list-age-test: ok");
