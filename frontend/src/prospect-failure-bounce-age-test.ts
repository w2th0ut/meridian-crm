import assert from "node:assert/strict";
import { presentOutreachFailure } from "./prospect-outreach-failure.js";
import {
  FAILURE_BOUNCE_AGE_LIMIT,
  FAILURE_BOUNCE_AGE_WINDOW_DAYS,
  failureBounceAgeEntryLabel,
  failureBounceAgeLineLabel,
  failureBounceAgeListFilterForOpen,
  failureBounceAgeMatchesFilter,
  failureBounceAgeRank,
  failureBounceAgeStatusLabel,
  failureBounceAgeSummary,
  formatFailureBounceAgeAt,
  listFailureBounceAgeQueue,
  presentFailureBounceAge,
  type FailureBounceAgeInput
} from "./prospect-failure-bounce-age.js";

const clock = new Date("2026-10-30T12:00:00.000Z");
const at = (offsetMs: number) => new Date(clock.getTime() + offsetMs).toISOString();
const day = 86_400_000;
const forbidden = /空档|已到期|静默|跟进空档|逾期|有回复|即将到期|未临近|无序列到期|近期有外联|无外联记录|有动作|新近|未加入|近期有跟进|无记录|缺邮箱|卡住|积压较久|积压较新|无待处理回复|较久|待放已久|待放未久|无待放行|抑制超七日|抑制七日内|无抑制日龄|无失败记录|发送失败|开发信退信/;

function input(atValue: string, failed = true): FailureBounceAgeInput {
  return { failed, at: atValue };
}

const none = presentFailureBounceAge(input("  ", false), clock);
assert.equal(none.kind, "none");
assert.equal(none.atMs, 0);
assert.equal(failureBounceAgeLineLabel(none), "无失败日龄");
assert.equal(failureBounceAgeStatusLabel(none), "无失败日龄");
assert.equal(failureBounceAgeEntryLabel(), "查看失败或退信");
assert.match(failureBounceAgeSummary(none), /^无失败日龄。/);
assert.match(failureBounceAgeSummary(none), /超过 7 天算失败超七日/);
assert.match(failureBounceAgeSummary(none), /刚好 7 天仍算失败七日内/);
assert.match(failureBounceAgeSummary(none), /这不是抑制名单日龄，也不是待放行批次，也不是回复待处理积压，也不是序列下一步到期，也不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄/);
assert.match(failureBounceAgeSummary(none), /也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口/);
assert.match(failureBounceAgeSummary(none), /也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住/);
assert.match(failureBounceAgeSummary(none), /也不是待记跟进或今日到期，也不是待发草稿、外联序列进度/);
assert.match(failureBounceAgeSummary(none), /也不是打开或点击、收信同步/);
assert.match(failureBounceAgeSummary(none), /不替代开发信失败或退信那一块/);
assert.match(failureBounceAgeSummary(none), /不会自动重发，不会解除抑制，不会发信，不会改名单，也不会改 convert_to_lead 或 approved_contactable/);
assert.match(failureBounceAgeSummary(none), /抑制或退订的生效时间不算这次失败的时间/);
assert.match(failureBounceAgeSummary(none), /待放行批次的更新时间不算这次失败的时间/);
assert.match(failureBounceAgeSummary(none), /跟进记录不算这次失败的时间/);
assert.match(failureBounceAgeSummary(none), /加入短名单的时间不算这次失败的时间/);
assert.match(failureBounceAgeSummary(none), /下次跟进那种时间不算这次失败的时间/);
assert.match(failureBounceAgeSummary(none), /最近一封开发信的发出时间不算这次失败的时间/);
assert.match(failureBounceAgeSummary(none), /序列下一步的计划时间不算这次失败的时间/);
assert.match(failureBounceAgeSummary(none), /最近一次开发信回复的时间不算这次失败的时间/);
assert.match(failureBounceAgeSummary(none), /最近触达（含话机）不算这次失败的时间/);
assert.match(failureBounceAgeSummary(none), /收信同步的账号状态不算这次失败的时间/);
assert.doesNotMatch(failureBounceAgeLineLabel(none), forbidden);
assert.equal(failureBounceAgeMatchesFilter(none, "long"), false);
assert.equal(failureBounceAgeMatchesFilter(none, "all"), true);
assert.equal(failureBounceAgeRank(none), 2);
assert.equal(failureBounceAgeListFilterForOpen(none), "all");
assert.equal(presentFailureBounceAge(input("", true), clock).kind, "none");
assert.equal(presentFailureBounceAge(input("刚刚", true), clock).kind, "none");
assert.equal(presentFailureBounceAge(input("不是时间", true), clock).kind, "none");
assert.equal(presentFailureBounceAge(input(at(-30 * day), false), clock).kind, "none", "没有失败或退信时，即使带了时间也是无失败日龄");

