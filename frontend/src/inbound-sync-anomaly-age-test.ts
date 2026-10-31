import assert from "node:assert/strict";
import { presentInboundSyncStatus } from "./inbound-sync-status.js";
import {
  INBOUND_SYNC_ANOMALY_AGE_LIMIT,
  INBOUND_SYNC_ANOMALY_AGE_WINDOW_DAYS,
  formatInboundSyncAnomalyAgeAt,
  inboundSyncAnomalyAgeEntryLabel,
  inboundSyncAnomalyAgeLineLabel,
  inboundSyncAnomalyAgeListFilterForOpen,
  inboundSyncAnomalyAgeMatchesFilter,
  inboundSyncAnomalyAgeRank,
  inboundSyncAnomalyAgeStatusLabel,
  inboundSyncAnomalyAgeSummary,
  listInboundSyncAnomalyAgeQueue,
  presentInboundSyncAnomalyAge,
  type InboundSyncAnomalyAgeInput
} from "./inbound-sync-anomaly-age.js";

const clock = new Date("2026-10-30T12:00:00.000Z");
const at = (offsetMs: number) => new Date(clock.getTime() + offsetMs).toISOString();
const day = 86_400_000;
const forbidden = /空档|已到期|静默|跟进空档|逾期|有回复|即将到期|未临近|无序列到期|近期有外联|无外联记录|有动作|新近|未加入|近期有跟进|无记录|缺邮箱|卡住|积压较久|积压较新|无待处理回复|较久|待放已久|待放未久|无待放行|抑制超七日|抑制七日内|无抑制日龄|失败超七日|失败七日内|无失败日龄|打开超七日|打开七日内|无打开日龄|回复超七日|回复七日内|无回复日龄|最近一步超七日|最近一步七日内|无最近一步|无失败记录|发送失败|开发信退信|无打开或点击|有打开\/点击|邮箱异常|邮箱正常|无健康信息|收信同步异常|进行中|已暂停|已完成/;

function input(atValue: string, anomaly = true): InboundSyncAnomalyAgeInput {
  return { anomaly, at: atValue };
}

function fromAccount(account: {
  id: string;
  name: string;
  lastInboundSyncStatus?: string;
  lastInboundSyncError?: string;
  lastInboundSyncAt?: string;
  imapPassword?: string;
  smtpPassword?: string;
}) {
  const sync = presentInboundSyncStatus(account);
  return presentInboundSyncAnomalyAge({
    anomaly: sync.condition === "error",
    at: sync.syncedAt
  }, clock);
}

const none = presentInboundSyncAnomalyAge(input("  ", false), clock);
assert.equal(none.kind, "none");
assert.equal(none.atMs, 0);
assert.equal(inboundSyncAnomalyAgeLineLabel(none), "无同步异常日龄");
assert.equal(inboundSyncAnomalyAgeStatusLabel(none), "无同步异常日龄");
assert.equal(inboundSyncAnomalyAgeEntryLabel(), "查看收信同步");
assert.match(inboundSyncAnomalyAgeSummary(none), /^无同步异常日龄。/);
assert.match(inboundSyncAnomalyAgeSummary(none), /超过 7 天算同步异常超七日/);
assert.match(inboundSyncAnomalyAgeSummary(none), /刚好 7 天仍算同步异常七日内/);
assert.match(inboundSyncAnomalyAgeSummary(none), /这不是序列最近一步日龄，也不是开发信回复日龄，也不是打开或点击日龄，也不是失败退信日龄，也不是抑制名单日龄，也不是待放行批次，也不是回复待处理积压，也不是序列下一步到期，也不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄/);
assert.match(inboundSyncAnomalyAgeSummary(none), /也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口/);
assert.match(inboundSyncAnomalyAgeSummary(none), /也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住/);
assert.match(inboundSyncAnomalyAgeSummary(none), /也不是待记跟进或今日到期，也不是待发草稿、外联序列进度/);
assert.match(inboundSyncAnomalyAgeSummary(none), /也不是打开或点击、失败或退信、收信同步那一块/);
assert.match(inboundSyncAnomalyAgeSummary(none), /不替代收信同步那一块/);
assert.match(inboundSyncAnomalyAgeSummary(none), /不会发信，不会解除抑制，不会推进序列，不会放行批次，不会改邮箱配置，不会改授权，不会重连，不会触发同步，也不会改 convert_to_lead 或 approved_contactable/);
assert.match(inboundSyncAnomalyAgeSummary(none), /发件邮箱没有可只读复用的健康、错误、授权到期或发送配额字段/);
assert.match(inboundSyncAnomalyAgeSummary(none), /这里不展示邮箱异常，也不展示邮箱正常，也不展示无健康信息/);
assert.match(inboundSyncAnomalyAgeSummary(none), /成功同步写下的时间不算异常日龄/);
assert.match(inboundSyncAnomalyAgeSummary(none), /这是账号上的收信同步，不是某一家候选公司的日龄/);
assert.match(inboundSyncAnomalyAgeSummary(none), /没有异常，或时间解析不了，写无同步异常日龄，也不编造/);
assert.doesNotMatch(inboundSyncAnomalyAgeLineLabel(none), forbidden);
assert.equal(inboundSyncAnomalyAgeMatchesFilter(none, "long"), false);
assert.equal(inboundSyncAnomalyAgeMatchesFilter(none, "all"), true);
assert.equal(inboundSyncAnomalyAgeRank(none), 2);
assert.equal(inboundSyncAnomalyAgeListFilterForOpen(none), "all");
assert.equal(presentInboundSyncAnomalyAge(input("", true), clock).kind, "none");
assert.equal(presentInboundSyncAnomalyAge(input("刚刚", true), clock).kind, "none");
assert.equal(presentInboundSyncAnomalyAge(input("不是时间", true), clock).kind, "none");
assert.equal(presentInboundSyncAnomalyAge(input("2026-10-01 08:00", true), clock).kind, "none", "墙上时钟不是异常时间");
assert.equal(presentInboundSyncAnomalyAge(input(at(-30 * day), false), clock).kind, "none", "没有异常时，即使带了时间也是无同步异常日龄");

