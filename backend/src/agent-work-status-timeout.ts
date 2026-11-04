import { randomUUID } from "node:crypto";
import { AGENT_WORK_STATUS_TIME_ZONE, isAgentWorkStatus } from "./agent-work-status.js";
import { outboundInstant } from "./outbound-call.js";
import type { CrmStore } from "./store.js";
import type { AgentWorkStatusLog, AgentWorkStatusTimeout, AgentWorkStatusTimeoutAudit, AliyunAgentMapping, SessionUser } from "./types.js";

/**
 * 坐席状态单次超时。只读 agent_work_status_logs 里当前还没改走的那一段。
 * 阈值在 agent_work_status_timeouts。查看、设置和清除写入 agent_work_status_timeout_audits。
 * 不另建状态表，不改状态日志的列。
 * 只在接口里返回给工作台。不发信，不发消息，不推送到系统外，不调用云联络中心。
 * 不拨号，不调用 AI，不碰抑制或合规。
 */

export const AGENT_WORK_STATUS_TIMEOUT_MIN_SECONDS = 60;
export const AGENT_WORK_STATUS_TIMEOUT_MAX_SECONDS = 8 * 60 * 60;
export const AGENT_WORK_STATUS_TIMEOUT_STATUSES = ["break", "busy"] as const;
export type AgentWorkStatusTimeoutStatus = (typeof AGENT_WORK_STATUS_TIMEOUT_STATUSES)[number];

export interface AgentWorkStatusTimeoutQuery {
  status: "" | AgentWorkStatusTimeoutStatus;
}

export interface AgentWorkStatusTimeoutRow {
  id: string;
  agentId: string;
  label: string;
  status: AgentWorkStatusTimeoutStatus;
  reason: string;
  since: string;
  sinceText: string;
  elapsedSeconds: number;
  thresholdSeconds: number;
}

export interface AgentWorkStatusTimeoutThresholds {
  break: number | null;
  busy: number | null;
}

interface IndexedLog {
  item: AgentWorkStatusLog;
  index: number;
  ms: number;
}

export function isAgentWorkStatusTimeoutManager(user: { role?: string } | undefined) {
  return user?.role === "manager" || user?.role === "admin" || user?.role === "super_admin";
}

export function isAgentWorkStatusTimeoutStatus(value: unknown): value is AgentWorkStatusTimeoutStatus {
  return value === "break" || value === "busy";
}

function oneQuery(value: unknown) {
  if (Array.isArray(value)) return null;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value.trim() : null;
}

export function parseAgentWorkStatusTimeoutQuery(query: Record<string, unknown>): AgentWorkStatusTimeoutQuery | null {
  const allowed = new Set(["status"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) return null;
  if (Object.values(query).some((value) => Array.isArray(value))) return null;
  const raw = oneQuery(query.status);
  if (raw === null) return null;
  if (!raw) return { status: "" };
  if (!isAgentWorkStatusTimeoutStatus(raw)) return null;
  return { status: raw };
}

export function parseAgentWorkStatusTimeoutBody(body: unknown): { status: AgentWorkStatusTimeoutStatus; thresholdSeconds: number | null } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const allowed = new Set(["status", "thresholdSeconds"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return null;
  if (!isAgentWorkStatusTimeoutStatus(record.status)) return null;
  if (!Object.prototype.hasOwnProperty.call(record, "thresholdSeconds")) return null;
  if (record.thresholdSeconds === null) return { status: record.status, thresholdSeconds: null };
  if (typeof record.thresholdSeconds !== "number" || !Number.isInteger(record.thresholdSeconds)) return null;
  if (record.thresholdSeconds < AGENT_WORK_STATUS_TIMEOUT_MIN_SECONDS || record.thresholdSeconds > AGENT_WORK_STATUS_TIMEOUT_MAX_SECONDS) return null;
  return { status: record.status, thresholdSeconds: record.thresholdSeconds };
}

export function agentWorkStatusTimeoutFiltersText(status: string, thresholdSeconds?: number) {
  const payload: { status: string; thresholdSeconds?: number } = { status };
  if (typeof thresholdSeconds === "number") payload.thresholdSeconds = thresholdSeconds;
  return JSON.stringify(payload);
}

/** 上海墙上时间，YYYY-MM-DD HH:mm。解析不了是空字符串。 */
export function agentWorkStatusTimeoutSinceText(at: string, timeZone = AGENT_WORK_STATUS_TIME_ZONE) {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(ms));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || "";
  let hour = pick("hour");
  if (hour === "24") hour = "00";
  const text = `${pick("year")}-${pick("month")}-${pick("day")} ${hour}:${pick("minute")}`;
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text) ? text : "";
}

