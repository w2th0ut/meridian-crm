import { randomUUID } from "node:crypto";
import { hasIamPermission } from "./auth.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import {
  isPhoneMarkedInvalid,
  listObjectPhones,
  locateObjectPhone
} from "./phone-validity-state.js";
import type { CrmStore } from "./store.js";
import type { PreferredPhone, PreferredPhoneAudit, SessionUser } from "./types.js";

/**
 * 给一条客户、线索或搜客对象设置、更换或清除首选拨打号码。
 * 只写本地首选和 preferred_phone_audits。不拨号，不发信，不推进序列，不改抑制。
 * 外呼入口可以预选这个号码，但仍要人工点击，并走原来的全部门禁。
 */

const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes", "phones", "phoneIds"] as const;
const TARGET_TYPES = ["customer", "lead", "prospect"] as const;
const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

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

function hasBatchKey(record: Record<string, unknown>) {
  return BATCH_KEYS.some((key) => key in record);
}

export function parsePreferredPhoneRequest(body: unknown):
  | { ok: true; targetType: TargetType; targetId: string; phoneId: string }
  | { ok: false; reason: "invalid_request" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (hasBatchKey(record)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(record).some((key) => !["targetType", "targetId", "phoneId"].includes(key))) {
    return { ok: false, reason: "invalid_request" };
  }
  if (typeof record.targetType !== "string" || !isTargetType(record.targetType)) return { ok: false, reason: "invalid_request" };
  if (typeof record.targetId !== "string" || !TARGET_ID_PATTERN.test(record.targetId.trim())) {
    return { ok: false, reason: "invalid_request" };
  }
  if (typeof record.phoneId !== "string" || !record.phoneId.trim() || record.phoneId.trim().length > 128) {
    return { ok: false, reason: "invalid_request" };
  }
  return {
    ok: true,
    targetType: record.targetType,
    targetId: record.targetId.trim(),
    phoneId: record.phoneId.trim()
  };
}

export function parsePreferredPhoneClearRequest(body: unknown):
  | { ok: true; targetType: TargetType; targetId: string }
  | { ok: false; reason: "invalid_request" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (hasBatchKey(record)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(record).some((key) => !["targetType", "targetId"].includes(key))) {
    return { ok: false, reason: "invalid_request" };
  }
  if (typeof record.targetType !== "string" || !isTargetType(record.targetType)) return { ok: false, reason: "invalid_request" };
  if (typeof record.targetId !== "string" || !TARGET_ID_PATTERN.test(record.targetId.trim())) {
    return { ok: false, reason: "invalid_request" };
  }
  return { ok: true, targetType: record.targetType, targetId: record.targetId.trim() };
}

export function findPreferredPhone(
  store: { preferredPhones?: readonly PreferredPhone[] },
  teamId: string,
  targetType: string,
  targetId: string
) {
  return (store.preferredPhones || []).find((item) =>
    item.teamId === teamId && item.targetType === targetType && item.targetId === targetId
  );
}

