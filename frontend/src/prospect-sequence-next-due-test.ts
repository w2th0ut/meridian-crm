import assert from "node:assert/strict";
import {
  SEQUENCE_NEXT_DUE_LIMIT,
  SEQUENCE_NEXT_DUE_WINDOW_DAYS,
  formatSequenceNextDueAt,
  listSequenceNextDueQueue,
  presentSequenceNextDue,
  sequenceNextDueEntryLabel,
  sequenceNextDueLineLabel,
  sequenceNextDueListFilterForOpen,
  sequenceNextDueMatchesFilter,
  sequenceNextDueRank,
  sequenceNextDueStatusLabel,
  sequenceNextDueSummary,
  type SequenceNextDueInput
} from "./prospect-sequence-next-due.js";

const clock = new Date("2026-10-30T12:00:00.000Z");
const at = (offsetMs: number) => new Date(clock.getTime() + offsetMs).toISOString();
const day = 86_400_000;

function input(dueAt: string): SequenceNextDueInput {
  return { dueAt };
}

const none = presentSequenceNextDue(input("  "), clock);
assert.equal(none.kind, "none");
assert.equal(none.dueMs, 0);
assert.equal(sequenceNextDueLineLabel(none), "无序列到期");
assert.equal(sequenceNextDueStatusLabel(none), "无序列到期");
assert.equal(sequenceNextDueEntryLabel(), "查看外联序列");
assert.match(sequenceNextDueSummary(none), /^无序列到期。/);
assert.match(sequenceNextDueSummary(none), /到期早于现在算已到期/);
assert.match(sequenceNextDueSummary(none), /刚好 7 天和此刻仍算即将到期/);
assert.match(sequenceNextDueSummary(none), /再远算未临近/);
assert.match(sequenceNextDueSummary(none), /这不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄/);
assert.match(sequenceNextDueSummary(none), /也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口/);
assert.match(sequenceNextDueSummary(none), /也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住/);
assert.match(sequenceNextDueSummary(none), /也不是待记跟进或今日到期，也不是待发草稿，也不是外联序列进度/);
assert.match(sequenceNextDueSummary(none), /也不是回复、打开或点击、失败或抑制、收信同步/);
assert.match(sequenceNextDueSummary(none), /不会发信，不会推进序列，不会改名单，也不会改 convert_to_lead 或 approved_contactable/);
assert.match(sequenceNextDueSummary(none), /更新时间不算下一步到期/);
assert.match(sequenceNextDueSummary(none), /跟进记录不算下一步到期/);
assert.match(sequenceNextDueSummary(none), /加入短名单的时间不算下一步到期/);
assert.match(sequenceNextDueSummary(none), /下次跟进那种时间不算下一步到期/);
assert.match(sequenceNextDueSummary(none), /最近一封开发信的时间不算下一步到期/);
assert.match(sequenceNextDueSummary(none), /最近触达（含话机）不算下一步到期/);
assert.doesNotMatch(sequenceNextDueLineLabel(none), /空档|静默|跟进空档|加入日龄|逾期|近期有外联|无外联记录|有动作|较久|新近|未加入|无记录|缺邮箱|卡住/);
assert.equal(sequenceNextDueMatchesFilter(none, "overdue"), false);
assert.equal(sequenceNextDueMatchesFilter(none, "all"), true);
assert.equal(sequenceNextDueRank(none), 3);
assert.equal(sequenceNextDueListFilterForOpen(none), "all");
assert.equal(presentSequenceNextDue(input(""), clock).kind, "none");
assert.equal(presentSequenceNextDue(input("刚刚"), clock).kind, "none");
assert.equal(presentSequenceNextDue(input("明天"), clock).kind, "none");
assert.equal(presentSequenceNextDue(input("不是时间"), clock).kind, "none");

const wallClock = presentSequenceNextDue(input("2026-10-01 09:00"), clock);
assert.equal(wallClock.kind, "none", "下次跟进那种时间不是序列下一步到期");
assert.equal(sequenceNextDueLineLabel(wallClock), "无序列到期");
assert.equal(sequenceNextDueMatchesFilter(wallClock, "overdue"), false);

const overdueAt = new Date(clock.getTime() - 2 * day);
const overdue = presentSequenceNextDue(input(overdueAt.toISOString()), clock);
assert.equal(overdue.kind, "overdue");
assert.equal(overdue.dueMs, overdueAt.getTime());
assert.equal(formatSequenceNextDueAt(overdue.dueMs), formatSequenceNextDueAt(overdueAt.getTime()));
assert.equal(sequenceNextDueLineLabel(overdue), `已到期 · ${formatSequenceNextDueAt(overdue.dueMs)}`);
assert.match(sequenceNextDueSummary(overdue), /^已到期 /);
assert.doesNotMatch(sequenceNextDueLineLabel(overdue), /空档|静默|跟进空档|加入日龄|逾期|即将到期|未临近|无序列到期/);
assert.equal(sequenceNextDueMatchesFilter(overdue, "overdue"), true);
assert.equal(sequenceNextDueRank(overdue), 0);
assert.equal(sequenceNextDueStatusLabel(overdue), "已到期");
assert.equal(sequenceNextDueListFilterForOpen(overdue), "overdue");

