import { randomUUID } from "node:crypto";
import { findCallbackSchedule } from "./callback-schedule-state.js";
import { outboundInstant } from "./outbound-call.js";
import {
  callLocalDate,
  isEstablishedCall,
  parseCallDurationSeconds,
  parseOutboundCallRecordQuery,
  presentOutboundCallRecord,
  recordsMatchingNote,
  recordsMatchingOutcome,
  resolveOutboundCallRecordAccess,
  selectOutboundCallRecords,
  type OutboundCallRecordQuery
} from "./outbound-call-records.js";
import { resolveCallRecordPhone } from "./phone-validity-state.js";
import type { CrmStore } from "./store.js";
import type { CallExportAudit, OutboundCallRecord, Role, SessionUser } from "./types.js";

/**
 * 按当前筛选把看得到的通话记录导出成 CSV。
 * 号码沿用多号码解析，默认中间脱敏。文件只在这次响应里返回，不发邮件，不上传。
 * 不拨号，不改记录，不改抑制，不转线索，不请求阿里云。
 */

export const CALL_EXPORT_ROW_LIMIT = 10000;
export const CALL_EXPORT_HEADERS = ["时间", "坐席", "对象名", "号码", "接通与否", "时长秒", "人工结果标注", "纪要", "回拨预约"] as const;
const FORMULA_PREFIX = new Set(["=", "+", "-", "@"]);

export function canExportPlaintext(role: Role | string | undefined) {
  return role === "admin" || role === "super_admin";
}

/** 省略、空或 0 是脱敏。只有 1 是明文。别的值不接受。 */
export function parseCallExportPlaintext(value: unknown): boolean | null {
  if (Array.isArray(value)) return null;
  if (value === undefined || value === null) return false;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text === "0") return false;
  if (text === "1") return true;
  return null;
}

export function callExportFiltersText(query: OutboundCallRecordQuery) {
  return JSON.stringify({
    agentId: query.agentId || "",
    from: query.from || "",
    to: query.to || "",
    outcome: query.outcome || "",
    note: query.note || ""
  });
}

/**
 * 只留数字。8 位及以上留前 3 和末 4，中间是星号。
 * 5 到 7 位留第 1 位和末 2 位。4 位及以内全部是星号。没有数字就是空。
 */
export function maskPhoneMiddle(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length <= 4) return "*".repeat(digits.length);
  const head = digits.length >= 8 ? 3 : 1;
  const tail = digits.length >= 8 ? 4 : 2;
  const hidden = digits.length - head - tail;
  return `${digits.slice(0, head)}${"*".repeat(hidden)}${digits.slice(-tail)}`;
}