const clearAccount = fromAccount({
  id: "user_ok",
  name: "王敏",
  lastInboundSyncStatus: "ok",
  lastInboundSyncError: "不该算异常",
  lastInboundSyncAt: at(-30 * day),
  imapPassword: "secret-imap",
  smtpPassword: "secret-smtp"
});
assert.equal(clearAccount.kind, "none", "成功同步的时间不算异常日龄");
assert.equal(JSON.stringify(clearAccount).includes("secret"), false);

const longAt = new Date(clock.getTime() - 8 * day);
const longAccount = fromAccount({
  id: "user_long",
  name: "李雷",
  lastInboundSyncStatus: "error",
  lastInboundSyncError: "IMAP 登录失败",
  lastInboundSyncAt: longAt.toISOString()
});
assert.equal(longAccount.kind, "long");
assert.equal(longAccount.atMs, longAt.getTime());
assert.equal(inboundSyncAnomalyAgeLineLabel(longAccount), `同步异常超七日 · ${formatInboundSyncAnomalyAgeAt(longAccount.atMs)}`);
assert.match(inboundSyncAnomalyAgeSummary(longAccount), /^同步异常超七日 /);
assert.doesNotMatch(inboundSyncAnomalyAgeLineLabel(longAccount), forbidden);
assert.doesNotMatch(inboundSyncAnomalyAgeLineLabel(longAccount), /同步异常七日内|无同步异常日龄|收信同步异常/);
assert.equal(inboundSyncAnomalyAgeMatchesFilter(longAccount, "long"), true);
assert.equal(inboundSyncAnomalyAgeRank(longAccount), 0);
assert.equal(inboundSyncAnomalyAgeStatusLabel(longAccount), "同步异常超七日");
assert.equal(inboundSyncAnomalyAgeListFilterForOpen(longAccount), "long");

const brokenTime = fromAccount({
  id: "user_bad",
  name: "赵乾",
  lastInboundSyncStatus: "error",
  lastInboundSyncError: "连接超时",
  lastInboundSyncAt: "不是时间"
});
assert.equal(brokenTime.kind, "none", "异常但时间解析不了仍是无同步异常日龄");

const wall = fromAccount({
  id: "user_wall",
  name: "周宁",
  lastInboundSyncStatus: "error",
  lastInboundSyncAt: "2026-10-01 08:00"
});
assert.equal(wall.kind, "none", "墙上时钟不拿来算异常日龄");

const justOver = presentInboundSyncAnomalyAge(input(at(-(INBOUND_SYNC_ANOMALY_AGE_WINDOW_DAYS * day + 1)), true), clock);
assert.equal(justOver.kind, "long", "超过 7 天算同步异常超七日");

const exact = presentInboundSyncAnomalyAge(input(at(-INBOUND_SYNC_ANOMALY_AGE_WINDOW_DAYS * day), true), clock);
assert.equal(exact.kind, "recent", "刚好 7 天仍算同步异常七日内");
assert.equal(inboundSyncAnomalyAgeLineLabel(exact).startsWith("同步异常七日内 · "), true);
assert.equal(inboundSyncAnomalyAgeRank(exact), 1);
assert.equal(inboundSyncAnomalyAgeMatchesFilter(exact, "long"), false);
assert.equal(inboundSyncAnomalyAgeStatusLabel(exact), "同步异常七日内");
assert.equal(inboundSyncAnomalyAgeListFilterForOpen(exact), "all");
assert.doesNotMatch(inboundSyncAnomalyAgeLineLabel(exact), forbidden);
assert.doesNotMatch(inboundSyncAnomalyAgeLineLabel(exact), /同步异常超七日|无同步异常日龄/);

const justInside = presentInboundSyncAnomalyAge(input(at(-(INBOUND_SYNC_ANOMALY_AGE_WINDOW_DAYS * day - 1)), true), clock);
assert.equal(justInside.kind, "recent");

