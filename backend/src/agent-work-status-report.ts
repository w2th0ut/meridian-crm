import { randomUUID } from "node:crypto";
import { AGENT_WORK_STATUS_TIME_ZONE, isAgentWorkStatus, zonedDayStartMs } from "./agent-work-status.js";
import { escapeCsvCell } from "./call-export.js";
import { outboundInstant, zonedDateKey } from "./outbound-call.js";
import type { CrmStore } from "./store.js";
import type { AgentWorkStatusAudit, AgentWorkStatusLog, AgentWorkStatusReportAudit, AliyunAgentMapping, SessionUser } from "./types.js";

/**
 * 坐席工作状态时长。只读 agent_work_status_logs。
 * 主管改回的 agent_work_status_audits 只在时间线里作上下文，不计入秒数。
 * 不另建状态表，不调用云联络中心。
 * 查看和导出写入 agent_work_status_report_audits。
 * 不拨号，不发信，不调用 AI，不碰抑制或合规。
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AGENT_PATTERN = /^[A-Za-z0-9_@.:-]{1,128}$/;

export const AGENT_WORK_STATUS_REPORT_HEADERS = [
  "种类",
  "坐席",
  "坐席 ID",
  "可接听秒",
  "忙碌秒",
  "小休秒",
  "时间",
  "状态",
  "来源",
  "原因",
  "操作人",
  "改前状态",
  "计入时长"
] as const;

export const AGENT_WORK_STATUS_REPORT_METRICS = {
  available: true,
  busy: true,
  break: true
} as const;

const STATUS_LABELS = {
  available: "可接听",
  busy: "忙碌",
  break: "小休"
} as const;

const KIND_LABELS = {
  summary: "汇总",
  opening: "延续进入",
  change: "变更",
  rejected: "未生效的改回"
} as const;

export interface AgentWorkStatusReportQuery {
  from: string | null;
  to: string | null;
  agentId: string | null;
}

export interface AgentWorkStatusReportAgent {
  agentId: string;
  label: string;
  availableSeconds: number | null;
  busySeconds: number | null;
  breakSeconds: number | null;
}

export interface AgentWorkStatusReportTimelineRow {
  id: string;
  kind: "opening" | "change" | "rejected";
  at: string;
  agentId: string;
  label: string;
  status: string;
  source: "" | "self" | "manager";
  reason: string;
  actorId: string;
  actorLabel: string;
  previousStatus: string;
  counted: boolean;
}

export interface AgentWorkStatusReportSource {
  logs: AgentWorkStatusLog[];
  audits: AgentWorkStatusAudit[];
  mappings: Array<Pick<AliyunAgentMapping, "teamId" | "cccUserId" | "displayName" | "loginName">>;
  users: Array<{ id: string; teamId: string; name?: string }>;
}

interface OrderedLog {
  item: AgentWorkStatusLog;
  index: number;
  ms: number;
}

export function isAgentWorkStatusReportManager(user: { role?: string } | undefined) {
  return user?.role === "manager" || user?.role === "admin" || user?.role === "super_admin";
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

export function parseAgentWorkStatusReportQuery(query: Record<string, unknown>): AgentWorkStatusReportQuery | null {
  const allowed = new Set(["from", "to", "agentId"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) return null;
  if (Object.values(query).some((value) => Array.isArray(value))) return null;
  const fromRaw = oneQuery(query.from);
  const toRaw = oneQuery(query.to);
  const agentRaw = oneQuery(query.agentId);
  if (fromRaw === null || toRaw === null || agentRaw === null) return null;
  const from = fromRaw || null;
  const to = toRaw || null;
  const agentId = agentRaw || null;
  if (from && !validDate(from)) return null;
  if (to && !validDate(to)) return null;
  if (from && to && from > to) return null;
  if (agentId && !AGENT_PATTERN.test(agentId)) return null;
  return { from, to, agentId };
}

export function agentWorkStatusReportFiltersText(query: AgentWorkStatusReportQuery) {
  return JSON.stringify({
    from: query.from || "",
    to: query.to || "",
    agentId: query.agentId || ""
  });
}

/** 用当地日的中午附近折回零点。上海是 UTC+8，04:00 UTC 仍是同一天。 */
export function agentWorkStatusReportDayStartMs(day: string, timeZone = AGENT_WORK_STATUS_TIME_ZONE) {
  const [year, month, date] = day.split("-").map(Number);
  return zonedDayStartMs(new Date(Date.UTC(year, month - 1, date, 4, 0, 0)), timeZone);
}

