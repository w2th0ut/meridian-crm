import assert from "node:assert/strict";
import { presentOutreachSequence } from "./prospect-outreach-sequence.js";
import {
  SEQUENCE_LAST_STEP_AGE_LIMIT,
  SEQUENCE_LAST_STEP_AGE_WINDOW_DAYS,
  formatSequenceLastStepAgeAt,
  listSequenceLastStepAgeQueue,
  presentSequenceLastStepAge,
  sequenceLastStepAgeEntryLabel,
  sequenceLastStepAgeLineLabel,
  sequenceLastStepAgeListFilterForOpen,
  sequenceLastStepAgeMatchesFilter,
  sequenceLastStepAgeRank,
  sequenceLastStepAgeStatusLabel,
  sequenceLastStepAgeSummary,
  type SequenceLastStepAgeInput
} from "./prospect-sequence-last-step-age.js";

const clock = new Date("2026-10-30T12:00:00.000Z");
const at = (offsetMs: number) => new Date(clock.getTime() + offsetMs).toISOString();
const day = 86_400_000;
const forbidden = /空档|已到期|静默|跟进空档|逾期|有回复|即将到期|未临近|无序列到期|近期有外联|无外联记录|有动作|新近|未加入|近期有跟进|无记录|缺邮箱|卡住|积压较久|积压较新|无待处理回复|较久|待放已久|待放未久|无待放行|抑制超七日|抑制七日内|无抑制日龄|失败超七日|失败七日内|无失败日龄|打开超七日|打开七日内|无打开日龄|回复超七日|回复七日内|无回复日龄|无失败记录|发送失败|开发信退信|无打开或点击|有打开\/点击|邮箱异常|邮箱正常|无健康信息|进行中|已暂停|已完成/;

function input(atValue: string, sent = true): SequenceLastStepAgeInput {
  return { sent, at: atValue };
}

const none = presentSequenceLastStepAge(input("  ", false), clock);
assert.equal(none.kind, "none");
assert.equal(none.atMs, 0);
assert.equal(sequenceLastStepAgeLineLabel(none), "无最近一步");
assert.equal(sequenceLastStepAgeStatusLabel(none), "无最近一步");
assert.equal(sequenceLastStepAgeEntryLabel(), "查看外联序列");
assert.match(sequenceLastStepAgeSummary(none), /^无最近一步。/);
assert.match(sequenceLastStepAgeSummary(none), /超过 7 天算最近一步超七日/);
assert.match(sequenceLastStepAgeSummary(none), /刚好 7 天仍算最近一步七日内/);
assert.match(sequenceLastStepAgeSummary(none), /这不是开发信回复日龄，也不是打开或点击日龄，也不是失败退信日龄，也不是抑制名单日龄，也不是待放行批次，也不是回复待处理积压，也不是序列下一步到期，也不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄/);
assert.match(sequenceLastStepAgeSummary(none), /也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口/);
assert.match(sequenceLastStepAgeSummary(none), /也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住/);
assert.match(sequenceLastStepAgeSummary(none), /也不是待记跟进或今日到期，也不是待发草稿、外联序列进度/);
assert.match(sequenceLastStepAgeSummary(none), /也不是打开或点击、失败或退信、收信同步/);
assert.match(sequenceLastStepAgeSummary(none), /不替代外联序列那一块，也不替代序列下一步到期/);
assert.match(sequenceLastStepAgeSummary(none), /不会发信，不会推进序列，不会放行批次，不会解除抑制，不会改名单，不会改邮箱配置，也不会改 convert_to_lead 或 approved_contactable/);
assert.match(sequenceLastStepAgeSummary(none), /发件邮箱没有可只读复用的健康、错误、授权到期或发送配额字段/);
assert.match(sequenceLastStepAgeSummary(none), /这里不展示邮箱异常，也不展示邮箱正常，也不展示无健康信息/);
assert.match(sequenceLastStepAgeSummary(none), /下一步的计划时间不算这一步的发出时间/);
assert.match(sequenceLastStepAgeSummary(none), /失败步骤的时间不算这一步的发出时间/);
assert.match(sequenceLastStepAgeSummary(none), /序列更新时间不算这一步的发出时间/);
assert.match(sequenceLastStepAgeSummary(none), /序列上另存的汇总发送时间不算这一步的发出时间/);
assert.match(sequenceLastStepAgeSummary(none), /最近一封开发信的发出时间不算这一步的发出时间/);
assert.match(sequenceLastStepAgeSummary(none), /没有已发出步骤，或时间解析不了，写无最近一步，也不编造/);
assert.doesNotMatch(sequenceLastStepAgeLineLabel(none), forbidden);
assert.equal(sequenceLastStepAgeMatchesFilter(none, "long"), false);
assert.equal(sequenceLastStepAgeMatchesFilter(none, "all"), true);
assert.equal(sequenceLastStepAgeRank(none), 2);
assert.equal(sequenceLastStepAgeListFilterForOpen(none), "all");
assert.equal(presentSequenceLastStepAge(input("", true), clock).kind, "none");
assert.equal(presentSequenceLastStepAge(input("刚刚", true), clock).kind, "none");
assert.equal(presentSequenceLastStepAge(input("不是时间", true), clock).kind, "none");
assert.equal(presentSequenceLastStepAge(input("2026-10-01 08:00", true), clock).kind, "none", "墙上时钟不是最近一步");
assert.equal(presentSequenceLastStepAge(input(at(-30 * day), false), clock).kind, "none", "没有已发出步骤时，即使带了时间也是无最近一步");

