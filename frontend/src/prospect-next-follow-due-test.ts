import assert from "node:assert/strict";
import {
  NEXT_FOLLOW_DUE_LIMIT,
  formatNextFollowDue,
  listNextFollowDueQueue,
  nextFollowDueEntryLabel,
  nextFollowDueLineLabel,
  nextFollowDueMatchesFilter,
  nextFollowDueRank,
  nextFollowDueSummary,
  presentNextFollowDue
} from "./prospect-next-follow-due.js";

const clock = new Date(2026, 9, 30, 12, 0, 0);

const empty = presentNextFollowDue("  ", clock);
assert.equal(empty.kind, "empty");
assert.equal(nextFollowDueLineLabel(empty), "无下次跟进");
assert.equal(nextFollowDueEntryLabel(), "去下次跟进");
assert.match(nextFollowDueSummary(empty), /^无下次跟进。/);
assert.match(nextFollowDueSummary(empty), /这不是获客待办摘要，也不是待记跟进，也不是今日到期/);
assert.match(nextFollowDueSummary(empty), /也不是待发草稿，也不是外联序列，也不是回复条，也不是打开或点击条，也不是失败条，也不是抑制条，也不是收信同步/);
assert.match(nextFollowDueSummary(empty), /不会自动跟进，不会改时间，不会发信，也不会改 convert_to_lead 或 approved_contactable/);
assert.doesNotMatch(nextFollowDueLineLabel(empty), /已逾期|今日到期|未设下次跟进|暂无跟进|无回复|无待发草稿|无序列|获客待办摘要/);
assert.equal(nextFollowDueMatchesFilter(empty, "overdue"), false);
assert.equal(nextFollowDueMatchesFilter(empty, "today"), false);
assert.equal(nextFollowDueMatchesFilter(empty, "all"), true);
assert.equal(presentNextFollowDue(undefined, clock).kind, "empty");

const overdue = presentNextFollowDue("2026-10-29 18:00", clock);
assert.equal(overdue.kind, "overdue");
assert.equal(overdue.at, "2026-10-29 18:00");
assert.equal(formatNextFollowDue(overdue), "10-29 18:00");
assert.equal(nextFollowDueLineLabel(overdue), "逾期 · 10-29 18:00");
assert.match(nextFollowDueSummary(overdue), /^逾期 10-29 18:00。/);
assert.doesNotMatch(nextFollowDueLineLabel(overdue), /已逾期|今日到期|未设下次跟进/);
assert.equal(nextFollowDueMatchesFilter(overdue, "overdue"), true);
assert.equal(nextFollowDueMatchesFilter(overdue, "today"), false);
assert.equal(nextFollowDueRank(overdue), 0);

const sameMorning = presentNextFollowDue("2026-10-30 09:00", clock);
assert.equal(sameMorning.kind, "overdue", "今天已经过去的时刻算逾期，不算今日");

const exactNow = presentNextFollowDue("2026-10-30 12:00", clock);
assert.equal(exactNow.kind, "today", "正好当前时刻还算今日");

const today = presentNextFollowDue("2026-10-30T15:30", clock);
assert.equal(today.kind, "today");
assert.equal(today.at, "2026-10-30 15:30");
assert.equal(nextFollowDueLineLabel(today), "今日 · 10-30 15:30");
assert.equal(nextFollowDueMatchesFilter(today, "today"), true);
assert.equal(nextFollowDueMatchesFilter(today, "overdue"), false);
assert.equal(nextFollowDueRank(today), 1);
assert.doesNotMatch(nextFollowDueLineLabel(today), /今日到期|已逾期/);

const upcoming = presentNextFollowDue("2026-10-31 09:00", clock);
assert.equal(upcoming.kind, "upcoming");
assert.equal(nextFollowDueLineLabel(upcoming), "未到 · 10-31 09:00");
assert.equal(nextFollowDueMatchesFilter(upcoming, "overdue"), false);
assert.equal(nextFollowDueMatchesFilter(upcoming, "today"), false);
assert.equal(nextFollowDueMatchesFilter(upcoming, "all"), true);
assert.equal(nextFollowDueRank(upcoming), 2);

const legacy = presentNextFollowDue("明天 10:00", clock);
assert.equal(legacy.kind, "upcoming", "解析不了的旧文本不算逾期");
assert.equal(nextFollowDueLineLabel(legacy), "未到 · 明天 10:00");
assert.equal(legacy.dueAt, 0);

const rows = [
  { id: "up", shortlisted: true, nextFollowAt: "2026-10-31 09:00" },
  { id: "today", shortlisted: true, nextFollowAt: "2026-10-30 15:30" },
  { id: "late", shortlisted: true, nextFollowAt: "2026-10-29 18:00" },
  { id: "earlier", shortlisted: true, nextFollowAt: "2026-10-28 08:00" },
  { id: "empty", shortlisted: true, nextFollowAt: "" },
  { id: "legacy", shortlisted: true, nextFollowAt: "明天 10:00" },
  { id: "out", shortlisted: false, nextFollowAt: "2026-10-01 09:00" }
];
const queue = listNextFollowDueQueue(rows, (row) => row.shortlisted, clock);
assert.deepEqual(queue.rows.map((row) => row.id), ["earlier", "late", "today", "up", "legacy"]);
assert.equal(queue.total, 5);
assert.equal(NEXT_FOLLOW_DUE_LIMIT, 8);

const many = Array.from({ length: 9 }, (_, index) => ({
  id: `d${index}`,
  nextFollowAt: `2026-10-${String(index + 1).padStart(2, "0")} 08:00`
}));
many.push({ id: "later-today", nextFollowAt: "2026-10-30 18:00" });
const capped = listNextFollowDueQueue(many, () => true, clock);
assert.equal(capped.total, 10);
assert.equal(capped.rows.length, 8);
assert.deepEqual(capped.rows.map((row) => row.id), ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"]);
assert.equal(presentNextFollowDue(capped.rows[0]?.nextFollowAt, clock).kind, "overdue");
assert.ok(capped.rows.every((row) => presentNextFollowDue(row.nextFollowAt, clock).kind === "overdue"));

console.log("prospect-next-follow-due-test: ok");
