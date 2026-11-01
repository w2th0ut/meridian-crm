import { randomUUID } from "node:crypto";
import { hasIamPermission } from "./auth.js";
import { outboundInstant } from "./outbound-call.js";
import type { CrmStore } from "./store.js";
import type { AliyunAgentMapping, OutboundOwner, OutboundOwnerAudit, SessionUser } from "./types.js";

/**
 * 外呼负责坐席。只写本地指派和 outbound_owner_audits。
 * 坐席取自本租户已有映射。一次一个对象。不拨号，不发信，不改门禁。
 */

const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes", "agents", "agentIds", "targetIds"] as const;
const TARGET_TYPES = ["customer", "lead", "prospect"] as const;
const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const AGENT_PATTERN = /^[A-Za-z0-9_@.:-]{1,128}$/;

type TargetType = (typeof TARGET_TYPES)[number];

const READ_PERMISSION: Record<TargetType, string> = {
  customer: "customer.read",
  lead: "lead.read",
  prospect: "prospect.read"
};

const WRITE_PERMISSION: Record<TargetType, string> = {
  customer: "customer.update",
  lead: "lead.update",
  prospect: "prospect.execute"
};

type OwnerStore = Pick<CrmStore, "outboundOwners" | "aliyunAgentMappings">;

export function canManageOutboundOwners(user: { role?: string; teamId?: string } | undefined) {
  if (!user?.teamId || user.teamId === "all") return false;
  return user.role === "admin" || user.role === "super_admin";
}

function isTargetType(value: string): value is TargetType {
  return (TARGET_TYPES as readonly string[]).includes(value);
}

function hasBatchKey(record: Record<string, unknown>) {
  return BATCH_KEYS.some((key) => key in record);
}

