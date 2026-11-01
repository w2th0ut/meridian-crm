import { randomUUID } from "node:crypto";
import { hasIamPermission } from "./auth.js";
import {
  isPhoneMarkedInvalid,
  listObjectPhones,
  locateObjectPhone,
  resolveCallRecordPhone,
  type PhoneValidityValue
} from "./phone-validity-state.js";
import {
  outboundCallRecordVisible,
  resolveOutboundCallRecordAccess
} from "./outbound-call-records.js";
import { releasePreferredPhonesMarkedInvalid } from "./preferred-phone.js";
import type { CrmStore } from "./store.js";
import type { PhoneValidity, PhoneValidityAudit, SessionUser } from "./types.js";

/**
 * 把一个号码标成无效或恢复有效。
 * 只改本租户的号码有效性，并在有变化时写 phone_validity_audits。
 * 不写抑制，不改合规，不拨号，不发信，不推进序列，不转线索。
 */

const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "phones", "phoneIds", "outcomes"] as const;
const TARGET_TYPES = ["customer", "lead", "prospect"] as const;

type TargetType = (typeof TARGET_TYPES)[number];

const WRITE_PERMISSION: Record<TargetType, string> = {
  customer: "customer.update",
  lead: "lead.update",
  prospect: "prospect.execute"
};

const READ_PERMISSION: Record<TargetType, string> = {
  customer: "customer.read",
  lead: "lead.read",
  prospect: "prospect.read"
};

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function isTargetType(value: string): value is TargetType {
  return (TARGET_TYPES as readonly string[]).includes(value);
}

export function parseCallPhoneValidityRequest(body: unknown):
  | { ok: true }
  | { ok: false; reason: "invalid_request" } {
  if (body === undefined || body === null) return { ok: true };
  if (typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return { ok: false, reason: "invalid_request" };
  const keys = Object.keys(record);
  if (keys.some((key) => key !== "invalid")) return { ok: false, reason: "invalid_request" };
  if ("invalid" in record && record.invalid !== true) return { ok: false, reason: "invalid_request" };
  return { ok: true };
}

export function parsePhoneValidityRequest(body: unknown):
  | { ok: true; targetType: TargetType; targetId: string; phoneId: string; invalid: boolean }
  | { ok: false; reason: "invalid_request" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "invalid_request" };
  }
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return { ok: false, reason: "invalid_request" };
  const keys = Object.keys(record);
  if (keys.some((key) => !["targetType", "targetId", "phoneId", "invalid"].includes(key))) {
    return { ok: false, reason: "invalid_request" };
  }
  if (typeof record.targetType !== "string" || !isTargetType(record.targetType)) {
    return { ok: false, reason: "invalid_request" };
  }
  if (typeof record.targetId !== "string" || !record.targetId.trim()) {
    return { ok: false, reason: "invalid_request" };
  }
  if (typeof record.phoneId !== "string" || !record.phoneId.trim()) {
    return { ok: false, reason: "invalid_request" };
  }
  if (typeof record.invalid !== "boolean") return { ok: false, reason: "invalid_request" };
  return {
    ok: true,
    targetType: record.targetType,
    targetId: record.targetId.trim(),
    phoneId: record.phoneId.trim(),
    invalid: record.invalid
  };
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

async function canReadTarget(store: CrmStore, user: SessionUser, targetType: TargetType, ownerId: string, teamId: string) {
  if (await ownerVisible(store, user, READ_PERMISSION[targetType], ownerId, teamId)) return true;
  return ownerVisible(store, user, WRITE_PERMISSION[targetType], ownerId, teamId);
}

function objectOwner(store: CrmStore, teamId: string, targetType: string, targetId: string) {
  if (targetType === "customer") {
    const customer = store.customers.find((item) => item.id === targetId && item.teamId === teamId);
    if (!customer) return null;
    return { ownerId: customer.ownerId, publicPool: customer.poolStatus === "public" };
  }
  if (targetType === "lead") {
    const lead = store.leads.find((item) => item.id === targetId && item.teamId === teamId && !item.deletedAt);
    if (!lead) return null;
    return { ownerId: lead.ownerId, publicPool: false };
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === targetId && item.teamId === teamId);
  if (!candidate) return null;
  return { ownerId: candidate.ownerId, publicPool: false };
}

