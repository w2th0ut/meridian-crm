import { zonedDateKey } from "./outbound-call.js";
import { parseQueueCallWallMinute, QUEUE_CALL_GLANCE_UNLABELED, type QueueCallGlance } from "./queue-call-glance.js";

/**
 * 工作台现有六份名单上，按 §119 已经带出的今日已拨次数和最近一次通话结果，
 * 以及 §121 已经带出的最近一次通话开始时间，做只读筛选和排序。
 * 不写审计，不建表，不加列，不改入队，不改外呼门禁。
 * 没有今日已拨和结果这两格的行不参与筛选，也不按隐藏次数或隐藏时间插入排序。
 * 没有可见通话时间的行不因为排序被当成 0 点。
 */

export const QUEUE_CALL_GLANCE_VIEW_KEYS = ["todayCalls", "lastOutcome", "todayCallSort", "lastCallWithin", "lastCallSort"] as const;

export const QUEUE_CALL_GLANCE_VIEW_INVALID = "今日已拨、最近一次通话结果或最近一次通话时间的筛选不正确";

const LAST_OUTCOMES = new Set(["有意向", "需回访", "无意向", "号码错误", "其他", QUEUE_CALL_GLANCE_UNLABELED]);
const WALL_MINUTE = /^(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}$/;

export type TodayCallsFilter = "" | "0" | "1" | "2+";
export type TodayCallSort = "" | "uncalled" | "called";
export type LastCallWithin = "" | "30m" | "1h" | "today";
export type LastCallSort = "" | "older" | "newer";

export interface QueueCallGlanceView {
  todayCalls: TodayCallsFilter;
  lastOutcome: string;
  todayCallSort: TodayCallSort;
  lastCallWithin: LastCallWithin;
  lastCallSort: LastCallSort;
}

/** 筛选和排序用的现在、租户时区，以及这一刻的租户当地日。 */
export interface QueueCallGlanceClock {
  nowMs: number;
  timeZone: string;
  today: string;
}

export function queueCallGlanceClock(now: Date, timeZone: string): QueueCallGlanceClock {
  return { nowMs: now.getTime(), timeZone, today: zonedDateKey(now, timeZone) };
}

function oneQuery(value: unknown) {
  if (Array.isArray(value)) return null;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value.trim() : null;
}

export function parseQueueCallGlanceView(query: Record<string, unknown>): QueueCallGlanceView | null {
  const todayCalls = oneQuery(query.todayCalls);
  const lastOutcome = oneQuery(query.lastOutcome);
  const todayCallSort = oneQuery(query.todayCallSort);
  const lastCallWithin = oneQuery(query.lastCallWithin);
  const lastCallSort = oneQuery(query.lastCallSort);
  if (todayCalls === null || lastOutcome === null || todayCallSort === null || lastCallWithin === null || lastCallSort === null) return null;
  if (todayCalls !== "" && todayCalls !== "0" && todayCalls !== "1" && todayCalls !== "2+") return null;
  if (lastOutcome !== "" && !LAST_OUTCOMES.has(lastOutcome)) return null;
  if (todayCallSort !== "" && todayCallSort !== "uncalled" && todayCallSort !== "called") return null;
  if (lastCallWithin !== "" && lastCallWithin !== "30m" && lastCallWithin !== "1h" && lastCallWithin !== "today") return null;
  if (lastCallSort !== "" && lastCallSort !== "older" && lastCallSort !== "newer") return null;
  return { todayCalls, lastOutcome, todayCallSort, lastCallWithin, lastCallSort };
}

export function withoutQueueCallGlanceView(query: Record<string, unknown>) {
  const rest: Record<string, unknown> = { ...query };
  for (const key of QUEUE_CALL_GLANCE_VIEW_KEYS) delete rest[key];
  return rest;
}

export function takeQueueCallGlanceView(query: Record<string, unknown>):
  | { ok: true; view: QueueCallGlanceView; rest: Record<string, unknown> }
  | { ok: false } {
  const view = parseQueueCallGlanceView(query);
  if (!view) return { ok: false };
  return { ok: true, view, rest: withoutQueueCallGlanceView(query) };
}

export function queueCallGlanceViewFields(view: QueueCallGlanceView) {
  return {
    todayCalls: view.todayCalls,
    lastOutcome: view.lastOutcome,
    todayCallSort: view.todayCallSort,
    lastCallWithin: view.lastCallWithin,
    lastCallSort: view.lastCallSort
  };
}

function readGlance(row: object): Partial<QueueCallGlance> {
  const value = row as { todayCallCount?: unknown; lastCallOutcome?: unknown };
  return {
    todayCallCount: typeof value.todayCallCount === "number" ? value.todayCallCount : undefined,
    lastCallOutcome: typeof value.lastCallOutcome === "string" ? value.lastCallOutcome : undefined
  };
}

function visibleGlance(row: object): row is object & QueueCallGlance {
  const glance = readGlance(row);
  return typeof glance.todayCallCount === "number"
    && Number.isInteger(glance.todayCallCount)
    && glance.todayCallCount >= 0
    && typeof glance.lastCallOutcome === "string";
}

function matchesTodayCalls(count: number, filter: TodayCallsFilter) {
  if (filter === "0") return count === 0;
  if (filter === "1") return count === 1;
  if (filter === "2+") return count >= 2;
  return true;
}

