import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STATUS_CHANGE_AGE_LIMIT,
  STATUS_CHANGE_AGE_WINDOW_DAYS,
  formatStatusChangeAgeAt,
  listStatusChangeAgeQueue,
  presentStatusChangeAge,
  statusChangeAgeEntryLabel,
  statusChangeAgeLineLabel,
  statusChangeAgeListFilterForOpen,
  statusChangeAgeMatchesFilter,
  statusChangeAgeRank,
  statusChangeAgeStatusLabel,
  statusChangeAgeSummary,
  type StatusChangeAgeInput
} from "./prospect-status-change-age.js";

const clock = new Date("2026-10-30T12:00:00.000Z");
const at = (offsetMs: number) => new Date(clock.getTime() + offsetMs).toISOString();
const day = 86_400_000;
const forbidden = /空档|已到期|静默|跟进空档|逾期|有回复|即将到期|未临近|无序列到期|近期有外联|无外联记录|有动作|新近|未加入|近期有跟进|无记录|缺邮箱|卡住|积压较久|积压较新|无待处理回复|较久|待放已久|待放未久|无待放行|抑制超七日|抑制七日内|无抑制日龄|失败超七日|失败七日内|无失败日龄|打开超七日|打开七日内|无打开日龄|回复超七日|回复七日内|无回复日龄|最近一步超七日|最近一步七日内|无最近一步|同步异常超七日|同步异常七日内|无同步异常日龄|入库超七日|入库七日内|无入库日龄|核验超七日|核验七日内|无核验日龄|无失败记录|发送失败|开发信退信|无打开或点击|邮箱异常|邮箱正常|无健康信息|收信同步异常/;

function input(atValue: string): StatusChangeAgeInput {
  return { at: atValue };
}

const source = readFileSync(new URL("./prospect-status-change-age.ts", import.meta.url), "utf8");
assert.match(source, /statusChangedAt/, "状态变更日龄必须指向已有的状态变更时间");
assert.doesNotMatch(source, /\bcreatedAt\b|\bverifiedAt\b|\bshortlistedAt\b|\blatestFollowUp\b|\blastTouchpointAt\b/, "状态变更日龄不得改读入库、核验、加入时间、跟进或触达");

