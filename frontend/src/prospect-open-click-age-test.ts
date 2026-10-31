import assert from "node:assert/strict";
import { presentOutreachEngagement } from "./prospect-outreach-engagement.js";
import {
  OPEN_CLICK_AGE_LIMIT,
  OPEN_CLICK_AGE_WINDOW_DAYS,
  formatOpenClickAgeAt,
  listOpenClickAgeQueue,
  openClickAgeEntryLabel,
  openClickAgeLineLabel,
  openClickAgeListFilterForOpen,
  openClickAgeMatchesFilter,
  openClickAgeRank,
  openClickAgeStatusLabel,
  openClickAgeSummary,
  openClickOccurrenceAt,
  presentOpenClickAge,
  type OpenClickAgeInput
} from "./prospect-open-click-age.js";

const clock = new Date("2026-10-30T12:00:00.000Z");
const at = (offsetMs: number) => new Date(clock.getTime() + offsetMs).toISOString();
const day = 86_400_000;
const forbidden = /空档|已到期|静默|跟进空档|逾期|有回复|即将到期|未临近|无序列到期|近期有外联|无外联记录|有动作|新近|未加入|近期有跟进|无记录|缺邮箱|卡住|积压较久|积压较新|无待处理回复|较久|待放已久|待放未久|无待放行|抑制超七日|抑制七日内|无抑制日龄|失败超七日|失败七日内|无失败日龄|无失败记录|发送失败|开发信退信|无打开或点击|有打开\/点击/;

function input(atValue: string, opened = true): OpenClickAgeInput {
  return { opened, at: atValue };
}

function fromProjection(openAt: string, clickAt: string, opened: boolean) {
  return presentOpenClickAge({
    opened,
    at: openClickOccurrenceAt(openAt, clickAt)
  }, clock);
}

const none = presentOpenClickAge(input("  ", false), clock);
assert.equal(none.kind, "none");
assert.equal(none.atMs, 0);
assert.equal(openClickAgeLineLabel(none), "无打开日龄");
assert.equal(openClickAgeStatusLabel(none), "无打开日龄");
assert.equal(openClickAgeEntryLabel(), "查看打开或点击");
assert.match(openClickAgeSummary(none), /^无打开日龄。/);
assert.match(openClickAgeSummary(none), /超过 7 天算打开超七日/);
assert.match(openClickAgeSummary(none), /刚好 7 天仍算打开七日内/);
assert.match(openClickAgeSummary(none), /打开和点击都有可解析时间时，取较晚的那一份/);
assert.match(openClickAgeSummary(none), /这不是失败退信日龄，也不是抑制名单日龄，也不是待放行批次，也不是回复待处理积压，也不是序列下一步到期，也不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄/);
assert.match(openClickAgeSummary(none), /也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口/);
assert.match(openClickAgeSummary(none), /也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住/);
assert.match(openClickAgeSummary(none), /也不是待记跟进或今日到期，也不是待发草稿、外联序列进度/);
assert.match(openClickAgeSummary(none), /也不是失败或退信、收信同步/);
assert.match(openClickAgeSummary(none), /不替代开发信打开或点击那一块/);
assert.match(openClickAgeSummary(none), /不会自动跟进，不会自动发下一封，不会推进序列，不会发信，不会改名单，也不会改 convert_to_lead 或 approved_contactable/);
assert.match(openClickAgeSummary(none), /失败或退信的发生时间不算这次打开的时间/);
assert.match(openClickAgeSummary(none), /抑制或退订的生效时间不算这次打开的时间/);
assert.match(openClickAgeSummary(none), /待放行批次的更新时间不算这次打开的时间/);
assert.match(openClickAgeSummary(none), /跟进记录不算这次打开的时间/);
assert.match(openClickAgeSummary(none), /加入短名单的时间不算这次打开的时间/);
assert.match(openClickAgeSummary(none), /下次跟进那种时间不算这次打开的时间/);
assert.match(openClickAgeSummary(none), /最近一封开发信的发出时间不算这次打开的时间/);
assert.match(openClickAgeSummary(none), /序列下一步的计划时间不算这次打开的时间/);
assert.match(openClickAgeSummary(none), /最近一次开发信回复的时间不算这次打开的时间/);
assert.match(openClickAgeSummary(none), /最近触达（含话机）不算这次打开的时间/);
assert.match(openClickAgeSummary(none), /收信同步的账号状态不算这次打开的时间/);
assert.doesNotMatch(openClickAgeLineLabel(none), forbidden);
assert.equal(openClickAgeMatchesFilter(none, "long"), false);
assert.equal(openClickAgeMatchesFilter(none, "all"), true);
assert.equal(openClickAgeRank(none), 2);
assert.equal(openClickAgeListFilterForOpen(none), "all");
assert.equal(presentOpenClickAge(input("", true), clock).kind, "none");
assert.equal(presentOpenClickAge(input("刚刚", true), clock).kind, "none");
assert.equal(presentOpenClickAge(input("不是时间", true), clock).kind, "none");
assert.equal(presentOpenClickAge(input(at(-30 * day), false), clock).kind, "none", "没有打开或点击时，即使带了时间也是无打开日龄");
assert.equal(openClickOccurrenceAt("", ""), "");
assert.equal(openClickOccurrenceAt("不是时间", "刚刚"), "");

