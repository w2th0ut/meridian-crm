import { randomUUID } from "node:crypto";
import { hasIamPermission } from "./auth.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import { collectIntentFollowupRows } from "./intent-followup-queue.js";
import { collectNegativeOutcomeFollowupRows } from "./negative-outcome-followup.js";
import { maskOutboundNumber } from "./outbound-call.js";
import { resolveOutboundCallRecordAccess } from "./outbound-call-records.js";
import { collectOtherOutcomeFollowupRows } from "./other-outcome-followup.js";
import {
  isPhoneMarkedInvalid,
  listObjectPhones
} from "./phone-validity-state.js";
import { activePreferredPhoneId, findPreferredPhone } from "./preferred-phone.js";
import type { CrmStore } from "./store.js";
import { collectTodayFollowRows } from "./today-follow-advance.js";
import { collectUnansweredPendingRows } from "./unanswered-pending-queue.js";
import { collectUnlabeledConnectedFollowupRows } from "./unlabeled-connected-followup.js";
import type { PreferredPhone, PreferredPhoneAudit, SessionUser } from "./types.js";

/**
 * 工作台未接通待处理和待跟进名单上，一次把下次外呼号码切到各自的下一个有效备用号。
 * 当前外呼号码与 §106 相同：仍有效的首选，否则是 listObjectPhones 里第一个仍有效的号码。
 * 备用号是这个号码后面的下一个仍有效号码，跳过已经标无效的，不绕回前面。
 * 没有备用号的对象只在预览里列出，不改首选。
 * 首选仍写 preferred_phones，审计仍写 preferred_phone_audits，原因是 next_backup。
 * 只读 phone_validities，不新增、不删除无效行。
 * 有一个看不见，整批不写，也不写审计。有一个无权，整批不改首选，只给无权对象写拒绝审计。
 * 不建表。只给 preferred_phone_audits 加可空 batch_id。不拨号，不外发，不新增外呼拦截。
 */

export const BACKUP_NUMBER_BATCH_MAX = 100;
export const NEXT_BACKUP_REASON = "next_backup";

const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ALLOWED_BODY = new Set(["targets"]);
const ALLOWED_TARGET = new Set(["targetType", "targetId"]);

export type BackupTargetType = "customer" | "lead" | "prospect";

export interface BackupTarget {
  targetType: BackupTargetType;
  targetId: string;
}

const WRITE_PERMISSION: Record<BackupTargetType, string> = {
  customer: "customer.update",
  lead: "lead.update",
  prospect: "prospect.execute"
};

const READ_PERMISSION: Record<BackupTargetType, string> = {
  customer: "customer.read",
  lead: "lead.read",
  prospect: "prospect.read"
};

function isTargetType(value: string): value is BackupTargetType {
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

export function parseBackupNumberBatch(body: unknown):
  | { ok: true; targets: BackupTarget[] }
  | { ok: false; reason: "invalid_request" | "too_many" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !ALLOWED_BODY.has(key))) return { ok: false, reason: "invalid_request" };
  if (!Array.isArray(record.targets) || record.targets.length === 0) return { ok: false, reason: "invalid_request" };
  if (record.targets.length > BACKUP_NUMBER_BATCH_MAX) return { ok: false, reason: "too_many" };
  const targets: BackupTarget[] = [];
  for (const item of record.targets) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return { ok: false, reason: "invalid_request" };
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some((key) => !ALLOWED_TARGET.has(key))) return { ok: false, reason: "invalid_request" };
    if (typeof row.targetType !== "string" || !isTargetType(row.targetType.trim())) return { ok: false, reason: "invalid_request" };
    if (typeof row.targetId !== "string" || !TARGET_ID_PATTERN.test(row.targetId.trim())) return { ok: false, reason: "invalid_request" };
    targets.push({ targetType: row.targetType.trim() as BackupTargetType, targetId: row.targetId.trim() });
  }
  if (new Set(targets.map((item) => keyOf(item.targetType, item.targetId))).size !== targets.length) {
    return { ok: false, reason: "invalid_request" };
  }
  return { ok: true, targets };
}

/**
 * 按 listObjectPhones 的顺序，取当前外呼号码之后的下一个仍有效号码。
 * 已经标无效的先跳过。没有后面的有效号码时 nextPhoneId 为空，不绕回前面。
 */
