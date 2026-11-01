import { randomUUID } from "node:crypto";
import { escapeCsvCell } from "./call-export.js";
import { isCallWrapupEditManager, readCallWrapupEditSnapshot } from "./call-wrapup-edit.js";
import { outboundInstant, tenantTimeZoneFor, zonedDateKey } from "./outbound-call.js";
import { recordInDateRange, splitAgentIds } from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type {
  AliyunAgentMapping,
  CallWrapupEditAudit,
  CallWrapupEditReportAudit,
  CallWrapupEditSnapshot,
  OutboundCallRecord,
  SessionUser
} from "./types.js";

/**
 * 通话小结改正报表。只读 §84 已经写下的 call_wrapup_edit_audits。
 * 次数是这些行按坐席归出来的条数，不另造比率。
 * 不拨号，不发信，不调用外部接口，不改改正记录。
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AGENT_PATTERN = /^[A-Za-z0-9_@.:-]{1,128}$/;

export const CALL_WRAPUP_EDIT_REPORT_FIELDS = ["note", "outcome", "outcomeNote", "tagIds", "nextFollowAt"] as const;
export type CallWrapupEditReportField = (typeof CALL_WRAPUP_EDIT_REPORT_FIELDS)[number];

export const CALL_WRAPUP_EDIT_REPORT_FIELD_LABELS: Record<CallWrapupEditReportField, string> = {
  note: "纪要正文",
  outcome: "通话结果",
  outcomeNote: "结果备注",
  tagIds: "通话标签",
  nextFollowAt: "下次跟进"
};

export const CALL_WRAPUP_EDIT_REPORT_HEADERS = [
  "时间",
  "坐席",
  "操作人",
  "通话记录",
  "变更字段",
  "改正前纪要",
  "改正后纪要",
  "改正前通话结果",
  "改正后通话结果",
  "改正前结果备注",
  "改正后结果备注",
  "改正前标签",
  "改正后标签",
  "改正前下次跟进",
  "改正后下次跟进"
] as const;

/** 改正次数能从已记下的行数出来，所以报表展示它。没有比率字段。 */
export const CALL_WRAPUP_EDIT_REPORT_METRICS = {
  correctionCount: true
} as const;

export const UNASSIGNED_AGENT_ID = "none";

export interface CallWrapupEditReportQuery {
  from: string | null;
  to: string | null;
  agentId: string | null;
  field: CallWrapupEditReportField | null;
}

export interface CallWrapupEditReportRow {
  id: string;
  at: string;
  callRecordId: string;
  actorId: string;
  actorLabel: string;
  agentIds: string[];
  agentLabel: string;
  changedFields: CallWrapupEditReportField[];
  before: CallWrapupEditSnapshot;
  after: CallWrapupEditSnapshot;
}

export interface CallWrapupEditReportCount {
  agentId: string;
  label: string;
  correctionCount: number;
}

export interface CallWrapupEditReportAgentOption {
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

function isField(value: string): value is CallWrapupEditReportField {
  return (CALL_WRAPUP_EDIT_REPORT_FIELDS as readonly string[]).includes(value);
}

export function parseCallWrapupEditReportQuery(query: Record<string, unknown>): CallWrapupEditReportQuery | null {
  const allowed = new Set(["from", "to", "agentId", "field"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) return null;
  if (Object.values(query).some((value) => Array.isArray(value))) return null;
  const fromRaw = oneQuery(query.from);
  const toRaw = oneQuery(query.to);
  const agentRaw = oneQuery(query.agentId);
  const fieldRaw = oneQuery(query.field);
  if (fromRaw === null || toRaw === null || agentRaw === null || fieldRaw === null) return null;
  const from = fromRaw || null;
  const to = toRaw || null;
  const agentId = agentRaw || null;
  if (from && !validDate(from)) return null;
  if (to && !validDate(to)) return null;
  if (from && to && from > to) return null;
  if (agentId && agentId !== UNASSIGNED_AGENT_ID && !AGENT_PATTERN.test(agentId)) return null;
  let field: CallWrapupEditReportField | null = null;
  if (fieldRaw) {
    if (!isField(fieldRaw)) return null;
    field = fieldRaw;
  }
  return { from, to, agentId, field };
}

export function callWrapupEditReportFiltersText(query: CallWrapupEditReportQuery) {
  return JSON.stringify({
    agentId: query.agentId || "",
    field: query.field || "",
    from: query.from || "",
    to: query.to || ""
  });
}

/** 改正时间是审计上的 at。解析不了就没有当地日，不用通话开始时间代替。 */
export function callWrapupEditReportLocalDate(at: string, timeZone: string) {
  const text = at.trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  try {
    return zonedDateKey(parsed, timeZone);
  } catch {
    return null;
  }
}

function tagKey(ids: string[]) {
  return [...ids].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)).join("\n");
}

