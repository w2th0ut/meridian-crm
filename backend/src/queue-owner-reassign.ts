import { randomUUID } from "node:crypto";
import { hasIamPermission } from "./auth.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import { planCallOutcomeTransfer } from "./call-outcome-transfer.js";
import { collectIntentFollowupRows } from "./intent-followup-queue.js";
import { collectNegativeOutcomeFollowupRows } from "./negative-outcome-followup.js";
import { collectOtherOutcomeFollowupRows } from "./other-outcome-followup.js";
import { outboundInstant } from "./outbound-call.js";
import { resolveOutboundCallRecordAccess } from "./outbound-call-records.js";
import { appendOwnerReassignAudit } from "./owner-reassign-audit.js";
import type { CrmStore } from "./store.js";
import { collectTodayFollowRows } from "./today-follow-advance.js";
import { collectUnansweredPendingRows } from "./unanswered-pending-queue.js";
import { collectUnlabeledConnectedFollowupRows } from "./unlabeled-connected-followup.js";
import type { SessionUser } from "./types.js";

/**
 * 工作台待跟进和还没有下次跟进的名单上，一次把多个对象的负责人转给同一位同租户同事。
 * 只收当前账号看得到的负向结果仍有下次跟进、其他结果还没有下次跟进、已接通未标注还没有下次跟进、
 * 意向回访、未接通待处理，以及今日待跟进。
 * 转交沿用单条通话结果里的 planCallOutcomeTransfer：客户 customer.assign，线索和搜客 lead.assign，
 * 搜客再走 prospectOwnerReassignBlock。负责人仍写原来的 ownerId。
 * 审计仍写 owner_reassign_audits，同一次共用 batch_id。不另建表。
 * 有一个看不见，整批不改，也不写审计。有一个无权，整批不改负责人，只给无权的写拒绝审计。
 * 不拨号，不发信，不调用 AI，不碰抑制或合规。
 */

export const QUEUE_OWNER_REASSIGN_MAX = 100;

const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ALLOWED_BODY = new Set(["targets", "transferTo"]);
const ALLOWED_TARGET = new Set(["targetType", "targetId"]);

export type QueueOwnerTargetType = "customer" | "lead" | "prospect";

export interface QueueOwnerTarget {
  targetType: QueueOwnerTargetType;
  targetId: string;
}

function isTargetType(value: string): value is QueueOwnerTargetType {
  return value === "customer" || value === "lead" || value === "prospect";
}

function keyOf(targetType: string, targetId: string) {
  return `${targetType}:${targetId}`;
}

function canViewTeam(user: { role?: string } | undefined) {
  return user?.role === "manager" || user?.role === "admin" || user?.role === "super_admin";
}

export function parseQueueOwnerReassign(body: unknown):
  | { ok: true; targets: QueueOwnerTarget[]; transferTo: string }
  | { ok: false; reason: "invalid_request" | "too_many" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !ALLOWED_BODY.has(key))) return { ok: false, reason: "invalid_request" };
  if (!Array.isArray(record.targets) || record.targets.length === 0) return { ok: false, reason: "invalid_request" };
  if (record.targets.length > QUEUE_OWNER_REASSIGN_MAX) return { ok: false, reason: "too_many" };
  const targets: QueueOwnerTarget[] = [];
  for (const item of record.targets) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return { ok: false, reason: "invalid_request" };
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some((key) => !ALLOWED_TARGET.has(key))) return { ok: false, reason: "invalid_request" };
    if (typeof row.targetType !== "string" || !isTargetType(row.targetType.trim())) return { ok: false, reason: "invalid_request" };
    if (typeof row.targetId !== "string" || !TARGET_ID_PATTERN.test(row.targetId.trim())) return { ok: false, reason: "invalid_request" };
    targets.push({ targetType: row.targetType.trim() as QueueOwnerTargetType, targetId: row.targetId.trim() });
  }
  if (new Set(targets.map((item) => keyOf(item.targetType, item.targetId))).size !== targets.length) {
    return { ok: false, reason: "invalid_request" };
  }
  if (typeof record.transferTo !== "string") return { ok: false, reason: "invalid_request" };
  const transferTo = record.transferTo.trim();
  if (!transferTo || transferTo.length > 64) return { ok: false, reason: "invalid_request" };
  return { ok: true, targets, transferTo };
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
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

async function readable(store: CrmStore, user: SessionUser, target: QueueOwnerTarget) {
  if (target.targetType === "customer") {
    const customer = store.customers.find((item) => item.id === target.targetId && item.teamId === user.teamId);
    if (!customer) return false;
    if (isPublicCustomer(customer)) return hasIamPermission(user, "customer.read");
    return ownerVisible(store, user, "customer.read", customer.ownerId, customer.teamId);
  }
  if (target.targetType === "lead") {
    const lead = store.leads.find((item) => item.id === target.targetId && item.teamId === user.teamId && !item.deletedAt);
    if (!lead) return false;
    return ownerVisible(store, user, "lead.read", lead.ownerId, lead.teamId);
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === target.targetId && item.teamId === user.teamId);
  if (!candidate) return false;
  return ownerVisible(store, user, "prospect.read", candidate.ownerId, candidate.teamId);
}