const longAt = new Date(clock.getTime() - 8 * day);
const long = presentFailureBounceAge(input(longAt.toISOString(), true), clock);
assert.equal(long.kind, "long");
assert.equal(long.atMs, longAt.getTime());
assert.equal(formatFailureBounceAgeAt(long.atMs), formatFailureBounceAgeAt(longAt.getTime()));
assert.equal(failureBounceAgeLineLabel(long), `失败超七日 · ${formatFailureBounceAgeAt(long.atMs)}`);
assert.match(failureBounceAgeSummary(long), /^失败超七日 /);
assert.doesNotMatch(failureBounceAgeLineLabel(long), forbidden);
assert.doesNotMatch(failureBounceAgeLineLabel(long), /失败七日内|无失败日龄/);
assert.equal(failureBounceAgeMatchesFilter(long, "long"), true);
assert.equal(failureBounceAgeRank(long), 0);
assert.equal(failureBounceAgeStatusLabel(long), "失败超七日");
assert.equal(failureBounceAgeListFilterForOpen(long), "long");

const justOver = presentFailureBounceAge(input(at(-(FAILURE_BOUNCE_AGE_WINDOW_DAYS * day + 1)), true), clock);
assert.equal(justOver.kind, "long", "超过 7 天算失败超七日");

const exact = presentFailureBounceAge(input(at(-FAILURE_BOUNCE_AGE_WINDOW_DAYS * day), true), clock);
assert.equal(exact.kind, "recent", "刚好 7 天仍算失败七日内");
assert.equal(failureBounceAgeLineLabel(exact).startsWith("失败七日内 · "), true);
assert.equal(failureBounceAgeRank(exact), 1);
assert.equal(failureBounceAgeMatchesFilter(exact, "long"), false);
assert.equal(failureBounceAgeStatusLabel(exact), "失败七日内");
assert.equal(failureBounceAgeListFilterForOpen(exact), "all");
assert.doesNotMatch(failureBounceAgeLineLabel(exact), forbidden);
assert.doesNotMatch(failureBounceAgeLineLabel(exact), /失败超七日|无失败日龄/);

const justInside = presentFailureBounceAge(input(at(-(FAILURE_BOUNCE_AGE_WINDOW_DAYS * day - 1)), true), clock);
assert.equal(justInside.kind, "recent");

const exactNow = presentFailureBounceAge(input(at(0), true), clock);
assert.equal(exactNow.kind, "recent", "此刻仍算失败七日内");
assert.equal(failureBounceAgeMatchesFilter(exactNow, "long"), false);

const future = presentFailureBounceAge(input(at(day), true), clock);
assert.equal(future.kind, "recent", "比现在更晚的可解析发生时间仍算失败七日内");

const recent = presentFailureBounceAge(input(at(-2 * day), true), clock);
assert.equal(recent.kind, "recent");
assert.match(failureBounceAgeSummary(recent), /^失败七日内 /);

const frozenSource = input(at(-8 * day), true);
const frozen = Object.freeze(frozenSource);
presentFailureBounceAge(frozen, clock);
assert.equal(frozen.at, frozenSource.at);
assert.equal(frozen.failed, true);

const rows = [
  { id: "recent-later", at: at(-1 * day), failed: true },
  { id: "long-later", at: at(-9 * day), failed: true },
  { id: "long-earlier", at: at(-12 * day), failed: true },
  { id: "none", at: "", failed: true },
  { id: "clear", at: at(-20 * day), failed: false },
  { id: "invalid", at: "不是时间", failed: true },
  { id: "recent-earlier", at: at(-6 * day), failed: true },
  { id: "exact", at: at(-7 * day), failed: true }
];
const queue = listFailureBounceAgeQueue(rows, (row) => presentFailureBounceAge(input(row.at, row.failed), clock));
assert.deepEqual(queue.rows.map((row) => row.id), [
  "long-earlier",
  "long-later",
  "exact",
  "recent-earlier",
  "recent-later"
]);
assert.equal(queue.total, 5);
assert.equal(FAILURE_BOUNCE_AGE_LIMIT, 8);
assert.equal(FAILURE_BOUNCE_AGE_WINDOW_DAYS, 7);

