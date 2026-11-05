import { randomUUID } from "node:crypto";
import { hasIamPermission } from "./auth.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import { WRONG_NUMBER_ALTERNATE_REASON } from "./call-outcome-wrong-number.js";
import { collectIntentFollowupRows } from "./intent-followup-queue.js";
import { pickAlternatePhoneId } from "./missed-number-switch.js";
import { collectNegativeOutcomeFollowupRows } from "./negative-outcome-followup.js";
import { resolveOutboundCallRecordAccess } from "./outbound-call-records.js";
import { collectOtherOutcomeFollowupRows } from "./other-outcome-followup.js";
import { applyPhoneInvalidChange } from "./phone-validity.js";
import {
  isPhoneMarkedInvalid,
  listObjectPhones,
  phoneDigits
} from "./phone-validity-state.js";
import { activePreferredPhoneId, findPreferredPhone } from "./preferred-phone.js";
import type { CrmStore } from "./store.js";
import { collectTodayFollowRows } from "./today-follow-advance.js";
import { collectUnansweredPendingRows } from "./unanswered-pending-queue.js";
import { collectUnlabeledConnectedFollowupRows } from "./unlabeled-connected-followup.js";
import type { PhoneValidityAudit, PreferredPhone, PreferredPhoneAudit, SessionUser } from "./types.js";

/**
 * 工作台未接通待处理和待跟进名单上，一次把多个对象的当前外呼号码标为无效。
 * 当前外呼号码与 §106 相同：仍有效的首选，否则是 listObjectPhones 里第一个仍有效的号码。
 * 无效号仍写 phone_validities 和 phone_validity_audits。成功行共用已有的 batch_id，
 * reason_code 只接受仓库里已经有的 bad_number、out_of_service、wrong_number。
 * 首选正是此号时，按 §110 改到另一个数字不同的有效号码，原因是 wrong_number_alternate；
 * 没有则按 §66 清除，原因是 marked_invalid。不自动改其他对象上的同号，那仍是 §110 的再点一次。
 * 有一个看不见，整批不写，也不写审计。有一个无权，整批不写号码，只给无权对象写拒绝审计。
 * 不建表，不加列。不拨号，不外发，不调用外部接口，不新增外呼拦截。
 */

export const PHONE_INVALID_BATCH_MAX = 100;

export const PHONE_INVALID_BATCH_REASONS = ["bad_number", "out_of_service", "wrong_number"] as const;
export type PhoneInvalidBatchReason = (typeof PHONE_INVALID_BATCH_REASONS)[number];

export const PHONE_INVALID_BATCH_REASON_LABEL: Record<PhoneInvalidBatchReason, string> = {
  bad_number: "空号",
  out_of_service: "停机",
  wrong_number: "号码错误"
};

const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ALLOWED_BODY = new Set(["targets", "reason"]);
const ALLOWED_TARGET = new Set(["targetType", "targetId"]);

export type PhoneInvalidTargetType = "customer" | "lead" | "prospect";

export interface PhoneInvalidTarget {
  targetType: PhoneInvalidTargetType;
  targetId: string;
}

const WRITE_PERMISSION: Record<PhoneInvalidTargetType, string> = {
  customer: "customer.update",
  lead: "lead.update",
  prospect: "prospect.execute"
};

const READ_PERMISSION: Record<PhoneInvalidTargetType, string> = {
  customer: "customer.read",
  lead: "lead.read",
  prospect: "prospect.read"
};

function isTargetType(value: string): value is PhoneInvalidTargetType {
  return value === "customer" || value === "lead" || value === "prospect";
}

function isReason(value: string): value is PhoneInvalidBatchReason {
  return (PHONE_INVALID_BATCH_REASONS as readonly string[]).includes(value);
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

export function parsePhoneInvalidBatch(body: unknown):
  | { ok: true; targets: PhoneInvalidTarget[]; reason: PhoneInvalidBatchReason }
  | { ok: false; reason: "invalid_request" | "too_many" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !ALLOWED_BODY.has(key))) return { ok: false, reason: "invalid_request" };
  if (!Array.isArray(record.targets) || record.targets.length === 0) return { ok: false, reason: "invalid_request" };
  if (record.targets.length > PHONE_INVALID_BATCH_MAX) return { ok: false, reason: "too_many" };
  const targets: PhoneInvalidTarget[] = [];
  for (const item of record.targets) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return { ok: false, reason: "invalid_request" };
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some((key) => !ALLOWED_TARGET.has(key))) return { ok: false, reason: "invalid_request" };
    if (typeof row.targetType !== "string" || !isTargetType(row.targetType.trim())) return { ok: false, reason: "invalid_request" };
    if (typeof row.targetId !== "string" || !TARGET_ID_PATTERN.test(row.targetId.trim())) return { ok: false, reason: "invalid_request" };
    targets.push({ targetType: row.targetType.trim() as PhoneInvalidTargetType, targetId: row.targetId.trim() });
  }
  if (new Set(targets.map((item) => keyOf(item.targetType, item.targetId))).size !== targets.length) {
    return { ok: false, reason: "invalid_request" };
  }
  if (typeof record.reason !== "string" || !isReason(record.reason.trim())) return { ok: false, reason: "invalid_request" };
  return { ok: true, targets, reason: record.reason.trim() as PhoneInvalidBatchReason };
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

