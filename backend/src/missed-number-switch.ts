import { isMoreRecentCall } from "./intent-followup-queue.js";
import { isEstablishedCall } from "./outbound-call-records.js";
import {
  isPhoneMarkedInvalid,
  listObjectPhones,
  resolveCallRecordPhone
} from "./phone-validity-state.js";
import {
  assignPreferredPhone,
  loadPreferredPhoneWriteTarget,
  recordPreferredPhoneRejection
} from "./preferred-phone.js";
import type { CrmStore } from "./store.js";
import type { OutboundCallRecord, SessionUser } from "./types.js";

/**
 * 最近一通没接通时，把首选改到同一对象上另一个仍有效的号码。
 * 只写 preferred_phones 和 preferred_phone_audits。不拨号，不挡拨号，不标记无效。
 * 不读、不写暂停外呼，也不改今日不再拨。
 */

const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes", "phones", "phoneIds"] as const;
const TARGET_TYPES = ["customer", "lead", "prospect"] as const;
const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

type TargetType = (typeof TARGET_TYPES)[number];

function isTargetType(value: string): value is TargetType {
  return (TARGET_TYPES as readonly string[]).includes(value);
}

export function parseMissedNumberSwitchRequest(body: unknown):
  | { ok: true; targetType: TargetType; targetId: string }
  | { ok: false; reason: "invalid_request" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(record).some((key) => !["targetType", "targetId"].includes(key))) return { ok: false, reason: "invalid_request" };
  if (typeof record.targetType !== "string" || !isTargetType(record.targetType)) return { ok: false, reason: "invalid_request" };
  if (typeof record.targetId !== "string" || !TARGET_ID_PATTERN.test(record.targetId.trim())) {
    return { ok: false, reason: "invalid_request" };
  }
  return { ok: true, targetType: record.targetType, targetId: record.targetId.trim() };
}

/** 按 listObjectPhones 的顺序，取第一个不是刚未接通、且未标记无效的号码。 */
export function pickAlternatePhoneId(
  phones: readonly { phoneId: string }[],
  missedPhoneId: string,
  isInvalid: (phoneId: string) => boolean
) {
  const missed = missedPhoneId.trim();
  for (const phone of phones) {
    const phoneId = phone.phoneId.trim();
    if (!phoneId || phoneId === missed || isInvalid(phoneId)) continue;
    return phoneId;
  }
  return "";
}

export function selectLatestObjectCall<T extends Pick<OutboundCallRecord, "id" | "teamId" | "targetType" | "targetId" | "startTimeRaw" | "createdAt" | "updatedAt">>(
  records: readonly T[],
  teamId: string,
  targetType: string,
  targetId: string
) {
  let latest: T | null = null;
  for (const record of records) {
    if (record.teamId !== teamId || record.targetType !== targetType || record.targetId !== targetId) continue;
    if (!latest || isMoreRecentCall(record, latest)) latest = record;
  }
  return latest;
}

function rejected(reason: string, message: string, status = 400, callRecordId = "") {
  return {
    status,
    body: {
      result: "rejected" as const,
      reason,
      message,
      ...(callRecordId ? { callRecordId } : {})
    }
  };
}

export async function switchPreferredAfterMiss(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseMissedNumberSwitchRequest(body);
  if (!parsed.ok) return rejected(parsed.reason, "一次只能为一个对象把首选改到另一个号码");
  const ready = await loadPreferredPhoneWriteTarget(store, user, parsed.targetType, parsed.targetId);
  if (!ready.ok) return { status: ready.status, body: ready.body };
  const action = ready.previousPhoneId ? "update" as const : "set" as const;
  const latest = selectLatestObjectCall(store.outboundCallRecords, user.teamId, ready.targetType, ready.targetId);
  if (!latest) {
    return recordPreferredPhoneRejection(store, user, {
      action,
      targetType: ready.targetType,
      targetId: ready.targetId,
      previousPhoneId: ready.previousPhoneId,
      nextPhoneId: "",
      reason: "no_call",
      status: 400,
      message: "这个对象还没有通话，不改首选"
    });
  }
  if (isEstablishedCall(latest.establishedTimeRaw || "")) {
    const denied = await recordPreferredPhoneRejection(store, user, {
      action,
      targetType: ready.targetType,
      targetId: ready.targetId,
      previousPhoneId: ready.previousPhoneId,
      nextPhoneId: "",
      reason: "already_connected",
      status: 400,
      message: "最近一通已经接通，不改首选"
    });
    return { status: denied.status, body: { ...denied.body, callRecordId: latest.id } };
  }
  const resolved = resolveCallRecordPhone(store, latest);
  if (!resolved.ok) {
    const denied = await recordPreferredPhoneRejection(store, user, {
      action,
      targetType: ready.targetType,
      targetId: ready.targetId,
      previousPhoneId: ready.previousPhoneId,
      nextPhoneId: "",
      reason: "number_unresolved",
      status: 400,
      message: "对不上这次未接通的号码，不改首选"
    });
    return { status: denied.status, body: { ...denied.body, callRecordId: latest.id } };
  }
  const nextPhoneId = pickAlternatePhoneId(
    listObjectPhones(store, user.teamId, ready.targetType, ready.targetId),
    resolved.phone.phoneId,
    (phoneId) => isPhoneMarkedInvalid(store, user.teamId, phoneId)
  );
  if (!nextPhoneId) {
    const denied = await recordPreferredPhoneRejection(store, user, {
      action,
      targetType: ready.targetType,
      targetId: ready.targetId,
      previousPhoneId: ready.previousPhoneId,
      nextPhoneId: "",
      reason: "no_alternate",
      status: 400,
      message: "没有另一个仍有效的号码"
    });
    return { status: denied.status, body: { ...denied.body, callRecordId: latest.id } };
  }
  const outcome = await assignPreferredPhone(store, user, {
    targetType: ready.targetType,
    targetId: ready.targetId,
    phoneId: nextPhoneId,
    successReason: "missed_alternate",
    successMessage: "已把首选改到另一个号码"
  });
  return {
    status: outcome.status,
    body: { ...outcome.body, callRecordId: latest.id }
  };
}
