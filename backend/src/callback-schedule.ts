import { randomUUID } from "node:crypto";
import { hasIamPermission } from "./auth.js";
import {
  callbackScheduleDue,
  callbackTargetLabel,
  findCallbackSchedule,
  normalizeCallbackNote,
  parseCallbackScheduledAt,
  type CallbackDueFilter,
  type CallbackTargetType
} from "./callback-schedule-state.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import { outboundInstant, tenantTimeZoneFor, zonedDateKey } from "./outbound-call.js";
import { outboundOwnerView, parseOwnerMineFilter, userOwnsOutboundTarget } from "./outbound-owner.js";
import {
  outboundCallRecordVisible,
  resolveOutboundCallRecordAccess
} from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type { CallbackSchedule, CallbackScheduleAudit, SessionUser } from "./types.js";

/**
 * 给一条客户、线索或搜客对象设置、修改或取消回拨预约。
 * 只写本地预约和 callback_schedule_audits。不拨号，不发信，不推进序列，不改抑制。
 * 到期筛选只列出提醒，不会调用拨号器。
 */

const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes", "phones", "scheduledAts", "notes"] as const;
const TARGET_TYPES = ["customer", "lead", "prospect"] as const;
const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const WRITE_PERMISSION: Record<CallbackTargetType, string> = {
  customer: "customer.update",
  lead: "lead.update",
  prospect: "prospect.execute"
};

const READ_PERMISSION: Record<CallbackTargetType, string> = {
  customer: "customer.read",
  lead: "lead.read",
  prospect: "prospect.read"
};

type ScheduleInput = {
  targetType: CallbackTargetType;
  targetId: string;
  scheduledAt: string;
  note: string;
  sourceCallRecordId: string;
};

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function isTargetType(value: string): value is CallbackTargetType {
  return (TARGET_TYPES as readonly string[]).includes(value);
}

function clipId(value: string) {
  return value.slice(0, 64);
}

function hasBatchKey(record: Record<string, unknown>) {
  return BATCH_KEYS.some((key) => key in record);
}

export function parseCallbackScheduleRequest(body: unknown):
  | { ok: true; targetType: CallbackTargetType; targetId: string; scheduledAt: string; note: string }
  | { ok: false; reason: "invalid_request" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (hasBatchKey(record)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(record).some((key) => !["targetType", "targetId", "scheduledAt", "note"].includes(key))) {
    return { ok: false, reason: "invalid_request" };
  }
  if (typeof record.targetType !== "string" || !isTargetType(record.targetType)) return { ok: false, reason: "invalid_request" };
  if (typeof record.targetId !== "string" || !TARGET_ID_PATTERN.test(record.targetId.trim())) {
    return { ok: false, reason: "invalid_request" };
  }
  const scheduledAt = parseCallbackScheduledAt(record.scheduledAt);
  if (!scheduledAt) return { ok: false, reason: "invalid_request" };
  const note = normalizeCallbackNote(record.note);
  if (!note.ok) return { ok: false, reason: "invalid_request" };
  return {
    ok: true,
    targetType: record.targetType,
    targetId: record.targetId.trim(),
    scheduledAt,
    note: note.note
  };
}

export function parseCallbackCancelRequest(body: unknown):
  | { ok: true; targetType: CallbackTargetType; targetId: string }
  | { ok: false; reason: "invalid_request" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (hasBatchKey(record)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(record).some((key) => !["targetType", "targetId"].includes(key))) {
    return { ok: false, reason: "invalid_request" };
  }
  if (typeof record.targetType !== "string" || !isTargetType(record.targetType)) return { ok: false, reason: "invalid_request" };
  if (typeof record.targetId !== "string" || !TARGET_ID_PATTERN.test(record.targetId.trim())) {
    return { ok: false, reason: "invalid_request" };
  }
  return { ok: true, targetType: record.targetType, targetId: record.targetId.trim() };
}

