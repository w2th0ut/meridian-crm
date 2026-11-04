import { randomUUID } from "node:crypto";
import { hasIamPermission } from "./auth.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import { OUTBOUND_CALL_PERMISSION, addCalendarDays, isCalendarDateKey, outboundInstant, sameDaySkipActive, tenantTimeZoneFor, zonedDateKey } from "./outbound-call.js";
import { resolveOutboundCallRecordAccess } from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type { SameDayCallSkip, SameDayCallSkipAudit, SessionUser } from "./types.js";

/**
 * 同一对象今日不再拨。
 * 坐席或主管把一个客户、线索或搜客对象标成租户当地今天不再人工外呼。
 * 恢复日为空或等于当地明天时，只挡今天。更晚的恢复日最远 30 天，到这一天之前返回 skipped_today，不调用拨号器。
 * 当前值在 same_day_call_skips，一行一个对象。查看、设置和撤销写入 same_day_call_skip_audits。
 * 不拨号，不发信，不调用外部接口，不碰抑制或合规。
 */

export const SAME_DAY_SKIP_REASONS = ["reached", "asked_later", "wrong_time", "other"] as const;
export type SameDaySkipReason = (typeof SAME_DAY_SKIP_REASONS)[number];
export type SameDaySkipTargetType = "customer" | "lead" | "prospect";

const REASON_LABEL: Record<SameDaySkipReason, string> = {
  reached: "今天已经联系上",
  asked_later: "对方要求改日再打",
  wrong_time: "现在不方便",
  other: "其他"
};

const TARGET_LABEL: Record<SameDaySkipTargetType, string> = {
  customer: "客户",
  lead: "线索",
  prospect: "搜客"
};

const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes", "phones", "phoneIds", "calls"] as const;
const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const NOTE_MAX = 200;
const READ_PERMISSION: Record<SameDaySkipTargetType, string> = {
  customer: "customer.read",
  lead: "lead.read",
  prospect: "prospect.read"
};

export function canViewTeamSameDayCallSkip(user: { role?: string } | undefined) {
  return user?.role === "manager" || user?.role === "admin" || user?.role === "super_admin";
}

export function sameDaySkipReasonLabel(reason: string) {
  return REASON_LABEL[reason as SameDaySkipReason] || "";
}

function textLength(value: string) {
  return Array.from(value).length;
}

function isReason(value: string): value is SameDaySkipReason {
  return (SAME_DAY_SKIP_REASONS as readonly string[]).includes(value);
}

function isTargetType(value: string): value is SameDaySkipTargetType {
  return value === "customer" || value === "lead" || value === "prospect";
}

function oneQuery(value: unknown) {
  if (Array.isArray(value)) return null;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value.trim() : null;
}

