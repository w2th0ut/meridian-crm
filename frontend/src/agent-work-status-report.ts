/**
 * 坐席工作状态时长。秒数只渲染接口给的字段。
 * 没记下的时长写成「—」，不画成 0。不另造占比。
 * 不拨号，不请求云联络中心。
 */

export interface AgentWorkStatusReportAgent {
  agentId?: string;
  label?: string;
  availableSeconds?: number | null;
  busySeconds?: number | null;
  breakSeconds?: number | null;
}

export interface AgentWorkStatusReportTimelineRow {
  id?: string;
  kind?: string;
  at?: string;
  agentId?: string;
  label?: string;
  status?: string;
  source?: string;
  reason?: string;
  actorId?: string;
  actorLabel?: string;
  previousStatus?: string;
  counted?: boolean;
}

export interface AgentWorkStatusReportMetrics {
  available?: boolean;
  busy?: boolean;
  break?: boolean;
}

export interface AgentWorkStatusReportResponse {
  filters?: { from?: string; to?: string; agentId?: string };
  timeZone?: string;
  today?: string;
  metrics?: AgentWorkStatusReportMetrics;
  rowCount?: number;
  agents?: AgentWorkStatusReportAgent[];
  timeline?: AgentWorkStatusReportTimelineRow[] | null;
}

const STATUS_LABELS: Record<string, string> = {
  available: "可接听",
  busy: "忙碌",
  break: "小休"
};

const KIND_LABELS: Record<string, string> = {
  opening: "延续进入",
  change: "变更",
  rejected: "未生效的改回"
};

const SOURCE_LABELS: Record<string, string> = {
  self: "自己",
  manager: "主管"
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

/** 接口给的是整秒。不足 60 秒按秒，满 60 秒按分钟，余数再写秒。 */
export function formatAgentWorkStatusReportDuration(value: unknown) {
  if (!finite(value) || value < 0) return "—";
  const seconds = Math.floor(value);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}分钟${rest}秒` : `${minutes}分钟`;
}

export function agentWorkStatusReportQuery(input: { from?: string; to?: string; agentId?: string }) {
  const params = new URLSearchParams();
  if (input.from) params.set("from", input.from);
  if (input.to) params.set("to", input.to);
  if (input.agentId) params.set("agentId", input.agentId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function durationCell(metric: boolean | undefined, key: string, value: unknown) {
  const shown = metric === true ? formatAgentWorkStatusReportDuration(value) : "—";
  const raw = metric === true && finite(value) ? String(Math.floor(value)) : "—";
  return `<td data-${key}="${escapeHtml(raw)}">${escapeHtml(shown)}</td>`;
}

function statusText(value: unknown) {
  return typeof value === "string" && STATUS_LABELS[value] ? STATUS_LABELS[value] : "—";
}

export function renderAgentWorkStatusReport(data: AgentWorkStatusReportResponse | undefined) {
  const metrics = data?.metrics || {};
  const today = text(data?.today);
  const total = finite(data?.rowCount) ? String(data.rowCount) : "—";
  const agents = data?.agents || [];
  const summary = agents.length
    ? `<table class="agent-work-status-report-table"><thead><tr><th>坐席</th><th>可接听</th><th>忙碌</th><th>小休</th><th></th></tr></thead><tbody>${agents.map((agent) => {
      const id = agent.agentId || "";
      return `<tr data-agent-work-status-report-agent="${escapeHtml(id)}"><td>${escapeHtml(text(agent.label))}</td>${durationCell(metrics.available, "available", agent.availableSeconds)}${durationCell(metrics.busy, "busy", agent.busySeconds)}${durationCell(metrics.break, "break", agent.breakSeconds)}<td><button type="button" class="btn" data-agent-work-status-report-open="${escapeHtml(id)}">变更时间线</button></td></tr>`;
    }).join("")}</tbody></table>`
    : `<div class="empty-cell" data-agent-work-status-report-empty="1">这个范围内没有可查看的坐席。</div>`;
  const timeline = Array.isArray(data?.timeline)
    ? `<div data-agent-work-status-report-timeline="1"><button type="button" class="btn" data-agent-work-status-report-clear="1">只看汇总</button>${data.timeline.length
      ? `<table><thead><tr><th>种类</th><th>时间</th><th>状态</th><th>来源</th><th>原因</th><th>操作人</th><th>改前</th><th>计入时长</th></tr></thead><tbody>${data.timeline.map((row) => {
        const counted = row.counted === true ? "是" : row.counted === false ? "否" : "—";
        return `<tr data-agent-work-status-report-event="${escapeHtml(row.id || "")}"><td>${escapeHtml(KIND_LABELS[row.kind || ""] || text(row.kind))}</td><td>${escapeHtml(text(row.at))}</td><td>${escapeHtml(statusText(row.status))}</td><td>${escapeHtml(SOURCE_LABELS[row.source || ""] || "—")}</td><td>${escapeHtml(text(row.reason))}</td><td>${escapeHtml(text(row.actorLabel))}</td><td data-previous="1">${escapeHtml(statusText(row.previousStatus))}</td><td data-counted="${escapeHtml(counted)}">${escapeHtml(counted)}</td></tr>`;
      }).join("")}</tbody></table>`
      : `<div class="empty-cell" data-agent-work-status-report-timeline-empty="1">这一段没有记下的状态变更。</div>`}</div>`
    : "";
  return `<div data-agent-work-status-report="1"><p data-agent-work-status-report-today="${escapeHtml(today)}">上海日期 ${escapeHtml(today)}</p><p data-agent-work-status-report-rows="${escapeHtml(total)}">这一筛有 ${escapeHtml(total)} 位坐席</p>${summary}${timeline}</div>`;
}