function usableThreshold(value: number | undefined) {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= AGENT_WORK_STATUS_TIMEOUT_MIN_SECONDS
    && value <= AGENT_WORK_STATUS_TIMEOUT_MAX_SECONDS;
}

export function agentWorkStatusTimeoutMap(rows: AgentWorkStatusTimeout[] | undefined, teamId: string): AgentWorkStatusTimeoutThresholds {
  const thresholds: AgentWorkStatusTimeoutThresholds = { break: null, busy: null };
  for (const row of rows || []) {
    if (row.teamId !== teamId || !isAgentWorkStatusTimeoutStatus(row.status)) continue;
    if (thresholds[row.status] !== null) continue;
    thresholds[row.status] = usableThreshold(row.thresholdSeconds) ? row.thresholdSeconds : null;
  }
  return thresholds;
}

/**
 * 当前这一段是不晚于本次查看的最后一条有效变更。
 * 同一时刻以后写入的那一行（数组里更靠前）生效。
 * 没有这样的行时是空。
 */
export function currentWorkStatusSegment(logs: AgentWorkStatusLog[], nowMs: number) {
  const current = logs
    .map((item, index) => ({ item, index, ms: Date.parse(item.at) }))
    .filter((row): row is IndexedLog => isAgentWorkStatus(row.item.status) && Number.isFinite(row.ms) && row.ms <= nowMs)
    .sort((left, right) => right.ms - left.ms || left.index - right.index)[0];
  if (!current) return null;
  return {
    log: current.item,
    elapsedSeconds: Math.floor((nowMs - current.ms) / 1000)
  };
}

function agentLabel(mapping: Pick<AliyunAgentMapping, "displayName" | "loginName"> | undefined, id: string) {
  return mapping?.displayName || mapping?.loginName || id;
}

export function buildAgentWorkStatusTimeouts(input: {
  logs: AgentWorkStatusLog[];
  mappings: Array<Pick<AliyunAgentMapping, "teamId" | "cccUserId" | "displayName" | "loginName">>;
  thresholds: AgentWorkStatusTimeout[];
  teamId: string;
  status: "" | AgentWorkStatusTimeoutStatus;
  now: Date;
}): { thresholds: AgentWorkStatusTimeoutThresholds; rows: AgentWorkStatusTimeoutRow[] } {
  const thresholds = agentWorkStatusTimeoutMap(input.thresholds, input.teamId);
  const nowMs = input.now.getTime();
  const logs = (input.logs || []).filter((item) => item.teamId === input.teamId && item.agentId);
  const mappings = (input.mappings || []).filter((item) => item.teamId === input.teamId && item.cccUserId);
  const labels = new Map<string, string>();
  const ids = new Set<string>();
  for (const mapping of mappings) {
    if (ids.has(mapping.cccUserId)) continue;
    ids.add(mapping.cccUserId);
    labels.set(mapping.cccUserId, agentLabel(mapping, mapping.cccUserId));
  }
  for (const log of logs) {
    if (ids.has(log.agentId)) continue;
    ids.add(log.agentId);
    labels.set(log.agentId, log.agentId);
  }
  const rows: AgentWorkStatusTimeoutRow[] = [];
  for (const agentId of ids) {
    const segment = currentWorkStatusSegment(logs.filter((item) => item.agentId === agentId), nowMs);
    if (!segment || !isAgentWorkStatusTimeoutStatus(segment.log.status)) continue;
    if (input.status && segment.log.status !== input.status) continue;
    const thresholdSeconds = thresholds[segment.log.status];
    if (thresholdSeconds === null || segment.elapsedSeconds < thresholdSeconds) continue;
    rows.push({
      id: segment.log.id,
      agentId,
      label: labels.get(agentId) || agentId,
      status: segment.log.status,
      reason: segment.log.reason || "",
      since: segment.log.at,
      sinceText: agentWorkStatusTimeoutSinceText(segment.log.at),
      elapsedSeconds: segment.elapsedSeconds,
      thresholdSeconds
    });
  }
  rows.sort((left, right) => right.elapsedSeconds - left.elapsedSeconds || (left.agentId < right.agentId ? -1 : left.agentId > right.agentId ? 1 : 0));
  return { thresholds, rows };
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function timeoutsOf(store: CrmStore) {
  if (!store.agentWorkStatusTimeouts) store.agentWorkStatusTimeouts = [];
  return store.agentWorkStatusTimeouts;
}

async function writeAudit(store: CrmStore, input: Omit<AgentWorkStatusTimeoutAudit, "id" | "at">, now: Date) {
  const audit: AgentWorkStatusTimeoutAudit = {
    id: `awsta_${randomUUID()}`,
    at: now.toISOString(),
    ...input
  };
  if (!store.agentWorkStatusTimeoutAudits) store.agentWorkStatusTimeoutAudits = [];
  store.agentWorkStatusTimeoutAudits.unshift(audit);
  await store.persist();
  return audit;
}

async function rejectForbidden(
  store: CrmStore,
  user: SessionUser,
  action: AgentWorkStatusTimeoutAudit["action"],
  filters: string,
  message: string,
  now: Date
) {
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action,
    filters,
    rowCount: 0,
    result: "rejected",
    reason: "forbidden"
  }, now);
  return reject("forbidden", message, 403);
}

