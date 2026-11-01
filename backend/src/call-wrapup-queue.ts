import { randomUUID } from "node:crypto";
import { outboundInstant, maskOutboundNumber } from "./outbound-call.js";
import {
  outboundCallRecordVisible,
  recordHasCallNote,
  resolveOutboundCallRecordAccess,
  splitAgentIds,
  type OutboundCallRecordAccess
} from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type {
  CallWrapupAudit,
  CallWrapupSkip,
  CallWrapupSkipAudit,
  OutboundCallRecord,
  SessionUser
} from "./types.js";

/**
 * 待小结通话队列。
 * 已结束、当前账号看得到、call_wrapup_audits 没有成功记录、也没有纪要、且没有生效的无需小结，才入队。
 * 按结束时间从新到旧。坐席可以单条标记无需小结，并可以撤销。
 * 主管和管理员可以只读按坐席看还剩多少通。数字只来自本地通话记录。
 * 不拨号，不发信，不推进序列，不调用 AI 或外部接口。
 */

export const CALL_WRAPUP_SKIP_REASONS = [
  { code: "missed", label: "未接通" },
  { code: "wrong_number", label: "打错" },
  { code: "internal", label: "内部通话" },
  { code: "duplicate", label: "重复通话" },
  { code: "other", label: "其他" }
] as const;

export type CallWrapupSkipReason = (typeof CALL_WRAPUP_SKIP_REASONS)[number]["code"];

const REASON_LABEL = new Map(CALL_WRAPUP_SKIP_REASONS.map((item) => [item.code, item.label]));
const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "items", "reasons"] as const;
const RECORD_ID = /^[A-Za-z0-9_-]{1,64}$/;

const TARGET_LABEL: Record<string, string> = {
  customer: "客户",
  lead: "线索",
  prospect: "搜客"
};

export function isCallWrapupSkipReason(value: string): value is CallWrapupSkipReason {
  return REASON_LABEL.has(value as CallWrapupSkipReason);
}

export function callWrapupSkipReasonLabel(reason: string) {
  return REASON_LABEL.get(reason as CallWrapupSkipReason) || "";
}

