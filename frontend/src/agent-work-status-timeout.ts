/**
 * 坐席状态单次超时。只渲染接口给出的当前这一段。
 * 没有阈值写成「未设置」，没有已持续写成「—」，都不画成 0。
 * 不拨号，不外发，不请求云联络中心。
 */

export interface AgentWorkStatusTimeoutRow {
  id?: string;
  agentId?: string;
  label?: string;
  status?: string;
  reason?: string;
  since?: string;
  sinceText?: string;
  elapsedSeconds?: number | null;
  thresholdSeconds?: number | null;
}

export interface AgentWorkStatusTimeoutThresholds {
  break?: number | null;
  busy?: number | null;
}

export interface AgentWorkStatusTimeoutResponse {
  filters?: { status?: string };
  timeZone?: string;
  viewedAt?: string;
  thresholds?: AgentWorkStatusTimeoutThresholds;
  rowCount?: number;
  rows?: AgentWorkStatusTimeoutRow[];
}

const STATUS_LABELS: Record<string, string> = {
  break: "小休",
  busy: "忙碌"
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

/** 整秒。不足 60 秒按秒，满 60 秒起按整分钟，满 60 分钟起按整小时，满 24 小时起按整天。 */
export function formatAgentWorkStatusTimeoutAge(value: unknown) {
  if (!finite(value) || value < 0) return "—";
  const seconds = Math.floor(value);
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时`;
  return `${Math.floor(seconds / 86400)}天`;
}

export function formatAgentWorkStatusTimeoutThreshold(value: unknown) {
  if (!finite(value) || value < 60) return "未设置";
  return formatAgentWorkStatusTimeoutAge(value);
}

export function agentWorkStatusTimeoutQuery(status?: string) {
  if (status !== "break" && status !== "busy") return "";
  return `?status=${status}`;
}

function statusText(value: unknown) {
  return typeof value === "string" && STATUS_LABELS[value] ? STATUS_LABELS[value] : "—";
}

export function renderAgentWorkStatusTimeouts(data: AgentWorkStatusTimeoutResponse | undefined) {
  const thresholds = data?.thresholds || {};
  const breakThreshold = formatAgentWorkStatusTimeoutThreshold(thresholds.break);
  const busyThreshold = formatAgentWorkStatusTimeoutThreshold(thresholds.busy);
  const rows = data?.rows || [];
  const table = rows.length
    ? `<table class="agent-work-status-timeout-table"><thead><tr><th>坐席</th><th>状态</th><th>开始</th><th>已持续</th><th>阈值</th><th>原因</th></tr></thead><tbody>${rows.map((row) => {
      const elapsed = finite(row.elapsedSeconds) ? String(Math.floor(row.elapsedSeconds)) : "—";
      const threshold = finite(row.thresholdSeconds) ? String(Math.floor(row.thresholdSeconds)) : "—";
      return `<tr data-agent-work-status-timeout-row="${escapeHtml(row.agentId || "")}"><td>${escapeHtml(text(row.label))}</td><td>${escapeHtml(statusText(row.status))}</td><td>${escapeHtml(text(row.sinceText))}</td><td data-elapsed="${escapeHtml(elapsed)}">${escapeHtml(finite(row.elapsedSeconds) ? formatAgentWorkStatusTimeoutAge(row.elapsedSeconds) : "—")}</td><td data-threshold="${escapeHtml(threshold)}">${escapeHtml(finite(row.thresholdSeconds) ? formatAgentWorkStatusTimeoutAge(row.thresholdSeconds) : "—")}</td><td>${escapeHtml(text(row.reason))}</td></tr>`;
    }).join("")}</tbody></table>`
    : `<div class="empty-cell" data-agent-work-status-timeout-empty="1">这一刻没有超过阈值的坐席。</div>`;
  return `<div data-agent-work-status-timeout="1"><p data-agent-work-status-timeout-break="${escapeHtml(breakThreshold)}">小休阈值 ${escapeHtml(breakThreshold)}</p><p data-agent-work-status-timeout-busy="${escapeHtml(busyThreshold)}">忙碌阈值 ${escapeHtml(busyThreshold)}</p>${table}</div>`;
}