const longAt = new Date(clock.getTime() - 8 * day);
const long = presentSequenceLastStepAge(input(longAt.toISOString(), true), clock);
assert.equal(long.kind, "long");
assert.equal(long.atMs, longAt.getTime());
assert.equal(formatSequenceLastStepAgeAt(long.atMs), formatSequenceLastStepAgeAt(longAt.getTime()));
assert.equal(sequenceLastStepAgeLineLabel(long), `最近一步超七日 · ${formatSequenceLastStepAgeAt(long.atMs)}`);
assert.match(sequenceLastStepAgeSummary(long), /^最近一步超七日 /);
assert.doesNotMatch(sequenceLastStepAgeLineLabel(long), forbidden);
assert.doesNotMatch(sequenceLastStepAgeLineLabel(long), /最近一步七日内|无最近一步/);
assert.equal(sequenceLastStepAgeMatchesFilter(long, "long"), true);
assert.equal(sequenceLastStepAgeRank(long), 0);
assert.equal(sequenceLastStepAgeStatusLabel(long), "最近一步超七日");
assert.equal(sequenceLastStepAgeListFilterForOpen(long), "long");

const justOver = presentSequenceLastStepAge(input(at(-(SEQUENCE_LAST_STEP_AGE_WINDOW_DAYS * day + 1)), true), clock);
assert.equal(justOver.kind, "long", "超过 7 天算最近一步超七日");

const exact = presentSequenceLastStepAge(input(at(-SEQUENCE_LAST_STEP_AGE_WINDOW_DAYS * day), true), clock);
assert.equal(exact.kind, "recent", "刚好 7 天仍算最近一步七日内");
assert.equal(sequenceLastStepAgeLineLabel(exact).startsWith("最近一步七日内 · "), true);
assert.equal(sequenceLastStepAgeRank(exact), 1);
assert.equal(sequenceLastStepAgeMatchesFilter(exact, "long"), false);
assert.equal(sequenceLastStepAgeStatusLabel(exact), "最近一步七日内");
assert.equal(sequenceLastStepAgeListFilterForOpen(exact), "all");
assert.doesNotMatch(sequenceLastStepAgeLineLabel(exact), forbidden);
assert.doesNotMatch(sequenceLastStepAgeLineLabel(exact), /最近一步超七日|无最近一步/);

const justInside = presentSequenceLastStepAge(input(at(-(SEQUENCE_LAST_STEP_AGE_WINDOW_DAYS * day - 1)), true), clock);
assert.equal(justInside.kind, "recent");

const exactNow = presentSequenceLastStepAge(input(at(0), true), clock);
assert.equal(exactNow.kind, "recent", "此刻仍算最近一步七日内");
assert.equal(sequenceLastStepAgeMatchesFilter(exactNow, "long"), false);

const future = presentSequenceLastStepAge(input(at(day), true), clock);
assert.equal(future.kind, "recent", "比现在更晚的可解析发出时间仍算最近一步七日内");

const recent = presentSequenceLastStepAge(input(at(-2 * day), true), clock);
assert.equal(recent.kind, "recent");
assert.match(sequenceLastStepAgeSummary(recent), /^最近一步七日内 /);

const frozenSource = input(at(-8 * day), true);
const frozen = Object.freeze(frozenSource);
presentSequenceLastStepAge(frozen, clock);
assert.equal(frozen.at, frozenSource.at);
assert.equal(frozen.sent, true);

