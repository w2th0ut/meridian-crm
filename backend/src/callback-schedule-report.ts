import { randomUUID } from "node:crypto";
import { escapeCsvCell } from "./call-export.js";
import { CALLBACK_DUE_COMPLETE_REASON_LABELS, type CallbackDueCompleteReason } from "./callback-due-queue.js";
import { callbackScheduleDue, callbackTargetLabel } from "./callback-schedule-state.js";
import { outboundInstant, tenantTimeZoneFor, zonedDateKey } from "./outbound-call.js";
import { recordInDateRange } from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type {
  CallbackDueQueueAudit,
  CallbackSchedule,
  CallbackScheduleAudit,
  CallbackScheduleReportAudit,
  SessionUser
} from "./types.js";

/**
 * 回拨预约报表。只读已经写下的 callback_schedules、callback_schedule_audits
 * 和 callback_due_queue_audits。不另建预约表，不另造比率。
 * 查看和导出写入 callback_schedule_report_audits。
 * 不拨号，不发信，不调用 AI，不碰抑制或合规。
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const CALLBACK_SCHEDULE_REPORT_KINDS = [
  "due",
  "overdue",
  "completed",
  "rescheduled",
  "queue_read",
  "queue_export"
] as const;
export type CallbackScheduleReportKind = (typeof CALLBACK_SCHEDULE_REPORT_KINDS)[number];

export const CALLBACK_SCHEDULE_REPORT_KIND_LABELS: Record<CallbackScheduleReportKind, string> = {
  due: "今日到期",
  overdue: "已逾期",
  completed: "已完成",
  rescheduled: "已改期",
  queue_read: "队列查看",
  queue_export: "队列导出"
};

export const CALLBACK_SCHEDULE_REPORT_HEADERS = [
  "种类",
  "时间",
  "对象类型",
  "对象",
  "对象 ID",
  "操作人",
  "改前时间",
  "改前备注",
  "改后时间",
  "改后备注",
  "原因",
  "队列范围",
  "只看已逾期",
  "队列行数"
] as const;

/** 这四项能从已经记下的行数出来。没有比率，也没有队列查看次数这一项。 */
export const CALLBACK_SCHEDULE_REPORT_METRICS = {
  due: true,
  overdue: true,
  completed: true,
  rescheduled: true
} as const;

export interface CallbackScheduleReportQuery {
  from: string | null;
  to: string | null;
}

export interface CallbackScheduleReportRow {
  id: string;
  kind: CallbackScheduleReportKind;
  at: string;
  targetType: string;
  targetLabel: string;
  targetId: string;
  name: string;
  actorId: string;
  actorLabel: string;
  previousScheduledAt: string;
  previousNote: string;
  nextScheduledAt: string;
  nextNote: string;
  reason: string;
  reasonLabel: string;
  queueScope: string;
  queueScopeLabel: string;
  overdueOnly: boolean | null;
  queueRowCount: number | null;
}

export interface CallbackScheduleReportCounts {
  dueCount: number | null;
  overdueCount: number | null;
  completedCount: number;
  rescheduledCount: number;
}

export interface CallbackScheduleReportSource {
  callbackSchedules: CallbackSchedule[];
  callbackScheduleAudits: CallbackScheduleAudit[];
  callbackDueQueueAudits: CallbackDueQueueAudit[];
  customers: Array<{ id: string; teamId: string; company?: string }>;
  leads: Array<{ id: string; teamId: string; company?: string; deletedAt?: string }>;
  websiteOpportunities: Array<{ id: string; teamId: string; company?: string }>;
  users: Array<{ id: string; teamId: string; name?: string }>;
}

