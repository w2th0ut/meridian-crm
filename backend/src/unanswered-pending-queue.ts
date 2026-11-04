import { randomUUID } from "node:crypto";
import { displayMaskedNumber, formatEndedAgo } from "./call-wrapup-queue.js";
import { hasOpenNextFollowUp, isMoreRecentCall } from "./intent-followup-queue.js";
import { outboundInstant, tenantTimeZoneFor } from "./outbound-call.js";
import {
  isEstablishedCall,
  outboundCallRecordVisible,
  resolveOutboundCallRecordAccess,
  splitAgentIds,
  type OutboundCallRecordAccess
} from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type { OutboundCallRecord, SessionUser, UnansweredPendingQueueAudit } from "./types.js";

/**
 * 未接通待处理队列。行来自已经写下的 outbound_call_records。
 * 未接通与 §59 相同：establishedTimeRaw 去掉空白后没有内容。
 * 对象没有当前 callback_schedules 行，也没有 §61 那种未完成下次跟进，才入队。
 * 每个对象只留最近一通未接通。查看写入 unanswered_pending_queue_audits。
 * 生成下次跟进和设置回拨预约不在这里新做接口。
 * 不拨号，不发信，不调用 AI，不碰抑制或合规。
 */

export const UNANSWERED_PENDING_WEEK_SECONDS = 7 * 86400;
export type UnansweredPendingTargetType = "customer" | "lead" | "prospect";
export type UnansweredPendingAge = "" | "within7" | "over7";

const TARGET_TYPES = ["customer", "lead", "prospect"] as const;
const TARGET_LABEL: Record<UnansweredPendingTargetType, string> = {
  customer: "客户",
  lead: "线索",
  prospect: "搜客"
};

export interface UnansweredPendingObject {
  targetType: UnansweredPendingTargetType;
  targetId: string;
  teamId: string;
  name: string;
  nextFollowAt: string;
  deleted?: boolean;
}

export interface UnansweredPendingQueueQuery {
  scope: "mine" | "team";
  age: UnansweredPendingAge;
}

export interface UnansweredPendingQueueItem {
  targetType: UnansweredPendingTargetType;
  targetId: string;
  targetLabel: string;
  name: string;
  callRecordId: string;
  unansweredAt: string;
  ageSeconds: number | null;
  ageLabel: string;
  agentIds: string[];
  agentLabel: string;
  maskedNumber: string;
}

export function canViewTeamUnansweredPendingQueue(user: { role?: string } | undefined) {
  return user?.role === "manager" || user?.role === "admin" || user?.role === "super_admin";
}

function oneQuery(value: unknown) {
  if (Array.isArray(value)) return null;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value.trim() : null;
}

export function parseUnansweredPendingQueueQuery(query: Record<string, unknown>): UnansweredPendingQueueQuery | null {
  const allowed = new Set(["scope", "age"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) return null;
  if (Object.values(query).some((value) => Array.isArray(value))) return null;
  const scope = oneQuery(query.scope);
  const age = oneQuery(query.age);
  if (scope === null || age === null) return null;
  if (scope !== "mine" && scope !== "team") return null;
  if (age !== "" && age !== "within7" && age !== "over7") return null;
  return { scope, age };
}

export function unansweredPendingKey(targetType: string, targetId: string) {
  return `${targetType}:${targetId}`;
}

/** startTimeRaw 只接受正整数毫秒。解析不了不用 createdAt 代替。 */
export function unansweredStartMs(startTimeRaw: string) {
  const text = (startTimeRaw || "").trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

/** 时刻晚于现在时是 0。解析不了是 null，页面写成「—」，不写成 0。 */
export function unansweredAgeSeconds(startTimeRaw: string, now: Date) {
  const epoch = unansweredStartMs(startTimeRaw);
  if (epoch === null || !Number.isFinite(now.getTime())) return null;
  const delta = Math.floor((now.getTime() - epoch) / 1000);
  if (!Number.isFinite(delta)) return null;
  if (delta < 0) return 0;
  if (!Number.isSafeInteger(delta)) return null;
  return delta;
}

export function formatUnansweredAge(seconds: number | null) {
  if (seconds === null) return "—";
  return formatEndedAgo(seconds);
}

export function matchesUnansweredAge(seconds: number | null, age: UnansweredPendingAge) {
  if (!age) return true;
  if (seconds === null) return false;
  if (age === "within7") return seconds <= UNANSWERED_PENDING_WEEK_SECONDS;
  return seconds > UNANSWERED_PENDING_WEEK_SECONDS;
}

/** 话单开始时间在租户时区里的 YYYY-MM-DD HH:mm。解析不了是空字符串。 */
export function formatUnansweredAt(startTimeRaw: string, timeZone: string) {
  const epoch = unansweredStartMs(startTimeRaw);
  if (epoch === null) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(epoch));
    const pick = (type: string) => parts.find((part) => part.type === type)?.value || "";
    let hour = pick("hour");
    if (hour === "24") hour = "00";
    if (!pick("year") || !pick("month") || !pick("day") || !hour || !pick("minute")) return "";
    return `${pick("year")}-${pick("month")}-${pick("day")} ${hour}:${pick("minute")}`;
  } catch {
    return "";
  }
}

