import { randomUUID } from "node:crypto";
import { hasIamPermission } from "./auth.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import { OUTBOUND_CALL_PERMISSION, outboundHoldUntil, outboundInstant, tenantTimeZoneFor, zonedDateKey } from "./outbound-call.js";
import { resolveOutboundCallRecordAccess } from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type { OutboundCallHold, OutboundCallHoldAudit, SessionUser } from "./types.js";

/**
 * 暂停外呼直到指定日。
 * 坐席或主管给一个客户、线索或搜客对象写下恢复拨打的当地日。
 * 到这一天之前，一键外呼和工作台拨出在原有门禁和今日不再拨之后返回 held_until，不调用拨号器。
 * 当前值在 outbound_call_holds，一行一个对象。查看、设置和撤销写入 outbound_call_hold_audits。
 * 不拨号，不发信，不调用外部接口，不碰抑制或合规。
 */

export const OUTBOUND_HOLD_REASONS = ["asked_later", "other_channel", "colleague", "other"] as const;
export type OutboundHoldReason = (typeof OUTBOUND_HOLD_REASONS)[number];
export type OutboundHoldTargetType = "customer" | "lead" | "prospect";
export const OUTBOUND_HOLD_MAX_DAYS = 30;

const REASON_LABEL: Record<OutboundHoldReason, string> = {
  asked_later: "约了以后再联系",
  other_channel: "先走别的渠道",
  colleague: "同事正在跟",
  other: "其他"
};

const TARGET_LABEL: Record<OutboundHoldTargetType, string> = {
  customer: "客户",
  lead: "线索",
  prospect: "搜客"
};

const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes", "phones", "phoneIds", "calls"] as const;
const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const NOTE_MAX = 200;
const READ_PERMISSION: Record<OutboundHoldTargetType, string> = {
  customer: "customer.read",
  lead: "lead.read",
  prospect: "prospect.read"
};

export function canViewTeamOutboundCallHold(user: { role?: string } | undefined) {
  return user?.role === "manager" || user?.role === "admin" || user?.role === "super_admin";
}

export function outboundHoldReasonLabel(reason: string) {
  return REASON_LABEL[reason as OutboundHoldReason] || "";
}

export function isCalendarDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