export function callWrapupEditReportFieldChanged(
  before: CallWrapupEditSnapshot,
  after: CallWrapupEditSnapshot,
  field: CallWrapupEditReportField
) {
  if (field === "tagIds") return tagKey(before.tagIds) !== tagKey(after.tagIds);
  return before[field] !== after[field];
}

export function callWrapupEditReportChangedFields(before: CallWrapupEditSnapshot, after: CallWrapupEditSnapshot) {
  return CALL_WRAPUP_EDIT_REPORT_FIELDS.filter((field) => callWrapupEditReportFieldChanged(before, after, field));
}

function agentLabel(mapping: AliyunAgentMapping | undefined, id: string) {
  return mapping?.displayName || mapping?.loginName || id;
}

function mappingLabels(store: Pick<CrmStore, "aliyunAgentMappings">, teamId: string) {
  const mappings = store.aliyunAgentMappings.filter((item) => item.teamId === teamId);
  return new Map(mappings.map((item) => [item.cccUserId, agentLabel(item, item.cccUserId)]));
}

function actorLabel(store: Pick<CrmStore, "users">, teamId: string, actorId: string) {
  const user = (store.users || []).find((item) => item.teamId === teamId && item.id === actorId);
  return user?.name || actorId;
}

function recordForAudit(
  records: OutboundCallRecord[],
  audit: CallWrapupEditAudit
) {
  return records.find((item) => item.teamId === audit.teamId && item.id === audit.callRecordId);
}

export function callWrapupEditReportAgentIds(record: OutboundCallRecord | undefined) {
  if (!record) return [];
  return splitAgentIds(record.agentIds);
}

function labelForAgents(ids: string[], labels: Map<string, string>) {
  if (!ids.length) return "未分配坐席";
  return ids.map((id) => labels.get(id) || id).join("、");
}

function sortByLabel<T extends { id: string; label: string }>(rows: T[]) {
  return rows.sort((left, right) => {
    if (left.id === UNASSIGNED_AGENT_ID) return 1;
    if (right.id === UNASSIGNED_AGENT_ID) return -1;
    return left.label.localeCompare(right.label, "zh") || left.id.localeCompare(right.id);
  });
}

export function callWrapupEditReportAgents(
  store: Pick<CrmStore, "aliyunAgentMappings" | "callWrapupEditAudits" | "outboundCallRecords">,
  teamId: string
): CallWrapupEditReportAgentOption[] {
  const labels = mappingLabels(store, teamId);
  const ids = new Set<string>();
  let unassigned = false;
  for (const audit of store.callWrapupEditAudits || []) {
    if (audit.teamId !== teamId || audit.result !== "updated") continue;
    const agents = callWrapupEditReportAgentIds(recordForAudit(store.outboundCallRecords, audit));
    if (!agents.length) unassigned = true;
    for (const id of agents) ids.add(id);
  }
  const options = [...ids].map((id) => ({ id, label: labels.get(id) || id }));
  if (unassigned) options.push({ id: UNASSIGNED_AGENT_ID, label: "未分配坐席" });
  return sortByLabel(options);
}

function matchesAgent(agentIds: string[], agentId: string | null) {
  if (!agentId) return true;
  if (agentId === UNASSIGNED_AGENT_ID) return agentIds.length === 0;
  return agentIds.includes(agentId);
}

export function buildCallWrapupEditReport(input: {
  store: Pick<CrmStore, "aliyunAgentMappings" | "callWrapupEditAudits" | "outboundCallRecords" | "users">;
  teamId: string;
  query: CallWrapupEditReportQuery;
  timeZone: string;
}): { rows: CallWrapupEditReportRow[]; counts: CallWrapupEditReportCount[] } {
  const labels = mappingLabels(input.store, input.teamId);
  const rows: CallWrapupEditReportRow[] = [];
  for (const audit of input.store.callWrapupEditAudits || []) {
    if (audit.teamId !== input.teamId || audit.result !== "updated") continue;
    if (!recordInDateRange(callWrapupEditReportLocalDate(audit.at, input.timeZone), input.query.from, input.query.to)) continue;
    const before = readCallWrapupEditSnapshot(audit.beforeJson);
    const after = readCallWrapupEditSnapshot(audit.afterJson);
    const changedFields = callWrapupEditReportChangedFields(before, after);
    if (input.query.field && !changedFields.includes(input.query.field)) continue;
    const agentIds = callWrapupEditReportAgentIds(recordForAudit(input.store.outboundCallRecords, audit));
    if (!matchesAgent(agentIds, input.query.agentId)) continue;
    rows.push({
      id: audit.id,
      at: audit.at,
      callRecordId: audit.callRecordId,
      actorId: audit.actorId,
      actorLabel: actorLabel(input.store, input.teamId, audit.actorId),
      agentIds,
      agentLabel: labelForAgents(agentIds, labels),
      changedFields,
      before,
      after
    });
  }
  rows.sort((left, right) => right.at.localeCompare(left.at) || right.id.localeCompare(left.id));
  return { rows, counts: correctionCounts(rows, input.query.agentId, labels) };
}

