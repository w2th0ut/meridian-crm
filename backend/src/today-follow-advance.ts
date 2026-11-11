import { hasIamPermission } from "./auth.js";
import { displayMaskedNumber } from "./call-wrapup-queue.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import { outboundInstant, sameDaySkipActive, tenantTimeZoneFor, zonedDateKey } from "./outbound-call.js";
import { attachQueueCallGlance } from "./queue-call-glance.js";
import { activePreferredPhoneId } from "./preferred-phone.js";
import { isPhoneMarkedInvalid, listObjectPhones } from "./phone-validity-state.js";
import type { CrmStore } from "./store.js";
import type { SessionUser } from "./types.js";

/**
 * 保存一通通话结果之后，从已经写下的下次跟进里找出下一位，供页面打开。
 * 客户看 nextReminder，线索和搜客看 nextFollowAt。不另建表，也不写审计。
 * 暂停外呼（§100/§101）、没有仍有效号码、以及当前账号读不到的对象都不进入。
 * 号码默认用仍有效的首选；没有首选时用第一个仍有效的号码。只返回脱敏号码。
 * 这一次只读。不拨号，不改通话结果，不调用 persist。
 */

export type TodayFollowTargetType = "customer" | "lead" | "prospect";

const TARGET_LABEL: Record<TodayFollowTargetType, string> = {
  customer: "客户",
  lead: "线索",
  prospect: "搜客"
};

const TYPE_RANK: Record<TodayFollowTargetType, number> = {
  customer: 0,
  lead: 1,
  prospect: 2
};

const READ_PERMISSION: Record<TodayFollowTargetType, string> = {
  customer: "customer.read",
  lead: "lead.read",
  prospect: "prospect.read"
};

const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const QUERY_KEYS = new Set(["scope", "afterType", "afterId"]);

export interface TodayFollowNextRow {
  targetType: TodayFollowTargetType;
  targetId: string;
  targetLabel: string;
  name: string;
  nextFollowAt: string;
  phoneId: string;
  preferred: boolean;
  maskedNumber: string;
}

export function canViewTeamTodayFollow(user: { role?: string } | undefined) {
  return user?.role === "manager" || user?.role === "admin" || user?.role === "super_admin";
}

/** 墙上的 `YYYY-MM-DD HH:mm`。日期必须正好是租户当地今天。解析不了、别的日期都不算今天。 */
export function parseTodayFollowAt(value: string, dateKey: string) {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  if (!match || match[1] !== dateKey) return "";
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour > 23 || minute > 59) return "";
  return `${match[1]} ${match[2]}:${match[3]}`;
}

export function compareTodayFollow(left: Pick<TodayFollowNextRow, "nextFollowAt" | "targetType" | "targetId">, right: Pick<TodayFollowNextRow, "nextFollowAt" | "targetType" | "targetId">) {
  if (left.nextFollowAt !== right.nextFollowAt) return left.nextFollowAt < right.nextFollowAt ? -1 : 1;
  if (left.targetType !== right.targetType) return TYPE_RANK[left.targetType] - TYPE_RANK[right.targetType];
  if (left.targetId === right.targetId) return 0;
  return left.targetId < right.targetId ? -1 : 1;
}

/** 上一对象还在队列里时取它后面的一位。不在队列里时取第一位不是它的对象。没有就空。 */
export function pickNextTodayFollow<T extends { targetType: string; targetId: string }>(rows: T[], after: { targetType: string; targetId: string } | null) {
  if (!after) return rows[0] || null;
  const index = rows.findIndex((item) => item.targetType === after.targetType && item.targetId === after.targetId);
  if (index >= 0) return rows[index + 1] || null;
  return rows.find((item) => item.targetType !== after.targetType || item.targetId !== after.targetId) || null;
}

function isTargetType(value: string): value is TodayFollowTargetType {
  return value === "customer" || value === "lead" || value === "prospect";
}

function oneQuery(value: unknown) {
  if (Array.isArray(value)) return null;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value.trim() : null;
}