const longAt = new Date(clock.getTime() - 8 * day);
const long = presentOpenClickAge(input(longAt.toISOString(), true), clock);
assert.equal(long.kind, "long");
assert.equal(long.atMs, longAt.getTime());
assert.equal(formatOpenClickAgeAt(long.atMs), formatOpenClickAgeAt(longAt.getTime()));
assert.equal(openClickAgeLineLabel(long), `打开超七日 · ${formatOpenClickAgeAt(long.atMs)}`);
assert.match(openClickAgeSummary(long), /^打开超七日 /);
assert.doesNotMatch(openClickAgeLineLabel(long), forbidden);
assert.doesNotMatch(openClickAgeLineLabel(long), /打开七日内|无打开日龄/);
assert.equal(openClickAgeMatchesFilter(long, "long"), true);
assert.equal(openClickAgeRank(long), 0);
assert.equal(openClickAgeStatusLabel(long), "打开超七日");
assert.equal(openClickAgeListFilterForOpen(long), "long");

const justOver = presentOpenClickAge(input(at(-(OPEN_CLICK_AGE_WINDOW_DAYS * day + 1)), true), clock);
assert.equal(justOver.kind, "long", "超过 7 天算打开超七日");

const exact = presentOpenClickAge(input(at(-OPEN_CLICK_AGE_WINDOW_DAYS * day), true), clock);
assert.equal(exact.kind, "recent", "刚好 7 天仍算打开七日内");
assert.equal(openClickAgeLineLabel(exact).startsWith("打开七日内 · "), true);
assert.equal(openClickAgeRank(exact), 1);
assert.equal(openClickAgeMatchesFilter(exact, "long"), false);
assert.equal(openClickAgeStatusLabel(exact), "打开七日内");
assert.equal(openClickAgeListFilterForOpen(exact), "all");
assert.doesNotMatch(openClickAgeLineLabel(exact), forbidden);
assert.doesNotMatch(openClickAgeLineLabel(exact), /打开超七日|无打开日龄/);

const justInside = presentOpenClickAge(input(at(-(OPEN_CLICK_AGE_WINDOW_DAYS * day - 1)), true), clock);
assert.equal(justInside.kind, "recent");

const exactNow = presentOpenClickAge(input(at(0), true), clock);
assert.equal(exactNow.kind, "recent", "此刻仍算打开七日内");
assert.equal(openClickAgeMatchesFilter(exactNow, "long"), false);

