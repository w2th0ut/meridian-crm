/**
 * 坐席状态超时处置。只渲染接口给出的登记记录。
 * 没有记录不画成 0。备注和名称按文本显示。
 * 不拨号，不外发，不请求云联络中心。
 */

import { formatAgentWorkStatusTimeoutAge } from "./agent-work-status-timeout.js";

export interface AgentWorkStatusTimeoutDispositionRow {
  id?: string;
  at?: string;
  atText?: string;
  agentId?: string;
  label?: string;
  status?: string;
  disposition?: string;
  note?: string;
  elapsedSeconds?: number | null;
  thresholdSeconds?: number | null;
  actorId?: string;
  actorLabel?: string;
}

export interface AgentWorkStatusTimeoutDispositionResponse {
  filters?: { from?: string; to?: string; disposition?: string };
  timeZone?: string;
  viewedAt?: string;
  rowCount?: number;
  rows?: AgentWorkStatusTimeoutDispositionRow[];
}

export interface AgentWorkStatusTimeoutDispositionAgent {
  agentId?: string;
  label?: string;
  status?: string;
}

const STATUS_LABELS: Record<string, string> = {
  break: "小休",
  busy: "忙碌"
};

const DISPOSITION_LABELS: Record<string, string> = {
  reminded: "已提醒",
  acknowledged: "已知悉",
  noted: "备注"
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

function statusText(value: unknown) {
  return typeof value === "string" && STATUS_LABELS[value] ? STATUS_LABELS[value] : "—";
}

function dispositionText(value: unknown) {
  return typeof value === "string" && DISPOSITION_LABELS[value] ? DISPOSITION_LABELS[value] : "—";
}

export function agentWorkStatusTimeoutDispositionQuery(input: { from?: string; to?: string; disposition?: string }) {
  const params = new URLSearchParams();
  if (input.from && /^\d{4}-\d{2}-\d{2}$/.test(input.from)) params.set("from", input.from);
  if (input.to && /^\d{4}-\d{2}-\d{2}$/.test(input.to)) params.set("to", input.to);
  if (input.disposition === "reminded" || input.disposition === "acknowledged" || input.disposition === "noted") {
    params.set("disposition", input.disposition);
  }
  const textValue = params.toString();
  return textValue ? `?${textValue}` : "";
}

export function agentWorkStatusTimeoutDispositionBody(input: { agentId?: string; disposition?: string; note?: string }) {
  return {
    agentId: input.agentId || "",
    disposition: input.disposition || "",
    note: input.note ?? ""
  };
}

export function renderAgentWorkStatusTimeoutDispositionAgents(rows: AgentWorkStatusTimeoutDispositionAgent[] | undefined, selected = "") {
  const options = (rows || []).flatMap((row) => {
    if (!row.agentId) return [];
    const picked = row.agentId === selected ? " selected" : "";
    const label = text(row.label) === "—" ? row.agentId : String(row.label);
    return [`<option value="${escapeHtml(row.agentId)}"${picked}>${escapeHtml(label)} · ${escapeHtml(statusText(row.status))}</option>`];
  });
  return `<option value="">选择当前超时的坐席</option>${options.join("")}`;
}

export function renderAgentWorkStatusTimeoutDispositions(data: AgentWorkStatusTimeoutDispositionResponse | undefined) {
  const rows = data?.rows || [];
  const table = rows.length
    ? `<table class="agent-work-status-timeout-disposition-table"><thead><tr><th>时间</th><th>坐席</th><th>状态</th><th>处置</th><th>备注</th><th>已持续</th><th>阈值</th><th>登记人</th></tr></thead><tbody>${rows.map((row) => {
      const elapsed = finite(row.elapsedSeconds) ? String(Math.floor(row.elapsedSeconds)) : "—";
      const threshold = finite(row.thresholdSeconds) ? String(Math.floor(row.thresholdSeconds)) : "—";
      return `<tr data-agent-work-status-timeout-disposition-row="${escapeHtml(row.agentId || "")}"><td>${escapeHtml(text(row.atText))}</td><td>${escapeHtml(text(row.label))}</td><td>${escapeHtml(statusText(row.status))}</td><td>${escapeHtml(dispositionText(row.disposition))}</td><td>${escapeHtml(text(row.note))}</td><td data-elapsed="${escapeHtml(elapsed)}">${escapeHtml(finite(row.elapsedSeconds) ? formatAgentWorkStatusTimeoutAge(row.elapsedSeconds) : "—")}</td><td data-threshold="${escapeHtml(threshold)}">${escapeHtml(finite(row.thresholdSeconds) ? formatAgentWorkStatusTimeoutAge(row.thresholdSeconds) : "—")}</td><td>${escapeHtml(text(row.actorLabel))}</td></tr>`;
    }).join("")}</tbody></table>`
    : `<div class="empty-cell" data-agent-work-status-timeout-disposition-empty="1">这一段日期里还没有处置记录。</div>`;
  return `<div data-agent-work-status-timeout-disposition="1">${table}</div>`;
}
