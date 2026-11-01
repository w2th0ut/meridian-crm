import { randomUUID } from "node:crypto";
import { escapeCsvCell } from "./call-export.js";
import { canManageCallTags } from "./call-tag.js";
import { outboundInstant, tenantTimeZoneFor } from "./outbound-call.js";
import { callLocalDate, recordInDateRange, splitAgentIds } from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type { AliyunAgentMapping, CallTagReportAudit, OutboundCallRecord, SessionUser } from "./types.js";

/**
 * 通话标签使用统计。按 §78 的标签和关联，汇总筛完之后的通话。
 * 数字只用来仓库里已经有的字段：关联行、通话记录 id，以及通话上的 targetType / targetId。
 * 客户和线索分开计。搜客不是客户也不是线索，不计入，也不另开一列。
 * 不计算比率。不拨号，不发信，不调用外部接口。
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AGENT_PATTERN = /^[A-Za-z0-9_@.:-]{1,128}$/;

export const CALL_TAG_REPORT_HEADERS = [
  "标签",
  "启用",
  "被打上的次数",
  "关联通话数",
  "涉及客户数",
  "涉及线索数"
] as const;

/**
 * 这四项都能从现有字段算出，所以报表展示它们。
 * 没有单独的接通率字段，这里不另造比率。搜客没有单独的统计列。
 */
export const CALL_TAG_REPORT_METRICS = {
  applyCount: true,
  callCount: true,
  customerCount: true,
  leadCount: true
} as const;

export interface CallTagReportQuery {
  from: string | null;
  to: string | null;
  agentId: string | null;
}

export interface CallTagReportRow {
  tagId: string;
  name: string;
  enabled: boolean;
  applyCount: number;
  callCount: number;
  customerCount: number;
  leadCount: number;
}