export function parseCallCallbackRequest(body: unknown):
  | { ok: true; cancel: true }
  | { ok: true; cancel: false; scheduledAt: string; note: string }
  | { ok: false; reason: "invalid_request" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (hasBatchKey(record)) return { ok: false, reason: "invalid_request" };
  if (record.cancel === true) {
    if (Object.keys(record).some((key) => key !== "cancel")) return { ok: false, reason: "invalid_request" };
    return { ok: true, cancel: true };
  }
  if (Object.keys(record).some((key) => !["scheduledAt", "note"].includes(key))) return { ok: false, reason: "invalid_request" };
  const scheduledAt = parseCallbackScheduledAt(record.scheduledAt);
  if (!scheduledAt) return { ok: false, reason: "invalid_request" };
  const note = normalizeCallbackNote(record.note);
  if (!note.ok) return { ok: false, reason: "invalid_request" };
  return { ok: true, cancel: false, scheduledAt, note: note.note };
}

export function parseCallbackDueFilter(value: unknown): CallbackDueFilter | null {
  if (value === undefined || value === null || value === "") return "due";
  if (Array.isArray(value)) return null;
  if (value === "today" || value === "overdue" || value === "due") return value;
  return null;
}

async function ownerVisible(store: CrmStore, user: SessionUser, permission: string, ownerId: string, teamId: string) {
  if (!hasIamPermission(user, permission)) return false;
  if (store.resolveIamDataScope) {
    const scope = await store.resolveIamDataScope(user, permission);
    return teamId === user.teamId && (scope.tenantWide || scope.ownerIds.includes(ownerId));
  }
  const scopes = user.iamPermissions?.[permission] || [];
  if (scopes.includes("tenant")) return teamId === user.teamId;
  const organizationWide = scopes.includes("org_unit") || scopes.includes("org_subtree");
  const ownerIds = organizationWide
    ? store.users.filter((item) => item.teamId === user.teamId && item.status === "active").map((item) => item.id)
    : scopes.includes("self") ? [user.id] : [];
  return teamId === user.teamId && ownerIds.includes(ownerId);
}

function locate(store: CrmStore, teamId: string, targetType: CallbackTargetType, targetId: string) {
  if (targetType === "customer") {
    const customer = store.customers.find((item) => item.id === targetId && item.teamId === teamId);
    if (!customer) return { ok: false as const, status: 404, reason: "not_found", message: "客户不存在" };
    return {
      ok: true as const,
      targetType,
      targetId: customer.id,
      ownerId: customer.ownerId,
      publicPool: isPublicCustomer(customer),
      name: customer.company || customer.id
    };
  }
  if (targetType === "lead") {
    const lead = store.leads.find((item) => item.id === targetId && item.teamId === teamId && !item.deletedAt);
    if (!lead) return { ok: false as const, status: 404, reason: "not_found", message: "线索不存在或已删除" };
    return {
      ok: true as const,
      targetType,
      targetId: lead.id,
      ownerId: lead.ownerId,
      publicPool: false,
      name: lead.company || lead.id
    };
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === targetId && item.teamId === teamId);
  if (!candidate) return { ok: false as const, status: 404, reason: "not_found", message: "搜客对象不存在" };
  return {
    ok: true as const,
    targetType,
    targetId: candidate.id,
    ownerId: candidate.ownerId,
    publicPool: false,
    name: candidate.company || candidate.id
  };
}

async function accessFailure(
  store: CrmStore,
  user: SessionUser,
  located: { targetType: CallbackTargetType; ownerId: string; publicPool: boolean }
) {
  const permission = WRITE_PERMISSION[located.targetType];
  if (!hasIamPermission(user, permission) || !await ownerVisible(store, user, permission, located.ownerId, user.teamId)) {
    return { status: 403, reason: "forbidden", message: "没有操作该记录的权限" };
  }
  if (located.targetType === "prospect" && located.ownerId !== user.id) {
    return { status: 403, reason: "forbidden", message: "只有候选归属业务员可以设置回拨预约" };
  }
  if (located.publicPool) {
    return { status: 409, reason: "public_pool", message: "公池客户为只读，请先领取后再操作" };
  }
  return null;
}

