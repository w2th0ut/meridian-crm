import assert from "node:assert/strict";
import {
  STAGE_STUCK_LIMIT,
  STAGE_STUCK_WINDOW_DAYS,
  formatStageStuckAt,
  listStageStuckQueue,
  presentStageStuck,
  stageStuckEntryLabel,
  stageStuckLineLabel,
  stageStuckMatchesFilter,
  stageStuckRank,
  stageStuckStatusLabel,
  stageStuckSummary,
  type StageStuckInput
} from "./prospect-stage-stuck.js";

const clock = new Date("2026-10-30T12:00:00.000Z");
const at = (offsetMs: number) => new Date(clock.getTime() + offsetMs).toISOString();
const day = 86_400_000;

function input(patch: Partial<StageStuckInput> = {}): StageStuckInput {
  return {
    stageKey: "pending_touch",
    stageLabel: "待触达",
    enteredAt: at(-8 * day),
    enteredKind: "iso",
    enteredLabel: "加入搜客清单",
    ...patch
  };
}

const none = presentStageStuck(input({ enteredAt: "  ", enteredKind: "iso", enteredLabel: "" }), clock);
assert.equal(none.kind, "none");
assert.equal(stageStuckLineLabel(none), "无阶段");
assert.equal(stageStuckEntryLabel(), "查看当前阶段");
assert.match(stageStuckSummary(none), /^无阶段。/);
assert.match(stageStuckSummary(none), /这不是获客阶段计数，也不是获客待办摘要，也不是下次跟进逾期/);
assert.match(stageStuckSummary(none), /也不是待记跟进或今日到期，也不是待发草稿、外联序列、回复、打开或点击、失败或抑制、收信同步/);
assert.match(stageStuckSummary(none), /不会改阶段，不会自动跟进，不会发信，也不会改 convert_to_lead 或 approved_contactable/);
assert.match(stageStuckSummary(none), /超过 7 天算卡住/);
assert.doesNotMatch(stageStuckLineLabel(none), /逾期|今日到期|无下次跟进|已逾期|未设下次跟进|获客待办|无序列|无待发草稿|无回复/);
assert.equal(stageStuckMatchesFilter(none, "stuck"), false);
assert.equal(stageStuckMatchesFilter(none, "all"), true);
assert.equal(presentStageStuck(input({ enteredAt: "", stageKey: "contactable", stageLabel: "可联系" }), clock).kind, "none");
assert.equal(presentStageStuck(input({ enteredKind: "", enteredAt: at(-30 * day) }), clock).kind, "none");

const followOnly = presentStageStuck(input({
  stageKey: "following",
  stageLabel: "跟进中",
  enteredAt: "2026-10-01 09:00",
  enteredKind: "follow",
  enteredLabel: "下次跟进"
}), clock);
assert.equal(followOnly.kind, "none", "下次跟进不是阶段进入时间");
assert.equal(stageStuckLineLabel(followOnly), "无阶段");
assert.equal(stageStuckMatchesFilter(followOnly, "stuck"), false);

const unparsed = presentStageStuck(input({ enteredAt: "明天", enteredKind: "iso" }), clock);
assert.equal(unparsed.kind, "none");
assert.equal(unparsed.enteredAtMs, 0);

const stuckAt = new Date(clock.getTime() - 8 * day);
const stuck = presentStageStuck(input({ enteredAt: stuckAt.toISOString() }), clock);
assert.equal(stuck.kind, "stuck");
assert.equal(stuck.stageLabel, "待触达");
assert.equal(stuck.enteredAtMs, stuckAt.getTime());
assert.equal(formatStageStuckAt(stuck.enteredAtMs), formatStageStuckAt(stuckAt.getTime()));
assert.equal(stageStuckLineLabel(stuck), `卡住 · 待触达 · ${formatStageStuckAt(stuck.enteredAtMs)}`);
assert.match(stageStuckSummary(stuck), /^卡住 待触达 加入搜客清单 /);
assert.doesNotMatch(stageStuckLineLabel(stuck), /逾期|今日到期|无下次跟进|获客待办/);
assert.equal(stageStuckMatchesFilter(stuck, "stuck"), true);
assert.equal(stageStuckRank(stuck), 0);