async function eligibleKeys(store: CrmStore, user: SessionUser) {
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return resolved;
  const scope: "mine" | "team" = canViewTeam(user) ? "team" : "mine";
  const keys = new Set<string>();
  const put = (targetType: string, targetId: string) => {
    if (!isTargetType(targetType) || !targetId) return;
    keys.add(keyOf(targetType, targetId));
  };
  for (const item of collectIntentFollowupRows(store, user, resolved.access)) put(item.targetType, item.targetId);
  for (const item of collectUnansweredPendingRows(store, user, resolved.access, scope)) put(item.targetType, item.targetId);
  for (const item of collectOtherOutcomeFollowupRows(store, user, resolved.access, scope)) put(item.targetType, item.targetId);
  for (const item of collectUnlabeledConnectedFollowupRows(store, user, resolved.access, scope)) put(item.targetType, item.targetId);
  for (const item of collectNegativeOutcomeFollowupRows(store, user, resolved.access, scope)) put(item.targetType, item.targetId);
  for (const item of await collectTodayFollowRows(store, user, scope)) put(item.targetType, item.targetId);
  return { ok: true as const, keys };
}

export async function reassignQueueOwners(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseQueueOwnerReassign(body);
  if (!parsed.ok) {
    const message = parsed.reason === "too_many"
      ? "一次最多 100 个对象"
      : "请选择同租户同事，以及客户、线索或搜客对象";
    return reject(parsed.reason, message);
  }
  const listed = await eligibleKeys(store, user);
  if (!listed.ok) return { status: listed.status, body: listed.body };
  const chosen: QueueOwnerTarget[] = [];
  let hidden = false;
  let notPending = false;
  for (const target of parsed.targets) {
    if (listed.keys.has(keyOf(target.targetType, target.targetId))) {
      chosen.push(target);
      continue;
    }
    if (!await readable(store, user, target)) hidden = true;
    else notPending = true;
  }
  if (hidden) return reject("not_found", "有对象看不见，这次没有转交", 404);
  if (notPending) return reject("not_pending", "有对象不在待跟进或还没有下次跟进的名单里，这次没有转交");
  const plans = chosen.map((target) => ({
    target,
    plan: planCallOutcomeTransfer(store, user, target, parsed.transferTo)
  }));
  const silent = plans.find((item) => !item.plan.ok && !item.plan.audit);
  if (silent && !silent.plan.ok) return reject(silent.plan.reason, silent.plan.message, silent.plan.status);
  const denied = plans.filter((item) => !item.plan.ok && item.plan.audit);
  if (denied.length) {
    const batchId = `qor_${randomUUID()}`;
    const at = outboundInstant().toISOString();
    for (const item of denied) {
      if (item.plan.ok || !item.plan.audit) continue;
      appendOwnerReassignAudit(store, {
        actorId: user.id,
        objectType: item.plan.audit.objectType,
        objectId: item.plan.audit.objectId,
        action: item.plan.audit.action,
        previousOwnerId: item.plan.audit.previousOwnerId,
        nextOwnerId: item.plan.audit.nextOwnerId,
        batchId,
        at
      });
    }
    await store.persist();
    const first = denied[0].plan;
    if (first.ok) return reject("forbidden", "没有分配权限，这次没有转交", 403);
    return reject(first.reason, first.message, first.status);
  }
  const writes = plans.filter((item) => item.plan.ok && item.plan.kind === "write" && item.plan.previous !== item.plan.next);
  if (!writes.length) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: "负责人没有变化",
        transferTo: parsed.transferTo,
        count: 0
      }
    };
  }
  const batchId = `qor_${randomUUID()}`;
  const at = outboundInstant().toISOString();
  const items = writes.map((item) => {
    if (!item.plan.ok || item.plan.kind !== "write") return null;
    const previous = item.plan.previous;
    const next = item.plan.next;
    item.plan.apply();
    appendOwnerReassignAudit(store, {
      actorId: user.id,
      objectType: item.plan.objectType,
      objectId: item.plan.objectId,
      action: "reassign_owner",
      previousOwnerId: previous,
      nextOwnerId: next,
      batchId,
      at
    });
    return {
      targetType: item.target.targetType,
      targetId: item.target.targetId,
      previousOwnerId: previous,
      ownerId: next
    };
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));
  await store.persist();
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message: `已把 ${items.length} 条转交`,
      transferTo: parsed.transferTo,
      batchId,
      count: items.length,
      items
    }
  };
}