function listBody(store: CrmStore, teamId: string, status: "" | AgentWorkStatusTimeoutStatus, now: Date) {
  return buildAgentWorkStatusTimeouts({
    logs: store.agentWorkStatusLogs || [],
    mappings: store.aliyunAgentMappings || [],
    thresholds: timeoutsOf(store),
    teamId,
    status,
    now
  });
}

export async function listAgentWorkStatusTimeouts(
  store: CrmStore,
  user: SessionUser | undefined,
  query: Record<string, unknown>,
  now = outboundInstant()
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseAgentWorkStatusTimeoutQuery(query);
  if (!parsed) return reject("invalid_request", "参数格式错误");
  const filters = agentWorkStatusTimeoutFiltersText(parsed.status);
  if (!isAgentWorkStatusTimeoutManager(user)) {
    return rejectForbidden(store, user, "read", filters, "只有主管及以上可以查看坐席状态超时", now);
  }
  const built = listBody(store, user.teamId, parsed.status, now);
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "read",
    filters,
    rowCount: built.rows.length,
    result: "read",
    reason: ""
  }, now);
  return {
    status: 200,
    body: {
      filters: { status: parsed.status },
      timeZone: AGENT_WORK_STATUS_TIME_ZONE,
      viewedAt: now.toISOString(),
      thresholds: built.thresholds,
      rowCount: built.rows.length,
      rows: built.rows
    }
  };
}

export async function saveAgentWorkStatusTimeout(
  store: CrmStore,
  user: SessionUser | undefined,
  body: unknown,
  now = outboundInstant()
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseAgentWorkStatusTimeoutBody(body);
  if (!parsed) return reject("invalid_request", "阈值只接受小休或忙碌，以及 60 到 28800 的整数秒");
  const filters = parsed.thresholdSeconds === null
    ? agentWorkStatusTimeoutFiltersText(parsed.status)
    : agentWorkStatusTimeoutFiltersText(parsed.status, parsed.thresholdSeconds);
  if (!isAgentWorkStatusTimeoutManager(user)) {
    return rejectForbidden(store, user, parsed.thresholdSeconds === null ? "clear" : "set", filters, "只有主管及以上可以设置坐席状态超时", now);
  }
  const rows = timeoutsOf(store);
  const index = rows.findIndex((item) => item.teamId === user.teamId && item.status === parsed.status);
  if (parsed.thresholdSeconds === null) {
    if (index < 0) return reject("not_set", "这一项还没有阈值");
    rows.splice(index, 1);
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "clear",
      filters,
      rowCount: 0,
      result: "cleared",
      reason: ""
    }, now);
    return {
      status: 200,
      body: { result: "cleared" as const, status: parsed.status, thresholdSeconds: null, message: "已清除这个阈值" }
    };
  }
  const current = index >= 0 ? rows[index] : null;
  if (current && current.thresholdSeconds === parsed.thresholdSeconds) {
    return {
      status: 200,
      body: { result: "unchanged" as const, status: parsed.status, thresholdSeconds: parsed.thresholdSeconds, message: "阈值没有变化" }
    };
  }
  const next: AgentWorkStatusTimeout = {
    id: current?.id || `awst_${randomUUID()}`,
    teamId: user.teamId,
    status: parsed.status,
    thresholdSeconds: parsed.thresholdSeconds,
    updatedBy: user.id,
    updatedAt: now.toISOString()
  };
  if (index >= 0) rows[index] = next;
  else rows.unshift(next);
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "set",
    filters,
    rowCount: 0,
    result: "updated",
    reason: ""
  }, now);
  return {
    status: 200,
    body: { result: "updated" as const, status: parsed.status, thresholdSeconds: parsed.thresholdSeconds, message: "已记下这个阈值" }
  };
}