function isTargetType(value: string): value is UnansweredPendingTargetType {
  return (TARGET_TYPES as readonly string[]).includes(value);
}

export function buildUnansweredPendingQueue(input: {
  teamId: string;
  records: OutboundCallRecord[];
  objects: UnansweredPendingObject[];
  schedules: Array<{ teamId: string; targetType: string; targetId: string }>;
  visible: (record: OutboundCallRecord) => boolean;
  labels: Map<string, string>;
  /** null 表示不按通话坐席收窄。空数组表示当前用户没有映射，我的队列为空。 */
  ownAgentIds: string[] | null;
  age: UnansweredPendingAge;
  timeZone: string;
  now: Date;
}) {
  const objects = new Map<string, UnansweredPendingObject>();
  for (const item of input.objects) {
    if (item.teamId !== input.teamId || item.deleted) continue;
    if (!isTargetType(item.targetType)) continue;
    objects.set(unansweredPendingKey(item.targetType, item.targetId), item);
  }
  const scheduled = new Set(input.schedules
    .filter((item) => item.teamId === input.teamId)
    .map((item) => unansweredPendingKey(item.targetType, item.targetId)));
  const latest = new Map<string, OutboundCallRecord>();
  for (const record of input.records) {
    if (record.teamId !== input.teamId) continue;
    if (!isTargetType(record.targetType) || !record.targetId) continue;
    if (isEstablishedCall(record.establishedTimeRaw || "")) continue;
    const key = unansweredPendingKey(record.targetType, record.targetId);
    if (!objects.has(key)) continue;
    const current = latest.get(key);
    if (!current || isMoreRecentCall(record, current)) latest.set(key, record);
  }
  const own = input.ownAgentIds === null ? null : new Set(input.ownAgentIds);
  const rows: UnansweredPendingQueueItem[] = [];
  for (const [key, record] of latest) {
    if (!input.visible(record)) continue;
    const object = objects.get(key);
    if (!object || hasOpenNextFollowUp(object.nextFollowAt) || scheduled.has(key)) continue;
    const agents = splitAgentIds(record.agentIds || "");
    if (own && !agents.some((id) => own.has(id))) continue;
    const ageSeconds = unansweredAgeSeconds(record.startTimeRaw || "", input.now);
    if (!matchesUnansweredAge(ageSeconds, input.age)) continue;
    rows.push({
      targetType: object.targetType,
      targetId: object.targetId,
      targetLabel: TARGET_LABEL[object.targetType],
      name: object.name || object.targetId,
      callRecordId: record.id,
      unansweredAt: formatUnansweredAt(record.startTimeRaw || "", input.timeZone),
      ageSeconds,
      ageLabel: formatUnansweredAge(ageSeconds),
      agentIds: agents,
      agentLabel: agents.map((id) => input.labels.get(id) || id).join("、"),
      maskedNumber: displayMaskedNumber(record.maskedNumber || "")
    });
  }
  rows.sort((left, right) => {
    if (left.ageSeconds === null && right.ageSeconds === null) return left.callRecordId < right.callRecordId ? 1 : left.callRecordId > right.callRecordId ? -1 : 0;
    if (left.ageSeconds === null) return 1;
    if (right.ageSeconds === null) return -1;
    if (left.ageSeconds !== right.ageSeconds) return right.ageSeconds - left.ageSeconds;
    return left.callRecordId < right.callRecordId ? 1 : left.callRecordId > right.callRecordId ? -1 : 0;
  });
  return rows;
}