export function parseTodayFollowNextQuery(query: Record<string, unknown>):
  | { ok: true; scope: "mine" | "team"; after: { targetType: TodayFollowTargetType; targetId: string } | null }
  | { ok: false } {
  if (Object.keys(query).some((key) => !QUERY_KEYS.has(key))) return { ok: false };
  if (Object.values(query).some((value) => Array.isArray(value))) return { ok: false };
  const scope = oneQuery(query.scope);
  if (scope !== "mine" && scope !== "team") return { ok: false };
  const afterType = oneQuery(query.afterType);
  const afterId = oneQuery(query.afterId);
  if (afterType === null || afterId === null) return { ok: false };
  if (!afterType && !afterId) return { ok: true, scope, after: null };
  if (!afterType || !afterId || !isTargetType(afterType) || !TARGET_ID_PATTERN.test(afterId)) return { ok: false };
  return { ok: true, scope, after: { targetType: afterType, targetId: afterId } };
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

async function canReadOwner(store: CrmStore, user: SessionUser, permission: string, ownerId: string, teamId: string) {
  if (!hasIamPermission(user, permission)) return false;
  if (!ownerId) return false;
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

function chosenPhone(store: CrmStore, teamId: string, targetType: TodayFollowTargetType, targetId: string) {
  const phones = listObjectPhones(store, teamId, targetType, targetId).filter((item) =>
    item.phone.trim() && !isPhoneMarkedInvalid(store, teamId, item.phoneId)
  );
  if (!phones.length) return null;
  const preferredId = activePreferredPhoneId(store, teamId, targetType, targetId);
  const preferred = preferredId ? phones.find((item) => item.phoneId === preferredId) : undefined;
  const chosen = preferred || phones[0];
  if (!chosen) return null;
  return {
    phoneId: chosen.phoneId,
    preferred: Boolean(preferred),
    maskedNumber: displayMaskedNumber(chosen.phone)
  };
}

async function listRows(store: CrmStore, user: SessionUser, scope: "mine" | "team", dateKey: string) {
  const rows: TodayFollowNextRow[] = [];
  const consider = async (
    targetType: TodayFollowTargetType,
    targetId: string,
    name: string,
    ownerId: string,
    followAt: string,
    readable: boolean
  ) => {
    if (!readable) return;
    if (scope === "mine" && ownerId !== user.id) return;
    if (sameDaySkipActive(store, user.teamId, targetType, targetId, dateKey)) return;
    const when = parseTodayFollowAt(followAt, dateKey);
    if (!when) return;
    const phone = chosenPhone(store, user.teamId, targetType, targetId);
    if (!phone) return;
    rows.push({
      targetType,
      targetId,
      targetLabel: TARGET_LABEL[targetType],
      name: name || targetId,
      nextFollowAt: when,
      phoneId: phone.phoneId,
      preferred: phone.preferred,
      maskedNumber: phone.maskedNumber
    });
  };

  for (const customer of store.customers) {
    if (customer.teamId !== user.teamId || isPublicCustomer(customer)) continue;
    await consider(
      "customer",
      customer.id,
      customer.company || "",
      customer.ownerId,
      customer.nextReminder || "",
      await canReadOwner(store, user, READ_PERMISSION.customer, customer.ownerId, user.teamId)
    );
  }
  for (const lead of store.leads) {
    if (lead.teamId !== user.teamId || lead.deletedAt) continue;
    await consider(
      "lead",
      lead.id,
      lead.company || "",
      lead.ownerId,
      lead.nextFollowAt || "",
      await canReadOwner(store, user, READ_PERMISSION.lead, lead.ownerId, user.teamId)
    );
  }
  for (const candidate of store.websiteOpportunities) {
    if (candidate.teamId !== user.teamId) continue;
    await consider(
      "prospect",
      candidate.id,
      candidate.company || "",
      candidate.ownerId,
      candidate.nextFollowAt || "",
      await canReadOwner(store, user, READ_PERMISSION.prospect, candidate.ownerId, user.teamId)
    );
  }
  rows.sort(compareTodayFollow);
  return rows;
}

export async function collectTodayFollowRows(store: CrmStore, user: SessionUser, scope: "mine" | "team") {
  const timeZone = await tenantTimeZoneFor(store, user.teamId);
  const date = zonedDateKey(outboundInstant(), timeZone);
  return listRows(store, user, scope, date);
}

export async function listTodayFollowNext(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseTodayFollowNextQuery(query);
  if (!parsed.ok) return reject("invalid_request", "查看范围不正确");
  if (!hasIamPermission(user, "communication.read")) {
    return reject("forbidden", "没有查看通话记录的权限", 403);
  }
  if (parsed.scope === "team" && !canViewTeamTodayFollow(user)) {
    return reject("forbidden", "只有主管可以查看团队的下一位", 403);
  }
  const timeZone = await tenantTimeZoneFor(store, user.teamId);
  const date = zonedDateKey(outboundInstant(), timeZone);
  const rows = await listRows(store, user, parsed.scope, date);
  const next = pickNextTodayFollow(rows, parsed.after);
  const glanced = next ? (await attachQueueCallGlance(store, user, [next]))[0] || null : null;
  return {
    status: 200,
    body: {
      result: "read" as const,
      scope: parsed.scope,
      timeZone,
      date,
      empty: !next,
      next: glanced,
      message: next ? "已打开下一位。外呼仍要自己点。" : "今天没有下一位待跟进"
    }
  };
}
