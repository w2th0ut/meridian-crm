import { randomUUID } from "node:crypto";
import { AGENT_WORK_STATUS_TIME_ZONE } from "./agent-work-status.js";
import { agentWorkStatusReportWindow, type AgentWorkStatusReportQuery } from "./agent-work-status-report.js";
import {
  agentWorkStatusTimeoutSinceText,
  buildAgentWorkStatusTimeouts,
  isAgentWorkStatusTimeoutStatus,
  type AgentWorkStatusTimeoutStatus
} from "./agent-work-status-timeout.js";
import { outboundInstant } from "./outbound-call.js";
import type { CrmStore } from "./store.js";
import type { AgentWorkStatusTimeoutDispositionAudit, SessionUser } from "./types.js";

/**
 * 坐席状态超时处置。只对 §93 当前已经超过阈值的那一段做人工登记。
 * 当前这一段仍读 agent_work_status_logs，阈值仍读 agent_work_status_timeouts。
 * 登记和查看写入 agent_work_status_timeout_disposition_audits。
 * 不改状态日志，不改阈值，不另建状态表。
 * 只在工作台这一页显示。不发信，不发消息，不推送到系统外，不调用云联络中心。
 * 不拨号，不调用 AI，不碰抑制或合规。
 */

export const AGENT_WORK_STATUS_TIMEOUT_DISPOSITIONS = ["reminded", "acknowledged", "noted"] as const;
export type AgentWorkStatusTimeoutDisposition = (typeof AGENT_WORK_STATUS_TIMEOUT_DISPOSITIONS)[number];
export const AGENT_WORK_STATUS_TIMEOUT_DISPOSITION_NOTE_MAX = 200;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AGENT_PATTERN = /^[A-Za-z0-9_@.:-]{1,128}$/;

export interface AgentWorkStatusTimeoutDispositionQuery {
  from: string | null;
  to: string | null;
  disposition: "" | AgentWorkStatusTimeoutDisposition;
}

export interface AgentWorkStatusTimeoutDispositionBody {
  agentId: string;
  disposition: AgentWorkStatusTimeoutDisposition;
  note: string;
}

export interface AgentWorkStatusTimeoutDispositionRow {
  id: string;
  at: string;
  atText: string;
  agentId: string;
  label: string;
  status: AgentWorkStatusTimeoutStatus;
  disposition: AgentWorkStatusTimeoutDisposition;
  note: string;
  elapsedSeconds: number;
  thresholdSeconds: number;
  actorId: string;
  actorLabel: string;
}

export function isAgentWorkStatusTimeoutDisposition(value: unknown): value is AgentWorkStatusTimeoutDisposition {
  return value === "reminded" || value === "acknowledged" || value === "noted";
}

function oneQuery(value: unknown) {
  if (Array.isArray(value)) return null;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value.trim() : null;
}

function validDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseAgentWorkStatusTimeoutDispositionQuery(query: Record<string, unknown>): AgentWorkStatusTimeoutDispositionQuery | null {
  const allowed = new Set(["from", "to", "disposition"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) return null;
  if (Object.values(query).some((value) => Array.isArray(value))) return null;
  const fromRaw = oneQuery(query.from);
  const toRaw = oneQuery(query.to);
  const dispositionRaw = oneQuery(query.disposition);
  if (fromRaw === null || toRaw === null || dispositionRaw === null) return null;
  const from = fromRaw || null;
  const to = toRaw || null;
  if (from && !validDate(from)) return null;
  if (to && !validDate(to)) return null;
  if (from && to && from > to) return null;
  if (dispositionRaw && !isAgentWorkStatusTimeoutDisposition(dispositionRaw)) return null;
  const disposition = isAgentWorkStatusTimeoutDisposition(dispositionRaw) ? dispositionRaw : "";
  return { from, to, disposition };
}

export function parseAgentWorkStatusTimeoutDispositionBody(body: unknown): AgentWorkStatusTimeoutDispositionBody | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const allowed = new Set(["agentId", "disposition", "note"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return null;
  if (typeof record.agentId !== "string" || !AGENT_PATTERN.test(record.agentId)) return null;
  if (!isAgentWorkStatusTimeoutDisposition(record.disposition)) return null;
  if (record.note !== undefined && typeof record.note !== "string") return null;
  const note = typeof record.note === "string" ? record.note.trim() : "";
  if (note.length > AGENT_WORK_STATUS_TIMEOUT_DISPOSITION_NOTE_MAX) return null;
  if (record.disposition === "noted" && !note) return null;
  return { agentId: record.agentId, disposition: record.disposition, note };
}

export function agentWorkStatusTimeoutDispositionReadFilters(query: AgentWorkStatusTimeoutDispositionQuery) {
  return JSON.stringify({
    from: query.from || "",
    to: query.to || "",
    disposition: query.disposition || ""
  });
}

export function agentWorkStatusTimeoutDispositionWriteFilters(agentId: string, disposition: AgentWorkStatusTimeoutDisposition) {
  return JSON.stringify({ agentId, disposition });
}

export function agentWorkStatusTimeoutDispositionRecordFilters(status: AgentWorkStatusTimeoutStatus, disposition: AgentWorkStatusTimeoutDisposition) {
  return JSON.stringify({ status, disposition });
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function auditsOf(store: CrmStore) {
  if (!store.agentWorkStatusTimeoutDispositionAudits) store.agentWorkStatusTimeoutDispositionAudits = [];
  return store.agentWorkStatusTimeoutDispositionAudits;
}

async function writeAudit(store: CrmStore, input: Omit<AgentWorkStatusTimeoutDispositionAudit, "id" | "at">, now: Date) {
  const audit: AgentWorkStatusTimeoutDispositionAudit = {
    id: `awstda_${randomUUID()}`,
    at: now.toISOString(),
    ...input
  };
  auditsOf(store).unshift(audit);
  await store.persist();
  return audit;
}

function agentLabel(mapping: { displayName?: string; loginName?: string } | undefined, id: string) {
  return mapping?.displayName || mapping?.loginName || id;
}

function actorLabel(users: Array<{ id: string; teamId: string; name?: string }>, teamId: string, actorId: string) {
  const user = users.find((item) => item.id === actorId && item.teamId === teamId);
  return user?.name || actorId;
}

function currentTimeoutRow(store: CrmStore, teamId: string, agentId: string, now: Date) {
  const built = buildAgentWorkStatusTimeouts({
    logs: store.agentWorkStatusLogs || [],
    mappings: store.aliyunAgentMappings || [],
    thresholds: store.agentWorkStatusTimeouts || [],
    teamId,
    status: "",
    now
  });
  return built.rows.find((row) => row.agentId === agentId) || null;
}

function isDispositionAction(value: string): value is AgentWorkStatusTimeoutDisposition {
  return isAgentWorkStatusTimeoutDisposition(value);
}

export function buildAgentWorkStatusTimeoutDispositions(input: {
  audits: AgentWorkStatusTimeoutDispositionAudit[];
  mappings: Array<{ teamId: string; cccUserId: string; displayName?: string; loginName?: string }>;
  users: Array<{ id: string; teamId: string; name?: string }>;
  teamId: string;
  query: AgentWorkStatusTimeoutDispositionQuery;
  now: Date;
}): AgentWorkStatusTimeoutDispositionRow[] {
  const window = agentWorkStatusReportWindow(
    { from: input.query.from, to: input.query.to, agentId: null } satisfies AgentWorkStatusReportQuery,
    input.now
  );
  const openEnded = !input.query.from && !input.query.to;
  const labels = new Map<string, string>();
  for (const mapping of input.mappings || []) {
    if (mapping.teamId !== input.teamId || !mapping.cccUserId || labels.has(mapping.cccUserId)) continue;
    labels.set(mapping.cccUserId, agentLabel(mapping, mapping.cccUserId));
  }
  const rows: AgentWorkStatusTimeoutDispositionRow[] = [];
  for (const item of input.audits || []) {
    if (item.teamId !== input.teamId || item.result !== "recorded") continue;
    if (!isDispositionAction(item.action) || !isAgentWorkStatusTimeoutStatus(item.status)) continue;
    if (input.query.disposition && item.action !== input.query.disposition) continue;
    const ms = Date.parse(item.at);
    if (!Number.isFinite(ms)) {
      if (!openEnded) continue;
    } else if (ms < window.start || (window.inclusiveEnd ? ms > window.end : ms >= window.end)) {
      continue;
    }
    if (!Number.isInteger(item.elapsedSeconds) || !Number.isInteger(item.thresholdSeconds)) continue;
    rows.push({
      id: item.id,
      at: item.at,
      atText: agentWorkStatusTimeoutSinceText(item.at),
      agentId: item.agentId,
      label: labels.get(item.agentId) || item.agentId,
      status: item.status,
      disposition: item.action,
      note: item.note || "",
      elapsedSeconds: item.elapsedSeconds,
      thresholdSeconds: item.thresholdSeconds,
      actorId: item.actorId,
      actorLabel: actorLabel(input.users || [], input.teamId, item.actorId)
    });
  }
  rows.sort((left, right) => {
    const leftMs = Date.parse(left.at);
    const rightMs = Date.parse(right.at);
    const leftOk = Number.isFinite(leftMs);
    const rightOk = Number.isFinite(rightMs);
    if (leftOk && rightOk && leftMs !== rightMs) return rightMs - leftMs;
    if (leftOk !== rightOk) return leftOk ? -1 : 1;
    return 0;
  });
  return rows;
}

export async function listAgentWorkStatusTimeoutDispositions(
  store: CrmStore,
  user: SessionUser | undefined,
  query: Record<string, unknown>,
  now = outboundInstant()
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseAgentWorkStatusTimeoutDispositionQuery(query);
  if (!parsed) return reject("invalid_request", "参数格式错误");
  const filters = agentWorkStatusTimeoutDispositionReadFilters(parsed);
  if (!isAgentWorkStatusTimeoutManager(user)) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "read",
      agentId: "",
      logId: "",
      status: "",
      note: "",
      elapsedSeconds: 0,
      thresholdSeconds: 0,
      filters,
      rowCount: 0,
      result: "rejected",
      reason: "forbidden"
    }, now);
    return reject("forbidden", "只有主管及以上可以查看坐席状态超时处置", 403);
  }
  const rows = buildAgentWorkStatusTimeoutDispositions({
    audits: auditsOf(store),
    mappings: store.aliyunAgentMappings || [],
    users: store.users || [],
    teamId: user.teamId,
    query: parsed,
    now
  });
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "read",
    agentId: "",
    logId: "",
    status: "",
    note: "",
    elapsedSeconds: 0,
    thresholdSeconds: 0,
    filters,
    rowCount: rows.length,
    result: "read",
    reason: ""
  }, now);
  return {
    status: 200,
    body: {
      filters: { from: parsed.from || "", to: parsed.to || "", disposition: parsed.disposition },
      timeZone: AGENT_WORK_STATUS_TIME_ZONE,
      viewedAt: now.toISOString(),
      rowCount: rows.length,
      rows
    }
  };
}

