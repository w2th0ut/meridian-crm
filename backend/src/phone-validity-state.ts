import type { PhoneValidity } from "./types.js";

/**
 * 号码有效性的当前值。没有 phone_validities 行就是有效。
 * 只认本租户的号码 ID，不读抑制名单，也不改合规状态。
 */

export type PhoneValidityValue = "valid" | "invalid";

export interface PhoneLookupStore {
  phoneValidities?: readonly PhoneValidity[];
  outboundCallAudits: ReadonlyArray<{
    id: string;
    teamId: string;
    phoneId: string;
    targetType: string;
    targetId: string;
  }>;
  customers: ReadonlyArray<{
    id: string;
    teamId: string;
    ownerId: string;
    phone?: string;
    poolStatus?: string;
  }>;
  leads: ReadonlyArray<{
    id: string;
    teamId: string;
    ownerId: string;
    phone?: string;
    deletedAt?: string;
  }>;
  websiteOpportunities: ReadonlyArray<{
    id: string;
    teamId: string;
    ownerId: string;
    tenantProspectId?: string;
  }>;
  prospectContactChannels: ReadonlyArray<{
    id: string;
    teamId: string;
    ownerId: string;
    prospectId: string;
    channelType: string;
    value: string;
  }>;
}

export interface LocatedPhone {
  targetType: "customer" | "lead" | "prospect";
  targetId: string;
  phoneId: string;
  phone: string;
  ownerId: string;
  publicPool: boolean;
}

export function isPhoneMarkedInvalid(
  store: { phoneValidities?: readonly PhoneValidity[] },
  teamId: string,
  phoneId: string
) {
  const id = phoneId.trim();
  if (!teamId || !id) return false;
  return (store.phoneValidities || []).some((item) => item.teamId === teamId && item.phoneId === id);
}

export function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

/** 脱敏号码只留末几位。对不上就不把现在的号码当成那通通话的号码。 */
export function maskedTailMatches(phone: string, masked: string) {
  const digits = phoneDigits(phone);
  const shown = phoneDigits(masked || "");
  if (!digits) return false;
  if (!shown) return digits.length <= 4;
  return digits.endsWith(shown);
}

function customerPhoneId(customerId: string) {
  return `customer-phone:${customerId}`;
}

function leadPhoneId(leadId: string) {
  return `lead-phone:${leadId}`;
}

function customerPhone(store: PhoneLookupStore, teamId: string, customerId: string, phoneId: string) {
  if (phoneId !== customerPhoneId(customerId)) return null;
  const customer = store.customers.find((item) => item.id === customerId && item.teamId === teamId);
  const phone = (customer?.phone || "").trim();
  if (!customer || !phone) return null;
  return {
    phone,
    ownerId: customer.ownerId,
    publicPool: customer.poolStatus === "public"
  };
}

function leadPhone(store: PhoneLookupStore, teamId: string, leadId: string, phoneId: string) {
  if (phoneId !== leadPhoneId(leadId)) return null;
  const lead = store.leads.find((item) => item.id === leadId && item.teamId === teamId && !item.deletedAt);
  const phone = (lead?.phone || "").trim();
  if (!lead || !phone) return null;
  return { phone, ownerId: lead.ownerId, publicPool: false };
}

function prospectPhone(store: PhoneLookupStore, teamId: string, candidateId: string, phoneId: string) {
  const candidate = store.websiteOpportunities.find((item) => item.id === candidateId && item.teamId === teamId);
  if (!candidate?.tenantProspectId || !phoneId) return null;
  const channel = store.prospectContactChannels.find((item) =>
    item.id === phoneId
    && item.teamId === candidate.teamId
    && item.ownerId === candidate.ownerId
    && item.prospectId === candidate.tenantProspectId
    && item.channelType === "phone"
  );
  const phone = (channel?.value || "").trim();
  if (!channel || !phone) return null;
  return { phone, ownerId: candidate.ownerId, publicPool: false };
}

function phoneOnTarget(
  store: PhoneLookupStore,
  teamId: string,
  targetType: string,
  targetId: string,
  phoneId: string
) {
  if (targetType === "customer") return customerPhone(store, teamId, targetId, phoneId);
  if (targetType === "lead") return leadPhone(store, teamId, targetId, phoneId);
  if (targetType === "prospect") return prospectPhone(store, teamId, targetId, phoneId);
  return null;
}

function prospectTailMatches(store: PhoneLookupStore, record: {
  teamId: string;
  targetId: string;
  maskedNumber?: string;
}) {
  const candidate = store.websiteOpportunities.find((item) => item.id === record.targetId && item.teamId === record.teamId);
  if (!candidate?.tenantProspectId) return { matches: [] as Array<{ phoneId: string; phone: string; ownerId: string }>, anyPhone: false };
  const channels = store.prospectContactChannels.filter((item) =>
    item.teamId === candidate.teamId
    && item.ownerId === candidate.ownerId
    && item.prospectId === candidate.tenantProspectId
    && item.channelType === "phone"
    && (item.value || "").trim()
  );
  const matches = channels.flatMap((item) => {
    const phone = item.value.trim();
    if (!maskedTailMatches(phone, record.maskedNumber || "")) return [];
    return [{ phoneId: item.id, phone, ownerId: candidate.ownerId }];
  });
  return { matches, anyPhone: channels.length > 0 };
}

