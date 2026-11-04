import { randomUUID } from "node:crypto";
import { hasIamPermission } from "./auth.js";
import { WRONG_NUMBER_ALTERNATE_REASON } from "./call-outcome-wrong-number.js";
import { pickAlternatePhoneId } from "./missed-number-switch.js";
import { applyPhoneInvalidChange } from "./phone-validity.js";
import {
  isPhoneMarkedInvalid,
  listObjectPhones,
  locateObjectPhone,
  phoneDigits,
  type PhoneValidityValue
} from "./phone-validity-state.js";
import { findPreferredPhone, releasePreferredPhonesMarkedInvalid } from "./preferred-phone.js";
import type { CrmStore } from "./store.js";
import type { PhoneValidityAudit, PreferredPhone, PreferredPhoneAudit, SessionUser } from "./types.js";

/**
 * 同一个规范化号码出现在本租户多个对象上时，坐席标无效之后可以再点一次，
 * 把其他可见、有写权限的对象上的同号也标为无效。
 * 不自动执行。首选正是此号时，按 §102 的取法改到另一个有效号码，原因用 §109 的 wrong_number_alternate；
 * 没有另一个有效号码时清掉首选。
 * 不建表。不拨号，不外发，不调用外部接口。
 */

const TARGET_TYPES = ["customer", "lead", "prospect"] as const;
const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "phones", "phoneIds", "outcomes", "items"] as const;
const LINK_LIMIT = 100;
const ID_PATTERN = /^[A-Za-z0-9_:-]{1,64}$/;
const PHONE_ID_PATTERN = /^[A-Za-z0-9_:-]{1,128}$/;

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