const none = presentStatusChangeAge(input("  "), clock);
assert.equal(none.kind, "none");
assert.equal(none.atMs, 0);
assert.equal(statusChangeAgeLineLabel(none), "无状态变更日龄");
assert.equal(statusChangeAgeStatusLabel(none), "无状态变更日龄");
assert.equal(statusChangeAgeEntryLabel(), "查看候选详情");
assert.match(statusChangeAgeSummary(none), /^无状态变更日龄。/);
assert.match(statusChangeAgeSummary(none), /超过 7 天算状态变更超七日/);
assert.match(statusChangeAgeSummary(none), /刚好 7 天仍算状态变更七日内/);
assert.match(statusChangeAgeSummary(none), /这不是候选入库日龄，也不是收信同步异常日龄，也不是序列最近一步日龄，也不是开发信回复日龄，也不是打开或点击日龄，也不是失败退信日龄，也不是抑制名单日龄，也不是待放行批次，也不是回复待处理积压，也不是序列下一步到期，也不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄/);
assert.match(statusChangeAgeSummary(none), /也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口/);
assert.match(statusChangeAgeSummary(none), /也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住/);
assert.match(statusChangeAgeSummary(none), /也不是待记跟进或今日到期，也不是待发草稿、外联序列进度/);
assert.match(statusChangeAgeSummary(none), /也不是打开或点击、失败或退信、收信同步那一块/);
assert.match(statusChangeAgeSummary(none), /不替代候选入库日龄，也不替代获客阶段/);
assert.match(statusChangeAgeSummary(none), /不会发信，不会解除抑制，不会推进序列，不会放行批次，不会改名单，不会改邮箱配置，不会改核验状态，也不会改 convert_to_lead 或 approved_contactable/);
assert.match(statusChangeAgeSummary(none), /核验时间不算状态变更时间/);
assert.match(statusChangeAgeSummary(none), /入库时间不算状态变更时间/);
assert.match(statusChangeAgeSummary(none), /加入短名单的时间不算状态变更时间/);
assert.match(statusChangeAgeSummary(none), /跟进记录不算状态变更时间/);
assert.match(statusChangeAgeSummary(none), /下次跟进那种时间不算状态变更时间/);
assert.match(statusChangeAgeSummary(none), /最近一封开发信的发出时间不算状态变更时间/);
assert.match(statusChangeAgeSummary(none), /序列下一步的计划时间不算状态变更时间/);
assert.match(statusChangeAgeSummary(none), /已发出步骤的时间不算状态变更时间/);
assert.match(statusChangeAgeSummary(none), /开发信回复的时间不算状态变更时间/);
assert.match(statusChangeAgeSummary(none), /打开或点击的发生时间不算状态变更时间/);
assert.match(statusChangeAgeSummary(none), /失败或退信的发生时间不算状态变更时间/);
assert.match(statusChangeAgeSummary(none), /抑制或退订的生效时间不算状态变更时间/);
assert.match(statusChangeAgeSummary(none), /待放行批次的更新时间不算状态变更时间/);
assert.match(statusChangeAgeSummary(none), /最近触达（含话机）不算状态变更时间/);
assert.match(statusChangeAgeSummary(none), /收信同步的账号状态不算状态变更时间/);
assert.match(statusChangeAgeSummary(none), /只有候选状态、没有这份状态变更时间时，不拿状态本身冒充/);
assert.match(statusChangeAgeSummary(none), /获客阶段上的进入时间不是这一节/);
assert.match(statusChangeAgeSummary(none), /不是更新时间，也不是核验时间，也不是入库时间/);
assert.match(statusChangeAgeSummary(none), /只认带 T 的时间/);
assert.match(statusChangeAgeSummary(none), /墙上时钟不算/);
assert.match(statusChangeAgeSummary(none), /没有状态变更时间，或时间解析不了，写无状态变更日龄，也不编造/);
assert.doesNotMatch(statusChangeAgeLineLabel(none), forbidden);
assert.equal(statusChangeAgeMatchesFilter(none, "long"), false);
assert.equal(statusChangeAgeMatchesFilter(none, "all"), true);
assert.equal(statusChangeAgeRank(none), 2);
assert.equal(statusChangeAgeListFilterForOpen(none), "all");
assert.equal(presentStatusChangeAge(input(""), clock).kind, "none");
assert.equal(presentStatusChangeAge(input("刚刚"), clock).kind, "none");
assert.equal(presentStatusChangeAge(input("不是时间"), clock).kind, "none");
assert.equal(presentStatusChangeAge(input("2026-10-01 08:00"), clock).kind, "none", "墙上时钟不算状态变更时间");

const longAt = new Date(clock.getTime() - 8 * day);
const long = presentStatusChangeAge(input(longAt.toISOString()), clock);
assert.equal(long.kind, "long");
assert.equal(long.atMs, longAt.getTime());
assert.equal(formatStatusChangeAgeAt(long.atMs), formatStatusChangeAgeAt(longAt.getTime()));
assert.equal(statusChangeAgeLineLabel(long), `状态变更超七日 · ${formatStatusChangeAgeAt(long.atMs)}`);
assert.match(statusChangeAgeSummary(long), /^状态变更超七日 /);
assert.doesNotMatch(statusChangeAgeLineLabel(long), forbidden);
assert.doesNotMatch(statusChangeAgeLineLabel(long), /状态变更七日内|无状态变更日龄/);
assert.equal(statusChangeAgeMatchesFilter(long, "long"), true);
assert.equal(statusChangeAgeRank(long), 0);
assert.equal(statusChangeAgeStatusLabel(long), "状态变更超七日");
assert.equal(statusChangeAgeListFilterForOpen(long), "long");

const justOver = presentStatusChangeAge(input(at(-(STATUS_CHANGE_AGE_WINDOW_DAYS * day + 1))), clock);
assert.equal(justOver.kind, "long", "超过 7 天算状态变更超七日");