const future = presentOpenClickAge(input(at(day), true), clock);
assert.equal(future.kind, "recent", "比现在更晚的可解析发生时间仍算打开七日内");

const recent = presentOpenClickAge(input(at(-2 * day), true), clock);
assert.equal(recent.kind, "recent");
assert.match(openClickAgeSummary(recent), /^打开七日内 /);

const openLater = at(-2 * day);
const clickEarlier = at(-12 * day);
assert.equal(openClickOccurrenceAt(openLater, clickEarlier), openLater);
assert.equal(fromProjection(openLater, clickEarlier, true).kind, "recent");
const clickLater = at(-1 * day);
const openEarlier = at(-12 * day);
assert.equal(openClickOccurrenceAt(openEarlier, clickLater), clickLater);
assert.equal(fromProjection(openEarlier, clickLater, true).kind, "recent", "较晚的点击把更早的打开留在七日内");
const sameAt = at(-10 * day);
assert.equal(openClickOccurrenceAt(`  ${sameAt}  `, sameAt), sameAt);
assert.equal(fromProjection(sameAt, sameAt, true).kind, "long");
assert.equal(openClickOccurrenceAt("", clickLater), clickLater);
assert.equal(openClickOccurrenceAt(openLater, "不是时间"), openLater);

const frozenSource = input(at(-8 * day), true);
const frozen = Object.freeze(frozenSource);
presentOpenClickAge(frozen, clock);
assert.equal(frozen.at, frozenSource.at);
assert.equal(frozen.opened, true);

const rows = [
  { id: "recent-later", at: at(-1 * day), opened: true },
  { id: "long-later", at: at(-9 * day), opened: true },
  { id: "long-earlier", at: at(-12 * day), opened: true },
  { id: "none", at: "", opened: true },
  { id: "clear", at: at(-20 * day), opened: false },
  { id: "invalid", at: "不是时间", opened: true },
  { id: "recent-earlier", at: at(-6 * day), opened: true },
  { id: "exact", at: at(-7 * day), opened: true }
];
const queue = listOpenClickAgeQueue(rows, (row) => presentOpenClickAge(input(row.at, row.opened), clock));
assert.deepEqual(queue.rows.map((row) => row.id), [
  "long-earlier",
  "long-later",
  "exact",
  "recent-earlier",
  "recent-later"
]);
assert.equal(queue.total, 5);
assert.equal(OPEN_CLICK_AGE_LIMIT, 8);
assert.equal(OPEN_CLICK_AGE_WINDOW_DAYS, 7);

const many = Array.from({ length: 9 }, (_, index) => ({
  id: `s${index}`,
  at: at(-(20 - index) * day),
  opened: true
}));
const capped = listOpenClickAgeQueue(many, (row) => presentOpenClickAge(input(row.at, row.opened), clock));
assert.equal(capped.total, 9);
assert.equal(capped.rows.length, 8);
assert.deepEqual(capped.rows.map((row) => row.id), ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
assert.equal(presentOpenClickAge(input(capped.rows[0]?.at || "", true), clock).kind, "long");

const tied = listOpenClickAgeQueue(
  [
    { id: "b", at: at(-10 * day), opened: true },
    { id: "a", at: at(-10 * day), opened: true }
  ],
  (row) => presentOpenClickAge(input(row.at, row.opened), clock)
);
assert.deepEqual(tied.rows.map((row) => row.id), ["a", "b"]);

const onlyNone = listOpenClickAgeQueue(
  [
    { id: "blank", at: "", opened: true },
    { id: "bad", at: "刚刚", opened: true },
    { id: "clear", at: at(-12 * day), opened: false }
  ],
  (row) => presentOpenClickAge(input(row.at, row.opened), clock)
);
assert.equal(onlyNone.total, 0);
assert.deepEqual(onlyNone.rows, []);

const mixedCap = listOpenClickAgeQueue(
  [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `due${index}`, at: at(-(index + 8) * day), opened: true })),
    { id: "none", at: "", opened: false }
  ],
  (row) => presentOpenClickAge(input(row.at, row.opened), clock)
);
assert.equal(mixedCap.total, 8);
assert.equal(mixedCap.rows.some((row) => row.id === "none"), false);