function snapshotsFor(store: CrmStore, teamId: string): UnansweredPendingObject[] {
  const rows: UnansweredPendingObject[] = [];
  for (const customer of store.customers) {
    if (customer.teamId !== teamId) continue;
    rows.push({
      targetType: "customer",
      targetId: customer.id,
      teamId: customer.teamId,
      name: customer.company,
      nextFollowAt: customer.nextReminder || ""
    });
  }
  for (const lead of store.leads) {
    if (lead.teamId !== teamId) continue;
    rows.push({
      targetType: "lead",
      targetId: lead.id,
      teamId: lead.teamId,
      name: lead.company,
      nextFollowAt: lead.nextFollowAt || "",
      deleted: Boolean(lead.deletedAt)
    });
  }
  for (const candidate of store.websiteOpportunities) {
    if (candidate.teamId !== teamId) continue;
    rows.push({
      targetType: "prospect",
      targetId: candidate.id,
      teamId: candidate.teamId,
      name: candidate.company,
      nextFollowAt: candidate.nextFollowAt || ""
    });
  }
  return rows;
}

function ownAgentIds(store: CrmStore, user: SessionUser, scope: "mine" | "team") {
  if (scope !== "mine") return null;
  return store.aliyunAgentMappings
    .filter((item) => item.teamId === user.teamId && item.crmUserId === user.id && item.cccUserId)
    .map((item) => item.cccUserId);
}

function queueFromStore(store: CrmStore, user: SessionUser, access: OutboundCallRecordAccess, query: UnansweredPendingQueueQuery, now: Date) {
  return buildUnansweredPendingQueue({
    teamId: user.teamId,
    records: store.outboundCallRecords,
    objects: snapshotsFor(store, user.teamId),
    schedules: store.callbackSchedules,
    visible: (record) => outboundCallRecordVisible(record, user.teamId, access),
    labels: access.labels,
    ownAgentIds: ownAgentIds(store, user, query.scope),
    age: query.age,
    timeZone: access.timeZone,
    now
  });
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

async function writeAudit(store: CrmStore, input: Omit<UnansweredPendingQueueAudit, "id" | "at">) {
  const audit: UnansweredPendingQueueAudit = {
    id: `upqa_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  if (!store.unansweredPendingQueueAudits) store.unansweredPendingQueueAudits = [];
  store.unansweredPendingQueueAudits.unshift(audit);
  await store.persist();
  return audit;
}

export async function listUnansweredPendingQueue(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseUnansweredPendingQueueQuery(query);
  if (!parsed) return reject("invalid_request", "未接通待处理队列只接受我的或团队，以及日龄");
  if (parsed.scope === "team" && !canViewTeamUnansweredPendingQueue(user)) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "read",
      scope: "team",
      age: parsed.age,
      rowCount: 0,
      result: "rejected",
      reason: "forbidden"
    });
    return reject("forbidden", "没有查看团队未接通待处理队列的权限", 403);
  }
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const now = outboundInstant();
  const items = queueFromStore(store, user, resolved.access, parsed, now);
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "read",
    scope: parsed.scope,
    age: parsed.age,
    rowCount: items.length,
    result: "read",
    reason: ""
  });
  return {
    status: 200,
    body: {
      scope: parsed.scope,
      age: parsed.age,
      timeZone: resolved.access.timeZone || await tenantTimeZoneFor(store, user.teamId),
      empty: items.length === 0,
      items
    }
  };
}
