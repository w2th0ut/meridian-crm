import { randomUUID } from "node:crypto";
import { canSeeOwner, hasIamPermission, isPlatformIdentity, type IamActor } from "./auth.js";
import { tagFilterChoices, type CallTagView } from "./call-tag.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import { outboundInstant } from "./outbound-call.js";
import {
  outboundCallRecordVisible,
  resolveOutboundCallRecordAccess,
  type OutboundCallRecordAccess
} from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type { CallRecordTag, CallTag, CallTagViewAudit, SessionUser } from "./types.js";

/**
 * 客户和线索上，历史通话已经打过的标签。只读。
 * 次数是看得到的通话条数，同一通话同一标签只计一次。
 * 最近一次时间用关联行上的 createdAt，没有就不填。
 * 筛选和查看写入 call_tag_view_audits。不拨号，不改标签，不改通话。
 */

const TAG_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface CallTagOnObject {
  id: string;
  name: string;
  enabled: boolean;
  count: number;
  latestAt: string;
}

type TargetType = "customer" | "lead";

interface TaggedRecord {
  id: string;
  teamId: string;
  targetType: string;
  targetId: string;
}

function tagRows(store: { callTags?: readonly CallTag[] }) {
  return store.callTags ?? [];
}

function linkRows(store: { callRecordTags?: readonly CallRecordTag[] }) {
  return store.callRecordTags ?? [];
}

function recordRows(store: { outboundCallRecords?: readonly TaggedRecord[] }) {
  return store.outboundCallRecords ?? [];
}

function compareTags(left: { name: string; id: string }, right: { name: string; id: string }) {
  return left.name.localeCompare(right.name, "zh") || left.id.localeCompare(right.id);
}

function laterAt(current: string, next: string) {
  if (!next) return current;
  if (!current || next > current) return next;
  return current;
}

export function visibleOutboundCallIds(
  store: { outboundCallRecords?: readonly Parameters<typeof outboundCallRecordVisible>[0][] },
  teamId: string,
  access: Pick<OutboundCallRecordAccess, "tenantWide" | "allowed">
) {
  const ids = new Set<string>();
  for (const record of store.outboundCallRecords ?? []) {
    if (outboundCallRecordVisible(record, teamId, access)) ids.add(record.id);
  }
  return ids;
}

/** 这个对象上看得到的通话里，每个标签的次数和最近一次打上的时间。 */
export function summarizeCallTagsOnCalls(
  store: {
    callTags?: readonly CallTag[];
    callRecordTags?: readonly CallRecordTag[];
    outboundCallRecords?: readonly TaggedRecord[];
  },
  teamId: string,
  targetType: TargetType,
  targetId: string,
  visibleCallIds: ReadonlySet<string>
): CallTagOnObject[] {
  const callIds = new Set<string>();
  for (const record of recordRows(store)) {
    if (record.teamId !== teamId || record.targetType !== targetType || record.targetId !== targetId) continue;
    if (!visibleCallIds.has(record.id)) continue;
    callIds.add(record.id);
  }
  const byTag = new Map<string, { calls: Set<string>; latestAt: string }>();
  for (const link of linkRows(store)) {
    if (link.teamId !== teamId || !callIds.has(link.callRecordId)) continue;
    let row = byTag.get(link.tagId);
    if (!row) {
      row = { calls: new Set<string>(), latestAt: "" };
      byTag.set(link.tagId, row);
    }
    row.calls.add(link.callRecordId);
    row.latestAt = laterAt(row.latestAt, link.createdAt || "");
  }
  return tagRows(store)
    .filter((tag) => tag.teamId === teamId && (byTag.get(tag.id)?.calls.size || 0) > 0)
    .map((tag) => {
      const row = byTag.get(tag.id)!;
      return {
        id: tag.id,
        name: tag.name,
        enabled: tag.enabled,
        count: row.calls.size,
        latestAt: row.latestAt
      };
    })
    .sort(compareTags);
}

/** 候选对象上看得到的通话打过哪些本租户标签。键是对象 id。 */
export function callTagIdsByTarget(
  store: {
    callTags?: readonly CallTag[];
    callRecordTags?: readonly CallRecordTag[];
    outboundCallRecords?: readonly TaggedRecord[];
  },
  teamId: string,
  targetType: TargetType,
  visibleCallIds: ReadonlySet<string>,
  candidateIds: ReadonlySet<string>
) {
  const known = new Set(tagRows(store).filter((tag) => tag.teamId === teamId).map((tag) => tag.id));
  const recordTarget = new Map<string, string>();
  for (const record of recordRows(store)) {
    if (record.teamId !== teamId || record.targetType !== targetType) continue;
    if (!visibleCallIds.has(record.id) || !candidateIds.has(record.targetId)) continue;
    recordTarget.set(record.id, record.targetId);
  }
  const sets = new Map<string, Set<string>>();
  for (const link of linkRows(store)) {
    if (link.teamId !== teamId || !known.has(link.tagId)) continue;
    const targetId = recordTarget.get(link.callRecordId);
    if (!targetId) continue;
    let tags = sets.get(targetId);
    if (!tags) {
      tags = new Set<string>();
      sets.set(targetId, tags);
    }
    tags.add(link.tagId);
  }
  return sets;
}

