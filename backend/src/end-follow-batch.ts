import { randomUUID } from "node:crypto";
import { hasIamPermission } from "./auth.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import { appendNextFollowUpAudit } from "./next-follow-up-audit.js";
import { collectNegativeOutcomeFollowupRows } from "./negative-outcome-followup.js";
import { outboundInstant } from "./outbound-call.js";
import { CALL_OUTCOME_NOTE_MAX, callOutcomeNoteLength, resolveOutboundCallRecordAccess } from "./outbound-call-records.js";
import {
  prospectFollowUpWriteAllowed,
  setProspectNextFollowAt
} from "./prospect-follow-up.js";
import type { CrmStore } from "./store.js";
import { collectTodayFollowRows } from "./today-follow-advance.js";
import type { NextFollowUpAuditEvent, SessionUser, WebsiteOpportunity } from "./types.js";

/**
 * 工作台里仍占着下次跟进的对象，先预览再确认，一次清空下次跟进。
 * 只收当前账号看得到的负向结果仍有下次跟进，以及今日待跟进。
 * 下次跟进仍写客户 nextReminder、线索和搜客 nextFollowAt。
 * 可选的一句原因只写在 next_follow_up_audits 的可空 reason 上，不新写跟进注记。
 * 同一次共用已有的 batch_id。不另建表。
 * 有一个看不见，整批不写，也不写审计。有一个无权，整批不改下次跟进，只给无权对象写拒绝审计。
 * 不拨号，不发信，不调用 AI，不碰抑制或合规，不新增外呼拦截。
 */

export const END_FOLLOW_BATCH_MAX = 100;
export const END_FOLLOW_REASON_MAX = CALL_OUTCOME_NOTE_MAX;

const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ALLOWED_BODY = new Set(["targets", "reason"]);
const ALLOWED_TARGET = new Set(["targetType", "targetId"]);

export type EndFollowTargetType = "customer" | "lead" | "prospect";

export interface EndFollowTarget {
  targetType: EndFollowTargetType;
  targetId: string;
}

const WRITE_PERMISSION: Record<EndFollowTargetType, string> = {
  customer: "customer.update",
  lead: "lead.update",
  prospect: "prospect.execute"
};

const READ_PERMISSION: Record<EndFollowTargetType, string> = {
  customer: "customer.read",
  lead: "lead.read",
  prospect: "prospect.read"
};

function isTargetType(value: string): value is EndFollowTargetType {
  return value === "customer" || value === "lead" || value === "prospect";
}

function keyOf(targetType: string, targetId: string) {
  return `${targetType}:${targetId}`;
}

function canViewTeam(user: { role?: string } | undefined) {
  return user?.role === "manager" || user?.role === "admin" || user?.role === "super_admin";
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function auditObjectType(targetType: EndFollowTargetType): NextFollowUpAuditEvent["objectType"] {
  if (targetType === "customer") return "customer";
  if (targetType === "lead") return "lead";
  return "prospect_candidate";
}

export function parseEndFollowBatch(body: unknown):
  | { ok: true; targets: EndFollowTarget[]; reason: string }
  | { ok: false; reason: "invalid_request" | "too_many" | "invalid_reason" | "reason_too_long" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !ALLOWED_BODY.has(key))) return { ok: false, reason: "invalid_request" };
  if (!Array.isArray(record.targets) || record.targets.length === 0) return { ok: false, reason: "invalid_request" };
  if (record.targets.length > END_FOLLOW_BATCH_MAX) return { ok: false, reason: "too_many" };
  const targets: EndFollowTarget[] = [];
  for (const item of record.targets) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return { ok: false, reason: "invalid_request" };
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some((key) => !ALLOWED_TARGET.has(key))) return { ok: false, reason: "invalid_request" };
    if (typeof row.targetType !== "string" || !isTargetType(row.targetType.trim())) return { ok: false, reason: "invalid_request" };
    if (typeof row.targetId !== "string" || !TARGET_ID_PATTERN.test(row.targetId.trim())) return { ok: false, reason: "invalid_request" };
    targets.push({ targetType: row.targetType.trim() as EndFollowTargetType, targetId: row.targetId.trim() });
  }
  if (new Set(targets.map((item) => keyOf(item.targetType, item.targetId))).size !== targets.length) {
    return { ok: false, reason: "invalid_request" };
  }
  if (record.reason !== undefined && record.reason !== null && typeof record.reason !== "string") {
    return { ok: false, reason: "invalid_reason" };
  }
  const reason = typeof record.reason === "string" ? record.reason.trim() : "";
  if (callOutcomeNoteLength(reason) > END_FOLLOW_REASON_MAX) return { ok: false, reason: "reason_too_long" };
  return { ok: true, targets, reason };
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

