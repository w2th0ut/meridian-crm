import { randomUUID } from "node:crypto";
import { escapeCsvCell } from "./call-export.js";
import { formatEndedAgo } from "./call-wrapup-queue.js";
import { cancelDueCallback, listCallbackSchedules } from "./callback-schedule.js";
import type { CallbackTargetType } from "./callback-schedule-state.js";
import { outboundInstant } from "./outbound-call.js";
import type { CrmStore } from "./store.js";
import type { CallbackDueQueueAudit, SessionUser } from "./types.js";

/**
 * 回拨到期队列。行只来自 §64 的 callback_schedules。
 * 今日到期和已逾期的口径、时区与拨号时段相同。
 * 查看和导出写入 callback_due_queue_audits。标完成走原来的取消，改期走原来的设置。
 * 不拨号，不发信，不调用 AI，不碰抑制或合规。
 */

export const CALLBACK_DUE_COMPLETE_REASONS = ["reached", "no_need", "wrong_time", "other"] as const;
export type CallbackDueCompleteReason = (typeof CALLBACK_DUE_COMPLETE_REASONS)[number];

export const CALLBACK_DUE_COMPLETE_REASON_LABELS: Record<CallbackDueCompleteReason, string> = {
  reached: "已回拨",
  no_need: "无需回拨",
  wrong_time: "约错时间",
  other: "其他"
};

export const CALLBACK_DUE_QUEUE_HEADERS = ["对象类型", "对象", "预约时间", "备注", "负责坐席", "已过多久", "到期"] as const;

const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes", "phones", "scheduledAts", "notes"] as const;
const TARGET_TYPES = ["customer", "lead", "prospect"] as const;
const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface CallbackDueQueueQuery {
  scope: "mine" | "team";
  overdueOnly: boolean;
}

export interface CallbackDueQueueItem {
  targetType: CallbackTargetType;
  targetId: string;
  targetLabel: string;
  name: string;
  scheduledAt: string;
  note: string;
  due: "today" | "overdue";
  ownerAgentId: string;
  ownerAgentLabel: string;
  ageSeconds: number | null;
  ageLabel: string;
}

export function canViewTeamCallbackDueQueue(user: { role?: string } | undefined) {
  return user?.role === "manager" || user?.role === "admin" || user?.role === "super_admin";
}

function oneQuery(value: unknown) {
  if (Array.isArray(value)) return null;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value.trim() : null;
}

export function parseCallbackDueQueueQuery(query: Record<string, unknown>): CallbackDueQueueQuery | null {
  const allowed = new Set(["scope", "overdue"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) return null;
  if (Object.values(query).some((value) => Array.isArray(value))) return null;
  const scope = oneQuery(query.scope);
  const overdue = oneQuery(query.overdue);
  if (scope === null || overdue === null) return null;
  if (scope !== "mine" && scope !== "team") return null;
  if (overdue !== "" && overdue !== "1") return null;
  return { scope, overdueOnly: overdue === "1" };
}

function isTargetType(value: string): value is CallbackTargetType {
  return (TARGET_TYPES as readonly string[]).includes(value);
}

export function parseCallbackDueComplete(body: unknown):
  | { ok: true; targetType: CallbackTargetType; targetId: string; reason: CallbackDueCompleteReason }
  | { ok: false } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false };
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return { ok: false };
  if (Object.keys(record).some((key) => !["targetType", "targetId", "reason"].includes(key))) return { ok: false };
  if (typeof record.targetType !== "string" || !isTargetType(record.targetType)) return { ok: false };
  if (typeof record.targetId !== "string" || !TARGET_ID_PATTERN.test(record.targetId.trim())) return { ok: false };
  if (typeof record.reason !== "string" || !(CALLBACK_DUE_COMPLETE_REASONS as readonly string[]).includes(record.reason)) {
    return { ok: false };
  }
  return {
    ok: true,
    targetType: record.targetType,
    targetId: record.targetId.trim(),
    reason: record.reason as CallbackDueCompleteReason
  };
}

function wallParts(at: Date, timeZone: string) {
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
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || "";
  let hour = Number(pick("hour"));
  if (hour === 24) hour = 0;
  return {
    year: Number(pick("year")),
    month: Number(pick("month")),
    day: Number(pick("day")),
    hour,
    minute: Number(pick("minute")),
    second: Number(pick("second"))
  };
}

/** 预约时间是租户当地的墙上时间 YYYY-MM-DD HH:mm。解析不了返回 null。 */
export function callbackWallClockEpochMs(scheduledAt: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(scheduledAt.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return null;
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let epoch = desired;
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const wall = wallParts(new Date(epoch), timeZone);
      const wallUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
      const delta = wallUtc - desired;
      if (delta === 0) return epoch;
      epoch -= delta;
    }
    const wall = wallParts(new Date(epoch), timeZone);
    const wallUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    return wallUtc === desired ? epoch : null;
  } catch {
    return null;
  }
}

/** 预约时刻晚于现在时是 0。解析不了是 null，页面写成「—」，不写成 0。 */
export function callbackDueAgeSeconds(scheduledAt: string, timeZone: string, now: Date) {
  const epoch = callbackWallClockEpochMs(scheduledAt, timeZone);
  if (epoch === null || !Number.isFinite(now.getTime())) return null;
  const delta = Math.floor((now.getTime() - epoch) / 1000);
  if (!Number.isFinite(delta)) return null;
  if (delta < 0) return 0;
  if (!Number.isSafeInteger(delta)) return null;
  return delta;
}