export function callRecordIdsForTargets(
  store: { outboundCallRecords?: readonly TaggedRecord[] },
  teamId: string,
  targetType: TargetType,
  visibleCallIds: ReadonlySet<string>,
  candidateIds: ReadonlySet<string>
) {
  const ids: string[] = [];
  for (const record of recordRows(store)) {
    if (record.teamId !== teamId || record.targetType !== targetType) continue;
    if (!visibleCallIds.has(record.id) || !candidateIds.has(record.targetId)) continue;
    ids.push(record.id);
  }
  return ids;
}

export function parseCallTagListFilter(value: unknown):
  | { ok: true; tagId: string | null }
  | { ok: false } {
  if (Array.isArray(value)) return { ok: false };
  if (value === undefined || value === null) return { ok: true, tagId: null };
  if (typeof value !== "string") return { ok: false };
  const text = value.trim();
  if (!text) return { ok: true, tagId: null };
  if (text === "none" || !TAG_ID.test(text)) return { ok: false };
  return { ok: true, tagId: text };
}

export function parseCallTagViewQuery(query: Record<string, unknown>) {
  return Object.keys(query).length === 0 && !Object.values(query).some((value) => Array.isArray(value));
}

function clipId(value: string) {
  return value.slice(0, 64);
}

function canReadCalls(user: SessionUser) {
  return hasIamPermission(user as IamActor, "communication.read");
}

export function callTagObjectVisible(
  user: SessionUser,
  store: Pick<CrmStore, "customers" | "leads">,
  targetType: TargetType,
  targetId: string
) {
  if (targetType === "customer") {
    const customer = store.customers.find((item) => item.id === targetId);
    if (!customer) return false;
    if (isPublicCustomer(customer)) return !isPlatformIdentity(user) && customer.teamId === user.teamId;
    return canSeeOwner(user, customer.ownerId, customer.teamId);
  }
  const lead = store.leads.find((item) => item.id === targetId);
  if (!lead) return false;
  return canSeeOwner(user, lead.ownerId, lead.teamId);
}

async function assignReadScope(store: CrmStore, user: SessionUser, permissionCode: string) {
  if (store.resolveIamDataScope) {
    user.iamDataScope = {
      permissionCode,
      ...await store.resolveIamDataScope(user, permissionCode)
    };
    return;
  }
  const scopes = (user.iamPermissions?.[permissionCode] || []) as Array<"self" | "org_unit" | "org_subtree" | "tenant" | "public_pool">;
  const organizationWide = scopes.includes("org_unit") || scopes.includes("org_subtree");
  user.iamDataScope = {
    permissionCode,
    tenantWide: scopes.includes("tenant"),
    ownerIds: organizationWide
      ? store.users.filter((item) => item.teamId === user.teamId && item.status === "active").map((item) => item.id)
      : scopes.includes("self") ? [user.id] : []
  };
}

