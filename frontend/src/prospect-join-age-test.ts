import assert from "node:assert/strict";
import {
  JOIN_AGE_LIMIT,
  JOIN_AGE_WINDOW_DAYS,
  joinAgeDaysLabel,
  joinAgeEntryLabel,
  joinAgeIsOlder,
  joinAgeLineLabel,
  joinAgeListFilterForOpen,
  joinAgeMatchesFilter,
  joinAgeRank,
  joinAgeStatusLabel,
  joinAgeSummary,
  formatJoinAgeAt,
  listJoinAgeQueue,
  presentJoinAge,
  type JoinAgeInput
} from "./prospect-join-age.js";

const clock = new Date("2026-10-30T12:00:00.000Z");
const day = 86_400_000;
const at = (offsetMs: number) => new Date(clock.getTime() + offsetMs).toISOString();

function input(shortlistedAt: string): JoinAgeInput {
  return { shortlistedAt };
}

const absent = presentJoinAge(input("  "), clock);
assert.equal(absent.kind, "none");
assert.equal(absent.joinedAtMs, 0);
assert.equal(absent.ageDays, 0);
assert.equal(joinAgeLineLabel(absent), "未加入");
assert.equal(joinAgeStatusLabel(absent), "未加入");
assert.equal(joinAgeDaysLabel(absent), "");
assert.equal(joinAgeEntryLabel(), "查看加入时间");
assert.match(joinAgeSummary(absent), /^未加入。/);
assert.match(joinAgeSummary(absent), /这不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口，也不是跟进记录空档/);
assert.match(joinAgeSummary(absent), /也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住/);
assert.match(joinAgeSummary(absent), /也不是待记跟进或今日到期，也不是待发草稿、外联序列、回复、打开或点击、失败或抑制、收信同步/);
assert.match(joinAgeSummary(absent), /不会改名单，不会发信，也不会改 convert_to_lead 或 approved_contactable/);
assert.match(joinAgeSummary(absent), /超过 7 天算较久/);
assert.match(joinAgeSummary(absent), /创建时间不算加入时间/);
assert.match(joinAgeSummary(absent), /刚好 7 天仍算新近/);
assert.doesNotMatch(joinAgeLineLabel(absent), /缺邮箱|缺电话|完备|无联系字段|空档|无记录|卡住|推进中|无阶段|逾期|覆盖池|获客待办|发信资格|已抑制/);
assert.equal(joinAgeMatchesFilter(absent, "older"), false);
assert.equal(joinAgeMatchesFilter(absent, "all"), true);
assert.equal(joinAgeIsOlder(absent), false);
assert.equal(joinAgeRank(absent), 2);
assert.equal(joinAgeListFilterForOpen(absent), "all");
assert.equal(presentJoinAge(input(""), clock).kind, "none");
assert.equal(presentJoinAge(input("不是时间"), clock).kind, "none");

const olderAt = new Date(clock.getTime() - 12 * day);
const older = presentJoinAge(input(olderAt.toISOString()), clock);
assert.equal(older.kind, "older");
assert.equal(older.joinedAtMs, olderAt.getTime());
assert.equal(older.ageDays, 12);
assert.equal(formatJoinAgeAt(older.joinedAtMs), formatJoinAgeAt(olderAt.getTime()));
assert.equal(joinAgeLineLabel(older), `较久 · 加入 12 天 · ${formatJoinAgeAt(older.joinedAtMs)}`);
assert.equal(joinAgeStatusLabel(older), "较久");
assert.equal(joinAgeDaysLabel(older), "加入 12 天");
assert.match(joinAgeSummary(older), /^较久 加入 12 天 /);
assert.doesNotMatch(joinAgeLineLabel(older), /缺邮箱|空档|卡住|逾期|覆盖池|无联系字段|新近|未加入/);
assert.equal(joinAgeMatchesFilter(older, "older"), true);
assert.equal(joinAgeIsOlder(older), true);
assert.equal(joinAgeRank(older), 0);
assert.equal(joinAgeListFilterForOpen(older), "older");