function objectOwner(store: CrmStore, teamId: string, target: EndFollowTarget) {
  if (target.targetType === "customer") {
    const customer = store.customers.find((item) => item.id === target.targetId && item.teamId === teamId);
    if (!customer) return null;
    return { ownerId: customer.ownerId, publicPool: isPublicCustomer(customer), name: customer.company || "" };
  }
  if (target.targetType === "lead") {
    const lead = store.leads.find((item) => item.id === target.targetId && item.teamId === teamId && !item.deletedAt);
    if (!lead) return null;
    return { ownerId: lead.ownerId, publicPool: false, name: lead.company || "" };
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === target.targetId && item.teamId === teamId);
  if (!candidate) return null;
  return { ownerId: candidate.ownerId, publicPool: false, name: candidate.company || "" };
}

async function readable(store: CrmStore, user: SessionUser, target: EndFollowTarget) {
  const owner = objectOwner(store, user.teamId, target);
  if (!owner) return false;
  if (target.targetType === "customer" && owner.publicPool) return hasIamPermission(user, READ_PERMISSION.customer);
  return ownerVisible(store, user, READ_PERMISSION[target.targetType], owner.ownerId, user.teamId);
}

async function eligibleRows(store: CrmStore, user: SessionUser) {
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return resolved;
  const scope: "mine" | "team" = canViewTeam(user) ? "team" : "mine";
  const rows = new Map<string, { target: EndFollowTarget; suppressionNotice: string }>();
  const put = (targetType: string, targetId: string, notice: string) => {
    if (!isTargetType(targetType) || !targetId) return;
    const key = keyOf(targetType, targetId);
    const current = rows.get(key);
    const text = (notice || "").trim();
    if (!current) {
      rows.set(key, { target: { targetType, targetId }, suppressionNotice: text });
      return;
    }
    if (!current.suppressionNotice && text) current.suppressionNotice = text;
  };
  for (const item of collectNegativeOutcomeFollowupRows(store, user, resolved.access, scope)) {
    put(item.targetType, item.targetId, item.suppressionNotice || "");
  }
  for (const item of await collectTodayFollowRows(store, user, scope)) {
    put(item.targetType, item.targetId, "");
  }
  return { ok: true as const, rows };
}

type WriteDecision =
  | { kind: "ok" }
  | { kind: "hidden" }
  | { kind: "denied"; status: 403 | 409; reason: "forbidden" | "public_pool" | "not_contactable"; message: string };

function rejectAction(reason: "forbidden" | "public_pool" | "not_contactable"): NextFollowUpAuditEvent["action"] {
  if (reason === "public_pool") return "batch_reject_public_pool";
  if (reason === "not_contactable") return "batch_reject_not_contactable";
  return "batch_reject_forbidden";
}

