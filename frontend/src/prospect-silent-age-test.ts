import assert from "node:assert/strict";
import {
  SILENT_AGE_LIMIT,
  SILENT_AGE_WINDOW_DAYS,
  formatSilentAgeAt,
  listSilentAgeQueue,
  presentSilentAge,
  silentAgeDaysLabel,
  silentAgeEntryLabel,
  silentAgeIsSilent,
  silentAgeLineLabel,
  silentAgeListFilterForOpen,
  silentAgeMatchesFilter,
  silentAgeRank,
  silentAgeStatusLabel,
  silentAgeSummary,
  type SilentAgeInput
} from "./prospect-silent-age.js";

const clock = new Date("2026-10-30T12:00:00.000Z");
const day = 86_400_000;
const at = (offsetMs: number) => new Date(clock.getTime() + offsetMs).toISOString();

function input(partial: Partial<SilentAgeInput> = {}): SilentAgeInput {
  return {
    shortlistedAt: partial.shortlistedAt ?? "2026-01-01T00:00:00.000Z",
    followUpAt: partial.followUpAt ?? "",
    outreachAt: partial.outreachAt ?? ""
  };
}

const off = presentSilentAge(input({ shortlistedAt: "  " }), clock);
assert.equal(off.kind, "off");
assert.equal(off.source, "none");
assert.equal(off.actionAtMs, 0);
assert.equal(off.ageDays, 0);
assert.equal(silentAgeLineLabel(off), "不在短名单");
assert.equal(silentAgeStatusLabel(off), "不在短名单");
assert.equal(silentAgeDaysLabel(off), "");
assert.equal(silentAgeEntryLabel(), "查看最近动作");
assert.match(silentAgeSummary(off), /^不在短名单。/);
assert.equal(silentAgeMatchesFilter(off, "silent"), false);
assert.equal(silentAgeMatchesFilter(off, "all"), true);
assert.equal(silentAgeIsSilent(off), false);
assert.equal(silentAgeRank(off), 2);
assert.equal(silentAgeListFilterForOpen(off), "all");
assert.equal(presentSilentAge(input({ shortlistedAt: "" }), clock).kind, "off");

const missing = presentSilentAge(input(), clock);
assert.equal(missing.kind, "missing");
assert.equal(missing.source, "none");
assert.equal(silentAgeLineLabel(missing), "无动作时间");
assert.equal(silentAgeStatusLabel(missing), "无动作时间");
assert.equal(silentAgeDaysLabel(missing), "");
assert.match(silentAgeSummary(missing), /^无动作时间。/);
assert.match(silentAgeSummary(missing), /这不是短名单加入日龄，也不是加入时间的日期范围，也不是跟进记录空档/);
assert.match(silentAgeSummary(missing), /也不是联系方式缺口，也不是覆盖池缺口，也不是获客待办摘要/);
assert.match(silentAgeSummary(missing), /也不是下次跟进逾期，也不是转化阶段卡住/);
assert.match(silentAgeSummary(missing), /也不是待记跟进或今日到期，也不是待发草稿、外联序列、回复、打开或点击、失败或抑制、收信同步/);
assert.match(silentAgeSummary(missing), /不会改名单，不会发信，不会自动记下跟进，也不会改 convert_to_lead 或 approved_contactable/);
assert.match(silentAgeSummary(missing), /超过 7 天，算静默/);
assert.match(silentAgeSummary(missing), /加入短名单的时间不算动作时间/);
assert.match(silentAgeSummary(missing), /刚好 7 天仍算有动作/);
assert.doesNotMatch(silentAgeLineLabel(missing), /较久|新近|未加入|空档|近期有跟进|无记录|缺邮箱|缺电话|完备|卡住|推进中|逾期|覆盖池/);
assert.equal(silentAgeMatchesFilter(missing, "silent"), true);
assert.equal(silentAgeIsSilent(missing), true);
assert.equal(silentAgeRank(missing), 0);
assert.equal(silentAgeListFilterForOpen(missing), "silent");
assert.equal(presentSilentAge(input({ followUpAt: "不是时间", outreachAt: "明天" }), clock).kind, "missing");
assert.equal(presentSilentAge(input({ followUpAt: "2026-10-01 08:00", outreachAt: "2026-10-02 09:00" }), clock).kind, "missing", "墙上时钟不算动作时间");