const justPast = presentSequenceNextDue(input(at(-1)), clock);
assert.equal(justPast.kind, "overdue", "早于现在算已到期");

const exactNow = presentSequenceNextDue(input(at(0)), clock);
assert.equal(exactNow.kind, "soon", "此刻还没早于现在，算即将到期");
assert.equal(sequenceNextDueMatchesFilter(exactNow, "overdue"), false);
assert.equal(sequenceNextDueStatusLabel(exactNow), "即将到期");
assert.equal(sequenceNextDueListFilterForOpen(exactNow), "all");

const exact = presentSequenceNextDue(input(at(SEQUENCE_NEXT_DUE_WINDOW_DAYS * day)), clock);
assert.equal(exact.kind, "soon", "刚好 7 天仍算即将到期");
assert.equal(sequenceNextDueLineLabel(exact).startsWith("即将到期 · "), true);
assert.equal(sequenceNextDueRank(exact), 1);
assert.doesNotMatch(sequenceNextDueLineLabel(exact), /空档|静默|逾期|未临近|无序列到期/);

const justInside = presentSequenceNextDue(input(at(SEQUENCE_NEXT_DUE_WINDOW_DAYS * day - 1)), clock);
assert.equal(justInside.kind, "soon");

const justOver = presentSequenceNextDue(input(at(SEQUENCE_NEXT_DUE_WINDOW_DAYS * day + 1)), clock);
assert.equal(justOver.kind, "later", "超过 7 天算未临近");
assert.equal(sequenceNextDueStatusLabel(justOver), "未临近");
assert.equal(sequenceNextDueLineLabel(justOver).startsWith("未临近 · "), true);
assert.equal(sequenceNextDueMatchesFilter(justOver, "overdue"), false);
assert.equal(sequenceNextDueRank(justOver), 2);
assert.equal(sequenceNextDueListFilterForOpen(justOver), "all");
assert.doesNotMatch(sequenceNextDueLineLabel(justOver), /空档|静默|跟进空档|加入日龄|逾期|已到期|即将到期|无序列到期/);

const later = presentSequenceNextDue(input(at(12 * day)), clock);
assert.equal(later.kind, "later");
assert.match(sequenceNextDueSummary(later), /^未临近 /);

const frozenSource = input(at(-2 * day));
const frozen = Object.freeze(frozenSource);
presentSequenceNextDue(frozen, clock);
assert.equal(frozen.dueAt, frozenSource.dueAt);

const rows = [
  { id: "soon-later", dueAt: at(5 * day) },
  { id: "overdue-later", dueAt: at(-1 * day) },
  { id: "overdue-earlier", dueAt: at(-4 * day) },
  { id: "none", dueAt: "" },
  { id: "wall", dueAt: "2026-09-01 09:00" },
  { id: "later", dueAt: at(10 * day) },
  { id: "soon-earlier", dueAt: at(1 * day) },
  { id: "exact", dueAt: at(7 * day) }
];
const queue = listSequenceNextDueQueue(rows, (row) => presentSequenceNextDue(input(row.dueAt), clock));
assert.deepEqual(queue.rows.map((row) => row.id), [
  "overdue-earlier",
  "overdue-later",
  "soon-earlier",
  "soon-later",
  "exact",
  "later"
]);
assert.equal(queue.total, 6);
assert.equal(SEQUENCE_NEXT_DUE_LIMIT, 8);
assert.equal(SEQUENCE_NEXT_DUE_WINDOW_DAYS, 7);

const many = Array.from({ length: 9 }, (_, index) => ({
  id: `o${index}`,
  dueAt: at(-(20 - index) * day)
}));
const capped = listSequenceNextDueQueue(many, (row) => presentSequenceNextDue(input(row.dueAt), clock));
assert.equal(capped.total, 9);
assert.equal(capped.rows.length, 8);
assert.deepEqual(capped.rows.map((row) => row.id), ["o0", "o1", "o2", "o3", "o4", "o5", "o6", "o7"]);
assert.equal(presentSequenceNextDue(input(capped.rows[0]?.dueAt || ""), clock).kind, "overdue");

const tied = listSequenceNextDueQueue(
  [
    { id: "b", dueAt: at(-3 * day) },
    { id: "a", dueAt: at(-3 * day) }
  ],
  (row) => presentSequenceNextDue(input(row.dueAt), clock)
);
assert.deepEqual(tied.rows.map((row) => row.id), ["a", "b"]);

const onlyNone = listSequenceNextDueQueue(
  [
    { id: "blank", dueAt: "" },
    { id: "wall", dueAt: "2026-10-01 09:00" }
  ],
  (row) => presentSequenceNextDue(input(row.dueAt), clock)
);
assert.equal(onlyNone.total, 0);
assert.deepEqual(onlyNone.rows, []);

const mixedCap = listSequenceNextDueQueue(
  [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `due${index}`, dueAt: at(-index * day - 1000) })),
    { id: "none", dueAt: "" }
  ],
  (row) => presentSequenceNextDue(input(row.dueAt), clock)
);
assert.equal(mixedCap.total, 8);
assert.equal(mixedCap.rows.some((row) => row.id === "none"), false);

console.log("prospect-sequence-next-due-test: ok");