async function writeDecision(store: CrmStore, user: SessionUser, target: EndFollowTarget): Promise<WriteDecision> {
  const owner = objectOwner(store, user.teamId, target);
  if (!owner) return { kind: "hidden" };
  const canRead = target.targetType === "customer" && owner.publicPool
    ? hasIamPermission(user, READ_PERMISSION.customer)
    : await ownerVisible(store, user, READ_PERMISSION[target.targetType], owner.ownerId, user.teamId);
  if (!canRead) return { kind: "hidden" };
  if (owner.publicPool) {
    return { kind: "denied", status: 409, reason: "public_pool", message: "公池客户为只读，请先领取后再操作" };
  }
  if (!hasIamPermission(user, WRITE_PERMISSION[target.targetType])) {
    return { kind: "denied", status: 403, reason: "forbidden", message: "没有维护该对象的权限" };
  }
  if (!await ownerVisible(store, user, WRITE_PERMISSION[target.targetType], owner.ownerId, user.teamId)) {
    return { kind: "denied", status: 403, reason: "forbidden", message: "没有维护该对象的权限" };
  }
  if (target.targetType === "prospect") {
    const candidate = store.websiteOpportunities.find((item) => item.id === target.targetId && item.teamId === user.teamId);
    if (!candidate || candidate.ownerId !== user.id || !prospectFollowUpWriteAllowed(store, candidate, user.id)) {
      const excluded = candidate?.status === "excluded";
      const notOwner = !candidate || candidate.ownerId !== user.id;
      return {
        kind: "denied",
        status: notOwner ? 403 : 409,
        reason: notOwner ? "forbidden" : "not_contactable",
        message: notOwner
          ? "只有候选归属业务员可以记录跟进"
          : excluded ? "已排除的候选不在这里记录跟进" : "达到可联系后再记录跟进"
      };
    }
  }
  return { kind: "ok" };
}

function currentFollow(store: CrmStore, user: SessionUser, target: EndFollowTarget) {
  if (target.targetType === "customer") {
    return store.customers.find((item) => item.id === target.targetId && item.teamId === user.teamId)?.nextReminder || "";
  }
  if (target.targetType === "lead") {
    return store.leads.find((item) => item.id === target.targetId && item.teamId === user.teamId && !item.deletedAt)?.nextFollowAt || "";
  }
  return store.websiteOpportunities.find((item) => item.id === target.targetId && item.teamId === user.teamId)?.nextFollowAt || "";
}

interface EndFollowPlan {
  target: EndFollowTarget;
  name: string;
  previous: string;
  status: "ready" | "already_clear";
  suppressionNotice: string;
}

function planFor(store: CrmStore, user: SessionUser, target: EndFollowTarget, suppressionNotice: string): EndFollowPlan {
  const previous = currentFollow(store, user, target).trim();
  return {
    target,
    name: objectOwner(store, user.teamId, target)?.name || "",
    previous,
    status: previous ? "ready" : "already_clear",
    suppressionNotice
  };
}

function previewItem(plan: EndFollowPlan, reason: string) {
  return {
    targetType: plan.target.targetType,
    targetId: plan.target.targetId,
    name: plan.name,
    status: plan.status,
    nextFollowAt: plan.previous,
    reason,
    suppressionNotice: plan.suppressionNotice
  };
}

function clearOne(store: CrmStore, user: SessionUser, plan: EndFollowPlan, reason: string, batchId: string, at: string) {
  if (plan.target.targetType === "customer") {
    const customer = store.customers.find((item) => item.id === plan.target.targetId && item.teamId === user.teamId);
    if (customer) customer.nextReminder = "";
  } else if (plan.target.targetType === "lead") {
    const lead = store.leads.find((item) => item.id === plan.target.targetId && item.teamId === user.teamId && !item.deletedAt);
    if (lead) lead.nextFollowAt = "";
  } else {
    const candidate = store.websiteOpportunities.find((item) => item.id === plan.target.targetId && item.teamId === user.teamId);
    if (candidate) {
      setProspectNextFollowAt(store, { candidate: candidate as WebsiteOpportunity, actorId: user.id, nextFollowAt: "" });
    }
  }
  appendNextFollowUpAudit(store, {
    actorId: user.id,
    objectType: auditObjectType(plan.target.targetType),
    objectId: plan.target.targetId,
    action: "batch_clear_next_follow_up",
    oldValue: plan.previous,
    newValue: "",
    batchId,
    reason,
    at
  });
  return previewItem(plan, reason);
}