/** 话单 ReleaseTime。只接受正整数毫秒。解析不了就还没结束，不拿开始时间代替。 */
export function callEndedAtMs(releaseTimeRaw: string) {
  const text = (releaseTimeRaw || "").trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

export function hasSuccessfulCallWrapup(audits: CallWrapupAudit[], teamId: string, callRecordId: string) {
  return audits.some((item) => item.teamId === teamId && item.callRecordId === callRecordId && item.result === "updated");
}

/** 不足一分钟按秒，之后只取整到分钟、小时或天。刚好 60 秒是 1 分钟。 */
export function formatEndedAgo(seconds: number) {
  if (!Number.isSafeInteger(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时`;
  return `${Math.floor(seconds / 86400)}天`;
}

export function endedAgoSeconds(endedAtMs: number, nowMs: number) {
  if (!Number.isSafeInteger(endedAtMs) || !Number.isFinite(nowMs)) return 0;
  const delta = Math.floor((nowMs - endedAtMs) / 1000);
  if (!Number.isSafeInteger(delta) || delta < 0) return 0;
  return delta;
}

/** 已经脱敏的值原样留下。超过 4 位数字的再遮一次，避免把完整号码送回页面。 */
export function displayMaskedNumber(value: string) {
  const digits = (value || "").replace(/\D/g, "");
  if (digits.length > 4) return maskOutboundNumber(value);
  return value || "";
}

export function canViewCallWrapupCounts(user: { role?: string } | undefined) {
  return user?.role === "manager" || user?.role === "admin" || user?.role === "super_admin";
}

export interface CallWrapupQueueItem {
  callRecordId: string;
  targetType: "customer" | "lead" | "prospect" | "";
  targetId: string;
  targetLabel: string;
  name: string;
  maskedNumber: string;
  endedAt: string;
  endedAgoSeconds: number;
  endedAgoLabel: string;
  agentIds: string[];
  agentLabel: string;
}

export interface CallWrapupSkippedItem extends CallWrapupQueueItem {
  reason: CallWrapupSkipReason;
  reasonLabel: string;
}

export interface CallWrapupCountRow {
  agentId: string;
  agentLabel: string;
  pendingCount: number;
}

function targetKey(targetType: string, targetId: string) {
  return `${targetType}:${targetId}`;
}

function compareQueue(left: CallWrapupQueueItem, right: CallWrapupQueueItem) {
  if (left.endedAt !== right.endedAt) return left.endedAt < right.endedAt ? 1 : -1;
  return left.callRecordId < right.callRecordId ? 1 : left.callRecordId > right.callRecordId ? -1 : 0;
}

export function buildCallWrapupQueue(input: {
  teamId: string;
  nowMs: number;
  records: OutboundCallRecord[];
  wrapupAudits: CallWrapupAudit[];
  skips: CallWrapupSkip[];
  names: Map<string, string>;
  visible: (record: OutboundCallRecord) => boolean;
  labels: Map<string, string>;
}) {
  const activeSkip = new Map<string, CallWrapupSkip>();
  for (const skip of input.skips) {
    if (skip.teamId !== input.teamId || !skip.active || !skip.callRecordId) continue;
    if (!activeSkip.has(skip.callRecordId)) activeSkip.set(skip.callRecordId, skip);
  }
  const items: CallWrapupQueueItem[] = [];
  const skipped: CallWrapupSkippedItem[] = [];
  for (const record of input.records) {
    if (record.teamId !== input.teamId || !input.visible(record)) continue;
    const endedMs = callEndedAtMs(record.releaseTimeRaw);
    if (endedMs === null) continue;
    if (recordHasCallNote(record)) continue;
    if (hasSuccessfulCallWrapup(input.wrapupAudits, input.teamId, record.id)) continue;
    const targetType = record.targetType === "customer" || record.targetType === "lead" || record.targetType === "prospect"
      ? record.targetType
      : "";
    const agentIds = splitAgentIds(record.agentIds);
    const ago = endedAgoSeconds(endedMs, input.nowMs);
    const row: CallWrapupQueueItem = {
      callRecordId: record.id,
      targetType,
      targetId: targetType ? record.targetId || "" : "",
      targetLabel: targetType ? TARGET_LABEL[targetType] : "未关联",
      name: targetType ? input.names.get(targetKey(targetType, record.targetId)) || "" : "",
      maskedNumber: displayMaskedNumber(record.maskedNumber),
      endedAt: new Date(endedMs).toISOString(),
      endedAgoSeconds: ago,
      endedAgoLabel: formatEndedAgo(ago),
      agentIds,
      agentLabel: agentIds.map((id) => input.labels.get(id) || id).join("、")
    };
    const skip = activeSkip.get(record.id);
    if (skip && isCallWrapupSkipReason(skip.reason)) {
      skipped.push({ ...row, reason: skip.reason, reasonLabel: callWrapupSkipReasonLabel(skip.reason) });
    } else {
      items.push(row);
    }
  }
  items.sort(compareQueue);
  skipped.sort(compareQueue);
  return { items, skipped };
}

export function countPendingWrapupsByAgent(input: {
  items: Array<Pick<CallWrapupQueueItem, "agentIds">>;
  mappings: Array<{ teamId: string; cccUserId: string }>;
  teamId: string;
  allowed: ReadonlySet<string>;
  tenantWide: boolean;
  labels: Map<string, string>;
}): CallWrapupCountRow[] {
  const counts = new Map<string, number>();
  for (const mapping of input.mappings) {
    if (mapping.teamId !== input.teamId || !mapping.cccUserId) continue;
    if (!input.tenantWide && !input.allowed.has(mapping.cccUserId)) continue;
    if (!counts.has(mapping.cccUserId)) counts.set(mapping.cccUserId, 0);
  }
  let unassigned = 0;
  for (const item of input.items) {
    if (!item.agentIds.length) {
      unassigned += 1;
      continue;
    }
    const seen = new Set<string>();
    for (const agentId of item.agentIds) {
      if (!agentId || seen.has(agentId)) continue;
      seen.add(agentId);
      counts.set(agentId, (counts.get(agentId) || 0) + 1);
    }
  }
  const rows = [...counts.entries()].map(([agentId, pendingCount]) => ({
    agentId,
    agentLabel: input.labels.get(agentId) || agentId,
    pendingCount
  })).sort((left, right) => left.agentLabel.localeCompare(right.agentLabel, "zh") || left.agentId.localeCompare(right.agentId));
  if (unassigned > 0) rows.push({ agentId: "", agentLabel: "未分配坐席", pendingCount: unassigned });
  return rows;
}

function namesFor(store: CrmStore, teamId: string) {
  const names = new Map<string, string>();
  for (const customer of store.customers) {
    if (customer.teamId === teamId) names.set(targetKey("customer", customer.id), customer.company || "");
  }
  for (const lead of store.leads) {
    if (lead.teamId === teamId && !lead.deletedAt) names.set(targetKey("lead", lead.id), lead.company || "");
  }
  for (const prospect of store.websiteOpportunities) {
    if (prospect.teamId === teamId) names.set(targetKey("prospect", prospect.id), prospect.company || "");
  }
  return names;
}

function queueFromStore(store: CrmStore, user: SessionUser, access: OutboundCallRecordAccess, nowMs: number) {
  return buildCallWrapupQueue({
    teamId: user.teamId,
    nowMs,
    records: store.outboundCallRecords,
    wrapupAudits: store.callWrapupAudits,
    skips: store.callWrapupSkips,
    names: namesFor(store, user.teamId),
    visible: (record) => outboundCallRecordVisible(record, user.teamId, access),
    labels: access.labels
  });
}

function reject(status: number, reason: string, message: string) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function clipId(value: string) {
  return value.slice(0, 64);
}

async function writeAudit(store: CrmStore, input: Omit<CallWrapupSkipAudit, "id" | "at">) {
  const audit: CallWrapupSkipAudit = {
    id: `cwsa_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.callWrapupSkipAudits.unshift(audit);
  await store.persist();
  return audit;
}

async function requireAccess(store: CrmStore, user: SessionUser | undefined, action: CallWrapupSkipAudit["action"], callRecordId = "") {
  if (!user?.id || !user.teamId) return { ok: false as const, status: 401, body: { message: "未登录" } };
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      callRecordId,
      action,
      reason: "forbidden",
      result: "rejected"
    });
    return {
      ok: false as const,
      status: 403,
      body: {
        result: "rejected" as const,
        reason: "forbidden",
        message: "没有查看通话记录的权限",
        ...(resolved.body.permissionCode ? { permissionCode: resolved.body.permissionCode } : {})
      }
    };
  }
  return { ok: true as const, user, access: resolved.access };
}