const justOver = presentStageStuck(input({ enteredAt: at(-STAGE_STUCK_WINDOW_DAYS * day - 1) }), clock);
assert.equal(justOver.kind, "stuck", "超过 7 天算卡住");

const exact = presentStageStuck(input({ enteredAt: at(-STAGE_STUCK_WINDOW_DAYS * day) }), clock);
assert.equal(exact.kind, "moving", "刚好 7 天仍算推进中");
assert.equal(stageStuckLineLabel(exact).startsWith("推进中 · 待触达 · "), true);
assert.equal(stageStuckMatchesFilter(exact, "stuck"), false);
assert.equal(stageStuckRank(exact), 1);

const recent = presentStageStuck(input({
  stageKey: "reached_unapproved",
  stageLabel: "已触达待批准",
  enteredAt: at(-2 * day),
  enteredLabel: "发出开发信"
}), clock);
assert.equal(recent.kind, "moving");
assert.equal(stageStuckStatusLabel(recent), "推进中");
assert.equal(stageStuckStatusLabel(none), "无阶段");

const future = presentStageStuck(input({ enteredAt: at(day) }), clock);
assert.equal(future.kind, "moving");

const converted = presentStageStuck(input({
  stageKey: "converted",
  stageLabel: "已转线索",
  enteredAt: at(-20 * day),
  enteredLabel: "状态变更"
}), clock);
assert.equal(converted.kind, "stuck", "已转线索也按状态变更时间判断停留，但不改阶段");
assert.match(stageStuckSummary(converted), /不会改阶段/);

const held = presentStageStuck(input({
  stageKey: "held",
  stageLabel: "已抑制",
  enteredAt: "",
  enteredKind: "",
  enteredLabel: ""
}), clock);
assert.equal(held.kind, "none");

const frozenSource = input();
const frozen = Object.freeze(frozenSource);
presentStageStuck(frozen, clock);
assert.equal(frozen.enteredAt, frozenSource.enteredAt);
assert.equal(frozen.stageKey, "pending_touch");

const rows = [
  { id: "moving", shortlisted: true, enteredAt: at(-1 * day), kind: "iso" as const },
  { id: "stuck-later", shortlisted: true, enteredAt: at(-9 * day), kind: "iso" as const },
  { id: "stuck-earlier", shortlisted: true, enteredAt: at(-12 * day), kind: "iso" as const },
  { id: "none", shortlisted: true, enteredAt: "", kind: "iso" as const },
  { id: "follow", shortlisted: true, enteredAt: at(-30 * day), kind: "follow" as const },
  { id: "exact", shortlisted: true, enteredAt: at(-7 * day), kind: "iso" as const }
];
const queue = listStageStuckQueue(rows, (row) => presentStageStuck({
  stageKey: "pending_touch",
  stageLabel: "待触达",
  enteredAt: row.enteredAt,
  enteredKind: row.kind,
  enteredLabel: "加入搜客清单"
}, clock));
assert.deepEqual(queue.rows.map((row) => row.id), ["stuck-earlier", "stuck-later", "exact", "moving"]);
assert.equal(queue.total, 4);
assert.equal(STAGE_STUCK_LIMIT, 8);
assert.equal(STAGE_STUCK_WINDOW_DAYS, 7);

const many = Array.from({ length: 9 }, (_, index) => ({
  id: `s${index}`,
  enteredAt: at(-(20 - index) * day)
}));
const capped = listStageStuckQueue(many, (row) => presentStageStuck(input({ enteredAt: row.enteredAt }), clock));
assert.equal(capped.total, 9);
assert.equal(capped.rows.length, 8);
assert.deepEqual(capped.rows.map((row) => row.id), ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
assert.equal(presentStageStuck(input({ enteredAt: capped.rows[0]?.enteredAt }), clock).kind, "stuck");

console.log("prospect-stage-stuck-test: ok");