/** 单元格以 = + - @ 开头时加单引号。含逗号、引号或换行时按 CSV 转义。 */
export function escapeCsvCell(value: string) {
  let text = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (text && FORMULA_PREFIX.has(text[0] || "")) text = `'${text}`;
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildCallExportCsv(rows: string[][]) {
  const lines = [CALL_EXPORT_HEADERS as unknown as string[], ...rows]
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function callExportLocalTime(startTimeRaw: string, timeZone: string) {
  const text = startTimeRaw.trim();
  if (!/^\d+$/.test(text)) return "";
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(at);
    const pick = (type: string) => parts.find((part) => part.type === type)?.value || "";
    let hour = pick("hour");
    if (hour === "24") hour = "00";
    hour = hour.padStart(2, "0");
    const minute = pick("minute").padStart(2, "0");
    const date = `${pick("year")}-${pick("month")}-${pick("day")}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}$/.test(hour) || !/^\d{2}$/.test(minute)) return "";
    return `${date} ${hour}:${minute}`;
  } catch {
    return "";
  }
}

export function exportNumberForCall(
  store: CrmStore,
  record: Pick<OutboundCallRecord, "teamId" | "targetType" | "targetId" | "maskedNumber" | "outboundCallAuditId">,
  plaintext: boolean
) {
  const resolved = resolveCallRecordPhone(store, record);
  if (!resolved.ok) return record.maskedNumber || "";
  return plaintext ? resolved.phone.phone : maskPhoneMiddle(resolved.phone.phone);
}

function objectName(store: CrmStore, record: OutboundCallRecord) {
  if (record.targetType === "customer") {
    const customer = store.customers.find((item) => item.id === record.targetId && item.teamId === record.teamId);
    return (customer?.company || customer?.contact || "").trim();
  }
  if (record.targetType === "lead") {
    const lead = store.leads.find((item) => item.id === record.targetId && item.teamId === record.teamId && !item.deletedAt);
    return (lead?.company || lead?.contact || "").trim();
  }
  if (record.targetType === "prospect") {
    const prospect = store.websiteOpportunities.find((item) => item.id === record.targetId && item.teamId === record.teamId);
    return (prospect?.company || prospect?.contact || "").trim();
  }
  return "";
}

function outcomeCell(record: OutboundCallRecord) {
  const outcome = (record.callOutcome || "").trim();
  const note = (record.callOutcomeNote || "").trim();
  if (outcome && note) return `${outcome} ${note}`;
  return outcome || note;
}

function noteCell(record: OutboundCallRecord) {
  const tags = (record.callNoteTags || "").split(",").map((item) => item.trim()).filter(Boolean);
  const note = (record.callNote || "").trim();
  const tagText = tags.join("、");
  if (tagText && note) return `${tagText} ${note}`;
  return tagText || note;
}

function callbackCell(store: CrmStore, record: OutboundCallRecord) {
  const row = findCallbackSchedule(store, record.teamId, record.targetType, record.targetId);
  if (!row?.scheduledAt) return "";
  const note = (row.note || "").trim();
  return note ? `${row.scheduledAt} ${note}` : row.scheduledAt;
}

function durationCell(record: OutboundCallRecord) {
  if (!isEstablishedCall(record.establishedTimeRaw)) return "";
  const seconds = parseCallDurationSeconds(record.callDurationRaw);
  return seconds === null ? "" : String(seconds);
}

function compareRecords(left: OutboundCallRecord, right: OutboundCallRecord, timeZone: string) {
  const leftDate = callLocalDate(left.startTimeRaw, timeZone);
  const rightDate = callLocalDate(right.startTimeRaw, timeZone);
  if (leftDate && rightDate && leftDate !== rightDate) return leftDate < rightDate ? 1 : -1;
  if (leftDate && !rightDate) return -1;
  if (!leftDate && rightDate) return 1;
  return left.id < right.id ? 1 : -1;
}

function exportRow(store: CrmStore, record: OutboundCallRecord, timeZone: string, labels: Map<string, string>, plaintext: boolean) {
  const presented = presentOutboundCallRecord(record, timeZone, labels);
  return [
    callExportLocalTime(record.startTimeRaw, timeZone),
    presented.agentLabel,
    objectName(store, record),
    exportNumberForCall(store, record, plaintext),
    presented.established ? "是" : "否",
    durationCell(record),
    outcomeCell(record),
    noteCell(record),
    callbackCell(store, record)
  ];
}

async function writeAudit(store: CrmStore, input: Omit<CallExportAudit, "id" | "at">) {
  const audit: CallExportAudit = {
    id: `cea_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.callExportAudits.unshift(audit);
  await store.persist();
  return audit;
}

export type CallExportResponse =
  | { status: 200; csv: string; filename: string }
  | { status: number; body: Record<string, unknown> };

export async function exportOutboundCallRecords(
  store: CrmStore,
  user: SessionUser | undefined,
  query: Record<string, unknown>
): Promise<CallExportResponse> {
  if (!user?.id || !user.teamId) {
    return { status: 401, body: { message: "未登录" } };
  }
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  const parsed = parseOutboundCallRecordQuery(query);
  const plaintext = parseCallExportPlaintext(query.plaintext);
  if (!resolved.ok) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      filters: parsed ? callExportFiltersText(parsed) : "",
      rowCount: 0,
      plaintext: plaintext === true,
      result: "rejected",
      reason: "forbidden"
    });
    return { status: resolved.status, body: resolved.body };
  }
  if (!parsed || plaintext === null) {
    return { status: 400, body: { result: "rejected", reason: "invalid_request", message: "参数格式错误" } };
  }
  const access = resolved.access;
  const filters = callExportFiltersText(parsed);
  if (parsed.agentId && !access.tenantWide && !access.allowed.has(parsed.agentId)) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      filters,
      rowCount: 0,
      plaintext,
      result: "rejected",
      reason: "forbidden"
    });
    return { status: 403, body: { result: "rejected", reason: "forbidden", message: "不能查看这个坐席的通话记录" } };
  }
  if (plaintext && !canExportPlaintext(user.role)) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      filters,
      rowCount: 0,
      plaintext: true,
      result: "rejected",
      reason: "plaintext_forbidden"
    });
    return { status: 403, body: { result: "rejected", reason: "plaintext_forbidden", message: "只有管理员可以导出明文号码" } };
  }
  const selected = selectOutboundCallRecords({
    records: store.outboundCallRecords,
    teamId: user.teamId,
    teamWide: access.tenantWide,
    agentIds: access.allowed,
    agentId: parsed.agentId,
    from: parsed.from,
    to: parsed.to,
    timeZone: access.timeZone
  });
  const listed = recordsMatchingNote(recordsMatchingOutcome(selected, parsed.outcome), parsed.note)
    .sort((left, right) => compareRecords(left, right, access.timeZone));
  if (listed.length > CALL_EXPORT_ROW_LIMIT) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      filters,
      rowCount: listed.length,
      plaintext,
      result: "rejected",
      reason: "too_many_rows"
    });
    return {
      status: 400,
      body: {
        result: "rejected",
        reason: "too_many_rows",
        message: `单次最多导出 ${CALL_EXPORT_ROW_LIMIT} 行，请缩小时间范围或筛选条件`,
        rowCount: listed.length,
        limit: CALL_EXPORT_ROW_LIMIT
      }
    };
  }
  const rows = listed.map((record) => exportRow(store, record, access.timeZone, access.labels, plaintext));
  const csv = buildCallExportCsv(rows);
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    filters,
    rowCount: rows.length,
    plaintext,
    result: "exported",
    reason: ""
  });
  return { status: 200, csv, filename: "外呼通话记录.csv" };
}
