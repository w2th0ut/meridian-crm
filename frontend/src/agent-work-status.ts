/**
 * 坐席工作状态。只渲染接口给的状态和时长。
 * 没记下的状态或时长写成「—」，不画成 0。
 * 不拨号，不请求云联络中心。
 */

export type AgentWorkStatus = "available" | "busy" | "break";

export interface AgentWorkStatusRow {
  agentId?: string;
  label?: string;
  status?: AgentWorkStatus | null;
  reason?: string | null;
  changedAt?: string | null;
  availableSeconds?: number | null;
  busySeconds?: number | null;
  breakSeconds?: number | null;
}

export interface AgentWorkStatusResponse {
  scope?: "self" | "team";
  today?: string;
  unmapped?: boolean;
  canReset?: boolean;
  rows?: AgentWorkStatusRow[];
  row?: AgentWorkStatusRow;
  result?: string;
}

export const AGENT_WORK_STATUS_LABELS: Record<AgentWorkStatus, string> = {
  available: "可接听",
  busy: "忙碌",
  break: "小休"
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function agentWorkStatusLabel(value: unknown) {
  if (value === "available" || value === "busy" || value === "break") return AGENT_WORK_STATUS_LABELS[value];
  return "—";
}

export function agentWorkStatusSeconds(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? `${value}秒` : "—";
}

export function readAgentWorkStatusInput(status: string, reason: string):
  | { ok: true; status: AgentWorkStatus; reason: string }
  | { ok: false; message: string } {
  const code = status.trim();
  if (code !== "available" && code !== "busy" && code !== "break") {
    return { ok: false, message: "工作状态只能是可接听、忙碌或小休" };
  }
  const text = reason.trim();
  if (text.length > 200) return { ok: false, message: "原因不能超过 200 字" };
  return { ok: true, status: code, reason: text };
}

export function renderAgentWorkStatusSummary(data: AgentWorkStatusResponse | AgentWorkStatusRow | null | undefined) {
  const row = data && "rows" in data ? data.rows?.[0] : data && "status" in (data as AgentWorkStatusRow) ? data as AgentWorkStatusRow : data && "row" in data ? data.row : undefined;
  if (!row || (row.status !== "available" && row.status !== "busy" && row.status !== "break")) {
    return `<p data-agent-work-status-empty="1">还没有记下工作状态，今日时长记为 —。</p>`;
  }
  const reason = row.reason ? `<span data-agent-work-status-reason="1">${escapeHtml(row.reason)}</span>` : "";
  return `<p data-agent-work-status="${escapeHtml(row.status)}">当前${escapeHtml(agentWorkStatusLabel(row.status))}${reason}。今日可接听 ${escapeHtml(agentWorkStatusSeconds(row.availableSeconds))}，忙碌 ${escapeHtml(agentWorkStatusSeconds(row.busySeconds))}，小休 ${escapeHtml(agentWorkStatusSeconds(row.breakSeconds))}。</p>`;
}
