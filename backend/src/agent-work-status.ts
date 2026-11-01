import { randomUUID } from "node:crypto";
import { hasIamPermission, type IamActor } from "./auth.js";
import { outboundInstant, zonedDateKey } from "./outbound-call.js";
import { resolveOutboundCallRecordAccess } from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type { AgentWorkStatusAudit, AgentWorkStatusLog, AliyunAgentMapping, SessionUser } from "./types.js";

/**
 * 坐席手工工作状态。只写 agent_work_status_logs。
 * 主管改别人的状态另写 agent_work_status_audits。
 * 不改坐席映射上从目录抄来的工作模式，也不转发软电话的状态查询。
 * 今日时长只从已经记下的状态变更行计算。不读通话记录。
 * 不拨号，不改路由，不发信，不调用外部接口。
 */

export const AGENT_WORK_STATUS_TIME_ZONE = "Asia/Shanghai";
export const AGENT_WORK_STATUS_PERMISSION = "communication.read";
export const AGENT_WORK_STATUS_REASON_MAX = 200;

export const AGENT_WORK_STATUSES = ["available", "busy", "break"] as const;
export type AgentWorkStatus = (typeof AGENT_WORK_STATUSES)[number];

const AGENT_PATTERN = /^[A-Za-z0-9_@.:-]{1,128}$/;
const BATCH_KEYS = ["records", "ids", "agents", "agentIds", "statuses", "items"] as const;

export interface AgentWorkStatusSummary {
  status: AgentWorkStatus | null;
  reason: string;
  changedAt: string | null;
  availableSeconds: number | null;
  busySeconds: number | null;
  breakSeconds: number | null;
}

export interface AgentWorkStatusRow extends AgentWorkStatusSummary {
  agentId: string;
  label: string;
}

const EMPTY_SUMMARY: AgentWorkStatusSummary = {
  status: null,
  reason: "",
  changedAt: null,
  availableSeconds: null,
  busySeconds: null,
  breakSeconds: null
};

export function canResetAgentWorkStatus(user: { role?: string; teamId?: string } | undefined) {
  if (!user?.teamId || user.teamId === "all") return false;
  return user.role === "manager" || user.role === "admin" || user.role === "super_admin";
}

export function isAgentWorkStatus(value: unknown): value is AgentWorkStatus {
  return value === "available" || value === "busy" || value === "break";
}

/** 当地日的零点，用这一刻的时区偏移折回 UTC。上海没有夏令时。 */
export function zonedDayStartMs(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(at);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || "0";
  let hour = Number(pick("hour"));
  if (hour === 24) hour = 0;
  const year = Number(pick("year"));
  const month = Number(pick("month"));
  const day = Number(pick("day"));
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, Number(pick("minute")), Number(pick("second")));
  const offset = wallAsUtc - at.getTime();
  return Date.UTC(year, month - 1, day, 0, 0, 0) - offset;
}

function agentLabel(mapping: AliyunAgentMapping | undefined, id: string) {
  return mapping?.displayName || mapping?.loginName || id;
}

function reject(status: number, reason: string, message: string) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function parseReason(value: unknown): string | "bad" | "missing" {
  if (value === undefined || value === null) return "missing";
  if (typeof value !== "string") return "bad";
  const text = value.trim();
  if (text.length > AGENT_WORK_STATUS_REASON_MAX) return "bad";
  return text;
}

