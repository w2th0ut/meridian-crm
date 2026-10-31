import assert from "node:assert/strict";
import {
  INTAKE_AGE_LIMIT,
  INTAKE_AGE_WINDOW_DAYS,
  formatIntakeAgeAt,
  intakeAgeEntryLabel,
  intakeAgeLineLabel,
  intakeAgeListFilterForOpen,
  intakeAgeMatchesFilter,
  intakeAgeRank,
  intakeAgeStatusLabel,
  intakeAgeSummary,
  listIntakeAgeQueue,
  presentIntakeAge,
  type IntakeAgeInput
} from "./prospect-intake-age.js";

const clock = new Date("2026-10-30T12:00:00.000Z");
const at = (offsetMs: number) => new Date(clock.getTime() + offsetMs).toISOString();
const day = 86_400_000;
const forbidden = /空档|已到期|静默|跟进空档|逾期|有回复|即将到期|未临近|无序列到期|近期有外联|无外联记录|有动作|新近|未加入|近期有跟进|无记录|缺邮箱|卡住|积压较久|积压较新|无待处理回复|较久|待放已久|待放未久|无待放行|抑制超七日|抑制七日内|无抑制日龄|失败超七日|失败七日内|无失败日龄|打开超七日|打开七日内|无打开日龄|回复超七日|回复七日内|无回复日龄|最近一步超七日|最近一步七日内|无最近一步|同步异常超七日|同步异常七日内|无同步异常日龄|无失败记录|发送失败|开发信退信|无打开或点击|邮箱异常|邮箱正常|无健康信息|收信同步异常/;

function input(atValue: string): IntakeAgeInput {
  return { at: atValue };
}

const none = presentIntakeAge(input("  "), clock);
assert.equal(none.kind, "none");
assert.equal(none.atMs, 0);
assert.equal(intakeAgeLineLabel(none), "无入库日龄");
assert.equal(intakeAgeStatusLabel(none), "无入库日龄");
assert.equal(intakeAgeEntryLabel(), "查看候选详情");
assert.match(intakeAgeSummary(none), /^无入库日龄。/);
assert.match(intakeAgeSummary(none), /超过 7 天算入库超七日/);
assert.match(intakeAgeSummary(none), /刚好 7 天仍算入库七日内/);
assert.match(intakeAgeSummary(none), /这不是收信同步异常日龄，也不是序列最近一步日龄，也不是开发信回复日龄，也不是打开或点击日龄，也不是失败退信日龄，也不是抑制名单日龄，也不是待放行批次，也不是回复待处理积压，也不是序列下一步到期，也不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄/);
assert.match(intakeAgeSummary(none), /也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口/);
assert.match(intakeAgeSummary(none), /也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住/);
assert.match(intakeAgeSummary(none), /也不是待记跟进或今日到期，也不是待发草稿、外联序列进度/);
assert.match(intakeAgeSummary(none), /也不是打开或点击、失败或退信、收信同步那一块/);
assert.match(intakeAgeSummary(none), /不替代短名单加入日龄，也不替代加入时间的日期范围/);
assert.match(intakeAgeSummary(none), /不会发信，不会解除抑制，不会推进序列，不会放行批次，不会改名单，不会改邮箱配置，也不会改 convert_to_lead 或 approved_contactable/);
assert.match(intakeAgeSummary(none), /加入短名单的时间不算入库时间/);
assert.match(intakeAgeSummary(none), /跟进记录不算入库时间/);
assert.match(intakeAgeSummary(none), /下次跟进那种时间不算入库时间/);
assert.match(intakeAgeSummary(none), /最近一封开发信的发出时间不算入库时间/);
assert.match(intakeAgeSummary(none), /序列下一步的计划时间不算入库时间/);
assert.match(intakeAgeSummary(none), /已发出步骤的时间不算入库时间/);
assert.match(intakeAgeSummary(none), /开发信回复的时间不算入库时间/);
assert.match(intakeAgeSummary(none), /打开或点击的发生时间不算入库时间/);
assert.match(intakeAgeSummary(none), /失败或退信的发生时间不算入库时间/);
assert.match(intakeAgeSummary(none), /抑制或退订的生效时间不算入库时间/);
assert.match(intakeAgeSummary(none), /待放行批次的更新时间不算入库时间/);
assert.match(intakeAgeSummary(none), /最近触达（含话机）不算入库时间/);
assert.match(intakeAgeSummary(none), /收信同步的账号状态不算入库时间/);
assert.match(intakeAgeSummary(none), /候选上没有更新时间字段/);
assert.match(intakeAgeSummary(none), /撞库说明上的关键时间不是撞库发生时刻，不算入库时间/);
assert.match(intakeAgeSummary(none), /只认带 T 的时间/);
assert.match(intakeAgeSummary(none), /墙上时钟不算/);
assert.match(intakeAgeSummary(none), /没有入库时间，或时间解析不了，写无入库日龄，也不编造/);
assert.doesNotMatch(intakeAgeLineLabel(none), forbidden);
assert.equal(intakeAgeMatchesFilter(none, "long"), false);
assert.equal(intakeAgeMatchesFilter(none, "all"), true);
assert.equal(intakeAgeRank(none), 2);
assert.equal(intakeAgeListFilterForOpen(none), "all");
assert.equal(presentIntakeAge(input(""), clock).kind, "none");
assert.equal(presentIntakeAge(input("刚刚"), clock).kind, "none");
assert.equal(presentIntakeAge(input("不是时间"), clock).kind, "none");
assert.equal(presentIntakeAge(input("2026-10-01 08:00"), clock).kind, "none", "墙上时钟不算入库时间");