const many = Array.from({ length: 9 }, (_, index) => ({
  id: `s${index}`,
  at: at(-(20 - index) * day),
  failed: true
}));
const capped = listFailureBounceAgeQueue(many, (row) => presentFailureBounceAge(input(row.at, row.failed), clock));
assert.equal(capped.total, 9);
assert.equal(capped.rows.length, 8);
assert.deepEqual(capped.rows.map((row) => row.id), ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
assert.equal(presentFailureBounceAge(input(capped.rows[0]?.at || "", true), clock).kind, "long");

const tied = listFailureBounceAgeQueue(
  [
    { id: "b", at: at(-10 * day), failed: true },
    { id: "a", at: at(-10 * day), failed: true }
  ],
  (row) => presentFailureBounceAge(input(row.at, row.failed), clock)
);
assert.deepEqual(tied.rows.map((row) => row.id), ["a", "b"]);

const onlyNone = listFailureBounceAgeQueue(
  [
    { id: "blank", at: "", failed: true },
    { id: "bad", at: "刚刚", failed: true },
    { id: "clear", at: at(-12 * day), failed: false }
  ],
  (row) => presentFailureBounceAge(input(row.at, row.failed), clock)
);
assert.equal(onlyNone.total, 0);
assert.deepEqual(onlyNone.rows, []);

const mixedCap = listFailureBounceAgeQueue(
  [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `due${index}`, at: at(-(index + 8) * day), failed: true })),
    { id: "none", at: "", failed: false }
  ],
  (row) => presentFailureBounceAge(input(row.at, row.failed), clock)
);
assert.equal(mixedCap.total, 8);
assert.equal(mixedCap.rows.some((row) => row.id === "none"), false);

const recentDoesNotCrowd = listFailureBounceAgeQueue(
  [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `old${index}`, at: at(-(index + 9) * day), failed: true })),
    { id: "new", at: at(-1 * day), failed: true },
    { id: "blank", at: "", failed: true }
  ],
  (row) => presentFailureBounceAge(input(row.at, row.failed), clock),
  8
);
assert.equal(recentDoesNotCrowd.rows.some((row) => row.id === "new"), false);
assert.equal(recentDoesNotCrowd.rows.some((row) => row.id === "blank"), false);
assert.equal(recentDoesNotCrowd.rows[0]?.id, "old7");

const projectedLong = presentOutreachFailure({
  status: "hit",
  kind: "bounced",
  label: "开发信退信",
  reason: "mailbox full",
  at: longAt.toISOString()
});
assert.equal(projectedLong.status, "hit");
assert.equal(
  presentFailureBounceAge({ failed: projectedLong.status === "hit", at: projectedLong.at }, clock).kind,
  "long",
  "日龄复用 Day14 退信投影上的同一份发生时间"
);

const projectedRecent = presentOutreachFailure({
  status: "hit",
  kind: "send_failed",
  label: "发送失败",
  reason: "timeout",
  at: at(-2 * day)
});
assert.equal(
  presentFailureBounceAge({ failed: projectedRecent.status === "hit", at: projectedRecent.at }, clock).kind,
  "recent"
);

const projectedClear = presentOutreachFailure({ status: "none", kind: "none", label: "无失败记录", reason: "", at: at(-30 * day) });
assert.equal(presentFailureBounceAge({ failed: projectedClear.status === "hit", at: projectedClear.at }, clock).kind, "none");

const projectedBadTime = presentOutreachFailure({ status: "hit", kind: "bounced", label: "开发信退信", reason: "x", at: "不是时间" });
assert.equal(projectedBadTime.at, "");
assert.equal(presentFailureBounceAge({ failed: projectedBadTime.status === "hit", at: projectedBadTime.at }, clock).kind, "none");

const projectedOther = presentOutreachFailure({ status: "hit", kind: "suppressed", reason: "抑制", at: at(-30 * day) });
assert.equal(presentFailureBounceAge({ failed: projectedOther.status === "hit", at: projectedOther.at }, clock).kind, "none", "抑制不算失败退信日龄");

console.log("prospect-failure-bounce-age-test: ok");