export function parseSameDayCallSkipQuery(query: Record<string, unknown>): { scope: "mine" | "team" } | null {
  const allowed = new Set(["scope"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) return null;
  if (Object.values(query).some((value) => Array.isArray(value))) return null;
  const scope = oneQuery(query.scope);
  if (scope !== "mine" && scope !== "team") return null;
  return { scope };
}

function parseTargetBody(body: unknown, allowNote: boolean):
  | { ok: true; targetType: SameDaySkipTargetType; targetId: string; reason: SameDaySkipReason; note: string; resumeOn: string }
  | { ok: false; reason: "invalid_request" | "note_too_long" | "resume_invalid" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return { ok: false, reason: "invalid_request" };
  const allowed = new Set(allowNote ? ["targetType", "targetId", "reason", "note", "resumeOn"] : ["targetType", "targetId"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return { ok: false, reason: "invalid_request" };
  if (typeof record.targetType !== "string" || !isTargetType(record.targetType.trim())) return { ok: false, reason: "invalid_request" };
  if (typeof record.targetId !== "string" || !TARGET_ID_PATTERN.test(record.targetId.trim())) return { ok: false, reason: "invalid_request" };
  if (!allowNote) {
    return { ok: true, targetType: record.targetType.trim() as SameDaySkipTargetType, targetId: record.targetId.trim(), reason: "other", note: "", resumeOn: "" };
  }
  if (typeof record.reason !== "string" || !isReason(record.reason.trim())) return { ok: false, reason: "invalid_request" };
  const rawNote = record.note;
  if (rawNote !== undefined && rawNote !== null && typeof rawNote !== "string") return { ok: false, reason: "invalid_request" };
  const note = typeof rawNote === "string" ? rawNote.trim() : "";
  if (textLength(note) > NOTE_MAX) return { ok: false, reason: "note_too_long" };
  let resumeOn = "";
  if (record.resumeOn !== undefined && record.resumeOn !== null) {
    if (typeof record.resumeOn !== "string") return { ok: false, reason: "invalid_request" };
    resumeOn = record.resumeOn.trim();
    if (resumeOn && !isCalendarDateKey(resumeOn)) return { ok: false, reason: "resume_invalid" };
  }
  return {
    ok: true,
    targetType: record.targetType.trim() as SameDaySkipTargetType,
    targetId: record.targetId.trim(),
    reason: record.reason.trim() as SameDaySkipReason,
    note,
    resumeOn
  };
}

export function parseSameDayCallSkipSet(body: unknown) {
  return parseTargetBody(body, true);
}

export function parseSameDayCallSkipClear(body: unknown) {
  const parsed = parseTargetBody(body, false);
  if (!parsed.ok) return parsed;
  return { ok: true as const, targetType: parsed.targetType, targetId: parsed.targetId };
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function skips(store: CrmStore) {
  if (!store.sameDayCallSkips) store.sameDayCallSkips = [];
  return store.sameDayCallSkips;
}

function stillBlocking(item: { skipOn?: string; resumeOn?: string }, dateKey: string) {
  const explicit = isCalendarDateKey(item.resumeOn || "") ? (item.resumeOn || "").trim() : "";
  const resume = explicit || addCalendarDays(item.skipOn || "", 1);
  return Boolean(resume) && dateKey < resume;
}

async function writeAudit(store: CrmStore, input: Omit<SameDayCallSkipAudit, "id" | "at" | "resumeOn"> & { resumeOn?: string }) {
  const audit: SameDayCallSkipAudit = {
    id: `sdcsa_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input,
    resumeOn: input.result === "rejected" ? "" : (input.resumeOn || ""),
    note: input.result === "rejected" ? "" : input.note
  };
  if (!store.sameDayCallSkipAudits) store.sameDayCallSkipAudits = [];
  store.sameDayCallSkipAudits.unshift(audit);
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
  targetType: SameDaySkipTargetType;
  targetId: string;
  name: string;
  ownerId: string;
}

function locateObject(store: CrmStore, user: SessionUser, targetType: SameDaySkipTargetType, targetId: string):
  | LocatedObject
  | { ok: false; status: number; reason: string; message: string } {
  if (targetType === "customer") {
    const customer = store.customers.find((item) => item.id === targetId);
    if (!customer || customer.teamId !== user.teamId) {
      return { ok: false, status: 404, reason: "not_found", message: "外呼对象不存在" };
    }
    if (isPublicCustomer(customer)) {
      return { ok: false, status: 403, reason: "forbidden", message: "公池客户不能标记今日不再拨" };
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

interface ListedSkip {
  targetType: SameDaySkipTargetType;
  targetId: string;
  targetLabel: string;
  name: string;
  reason: SameDaySkipReason;
  reasonLabel: string;
  note: string;
  skipOn: string;
  resumeOn: string;
  actorId: string;
  actorLabel: string;
  updatedAt: string;
}

async function listRows(store: CrmStore, user: SessionUser, scope: "mine" | "team", dateKey: string) {
  const rows: ListedSkip[] = [];
  for (const item of skips(store)) {
    if (item.teamId !== user.teamId || !item.active || !stillBlocking(item, dateKey)) continue;
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
      skipOn: item.skipOn,
      resumeOn: (item.resumeOn || "").trim(),
      actorId: item.actorId,
      actorLabel: actorLabel(store, user.teamId, item.actorId),
      updatedAt: item.updatedAt || ""
    });
  }
  rows.sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      if (!left.updatedAt) return 1;
      if (!right.updatedAt) return -1;
      return left.updatedAt < right.updatedAt ? 1 : -1;
    }
    return left.targetId < right.targetId ? -1 : left.targetId > right.targetId ? 1 : 0;
  });
  return rows;
}

export async function listSameDayCallSkips(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseSameDayCallSkipQuery(query);
  if (!parsed) return reject("invalid_request", "今日不再拨只接受我的或团队");
  if (parsed.scope === "team" && !canViewTeamSameDayCallSkip(user)) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "read",
      scope: "team",
      targetType: "",
      targetId: "",
      skipOn: "",
      skipReason: "",
      note: "",
      rowCount: 0,
      result: "rejected",
      reason: "forbidden"
    });
    return reject("forbidden", "没有查看团队今日不再拨的权限", 403);
  }
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const items = await listRows(store, user, parsed.scope, await todayKey(store, user.teamId));
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "read",
    scope: parsed.scope,
    targetType: "",
    targetId: "",
    skipOn: "",
    skipReason: "",
    note: "",
    rowCount: items.length,
    result: "read",
    reason: ""
  });
  return { status: 200, body: { scope: parsed.scope, empty: items.length === 0, items } };
}

async function guardTarget(store: CrmStore, user: SessionUser, action: "set" | "clear", targetType: SameDaySkipTargetType, targetId: string) {
  if (!hasIamPermission(user, OUTBOUND_CALL_PERMISSION)) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action,
      scope: "",
      targetType,
      targetId,
      skipOn: "",
      skipReason: "",
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
      skipOn: "",
      skipReason: "",
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
      skipOn: "",
      skipReason: "",
      note: "",
      rowCount: 0,
      result: "rejected",
      reason: "forbidden"
    });
    return { ok: false as const, outcome: reject("forbidden", "外呼对象不在当前账号的租户或归属范围内", 403) };
  }
  return { ok: true as const, located };
}

export async function setSameDayCallSkip(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseSameDayCallSkipSet(body);
  if (!parsed.ok) {
    const message = parsed.reason === "note_too_long"
      ? "备注不能超过 200 字"
      : parsed.reason === "resume_invalid"
        ? "恢复日必须是合法的日期"
        : "一次只能为一个对象记下暂停外呼";
    return reject("invalid_request", message);
  }
  const dateKey = await todayKey(store, user.teamId);
  if (parsed.resumeOn) {
    const latest = addCalendarDays(dateKey, 30);
    if (parsed.resumeOn <= dateKey) return reject("invalid_request", "恢复日必须晚于租户当地今天");
    if (!latest || parsed.resumeOn > latest) return reject("invalid_request", "恢复日不能晚于当地今天之后的 30 天");
  }
  const guarded = await guardTarget(store, user, "set", parsed.targetType, parsed.targetId);
  if (!guarded.ok) return guarded.outcome;
  const matches = skips(store).filter((item) =>
    item.teamId === user.teamId && item.targetType === parsed.targetType && item.targetId === parsed.targetId
  );
  const current = matches[0];
  const currentResume = (current?.resumeOn || "").trim();
  if (current && current.active && stillBlocking(current, dateKey) && current.reason === parsed.reason && (current.note || "") === parsed.note && currentResume === parsed.resumeOn && matches.every((item) => item === current || !item.active)) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: parsed.resumeOn && parsed.resumeOn !== addCalendarDays(dateKey, 1) ? "这次暂停没有变化" : "今天的不再拨没有变化",
        targetType: parsed.targetType,
        targetId: parsed.targetId,
        skipOn: dateKey
      }
    };
  }
  const now = outboundInstant().toISOString();
  if (current) {
    current.skipOn = dateKey;
    current.resumeOn = parsed.resumeOn;
    current.reason = parsed.reason;
    current.note = parsed.note;
    current.active = true;
    current.actorId = user.id;
    current.updatedAt = now;
    for (const extra of matches.slice(1)) extra.active = false;
  } else {
    const created: SameDayCallSkip = {
      id: `sdcs_${randomUUID()}`,
      teamId: user.teamId,
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      skipOn: dateKey,
      resumeOn: parsed.resumeOn,
      reason: parsed.reason,
      note: parsed.note,
      active: true,
      actorId: user.id,
      updatedAt: now
    };
    skips(store).unshift(created);
  }
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "set",
    scope: "",
    targetType: parsed.targetType,
    targetId: parsed.targetId,
    skipOn: dateKey,
    resumeOn: parsed.resumeOn,
    skipReason: parsed.reason,
    note: parsed.note,
    rowCount: 0,
    result: "updated",
    reason: ""
  });
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message: parsed.resumeOn && parsed.resumeOn !== addCalendarDays(dateKey, 1)
        ? `已记下暂停外呼，要到 ${parsed.resumeOn} 才可再拨`
        : "已记下今日不再拨，今天不会再拨这个对象",
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      skipOn: dateKey,
      resumeOn: parsed.resumeOn,
      reason: parsed.reason,
      reasonLabel: REASON_LABEL[parsed.reason]
    }
  };
}

export async function clearSameDayCallSkip(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseSameDayCallSkipClear(body);
  if (!parsed.ok) return reject("invalid_request", "一次只能撤销一个对象的今日不再拨");
  const guarded = await guardTarget(store, user, "clear", parsed.targetType, parsed.targetId);
  if (!guarded.ok) return guarded.outcome;
  const dateKey = await todayKey(store, user.teamId);
  const active = skips(store).filter((item) =>
    item.teamId === user.teamId
    && item.targetType === parsed.targetType
    && item.targetId === parsed.targetId
    && item.active
    && stillBlocking(item, dateKey)
  );
  if (!active.length) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: "今天没有需要撤销的不再拨",
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
    skipOn: dateKey,
    resumeOn: (active[0].resumeOn || "").trim(),
    skipReason: active[0].reason,
    note: active[0].note || "",
    rowCount: 0,
    result: "updated",
    reason: ""
  });
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message: "已撤销今日不再拨",
      targetType: parsed.targetType,
      targetId: parsed.targetId
    }
  };
}

export async function sameDaySkipBlocks(store: CrmStore, teamId: string, targetType: string, targetId: string) {
  return sameDaySkipActive(store, teamId, targetType, targetId, await todayKey(store, teamId));
}