/**
 * 筛选只留下看得到两格、并且对得上的行。
 * 排序只重排看得到次数的行：未拨在前是从少到多，已拨多的在前是从多到少。次数相同保持原顺序。
 * 没有两格的行在只排序时保持原相对顺序，并排在后面，不当成 0 次或未标注。
 * 最近通话时间的筛选和排序另走 applyLastCallView。不带那两个参数时，这里的结果与原来相同。
 */
export function applyQueueCallGlanceView<T extends object>(
  rows: readonly T[],
  view: QueueCallGlanceView,
  clock?: QueueCallGlanceClock
): T[] {
  if (!view.lastCallWithin && !view.lastCallSort) return applyTodayView(rows, view);
  return applyLastCallView(rows, view, clock);
}

function applyTodayView<T extends object>(rows: readonly T[], view: QueueCallGlanceView): T[] {
  const filtering = view.todayCalls !== "" || view.lastOutcome !== "";
  const sorting = view.todayCallSort !== "";
  if (!filtering && !sorting) return rows.slice();
  const visible: Array<{ row: T; index: number; count: number }> = [];
  const hidden: T[] = [];
  rows.forEach((row, index) => {
    if (!visibleGlance(row)) {
      if (!filtering) hidden.push(row);
      return;
    }
    const glance = readGlance(row);
    if (!matchesTodayCalls(glance.todayCallCount ?? 0, view.todayCalls)) return;
    if (view.lastOutcome && glance.lastCallOutcome !== view.lastOutcome) return;
    visible.push({ row, index, count: glance.todayCallCount ?? 0 });
  });
  if (sorting) {
    const direction = view.todayCallSort === "called" ? -1 : 1;
    visible.sort((left, right) => {
      const delta = left.count - right.count;
      if (delta !== 0) return delta > 0 ? direction : -direction;
      return left.index - right.index;
    });
  }
  const ordered = visible.map((item) => item.row);
  return filtering ? ordered : ordered.concat(hidden);
}

function lastCallText(row: object) {
  const value = (row as { lastCallAt?: unknown }).lastCallAt;
  return typeof value === "string" ? value.trim() : "";
}

function lastCallEpoch(row: object, clock: QueueCallGlanceClock | undefined) {
  if (!clock) return null;
  return parseQueueCallWallMinute(lastCallText(row), clock.timeZone);
}

function matchesLastCall(row: object, at: number | null, view: QueueCallGlanceView, clock: QueueCallGlanceClock | undefined) {
  if (!view.lastCallWithin) return true;
  if (!clock) return false;
  const wall = WALL_MINUTE.exec(lastCallText(row));
  if (!wall) return false;
  if (view.lastCallWithin === "today") return wall[1] === clock.today;
  if (at === null || at > clock.nowMs) return false;
  const windowMs = view.lastCallWithin === "30m" ? 30 * 60_000 : 60 * 60_000;
  return clock.nowMs - at <= windowMs;
}

function byCount<T extends { index: number; count: number }>(direction: 1 | -1) {
  return (left: T, right: T) => {
    if (left.count !== right.count) return left.count > right.count ? direction : -direction;
    return left.index - right.index;
  };
}

/**
 * 最近 30 分钟、最近 1 小时、今日已有最近通话，都只认看得到的 YYYY-MM-DD HH:mm。
 * 更久未联系在前是时间从早到晚。没有可见时间的行不插入到这个顺序里，不当成 0 点。
 * 只排序时它们仍按原来的次数规则留在后面；筛了时间时它们不出现。
 */
function applyLastCallView<T extends object>(rows: readonly T[], view: QueueCallGlanceView, clock: QueueCallGlanceClock | undefined): T[] {
  const filtering = view.todayCalls !== "" || view.lastOutcome !== "" || view.lastCallWithin !== "";
  const timed: Array<{ row: T; index: number; count: number; at: number }> = [];
  const untimed: Array<{ row: T; index: number; count: number }> = [];
  const hidden: Array<{ row: T; index: number }> = [];
  rows.forEach((row, index) => {
    if (!visibleGlance(row)) {
      if (!filtering) hidden.push({ row, index });
      return;
    }
    const glance = readGlance(row);
    const count = glance.todayCallCount ?? 0;
    if (!matchesTodayCalls(count, view.todayCalls)) return;
    if (view.lastOutcome && glance.lastCallOutcome !== view.lastOutcome) return;
    const at = lastCallEpoch(row, clock);
    if (!matchesLastCall(row, at, view, clock)) return;
    if (at === null) untimed.push({ row, index, count });
    else timed.push({ row, index, count, at });
  });
  const countDirection = view.todayCallSort === "called" ? -1 : 1;
  if (view.lastCallSort) {
    const timeDirection = view.lastCallSort === "newer" ? -1 : 1;
    timed.sort((left, right) => {
      if (left.at !== right.at) return left.at > right.at ? timeDirection : -timeDirection;
      if (view.todayCallSort) return byCount(countDirection)(left, right);
      return left.index - right.index;
    });
    const pending: Array<{ row: T; index: number }> = view.todayCallSort
      ? untimed.sort(byCount(countDirection))
      : [...untimed, ...hidden].sort((left, right) => left.index - right.index);
    const hiddenRows = view.todayCallSort ? hidden.map((item) => item.row) : [];
    return timed.map((item) => item.row).concat(pending.map((item) => item.row), hiddenRows);
  } else if (view.todayCallSort) {
    const visible = timed.map((item) => ({ row: item.row, index: item.index, count: item.count })).concat(untimed);
    visible.sort(byCount(countDirection));
    return visible.map((item) => item.row);
  }
  return timed.map((item) => item.row)
    .concat(untimed.map((item) => item.row), hidden.map((item) => item.row));
}
