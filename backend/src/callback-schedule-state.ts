import type { CrmStore } from "./store.js";
import type { CallbackSchedule } from "./types.js";

/**
 * 回拨预约的当前值。到期只按租户当地日比较，不拨号。
 * 今日到期：预约日期等于今天。已逾期：预约日期早于今天。更晚的日期是未到。
 */

export const CALLBACK_NOTE_MAX = 200;
export type CallbackDueKind = "today" | "overdue" | "later" | "";
export type CallbackDueFilter = "today" | "overdue" | "due";
export type CallbackTargetType = "customer" | "lead" | "prospect";

export function callbackNoteLength(note: string) {
  return Array.from(note).length;
}

export function parseCallbackScheduledAt(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
}

export function normalizeCallbackNote(value: unknown): { ok: true; note: string } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, note: "" };
  if (typeof value !== "string") return { ok: false };
  const note = value.trim();
  if (callbackNoteLength(note) > CALLBACK_NOTE_MAX) return { ok: false };
  return { ok: true, note };
}

/** 预约时间是租户当地的 YYYY-MM-DD HH:mm。today 是同一套当地日。 */
export function callbackScheduleDue(scheduledAt: string, today: string): CallbackDueKind {
  const date = scheduledAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return "";
  if (date === today) return "today";
  if (date < today) return "overdue";
  return "later";
}

export function findCallbackSchedule(
  store: Pick<CrmStore, "callbackSchedules">,
  teamId: string,
  targetType: string,
  targetId: string
) {
  return store.callbackSchedules.find((item) =>
    item.teamId === teamId && item.targetType === targetType && item.targetId === targetId
  );
}

export function callbackScheduleView(
  store: Pick<CrmStore, "callbackSchedules">,
  teamId: string,
  targetType: string,
  targetId: string,
  today: string
) {
  const row = findCallbackSchedule(store, teamId, targetType, targetId);
  if (!row) return { callbackScheduledAt: "", callbackNote: "", callbackDue: "" as const };
  return {
    callbackScheduledAt: row.scheduledAt,
    callbackNote: row.note,
    callbackDue: callbackScheduleDue(row.scheduledAt, today)
  };
}

export function callbackTargetLabel(targetType: string) {
  if (targetType === "lead") return "线索";
  if (targetType === "prospect") return "搜客";
  return "客户";
}

export type { CallbackSchedule };