export interface SameNumberTarget {
  targetType: TargetType;
  targetId: string;
  phoneId: string;
  preferred: "updated" | "cleared" | "unchanged";
  validity: "updated" | "unchanged";
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function isTargetType(value: string): value is TargetType {
  return (TARGET_TYPES as readonly string[]).includes(value);
}

function parsedIdentity(record: Record<string, unknown>, allowed: readonly string[]) {
  if (BATCH_KEYS.some((key) => key in record)) return null;
  if (Object.keys(record).some((key) => !allowed.includes(key))) return null;
  if (typeof record.targetType !== "string" || !isTargetType(record.targetType)) return null;
  if (typeof record.targetId !== "string" || !ID_PATTERN.test(record.targetId.trim())) return null;
  if (typeof record.phoneId !== "string" || !PHONE_ID_PATTERN.test(record.phoneId.trim())) return null;
  return {
    targetType: record.targetType,
    targetId: record.targetId.trim(),
    phoneId: record.phoneId.trim()
  };
}

export function parseSameNumberInvalidQuery(query: Record<string, unknown>) {
  return parsedIdentity(query, ["targetType", "targetId", "phoneId"]);
}

export function parseSameNumberInvalidRequest(body: unknown) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  return parsedIdentity(body as Record<string, unknown>, ["targetType", "targetId", "phoneId"]);
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

async function canRead(store: CrmStore, user: SessionUser, targetType: TargetType, ownerId: string) {
  if (await ownerVisible(store, user, READ_PERMISSION[targetType], ownerId, user.teamId)) return true;
  return ownerVisible(store, user, WRITE_PERMISSION[targetType], ownerId, user.teamId);
}

async function canWrite(store: CrmStore, user: SessionUser, targetType: TargetType, ownerId: string) {
  return ownerVisible(store, user, WRITE_PERMISSION[targetType], ownerId, user.teamId);
}

function objectOwner(store: CrmStore, teamId: string, targetType: TargetType, targetId: string) {
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

function consider(
  store: CrmStore,
  teamId: string,
  digits: string,
  sourceType: TargetType,
  sourceId: string,
  targetType: TargetType,
  targetId: string,
  found: Map<string, { targetType: TargetType; targetId: string; ownerId: string; publicPool: boolean; phoneIds: string[] }>
) {
  const key = `${targetType}:${targetId}`;
  if (found.has(key) || (targetType === sourceType && targetId === sourceId)) return;
  const phones = listObjectPhones(store, teamId, targetType, targetId);
  const same = phones.filter((item) => phoneDigits(item.phone) === digits);
  if (!same.length) return;
  const pending = same.filter((item) => !isPhoneMarkedInvalid(store, teamId, item.phoneId));
  if (!pending.length) return;
  const owner = objectOwner(store, teamId, targetType, targetId);
  if (!owner || owner.publicPool) return;
  found.set(key, {
    targetType,
    targetId,
    ownerId: owner.ownerId,
    publicPool: false,
    phoneIds: pending.map((item) => item.phoneId)
  });
}

async function collectLinkTargets(
  store: CrmStore,
  user: SessionUser,
  sourceType: TargetType,
  sourceId: string,
  digits: string
) {
  const found = new Map<string, { targetType: TargetType; targetId: string; ownerId: string; publicPool: boolean; phoneIds: string[] }>();
  for (const customer of store.customers) {
    if (customer.teamId !== user.teamId) continue;
    consider(store, user.teamId, digits, sourceType, sourceId, "customer", customer.id, found);
  }
  for (const lead of store.leads) {
    if (lead.teamId !== user.teamId || lead.deletedAt) continue;
    consider(store, user.teamId, digits, sourceType, sourceId, "lead", lead.id, found);
  }
  for (const candidate of store.websiteOpportunities) {
    if (candidate.teamId !== user.teamId) continue;
    consider(store, user.teamId, digits, sourceType, sourceId, "prospect", candidate.id, found);
  }
  const ranked = [...found.values()].sort((left, right) => {
    const typeOrder = TARGET_TYPES.indexOf(left.targetType) - TARGET_TYPES.indexOf(right.targetType);
    if (typeOrder !== 0) return typeOrder;
    return left.targetId < right.targetId ? -1 : left.targetId > right.targetId ? 1 : 0;
  });
  const visible = [];
  for (const item of ranked) {
    if (!await canWrite(store, user, item.targetType, item.ownerId)) continue;
    visible.push(item);
    if (visible.length >= LINK_LIMIT) break;
  }
  return visible;
}

function writePreferredSwitch(
  store: CrmStore,
  user: SessionUser,
  targetType: TargetType,
  targetId: string,
  previousPhoneId: string,
  nextPhoneId: string
) {
  const at = new Date().toISOString();
  const existing = findPreferredPhone(store, user.teamId, targetType, targetId);
  if (existing) {
    existing.phoneId = nextPhoneId;
    existing.updatedBy = user.id;
    existing.updatedAt = at;
  } else {
    const row: PreferredPhone = {
      id: `pph_${randomUUID()}`,
      teamId: user.teamId,
      targetType,
      targetId,
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
    targetType,
    targetId,
    previousPhoneId,
    nextPhoneId,
    result: "updated",
    reason: WRONG_NUMBER_ALTERNATE_REASON
  };
  store.preferredPhoneAudits.unshift(audit);
}

function sameDigitIds(store: CrmStore, teamId: string, targetType: TargetType, targetId: string, digits: string) {
  return new Set(
    listObjectPhones(store, teamId, targetType, targetId)
      .filter((item) => phoneDigits(item.phone) === digits)
      .map((item) => item.phoneId)
  );
}

function applyOne(
  store: CrmStore,
  user: SessionUser,
  item: { targetType: TargetType; targetId: string; phoneIds: string[] },
  digits: string,
  batchId: string
): SameNumberTarget[] {
  const phones = listObjectPhones(store, user.teamId, item.targetType, item.targetId);
  const preferredId = findPreferredPhone(store, user.teamId, item.targetType, item.targetId)?.phoneId || "";
  const digitIds = sameDigitIds(store, user.teamId, item.targetType, item.targetId, digits);
  let preferred: SameNumberTarget["preferred"] = "unchanged";
  if (preferredId && digitIds.has(preferredId)) {
    const alternate = pickAlternatePhoneId(
      phones.filter((phone) => {
        const id = phone.phoneId.trim();
        return id === preferredId || !digitIds.has(id);
      }),
      preferredId,
      (id) => isPhoneMarkedInvalid(store, user.teamId, id)
    );
    if (alternate) {
      writePreferredSwitch(store, user, item.targetType, item.targetId, preferredId, alternate);
      preferred = "updated";
    } else if (!item.phoneIds.includes(preferredId)) {
      releasePreferredPhonesMarkedInvalid(store, user, preferredId);
      preferred = "cleared";
    } else {
      preferred = "cleared";
    }
  }
  const rows: SameNumberTarget[] = [];
  for (const phoneId of item.phoneIds) {
    const applied = applyPhoneInvalidChange(store, user, {
      targetType: item.targetType,
      targetId: item.targetId,
      phoneId,
      invalid: true,
      sourceCallRecordId: "",
      batchId
    });
    rows.push({
      targetType: item.targetType,
      targetId: item.targetId,
      phoneId,
      preferred,
      validity: applied.changed ? "updated" : "unchanged"
    });
  }
  return rows;
}

function writeRejection(
  store: CrmStore,
  user: SessionUser,
  input: { targetType: TargetType; targetId: string; phoneId: string; reason: string }
) {
  const previous: PhoneValidityValue = isPhoneMarkedInvalid(store, user.teamId, input.phoneId) ? "invalid" : "valid";
  const row: PhoneValidityAudit = {
    id: `pva_${randomUUID()}`,
    teamId: user.teamId,
    actorId: user.id,
    at: new Date().toISOString(),
    targetType: input.targetType,
    targetId: input.targetId,
    phoneId: input.phoneId,
    previousValue: previous,
    nextValue: previous,
    sourceCallRecordId: "",
    result: "rejected",
    reason: input.reason,
    batchId: ""
  };
  store.phoneValidityAudits.unshift(row);
}

async function sourceContext(store: CrmStore, user: SessionUser, targetType: TargetType, targetId: string, phoneId: string): Promise<
  | { ok: false; status: 404; reason: "not_found"; message: string }
  | { ok: true; located: Extract<ReturnType<typeof locateObjectPhone>, { ok: true }>; owner: { ownerId: string; publicPool: boolean } }
> {
  const located = locateObjectPhone(store, user.teamId, targetType, targetId, phoneId);
  if (!located.ok) return { ok: false, status: 404, reason: "not_found", message: "号码不存在" };
  const owner = objectOwner(store, user.teamId, targetType, targetId);
  if (!owner || !await canRead(store, user, targetType, located.phone.ownerId)) {
    return { ok: false, status: 404, reason: "not_found", message: "号码不存在" };
  }
  return { ok: true, located, owner };
}

export async function readSameNumberInvalid(
  store: CrmStore,
  user: SessionUser | undefined,
  query: Record<string, unknown>
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseSameNumberInvalidQuery(query);
  if (!parsed) return reject("invalid_request", "一次只能查看一个已经标无效的号码");
  const source = await sourceContext(store, user, parsed.targetType, parsed.targetId, parsed.phoneId);
  if (!source.ok) return reject(source.reason, source.message, source.status);
  const digits = phoneDigits(source.located.phone.phone);
  const writable = !source.owner.publicPool && await canWrite(store, user, parsed.targetType, source.located.phone.ownerId);
  if (!digits || !writable || !isPhoneMarkedInvalid(store, user.teamId, parsed.phoneId)) {
    return { status: 200, body: { count: 0, targets: [] as Array<{ targetType: TargetType; targetId: string; phoneId: string }> } };
  }
  const targets = await collectLinkTargets(store, user, parsed.targetType, parsed.targetId, digits);
  return {
    status: 200,
    body: {
      count: targets.length,
      targets: targets.flatMap((item) => item.phoneIds.map((phoneId) => ({
        targetType: item.targetType,
        targetId: item.targetId,
        phoneId
      })))
    }
  };
}

export async function linkSameNumberInvalid(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseSameNumberInvalidRequest(body);
  if (!parsed) return reject("invalid_request", "一次只能联动一个已经标无效的号码");
  const source = await sourceContext(store, user, parsed.targetType, parsed.targetId, parsed.phoneId);
  if (!source.ok) return reject(source.reason, source.message, source.status);
  if (source.owner.publicPool) {
    writeRejection(store, user, { ...parsed, reason: "public_pool" });
    await store.persist();
    return reject("public_pool", "公池客户为只读，请先领取后再操作", 409);
  }
  if (!hasIamPermission(user, WRITE_PERMISSION[parsed.targetType])) {
    writeRejection(store, user, { ...parsed, reason: "forbidden" });
    await store.persist();
    return reject("forbidden", "没有维护该对象的权限", 403);
  }
  if (!await canWrite(store, user, parsed.targetType, source.located.phone.ownerId)) {
    writeRejection(store, user, { ...parsed, reason: "not_found" });
    await store.persist();
    return reject("not_found", "号码不存在", 404);
  }
  if (!isPhoneMarkedInvalid(store, user.teamId, parsed.phoneId)) {
    return reject("not_invalid", "先把这个号码标为无效，再联动其他对象");
  }
  const digits = phoneDigits(source.located.phone.phone);
  if (!digits) return reject("number_unavailable", "这个号码不能和其他对象对齐");
  const targets = await collectLinkTargets(store, user, parsed.targetType, parsed.targetId, digits);
  if (!targets.length) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: "没有其他还有效的同号对象",
        count: 0,
        batchId: "",
        targets: [] as SameNumberTarget[]
      }
    };
  }
  const batchId = `pvb_${randomUUID()}`;
  const applied = targets.flatMap((item) => applyOne(store, user, item, digits, batchId));
  const changed = applied.some((item) => item.validity === "updated" || item.preferred !== "unchanged");
  if (!changed) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: "没有其他还有效的同号对象",
        count: 0,
        batchId: "",
        targets: [] as SameNumberTarget[]
      }
    };
  }
  await store.persist();
  const objectCount = new Set(applied.map((item) => `${item.targetType}:${item.targetId}`)).size;
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message: `已把其他 ${objectCount} 个对象上的这个号码标为无效`,
      count: objectCount,
      batchId,
      targets: applied
    }
  };
}