export function formatCallbackDueAge(seconds: number | null) {
  if (seconds === null) return "—";
  return formatEndedAgo(seconds);
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

async function writeAudit(store: CrmStore, input: Omit<CallbackDueQueueAudit, "id" | "at">) {
  const audit: CallbackDueQueueAudit = {
    id: `cdqa_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.callbackDueQueueAudits.unshift(audit);
  await store.persist();
  return audit;
}

async function collect(store: CrmStore, user: SessionUser, query: CallbackDueQueueQuery) {
  const listed = await listCallbackSchedules(store, user, {
    due: query.overdueOnly ? "overdue" : "due",
    owner: query.scope === "mine" ? "mine" : ""
  });
  if (listed.status !== 200) return listed;
  const source = listed.body as {
    timeZone: string;
    today: string;
    items: Array<Omit<CallbackDueQueueItem, "ageSeconds" | "ageLabel">>;
  };
  const now = outboundInstant();
  const items: CallbackDueQueueItem[] = source.items.map((item) => {
    const ageSeconds = callbackDueAgeSeconds(item.scheduledAt, source.timeZone, now);
    return { ...item, ageSeconds, ageLabel: formatCallbackDueAge(ageSeconds) };
  });
  return {
    status: 200,
    body: {
      scope: query.scope,
      overdueOnly: query.overdueOnly,
      timeZone: source.timeZone,
      today: source.today,
      empty: items.length === 0,
      items
    }
  };
}

async function authorize(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>, action: "read" | "export"): Promise<
  | { ok: false; status: number; body: { message: string; result?: "rejected"; reason?: string } }
  | { ok: true; user: SessionUser; parsed: CallbackDueQueueQuery }
> {
  if (!user?.id || !user.teamId) return { ok: false, status: 401, body: { message: "未登录" } };
  const actor = user;
  const parsed = parseCallbackDueQueueQuery(query);
  if (!parsed) return { ok: false, ...reject("invalid_request", "回拨到期队列只接受我负责的或团队，以及是否只看已逾期") };
  if (parsed.scope === "team" && !canViewTeamCallbackDueQueue(actor)) {
    await writeAudit(store, {
      teamId: actor.teamId,
      actorId: actor.id,
      action,
      scope: "team",
      overdueOnly: parsed.overdueOnly,
      rowCount: 0,
      result: "rejected",
      reason: "forbidden"
    });
    return { ok: false, ...reject("forbidden", "没有查看团队回拨到期队列的权限", 403) };
  }
  return { ok: true, user: actor, parsed };
}

export async function listCallbackDueQueue(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>) {
  const allowed = await authorize(store, user, query, "read");
  if (!allowed.ok) return allowed;
  const collected = await collect(store, allowed.user, allowed.parsed);
  if (collected.status !== 200) return collected;
  const items = (collected.body as { items: CallbackDueQueueItem[] }).items;
  await writeAudit(store, {
    teamId: allowed.user.teamId,
    actorId: allowed.user.id,
    action: "read",
    scope: allowed.parsed.scope,
    overdueOnly: allowed.parsed.overdueOnly,
    rowCount: items.length,
    result: "read",
    reason: ""
  });
  return collected;
}

function ownerCell(item: CallbackDueQueueItem) {
  if (!item.ownerAgentId) return "未指派";
  return item.ownerAgentLabel || item.ownerAgentId;
}

export function callbackDueQueueCsvRow(item: CallbackDueQueueItem) {
  return [
    item.targetLabel || item.targetType,
    item.name || item.targetId,
    item.scheduledAt,
    item.note || "",
    ownerCell(item),
    item.ageLabel || "—",
    item.due === "overdue" ? "已逾期" : "今日到期"
  ];
}

export function buildCallbackDueQueueCsv(items: CallbackDueQueueItem[]) {
  const lines = [CALLBACK_DUE_QUEUE_HEADERS as unknown as string[], ...items.map(callbackDueQueueCsvRow)]
    .map((line) => line.map((cell) => escapeCsvCell(cell)).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export async function exportCallbackDueQueue(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>) {
  const allowed = await authorize(store, user, query, "export");
  if (!allowed.ok) return allowed;
  const collected = await collect(store, allowed.user, allowed.parsed);
  if (collected.status !== 200) return collected;
  const items = (collected.body as { items: CallbackDueQueueItem[] }).items;
  await writeAudit(store, {
    teamId: allowed.user.teamId,
    actorId: allowed.user.id,
    action: "export",
    scope: allowed.parsed.scope,
    overdueOnly: allowed.parsed.overdueOnly,
    rowCount: items.length,
    result: "exported",
    reason: ""
  });
  return { csv: buildCallbackDueQueueCsv(items), filename: "回拨到期队列.csv" };
}

export async function completeCallbackDueQueue(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallbackDueComplete(body);
  if (!parsed.ok) return reject("invalid_request", "一次只能把一条今日到期或已逾期的回拨标成已完成");
  return cancelDueCallback(store, user, parsed.targetType, parsed.targetId, parsed.reason);
}
