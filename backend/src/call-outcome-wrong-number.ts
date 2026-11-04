import { randomUUID } from "node:crypto";
import { hasIamPermission } from "./auth.js";
import { pickAlternatePhoneId } from "./missed-number-switch.js";
import { applyPhoneInvalidChange } from "./phone-validity.js";
import {
  isPhoneMarkedInvalid,
  listObjectPhones,
  resolveCallRecordPhone,
  type PhoneValidityValue
} from "./phone-validity-state.js";
import { findPreferredPhone } from "./preferred-phone.js";
import type { CrmStore } from "./store.js";
import type { OutboundCallRecord, PhoneValidityAudit, PreferredPhone, PreferredPhoneAudit, SessionUser } from "./types.js";

/**
 * 单条通话结果保存为号码错误时，可以同时把这一通对上的号码标为无效。
 * 无效号仍写 phone_validities 和 phone_validity_audits。
 * 首选正是这个号码、并且还有别的有效号码时，按 listObjectPhones 的顺序改到第一个仍有效的号码。
 * 首选审计仍写 preferred_phone_audits，原因是 wrong_number_alternate。
 * 不拨号，不发信，不调用外部接口，不改抑制，不改可联系决定。
 */

export const WRONG_NUMBER_ALTERNATE_REASON = "wrong_number_alternate";

const WRITE_PERMISSION = {
  customer: "customer.update",
  lead: "lead.update",
  prospect: "prospect.execute"
} as const;

type TargetType = keyof typeof WRITE_PERMISSION;

export type WrongNumberEffect = {
  validity: "updated" | "unchanged";
  preferred: "updated" | "unchanged" | "cleared";
};

export function parseMarkNumberInvalid(outcome: string, value: unknown):
  | { ok: true; mark: boolean }
  | { ok: false; reason: "invalid_request" | "invalid_mark" } {
  if (value === undefined || value === null || value === false) return { ok: true, mark: false };
  if (value !== true) return { ok: false, reason: "invalid_request" };
  if (outcome !== "号码错误") return { ok: false, reason: "invalid_mark" };
  return { ok: true, mark: true };
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

function effectOf(
  store: CrmStore,
  teamId: string,
  phoneId: string,
  targetType: TargetType,
  targetId: string
) {
  const already = isPhoneMarkedInvalid(store, teamId, phoneId);
  const before = findPreferredPhone(store, teamId, targetType, targetId)?.phoneId || "";
  const alternate = before === phoneId
    ? pickAlternatePhoneId(
      listObjectPhones(store, teamId, targetType, targetId),
      phoneId,
      (id) => isPhoneMarkedInvalid(store, teamId, id)
    )
    : "";
  let preferred: WrongNumberEffect["preferred"] = "unchanged";
  if (alternate) preferred = "updated";
  else if (before === phoneId && !already) preferred = "cleared";
  return {
    validity: already ? "unchanged" as const : "updated" as const,
    preferred,
    alternate,
    before
  };
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

export type WrongNumberPlan =
  | { ok: true; kind: "skip" }
  | {
    ok: true;
    kind: "apply";
    phoneId: string;
    preview: () => WrongNumberEffect;
    apply: () => WrongNumberEffect;
  }
  | {
    ok: false;
    status: number;
    reason: string;
    message: string;
    audit: {
      targetType: TargetType;
      targetId: string;
      phoneId: string;
      previousValue: PhoneValidityValue;
      reason: string;
    } | null;
  };

export function appendWrongNumberRejection(
  store: CrmStore,
  user: SessionUser,
  callRecordId: string,
  audit: {
    targetType: TargetType;
    targetId: string;
    phoneId: string;
    previousValue: PhoneValidityValue;
    reason: string;
  }
) {
  const row: PhoneValidityAudit = {
    id: `pva_${randomUUID()}`,
    teamId: user.teamId,
    actorId: user.id,
    at: new Date().toISOString(),
    targetType: audit.targetType,
    targetId: audit.targetId,
    phoneId: audit.phoneId,
    previousValue: audit.previousValue,
    nextValue: audit.previousValue,
    sourceCallRecordId: callRecordId,
    result: "rejected",
    reason: audit.reason
  };
  store.phoneValidityAudits.unshift(row);
  return row;
}

export async function planWrongNumberInvalid(
  store: CrmStore,
  user: SessionUser,
  record: OutboundCallRecord
): Promise<WrongNumberPlan> {
  const resolved = resolveCallRecordPhone(store, record);
  if (!resolved.ok) {
    const message = resolved.reason === "number_changed"
      ? "这条通话上的号码和对象现在的号码不一致"
      : "这条通话上没有可以标记的号码";
    return { ok: false, status: 400, reason: resolved.reason, message, audit: null };
  }
  const phone = resolved.phone;
  const previousValue: PhoneValidityValue = isPhoneMarkedInvalid(store, user.teamId, phone.phoneId) ? "invalid" : "valid";
  if (phone.publicPool) {
    return {
      ok: false,
      status: 409,
      reason: "public_pool",
      message: "公池客户为只读，请先领取后再操作",
      audit: {
        targetType: phone.targetType,
        targetId: phone.targetId,
        phoneId: phone.phoneId,
        previousValue,
        reason: "public_pool"
      }
    };
  }
  const permission = WRITE_PERMISSION[phone.targetType];
  if (!hasIamPermission(user, permission)) {
    return {
      ok: false,
      status: 403,
      reason: "forbidden",
      message: "没有维护该对象的权限",
      audit: {
        targetType: phone.targetType,
        targetId: phone.targetId,
        phoneId: phone.phoneId,
        previousValue,
        reason: "forbidden"
      }
    };
  }
  if (!await ownerVisible(store, user, permission, phone.ownerId, user.teamId)) {
    return {
      ok: false,
      status: 404,
      reason: "not_found",
      message: "号码不存在",
      audit: {
        targetType: phone.targetType,
        targetId: phone.targetId,
        phoneId: phone.phoneId,
        previousValue,
        reason: "not_found"
      }
    };
  }
  const preview = () => {
    const effect = effectOf(store, user.teamId, phone.phoneId, phone.targetType, phone.targetId);
    return { validity: effect.validity, preferred: effect.preferred };
  };
  return {
    ok: true,
    kind: "apply",
    phoneId: phone.phoneId,
    preview,
    apply: () => {
      const effect = effectOf(store, user.teamId, phone.phoneId, phone.targetType, phone.targetId);
      if (effect.alternate) {
        writePreferredSwitch(store, user, phone.targetType, phone.targetId, effect.before, effect.alternate);
      }
      applyPhoneInvalidChange(store, user, {
        targetType: phone.targetType,
        targetId: phone.targetId,
        phoneId: phone.phoneId,
        invalid: true,
        sourceCallRecordId: record.id
      });
      return { validity: effect.validity, preferred: effect.preferred };
    }
  };
}
