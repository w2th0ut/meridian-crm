import { randomUUID } from "node:crypto";
import { hasIamPermission } from "./auth.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import { collectIntentFollowupRows } from "./intent-followup-queue.js";
import { collectNegativeOutcomeFollowupRows } from "./negative-outcome-followup.js";
import { collectOtherOutcomeFollowupRows } from "./other-outcome-followup.js";
import { OUTBOUND_CALL_PERMISSION, addCalendarDays, isCalendarDateKey, outboundInstant, sameDaySkipActive, tenantTimeZoneFor, zonedDateKey } from "./outbound-call.js";
import { resolveOutboundCallRecordAccess } from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import { collectTodayFollowRows } from "./today-follow-advance.js";
import { collectUnansweredPendingRows } from "./unanswered-pending-queue.js";
import { collectUnlabeledConnectedFollowupRows } from "./unlabeled-connected-followup.js";
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

function pushAudit(store: CrmStore, input: Omit<SameDayCallSkipAudit, "id" | "at" | "resumeOn" | "batchId"> & { resumeOn?: string; batchId?: string }) {
  const audit: SameDayCallSkipAudit = {
    id: `sdcsa_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input,
    resumeOn: input.result === "rejected" ? "" : (input.resumeOn || ""),
    note: input.result === "rejected" ? "" : input.note,
    batchId: input.batchId || ""
  };
  if (!store.sameDayCallSkipAudits) store.sameDayCallSkipAudits = [];
  store.sameDayCallSkipAudits.unshift(audit);
  return audit;
}

async function writeAudit(store: CrmStore, input: Omit<SameDayCallSkipAudit, "id" | "at" | "resumeOn" | "batchId"> & { resumeOn?: string; batchId?: string }) {
  const audit = pushAudit(store, input);
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

function upsertSkip(
  store: CrmStore,
  user: SessionUser,
  targetType: SameDaySkipTargetType,
  targetId: string,
  dateKey: string,
  reason: SameDaySkipReason,
  note: string,
  resumeOn: string
) {
  const matches = skips(store).filter((item) =>
    item.teamId === user.teamId && item.targetType === targetType && item.targetId === targetId
  );
  const current = matches[0];
  const currentResume = (current?.resumeOn || "").trim();
  if (current && current.active && stillBlocking(current, dateKey) && current.reason === reason && (current.note || "") === note && currentResume === resumeOn && matches.every((item) => item === current || !item.active)) {
    return "unchanged" as const;
  }
  const now = outboundInstant().toISOString();
  if (current) {
    current.skipOn = dateKey;
    current.resumeOn = resumeOn;
    current.reason = reason;
    current.note = note;
    current.active = true;
    current.actorId = user.id;
    current.updatedAt = now;
    for (const extra of matches.slice(1)) extra.active = false;
  } else {
    const created: SameDayCallSkip = {
      id: `sdcs_${randomUUID()}`,
      teamId: user.teamId,
      targetType,
      targetId,
      skipOn: dateKey,
      resumeOn,
      reason,
      note,
      active: true,
      actorId: user.id,
      updatedAt: now
    };
    skips(store).unshift(created);
  }
  return "updated" as const;
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
  if (upsertSkip(store, user, parsed.targetType, parsed.targetId, dateKey, parsed.reason, parsed.note, parsed.resumeOn) === "unchanged") {
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

export const SAME_DAY_SKIP_BATCH_MAX = 100;

const BATCH_BODY = new Set(["targets", "reason", "note", "resumeOn"]);
const BATCH_TARGET = new Set(["targetType", "targetId"]);

export function parseSameDayCallSkipBatch(body: unknown):
  | { ok: true; targets: Array<{ targetType: SameDaySkipTargetType; targetId: string }>; reason: SameDaySkipReason; note: string; resumeOn: string }
  | { ok: false; reason: "invalid_request" | "too_many" | "note_too_long" | "resume_invalid" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !BATCH_BODY.has(key))) return { ok: false, reason: "invalid_request" };
  if (!Array.isArray(record.targets) || record.targets.length === 0) return { ok: false, reason: "invalid_request" };
  if (record.targets.length > SAME_DAY_SKIP_BATCH_MAX) return { ok: false, reason: "too_many" };
  const targets: Array<{ targetType: SameDaySkipTargetType; targetId: string }> = [];
  for (const item of record.targets) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return { ok: false, reason: "invalid_request" };
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some((key) => !BATCH_TARGET.has(key))) return { ok: false, reason: "invalid_request" };
    if (typeof row.targetType !== "string" || !isTargetType(row.targetType.trim())) return { ok: false, reason: "invalid_request" };
    if (typeof row.targetId !== "string" || !TARGET_ID_PATTERN.test(row.targetId.trim())) return { ok: false, reason: "invalid_request" };
    targets.push({ targetType: row.targetType.trim() as SameDaySkipTargetType, targetId: row.targetId.trim() });
  }
  if (new Set(targets.map((item) => `${item.targetType}:${item.targetId}`)).size !== targets.length) {
    return { ok: false, reason: "invalid_request" };
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
  return { ok: true, targets, reason: record.reason.trim() as SameDaySkipReason, note, resumeOn };
}

async function batchReadable(store: CrmStore, user: SessionUser, targetType: SameDaySkipTargetType, targetId: string) {
  if (targetType === "customer") {
    const customer = store.customers.find((item) => item.id === targetId && item.teamId === user.teamId);
    if (!customer) return false;
    if (isPublicCustomer(customer)) return hasIamPermission(user, "customer.read");
    return canReadOwner(store, user, READ_PERMISSION.customer, customer.ownerId, user.teamId);
  }
  if (targetType === "lead") {
    const lead = store.leads.find((item) => item.id === targetId && item.teamId === user.teamId && !item.deletedAt);
    if (!lead) return false;
    return canReadOwner(store, user, READ_PERMISSION.lead, lead.ownerId, user.teamId);
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === targetId && item.teamId === user.teamId);
  if (!candidate) return false;
  return canReadOwner(store, user, READ_PERMISSION.prospect, candidate.ownerId, user.teamId);
}

async function listedSkipTargets(store: CrmStore, user: SessionUser) {
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return resolved;
  const scope: "mine" | "team" = canViewTeamSameDayCallSkip(user) ? "team" : "mine";
  const keys = new Set<string>();
  const put = (targetType: string, targetId: string) => {
    if (!isTargetType(targetType) || !targetId) return;
    keys.add(`${targetType}:${targetId}`);
  };
  for (const item of collectIntentFollowupRows(store, user, resolved.access)) put(item.targetType, item.targetId);
  for (const item of collectUnansweredPendingRows(store, user, resolved.access, scope)) put(item.targetType, item.targetId);
  for (const item of collectOtherOutcomeFollowupRows(store, user, resolved.access, scope)) put(item.targetType, item.targetId);
  for (const item of collectUnlabeledConnectedFollowupRows(store, user, resolved.access, scope)) put(item.targetType, item.targetId);
  for (const item of collectNegativeOutcomeFollowupRows(store, user, resolved.access, scope)) put(item.targetType, item.targetId);
  for (const item of await collectTodayFollowRows(store, user, scope)) put(item.targetType, item.targetId);
  return { ok: true as const, keys };
}

async function batchSendBlock(store: CrmStore, user: SessionUser, targetType: SameDaySkipTargetType, targetId: string) {
  if (!hasIamPermission(user, OUTBOUND_CALL_PERMISSION)) {
    return { ok: false as const, status: 403, reason: "forbidden", message: "没有外呼权限" };
  }
  const located = locateObject(store, user, targetType, targetId);
  if (!located.ok) return { ok: false as const, status: located.status, reason: located.reason, message: located.message };
  if (!await canSendToOwner(store, user, located.ownerId, user.teamId)) {
    return { ok: false as const, status: 403, reason: "forbidden", message: "外呼对象不在当前账号的租户或归属范围内" };
  }
  return { ok: true as const };
}

export async function setSameDayCallSkipBatch(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseSameDayCallSkipBatch(body);
  if (!parsed.ok) {
    const message = parsed.reason === "too_many"
      ? "一次最多 100 个对象"
      : parsed.reason === "note_too_long"
        ? "备注不能超过 200 字"
        : parsed.reason === "resume_invalid"
          ? "恢复日必须是合法的日期"
          : "请选择原因，并选择客户、线索或搜客对象";
    const reason = parsed.reason === "too_many" || parsed.reason === "note_too_long" ? parsed.reason : "invalid_request";
    return reject(reason, message);
  }
  const listed = await listedSkipTargets(store, user);
  if (!listed.ok) return { status: listed.status, body: listed.body };
  const dateKey = await todayKey(store, user.teamId);
  if (parsed.resumeOn) {
    const latest = addCalendarDays(dateKey, 30);
    if (parsed.resumeOn <= dateKey) return reject("invalid_request", "恢复日必须晚于租户当地今天");
    if (!latest || parsed.resumeOn > latest) return reject("invalid_request", "恢复日不能晚于当地今天之后的 30 天");
  }
  const chosen = parsed.targets;
  let hidden = false;
  let notPending = false;
  for (const target of chosen) {
    if (listed.keys.has(`${target.targetType}:${target.targetId}`)) continue;
    if (!await batchReadable(store, user, target.targetType, target.targetId)) hidden = true;
    else notPending = true;
  }
  if (hidden) return reject("not_found", "有对象看不见，这次没有记下", 404);
  if (notPending) return reject("not_pending", "有对象不在待跟进、未接通或今日待跟进的名单里，这次没有记下");
  const denied: Array<{ targetType: SameDaySkipTargetType; targetId: string; status: number; reason: string; message: string }> = [];
  for (const target of chosen) {
    const checked = await batchSendBlock(store, user, target.targetType, target.targetId);
    if (checked.ok) continue;
    if (checked.status === 404) return reject("not_found", "有对象看不见，这次没有记下", 404);
    denied.push({ targetType: target.targetType, targetId: target.targetId, status: checked.status, reason: checked.reason, message: checked.message });
  }
  if (denied.length) {
    const batchId = `sdsb_${randomUUID()}`;
    for (const failure of denied) {
      pushAudit(store, {
        teamId: user.teamId,
        actorId: user.id,
        action: "batch",
        scope: "",
        targetType: failure.targetType,
        targetId: failure.targetId,
        skipOn: "",
        skipReason: "",
        note: "",
        rowCount: 0,
        result: "rejected",
        reason: failure.reason,
        batchId
      });
    }
    await store.persist();
    const first = denied[0];
    return reject(first.reason, first.message, first.status);
  }
  const updated = chosen.filter((target) =>
    upsertSkip(store, user, target.targetType, target.targetId, dateKey, parsed.reason, parsed.note, parsed.resumeOn) === "updated"
  );
  if (!updated.length) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: parsed.resumeOn && parsed.resumeOn !== addCalendarDays(dateKey, 1) ? "这次暂停没有变化" : "今天的不再拨没有变化",
        count: 0,
        skipOn: dateKey,
        resumeOn: parsed.resumeOn
      }
    };
  }
  const batchId = `sdsb_${randomUUID()}`;
  for (const target of updated) {
    pushAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "batch",
      scope: "",
      targetType: target.targetType,
      targetId: target.targetId,
      skipOn: dateKey,
      resumeOn: parsed.resumeOn,
      skipReason: parsed.reason,
      note: parsed.note,
      rowCount: 0,
      result: "updated",
      reason: "",
      batchId
    });
  }
  await store.persist();
  const later = Boolean(parsed.resumeOn && parsed.resumeOn !== addCalendarDays(dateKey, 1));
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message: later
        ? `已为 ${updated.length} 条记下暂停外呼，要到 ${parsed.resumeOn} 才可再拨`
        : `已为 ${updated.length} 条记下今日不再拨，今天不会再拨这些对象`,
      skipOn: dateKey,
      resumeOn: parsed.resumeOn,
      reason: parsed.reason,
      reasonLabel: REASON_LABEL[parsed.reason],
      batchId,
      count: updated.length,
      items: updated.map((item) => ({
        targetType: item.targetType,
        targetId: item.targetId,
        skipOn: dateKey,
        resumeOn: parsed.resumeOn
      }))
    }
  };
}

export async function sameDaySkipBlocks(store: CrmStore, teamId: string, targetType: string, targetId: string) {
  return sameDaySkipActive(store, teamId, targetType, targetId, await todayKey(store, teamId));
}