export function parseOutboundOwnerWrite(body: unknown):
  | { ok: true; targetType: TargetType; targetId: string; agentId: string }
  | { ok: false; reason: "invalid_request" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (hasBatchKey(record)) return { ok: false, reason: "invalid_request" };
  const allowed = new Set(["targetType", "targetId", "agentId"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return { ok: false, reason: "invalid_request" };
  if (typeof record.targetType !== "string" || !isTargetType(record.targetType)) return { ok: false, reason: "invalid_request" };
  if (typeof record.targetId !== "string" || !TARGET_ID_PATTERN.test(record.targetId)) return { ok: false, reason: "invalid_request" };
  if (typeof record.agentId !== "string" || !AGENT_PATTERN.test(record.agentId)) return { ok: false, reason: "invalid_request" };
  return { ok: true, targetType: record.targetType, targetId: record.targetId, agentId: record.agentId };
}

export function parseOutboundOwnerClear(body: unknown):
  | { ok: true; targetType: TargetType; targetId: string }
  | { ok: false; reason: "invalid_request" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (hasBatchKey(record)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(record).some((key) => key !== "targetType" && key !== "targetId")) return { ok: false, reason: "invalid_request" };
  if (typeof record.targetType !== "string" || !isTargetType(record.targetType)) return { ok: false, reason: "invalid_request" };
  if (typeof record.targetId !== "string" || !TARGET_ID_PATTERN.test(record.targetId)) return { ok: false, reason: "invalid_request" };
  return { ok: true, targetType: record.targetType, targetId: record.targetId };
}

export function parseOutboundOwnerQuery(query: Record<string, unknown>):
  | { ok: true; targetType: TargetType; targetId: string }
  | { ok: false; reason: "invalid_request" } {
  const typeRaw = query.targetType;
  const idRaw = query.targetId;
  if (Array.isArray(typeRaw) || Array.isArray(idRaw)) return { ok: false, reason: "invalid_request" };
  if (typeof typeRaw !== "string" || typeof idRaw !== "string") return { ok: false, reason: "invalid_request" };
  if (!isTargetType(typeRaw) || !TARGET_ID_PATTERN.test(idRaw)) return { ok: false, reason: "invalid_request" };
  return { ok: true, targetType: typeRaw, targetId: idRaw };
}

/** 省略是不筛选。只有 mine 表示我负责的。别的值非法。 */
export function parseOwnerMineFilter(value: unknown): "" | "mine" | null {
  if (value === undefined || value === null || value === "") return "";
  if (Array.isArray(value)) return null;
  if (value === "mine") return "mine";
  return null;
}

export function findOutboundOwner(store: OwnerStore, teamId: string, targetType: string, targetId: string) {
  return store.outboundOwners.find((item) => item.teamId === teamId && item.targetType === targetType && item.targetId === targetId) || null;
}

function sameTeamMapping(store: OwnerStore, teamId: string, agentId: string) {
  return store.aliyunAgentMappings.find((item) => item.teamId === teamId && item.cccUserId === agentId) || null;
}

function agentLabel(mapping: AliyunAgentMapping | null, agentId: string) {
  return mapping?.displayName || agentId;
}

export function myOutboundAgentIds(store: OwnerStore, user: { id: string; teamId: string }) {
  const ids = new Set<string>();
  for (const item of store.aliyunAgentMappings) {
    if (item.teamId === user.teamId && item.crmUserId === user.id && item.cccUserId) ids.add(item.cccUserId);
  }
  return ids;
}

export function userOwnsOutboundTarget(store: OwnerStore, user: { id: string; teamId: string }, targetType: string, targetId: string) {
  const owner = findOutboundOwner(store, user.teamId, targetType, targetId);
  if (!owner?.agentId) return false;
  return myOutboundAgentIds(store, user).has(owner.agentId);
}

export function outboundOwnerView(store: OwnerStore, teamId: string, targetType: string, targetId: string) {
  const owner = findOutboundOwner(store, teamId, targetType, targetId);
  const agentId = owner?.agentId || "";
  return {
    ownerAgentId: agentId,
    ownerAgentLabel: agentId ? agentLabel(sameTeamMapping(store, teamId, agentId), agentId) : ""
  };
}

function mappedAgents(store: CrmStore, teamId: string) {
  const seen = new Map<string, string>();
  for (const item of store.aliyunAgentMappings) {
    if (item.teamId !== teamId || !item.cccUserId || seen.has(item.cccUserId)) continue;
    seen.set(item.cccUserId, agentLabel(item, item.cccUserId));
  }
  return [...seen.entries()]
    .map(([agentId, displayName]) => ({ agentId, displayName }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "zh") || left.agentId.localeCompare(right.agentId));
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function validationMessage() {
  return "一次只能为一个对象指派外呼负责坐席";
}

function locate(store: CrmStore, teamId: string, targetType: TargetType, targetId: string) {
  if (targetType === "customer") {
    const customer = store.customers.find((item) => item.id === targetId && item.teamId === teamId);
    if (!customer) return { ok: false as const, status: 404, reason: "not_found", message: "客户不存在" };
    return { ok: true as const, targetType, targetId: customer.id, ownerId: customer.ownerId, name: customer.company || customer.id };
  }
  if (targetType === "lead") {
    const lead = store.leads.find((item) => item.id === targetId && item.teamId === teamId && !item.deletedAt);
    if (!lead) return { ok: false as const, status: 404, reason: "not_found", message: "线索不存在或已删除" };
    return { ok: true as const, targetType, targetId: lead.id, ownerId: lead.ownerId, name: lead.company || lead.id };
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === targetId && item.teamId === teamId);
  if (!candidate) return { ok: false as const, status: 404, reason: "not_found", message: "搜客对象不存在" };
  return { ok: true as const, targetType, targetId: candidate.id, ownerId: candidate.ownerId, name: candidate.company || candidate.id };
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

async function canReadTarget(store: CrmStore, user: SessionUser, targetType: TargetType, ownerId: string) {
  if (canManageOutboundOwners(user)) return true;
  if (await ownerVisible(store, user, READ_PERMISSION[targetType], ownerId, user.teamId)) return true;
  return ownerVisible(store, user, WRITE_PERMISSION[targetType], ownerId, user.teamId);
}

function currentAgentId(store: CrmStore, teamId: string, targetType: string, targetId: string) {
  return findOutboundOwner(store, teamId, targetType, targetId)?.agentId || "";
}

function writeAction(previous: string, next: string): OutboundOwnerAudit["action"] {
  if (!next) return "clear";
  if (!previous) return "assign";
  return "reassign";
}

async function writeAudit(store: CrmStore, input: Omit<OutboundOwnerAudit, "id" | "at">) {
  const audit: OutboundOwnerAudit = {
    id: `owoa_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.outboundOwnerAudits.unshift(audit);
  await store.persist();
  return audit;
}

async function rejectWithAudit(
  store: CrmStore,
  user: SessionUser,
  input: {
    action: OutboundOwnerAudit["action"];
    targetType: TargetType | "";
    targetId: string;
    previousAgentId: string;
    nextAgentId: string;
    reason: string;
    message: string;
    status: number;
  }
) {
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId.slice(0, 64),
    previousAgentId: input.previousAgentId,
    nextAgentId: input.nextAgentId,
    result: "rejected",
    reason: input.reason
  });
  return reject(input.reason, input.message, input.status);
}

function present(store: CrmStore, user: SessionUser, located: { targetType: TargetType; targetId: string; name: string }) {
  const view = outboundOwnerView(store, user.teamId, located.targetType, located.targetId);
  const manage = canManageOutboundOwners(user);
  return {
    targetType: located.targetType,
    targetId: located.targetId,
    name: located.name,
    ownerAgentId: view.ownerAgentId,
    ownerAgentLabel: view.ownerAgentLabel,
    canManage: manage,
    agents: manage ? mappedAgents(store, user.teamId) : []
  };
}

export async function readOutboundOwner(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseOutboundOwnerQuery(query);
  if (!parsed.ok) return reject(parsed.reason, validationMessage());
  const located = locate(store, user.teamId, parsed.targetType, parsed.targetId);
  if (!located.ok) {
    return rejectWithAudit(store, user, {
      action: "assign",
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      previousAgentId: "",
      nextAgentId: "",
      reason: "not_found",
      message: located.message,
      status: 404
    });
  }
  if (!await canReadTarget(store, user, located.targetType, located.ownerId)) {
    return rejectWithAudit(store, user, {
      action: "assign",
      targetType: located.targetType,
      targetId: located.targetId,
      previousAgentId: "",
      nextAgentId: "",
      reason: "forbidden",
      message: "没有查看这个对象的权限",
      status: 403
    });
  }
  return { status: 200, body: present(store, user, located) };
}

async function apply(
  store: CrmStore,
  user: SessionUser,
  input: { targetType: TargetType; targetId: string; agentId: string }
) {
  const next = input.agentId;
  const located = locate(store, user.teamId, input.targetType, input.targetId);
  const previous = located.ok ? currentAgentId(store, user.teamId, located.targetType, located.targetId) : "";
  const action = writeAction(previous, next);
  if (!canManageOutboundOwners(user)) {
    return rejectWithAudit(store, user, {
      action,
      targetType: input.targetType,
      targetId: input.targetId,
      previousAgentId: previous,
      nextAgentId: next,
      reason: "forbidden",
      message: "只有管理员可以指派外呼负责坐席",
      status: 403
    });
  }
  if (!located.ok) {
    return rejectWithAudit(store, user, {
      action,
      targetType: input.targetType,
      targetId: input.targetId,
      previousAgentId: "",
      nextAgentId: next,
      reason: "not_found",
      message: located.message,
      status: 404
    });
  }
  if (previous === next) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: "负责坐席没有变化",
        ...present(store, user, located)
      }
    };
  }
  if (next && !sameTeamMapping(store, user.teamId, next)) {
    return rejectWithAudit(store, user, {
      action,
      targetType: located.targetType,
      targetId: located.targetId,
      previousAgentId: previous,
      nextAgentId: next,
      reason: "not_found",
      message: "没有这个坐席映射，不能指派",
      status: 404
    });
  }
  const now = outboundInstant().toISOString();
  const local = findOutboundOwner(store, user.teamId, located.targetType, located.targetId);
  if (!next) {
    if (local) {
      const index = store.outboundOwners.findIndex((item) => item.id === local.id);
      if (index >= 0) store.outboundOwners.splice(index, 1);
    }
  } else if (local) {
    local.agentId = next;
    local.updatedBy = user.id;
    local.updatedAt = now;
  } else {
    const created: OutboundOwner = {
      id: `owo_${randomUUID()}`,
      teamId: user.teamId,
      targetType: located.targetType,
      targetId: located.targetId,
      agentId: next,
      updatedBy: user.id,
      updatedAt: now
    };
    store.outboundOwners.unshift(created);
  }
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action,
    targetType: located.targetType,
    targetId: located.targetId,
    previousAgentId: previous,
    nextAgentId: next,
    result: "updated",
    reason: ""
  });
  const message = action === "clear" ? "已清除外呼负责坐席" : action === "reassign" ? "已改派外呼负责坐席" : "已指派外呼负责坐席";
  return {
    status: 200,
    body: {
      result: action === "clear" ? "cleared" as const : "updated" as const,
      message,
      ...present(store, user, located)
    }
  };
}

export async function assignOutboundOwner(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseOutboundOwnerWrite(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage());
  return apply(store, user, parsed);
}

export async function clearOutboundOwner(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseOutboundOwnerClear(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage());
  return apply(store, user, { ...parsed, agentId: "" });
}