function nextDayKey(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date + 1));
  const monthText = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dayText = String(utc.getUTCDate()).padStart(2, "0");
  return `${utc.getUTCFullYear()}-${monthText}-${dayText}`;
}

export function agentWorkStatusReportWindow(query: AgentWorkStatusReportQuery, now: Date, timeZone = AGENT_WORK_STATUS_TIME_ZONE) {
  const nowMs = now.getTime();
  const start = query.from ? agentWorkStatusReportDayStartMs(query.from, timeZone) : Number.NEGATIVE_INFINITY;
  let end = nowMs;
  let inclusiveEnd = true;
  if (query.to) {
    const nextStart = agentWorkStatusReportDayStartMs(nextDayKey(query.to), timeZone);
    if (nextStart <= nowMs) {
      end = nextStart;
      inclusiveEnd = false;
    }
  }
  return { start, end, inclusiveEnd };
}

function logIncluded(ms: number, end: number, inclusiveEnd: boolean) {
  return inclusiveEnd ? ms <= end : ms < end;
}

/**
 * 范围内的三项秒数只来自状态变更行。
 * 每一段从这一行记到下一行；最后一段记到范围结束。
 * 没有任何落在范围内的行时，三项是空，不写成 0。
 * 有段落时，没出现过的状态是 0 秒。
 */
export function summarizeWorkStatusRange(
  logs: AgentWorkStatusLog[],
  startMs: number,
  endMs: number,
  inclusiveEnd: boolean
): Pick<AgentWorkStatusReportAgent, "availableSeconds" | "busySeconds" | "breakSeconds"> {
  const empty = { availableSeconds: null, busySeconds: null, breakSeconds: null };
  if (!(endMs > startMs)) return empty;
  const parsed = logs
    .map((item, index) => ({ item, index, ms: Date.parse(item.at) }))
    .filter((row) => isAgentWorkStatus(row.item.status) && Number.isFinite(row.ms) && logIncluded(row.ms, endMs, inclusiveEnd))
    .sort((left, right) => left.ms - right.ms || right.index - left.index);
  if (!parsed.length) return empty;
  const totals = { available: 0, busy: 0, break: 0 };
  let covered = false;
  for (let index = 0; index < parsed.length; index += 1) {
    const start = parsed[index].ms;
    const next = index + 1 < parsed.length ? parsed[index + 1].ms : endMs;
    const from = Math.max(start, startMs);
    const to = Math.min(next, endMs);
    if (to > from) {
      covered = true;
      totals[parsed[index].item.status] += to - from;
    }
    if (start >= startMs && logIncluded(start, endMs, inclusiveEnd)) covered = true;
  }
  if (!covered) return empty;
  return {
    availableSeconds: Math.floor(totals.available / 1000),
    busySeconds: Math.floor(totals.busy / 1000),
    breakSeconds: Math.floor(totals.break / 1000)
  };
}

function agentLabel(mapping: Pick<AliyunAgentMapping, "displayName" | "loginName"> | undefined, id: string) {
  return mapping?.displayName || mapping?.loginName || id;
}

function actorLabel(source: AgentWorkStatusReportSource, teamId: string, actorId: string) {
  const id = actorId.trim();
  if (!id) return "";
  const user = source.users.find((item) => item.teamId === teamId && item.id === id);
  return user?.name || id;
}

function statusLabel(status: string) {
  if (status === "available" || status === "busy" || status === "break") return STATUS_LABELS[status];
  return "";
}

function orderedLogs(logs: AgentWorkStatusLog[], end: number, inclusiveEnd: boolean): OrderedLog[] {
  return logs
    .map((item, index) => ({ item, index, ms: Date.parse(item.at) }))
    .filter((row) => isAgentWorkStatus(row.item.status) && Number.isFinite(row.ms) && logIncluded(row.ms, end, inclusiveEnd))
    .sort((left, right) => left.ms - right.ms || right.index - left.index);
}

function matchingOverride(log: AgentWorkStatusLog, audits: AgentWorkStatusAudit[]) {
  const ms = Date.parse(log.at);
  if (!Number.isFinite(ms)) return undefined;
  return audits.find((audit) => audit.teamId === log.teamId
    && audit.agentId === log.agentId
    && audit.result === "updated"
    && audit.action === "reset"
    && audit.nextStatus === log.status
    && audit.actorId === log.actorId
    && Date.parse(audit.at) === ms);
}