function isAgentWorkStatusTimeoutManager(user: { role?: string } | undefined) {
  return user?.role === "manager" || user?.role === "admin" || user?.role === "super_admin";
}

export async function recordAgentWorkStatusTimeoutDisposition(
  store: CrmStore,
  user: SessionUser | undefined,
  body: unknown,
  now = outboundInstant()
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseAgentWorkStatusTimeoutDispositionBody(body);
  if (!parsed) return reject("invalid_request", "处置只接受已提醒、已知悉或备注，备注最长 200 字");
  if (!isAgentWorkStatusTimeoutManager(user)) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: parsed.disposition,
      agentId: parsed.agentId,
      logId: "",
      status: "",
      note: "",
      elapsedSeconds: 0,
      thresholdSeconds: 0,
      filters: agentWorkStatusTimeoutDispositionWriteFilters(parsed.agentId, parsed.disposition),
      rowCount: 0,
      result: "rejected",
      reason: "forbidden"
    }, now);
    return reject("forbidden", "只有主管及以上可以登记坐席状态超时处置", 403);
  }
  const row = currentTimeoutRow(store, user.teamId, parsed.agentId, now);
  if (!row || !isAgentWorkStatusTimeoutStatus(row.status)) return reject("not_timeout", "这一位坐席当前没有超过阈值");
  const audits = auditsOf(store);
  const same = audits.some((item) => item.teamId === user.teamId
    && item.result === "recorded"
    && item.agentId === row.agentId
    && item.logId === row.id
    && item.action === parsed.disposition
    && item.note === parsed.note);
  if (same) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        agentId: row.agentId,
        disposition: parsed.disposition,
        note: parsed.note,
        message: "这次处置已经记下"
      }
    };
  }
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: parsed.disposition,
    agentId: row.agentId,
    logId: row.id,
    status: row.status,
    note: parsed.note,
    elapsedSeconds: row.elapsedSeconds,
    thresholdSeconds: row.thresholdSeconds,
    filters: agentWorkStatusTimeoutDispositionRecordFilters(row.status, parsed.disposition),
    rowCount: 0,
    result: "recorded",
    reason: ""
  }, now);
  return {
    status: 200,
    body: {
      result: "recorded" as const,
      agentId: row.agentId,
      disposition: parsed.disposition,
      note: parsed.note,
      status: row.status,
      logId: row.id,
      elapsedSeconds: row.elapsedSeconds,
      thresholdSeconds: row.thresholdSeconds,
      message: "已记下这次处置"
    }
  };
}