export interface CallTagReportAgentOption {
  id: string;
  label: string;
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

export function parseCallTagReportQuery(query: Record<string, unknown>): CallTagReportQuery | null {
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

export function callTagReportFiltersText(query: CallTagReportQuery) {
  return JSON.stringify({
    agentId: query.agentId || "",
    from: query.from || "",
    to: query.to || ""
  });
}

export function selectCallTagReportRecords(input: {
  records: OutboundCallRecord[];
  teamId: string;
  agentId: string | null;
  from: string | null;
  to: string | null;
  timeZone: string;
}) {
  return input.records.filter((record) => {
    if (record.teamId !== input.teamId) return false;
    if (input.agentId && !splitAgentIds(record.agentIds).includes(input.agentId)) return false;
    return recordInDateRange(callLocalDate(record.startTimeRaw, input.timeZone), input.from, input.to);
  });
}

function agentLabel(mapping: AliyunAgentMapping | undefined, id: string) {
  return mapping?.displayName || mapping?.loginName || id;
}

export function callTagReportAgents(store: Pick<CrmStore, "aliyunAgentMappings" | "outboundCallRecords">, teamId: string): CallTagReportAgentOption[] {
  const mappings = store.aliyunAgentMappings.filter((item) => item.teamId === teamId);
  const labels = new Map(mappings.map((item) => [item.cccUserId, agentLabel(item, item.cccUserId)]));
  const ids = new Set(mappings.map((item) => item.cccUserId));
  for (const record of store.outboundCallRecords) {
    if (record.teamId !== teamId) continue;
    for (const id of splitAgentIds(record.agentIds)) ids.add(id);
  }
  return [...ids]
    .map((id) => ({ id, label: labels.get(id) || id }))
    .sort((left, right) => left.label.localeCompare(right.label, "zh") || left.id.localeCompare(right.id));
}

function summarizeLinks(calls: OutboundCallRecord[]) {
  const callIds = new Set<string>();
  const customers = new Set<string>();
  const leads = new Set<string>();
  for (const call of calls) {
    callIds.add(call.id);
    const targetId = (call.targetId || "").trim();
    if (!targetId) continue;
    if (call.targetType === "customer") customers.add(targetId);
    else if (call.targetType === "lead") leads.add(targetId);
  }
  return {
    applyCount: calls.length,
    callCount: callIds.size,
    customerCount: customers.size,
    leadCount: leads.size
  };
}

export function buildCallTagReport(input: {
  store: Pick<CrmStore, "callTags" | "callRecordTags" | "outboundCallRecords">;
  teamId: string;
  query: CallTagReportQuery;
  timeZone: string;
}): CallTagReportRow[] {
  const selected = selectCallTagReportRecords({
    records: input.store.outboundCallRecords,
    teamId: input.teamId,
    agentId: input.query.agentId,
    from: input.query.from,
    to: input.query.to,
    timeZone: input.timeZone
  });
  const callsById = new Map(selected.map((record) => [record.id, record]));
  const tags = input.store.callTags.filter((item) => item.teamId === input.teamId);
  const buckets = new Map<string, OutboundCallRecord[]>(tags.map((item) => [item.id, []]));
  for (const link of input.store.callRecordTags) {
    if (link.teamId !== input.teamId) continue;
    const call = callsById.get(link.callRecordId);
    const bucket = buckets.get(link.tagId);
    if (!call || !bucket) continue;
    bucket.push(call);
  }
  return tags
    .map((tag) => ({
      tagId: tag.id,
      name: tag.name,
      enabled: tag.enabled,
      ...summarizeLinks(buckets.get(tag.id) || [])
    }))
    .sort((left, right) => {
      if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
      return left.name.localeCompare(right.name, "zh") || left.tagId.localeCompare(right.tagId);
    });
}

export function callTagReportCsvRow(row: CallTagReportRow) {
  return [
    row.name,
    row.enabled ? "是" : "否",
    String(row.applyCount),
    String(row.callCount),
    String(row.customerCount),
    String(row.leadCount)
  ];
}

export function buildCallTagReportCsv(rows: CallTagReportRow[]) {
  const lines = [CALL_TAG_REPORT_HEADERS as unknown as string[], ...rows.map(callTagReportCsvRow)]
    .map((line) => line.map((cell) => escapeCsvCell(cell)).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

async function writeAudit(store: CrmStore, input: Omit<CallTagReportAudit, "id" | "at">) {
  const audit: CallTagReportAudit = {
    id: `ctrr_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.callTagReportAudits.unshift(audit);
  await store.persist();
  return audit;
}

async function rejectForbidden(store: CrmStore, user: SessionUser, action: CallTagReportAudit["action"], filters: string, message: string) {
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action,
    filters,
    rowCount: 0,
    result: "rejected",
    reason: "forbidden"
  });
  return reject("forbidden", message, 403);
}

function reportBody(store: CrmStore, teamId: string, query: CallTagReportQuery, timeZone: string) {
  const rows = buildCallTagReport({ store, teamId, query, timeZone });
  return {
    filters: {
      from: query.from || "",
      to: query.to || "",
      agentId: query.agentId || ""
    },
    agents: callTagReportAgents(store, teamId),
    metrics: CALL_TAG_REPORT_METRICS,
    rows
  };
}

export async function listCallTagReport(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallTagReportQuery(query);
  if (!parsed) return reject("invalid_request", "参数格式错误");
  const filters = callTagReportFiltersText(parsed);
  if (!canManageCallTags(user)) {
    return rejectForbidden(store, user, "read", filters, "只有管理员可以查看通话标签使用统计");
  }
  const timeZone = await tenantTimeZoneFor(store, user.teamId);
  const body = reportBody(store, user.teamId, parsed, timeZone);
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "read",
    filters,
    rowCount: body.rows.length,
    result: "read",
    reason: ""
  });
  return { status: 200, body };
}

export type CallTagReportExportResponse =
  | { status: 200; csv: string; filename: string }
  | { status: number; body: Record<string, unknown> };

export async function exportCallTagReport(
  store: CrmStore,
  user: SessionUser | undefined,
  query: Record<string, unknown>
): Promise<CallTagReportExportResponse> {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallTagReportQuery(query);
  if (!parsed) return reject("invalid_request", "参数格式错误");
  const filters = callTagReportFiltersText(parsed);
  if (!canManageCallTags(user)) {
    return rejectForbidden(store, user, "export", filters, "只有管理员可以导出通话标签使用统计");
  }
  const timeZone = await tenantTimeZoneFor(store, user.teamId);
  const rows = buildCallTagReport({ store, teamId: user.teamId, query: parsed, timeZone });
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "export",
    filters,
    rowCount: rows.length,
    result: "exported",
    reason: ""
  });
  return { status: 200, csv: buildCallTagReportCsv(rows), filename: "通话标签使用统计.csv" };
}