function objectOwner(store: CrmStore, teamId: string, target: PhoneInvalidTarget) {
  if (target.targetType === "customer") {
    const customer = store.customers.find((item) => item.id === target.targetId && item.teamId === teamId);
    if (!customer) return null;
    return { ownerId: customer.ownerId, publicPool: isPublicCustomer(customer) };
  }
  if (target.targetType === "lead") {
    const lead = store.leads.find((item) => item.id === target.targetId && item.teamId === teamId && !item.deletedAt);
    if (!lead) return null;
    return { ownerId: lead.ownerId, publicPool: false };
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === target.targetId && item.teamId === teamId);
  if (!candidate) return null;
  return { ownerId: candidate.ownerId, publicPool: false };
}

async function readable(store: CrmStore, user: SessionUser, target: PhoneInvalidTarget) {
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

async function writeDecision(store: CrmStore, user: SessionUser, target: PhoneInvalidTarget): Promise<WriteDecision> {
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

function currentOutboundPhone(store: CrmStore, teamId: string, target: PhoneInvalidTarget) {
  const phones = listObjectPhones(store, teamId, target.targetType, target.targetId).filter((item) =>
    item.phone.trim() && !isPhoneMarkedInvalid(store, teamId, item.phoneId)
  );
  if (!phones.length) return null;
  const preferredId = activePreferredPhoneId(store, teamId, target.targetType, target.targetId);
  const preferred = preferredId ? phones.find((item) => item.phoneId === preferredId) : undefined;
  return preferred || phones[0] || null;
}

function auditPhoneId(store: CrmStore, teamId: string, target: PhoneInvalidTarget) {
  return currentOutboundPhone(store, teamId, target)?.phoneId
    || listObjectPhones(store, teamId, target.targetType, target.targetId)[0]?.phoneId
    || "";
}

function writeRejection(
  store: CrmStore,
  user: SessionUser,
  target: PhoneInvalidTarget,
  reason: string,
  batchId: string
) {
  const phoneId = auditPhoneId(store, user.teamId, target);
  const previous = phoneId && isPhoneMarkedInvalid(store, user.teamId, phoneId) ? "invalid" : "valid";
  const row: PhoneValidityAudit = {
    id: `pva_${randomUUID()}`,
    teamId: user.teamId,
    actorId: user.id,
    at: new Date().toISOString(),
    targetType: target.targetType,
    targetId: target.targetId,
    phoneId,
    previousValue: previous,
    nextValue: previous,
    sourceCallRecordId: "",
    result: "rejected",
    reason,
    batchId
  };
  store.phoneValidityAudits.unshift(row);
}

function writePreferredSwitch(
  store: CrmStore,
  user: SessionUser,
  target: PhoneInvalidTarget,
  previousPhoneId: string,
  nextPhoneId: string
) {
  const at = new Date().toISOString();
  const existing = findPreferredPhone(store, user.teamId, target.targetType, target.targetId);
  if (existing) {
    existing.phoneId = nextPhoneId;
    existing.updatedBy = user.id;
    existing.updatedAt = at;
  } else {
    const row: PreferredPhone = {
      id: `pph_${randomUUID()}`,
      teamId: user.teamId,
      targetType: target.targetType,
      targetId: target.targetId,
      phoneId: nextPhoneId,
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
    targetType: target.targetType,
    targetId: target.targetId,
    previousPhoneId,
    nextPhoneId,
    result: "updated",
    reason: WRONG_NUMBER_ALTERNATE_REASON
  };
  store.preferredPhoneAudits.unshift(audit);
}

function markOne(
  store: CrmStore,
  user: SessionUser,
  target: PhoneInvalidTarget,
  reason: PhoneInvalidBatchReason,
  batchId: string
) {
  const chosen = currentOutboundPhone(store, user.teamId, target);
  if (!chosen) return null;
  const phones = listObjectPhones(store, user.teamId, target.targetType, target.targetId);
  const before = findPreferredPhone(store, user.teamId, target.targetType, target.targetId)?.phoneId || "";
  let preferred: "updated" | "cleared" | "unchanged" = "unchanged";
  if (before && before === chosen.phoneId) {
    const digits = phoneDigits(chosen.phone);
    const digitIds = new Set(phones.filter((item) => phoneDigits(item.phone) === digits).map((item) => item.phoneId));
    const alternate = pickAlternatePhoneId(
      phones.filter((item) => {
        const id = item.phoneId.trim();
        return id === before || !digitIds.has(id);
      }),
      before,
      (id) => isPhoneMarkedInvalid(store, user.teamId, id)
    );
    if (alternate) {
      writePreferredSwitch(store, user, target, before, alternate);
      preferred = "updated";
    }
  }
  const applied = applyPhoneInvalidChange(store, user, {
    targetType: target.targetType,
    targetId: target.targetId,
    phoneId: chosen.phoneId,
    invalid: true,
    sourceCallRecordId: "",
    batchId,
    reason
  });
  if (preferred === "unchanged" && before === chosen.phoneId && !findPreferredPhone(store, user.teamId, target.targetType, target.targetId)) {
    preferred = "cleared";
  }
  return {
    targetType: target.targetType,
    targetId: target.targetId,
    phoneId: chosen.phoneId,
    validity: applied.changed ? "updated" as const : "unchanged" as const,
    preferred
  };
}

export async function markPhoneInvalidBatch(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parsePhoneInvalidBatch(body);
  if (!parsed.ok) {
    const message = parsed.reason === "too_many"
      ? "一次最多 100 个对象"
      : "请选择空号、停机或号码错误，以及客户、线索或搜客对象";
    return reject(parsed.reason === "too_many" ? "too_many" : "invalid_request", message);
  }
  const listed = await eligibleKeys(store, user);
  if (!listed.ok) return { status: listed.status, body: listed.body };
  let hidden = false;
  let notPending = false;
  for (const target of parsed.targets) {
    if (listed.keys.has(keyOf(target.targetType, target.targetId))) continue;
    if (!await readable(store, user, target)) hidden = true;
    else notPending = true;
  }
  if (hidden) return reject("not_found", "有对象看不见，这次没有标记", 404);
  if (notPending) return reject("not_pending", "有对象不在未接通待处理或待跟进名单里，这次没有标记");
  const decisions = [];
  for (const target of parsed.targets) {
    decisions.push({ target, decision: await writeDecision(store, user, target) });
  }
  if (decisions.some((item) => item.decision.kind === "hidden")) {
    return reject("not_found", "有对象看不见，这次没有标记", 404);
  }
  const denied = decisions.filter((item) => item.decision.kind === "denied");
  if (denied.length) {
    const batchId = `pib_${randomUUID()}`;
    for (const item of denied) {
      if (item.decision.kind !== "denied") continue;
      writeRejection(store, user, item.target, item.decision.reason, batchId);
    }
    await store.persist();
    const first = denied[0]?.decision;
    if (!first || first.kind !== "denied") return reject("forbidden", "没有维护该对象的权限", 403);
    return reject(first.reason, first.message, first.status);
  }
  if (parsed.targets.some((target) => !currentOutboundPhone(store, user.teamId, target))) {
    return reject("number_unavailable", "有对象没有可以标记的当前外呼号码，这次没有标记");
  }
  const batchId = `pib_${randomUUID()}`;
  const items = parsed.targets.flatMap((target) => {
    const marked = markOne(store, user, target, parsed.reason, batchId);
    return marked ? [marked] : [];
  });
  const changed = items.filter((item) => item.validity === "updated" || item.preferred !== "unchanged");
  if (!changed.length) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: "当前外呼号码没有变化",
        reason: parsed.reason,
        reasonLabel: PHONE_INVALID_BATCH_REASON_LABEL[parsed.reason],
        count: 0,
        batchId: ""
      }
    };
  }
  await store.persist();
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message: `已把 ${changed.length} 个对象的当前外呼号码标为无效`,
      reason: parsed.reason,
      reasonLabel: PHONE_INVALID_BATCH_REASON_LABEL[parsed.reason],
      batchId,
      count: changed.length,
      items: changed
    }
  };
}