export function isCallbackScheduleReportManager(user: { role?: string } | undefined) {
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

export function parseCallbackScheduleReportQuery(query: Record<string, unknown>): CallbackScheduleReportQuery | null {
  const allowed = new Set(["from", "to"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) return null;
  if (Object.values(query).some((value) => Array.isArray(value))) return null;
  const fromRaw = oneQuery(query.from);
  const toRaw = oneQuery(query.to);
  if (fromRaw === null || toRaw === null) return null;
  const from = fromRaw || null;
  const to = toRaw || null;
  if (from && !validDate(from)) return null;
  if (to && !validDate(to)) return null;
  if (from && to && from > to) return null;
  return { from, to };
}

export function callbackScheduleReportFiltersText(query: CallbackScheduleReportQuery) {
  return JSON.stringify({
    from: query.from || "",
    to: query.to || ""
  });
}

/** 审计时间是这一行的 at。解析不了就没有当地日，不用预约时间或入库时间代替。 */
export function callbackScheduleReportLocalDate(at: string, timeZone: string) {
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

function appointmentDate(scheduledAt: string) {
  const date = scheduledAt.slice(0, 10);
  return DATE_PATTERN.test(date) ? date : "";
}

function actorLabel(source: CallbackScheduleReportSource, teamId: string, actorId: string) {
  const id = actorId.trim();
  if (!id) return "";
  const user = source.users.find((item) => item.teamId === teamId && item.id === id);
  return user?.name || id;
}

function targetName(source: CallbackScheduleReportSource, teamId: string, targetType: string, targetId: string) {
  if (!targetId) return "";
  if (targetType === "customer") {
    return source.customers.find((item) => item.teamId === teamId && item.id === targetId)?.company || "";
  }
  if (targetType === "lead") {
    const lead = source.leads.find((item) => item.teamId === teamId && item.id === targetId && !item.deletedAt);
    return lead?.company || "";
  }
  if (targetType === "prospect") {
    return source.websiteOpportunities.find((item) => item.teamId === teamId && item.id === targetId)?.company || "";
  }
  return "";
}

function reasonLabel(reason: string) {
  if (!reason) return "";
  if ((Object.keys(CALLBACK_DUE_COMPLETE_REASON_LABELS) as CallbackDueCompleteReason[]).includes(reason as CallbackDueCompleteReason)) {
    return CALLBACK_DUE_COMPLETE_REASON_LABELS[reason as CallbackDueCompleteReason];
  }
  return reason;
}

function queueScopeLabel(scope: string) {
  if (scope === "mine") return "我负责的";
  if (scope === "team") return "团队";
  return "";
}

function blankRow(partial: Pick<CallbackScheduleReportRow, "id" | "kind"> & Partial<CallbackScheduleReportRow>): CallbackScheduleReportRow {
  return {
    at: "",
    targetType: "",
    targetLabel: "",
    targetId: "",
    name: "",
    actorId: "",
    actorLabel: "",
    previousScheduledAt: "",
    previousNote: "",
    nextScheduledAt: "",
    nextNote: "",
    reason: "",
    reasonLabel: "",
    queueScope: "",
    queueScopeLabel: "",
    overdueOnly: null,
    queueRowCount: null,
    ...partial
  };
}

function scheduleRow(source: CallbackScheduleReportSource, teamId: string, row: CallbackSchedule, kind: "due" | "overdue"): CallbackScheduleReportRow {
  return blankRow({
    id: row.id,
    kind,
    at: row.updatedAt || "",
    targetType: row.targetType,
    targetLabel: callbackTargetLabel(row.targetType),
    targetId: row.targetId,
    name: targetName(source, teamId, row.targetType, row.targetId),
    actorId: row.updatedBy || "",
    actorLabel: actorLabel(source, teamId, row.updatedBy || ""),
    nextScheduledAt: row.scheduledAt || "",
    nextNote: row.note || ""
  });
}

function changedTime(audit: CallbackScheduleAudit) {
  return audit.action === "update"
    && audit.previousScheduledAt !== ""
    && audit.nextScheduledAt !== ""
    && audit.previousScheduledAt !== audit.nextScheduledAt;
}

function auditRow(source: CallbackScheduleReportSource, teamId: string, audit: CallbackScheduleAudit, kind: "completed" | "rescheduled"): CallbackScheduleReportRow {
  return blankRow({
    id: audit.id,
    kind,
    at: audit.at || "",
    targetType: audit.targetType,
    targetLabel: audit.targetType ? callbackTargetLabel(audit.targetType) : "",
    targetId: audit.targetId,
    name: targetName(source, teamId, audit.targetType, audit.targetId),
    actorId: audit.actorId,
    actorLabel: actorLabel(source, teamId, audit.actorId),
    previousScheduledAt: audit.previousScheduledAt || "",
    previousNote: audit.previousNote || "",
    nextScheduledAt: audit.nextScheduledAt || "",
    nextNote: audit.nextNote || "",
    reason: audit.reason || "",
    reasonLabel: reasonLabel(audit.reason || "")
  });
}

function queueRow(source: CallbackScheduleReportSource, teamId: string, audit: CallbackDueQueueAudit): CallbackScheduleReportRow {
  const kind: "queue_read" | "queue_export" = audit.action === "export" ? "queue_export" : "queue_read";
  return blankRow({
    id: audit.id,
    kind,
    at: audit.at || "",
    actorId: audit.actorId,
    actorLabel: actorLabel(source, teamId, audit.actorId),
    queueScope: audit.scope,
    queueScopeLabel: queueScopeLabel(audit.scope),
    overdueOnly: audit.overdueOnly === true,
    queueRowCount: Number.isFinite(audit.rowCount) ? audit.rowCount : null
  });
}

function sortRows(rows: CallbackScheduleReportRow[]) {
  return rows.sort((left, right) => {
    if (left.at !== right.at) {
      if (!left.at) return 1;
      if (!right.at) return -1;
      return right.at < left.at ? -1 : 1;
    }
    return right.id < left.id ? -1 : right.id > left.id ? 1 : 0;
  });
}

export function buildCallbackScheduleReport(input: {
  source: CallbackScheduleReportSource;
  teamId: string;
  query: CallbackScheduleReportQuery;
  timeZone: string;
  today: string;
}): { rows: CallbackScheduleReportRow[]; counts: CallbackScheduleReportCounts } {
  const todayKnown = validDate(input.today);
  const rows: CallbackScheduleReportRow[] = [];
  let dueCount: number | null = todayKnown ? 0 : null;
  let overdueCount: number | null = todayKnown ? 0 : null;
  let completedCount = 0;
  let rescheduledCount = 0;

  if (todayKnown) {
    for (const row of input.source.callbackSchedules || []) {
      if (row.teamId !== input.teamId) continue;
      const kind = callbackScheduleDue(row.scheduledAt, input.today);
      if (kind !== "today" && kind !== "overdue") continue;
      const date = appointmentDate(row.scheduledAt);
      if (!recordInDateRange(date || null, input.query.from, input.query.to)) continue;
      const reportKind = kind === "today" ? "due" : "overdue";
      rows.push(scheduleRow(input.source, input.teamId, row, reportKind));
      if (reportKind === "due") dueCount = (dueCount || 0) + 1;
      else overdueCount = (overdueCount || 0) + 1;
    }
  }

  for (const audit of input.source.callbackScheduleAudits || []) {
    if (audit.teamId !== input.teamId || audit.result !== "updated") continue;
    const kind = audit.action === "cancel" ? "completed" : changedTime(audit) ? "rescheduled" : "";
    if (!kind) continue;
    if (!recordInDateRange(callbackScheduleReportLocalDate(audit.at, input.timeZone), input.query.from, input.query.to)) continue;
    rows.push(auditRow(input.source, input.teamId, audit, kind));
    if (kind === "completed") completedCount += 1;
    else rescheduledCount += 1;
  }

  for (const audit of input.source.callbackDueQueueAudits || []) {
    if (audit.teamId !== input.teamId) continue;
    if (audit.result !== "read" && audit.result !== "exported") continue;
    if (!recordInDateRange(callbackScheduleReportLocalDate(audit.at, input.timeZone), input.query.from, input.query.to)) continue;
    rows.push(queueRow(input.source, input.teamId, audit));
  }

  return {
    rows: sortRows(rows),
    counts: { dueCount, overdueCount, completedCount, rescheduledCount }
  };
}

function display(value: string) {
  const text = value.trim();
  return text ? text : "—";
}

export function callbackScheduleReportCsvRow(row: CallbackScheduleReportRow) {
  const overdue = row.overdueOnly === null ? "" : row.overdueOnly ? "是" : "否";
  const queueCount = row.queueRowCount === null || !Number.isFinite(row.queueRowCount) ? "" : String(row.queueRowCount);
  return [
    CALLBACK_SCHEDULE_REPORT_KIND_LABELS[row.kind] || row.kind,
    display(row.at),
    display(row.targetLabel),
    display(row.name),
    display(row.targetId),
    display(row.actorLabel),
    display(row.previousScheduledAt),
    display(row.previousNote),
    display(row.nextScheduledAt),
    display(row.nextNote),
    display(row.reasonLabel),
    display(row.queueScopeLabel),
    display(overdue),
    display(queueCount)
  ];
}

export function buildCallbackScheduleReportCsv(rows: CallbackScheduleReportRow[]) {
  const lines = [CALLBACK_SCHEDULE_REPORT_HEADERS as unknown as string[], ...rows.map(callbackScheduleReportCsvRow)]
    .map((line) => line.map((cell) => escapeCsvCell(cell)).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

async function writeAudit(store: CrmStore, input: Omit<CallbackScheduleReportAudit, "id" | "at">) {
  const audit: CallbackScheduleReportAudit = {
    id: `csra_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  if (!store.callbackScheduleReportAudits) store.callbackScheduleReportAudits = [];
  store.callbackScheduleReportAudits.unshift(audit);
  await store.persist();
  return audit;
}

async function rejectForbidden(
  store: CrmStore,
  user: SessionUser,
  action: CallbackScheduleReportAudit["action"],
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

function sourceOf(store: CrmStore): CallbackScheduleReportSource {
  return {
    callbackSchedules: store.callbackSchedules || [],
    callbackScheduleAudits: store.callbackScheduleAudits || [],
    callbackDueQueueAudits: store.callbackDueQueueAudits || [],
    customers: store.customers || [],
    leads: store.leads || [],
    websiteOpportunities: store.websiteOpportunities || [],
    users: store.users || []
  };
}

function reportBody(store: CrmStore, teamId: string, query: CallbackScheduleReportQuery, timeZone: string, today: string) {
  const built = buildCallbackScheduleReport({ source: sourceOf(store), teamId, query, timeZone, today });
  return {
    filters: { from: query.from || "", to: query.to || "" },
    timeZone,
    today,
    metrics: CALLBACK_SCHEDULE_REPORT_METRICS,
    counts: built.counts,
    rowCount: built.rows.length,
    rows: built.rows
  };
}

export async function listCallbackScheduleReport(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallbackScheduleReportQuery(query);
  if (!parsed) return reject("invalid_request", "参数格式错误");
  const filters = callbackScheduleReportFiltersText(parsed);
  if (!isCallbackScheduleReportManager(user)) {
    return rejectForbidden(store, user, "read", filters, "只有主管及以上可以查看回拨预约报表");
  }
  const timeZone = await tenantTimeZoneFor(store, user.teamId);
  const today = zonedDateKey(outboundInstant(), timeZone);
  const body = reportBody(store, user.teamId, parsed, timeZone, today);
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

export type CallbackScheduleReportExportResponse =
  | { status: 200; csv: string; filename: string }
  | { status: number; body: Record<string, unknown> };

export async function exportCallbackScheduleReport(
  store: CrmStore,
  user: SessionUser | undefined,
  query: Record<string, unknown>
): Promise<CallbackScheduleReportExportResponse> {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallbackScheduleReportQuery(query);
  if (!parsed) return reject("invalid_request", "参数格式错误");
  const filters = callbackScheduleReportFiltersText(parsed);
  if (!isCallbackScheduleReportManager(user)) {
    return rejectForbidden(store, user, "export", filters, "只有主管及以上可以导出回拨预约报表");
  }
  const timeZone = await tenantTimeZoneFor(store, user.teamId);
  const today = zonedDateKey(outboundInstant(), timeZone);
  const rows = buildCallbackScheduleReport({ source: sourceOf(store), teamId: user.teamId, query: parsed, timeZone, today }).rows;
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "export",
    filters,
    rowCount: rows.length,
    result: "exported",
    reason: ""
  });
  return { status: 200, csv: buildCallbackScheduleReportCsv(rows), filename: "回拨预约报表.csv" };
}
