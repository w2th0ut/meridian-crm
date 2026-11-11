/**
 * 工作台现有名单每一行上的今日已拨次数和最近一次通话结果。
 * 接口没有这两格时不画，也不把次数写成 0。筛选和排序只把已经带出的两格交给原来的名单。没有外呼按钮。
 */

export type QueueCallTodayCalls = "" | "0" | "1" | "2+";
export type QueueCallTodaySort = "" | "uncalled" | "called";

export interface QueueCallGlanceQuery {
  todayCalls?: QueueCallTodayCalls;
  lastOutcome?: string;
  todayCallSort?: QueueCallTodaySort;
}

const TODAY_CALLS = new Set(["0", "1", "2+"]);
const LAST_OUTCOMES = new Set(["有意向", "需回访", "无意向", "号码错误", "其他", "未标注"]);
const TODAY_SORTS = new Set(["uncalled", "called"]);

export function queueCallGlanceQueryFromValues(todayCalls: string, lastOutcome: string, todayCallSort: string): QueueCallGlanceQuery {
  return {
    todayCalls: TODAY_CALLS.has(todayCalls) ? todayCalls as QueueCallTodayCalls : "",
    lastOutcome: LAST_OUTCOMES.has(lastOutcome) ? lastOutcome : "",
    todayCallSort: TODAY_SORTS.has(todayCallSort) ? todayCallSort as QueueCallTodaySort : ""
  };
}

export function appendQueueCallGlanceQuery(params: URLSearchParams, input: QueueCallGlanceQuery | undefined) {
  if (!input) return;
  if (input.todayCalls) params.set("todayCalls", input.todayCalls);
  if (input.lastOutcome) params.set("lastOutcome", input.lastOutcome);
  if (input.todayCallSort) params.set("todayCallSort", input.todayCallSort);
}

export function queueCallGlanceFilterActive(data: { todayCalls?: string; lastOutcome?: string } | null | undefined) {
  return Boolean((data?.todayCalls || "").trim() || (data?.lastOutcome || "").trim());
}

export function queueCallGlanceFilterEmpty(attr: string) {
  return `<p ${attr} data-queue-call-filter-empty="1">这个筛选下没有对得上今日已拨或最近一次通话结果的对象。</p>`;
}

export function queueCallGlanceMarkup(row: { todayCallCount?: number; lastCallOutcome?: string } | null | undefined) {
  if (!row || typeof row.todayCallCount !== "number" || !Number.isInteger(row.todayCallCount) || row.todayCallCount < 0) return "";
  const outcome = (row.lastCallOutcome || "").trim() || "未标注";
  return `<span data-queue-call-glance="1">今日已拨 ${escapeHtml(String(row.todayCallCount))} 次</span><span data-queue-call-last-outcome="1">${escapeHtml(outcome)}</span>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