/**
 * 通话记录上的号码。优先用那次外呼审计的号码 ID。
 * 末 4 位对不上现在的号码时不猜测。
 */
export function resolveCallRecordPhone(
  store: PhoneLookupStore,
  record: {
    teamId: string;
    targetType: string;
    targetId: string;
    maskedNumber?: string;
    outboundCallAuditId?: string;
  }
): { ok: true; phone: LocatedPhone } | { ok: false; reason: "number_unavailable" | "number_changed" } {
  const audit = (record.outboundCallAuditId || "").trim()
    ? store.outboundCallAudits.find((item) =>
      item.id === record.outboundCallAuditId
      && item.teamId === record.teamId
      && item.targetType === record.targetType
      && item.targetId === record.targetId
      && item.phoneId.trim()
    )
    : undefined;
  const hinted = audit?.phoneId.trim() || "";
  const fallback = record.targetType === "customer"
    ? customerPhoneId(record.targetId)
    : record.targetType === "lead"
      ? leadPhoneId(record.targetId)
      : "";
  const phoneId = hinted || fallback;
  if (phoneId) {
    const located = phoneOnTarget(store, record.teamId, record.targetType, record.targetId, phoneId);
    if (!located) {
      return { ok: false, reason: hinted ? "number_changed" : "number_unavailable" };
    }
    if (!maskedTailMatches(located.phone, record.maskedNumber || "")) {
      return { ok: false, reason: "number_changed" };
    }
    if (record.targetType !== "customer" && record.targetType !== "lead" && record.targetType !== "prospect") {
      return { ok: false, reason: "number_unavailable" };
    }
    return {
      ok: true,
      phone: {
        targetType: record.targetType,
        targetId: record.targetId,
        phoneId,
        phone: located.phone,
        ownerId: located.ownerId,
        publicPool: located.publicPool
      }
    };
  }
  if (record.targetType !== "prospect") return { ok: false, reason: "number_unavailable" };
  const scanned = prospectTailMatches(store, record);
  if (scanned.matches.length !== 1) {
    return { ok: false, reason: scanned.anyPhone ? "number_changed" : "number_unavailable" };
  }
  const match = scanned.matches[0];
  return {
    ok: true,
    phone: {
      targetType: "prospect",
      targetId: record.targetId,
      phoneId: match.phoneId,
      phone: match.phone,
      ownerId: match.ownerId,
      publicPool: false
    }
  };
}

export function callPhoneValidityFields(
  store: PhoneLookupStore,
  record: {
    teamId: string;
    targetType: string;
    targetId: string;
    maskedNumber?: string;
    outboundCallAuditId?: string;
  }
) {
  const resolved = resolveCallRecordPhone(store, record);
  if (!resolved.ok) return { phoneId: "", phoneInvalid: false };
  return {
    phoneId: resolved.phone.phoneId,
    phoneInvalid: isPhoneMarkedInvalid(store, record.teamId, resolved.phone.phoneId)
  };
}

export function locateObjectPhone(
  store: PhoneLookupStore,
  teamId: string,
  targetType: string,
  targetId: string,
  phoneId: string
): { ok: true; phone: LocatedPhone } | { ok: false } {
  if (targetType !== "customer" && targetType !== "lead" && targetType !== "prospect") return { ok: false };
  const located = phoneOnTarget(store, teamId, targetType, targetId, phoneId.trim());
  if (!located) return { ok: false };
  return {
    ok: true,
    phone: {
      targetType,
      targetId,
      phoneId: phoneId.trim(),
      phone: located.phone,
      ownerId: located.ownerId,
      publicPool: located.publicPool
    }
  };
}

export function listObjectPhones(
  store: PhoneLookupStore,
  teamId: string,
  targetType: string,
  targetId: string
): LocatedPhone[] {
  if (targetType === "customer") {
    const phoneId = customerPhoneId(targetId);
    const located = customerPhone(store, teamId, targetId, phoneId);
    if (!located) return [];
    return [{ targetType, targetId, phoneId, phone: located.phone, ownerId: located.ownerId, publicPool: located.publicPool }];
  }
  if (targetType === "lead") {
    const phoneId = leadPhoneId(targetId);
    const located = leadPhone(store, teamId, targetId, phoneId);
    if (!located) return [];
    return [{ targetType, targetId, phoneId, phone: located.phone, ownerId: located.ownerId, publicPool: false }];
  }
  if (targetType !== "prospect") return [];
  const candidate = store.websiteOpportunities.find((item) => item.id === targetId && item.teamId === teamId);
  if (!candidate?.tenantProspectId) return [];
  return store.prospectContactChannels.flatMap((item) => {
    if (item.teamId !== candidate.teamId || item.ownerId !== candidate.ownerId) return [];
    if (item.prospectId !== candidate.tenantProspectId || item.channelType !== "phone") return [];
    const phone = (item.value || "").trim();
    if (!phone) return [];
    return [{
      targetType: "prospect" as const,
      targetId,
      phoneId: item.id,
      phone,
      ownerId: candidate.ownerId,
      publicPool: false
    }];
  });
}