/** 首选号码必须仍在对象当前的号码上。对不上时当作没有首选，不在读取时删行。 */
export function activePreferredPhoneId(
  store: Parameters<typeof listObjectPhones>[0] & { preferredPhones?: readonly PreferredPhone[] },
  teamId: string,
  targetType: string,
  targetId: string
) {
  const row = findPreferredPhone(store, teamId, targetType, targetId);
  if (!row?.phoneId) return "";
  const phones = listObjectPhones(store, teamId, targetType, targetId);
  return phones.some((item) => item.phoneId === row.phoneId) ? row.phoneId : "";
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

function locate(store: CrmStore, teamId: string, targetType: TargetType, targetId: string) {
  if (targetType === "customer") {
    const customer = store.customers.find((item) => item.id === targetId && item.teamId === teamId);
    if (!customer) return { ok: false as const, status: 404, reason: "not_found", message: "客户不存在" };
    return {
      ok: true as const,
      targetType,
      targetId: customer.id,
      ownerId: customer.ownerId,
      publicPool: isPublicCustomer(customer)
    };
  }
  if (targetType === "lead") {
    const lead = store.leads.find((item) => item.id === targetId && item.teamId === teamId && !item.deletedAt);
    if (!lead) return { ok: false as const, status: 404, reason: "not_found", message: "线索不存在或已删除" };
    return { ok: true as const, targetType, targetId: lead.id, ownerId: lead.ownerId, publicPool: false };
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === targetId && item.teamId === teamId);
  if (!candidate) return { ok: false as const, status: 404, reason: "not_found", message: "搜客对象不存在" };
  return { ok: true as const, targetType, targetId: candidate.id, ownerId: candidate.ownerId, publicPool: false };
}

async function accessFailure(
  store: CrmStore,
  user: SessionUser,
  located: { targetType: TargetType; ownerId: string; publicPool: boolean }
) {
  const permission = WRITE_PERMISSION[located.targetType];
  if (!hasIamPermission(user, permission) || !await ownerVisible(store, user, permission, located.ownerId, user.teamId)) {
    return { status: 403, reason: "forbidden", message: "没有操作该记录的权限" };
  }
  if (located.publicPool) {
    return { status: 409, reason: "public_pool", message: "公池客户为只读，请先领取后再操作" };
  }
  return null;
}

async function canReadTarget(store: CrmStore, user: SessionUser, targetType: TargetType, ownerId: string) {
  if (await ownerVisible(store, user, READ_PERMISSION[targetType], ownerId, user.teamId)) return true;
  return ownerVisible(store, user, WRITE_PERMISSION[targetType], ownerId, user.teamId);
}

async function writeAudit(store: CrmStore, input: Omit<PreferredPhoneAudit, "id" | "at">) {
  const audit: PreferredPhoneAudit = {
    id: `ppa_${randomUUID()}`,
    at: new Date().toISOString(),
    ...input
  };
  store.preferredPhoneAudits.unshift(audit);
  await store.persist();
  return audit;
}

function currentPhoneId(store: CrmStore, teamId: string, targetType: string, targetId: string) {
  return findPreferredPhone(store, teamId, targetType, targetId)?.phoneId || "";
}

async function rejectWithAudit(
  store: CrmStore,
  user: SessionUser,
  input: {
    action: "set" | "update" | "clear";
    targetType: TargetType | "";
    targetId: string;
    previousPhoneId: string;
    nextPhoneId: string;
    reason: string;
    status: number;
    message: string;
  }
) {
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    previousPhoneId: input.previousPhoneId,
    nextPhoneId: input.nextPhoneId,
    result: "rejected",
    reason: input.reason
  });
  return reject(input.reason, input.message, input.status);
}

function successBody(input: {
  result: "updated" | "unchanged";
  action: "set" | "update" | "clear";
  message: string;
  targetType: TargetType;
  targetId: string;
  phoneId: string;
  previousPhoneId: string;
  auditId?: string;
}) {
  return { status: 200, body: input };
}

function removePreferred(store: CrmStore, teamId: string, targetType: string, targetId: string) {
  const kept = store.preferredPhones.filter((item) => !(
    item.teamId === teamId && item.targetType === targetType && item.targetId === targetId
  ));
  store.preferredPhones.splice(0, store.preferredPhones.length, ...kept);
}

/**
 * 号码被标成无效时丢掉首选。调用方负责持久化。
 * 不是首选时不写审计。
 */