const justOver = presentJoinAge(input(at(-JOIN_AGE_WINDOW_DAYS * day - 1)), clock);
assert.equal(justOver.kind, "older", "超过 7 天算较久");
assert.equal(justOver.ageDays, 7);
assert.equal(joinAgeStatusLabel(justOver), "较久");
assert.equal(joinAgeDaysLabel(justOver), "加入 7 天");

const exact = presentJoinAge(input(at(-JOIN_AGE_WINDOW_DAYS * day)), clock);
assert.equal(exact.kind, "recent", "刚好 7 天仍算新近");
assert.equal(exact.ageDays, 7);
assert.equal(joinAgeLineLabel(exact).startsWith("新近 · 加入 7 天 · "), true);
assert.equal(joinAgeMatchesFilter(exact, "older"), false);
assert.equal(joinAgeIsOlder(exact), false);
assert.equal(joinAgeRank(exact), 1);
assert.equal(joinAgeStatusLabel(exact), "新近");
assert.equal(joinAgeListFilterForOpen(exact), "all");
assert.match(joinAgeSummary(exact), /^新近 加入 7 天 /);

const recent = presentJoinAge(input(at(-2 * day)), clock);
assert.equal(recent.kind, "recent");
assert.equal(recent.ageDays, 2);
assert.equal(joinAgeDaysLabel(recent), "加入 2 天");

const sameDay = presentJoinAge(input(at(-60 * 60 * 1000)), clock);
assert.equal(sameDay.kind, "recent");
assert.equal(sameDay.ageDays, 0);
assert.equal(joinAgeDaysLabel(sameDay), "加入 0 天");

const future = presentJoinAge(input(at(day)), clock);
assert.equal(future.kind, "recent");
assert.equal(future.ageDays, 0);
assert.equal(joinAgeLineLabel(future).startsWith("新近 · 加入 0 天 · "), true);

const padded = presentJoinAge(input(`  ${at(-9 * day)}  `), clock);
assert.equal(padded.kind, "older");
assert.equal(padded.ageDays, 9);

const frozenSource = input(at(-8 * day));
const frozen = Object.freeze(frozenSource);
presentJoinAge(frozen, clock);
assert.equal(frozen.shortlistedAt, frozenSource.shortlistedAt);
assert.equal(presentJoinAge(frozen, clock).kind, "older");

const rows = [
  { id: "recent-b", at: at(-1 * day) },
  { id: "older-b", at: at(-10 * day) },
  { id: "older-a", at: at(-20 * day) },
  { id: "none", at: "" },
  { id: "recent-a", at: at(-2 * day) },
  { id: "bad", at: "明天" }
];
const queue = listJoinAgeQueue(rows, (row) => presentJoinAge(input(row.at), clock));
assert.deepEqual(queue.rows.map((row) => row.id), ["older-a", "older-b", "recent-a", "recent-b"]);
assert.equal(queue.total, 4);
assert.equal(JOIN_AGE_LIMIT, 8);
assert.equal(JOIN_AGE_WINDOW_DAYS, 7);

const many = Array.from({ length: 9 }, (_, index) => ({
  id: `o${index}`,
  at: at(-(20 - index) * day)
}));
const capped = listJoinAgeQueue(many, (row) => presentJoinAge(input(row.at), clock));
assert.equal(capped.total, 9);
assert.equal(capped.rows.length, 8);
assert.deepEqual(capped.rows.map((row) => row.id), ["o0", "o1", "o2", "o3", "o4", "o5", "o6", "o7"]);

const tied = listJoinAgeQueue(
  [
    { id: "b", at: at(-12 * day) },
    { id: "a", at: at(-12 * day) }
  ],
  (row) => presentJoinAge(input(row.at), clock)
);
assert.deepEqual(tied.rows.map((row) => row.id), ["a", "b"]);

const olderFirst = listJoinAgeQueue(
  [
    { id: "new", at: at(-1 * day) },
    { id: "old", at: at(-30 * day) }
  ],
  (row) => presentJoinAge(input(row.at), clock)
);
assert.deepEqual(olderFirst.rows.map((row) => row.id), ["old", "new"]);

console.log("prospect-join-age-test: ok");