async function applyValidity(
  store: CrmStore,
  user: SessionUser,
  input: {
    targetType: TargetType;
    targetId: string;
    phoneId: string;
    invalid: boolean;
    sourceCallRecordId: string;
  }
) {
  const previous: PhoneValidityValue = isPhoneMarkedInvalid(store, user.teamId, input.phoneId) ? "invalid" : "valid";
  const next: PhoneValidityValue = input.invalid ? "invalid" : "valid";
  if (previous === next) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: next === "invalid" ? "该号码已经标记无效" : "该号码本来就是有效的",
        targetType: input.targetType,
        targetId: input.targetId,
        phoneId: input.phoneId,
        invalid: input.invalid,
        previousValue: previous,
        nextValue: next,
        sourceCallRecordId: input.sourceCallRecordId
      }
    };
  }
  const at = new Date().toISOString();
  if (next === "invalid") {
    const existing = store.phoneValidities.find((item) => item.teamId === user.teamId && item.phoneId === input.phoneId);
    if (existing) {
      existing.targetType = input.targetType;
      existing.targetId = input.targetId;
      existing.updatedBy = user.id;
      existing.updatedAt = at;
    } else {
      const row: PhoneValidity = {
        id: `phv_${randomUUID()}`,
        teamId: user.teamId,
        targetType: input.targetType,
        targetId: input.targetId,
        phoneId: input.phoneId,
        updatedBy: user.id,
        updatedAt: at
      };
      store.phoneValidities.unshift(row);
    }
  } else {
    const kept = store.phoneValidities.filter((item) => !(item.teamId === user.teamId && item.phoneId === input.phoneId));
    store.phoneValidities.splice(0, store.phoneValidities.length, ...kept);
  }
  const audit: PhoneValidityAudit = {
    id: `pva_${randomUUID()}`,
    teamId: user.teamId,
    actorId: user.id,
    at,
    targetType: input.targetType,
    targetId: input.targetId,
    phoneId: input.phoneId,
    previousValue: previous,
    nextValue: next,
    sourceCallRecordId: input.sourceCallRecordId
  };
  store.phoneValidityAudits.unshift(audit);
  if (next === "invalid") releasePreferredPhonesMarkedInvalid(store, user, input.phoneId);
  await store.persist();
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message: next === "invalid" ? "已标记该号码无效" : "已取消号码无效标记",
      targetType: input.targetType,
      targetId: input.targetId,
      phoneId: input.phoneId,
      invalid: input.invalid,
      previousValue: previous,
      nextValue: next,
      sourceCallRecordId: input.sourceCallRecordId,
      auditId: audit.id
    }
  };
}

export async function readPhoneValidity(
  store: CrmStore,
  user: SessionUser | undefined,
  query: { targetType?: unknown; targetId?: unknown }
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const targetType = typeof query.targetType === "string" ? query.targetType : "";
  const targetId = typeof query.targetId === "string" ? query.targetId.trim() : "";
  if (!isTargetType(targetType) || !targetId) {
    return reject("invalid_request", "一次只能查看一个对象的号码");
  }
  const owner = objectOwner(store, user.teamId, targetType, targetId);
  if (!owner || !await canReadTarget(store, user, targetType, owner.ownerId, user.teamId)) {
    return reject("not_found", "对象不存在", 404);
  }
  const canWrite = !owner.publicPool && await ownerVisible(store, user, WRITE_PERMISSION[targetType], owner.ownerId, user.teamId);
  const phones = listObjectPhones(store, user.teamId, targetType, targetId).map((item) => ({
    phoneId: item.phoneId,
    invalid: isPhoneMarkedInvalid(store, user.teamId, item.phoneId)
  }));
  return {
    status: 200,
    body: { targetType, targetId, canWrite, phones }
  };
}

export async function setPhoneValidity(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parsePhoneValidityRequest(body);
  if (!parsed.ok) return reject(parsed.reason, "一次只能标记或取消一个号码");
  const located = locateObjectPhone(store, user.teamId, parsed.targetType, parsed.targetId, parsed.phoneId);
  if (!located.ok) return reject("not_found", "号码不存在", 404);
  if (located.phone.publicPool) {
    return reject("public_pool", "公池客户为只读，请先领取后再操作", 409);
  }
  const permission = WRITE_PERMISSION[parsed.targetType];
  if (!hasIamPermission(user, permission)) {
    return reject("forbidden", "没有维护该对象的权限", 403);
  }
  if (!await ownerVisible(store, user, permission, located.phone.ownerId, user.teamId)) {
    return reject("not_found", "号码不存在", 404);
  }
  return applyValidity(store, user, {
    targetType: parsed.targetType,
    targetId: parsed.targetId,
    phoneId: parsed.phoneId,
    invalid: parsed.invalid,
    sourceCallRecordId: ""
  });
}

export async function markPhoneInvalidFromCall(
  store: CrmStore,
  user: SessionUser | undefined,
  callRecordId: string,
  body: unknown
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallPhoneValidityRequest(body);
  if (!parsed.ok) return reject(parsed.reason, "一次只能标记这一条通话上的号码");
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const record = store.outboundCallRecords.find((item) => item.id === callRecordId);
  if (!record || !outboundCallRecordVisible(record, user.teamId, resolved.access)) {
    return reject("not_found", "通话记录不存在", 404);
  }
  if ((record.callOutcome || "") !== "号码错误") {
    return reject("not_wrong_number", "只有标注为号码错误的通话可以标记该号码无效");
  }
  const phone = resolveCallRecordPhone(store, record);
  if (!phone.ok) {
    const message = phone.reason === "number_changed"
      ? "这条通话上的号码和对象现在的号码不一致"
      : "这条通话上没有可以标记的号码";
    return reject(phone.reason, message);
  }
  if (phone.phone.publicPool) {
    return reject("public_pool", "公池客户为只读，请先领取后再操作", 409);
  }
  const permission = WRITE_PERMISSION[phone.phone.targetType];
  if (!hasIamPermission(user, permission)) {
    return reject("forbidden", "没有维护该对象的权限", 403);
  }
  if (!await ownerVisible(store, user, permission, phone.phone.ownerId, user.teamId)) {
    return reject("not_found", "号码不存在", 404);
  }
  return applyValidity(store, user, {
    targetType: phone.phone.targetType,
    targetId: phone.phone.targetId,
    phoneId: phone.phone.phoneId,
    invalid: true,
    sourceCallRecordId: record.id
  });
}