const joinedOnly = presentSilentAge(input({ shortlistedAt: at(-1 * day) }), clock);
assert.equal(joinedOnly.kind, "missing", "加入时间再近也不算动作");

const olderFollow = new Date(clock.getTime() - 12 * day);
const silent = presentSilentAge(input({ followUpAt: olderFollow.toISOString() }), clock);
assert.equal(silent.kind, "silent");
assert.equal(silent.source, "follow_up");
assert.equal(silent.actionAtMs, olderFollow.getTime());
assert.equal(silent.ageDays, 12);
assert.equal(formatSilentAgeAt(silent.actionAtMs), formatSilentAgeAt(olderFollow.getTime()));
assert.equal(silentAgeLineLabel(silent), `静默 · 12 天 · ${formatSilentAgeAt(silent.actionAtMs)}`);
assert.equal(silentAgeStatusLabel(silent), "静默");
assert.equal(silentAgeDaysLabel(silent), "12 天");
assert.match(silentAgeSummary(silent), /^静默 12 天 /);
assert.doesNotMatch(silentAgeLineLabel(silent), /较久|新近|未加入|空档|缺邮箱|无动作时间|有动作|卡住|逾期/);
assert.equal(silentAgeMatchesFilter(silent, "silent"), true);
assert.equal(silentAgeIsSilent(silent), true);
assert.equal(silentAgeRank(silent), 0);
assert.equal(silentAgeListFilterForOpen(silent), "silent");

const justOver = presentSilentAge(input({ outreachAt: at(-SILENT_AGE_WINDOW_DAYS * day - 1) }), clock);
assert.equal(justOver.kind, "silent", "超过 7 天算静默");
assert.equal(justOver.source, "outreach");
assert.equal(justOver.ageDays, 7);
assert.equal(silentAgeStatusLabel(justOver), "静默");
assert.equal(silentAgeDaysLabel(justOver), "7 天");

const exact = presentSilentAge(input({ outreachAt: at(-SILENT_AGE_WINDOW_DAYS * day) }), clock);
assert.equal(exact.kind, "acted", "刚好 7 天仍算有动作");
assert.equal(exact.source, "outreach");
assert.equal(exact.ageDays, 7);
assert.equal(silentAgeLineLabel(exact).startsWith("有动作 · 7 天 · "), true);
assert.equal(silentAgeMatchesFilter(exact, "silent"), false);
assert.equal(silentAgeIsSilent(exact), false);
assert.equal(silentAgeRank(exact), 1);
assert.equal(silentAgeStatusLabel(exact), "有动作");
assert.equal(silentAgeListFilterForOpen(exact), "all");
assert.match(silentAgeSummary(exact), /^有动作 7 天 /);
assert.doesNotMatch(silentAgeLineLabel(exact), /较久|新近|空档|缺邮箱|静默|无动作时间/);

const laterOutreach = presentSilentAge(input({
  followUpAt: at(-20 * day),
  outreachAt: at(-2 * day)
}), clock);
assert.equal(laterOutreach.kind, "acted");
assert.equal(laterOutreach.source, "outreach");
assert.equal(laterOutreach.ageDays, 2);

const laterFollow = presentSilentAge(input({
  followUpAt: at(-1 * day),
  outreachAt: at(-30 * day)
}), clock);
assert.equal(laterFollow.kind, "acted");
assert.equal(laterFollow.source, "follow_up");
assert.equal(laterFollow.ageDays, 1);
assert.equal(silentAgeDaysLabel(laterFollow), "1 天");

const tie = presentSilentAge(input({
  followUpAt: at(-3 * day),
  outreachAt: at(-3 * day)
}), clock);
assert.equal(tie.kind, "acted");
assert.equal(tie.source, "follow_up", "时间一样时用跟进");

const sameDay = presentSilentAge(input({ followUpAt: at(-60 * 60 * 1000) }), clock);
assert.equal(sameDay.kind, "acted");
assert.equal(sameDay.ageDays, 0);
assert.equal(silentAgeDaysLabel(sameDay), "0 天");