const exactNow = presentInboundSyncAnomalyAge(input(at(0), true), clock);
assert.equal(exactNow.kind, "recent", "此刻仍算同步异常七日内");
assert.equal(inboundSyncAnomalyAgeMatchesFilter(exactNow, "long"), false);

const future = presentInboundSyncAnomalyAge(input(at(day), true), clock);
assert.equal(future.kind, "recent", "比现在更晚的可解析异常时间仍算同步异常七日内");

const recent = presentInboundSyncAnomalyAge(input(at(-2 * day), true), clock);
assert.equal(recent.kind, "recent");
assert.match(inboundSyncAnomalyAgeSummary(recent), /^同步异常七日内 /);

const frozenSource = input(at(-8 * day), true);
const frozen = Object.freeze(frozenSource);
presentInboundSyncAnomalyAge(frozen, clock);
assert.equal(frozen.at, frozenSource.at);
assert.equal(frozen.anomaly, true);

const rows = [
  { id: "recent-later", at: at(-1 * day), anomaly: true },
  { id: "long-later", at: at(-9 * day), anomaly: true },
  { id: "long-earlier", at: at(-12 * day), anomaly: true },
  { id: "none", at: "", anomaly: true },
  { id: "clear", at: at(-20 * day), anomaly: false },
  { id: "invalid", at: "不是时间", anomaly: true },
  { id: "recent-earlier", at: at(-6 * day), anomaly: true },
  { id: "exact", at: at(-7 * day), anomaly: true }
];
const queue = listInboundSyncAnomalyAgeQueue(rows, (row) => presentInboundSyncAnomalyAge(input(row.at, row.anomaly), clock));
assert.deepEqual(queue.rows.map((row) => row.id), [
  "long-earlier",
  "long-later",
  "exact",
  "recent-earlier",
  "recent-later"
]);
assert.equal(queue.total, 5);
assert.equal(INBOUND_SYNC_ANOMALY_AGE_LIMIT, 8);
assert.equal(INBOUND_SYNC_ANOMALY_AGE_WINDOW_DAYS, 7);

const onlyLong = listInboundSyncAnomalyAgeQueue(
  rows,
  (row) => presentInboundSyncAnomalyAge(input(row.at, row.anomaly), clock),
  INBOUND_SYNC_ANOMALY_AGE_LIMIT,
  "long"
);
assert.deepEqual(onlyLong.rows.map((row) => row.id), ["long-earlier", "long-later"]);
assert.equal(onlyLong.total, 2);

const many = Array.from({ length: 9 }, (_, index) => ({
  id: `s${index}`,
  at: at(-(20 - index) * day),
  anomaly: true
}));
const capped = listInboundSyncAnomalyAgeQueue(many, (row) => presentInboundSyncAnomalyAge(input(row.at, row.anomaly), clock));
assert.equal(capped.total, 9);
assert.equal(capped.rows.length, 8);
assert.deepEqual(capped.rows.map((row) => row.id), ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
assert.equal(presentInboundSyncAnomalyAge(input(capped.rows[0]?.at || "", true), clock).kind, "long");

const tied = listInboundSyncAnomalyAgeQueue(
  [
    { id: "b", at: at(-10 * day), anomaly: true },
    { id: "a", at: at(-10 * day), anomaly: true }
  ],
  (row) => presentInboundSyncAnomalyAge(input(row.at, row.anomaly), clock)
);
assert.deepEqual(tied.rows.map((row) => row.id), ["a", "b"]);

const duplicated = listInboundSyncAnomalyAgeQueue(
  [
    { id: "a", at: at(-12 * day), anomaly: true },
    { id: "a", at: at(-1 * day), anomaly: true }
  ],
  (row) => presentInboundSyncAnomalyAge(input(row.at, row.anomaly), clock)
);
assert.deepEqual(duplicated.rows.map((row) => row.id), ["a"]);
assert.equal(presentInboundSyncAnomalyAge(input(duplicated.rows[0]?.at || "", true), clock).kind, "long");

const onlyNone = listInboundSyncAnomalyAgeQueue(
  [
    { id: "blank", at: "", anomaly: true },
    { id: "bad", at: "刚刚", anomaly: true },
    { id: "clear", at: at(-12 * day), anomaly: false }
  ],
  (row) => presentInboundSyncAnomalyAge(input(row.at, row.anomaly), clock)
);
assert.equal(onlyNone.total, 0);
assert.deepEqual(onlyNone.rows, []);

const recentDoesNotCrowd = listInboundSyncAnomalyAgeQueue(
  [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `old${index}`, at: at(-(index + 9) * day), anomaly: true })),
    { id: "new", at: at(-1 * day), anomaly: true },
    { id: "blank", at: "", anomaly: true }
  ],
  (row) => presentInboundSyncAnomalyAge(input(row.at, row.anomaly), clock),
  8
);
assert.equal(recentDoesNotCrowd.rows.some((row) => row.id === "new"), false);
assert.equal(recentDoesNotCrowd.rows.some((row) => row.id === "blank"), false);
assert.equal(recentDoesNotCrowd.rows[0]?.id, "old7");

console.log("inbound-sync-anomaly-age-test: ok");