export function releasePreferredPhonesMarkedInvalid(
  store: { preferredPhones: PreferredPhone[]; preferredPhoneAudits: PreferredPhoneAudit[] },
  actor: { id: string; teamId: string },
  phoneId: string
) {
  const id = phoneId.trim();
  if (!actor.teamId || !id) return;
  const matches = store.preferredPhones.filter((item) => item.teamId === actor.teamId && item.phoneId === id);
  if (!matches.length) return;
  const kept = store.preferredPhones.filter((item) => !(item.teamId === actor.teamId && item.phoneId === id));
  store.preferredPhones.splice(0, store.preferredPhones.length, ...kept);
  const at = new Date().toISOString();
  for (const row of matches) {
    const audit: PreferredPhoneAudit = {
      id: `ppa_${randomUUID()}`,
      teamId: actor.teamId,
      actorId: actor.id,
      at,
      action: "clear",
      targetType: row.targetType,
      targetId: row.targetId,
      previousPhoneId: row.phoneId,
      nextPhoneId: "",
      result: "updated",
      reason: "marked_invalid"
    };
    store.preferredPhoneAudits.unshift(audit);
  }
}

async function apply(
  store: CrmStore,
  user: SessionUser,
  input: { clear: true; targetType: TargetType; targetId: string } | { clear: false; targetType: TargetType; targetId: string; phoneId: string }
) {
  const located = locate(store, user.teamId, input.targetType, input.targetId);
  const nextPhoneId = input.clear ? "" : input.phoneId;
  if (!located.ok) {
    return rejectWithAudit(store, user, {
      action: input.clear ? "clear" : "set",
      targetType: input.targetType,
      targetId: input.targetId,
      previousPhoneId: "",
      nextPhoneId,
      reason: located.reason,
      status: located.status,
      message: located.message
    });
  }
  const previousPhoneId = currentPhoneId(store, user.teamId, located.targetType, located.targetId);
  const action: "set" | "update" | "clear" = input.clear ? "clear" : previousPhoneId ? "update" : "set";
  const denied = await accessFailure(store, user, located);
  if (denied) {
    return rejectWithAudit(store, user, {
      action,
      targetType: located.targetType,
      targetId: located.targetId,
      previousPhoneId,
      nextPhoneId,
      reason: denied.reason,
      status: denied.status,
      message: denied.message
    });
  }
  if (!input.clear) {
    const phone = locateObjectPhone(store, user.teamId, located.targetType, located.targetId, input.phoneId);
    if (!phone.ok) {
      return rejectWithAudit(store, user, {
        action,
        targetType: located.targetType,
        targetId: located.targetId,
        previousPhoneId,
        nextPhoneId,
        reason: "unknown_phone",
        status: 400,
        message: "这个号码不在该对象上"
      });
    }
    if (isPhoneMarkedInvalid(store, user.teamId, input.phoneId)) {
      return rejectWithAudit(store, user, {
        action,
        targetType: located.targetType,
        targetId: located.targetId,
        previousPhoneId,
        nextPhoneId,
        reason: "invalid_number",
        status: 400,
        message: "已标记无效的号码不能设为首选"
      });
    }
    if (previousPhoneId === input.phoneId) {
      return successBody({
        result: "unchanged",
        action,
        message: "首选号码没有变化",
        targetType: located.targetType,
        targetId: located.targetId,
        phoneId: previousPhoneId,
        previousPhoneId
      });
    }
    const at = new Date().toISOString();
    const existing = findPreferredPhone(store, user.teamId, located.targetType, located.targetId);
    if (existing) {
      existing.phoneId = input.phoneId;
      existing.updatedBy = user.id;
      existing.updatedAt = at;
    } else {
      const row: PreferredPhone = {
        id: `pph_${randomUUID()}`,
        teamId: user.teamId,
        targetType: located.targetType,
        targetId: located.targetId,
        phoneId: input.phoneId,
        updatedBy: user.id,
        updatedAt: at
      };
      store.preferredPhones.unshift(row);
    }
    const audit = await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action,
      targetType: located.targetType,
      targetId: located.targetId,
      previousPhoneId,
      nextPhoneId: input.phoneId,
      result: "updated",
      reason: action
    });
    return successBody({
      result: "updated",
      action,
      message: action === "set" ? "已设置首选拨打号码" : "已更换首选拨打号码",
      targetType: located.targetType,
      targetId: located.targetId,
      phoneId: input.phoneId,
      previousPhoneId,
      auditId: audit.id
    });
  }
  if (!previousPhoneId) {
    return successBody({
      result: "unchanged",
      action: "clear",
      message: "当前没有首选号码",
      targetType: located.targetType,
      targetId: located.targetId,
      phoneId: "",
      previousPhoneId: ""
    });
  }
  removePreferred(store, user.teamId, located.targetType, located.targetId);
  const audit = await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "clear",
    targetType: located.targetType,
    targetId: located.targetId,
    previousPhoneId,
    nextPhoneId: "",
    result: "updated",
    reason: "clear"
  });
  return successBody({
    result: "updated",
    action: "clear",
    message: "已清除首选拨打号码",
    targetType: located.targetType,
    targetId: located.targetId,
    phoneId: "",
    previousPhoneId,
    auditId: audit.id
  });
}