export function selectNextBackup(
  phones: readonly { phoneId: string; phone: string }[],
  preferredPhoneId: string,
  isInvalid: (phoneId: string) => boolean
) {
  const valid = phones.filter((item) => item.phone.trim() && item.phoneId.trim() && !isInvalid(item.phoneId));
  if (!valid.length) return { currentPhoneId: "", nextPhoneId: "" };
  const preferred = preferredPhoneId ? valid.find((item) => item.phoneId === preferredPhoneId) : undefined;
  const current = preferred || valid[0];
  const index = valid.findIndex((item) => item.phoneId === current.phoneId);
  return { currentPhoneId: current.phoneId, nextPhoneId: valid[index + 1]?.phoneId || "" };
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

function objectOwner(store: CrmStore, teamId: string, target: BackupTarget) {
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

async function readable(store: CrmStore, user: SessionUser, target: BackupTarget) {
  const owner = objectOwner(store, user.teamId, target);
  if (!owner) return false;
  if (target.targetType === "customer" && owner.publicPool) return hasIamPermission(user, READ_PERMISSION.customer);
  return ownerVisible(store, user, READ_PERMISSION[target.targetType], owner.ownerId, user.teamId);
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

type WriteDecision =
  | { kind: "ok" }
  | { kind: "hidden" }
  | { kind: "denied"; status: number; reason: string; message: string };

async function writeDecision(store: CrmStore, user: SessionUser, target: BackupTarget): Promise<WriteDecision> {
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
    return { kind: "denied", status: 404, reason: "not_found", message: "号码不存在" };
  }
  return { kind: "ok" };
}

interface BackupPlan {
  target: BackupTarget;
  name: string;
  status: "ready" | "no_backup";
  currentPhoneId: string;
  nextPhoneId: string;
  maskedCurrent: string;
  maskedNext: string;
  action: "set" | "update";
  storedPreviousPhoneId: string;
}

function planFor(store: CrmStore, teamId: string, target: BackupTarget): BackupPlan {
  const phones = listObjectPhones(store, teamId, target.targetType, target.targetId);
  const preferred = findPreferredPhone(store, teamId, target.targetType, target.targetId);
  const active = activePreferredPhoneId(store, teamId, target.targetType, target.targetId);
  const selection = selectNextBackup(phones, active, (phoneId) => isPhoneMarkedInvalid(store, teamId, phoneId));
  const current = phones.find((item) => item.phoneId === selection.currentPhoneId);
  const next = phones.find((item) => item.phoneId === selection.nextPhoneId);
  return {
    target,
    name: objectOwner(store, teamId, target)?.name || "",
    status: selection.nextPhoneId ? "ready" : "no_backup",
    currentPhoneId: selection.currentPhoneId,
    nextPhoneId: selection.nextPhoneId,
    maskedCurrent: current ? maskOutboundNumber(current.phone) : "",
    maskedNext: next ? maskOutboundNumber(next.phone) : "",
    action: preferred ? "update" : "set",
    storedPreviousPhoneId: preferred?.phoneId || ""
  };
}

function previewItem(plan: BackupPlan) {
  return {
    targetType: plan.target.targetType,
    targetId: plan.target.targetId,
    name: plan.name,
    status: plan.status,
    currentPhoneId: plan.currentPhoneId,
    nextPhoneId: plan.nextPhoneId,
    maskedCurrent: plan.maskedCurrent,
    maskedNext: plan.maskedNext
  };
}

function writeRejection(store: CrmStore, user: SessionUser, target: BackupTarget, reason: string, batchId: string) {
  const preferred = findPreferredPhone(store, user.teamId, target.targetType, target.targetId);
  const row: PreferredPhoneAudit = {
    id: `ppa_${randomUUID()}`,
    teamId: user.teamId,
    actorId: user.id,
    at: new Date().toISOString(),
    action: preferred ? "update" : "set",
    targetType: target.targetType,
    targetId: target.targetId,
    previousPhoneId: preferred?.phoneId || "",
    nextPhoneId: "",
    result: "rejected",
    reason,
    batchId
  };
  store.preferredPhoneAudits.unshift(row);
}

function applyOne(store: CrmStore, user: SessionUser, plan: BackupPlan, batchId: string) {
  const at = new Date().toISOString();
  const existing = findPreferredPhone(store, user.teamId, plan.target.targetType, plan.target.targetId);
  const previousPhoneId = existing?.phoneId || "";
  if (existing) {
    existing.phoneId = plan.nextPhoneId;
    existing.updatedBy = user.id;
    existing.updatedAt = at;
  } else {
    const row: PreferredPhone = {
      id: `pph_${randomUUID()}`,
      teamId: user.teamId,
      targetType: plan.target.targetType,
      targetId: plan.target.targetId,
      phoneId: plan.nextPhoneId,
      updatedBy: user.id,
      updatedAt: at
    };
    store.preferredPhones.unshift(row);
  }
  const audit: PreferredPhoneAudit = {
    id: `ppa_${randomUUID()}`,
    teamId: user.teamId,
    actorId: user.id,
    at,
    action: previousPhoneId ? "update" : "set",
    targetType: plan.target.targetType,
    targetId: plan.target.targetId,
    previousPhoneId,
    nextPhoneId: plan.nextPhoneId,
    result: "updated",
    reason: NEXT_BACKUP_REASON,
    batchId
  };
  store.preferredPhoneAudits.unshift(audit);
  return {
    targetType: plan.target.targetType,
    targetId: plan.target.targetId,
    name: plan.name,
    action: audit.action,
    previousPhoneId,
    nextPhoneId: plan.nextPhoneId,
    maskedCurrent: plan.maskedCurrent,
    maskedNext: plan.maskedNext
  };
}

async function screen(store: CrmStore, user: SessionUser, body: unknown, writeRejections: boolean) {
  const parsed = parseBackupNumberBatch(body);
  if (!parsed.ok) {
    const message = parsed.reason === "too_many" ? "一次最多 100 个对象" : "请选择客户、线索或搜客对象";
    return { ok: false as const, error: reject(parsed.reason === "too_many" ? "too_many" : "invalid_request", message) };
  }
  const listed = await eligibleKeys(store, user);
  if (!listed.ok) return { ok: false as const, error: { status: listed.status, body: listed.body } };
  let hidden = false;
  let notPending = false;
  for (const target of parsed.targets) {
    if (listed.keys.has(keyOf(target.targetType, target.targetId))) continue;
    if (!await readable(store, user, target)) hidden = true;
    else notPending = true;
  }
  if (hidden) return { ok: false as const, error: reject("not_found", "有对象看不见，这次没有切换", 404) };
  if (notPending) return { ok: false as const, error: reject("not_pending", "有对象不在未接通待处理或待跟进名单里，这次没有切换") };
  const decisions = [];
  for (const target of parsed.targets) {
    decisions.push({ target, decision: await writeDecision(store, user, target) });
  }
  if (decisions.some((item) => item.decision.kind === "hidden")) {
    return { ok: false as const, error: reject("not_found", "有对象看不见，这次没有切换", 404) };
  }
  const denied = decisions.filter((item) => item.decision.kind === "denied");
  if (denied.length) {
    if (writeRejections) {
      const batchId = `pbb_${randomUUID()}`;
      for (const item of denied) {
        if (item.decision.kind !== "denied") continue;
        writeRejection(store, user, item.target, item.decision.reason, batchId);
      }
      await store.persist();
    }
    const first = denied[0]?.decision;
    if (!first || first.kind !== "denied") return { ok: false as const, error: reject("forbidden", "没有维护该对象的权限", 403) };
    return { ok: false as const, error: reject(first.reason, first.message, first.status) };
  }
  return { ok: true as const, plans: parsed.targets.map((target) => planFor(store, user.teamId, target)) };
}

export async function previewBackupNumberBatch(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const screened = await screen(store, user, body, false);
  if (!screened.ok) return screened.error;
  const items = screened.plans.map(previewItem);
  const skipped = items.filter((item) => item.status === "no_backup");
  return {
    status: 200,
    body: {
      result: "preview" as const,
      message: "已列出备用号。没有备用号的对象不会切换",
      count: items.length - skipped.length,
      skipped: skipped.length,
      items
    }
  };
}

export async function applyBackupNumberBatch(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const screened = await screen(store, user, body, true);
  if (!screened.ok) return screened.error;
  const ready = screened.plans.filter((item) => item.status === "ready");
  const skipped = screened.plans.filter((item) => item.status === "no_backup").map(previewItem);
  if (!ready.length) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: "没有可以切换的备用号",
        count: 0,
        batchId: "",
        skipped
      }
    };
  }
  const batchId = `pbb_${randomUUID()}`;
  const items = ready.map((plan) => applyOne(store, user, plan, batchId));
  await store.persist();
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message: `已把 ${items.length} 个对象的下次外呼号码换成备用号`,
      batchId,
      count: items.length,
      items,
      skipped
    }
  };
}