const future = presentSilentAge(input({ outreachAt: at(day) }), clock);
assert.equal(future.kind, "acted");
assert.equal(future.ageDays, 0);
assert.equal(silentAgeLineLabel(future).startsWith("有动作 · 0 天 · "), true);

const padded = presentSilentAge(input({ followUpAt: `  ${at(-9 * day)}  ` }), clock);
assert.equal(padded.kind, "silent");
assert.equal(padded.ageDays, 9);

const bothOld = presentSilentAge(input({
  followUpAt: at(-40 * day),
  outreachAt: at(-15 * day)
}), clock);
assert.equal(bothOld.kind, "silent");
assert.equal(bothOld.source, "outreach");
assert.equal(bothOld.ageDays, 15);

const frozenSource = input({ outreachAt: at(-8 * day) });
const frozen = Object.freeze(frozenSource);
presentSilentAge(frozen, clock);
assert.equal(frozen.shortlistedAt, frozenSource.shortlistedAt);
assert.equal(frozen.followUpAt, frozenSource.followUpAt);
assert.equal(frozen.outreachAt, frozenSource.outreachAt);
assert.equal(presentSilentAge(frozen, clock).kind, "silent");

const rows: Array<SilentAgeInput & { id: string }> = [
  { id: "acted-b", shortlistedAt: "2026-01-01T00:00:00.000Z", followUpAt: at(-1 * day), outreachAt: "" },
  { id: "silent-b", shortlistedAt: "2026-01-01T00:00:00.000Z", followUpAt: at(-10 * day), outreachAt: "" },
  { id: "silent-a", shortlistedAt: "2026-01-01T00:00:00.000Z", followUpAt: "", outreachAt: at(-20 * day) },
  { id: "missing-b", shortlistedAt: "2026-01-01T00:00:00.000Z", followUpAt: "", outreachAt: "" },
  { id: "acted-a", shortlistedAt: "2026-01-01T00:00:00.000Z", followUpAt: "", outreachAt: at(-2 * day) },
  { id: "missing-a", shortlistedAt: "2026-01-01T00:00:00.000Z", followUpAt: "明天", outreachAt: "" },
  { id: "off", shortlistedAt: "", followUpAt: at(-1 * day), outreachAt: "" }
];
const queue = listSilentAgeQueue(rows, (row) => presentSilentAge(row, clock));
assert.deepEqual(queue.rows.map((row) => row.id), [
  "missing-a",
  "missing-b",
  "silent-a",
  "silent-b",
  "acted-a",
  "acted-b"
]);
assert.equal(queue.total, 6);
assert.equal(SILENT_AGE_LIMIT, 8);
assert.equal(SILENT_AGE_WINDOW_DAYS, 7);

const many = Array.from({ length: 9 }, (_, index) => ({
  id: `s${index}`,
  shortlistedAt: "2026-01-01T00:00:00.000Z",
  followUpAt: at(-(20 - index) * day),
  outreachAt: ""
}));
const capped = listSilentAgeQueue(many, (row) => presentSilentAge(row, clock));
assert.equal(capped.total, 9);
assert.equal(capped.rows.length, 8);
assert.deepEqual(capped.rows.map((row) => row.id), ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]);

const tied = listSilentAgeQueue(
  [
    { id: "b", shortlistedAt: "2026-01-01T00:00:00.000Z", followUpAt: at(-12 * day), outreachAt: "" },
    { id: "a", shortlistedAt: "2026-01-01T00:00:00.000Z", followUpAt: at(-12 * day), outreachAt: "" }
  ],
  (row) => presentSilentAge(row, clock)
);
assert.deepEqual(tied.rows.map((row) => row.id), ["a", "b"]);

const silentFirst = listSilentAgeQueue(
  [
    { id: "acted", shortlistedAt: "2026-01-01T00:00:00.000Z", followUpAt: at(-1 * day), outreachAt: "" },
    { id: "old", shortlistedAt: "2026-01-01T00:00:00.000Z", followUpAt: "", outreachAt: at(-30 * day) }
  ],
  (row) => presentSilentAge(row, clock)
);
assert.deepEqual(silentFirst.rows.map((row) => row.id), ["old", "acted"]);

console.log("prospect-silent-age-test: ok");