export async function readPreferredPhones(
  store: CrmStore,
  user: SessionUser | undefined,
  query: { targetType?: unknown; targetId?: unknown }
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const rawType = query.targetType;
  const rawId = query.targetId;
  const hasType = !(rawType === undefined || rawType === null || rawType === "");
  const hasId = !(rawId === undefined || rawId === null || rawId === "");
  if (hasType !== hasId || Array.isArray(rawType) || Array.isArray(rawId)) {
    return reject("invalid_request", "一次只能查看一个对象，或不带对象查看当前账号看得到的首选");
  }
  if (!hasType && !hasId) {
    const items: Array<{ targetType: TargetType; targetId: string; phoneId: string }> = [];
    for (const row of store.preferredPhones) {
      if (row.teamId !== user.teamId || !isTargetType(row.targetType)) continue;
      const phoneId = activePreferredPhoneId(store, user.teamId, row.targetType, row.targetId);
      if (!phoneId) continue;
      const owner = locate(store, user.teamId, row.targetType, row.targetId);
      if (!owner.ok || !await canReadTarget(store, user, row.targetType, owner.ownerId)) continue;
      items.push({ targetType: row.targetType, targetId: row.targetId, phoneId });
    }
    return { status: 200, body: { items } };
  }
  const targetType = typeof rawType === "string" ? rawType : "";
  const targetId = typeof rawId === "string" ? rawId.trim() : "";
  if (!isTargetType(targetType) || !TARGET_ID_PATTERN.test(targetId)) {
    return reject("invalid_request", "一次只能查看一个对象的首选号码");
  }
  const owner = locate(store, user.teamId, targetType, targetId);
  if (!owner.ok || !await canReadTarget(store, user, targetType, owner.ownerId)) {
    return reject("not_found", "对象不存在", 404);
  }
  const phoneId = activePreferredPhoneId(store, user.teamId, targetType, targetId);
  const canWrite = !owner.publicPool && await ownerVisible(store, user, WRITE_PERMISSION[targetType], owner.ownerId, user.teamId);
  const phones = listObjectPhones(store, user.teamId, targetType, targetId).map((item) => ({
    phoneId: item.phoneId,
    invalid: isPhoneMarkedInvalid(store, user.teamId, item.phoneId),
    preferred: item.phoneId === phoneId
  }));
  return { status: 200, body: { targetType, targetId, phoneId, canWrite, phones } };
}

export async function setPreferredPhone(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parsePreferredPhoneRequest(body);
  if (!parsed.ok) return reject(parsed.reason, "一次只能为一个对象设置一个首选号码");
  return apply(store, user, {
    clear: false,
    targetType: parsed.targetType,
    targetId: parsed.targetId,
    phoneId: parsed.phoneId
  });
}

export async function clearPreferredPhone(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parsePreferredPhoneClearRequest(body);
  if (!parsed.ok) return reject(parsed.reason, "一次只能为一个对象清除首选号码");
  return apply(store, user, { clear: true, targetType: parsed.targetType, targetId: parsed.targetId });
}