function correctionCounts(
  rows: CallWrapupEditReportRow[],
  agentId: string | null,
  labels: Map<string, string>
): CallWrapupEditReportCount[] {
  if (!rows.length) return [];
  if (agentId) {
    return [{
      agentId,
      label: agentId === UNASSIGNED_AGENT_ID ? "未分配坐席" : (labels.get(agentId) || agentId),
      correctionCount: rows.length
    }];
  }
  const buckets = new Map<string, number>();
  for (const row of rows) {
    const ids = row.agentIds.length ? row.agentIds : [UNASSIGNED_AGENT_ID];
    for (const id of ids) buckets.set(id, (buckets.get(id) || 0) + 1);
  }
  const counts = [...buckets].map(([id, correctionCount]) => ({
    agentId: id,
    label: id === UNASSIGNED_AGENT_ID ? "未分配坐席" : (labels.get(id) || id),
    correctionCount
  }));
  return sortByLabel(counts.map((item) => ({ ...item, id: item.agentId }))).map((item) => ({
    agentId: item.id,
    label: item.label,
    correctionCount: item.correctionCount
  }));
}

function tagCell(ids: string[]) {
  return ids.join(" | ");
}

export function callWrapupEditReportCsvRow(row: CallWrapupEditReportRow) {
  const changed = row.changedFields.map((field) => CALL_WRAPUP_EDIT_REPORT_FIELD_LABELS[field]).join("、");
  return [
    row.at,
    row.agentLabel,
    row.actorLabel,
    row.callRecordId,
    changed || "无",
    row.before.note,
    row.after.note,
    row.before.outcome,
    row.after.outcome,
    row.before.outcomeNote,
    row.after.outcomeNote,
    tagCell(row.before.tagIds),
    tagCell(row.after.tagIds),
    row.before.nextFollowAt,
    row.after.nextFollowAt
  ];
}

export function buildCallWrapupEditReportCsv(rows: CallWrapupEditReportRow[]) {
  const lines = [CALL_WRAPUP_EDIT_REPORT_HEADERS as unknown as string[], ...rows.map(callWrapupEditReportCsvRow)]
    .map((line) => line.map((cell) => escapeCsvCell(cell)).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

async function writeAudit(store: CrmStore, input: Omit<CallWrapupEditReportAudit, "id" | "at">) {
  const audit: CallWrapupEditReportAudit = {
    id: `cwer_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.callWrapupEditReportAudits.unshift(audit);
  await store.persist();
  return audit;
}

async function rejectForbidden(
  store: CrmStore,
  user: SessionUser,
  action: CallWrapupEditReportAudit["action"],
  filters: string,
  message: string
) {
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

function reportBody(store: CrmStore, teamId: string, query: CallWrapupEditReportQuery, timeZone: string) {
  const built = buildCallWrapupEditReport({ store, teamId, query, timeZone });
  return {
    filters: {
      from: query.from || "",
      to: query.to || "",
      agentId: query.agentId || "",
      field: query.field || ""
    },
    agents: callWrapupEditReportAgents(store, teamId),
    metrics: CALL_WRAPUP_EDIT_REPORT_METRICS,
    rowCount: built.rows.length,
    counts: built.counts,
    rows: built.rows
  };
}

export async function listCallWrapupEditReport(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallWrapupEditReportQuery(query);
  if (!parsed) return reject("invalid_request", "参数格式错误");
  const filters = callWrapupEditReportFiltersText(parsed);
  if (!isCallWrapupEditManager(user)) {
    return rejectForbidden(store, user, "read", filters, "只有主管及以上可以查看通话小结改正");
  }
  const timeZone = await tenantTimeZoneFor(store, user.teamId);
  const body = reportBody(store, user.teamId, parsed, timeZone);
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "read",
    filters,
    rowCount: body.rowCount,
    result: "read",
    reason: ""
  });
  return { status: 200, body };
}

export type CallWrapupEditReportExportResponse =
  | { status: 200; csv: string; filename: string }
  | { status: number; body: Record<string, unknown> };

export async function exportCallWrapupEditReport(
  store: CrmStore,
  user: SessionUser | undefined,
  query: Record<string, unknown>
): Promise<CallWrapupEditReportExportResponse> {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallWrapupEditReportQuery(query);
  if (!parsed) return reject("invalid_request", "参数格式错误");
  const filters = callWrapupEditReportFiltersText(parsed);
  if (!isCallWrapupEditManager(user)) {
    return rejectForbidden(store, user, "export", filters, "只有主管及以上可以导出通话小结改正");
  }
  const timeZone = await tenantTimeZoneFor(store, user.teamId);
  const rows = buildCallWrapupEditReport({ store, teamId: user.teamId, query: parsed, timeZone }).rows;
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "export",
    filters,
    rowCount: rows.length,
    result: "exported",
    reason: ""
  });
  return { status: 200, csv: buildCallWrapupEditReportCsv(rows), filename: "通话小结改正.csv" };
}