function timelineFromLog(
  source: AgentWorkStatusReportSource,
  teamId: string,
  row: OrderedLog,
  kind: "opening" | "change",
  label: string
): AgentWorkStatusReportTimelineRow {
  const override = matchingOverride(row.item, source.audits);
  return {
    id: row.item.id,
    kind,
    at: row.item.at,
    agentId: row.item.agentId,
    label,
    status: row.item.status,
    source: row.item.source === "manager" ? "manager" : "self",
    reason: row.item.reason || "",
    actorId: row.item.actorId,
    actorLabel: actorLabel(source, teamId, row.item.actorId),
    previousStatus: override?.previousStatus || "",
    counted: true
  };
}

function sortTimeline(rows: AgentWorkStatusReportTimelineRow[]) {
  return rows.sort((left, right) => {
    if (left.at !== right.at) {
      if (!left.at) return 1;
      if (!right.at) return -1;
      return right.at < left.at ? -1 : 1;
    }
    return right.id < left.id ? -1 : right.id > left.id ? 1 : 0;
  });
}

export function buildAgentWorkStatusReport(input: {
  source: AgentWorkStatusReportSource;
  teamId: string;
  query: AgentWorkStatusReportQuery;
  now: Date;
}): { agents: AgentWorkStatusReportAgent[]; timeline: AgentWorkStatusReportTimelineRow[] | null; denied: boolean } {
  const range = agentWorkStatusReportWindow(input.query, input.now);
  const logs = (input.source.logs || []).filter((item) => item.teamId === input.teamId && item.agentId);
  const audits = (input.source.audits || []).filter((item) => item.teamId === input.teamId && item.agentId);
  const mappings = (input.source.mappings || []).filter((item) => item.teamId === input.teamId && item.cccUserId);
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
  if (input.query.agentId && !ids.has(input.query.agentId)) {
    return { agents: [], timeline: null, denied: true };
  }
  const agents = [...ids].map((agentId) => {
    const own = logs.filter((item) => item.agentId === agentId);
    return {
      agentId,
      label: labels.get(agentId) || agentId,
      ...summarizeWorkStatusRange(own, range.start, range.end, range.inclusiveEnd)
    };
  }).sort((left, right) => left.label.localeCompare(right.label, "zh") || left.agentId.localeCompare(right.agentId));
  if (!input.query.agentId) return { agents, timeline: null, denied: false };
  if (!(range.end > range.start)) return { agents, timeline: [], denied: false };
  const agentId = input.query.agentId;
  const label = labels.get(agentId) || agentId;
  const ordered = orderedLogs(logs.filter((item) => item.agentId === agentId), range.end, range.inclusiveEnd);
  const prior = [...ordered].reverse().find((row) => row.ms < range.start);
  const changes = ordered.filter((row) => row.ms >= range.start);
  const timeline: AgentWorkStatusReportTimelineRow[] = [];
  if (prior) timeline.push(timelineFromLog(input.source, input.teamId, prior, "opening", label));
  for (const row of changes) timeline.push(timelineFromLog(input.source, input.teamId, row, "change", label));
  for (const audit of audits) {
    if (audit.agentId !== agentId || audit.result !== "rejected") continue;
    const ms = Date.parse(audit.at);
    if (!Number.isFinite(ms) || !logIncluded(ms, range.end, range.inclusiveEnd) || ms < range.start) continue;
    timeline.push({
      id: audit.id,
      kind: "rejected",
      at: audit.at,
      agentId,
      label,
      status: audit.nextStatus || "",
      source: "manager",
      reason: audit.reason || "",
      actorId: audit.actorId,
      actorLabel: actorLabel(input.source, input.teamId, audit.actorId),
      previousStatus: audit.previousStatus || "",
      counted: false
    });
  }
  return { agents, timeline: sortTimeline(timeline), denied: false };
}

function display(value: string) {
  const text = value.trim();
  return text ? text : "—";
}

function secondsCell(value: number | null) {
  return value === null || !Number.isFinite(value) ? "—" : String(value);
}

function summaryCsv(agent: AgentWorkStatusReportAgent) {
  return [
    KIND_LABELS.summary,
    display(agent.label),
    display(agent.agentId),
    secondsCell(agent.availableSeconds),
    secondsCell(agent.busySeconds),
    secondsCell(agent.breakSeconds),
    "—",
    "—",
    "—",
    "—",
    "—",
    "—",
    "—"
  ];
}