function noQuery(query: Record<string, unknown>) {
  return Object.keys(query).length === 0;
}

export async function listCallWrapupQueue(
  store: CrmStore,
  user: SessionUser | undefined,
  query: Record<string, unknown> = {}
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  if (!noQuery(query)) return reject(400, "invalid_request", "待小结队列不接受查询参数");
  const resolved = await requireAccess(store, user, "read");
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const nowMs = outboundInstant().getTime();
  const queue = queueFromStore(store, resolved.user, resolved.access, nowMs);
  return {
    status: 200,
    body: {
      scope: resolved.access.teamScope ? "team" as const : "self" as const,
      canViewCounts: canViewCallWrapupCounts(resolved.user),
      empty: queue.items.length === 0,
      items: queue.items,
      skipped: queue.skipped,
      reasons: CALL_WRAPUP_SKIP_REASONS.map((item) => ({ code: item.code, label: item.label }))
    }
  };
}

export async function listCallWrapupCounts(
  store: CrmStore,
  user: SessionUser | undefined,
  query: Record<string, unknown> = {}
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  if (!noQuery(query)) return reject(400, "invalid_request", "待小结计数不接受查询参数");
  if (!canViewCallWrapupCounts(user)) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      callRecordId: "",
      action: "read",
      reason: "forbidden",
      result: "rejected"
    });
    return reject(403, "forbidden", "只有主管和管理员可以查看待小结计数");
  }
  const resolved = await requireAccess(store, user, "read");
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const nowMs = outboundInstant().getTime();
  const queue = queueFromStore(store, resolved.user, resolved.access, nowMs);
  const rows = countPendingWrapupsByAgent({
    items: queue.items,
    mappings: store.aliyunAgentMappings,
    teamId: resolved.user.teamId,
    allowed: resolved.access.allowed,
    tenantWide: resolved.access.tenantWide,
    labels: resolved.access.labels
  });
  const pendingTotal = queue.items.length;
  return {
    status: 200,
    body: {
      empty: pendingTotal === 0,
      pendingTotal,
      rows
    }
  };
}

function parseSkipBody(body: unknown):
  | { ok: true; reason: CallWrapupSkipReason }
  | { ok: false } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false };
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return { ok: false };
  if (Object.keys(record).some((key) => key !== "reason")) return { ok: false };
  if (typeof record.reason !== "string" || !isCallWrapupSkipReason(record.reason)) return { ok: false };
  return { ok: true, reason: record.reason };
}

function parseRestoreBody(body: unknown) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return false;
  return Object.keys(record).length === 0;
}

function findSkip(store: CrmStore, teamId: string, callRecordId: string) {
  const rows = store.callWrapupSkips.filter((item) => item.teamId === teamId && item.callRecordId === callRecordId);
  return rows.find((item) => item.active) || rows[0];
}