const longAt = new Date(clock.getTime() - 8 * day);
const long = presentIntakeAge(input(longAt.toISOString()), clock);
assert.equal(long.kind, "long");
assert.equal(long.atMs, longAt.getTime());
assert.equal(formatIntakeAgeAt(long.atMs), formatIntakeAgeAt(longAt.getTime()));
assert.equal(intakeAgeLineLabel(long), `入库超七日 · ${formatIntakeAgeAt(long.atMs)}`);
assert.match(intakeAgeSummary(long), /^入库超七日 /);
assert.doesNotMatch(intakeAgeLineLabel(long), forbidden);
assert.doesNotMatch(intakeAgeLineLabel(long), /入库七日内|无入库日龄/);
assert.equal(intakeAgeMatchesFilter(long, "long"), true);
assert.equal(intakeAgeRank(long), 0);
assert.equal(intakeAgeStatusLabel(long), "入库超七日");
assert.equal(intakeAgeListFilterForOpen(long), "long");

const justOver = presentIntakeAge(input(at(-(INTAKE_AGE_WINDOW_DAYS * day + 1))), clock);
assert.equal(justOver.kind, "long", "超过 7 天算入库超七日");

const exact = presentIntakeAge(input(at(-INTAKE_AGE_WINDOW_DAYS * day)), clock);
assert.equal(exact.kind, "recent", "刚好 7 天仍算入库七日内");
assert.equal(intakeAgeLineLabel(exact).startsWith("入库七日内 · "), true);
assert.equal(intakeAgeRank(exact), 1);
assert.equal(intakeAgeMatchesFilter(exact, "long"), false);
assert.equal(intakeAgeStatusLabel(exact), "入库七日内");
assert.equal(intakeAgeListFilterForOpen(exact), "all");
assert.doesNotMatch(intakeAgeLineLabel(exact), forbidden);
assert.doesNotMatch(intakeAgeLineLabel(exact), /入库超七日|无入库日龄/);

const justInside = presentIntakeAge(input(at(-(INTAKE_AGE_WINDOW_DAYS * day - 1))), clock);
assert.equal(justInside.kind, "recent");

const exactNow = presentIntakeAge(input(at(0)), clock);
assert.equal(exactNow.kind, "recent", "此刻仍算入库七日内");
assert.equal(intakeAgeMatchesFilter(exactNow, "long"), false);

const future = presentIntakeAge(input(at(day)), clock);
assert.equal(future.kind, "recent", "比现在更晚的可解析入库时间仍算入库七日内");

const recent = presentIntakeAge(input(at(-2 * day)), clock);
assert.equal(recent.kind, "recent");
assert.match(intakeAgeSummary(recent), /^入库七日内 /);

const frozenSource = input(at(-8 * day));
const frozen = Object.freeze(frozenSource);
presentIntakeAge(frozen, clock);
assert.equal(frozen.at, frozenSource.at);

const rows = [
  { id: "recent-later", at: at(-1 * day) },
  { id: "long-later", at: at(-9 * day) },
  { id: "long-earlier", at: at(-12 * day) },
  { id: "none", at: "" },
  { id: "invalid", at: "不是时间" },
  { id: "wall", at: "2026-10-01 08:00" },
  { id: "recent-earlier", at: at(-6 * day) },
  { id: "exact", at: at(-7 * day) }
];
const queue = listIntakeAgeQueue(rows, (row) => presentIntakeAge(input(row.at), clock));
assert.deepEqual(queue.rows.map((row) => row.id), [
  "long-earlier",
  "long-later",
  "exact",
  "recent-earlier",
  "recent-later"
]);
assert.equal(queue.total, 5);
assert.equal(INTAKE_AGE_LIMIT, 8);
assert.equal(INTAKE_AGE_WINDOW_DAYS, 7);

const many = Array.from({ length: 9 }, (_, index) => ({
  id: `s${index}`,
  at: at(-(20 - index) * day)
}));
const capped = listIntakeAgeQueue(many, (row) => presentIntakeAge(input(row.at), clock));
assert.equal(capped.total, 9);
assert.equal(capped.rows.length, 8);
assert.deepEqual(capped.rows.map((row) => row.id), ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
assert.equal(presentIntakeAge(input(capped.rows[0]?.at || ""), clock).kind, "long");

const tied = listIntakeAgeQueue(
  [
    { id: "b", at: at(-10 * day) },
    { id: "a", at: at(-10 * day) }
  ],
  (row) => presentIntakeAge(input(row.at), clock)
);
assert.deepEqual(tied.rows.map((row) => row.id), ["a", "b"]);

const onlyNone = listIntakeAgeQueue(
  [
    { id: "blank", at: "" },
    { id: "bad", at: "刚刚" },
    { id: "wall", at: "2026-10-01 08:00" }
  ],
  (row) => presentIntakeAge(input(row.at), clock)
);
assert.equal(onlyNone.total, 0);
assert.deepEqual(onlyNone.rows, []);

const mixedCap = listIntakeAgeQueue(
  [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `due${index}`, at: at(-(index + 8) * day) })),
    { id: "none", at: "" }
  ],
  (row) => presentIntakeAge(input(row.at), clock)
);
assert.equal(mixedCap.total, 8);
assert.equal(mixedCap.rows.some((row) => row.id === "none"), false);

const recentDoesNotCrowd = listIntakeAgeQueue(
  [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `old${index}`, at: at(-(index + 9) * day) })),
    { id: "new", at: at(-1 * day) },
    { id: "blank", at: "" }
  ],
  (row) => presentIntakeAge(input(row.at), clock),
  8
);
assert.equal(recentDoesNotCrowd.rows.some((row) => row.id === "new"), false);
assert.equal(recentDoesNotCrowd.rows.some((row) => row.id === "blank"), false);
assert.equal(recentDoesNotCrowd.rows[0]?.id, "old7");

console.log("prospect-intake-age-test: ok");