async function writeAudit(store: CrmStore, input: Omit<CallTagViewAudit, "id" | "at">) {
  const audit: CallTagViewAudit = {
    id: `ctva_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input,
    targetId: clipId(input.targetId),
    tagId: clipId(input.tagId),
    rowCount: Number.isFinite(input.rowCount) ? input.rowCount : 0
  };
  store.callTagViewAudits.unshift(audit);
  await store.persist();
  return audit;
}

function reject(reason: string, message: string, status = 400) {
  return { ok: false as const, status, body: { result: "rejected" as const, reason, message } };
}

async function rejectView(
  store: CrmStore,
  user: SessionUser,
  input: { action: CallTagViewAudit["action"]; targetType: TargetType | ""; targetId: string; tagId: string; message: string }
) {
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    tagId: input.tagId,
    rowCount: 0,
    result: "rejected",
    reason: "forbidden"
  });
  return {
    ok: false as const,
    status: 403,
    body: { result: "rejected" as const, reason: "forbidden", message: input.message }
  };
}

export async function readObjectCallTags(
  store: CrmStore,
  user: SessionUser | undefined,
  targetType: TargetType,
  targetId: string,
  query: Record<string, unknown>
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  if (!parseCallTagViewQuery(query)) {
    return { status: 400, body: { result: "rejected" as const, reason: "invalid_request", message: "参数格式错误" } };
  }
  const scopeBefore = user.iamDataScope;
  const visible = callTagObjectVisible(user, store, targetType, targetId);
  const label = targetType === "customer" ? "客户" : "线索";
  if (!visible || !canReadCalls(user)) {
    const denied = await rejectView(store, user, {
      action: "read",
      targetType,
      targetId,
      tagId: "",
      message: `没有查看这个${label}通话标签的权限`
    });
    return { status: denied.status, body: denied.body };
  }
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  user.iamDataScope = scopeBefore;
  if (!resolved.ok) {
    const denied = await rejectView(store, user, {
      action: "read",
      targetType,
      targetId,
      tagId: "",
      message: `没有查看这个${label}通话标签的权限`
    });
    return { status: denied.status, body: denied.body };
  }
  const tags = summarizeCallTagsOnCalls(
    store,
    user.teamId,
    targetType,
    targetId,
    visibleOutboundCallIds(store, user.teamId, resolved.access)
  );
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "read",
    targetType,
    targetId,
    tagId: "",
    rowCount: tags.length,
    result: "read",
    reason: ""
  });
  return {
    status: 200,
    body: { targetType, targetId, tags }
  };
}

export async function applyCallTagObjectList<T extends { id: string }>(
  store: CrmStore,
  user: SessionUser,
  targetType: TargetType,
  items: T[],
  query: Record<string, unknown>
): Promise<
  | { ok: true; items: Array<T & { callTagIds?: string[] }>; callTagFilters: CallTagView[] | null }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const parsed = parseCallTagListFilter(query.callTag);
  if (!parsed.ok) return reject("invalid_request", "通话标签筛选无效");
  if (!canReadCalls(user)) {
    if (!parsed.tagId) return { ok: true, items, callTagFilters: null };
    const denied = await rejectView(store, user, {
      action: "filter",
      targetType,
      targetId: "",
      tagId: parsed.tagId,
      message: "没有按通话标签筛选的权限"
    });
    return denied;
  }
  const scopeBefore = user.iamDataScope;
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  user.iamDataScope = scopeBefore;
  if (!resolved.ok) {
    if (!parsed.tagId) return { ok: true, items, callTagFilters: null };
    return rejectView(store, user, {
      action: "filter",
      targetType,
      targetId: "",
      tagId: parsed.tagId,
      message: "没有按通话标签筛选的权限"
    });
  }
  const visibleIds = visibleOutboundCallIds(store, user.teamId, resolved.access);
  const candidateIds = new Set(items.map((item) => item.id));
  const tagsByTarget = callTagIdsByTarget(store, user.teamId, targetType, visibleIds, candidateIds);
  const callTagFilters = tagFilterChoices(
    store,
    user.teamId,
    callRecordIdsForTargets(store, user.teamId, targetType, visibleIds, candidateIds)
  );
  let selected = items.map((item) => ({
    ...item,
    callTagIds: [...(tagsByTarget.get(item.id) || [])].sort()
  }));
  if (parsed.tagId) {
    selected = selected.filter((item) => item.callTagIds?.includes(parsed.tagId!));
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "filter",
      targetType,
      targetId: "",
      tagId: parsed.tagId,
      rowCount: selected.length,
      result: "filtered",
      reason: ""
    });
  }
  return { ok: true, items: selected, callTagFilters };
}

/** 通话记录列表或导出带了对象时，先按保存下来的客户/线索范围判断。看不见就拒绝。 */
export async function rejectHiddenCallTagTarget(
  store: CrmStore,
  user: SessionUser,
  targetType: TargetType,
  targetId: string,
  tagId: string,
  options?: { audit?: boolean }
) {
  const permission = targetType === "customer" ? "customer.read" : "lead.read";
  const previous = user.iamDataScope;
  const allowed = hasIamPermission(user as IamActor, permission);
  if (allowed) await assignReadScope(store, user, permission);
  const visible = allowed && callTagObjectVisible(user, store, targetType, targetId);
  user.iamDataScope = previous;
  if (visible) return null;
  if (options?.audit !== false) await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "read",
    targetType,
    targetId,
    tagId,
    rowCount: 0,
    result: "rejected",
    reason: "forbidden"
  });
  const label = targetType === "customer" ? "客户" : "线索";
  return {
    status: 403,
    body: { result: "rejected" as const, reason: "forbidden", message: `没有查看这个${label}通话记录的权限` }
  };
}

export async function auditCallTagTargetRead(
  store: CrmStore,
  user: SessionUser,
  targetType: TargetType,
  targetId: string,
  tagId: string,
  rowCount: number
) {
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "read",
    targetType,
    targetId,
    tagId,
    rowCount,
    result: "read",
    reason: ""
  });
}