const exact = presentStatusChangeAge(input(at(-STATUS_CHANGE_AGE_WINDOW_DAYS * day)), clock);
assert.equal(exact.kind, "recent", "刚好 7 天仍算状态变更七日内");
assert.equal(statusChangeAgeLineLabel(exact).startsWith("状态变更七日内 · "), true);
assert.equal(statusChangeAgeRank(exact), 1);
assert.equal(statusChangeAgeMatchesFilter(exact, "long"), false);
assert.equal(statusChangeAgeStatusLabel(exact), "状态变更七日内");
assert.equal(statusChangeAgeListFilterForOpen(exact), "all");
assert.doesNotMatch(statusChangeAgeLineLabel(exact), forbidden);
assert.doesNotMatch(statusChangeAgeLineLabel(exact), /状态变更超七日|无状态变更日龄/);

const justInside = presentStatusChangeAge(input(at(-(STATUS_CHANGE_AGE_WINDOW_DAYS * day - 1))), clock);
assert.equal(justInside.kind, "recent");

const exactNow = presentStatusChangeAge(input(at(0)), clock);
assert.equal(exactNow.kind, "recent", "此刻仍算状态变更七日内");
assert.equal(statusChangeAgeMatchesFilter(exactNow, "long"), false);

const future = presentStatusChangeAge(input(at(day)), clock);
assert.equal(future.kind, "recent", "比现在更晚的可解析状态变更时间仍算状态变更七日内");

const recent = presentStatusChangeAge(input(at(-2 * day)), clock);
assert.equal(recent.kind, "recent");
assert.match(statusChangeAgeSummary(recent), /^状态变更七日内 /);

const frozenSource = input(at(-8 * day));
const frozen = Object.freeze(frozenSource);
presentStatusChangeAge(frozen, clock);
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
const queue = listStatusChangeAgeQueue(rows, (row) => presentStatusChangeAge(input(row.at), clock));
assert.deepEqual(queue.rows.map((row) => row.id), [
  "long-earlier",
  "long-later",
  "exact",
  "recent-earlier",
  "recent-later"
]);
assert.equal(queue.total, 5);
assert.equal(STATUS_CHANGE_AGE_LIMIT, 8);
assert.equal(STATUS_CHANGE_AGE_WINDOW_DAYS, 7);

const many = Array.from({ length: 9 }, (_, index) => ({
  id: `s${index}`,
  at: at(-(20 - index) * day)
}));
const capped = listStatusChangeAgeQueue(many, (row) => presentStatusChangeAge(input(row.at), clock));
assert.equal(capped.total, 9);
assert.equal(capped.rows.length, 8);
assert.deepEqual(capped.rows.map((row) => row.id), ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
assert.equal(presentStatusChangeAge(input(capped.rows[0]?.at || ""), clock).kind, "long");

const tied = listStatusChangeAgeQueue(
  [
    { id: "b", at: at(-10 * day) },
    { id: "a", at: at(-10 * day) }
  ],
  (row) => presentStatusChangeAge(input(row.at), clock)
);
assert.deepEqual(tied.rows.map((row) => row.id), ["a", "b"]);

const onlyNone = listStatusChangeAgeQueue(
  [
    { id: "blank", at: "" },
    { id: "bad", at: "刚刚" },
    { id: "wall", at: "2026-10-01 08:00" }
  ],
  (row) => presentStatusChangeAge(input(row.at), clock)
);
assert.equal(onlyNone.total, 0);
assert.deepEqual(onlyNone.rows, []);

const mixedCap = listStatusChangeAgeQueue(
  [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `due${index}`, at: at(-(index + 8) * day) })),
    { id: "none", at: "" }
  ],
  (row) => presentStatusChangeAge(input(row.at), clock)
);
assert.equal(mixedCap.total, 8);
assert.equal(mixedCap.rows.some((row) => row.id === "none"), false);

const recentDoesNotCrowd = listStatusChangeAgeQueue(
  [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `old${index}`, at: at(-(index + 9) * day) })),
    { id: "new", at: at(-1 * day) },
    { id: "blank", at: "" }
  ],
  (row) => presentStatusChangeAge(input(row.at), clock),
  8
);
assert.equal(recentDoesNotCrowd.rows.some((row) => row.id === "new"), false);
assert.equal(recentDoesNotCrowd.rows.some((row) => row.id === "blank"), false);
assert.equal(recentDoesNotCrowd.rows[0]?.id, "old7");

console.log("prospect-status-change-age-test: ok");