async function canReadTarget(
  store: CrmStore,
  user: SessionUser,
  targetType: CallbackTargetType,
  ownerId: string
) {
  if (await ownerVisible(store, user, READ_PERMISSION[targetType], ownerId, user.teamId)) return true;
  return ownerVisible(store, user, WRITE_PERMISSION[targetType], ownerId, user.teamId);
}

async function writeAudit(store: CrmStore, input: Omit<CallbackScheduleAudit, "id" | "at">) {
  const audit: CallbackScheduleAudit = {
    id: `cba_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.callbackScheduleAudits.unshift(audit);
  await store.persist();
  return audit;
}

function currentValues(store: CrmStore, teamId: string, targetType: string, targetId: string) {
  const row = findCallbackSchedule(store, teamId, targetType, targetId);
  return {
    scheduledAt: row?.scheduledAt || "",
    note: row?.note || ""
  };
}

async function rejectWithAudit(
  store: CrmStore,
  user: SessionUser,
  input: {
    action: "set" | "update" | "cancel";
    targetType: CallbackTargetType | "";
    targetId: string;
    previousScheduledAt: string;
    previousNote: string;
    nextScheduledAt: string;
    nextNote: string;
    reason: string;
    sourceCallRecordId: string;
    status: number;
    message: string;
  }
) {
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    previousScheduledAt: input.previousScheduledAt,
    nextScheduledAt: input.nextScheduledAt,
    previousNote: input.previousNote,
    nextNote: input.nextNote,
    result: "rejected",
    reason: input.reason,
    sourceCallRecordId: input.sourceCallRecordId
  });
  return reject(input.reason, input.message, input.status);
}

function successBody(input: {
  result: "updated" | "unchanged";
  action: "set" | "update" | "cancel";
  message: string;
  targetType: CallbackTargetType;
  targetId: string;
  scheduledAt: string;
  note: string;
  previousScheduledAt: string;
  previousNote: string;
  sourceCallRecordId: string;
  auditId?: string;
}) {
  return { status: 200, body: input };
}

async function apply(
  store: CrmStore,
  user: SessionUser,
  input: { cancel: true; targetType: CallbackTargetType; targetId: string; sourceCallRecordId: string }
    | ({ cancel: false } & ScheduleInput)
) {
  const located = locate(store, user.teamId, input.targetType, input.targetId);
  const nextScheduledAt = input.cancel ? "" : input.scheduledAt;
  const nextNote = input.cancel ? "" : input.note;
  if (!located.ok) {
    return rejectWithAudit(store, user, {
      action: input.cancel ? "cancel" : "set",
      targetType: input.targetType,
      targetId: input.targetId,
      previousScheduledAt: "",
      previousNote: "",
      nextScheduledAt,
      nextNote,
      reason: located.reason,
      sourceCallRecordId: input.sourceCallRecordId,
      status: located.status,
      message: located.message
    });
  }
  const denied = await accessFailure(store, user, located);
  const previous = currentValues(store, user.teamId, located.targetType, located.targetId);
  const action: "set" | "update" | "cancel" = input.cancel ? "cancel" : previous.scheduledAt ? "update" : "set";
  if (denied) {
    return rejectWithAudit(store, user, {
      action,
      targetType: located.targetType,
      targetId: located.targetId,
      previousScheduledAt: previous.scheduledAt,
      previousNote: previous.note,
      nextScheduledAt,
      nextNote,
      reason: denied.reason,
      sourceCallRecordId: input.sourceCallRecordId,
      status: denied.status,
      message: denied.message
    });
  }
  if (input.cancel) {
    if (!previous.scheduledAt && !previous.note) {
      return successBody({
        result: "unchanged",
        action: "cancel",
        message: "当前没有回拨预约",
        targetType: located.targetType,
        targetId: located.targetId,
        scheduledAt: "",
        note: "",
        previousScheduledAt: "",
        previousNote: "",
        sourceCallRecordId: input.sourceCallRecordId
      });
    }
    const kept = store.callbackSchedules.filter((item) => !(
      item.teamId === user.teamId && item.targetType === located.targetType && item.targetId === located.targetId
    ));
    store.callbackSchedules.splice(0, store.callbackSchedules.length, ...kept);
    const audit = await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "cancel",
      targetType: located.targetType,
      targetId: located.targetId,
      previousScheduledAt: previous.scheduledAt,
      nextScheduledAt: "",
      previousNote: previous.note,
      nextNote: "",
      result: "updated",
      reason: "",
      sourceCallRecordId: input.sourceCallRecordId
    });
    return successBody({
      result: "updated",
      action: "cancel",
      message: "已取消回拨预约",
      targetType: located.targetType,
      targetId: located.targetId,
      scheduledAt: "",
      note: "",
      previousScheduledAt: previous.scheduledAt,
      previousNote: previous.note,
      sourceCallRecordId: input.sourceCallRecordId,
      auditId: audit.id
    });
  }
  if (previous.scheduledAt === input.scheduledAt && previous.note === input.note) {
    return successBody({
      result: "unchanged",
      action,
      message: "回拨预约没有变化",
      targetType: located.targetType,
      targetId: located.targetId,
      scheduledAt: previous.scheduledAt,
      note: previous.note,
      previousScheduledAt: previous.scheduledAt,
      previousNote: previous.note,
      sourceCallRecordId: input.sourceCallRecordId
    });
  }
  const at = outboundInstant().toISOString();
  const existing = findCallbackSchedule(store, user.teamId, located.targetType, located.targetId);
  if (existing) {
    existing.scheduledAt = input.scheduledAt;
    existing.note = input.note;
    existing.updatedBy = user.id;
    existing.updatedAt = at;
    existing.sourceCallRecordId = input.sourceCallRecordId;
  } else {
    const row: CallbackSchedule = {
      id: `cbs_${randomUUID()}`,
      teamId: user.teamId,
      targetType: located.targetType,
      targetId: located.targetId,
      scheduledAt: input.scheduledAt,
      note: input.note,
      updatedBy: user.id,
      updatedAt: at,
      sourceCallRecordId: input.sourceCallRecordId
    };
    store.callbackSchedules.unshift(row);
  }
  const audit = await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action,
    targetType: located.targetType,
    targetId: located.targetId,
    previousScheduledAt: previous.scheduledAt,
    nextScheduledAt: input.scheduledAt,
    previousNote: previous.note,
    nextNote: input.note,
    result: "updated",
    reason: "",
    sourceCallRecordId: input.sourceCallRecordId
  });
  return successBody({
    result: "updated",
    action,
    message: action === "set" ? "已设置回拨预约" : "已修改回拨预约",
    targetType: located.targetType,
    targetId: located.targetId,
    scheduledAt: input.scheduledAt,
    note: input.note,
    previousScheduledAt: previous.scheduledAt,
    previousNote: previous.note,
    sourceCallRecordId: input.sourceCallRecordId,
    auditId: audit.id
  });
}

export async function setCallbackSchedule(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallbackScheduleRequest(body);
  if (!parsed.ok) return reject(parsed.reason, "一次只能为一个对象设置回拨预约");
  return apply(store, user, {
    cancel: false,
    targetType: parsed.targetType,
    targetId: parsed.targetId,
    scheduledAt: parsed.scheduledAt,
    note: parsed.note,
    sourceCallRecordId: ""
  });
}

export async function cancelCallbackSchedule(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallbackCancelRequest(body);
  if (!parsed.ok) return reject(parsed.reason, "一次只能取消一个对象的回拨预约");
  return apply(store, user, {
    cancel: true,
    targetType: parsed.targetType,
    targetId: parsed.targetId,
    sourceCallRecordId: ""
  });
}

export async function scheduleCallbackOnCall(
  store: CrmStore,
  user: SessionUser | undefined,
  callRecordId: string,
  body: unknown
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallCallbackRequest(body);
  if (!parsed.ok) return reject(parsed.reason, "一次只能设置或取消这一条通话关联对象的回拨预约");
  const record = store.outboundCallRecords.find((item) => item.id === callRecordId);
  const sourceCallRecordId = clipId(callRecordId);
  const nextScheduledAt = parsed.cancel ? "" : parsed.scheduledAt;
  const nextNote = parsed.cancel ? "" : parsed.note;
  if (!record || record.teamId !== user.teamId || !isTargetType(record.targetType)) {
    return rejectWithAudit(store, user, {
      action: parsed.cancel ? "cancel" : "set",
      targetType: "",
      targetId: "",
      previousScheduledAt: "",
      previousNote: "",
      nextScheduledAt,
      nextNote,
      reason: "not_found",
      sourceCallRecordId,
      status: 404,
      message: "通话记录不存在"
    });
  }
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  const visible = resolved.ok && outboundCallRecordVisible(record, user.teamId, resolved.access);
  if (!visible) {
    const previous = currentValues(store, user.teamId, record.targetType, record.targetId);
    return rejectWithAudit(store, user, {
      action: parsed.cancel ? "cancel" : previous.scheduledAt ? "update" : "set",
      targetType: record.targetType,
      targetId: record.targetId,
      previousScheduledAt: previous.scheduledAt,
      previousNote: previous.note,
      nextScheduledAt,
      nextNote,
      reason: "forbidden",
      sourceCallRecordId,
      status: 403,
      message: resolved.ok ? "没有操作该记录的权限" : "没有查看通话记录的权限"
    });
  }
  if (parsed.cancel) {
    return apply(store, user, {
      cancel: true,
      targetType: record.targetType,
      targetId: record.targetId,
      sourceCallRecordId
    });
  }
  return apply(store, user, {
    cancel: false,
    targetType: record.targetType,
    targetId: record.targetId,
    scheduledAt: parsed.scheduledAt,
    note: parsed.note,
    sourceCallRecordId
  });
}

export async function listCallbackSchedules(
  store: CrmStore,
  user: SessionUser | undefined,
  query: { due?: unknown; owner?: unknown }
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const due = parseCallbackDueFilter(query.due);
  if (!due) return reject("invalid_request", "回拨筛选只接受今日到期或已逾期");
  const owner = parseOwnerMineFilter(query.owner);
  if (owner === null) return reject("invalid_request", "负责坐席筛选只接受我负责的");
  const timeZone = await tenantTimeZoneFor(store, user.teamId);
  const today = zonedDateKey(outboundInstant(), timeZone);
  const items: Array<{
    targetType: CallbackTargetType;
    targetId: string;
    targetLabel: string;
    name: string;
    scheduledAt: string;
    note: string;
    due: "today" | "overdue";
    ownerAgentId: string;
    ownerAgentLabel: string;
  }> = [];
  for (const row of store.callbackSchedules) {
    if (row.teamId !== user.teamId) continue;
    const kind = callbackScheduleDue(row.scheduledAt, today);
    if (kind !== "today" && kind !== "overdue") continue;
    if (due === "today" && kind !== "today") continue;
    if (due === "overdue" && kind !== "overdue") continue;
    const located = locate(store, user.teamId, row.targetType, row.targetId);
    if (!located.ok) continue;
    if (!await canReadTarget(store, user, located.targetType, located.ownerId)) continue;
    if (owner === "mine" && !userOwnsOutboundTarget(store, user, located.targetType, located.targetId)) continue;
    const ownerView = outboundOwnerView(store, user.teamId, located.targetType, located.targetId);
    items.push({
      targetType: located.targetType,
      targetId: located.targetId,
      targetLabel: callbackTargetLabel(located.targetType),
      name: located.name,
      scheduledAt: row.scheduledAt,
      note: row.note,
      due: kind,
      ownerAgentId: ownerView.ownerAgentId,
      ownerAgentLabel: ownerView.ownerAgentLabel
    });
  }
  items.sort((left, right) => {
    if (left.due !== right.due) return left.due === "overdue" ? -1 : 1;
    if (left.scheduledAt !== right.scheduledAt) return left.scheduledAt < right.scheduledAt ? -1 : 1;
    return left.targetId < right.targetId ? -1 : left.targetId > right.targetId ? 1 : 0;
  });
  return {
    status: 200,
    body: {
      timeZone,
      today,
      due,
      owner,
      empty: items.length === 0,
      items
    }
  };
}