export function addCalendarDays(dateKey: string, days: number) {
  if (!isCalendarDateKey(dateKey) || !Number.isInteger(days)) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return "";
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  utc.setUTCDate(utc.getUTCDate() + days);
  const year = utc.getUTCFullYear();
  const month = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const day = String(utc.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function textLength(value: string) {
  return Array.from(value).length;
}

function isReason(value: string): value is OutboundHoldReason {
  return (OUTBOUND_HOLD_REASONS as readonly string[]).includes(value);
}

function isTargetType(value: string): value is OutboundHoldTargetType {
  return value === "customer" || value === "lead" || value === "prospect";
}

function oneQuery(value: unknown) {
  if (Array.isArray(value)) return null;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value.trim() : null;
}

export function parseOutboundCallHoldQuery(query: Record<string, unknown>): { scope: "mine" | "team" } | null {
  const allowed = new Set(["scope"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) return null;
  if (Object.values(query).some((value) => Array.isArray(value))) return null;
  const scope = oneQuery(query.scope);
  if (scope !== "mine" && scope !== "team") return null;
  return { scope };
}

function parseTargetBody(body: unknown, allowHold: boolean):
  | { ok: true; targetType: OutboundHoldTargetType; targetId: string; untilOn: string; reason: OutboundHoldReason; note: string }
  | { ok: false; reason: "invalid_request" | "note_too_long" | "until_invalid" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return { ok: false, reason: "invalid_request" };
  const allowed = new Set(allowHold ? ["targetType", "targetId", "untilOn", "reason", "note"] : ["targetType", "targetId"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return { ok: false, reason: "invalid_request" };
  if (typeof record.targetType !== "string" || !isTargetType(record.targetType.trim())) return { ok: false, reason: "invalid_request" };
  if (typeof record.targetId !== "string" || !TARGET_ID_PATTERN.test(record.targetId.trim())) return { ok: false, reason: "invalid_request" };
  if (!allowHold) {
    return { ok: true, targetType: record.targetType.trim() as OutboundHoldTargetType, targetId: record.targetId.trim(), untilOn: "", reason: "other", note: "" };
  }
  if (typeof record.untilOn !== "string" || !isCalendarDateKey(record.untilOn.trim())) return { ok: false, reason: "until_invalid" };
  if (typeof record.reason !== "string" || !isReason(record.reason.trim())) return { ok: false, reason: "invalid_request" };
  const rawNote = record.note;
  if (rawNote !== undefined && rawNote !== null && typeof rawNote !== "string") return { ok: false, reason: "invalid_request" };
  const note = typeof rawNote === "string" ? rawNote.trim() : "";
  if (textLength(note) > NOTE_MAX) return { ok: false, reason: "note_too_long" };
  return {
    ok: true,
    targetType: record.targetType.trim() as OutboundHoldTargetType,
    targetId: record.targetId.trim(),
    untilOn: record.untilOn.trim(),
    reason: record.reason.trim() as OutboundHoldReason,
    note
  };
}

export function parseOutboundCallHoldSet(body: unknown) {
  return parseTargetBody(body, true);
}

export function parseOutboundCallHoldClear(body: unknown) {
  const parsed = parseTargetBody(body, false);
  if (!parsed.ok) return parsed;
  return { ok: true as const, targetType: parsed.targetType, targetId: parsed.targetId };
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function setRejectMessage(reason: "invalid_request" | "note_too_long" | "until_invalid" | "until_not_future" | "until_too_far") {
  if (reason === "note_too_long") return "备注不能超过 200 字";
  if (reason === "until_invalid") return "暂停日必须是合法的日期";
  if (reason === "until_not_future") return "暂停日必须晚于租户当地今天";
  if (reason === "until_too_far") return "暂停日不能晚于当地今天之后的 30 天";
  return "一次只能为一个对象记下暂停外呼";
}

function holds(store: CrmStore) {
  if (!store.outboundCallHolds) store.outboundCallHolds = [];
  return store.outboundCallHolds;
}

async function writeAudit(store: CrmStore, input: Omit<OutboundCallHoldAudit, "id" | "at">) {
  const audit: OutboundCallHoldAudit = {
    id: `ocha_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input,
    note: input.result === "rejected" ? "" : input.note
  };
  if (!store.outboundCallHoldAudits) store.outboundCallHoldAudits = [];
  store.outboundCallHoldAudits.unshift(audit);
  await store.persist();
  return audit;
}

async function todayKey(store: CrmStore, teamId: string) {
  return zonedDateKey(outboundInstant(), await tenantTimeZoneFor(store, teamId));
}

async function canSendToOwner(store: CrmStore, user: SessionUser, ownerId: string, teamId: string) {
  if (!hasIamPermission(user, OUTBOUND_CALL_PERMISSION)) return false;
  if (store.resolveIamDataScope) {
    const scope = await store.resolveIamDataScope(user, OUTBOUND_CALL_PERMISSION);
    return teamId === user.teamId && (scope.tenantWide || scope.ownerIds.includes(ownerId));
  }
  const scopes = user.iamPermissions?.[OUTBOUND_CALL_PERMISSION] || [];
  if (scopes.includes("tenant")) return teamId === user.teamId;
  const organizationWide = scopes.includes("org_unit") || scopes.includes("org_subtree");
  const ownerIds = organizationWide
    ? store.users.filter((item) => item.teamId === user.teamId && item.status === "active").map((item) => item.id)
    : scopes.includes("self") ? [user.id] : [];
  return teamId === user.teamId && ownerIds.includes(ownerId);
}

async function canReadOwner(store: CrmStore, user: SessionUser, permission: string, ownerId: string, teamId: string) {
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

interface LocatedObject {
  ok: true;
  targetType: OutboundHoldTargetType;
  targetId: string;
  name: string;
  ownerId: string;
}

function locateObject(store: CrmStore, user: SessionUser, targetType: OutboundHoldTargetType, targetId: string):
  | LocatedObject
  | { ok: false; status: number; reason: string; message: string } {
  if (targetType === "customer") {
    const customer = store.customers.find((item) => item.id === targetId);
    if (!customer || customer.teamId !== user.teamId) {
      return { ok: false, status: 404, reason: "not_found", message: "外呼对象不存在" };
    }
    if (isPublicCustomer(customer)) {
      return { ok: false, status: 403, reason: "forbidden", message: "公池客户不能暂停外呼" };
    }
    return { ok: true, targetType, targetId, name: customer.company || targetId, ownerId: customer.ownerId };
  }
  if (targetType === "lead") {
    const lead = store.leads.find((item) => item.id === targetId && item.teamId === user.teamId && !item.deletedAt);
    if (!lead) return { ok: false, status: 404, reason: "not_found", message: "外呼对象不存在" };
    return { ok: true, targetType, targetId, name: lead.company || targetId, ownerId: lead.ownerId };
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === targetId && item.teamId === user.teamId);
  if (!candidate) return { ok: false, status: 404, reason: "not_found", message: "外呼对象不存在" };
  return { ok: true, targetType, targetId, name: candidate.company || targetId, ownerId: candidate.ownerId };
}

function actorLabel(store: CrmStore, teamId: string, actorId: string) {
  const user = store.users.find((item) => item.id === actorId && item.teamId === teamId);
  return user?.name || actorId;
}

interface ListedHold {
  targetType: OutboundHoldTargetType;
  targetId: string;
  targetLabel: string;
  name: string;
  reason: OutboundHoldReason;
  reasonLabel: string;
  note: string;
  untilOn: string;
  actorId: string;
  actorLabel: string;
  updatedAt: string;
}

async function listRows(store: CrmStore, user: SessionUser, scope: "mine" | "team", dateKey: string) {
  const rows: ListedHold[] = [];
  for (const item of holds(store)) {
    if (item.teamId !== user.teamId || !item.active || !(item.untilOn > dateKey)) continue;
    if (!isTargetType(item.targetType) || !isReason(item.reason)) continue;
    const located = locateObject(store, user, item.targetType, item.targetId);
    if (!located.ok) continue;
    if (scope === "mine" && located.ownerId !== user.id) continue;
    if (!await canReadOwner(store, user, READ_PERMISSION[item.targetType], located.ownerId, user.teamId)) continue;
    rows.push({
      targetType: item.targetType,
      targetId: item.targetId,
      targetLabel: TARGET_LABEL[item.targetType],
      name: located.name,
      reason: item.reason,
      reasonLabel: REASON_LABEL[item.reason],
      note: item.note || "",
      untilOn: item.untilOn,
      actorId: item.actorId,
      actorLabel: actorLabel(store, user.teamId, item.actorId),
      updatedAt: item.updatedAt || ""
    });
  }
  rows.sort((left, right) => {
    if (left.untilOn !== right.untilOn) return left.untilOn < right.untilOn ? -1 : 1;
    if (left.updatedAt !== right.updatedAt) {
      if (!left.updatedAt) return 1;
      if (!right.updatedAt) return -1;
      return left.updatedAt < right.updatedAt ? 1 : -1;
    }
    return left.targetId < right.targetId ? -1 : left.targetId > right.targetId ? 1 : 0;
  });
  return rows;
}

export async function listOutboundCallHolds(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseOutboundCallHoldQuery(query);
  if (!parsed) return reject("invalid_request", "暂停外呼只接受我的或团队");
  if (parsed.scope === "team" && !canViewTeamOutboundCallHold(user)) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "read",
      scope: "team",
      targetType: "",
      targetId: "",
      untilOn: "",
      holdReason: "",
      note: "",
      rowCount: 0,
      result: "rejected",
      reason: "forbidden"
    });
    return reject("forbidden", "没有查看团队暂停外呼的权限", 403);
  }
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const dateKey = await todayKey(store, user.teamId);
  const items = await listRows(store, user, parsed.scope, dateKey);
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "read",
    scope: parsed.scope,
    targetType: "",
    targetId: "",
    untilOn: "",
    holdReason: "",
    note: "",
    rowCount: items.length,
    result: "read",
    reason: ""
  });
  return { status: 200, body: { scope: parsed.scope, empty: items.length === 0, items } };
}

async function guardTarget(store: CrmStore, user: SessionUser, action: "set" | "clear", targetType: OutboundHoldTargetType, targetId: string) {
  if (!hasIamPermission(user, OUTBOUND_CALL_PERMISSION)) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action,
      scope: "",
      targetType,
      targetId,
      untilOn: "",
      holdReason: "",
      note: "",
      rowCount: 0,
      result: "rejected",
      reason: "forbidden"
    });
    return { ok: false as const, outcome: reject("forbidden", "没有外呼权限", 403) };
  }
  const located = locateObject(store, user, targetType, targetId);
  if (!located.ok) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action,
      scope: "",
      targetType: located.status === 404 ? "" : targetType,
      targetId: located.status === 404 ? "" : targetId,
      untilOn: "",
      holdReason: "",
      note: "",
      rowCount: 0,
      result: "rejected",
      reason: located.reason
    });
    return { ok: false as const, outcome: reject(located.reason, located.message, located.status) };
  }
  if (!await canSendToOwner(store, user, located.ownerId, user.teamId)) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action,
      scope: "",
      targetType,
      targetId,
      untilOn: "",
      holdReason: "",
      note: "",
      rowCount: 0,
      result: "rejected",
      reason: "forbidden"
    });
    return { ok: false as const, outcome: reject("forbidden", "外呼对象不在当前账号的租户或归属范围内", 403) };
  }
  return { ok: true as const, located };
}

export async function setOutboundCallHold(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseOutboundCallHoldSet(body);
  if (!parsed.ok) return reject("invalid_request", setRejectMessage(parsed.reason));
  const dateKey = await todayKey(store, user.teamId);
  const latest = addCalendarDays(dateKey, OUTBOUND_HOLD_MAX_DAYS);
  if (parsed.untilOn <= dateKey) return reject("invalid_request", setRejectMessage("until_not_future"));
  if (!latest || parsed.untilOn > latest) return reject("invalid_request", setRejectMessage("until_too_far"));
  const guarded = await guardTarget(store, user, "set", parsed.targetType, parsed.targetId);
  if (!guarded.ok) return guarded.outcome;
  const matches = holds(store).filter((item) =>
    item.teamId === user.teamId && item.targetType === parsed.targetType && item.targetId === parsed.targetId
  );
  const current = matches[0];
  if (
    current
    && current.active
    && current.untilOn === parsed.untilOn
    && current.reason === parsed.reason
    && (current.note || "") === parsed.note
    && current.untilOn > dateKey
    && matches.every((item) => item === current || !item.active)
  ) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: "这次暂停没有变化",
        targetType: parsed.targetType,
        targetId: parsed.targetId,
        untilOn: parsed.untilOn
      }
    };
  }
  const now = outboundInstant().toISOString();
  if (current) {
    current.untilOn = parsed.untilOn;
    current.reason = parsed.reason;
    current.note = parsed.note;
    current.active = true;
    current.actorId = user.id;
    current.updatedAt = now;
    for (const extra of matches.slice(1)) extra.active = false;
  } else {
    const created: OutboundCallHold = {
      id: `och_${randomUUID()}`,
      teamId: user.teamId,
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      untilOn: parsed.untilOn,
      reason: parsed.reason,
      note: parsed.note,
      active: true,
      actorId: user.id,
      updatedAt: now
    };
    holds(store).unshift(created);
  }
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "set",
    scope: "",
    targetType: parsed.targetType,
    targetId: parsed.targetId,
    untilOn: parsed.untilOn,
    holdReason: parsed.reason,
    note: parsed.note,
    rowCount: 0,
    result: "updated",
    reason: ""
  });
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message: `已记下暂停外呼，要到 ${parsed.untilOn} 才可再拨`,
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      untilOn: parsed.untilOn,
      reason: parsed.reason,
      reasonLabel: REASON_LABEL[parsed.reason]
    }
  };
}

export async function clearOutboundCallHold(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseOutboundCallHoldClear(body);
  if (!parsed.ok) return reject("invalid_request", "一次只能撤销一个对象的暂停外呼");
  const guarded = await guardTarget(store, user, "clear", parsed.targetType, parsed.targetId);
  if (!guarded.ok) return guarded.outcome;
  const dateKey = await todayKey(store, user.teamId);
  const active = holds(store).filter((item) =>
    item.teamId === user.teamId
    && item.targetType === parsed.targetType
    && item.targetId === parsed.targetId
    && item.active
    && item.untilOn > dateKey
  );
  if (!active.length) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: "现在没有需要撤销的暂停",
        targetType: parsed.targetType,
        targetId: parsed.targetId
      }
    };
  }
  for (const item of active) item.active = false;
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "clear",
    scope: "",
    targetType: parsed.targetType,
    targetId: parsed.targetId,
    untilOn: active[0].untilOn,
    holdReason: active[0].reason,
    note: active[0].note || "",
    rowCount: 0,
    result: "updated",
    reason: ""
  });
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message: "已撤销暂停外呼",
      targetType: parsed.targetType,
      targetId: parsed.targetId
    }
  };
}

export async function outboundHoldBlocks(store: CrmStore, teamId: string, targetType: string, targetId: string) {
  const dateKey = await todayKey(store, teamId);
  return outboundHoldUntil(store, teamId, targetType, targetId, dateKey);
}