function timelineCsv(row: AgentWorkStatusReportTimelineRow) {
  const source = row.source === "self" ? "自己" : row.source === "manager" ? "主管" : "";
  return [
    KIND_LABELS[row.kind] || row.kind,
    display(row.label),
    display(row.agentId),
    "—",
    "—",
    "—",
    display(row.at),
    display(statusLabel(row.status)),
    display(source),
    display(row.reason),
    display(row.actorLabel),
    display(statusLabel(row.previousStatus)),
    row.counted ? "是" : "否"
  ];
}

export function buildAgentWorkStatusReportCsv(
  agents: AgentWorkStatusReportAgent[],
  timeline: AgentWorkStatusReportTimelineRow[] | null
) {
  const lines = [
    AGENT_WORK_STATUS_REPORT_HEADERS as unknown as string[],
    ...agents.map(summaryCsv),
    ...(timeline || []).map(timelineCsv)
  ].map((line) => line.map((cell) => escapeCsvCell(cell)).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function sourceOf(store: CrmStore): AgentWorkStatusReportSource {
  return {
    logs: store.agentWorkStatusLogs || [],
    audits: store.agentWorkStatusAudits || [],
    mappings: store.aliyunAgentMappings || [],
    users: store.users || []
  };
}

async function writeAudit(store: CrmStore, input: Omit<AgentWorkStatusReportAudit, "id" | "at">, now: Date) {
  const audit: AgentWorkStatusReportAudit = {
    id: `awsra_${randomUUID()}`,
    at: now.toISOString(),
    ...input
  };
  if (!store.agentWorkStatusReportAudits) store.agentWorkStatusReportAudits = [];
  store.agentWorkStatusReportAudits.unshift(audit);
  await store.persist();
  return audit;
}

async function rejectForbidden(
  store: CrmStore,
  user: SessionUser,
  action: AgentWorkStatusReportAudit["action"],
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

function reportBody(store: CrmStore, teamId: string, query: AgentWorkStatusReportQuery, now: Date) {
  const built = buildAgentWorkStatusReport({ source: sourceOf(store), teamId, query, now });
  return built;
}

export async function listAgentWorkStatusReport(
  store: CrmStore,
  user: SessionUser | undefined,
  query: Record<string, unknown>,
  now = outboundInstant()
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseAgentWorkStatusReportQuery(query);
  if (!parsed) return reject("invalid_request", "参数格式错误");
  const filters = agentWorkStatusReportFiltersText(parsed);
  if (!isAgentWorkStatusReportManager(user)) {
    return rejectForbidden(store, user, "read", filters, "只有主管及以上可以查看坐席工作状态时长", now);
  }
  const built = reportBody(store, user.teamId, parsed, now);
  if (built.denied) {
    return rejectForbidden(store, user, "read", filters, "没有查看这位坐席工作状态时长的权限", now);
  }
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "read",
    filters,
    rowCount: built.agents.length,
    result: "read",
    reason: ""
  }, now);
  return {
    status: 200,
    body: {
      filters: { from: parsed.from || "", to: parsed.to || "", agentId: parsed.agentId || "" },
      timeZone: AGENT_WORK_STATUS_TIME_ZONE,
      today: zonedDateKey(now, AGENT_WORK_STATUS_TIME_ZONE),
      metrics: AGENT_WORK_STATUS_REPORT_METRICS,
      rowCount: built.agents.length,
      agents: built.agents,
      timeline: built.timeline
    }
  };
}

export type AgentWorkStatusReportExportResponse =
  | { status: 200; csv: string; filename: string }
  | { status: number; body: Record<string, unknown> };

export async function exportAgentWorkStatusReport(
  store: CrmStore,
  user: SessionUser | undefined,
  query: Record<string, unknown>,
  now = outboundInstant()
): Promise<AgentWorkStatusReportExportResponse> {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseAgentWorkStatusReportQuery(query);
  if (!parsed) return reject("invalid_request", "参数格式错误");
  const filters = agentWorkStatusReportFiltersText(parsed);
  if (!isAgentWorkStatusReportManager(user)) {
    return rejectForbidden(store, user, "export", filters, "只有主管及以上可以导出坐席工作状态时长", now);
  }
  const built = reportBody(store, user.teamId, parsed, now);
  if (built.denied) {
    return rejectForbidden(store, user, "export", filters, "没有导出这位坐席工作状态时长的权限", now);
  }
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "export",
    filters,
    rowCount: built.agents.length,
    result: "exported",
    reason: ""
  }, now);
  return {
    status: 200,
    csv: buildAgentWorkStatusReportCsv(built.agents, built.timeline),
    filename: "坐席工作状态时长.csv"
  };
}