const rows = [
  { id: "recent-later", at: at(-1 * day), sent: true },
  { id: "long-later", at: at(-9 * day), sent: true },
  { id: "long-earlier", at: at(-12 * day), sent: true },
  { id: "none", at: "", sent: true },
  { id: "clear", at: at(-20 * day), sent: false },
  { id: "invalid", at: "不是时间", sent: true },
  { id: "recent-earlier", at: at(-6 * day), sent: true },
  { id: "exact", at: at(-7 * day), sent: true }
];
const queue = listSequenceLastStepAgeQueue(rows, (row) => presentSequenceLastStepAge(input(row.at, row.sent), clock));
assert.deepEqual(queue.rows.map((row) => row.id), [
  "long-earlier",
  "long-later",
  "exact",
  "recent-earlier",
  "recent-later"
]);
assert.equal(queue.total, 5);
assert.equal(SEQUENCE_LAST_STEP_AGE_LIMIT, 8);
assert.equal(SEQUENCE_LAST_STEP_AGE_WINDOW_DAYS, 7);

const many = Array.from({ length: 9 }, (_, index) => ({
  id: `s${index}`,
  at: at(-(20 - index) * day),
  sent: true
}));
const capped = listSequenceLastStepAgeQueue(many, (row) => presentSequenceLastStepAge(input(row.at, row.sent), clock));
assert.equal(capped.total, 9);
assert.equal(capped.rows.length, 8);
assert.deepEqual(capped.rows.map((row) => row.id), ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
assert.equal(presentSequenceLastStepAge(input(capped.rows[0]?.at || "", true), clock).kind, "long");

const tied = listSequenceLastStepAgeQueue(
  [
    { id: "b", at: at(-10 * day), sent: true },
    { id: "a", at: at(-10 * day), sent: true }
  ],
  (row) => presentSequenceLastStepAge(input(row.at, row.sent), clock)
);
assert.deepEqual(tied.rows.map((row) => row.id), ["a", "b"]);

const onlyNone = listSequenceLastStepAgeQueue(
  [
    { id: "blank", at: "", sent: true },
    { id: "bad", at: "刚刚", sent: true },
    { id: "clear", at: at(-12 * day), sent: false }
  ],
  (row) => presentSequenceLastStepAge(input(row.at, row.sent), clock)
);
assert.equal(onlyNone.total, 0);
assert.deepEqual(onlyNone.rows, []);

const recentDoesNotCrowd = listSequenceLastStepAgeQueue(
  [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `old${index}`, at: at(-(index + 9) * day), sent: true })),
    { id: "new", at: at(-1 * day), sent: true },
    { id: "blank", at: "", sent: true }
  ],
  (row) => presentSequenceLastStepAge(input(row.at, row.sent), clock),
  8
);
assert.equal(recentDoesNotCrowd.rows.some((row) => row.id === "new"), false);
assert.equal(recentDoesNotCrowd.rows.some((row) => row.id === "blank"), false);
assert.equal(recentDoesNotCrowd.rows[0]?.id, "old7");

const projected = presentOutreachSequence({
  progress: "active",
  statusLabel: "进行中",
  source: "plan",
  sourceId: "plan_1",
  scheduledAt: at(day),
  lastStepAt: longAt.toISOString()
});
assert.equal(projected.lastStepAt, longAt.toISOString());
assert.notEqual(projected.lastStepAt, projected.scheduledAt);
assert.equal(presentSequenceLastStepAge({
  sent: projected.progress !== "none" && Boolean(projected.lastStepAt),
  at: projected.lastStepAt
}, clock).kind, "long", "日龄只复用同一条序列上已带出的最近一步发出时间");

const projectedNextOnly = presentOutreachSequence({
  progress: "active",
  statusLabel: "进行中",
  source: "batch",
  sourceId: "batch_next",
  scheduledAt: at(-30 * day),
  lastStepAt: ""
});
assert.equal(projectedNextOnly.scheduledAt, at(-30 * day));
assert.equal(presentSequenceLastStepAge({
  sent: Boolean(projectedNextOnly.lastStepAt),
  at: projectedNextOnly.scheduledAt
}, clock).kind, "none", "下一步计划时间不算最近一步");

const projectedWall = presentOutreachSequence({
  progress: "done",
  statusLabel: "已完成",
  source: "sequence",
  sourceId: "seq_wall",
  lastStepAt: "2026-10-01 08:00"
});
assert.equal(projectedWall.lastStepAt, "");
assert.equal(presentSequenceLastStepAge({ sent: Boolean(projectedWall.lastStepAt), at: projectedWall.lastStepAt }, clock).kind, "none");

console.log("prospect-sequence-last-step-age-test: ok");