const recentDoesNotCrowd = listOpenClickAgeQueue(
  [
    ...Array.from({ length: 8 }, (_, index) => ({ id: `old${index}`, at: at(-(index + 9) * day), opened: true })),
    { id: "new", at: at(-1 * day), opened: true },
    { id: "blank", at: "", opened: true }
  ],
  (row) => presentOpenClickAge(input(row.at, row.opened), clock),
  8
);
assert.equal(recentDoesNotCrowd.rows.some((row) => row.id === "new"), false);
assert.equal(recentDoesNotCrowd.rows.some((row) => row.id === "blank"), false);
assert.equal(recentDoesNotCrowd.rows[0]?.id, "old7");

const projectedLaterClick = presentOutreachEngagement({
  status: "hit",
  open: { count: 2, at: longAt.toISOString() },
  click: { count: 1, at: at(-1 * day) }
});
assert.equal(projectedLaterClick.status, "hit");
assert.equal(openClickOccurrenceAt(projectedLaterClick.open.at, projectedLaterClick.click.at), projectedLaterClick.click.at);
assert.equal(
  fromProjection(projectedLaterClick.open.at, projectedLaterClick.click.at, projectedLaterClick.status === "hit").kind,
  "recent",
  "日龄复用 Day15 打开或点击投影上较晚的那份发生时间"
);

const projectedOpenOnly = presentOutreachEngagement({
  status: "hit",
  open: { count: 1, at: longAt.toISOString() },
  click: { count: 0, at: "" }
});
assert.equal(projectedOpenOnly.open.at, longAt.toISOString());
assert.equal(projectedOpenOnly.click.at, "");
assert.equal(
  fromProjection(projectedOpenOnly.open.at, projectedOpenOnly.click.at, projectedOpenOnly.status === "hit").kind,
  "long"
);

const projectedClickOnly = presentOutreachEngagement({
  status: "hit",
  open: { count: 0, at: at(-1 * day) },
  click: { count: 2, at: longAt.toISOString() }
});
assert.equal(projectedClickOnly.open.at, "");
assert.equal(projectedClickOnly.click.at, longAt.toISOString());
assert.equal(
  fromProjection(projectedClickOnly.open.at, projectedClickOnly.click.at, projectedClickOnly.status === "hit").kind,
  "long",
  "只有点击时仍用详情上那份点击 at"
);

const projectedClear = presentOutreachEngagement({
  status: "none",
  open: { count: 4, at: at(-30 * day) },
  click: { count: 1, at: at(-2 * day) }
});
assert.equal(fromProjection(projectedClear.open.at, projectedClear.click.at, projectedClear.status === "hit").kind, "none");

const projectedBadTime = presentOutreachEngagement({
  status: "hit",
  open: { count: 3, at: "不是时间" },
  click: { count: 1, at: "刚刚" }
});
assert.equal(projectedBadTime.open.at, "");
assert.equal(projectedBadTime.click.at, "");
assert.equal(
  fromProjection(projectedBadTime.open.at, projectedBadTime.click.at, projectedBadTime.status === "hit").kind,
  "none"
);

const projectedFailure = presentOutreachEngagement({
  status: "hit",
  kind: "bounced",
  reason: "mailbox full",
  open: { count: 2, at: at(-30 * day) },
  click: { count: 1, at: at(-30 * day) }
});
assert.equal(projectedFailure.status, "none");
assert.equal(
  fromProjection(at(-30 * day), at(-30 * day), projectedFailure.status === "hit").kind,
  "none",
  "失败或退信不算打开或点击日龄"
);

console.log("prospect-open-click-age-test: ok");
