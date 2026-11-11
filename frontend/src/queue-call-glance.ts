/**
 * 工作台现有名单每一行上的今日已拨次数和最近一次通话结果。
 * 接口没有这两格时不画，也不把次数写成 0。没有外呼按钮。
 */

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