function pendingRecord(store: CrmStore, teamId: string, record: OutboundCallRecord) {
  if (callEndedAtMs(record.releaseTimeRaw) === null) return false;
  if (recordHasCallNote(record)) return false;
  if (hasSuccessfulCallWrapup(store.callWrapupAudits, teamId, record.id)) return false;
  return true;
}

async function visibleRecord(
  store: CrmStore,
  user: SessionUser,
  access: OutboundCallRecordAccess,
  callRecordId: string,
  action: "skip" | "restore"
) {
  const local = store.outboundCallRecords.find((item) => item.id === callRecordId && item.teamId === user.teamId);
  if (!local || !outboundCallRecordVisible(local, user.teamId, access)) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      callRecordId,
      action,
      reason: "forbidden",
      result: "rejected"
    });
    return null;
  }
  return local;
}

export async function skipCallWrapup(
  store: CrmStore,
  user: SessionUser | undefined,
  callRecordId: string,
  body: unknown,
  query: Record<string, unknown> = {}
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  if (!noQuery(query)) return reject(400, "invalid_request", "一次只能标记一条通话无需小结");
  const parsed = parseSkipBody(body);
  if (!parsed.ok) return reject(400, "invalid_request", "请选择无需小结的原因");
  if (!RECORD_ID.test(callRecordId)) return reject(400, "invalid_request", "一次只能标记一条通话无需小结");
  const resolved = await requireAccess(store, user, "skip", clipId(callRecordId));
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const local = await visibleRecord(store, resolved.user, resolved.access, callRecordId, "skip");
  if (!local) return reject(403, "forbidden", "没有操作这条通话记录的权限");
  if (!pendingRecord(store, resolved.user.teamId, local)) {
    return reject(400, "not_pending", "这通电话不用再标记无需小结");
  }
  const existing = findSkip(store, resolved.user.teamId, local.id);
  if (existing?.active && existing.reason === parsed.reason) {
    return {
      status: 200,
      body: { result: "unchanged" as const, message: "这通电话已经标记为无需小结", callRecordId: local.id, reason: existing.reason }
    };
  }
  const at = outboundInstant().toISOString();
  if (existing) {
    existing.actorId = resolved.user.id;
    existing.at = at;
    existing.reason = parsed.reason;
    existing.active = true;
  } else {
    store.callWrapupSkips.unshift({
      id: `cws_${randomUUID()}`,
      teamId: resolved.user.teamId,
      actorId: resolved.user.id,
      at,
      callRecordId: local.id,
      reason: parsed.reason,
      active: true
    });
  }
  const audit = await writeAudit(store, {
    teamId: resolved.user.teamId,
    actorId: resolved.user.id,
    callRecordId: local.id,
    action: "skip",
    reason: parsed.reason,
    result: "skipped"
  });
  return {
    status: 200,
    body: {
      result: "skipped" as const,
      message: "已标记无需小结",
      callRecordId: local.id,
      reason: parsed.reason,
      reasonLabel: callWrapupSkipReasonLabel(parsed.reason),
      auditId: audit.id
    }
  };
}

export async function restoreCallWrapup(
  store: CrmStore,
  user: SessionUser | undefined,
  callRecordId: string,
  body: unknown,
  query: Record<string, unknown> = {}
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  if (!noQuery(query)) return reject(400, "invalid_request", "一次只能撤销一条无需小结");
  if (!parseRestoreBody(body)) return reject(400, "invalid_request", "一次只能撤销一条无需小结");
  if (!RECORD_ID.test(callRecordId)) return reject(400, "invalid_request", "一次只能撤销一条无需小结");
  const resolved = await requireAccess(store, user, "restore", clipId(callRecordId));
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const local = await visibleRecord(store, resolved.user, resolved.access, callRecordId, "restore");
  if (!local) return reject(403, "forbidden", "没有操作这条通话记录的权限");
  const existing = findSkip(store, resolved.user.teamId, local.id);
  if (!existing?.active) {
    return {
      status: 200,
      body: { result: "unchanged" as const, message: "这通电话没有待撤销的无需小结", callRecordId: local.id }
    };
  }
  const reason = existing.reason;
  existing.active = false;
  existing.actorId = resolved.user.id;
  existing.at = outboundInstant().toISOString();
  const audit = await writeAudit(store, {
    teamId: resolved.user.teamId,
    actorId: resolved.user.id,
    callRecordId: local.id,
    action: "restore",
    reason,
    result: "restored"
  });
  return {
    status: 200,
    body: {
      result: "restored" as const,
      message: "已撤销无需小结",
      callRecordId: local.id,
      reason,
      auditId: audit.id
    }
  };
}
