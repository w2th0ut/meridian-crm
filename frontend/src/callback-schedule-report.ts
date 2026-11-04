/**
 * 回拨预约报表。次数和前后值只渲染接口给的字段。
 * 接口没给某项次数时，不把次数画成 0。没有记下的格子写成「—」。
 */

export interface CallbackScheduleReportRow {
  id?: string;
  kind?: string;
  at?: string;
  targetType?: string;
  targetLabel?: string;
  targetId?: string;
  name?: string;
  actorId?: string;
  actorLabel?: string;
  previousScheduledAt?: string;
  previousNote?: string;
  nextScheduledAt?: string;
  nextNote?: string;
  reason?: string;
  reasonLabel?: string;
  queueScope?: string;
  queueScopeLabel?: string;
  overdueOnly?: boolean | null;
  queueRowCount?: number | null;
}

export interface CallbackScheduleReportCounts {
  dueCount?: number | null;
  overdueCount?: number | null;
  completedCount?: number | null;
  rescheduledCount?: number | null;
}

export interface CallbackScheduleReportMetrics {
  due?: boolean;
  overdue?: boolean;
  completed?: boolean;
  rescheduled?: boolean;
}

export interface CallbackScheduleReportResponse {
  filters?: { from?: string; to?: string };
  timeZone?: string;
  today?: string;
  metrics?: CallbackScheduleReportMetrics;
  counts?: CallbackScheduleReportCounts;
  rowCount?: number;
  rows?: CallbackScheduleReportRow[];
}

const KIND_LABELS: Record<string, string> = {
  due: "今日到期",
  overdue: "已逾期",
  completed: "已完成",
  rescheduled: "已改期",
  queue_read: "队列查看",
  queue_export: "队列导出"
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : "—";
}

export function callbackScheduleReportQuery(input: { from?: string; to?: string }) {
  const params = new URLSearchParams();
  if (input.from) params.set("from", input.from);
  if (input.to) params.set("to", input.to);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function countText(enabled: boolean | undefined, value: number | null | undefined) {
  if (enabled !== true || !finite(value)) return "—";
  return String(value);
}

function countCell(key: string, label: string, value: string) {
  return `<div data-callback-schedule-count="${escapeHtml(key)}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function sideText(at: unknown, note: unknown) {
  return `${text(at)} / ${text(note)}`;
}

function queueOverdue(value: boolean | null | undefined) {
  if (value === true) return "是";
  if (value === false) return "否";
  return "—";
}

export function renderCallbackScheduleReport(data: CallbackScheduleReportResponse | undefined) {
  const metrics = data?.metrics || {};
  const counts = data?.counts || {};
  const summary = [
    countCell("due", "今日到期", countText(metrics.due, counts.dueCount)),
    countCell("overdue", "已逾期", countText(metrics.overdue, counts.overdueCount)),
    countCell("completed", "已完成", countText(metrics.completed, counts.completedCount)),
    countCell("rescheduled", "已改期", countText(metrics.rescheduled, counts.rescheduledCount))
  ].join("");
  const today = text(data?.today);
  const rows = data?.rows || [];
  const total = finite(data?.rowCount) ? String(data?.rowCount) : "—";
  const detail = rows.length
    ? `<table class="callback-schedule-report-table"><thead><tr><th>种类</th><th>时间</th><th>对象</th><th>操作人</th><th>改前</th><th>改后</th><th>原因</th><th>队列</th></tr></thead><tbody>${rows.map((row) => {
      const id = row.id || "";
      const kind = KIND_LABELS[row.kind || ""] || text(row.kind);
      const name = text(row.name);
      const type = text(row.targetLabel);
      const queueCount = finite(row.queueRowCount) ? String(row.queueRowCount) : "—";
      const queue = row.kind === "queue_read" || row.kind === "queue_export"
        ? `${text(row.queueScopeLabel)} · 只看已逾期 ${queueOverdue(row.overdueOnly)} · ${queueCount} 行`
        : "—";
      return `<tr data-callback-schedule-report-row="${escapeHtml(id)}"><td>${escapeHtml(kind)}</td><td>${escapeHtml(text(row.at))}</td><td>${escapeHtml(type)} ${escapeHtml(name)}</td><td>${escapeHtml(text(row.actorLabel))}</td><td data-before="1">${escapeHtml(sideText(row.previousScheduledAt, row.previousNote))}</td><td data-after="1">${escapeHtml(sideText(row.nextScheduledAt, row.nextNote))}</td><td>${escapeHtml(text(row.reasonLabel))}</td><td data-queue="1">${escapeHtml(queue)}</td></tr>`;
    }).join("")}</tbody></table>`
    : `<div class="empty-cell" data-callback-schedule-report-empty="1">这个范围内还没有记下的回拨预约明细。</div>`;
  return `<div data-callback-schedule-report="1"><p data-callback-schedule-report-today="${escapeHtml(today)}">租户当地日 ${escapeHtml(today)}</p><p data-callback-schedule-report-rows="${escapeHtml(total)}">这一筛有 ${escapeHtml(total)} 条明细</p><dl>${summary}</dl>${detail}</div>`;
}
