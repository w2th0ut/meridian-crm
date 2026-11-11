import { QUEUE_CALL_GLANCE_UNLABELED, type QueueCallGlance } from "./queue-call-glance.js";

/**
 * 工作台现有六份名单上，按 §119 已经带出的今日已拨次数和最近一次通话结果做只读筛选和排序。
 * 不写审计，不建表，不加列，不改入队，不改外呼门禁。
 * 没有这两格的行不参与筛选，也不按隐藏次数插入排序。
 */

export const QUEUE_CALL_GLANCE_VIEW_KEYS = ["todayCalls", "lastOutcome", "todayCallSort"] as const;

export const QUEUE_CALL_GLANCE_VIEW_INVALID = "今日已拨或最近一次通话结果的筛选不正确";

const LAST_OUTCOMES = new Set(["有意向", "需回访", "无意向", "号码错误", "其他", QUEUE_CALL_GLANCE_UNLABELED]);

export type TodayCallsFilter = "" | "0" | "1" | "2+";
export type TodayCallSort = "" | "uncalled" | "called";

export interface QueueCallGlanceView {
  todayCalls: TodayCallsFilter;
  lastOutcome: string;
  todayCallSort: TodayCallSort;
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
  if (todayCalls === null || lastOutcome === null || todayCallSort === null) return null;
  if (todayCalls !== "" && todayCalls !== "0" && todayCalls !== "1" && todayCalls !== "2+") return null;
  if (lastOutcome !== "" && !LAST_OUTCOMES.has(lastOutcome)) return null;
  if (todayCallSort !== "" && todayCallSort !== "uncalled" && todayCallSort !== "called") return null;
  return { todayCalls, lastOutcome, todayCallSort };
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
    todayCallSort: view.todayCallSort
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
 */
export function applyQueueCallGlanceView<T extends object>(rows: readonly T[], view: QueueCallGlanceView): T[] {
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