async function screen(store: CrmStore, user: SessionUser, body: unknown, writeRejections: boolean) {
  const parsed = parseEndFollowBatch(body);
  if (!parsed.ok) {
    const message = parsed.reason === "too_many"
      ? "一次最多 100 个对象"
      : parsed.reason === "reason_too_long"
        ? "原因最长 200 字"
        : parsed.reason === "invalid_reason"
          ? "原因不正确"
          : "请选择客户、线索或搜客对象";
    return { ok: false as const, error: reject(parsed.reason === "invalid_request" ? "invalid_request" : parsed.reason, message) };
  }
  const listed = await eligibleRows(store, user);
  if (!listed.ok) return { ok: false as const, error: { status: listed.status, body: listed.body } };
  let hidden = false;
  let notPending = false;
  const chosen: Array<{ target: EndFollowTarget; suppressionNotice: string }> = [];
  for (const target of parsed.targets) {
    const row = listed.rows.get(keyOf(target.targetType, target.targetId));
    if (row) {
      chosen.push(row);
      continue;
    }
    if (!await readable(store, user, target)) hidden = true;
    else notPending = true;
  }
  if (hidden) return { ok: false as const, error: reject("not_found", "有对象看不见，这次没有清空", 404) };
  if (notPending) return { ok: false as const, error: reject("not_pending", "有对象不在待跟进名单里，这次没有清空") };
  const decisions = [];
  for (const row of chosen) {
    decisions.push({ row, decision: await writeDecision(store, user, row.target) });
  }
  if (decisions.some((item) => item.decision.kind === "hidden")) {
    return { ok: false as const, error: reject("not_found", "有对象看不见，这次没有清空", 404) };
  }
  const denied = decisions.filter((item) => item.decision.kind === "denied");
  if (denied.length) {
    if (writeRejections) {
      const batchId = `nfc_${randomUUID()}`;
      const at = outboundInstant().toISOString();
      for (const item of denied) {
        if (item.decision.kind !== "denied") continue;
        appendNextFollowUpAudit(store, {
          actorId: user.id,
          objectType: auditObjectType(item.row.target.targetType),
          objectId: item.row.target.targetId,
          action: rejectAction(item.decision.reason),
          oldValue: "",
          newValue: "",
          batchId,
          at
        });
      }
      await store.persist();
    }
    const first = denied[0]?.decision;
    if (!first || first.kind !== "denied") return { ok: false as const, error: reject("forbidden", "没有维护该对象的权限", 403) };
    return { ok: false as const, error: reject(first.reason, first.message, first.status) };
  }
  return {
    ok: true as const,
    reason: parsed.reason,
    plans: chosen.map((row) => planFor(store, user, row.target, row.suppressionNotice))
  };
}

export async function previewEndFollowBatch(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const screened = await screen(store, user, body, false);
  if (!screened.ok) return screened.error;
  const items = screened.plans.map((plan) => previewItem(plan, screened.reason));
  const skipped = items.filter((item) => item.status === "already_clear");
  return {
    status: 200,
    body: {
      result: "preview" as const,
      message: "已列出将要清空的下次跟进。确认之后才会写下",
      reason: screened.reason,
      count: items.length - skipped.length,
      skipped: skipped.length,
      items
    }
  };
}

export async function applyEndFollowBatch(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const screened = await screen(store, user, body, true);
  if (!screened.ok) return screened.error;
  const ready = screened.plans.filter((item) => item.status === "ready");
  const skipped = screened.plans.filter((item) => item.status === "already_clear").map((plan) => previewItem(plan, screened.reason));
  if (!ready.length) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: "没有需要清空的下次跟进",
        count: 0,
        batchId: "",
        reason: screened.reason,
        skipped
      }
    };
  }
  const batchId = `nfc_${randomUUID()}`;
  const at = outboundInstant().toISOString();
  const items = ready.map((plan) => clearOne(store, user, plan, screened.reason, batchId, at));
  await store.persist();
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message: `已清空 ${items.length} 条下次跟进`,
      batchId,
      reason: screened.reason,
      count: items.length,
      items,
      skipped
    }
  };
}