export function parseOwnWorkStatusBody(body: unknown):
  | { ok: true; status: AgentWorkStatus; reason: string }
  | { ok: false; reason: "invalid_request" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return { ok: false, reason: "invalid_request" };
  const allowed = new Set(["status", "reason"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return { ok: false, reason: "invalid_request" };
  const status = typeof record.status === "string" ? record.status.trim() : "";
  if (!isAgentWorkStatus(status)) return { ok: false, reason: "invalid_request" };
  const reason = parseReason(record.reason);
  if (reason === "bad") return { ok: false, reason: "invalid_request" };
  return { ok: true, status, reason: reason === "missing" ? "" : reason };
}

export function parseResetWorkStatusBody(body: unknown):
  | { ok: true; agentId: string; status: AgentWorkStatus; reason: string }
  | { ok: false; reason: "invalid_request" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return { ok: false, reason: "invalid_request" };
  const allowed = new Set(["agentId", "status", "reason"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return { ok: false, reason: "invalid_request" };
  if (typeof record.agentId !== "string" || !AGENT_PATTERN.test(record.agentId)) return { ok: false, reason: "invalid_request" };
  const status = typeof record.status === "string" ? record.status.trim() : "";
  if (!isAgentWorkStatus(status)) return { ok: false, reason: "invalid_request" };
  const reason = parseReason(record.reason);
  if (reason === "bad") return { ok: false, reason: "invalid_request" };
  return { ok: true, agentId: record.agentId, status, reason: reason === "missing" ? "" : reason };
}

export function parseAgentWorkStatusQuery(query: Record<string, unknown>):
  | { ok: true; scope: "self" | "team"; agentId: string | null }
  | { ok: false; reason: "invalid_request" } {
  const allowed = new Set(["scope", "agentId"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) return { ok: false, reason: "invalid_request" };
  if (Object.values(query).some((value) => Array.isArray(value))) return { ok: false, reason: "invalid_request" };
  const scope = query.scope;
  const agentRaw = query.agentId;
  if (scope !== "self" && scope !== "team") return { ok: false, reason: "invalid_request" };
  if (agentRaw !== undefined && agentRaw !== null && typeof agentRaw !== "string") return { ok: false, reason: "invalid_request" };
  const agentId = typeof agentRaw === "string" && agentRaw.trim() ? agentRaw.trim() : null;
  if (scope === "self" && agentId) return { ok: false, reason: "invalid_request" };
  if (agentId && !AGENT_PATTERN.test(agentId)) return { ok: false, reason: "invalid_request" };
  return { ok: true, scope, agentId };
}

function logsFor(logs: AgentWorkStatusLog[], teamId: string, agentId: string) {
  return logs.filter((item) => item.teamId === teamId && item.agentId === agentId);
}

/**
 * 今日三项时长只来自状态变更行。
 * 每一段从这一行记到下一行；最后一段记到本次查看的时刻。
 * 只累加落在今日的毫秒，再按状态取整秒。没有落在今日的段落时，三项是空，不写成 0。
 * 晚于本次查看的行不参加。解析不出时间的行不参加。
 */
export function summarizeAgentWorkStatus(
  logs: AgentWorkStatusLog[],
  now: Date,
  timeZone = AGENT_WORK_STATUS_TIME_ZONE
): AgentWorkStatusSummary {
  const end = now.getTime();
  const parsed = logs
    .map((item, index) => ({ item, index, ms: Date.parse(item.at) }))
    .filter((item) => isAgentWorkStatus(item.item.status) && Number.isFinite(item.ms) && item.ms <= end)
    .sort((left, right) => left.ms - right.ms || right.index - left.index);
  if (!parsed.length) return { ...EMPTY_SUMMARY };
  const dayStart = zonedDayStartMs(now, timeZone);
  const totals = { available: 0, busy: 0, break: 0 };
  let covered = false;
  for (let index = 0; index < parsed.length; index += 1) {
    const start = parsed[index].ms;
    const next = index + 1 < parsed.length ? parsed[index + 1].ms : end;
    const from = Math.max(start, dayStart);
    const to = Math.min(next, end);
    if (to > from) {
      covered = true;
      totals[parsed[index].item.status] += to - from;
    }
    if (parsed[index].ms >= dayStart && parsed[index].ms <= end) covered = true;
  }
  const current = parsed[parsed.length - 1].item;
  return {
    status: current.status,
    reason: current.reason || "",
    changedAt: current.at,
    availableSeconds: covered ? Math.floor(totals.available / 1000) : null,
    busySeconds: covered ? Math.floor(totals.busy / 1000) : null,
    breakSeconds: covered ? Math.floor(totals.break / 1000) : null
  };
}

export function attachAgentWorkStatus<T extends { agentId: string }>(
  rows: T[],
  logs: AgentWorkStatusLog[],
  teamId: string,
  now: Date
): Array<T & AgentWorkStatusSummary> {
  return rows.map((row) => {
    if (!row.agentId || row.agentId === "none") return { ...row, ...EMPTY_SUMMARY };
    return { ...row, ...summarizeAgentWorkStatus(logsFor(logs, teamId, row.agentId), now) };
  });
}

function ownMapping(store: CrmStore, user: SessionUser) {
  return store.aliyunAgentMappings.find((item) => item.teamId === user.teamId && item.crmUserId === user.id && item.cccUserId) || null;
}

function presentRow(mapping: AliyunAgentMapping, summary: AgentWorkStatusSummary): AgentWorkStatusRow {
  return {
    agentId: mapping.cccUserId,
    label: agentLabel(mapping, mapping.cccUserId),
    ...summary
  };
}

function responseToday(now: Date) {
  return zonedDateKey(now, AGENT_WORK_STATUS_TIME_ZONE);
}

async function writeAudit(store: CrmStore, input: Omit<AgentWorkStatusAudit, "id" | "at">, now: Date) {
  const audit: AgentWorkStatusAudit = {
    id: `awsa_${randomUUID()}`,
    at: now.toISOString(),
    ...input
  };
  store.agentWorkStatusAudits.unshift(audit);
  await store.persist();
  return audit;
}

function sameStatus(summary: AgentWorkStatusSummary, status: AgentWorkStatus, reason: string) {
  return summary.status === status && summary.reason === reason;
}

export async function listAgentWorkStatus(
  store: CrmStore,
  user: SessionUser | undefined,
  query: Record<string, unknown>,
  now = outboundInstant()
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseAgentWorkStatusQuery(query);
  if (!parsed.ok) return reject(400, "invalid_request", "工作状态的范围不正确");
  if (parsed.scope === "team" && !canResetAgentWorkStatus(user)) {
    return reject(403, "forbidden", "只有主管和管理员可以查看团队工作状态");
  }
  if (!hasIamPermission(user as IamActor, AGENT_WORK_STATUS_PERMISSION)) {
    return reject(403, "forbidden", "当前账号没有查看工作状态的权限");
  }
  const today = responseToday(now);
  if (parsed.scope === "self") {
    const mapping = ownMapping(store, user);
    if (!mapping) {
      return {
        status: 200,
        body: {
          scope: "self",
          timeZone: AGENT_WORK_STATUS_TIME_ZONE,
          today,
          unmapped: true,
          canReset: false,
          rows: []
        }
      };
    }
    const summary = summarizeAgentWorkStatus(logsFor(store.agentWorkStatusLogs, user.teamId, mapping.cccUserId), now);
    return {
      status: 200,
      body: {
        scope: "self",
        timeZone: AGENT_WORK_STATUS_TIME_ZONE,
        today,
        unmapped: false,
        canReset: false,
        rows: [presentRow(mapping, summary)]
      }
    };
  }
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const rows = store.aliyunAgentMappings
    .filter((item) => item.teamId === user.teamId && item.cccUserId)
    .filter((item) => resolved.access.tenantWide || resolved.access.allowed.has(item.cccUserId))
    .filter((item, index, list) => list.findIndex((other) => other.cccUserId === item.cccUserId) === index)
    .map((item) => presentRow(item, summarizeAgentWorkStatus(logsFor(store.agentWorkStatusLogs, user.teamId, item.cccUserId), now)))
    .sort((left, right) => left.label.localeCompare(right.label, "zh"));
  if (parsed.agentId) {
    const match = rows.find((item) => item.agentId === parsed.agentId);
    if (!match) return reject(403, "forbidden", "没有查看这位坐席工作状态的权限");
    return {
      status: 200,
      body: {
        scope: "team",
        timeZone: AGENT_WORK_STATUS_TIME_ZONE,
        today,
        unmapped: false,
        canReset: true,
        rows: [match]
      }
    };
  }
  return {
    status: 200,
    body: {
      scope: "team",
      timeZone: AGENT_WORK_STATUS_TIME_ZONE,
      today,
      unmapped: false,
      canReset: true,
      rows
    }
  };
}

export async function setOwnAgentWorkStatus(
  store: CrmStore,
  user: SessionUser | undefined,
  body: unknown,
  now = outboundInstant()
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseOwnWorkStatusBody(body);
  if (!parsed.ok) return reject(400, "invalid_request", "工作状态不正确");
  if (!hasIamPermission(user as IamActor, AGENT_WORK_STATUS_PERMISSION)) {
    return reject(403, "forbidden", "当前账号没有设置工作状态的权限");
  }
  const mapping = ownMapping(store, user);
  if (!mapping) return reject(404, "unmapped", "还没有坐席映射，不能设置工作状态");
  const current = summarizeAgentWorkStatus(logsFor(store.agentWorkStatusLogs, user.teamId, mapping.cccUserId), now);
  if (sameStatus(current, parsed.status, parsed.reason)) {
    return {
      status: 200,
      body: {
        result: "unchanged",
        scope: "self",
        timeZone: AGENT_WORK_STATUS_TIME_ZONE,
        today: responseToday(now),
        row: presentRow(mapping, current)
      }
    };
  }
  const log: AgentWorkStatusLog = {
    id: `awsl_${randomUUID()}`,
    teamId: user.teamId,
    agentId: mapping.cccUserId,
    crmUserId: user.id,
    actorId: user.id,
    at: now.toISOString(),
    status: parsed.status,
    reason: parsed.reason,
    source: "self"
  };
  store.agentWorkStatusLogs.unshift(log);
  await store.persist();
  const summary = summarizeAgentWorkStatus(logsFor(store.agentWorkStatusLogs, user.teamId, mapping.cccUserId), now);
  return {
    status: 200,
    body: {
      result: "updated",
      scope: "self",
      timeZone: AGENT_WORK_STATUS_TIME_ZONE,
      today: responseToday(now),
      row: presentRow(mapping, summary)
    }
  };
}

export async function resetAgentWorkStatus(
  store: CrmStore,
  user: SessionUser | undefined,
  body: unknown,
  now = outboundInstant()
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseResetWorkStatusBody(body);
  if (!parsed.ok) return reject(400, "invalid_request", "工作状态不正确");
  if (!canResetAgentWorkStatus(user) || !hasIamPermission(user as IamActor, AGENT_WORK_STATUS_PERMISSION)) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      agentId: parsed.agentId,
      action: "reset",
      previousStatus: "",
      nextStatus: parsed.status,
      reason: parsed.reason,
      result: "rejected",
      reasonCode: "forbidden"
    }, now);
    return reject(403, "forbidden", "只有主管和管理员可以改回坐席的工作状态");
  }
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      agentId: parsed.agentId,
      action: "reset",
      previousStatus: "",
      nextStatus: parsed.status,
      reason: parsed.reason,
      result: "rejected",
      reasonCode: "forbidden"
    }, now);
    return { status: resolved.status, body: resolved.body };
  }
  const mapping = store.aliyunAgentMappings.find((item) => item.teamId === user.teamId && item.cccUserId === parsed.agentId);
  if (!mapping) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      agentId: parsed.agentId,
      action: "reset",
      previousStatus: "",
      nextStatus: parsed.status,
      reason: parsed.reason,
      result: "rejected",
      reasonCode: "not_found"
    }, now);
    return reject(404, "not_found", "没有这个坐席映射");
  }
  if (!resolved.access.tenantWide && !resolved.access.allowed.has(mapping.cccUserId)) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      agentId: parsed.agentId,
      action: "reset",
      previousStatus: "",
      nextStatus: parsed.status,
      reason: parsed.reason,
      result: "rejected",
      reasonCode: "forbidden"
    }, now);
    return reject(403, "forbidden", "没有改回这位坐席工作状态的权限");
  }
  const current = summarizeAgentWorkStatus(logsFor(store.agentWorkStatusLogs, user.teamId, mapping.cccUserId), now);
  if (sameStatus(current, parsed.status, parsed.reason)) {
    return {
      status: 200,
      body: {
        result: "unchanged",
        scope: "team",
        timeZone: AGENT_WORK_STATUS_TIME_ZONE,
        today: responseToday(now),
        row: presentRow(mapping, current)
      }
    };
  }
  const log: AgentWorkStatusLog = {
    id: `awsl_${randomUUID()}`,
    teamId: user.teamId,
    agentId: mapping.cccUserId,
    crmUserId: mapping.crmUserId,
    actorId: user.id,
    at: now.toISOString(),
    status: parsed.status,
    reason: parsed.reason,
    source: "manager"
  };
  store.agentWorkStatusLogs.unshift(log);
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    agentId: mapping.cccUserId,
    action: "reset",
    previousStatus: current.status || "",
    nextStatus: parsed.status,
    reason: parsed.reason,
    result: "updated",
    reasonCode: ""
  }, now);
  const summary = summarizeAgentWorkStatus(logsFor(store.agentWorkStatusLogs, user.teamId, mapping.cccUserId), now);
  return {
    status: 200,
    body: {
      result: "updated",
      scope: "team",
      timeZone: AGENT_WORK_STATUS_TIME_ZONE,
      today: responseToday(now),
      row: presentRow(mapping, summary)
    }
  };
}
