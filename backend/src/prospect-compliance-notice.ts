import type { CrmStore } from "./store.js";
import type {
  ProspectContactVerificationSnapshot,
  ProspectSuppressionEvent,
  TenantProspect,
  WebsiteOpportunity
} from "./types.js";

export type ProspectComplianceNoticeKind =
  | "suppressed"
  | "opted_out"
  | "bounced"
  | "invalid";

/** 只读投影：不写库，也不生成解除动作。 */
export interface ProspectComplianceNotice {
  kind: ProspectComplianceNoticeKind;
  label: string;
  reason: string;
  source: string;
}

const MISSING_REASON = "原因未回传";

type NoticeStore = Pick<
  CrmStore,
  | "prospectSuppressionEvents"
  | "prospectContactVerificationSnapshots"
  | "tenantProspects"
>;

function uniqueText(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => (value || "").trim()).filter(Boolean))];
}

function joined(values: Array<string | undefined>, separator = "；") {
  return uniqueText(values).join(separator);
}

function reasonOrMissing(value: string) {
  return value.trim() || MISSING_REASON;
}

function isOptOutCode(code: string) {
  const normalized = code.trim().toLowerCase().replace(/-/g, "_");
  return [
    "unsubscribed",
    "opted_out",
    "opt_out",
    "contact_opted_out"
  ].includes(normalized);
}

function visibleSuppression(
  event: ProspectSuppressionEvent,
  candidate: WebsiteOpportunity
) {
  if (event.teamId !== candidate.teamId) return null;
  if (!candidate.tenantProspectId || event.prospectId !== candidate.tenantProspectId) {
    return null;
  }
  const owned = event.ownerId === candidate.ownerId;
  if (!owned && !event.scope.startsWith("organization_")) return null;
  return {
    scopeKeyHash: event.scopeKeyHash,
    action: event.action,
    reasonCode: owned ? event.reasonCode : "SUPPRESSED",
    reasonNote: owned ? event.reasonNote : "",
    effectiveAt: event.effectiveAt,
    expiresAt: event.expiresAt,
    createdAt: event.createdAt
  };
}

function activeSuppressions(
  store: NoticeStore,
  candidate: WebsiteOpportunity,
  at: string
) {
  const latest = new Map<string, NonNullable<ReturnType<typeof visibleSuppression>>>();
  for (const event of store.prospectSuppressionEvents) {
    const visible = visibleSuppression(event, candidate);
    if (!visible) continue;
    const current = latest.get(visible.scopeKeyHash);
    if (!current || current.createdAt < visible.createdAt) {
      latest.set(visible.scopeKeyHash, visible);
    }
  }
  return [...latest.values()].filter((event) =>
    event.action === "imposed"
    && event.effectiveAt <= at
    && !(event.expiresAt && event.expiresAt < at)
  );
}

function latestVerifications(
  store: NoticeStore,
  candidate: WebsiteOpportunity
) {
  if (!candidate.tenantProspectId) return [];
  const latest = new Map<string, ProspectContactVerificationSnapshot>();
  for (const item of store.prospectContactVerificationSnapshots) {
    if (item.teamId !== candidate.teamId
      || item.ownerId !== candidate.ownerId
      || item.prospectId !== candidate.tenantProspectId) continue;
    const current = latest.get(item.channelId);
    if (!current || current.createdAt < item.createdAt) latest.set(item.channelId, item);
  }
  return [...latest.values()];
}

function formalProspect(
  store: NoticeStore,
  candidate: WebsiteOpportunity
): TenantProspect | undefined {
  if (!candidate.tenantProspectId) return undefined;
  return store.tenantProspects.find((item) =>
    item.id === candidate.tenantProspectId
    && item.teamId === candidate.teamId
  );
}

/**
 * 从已有抑制事件、联系方式核验和候选状态汇总只读说明。
 * 原因只用已回传的说明或原因码；没有就写「原因未回传」。
 * 来源只使用核验记录上的 providerCode，没有则留空。
 */
export function describeProspectComplianceNotices(
  store: NoticeStore,
  candidate: WebsiteOpportunity,
  at = new Date().toISOString()
): ProspectComplianceNotice[] {
  const suppressions = activeSuppressions(store, candidate, at);
  const verifications = latestVerifications(store, candidate);
  const prospect = formalProspect(store, candidate);
  const notices: ProspectComplianceNotice[] = [];

  const otherSuppressions = suppressions.filter((item) => !isOptOutCode(item.reasonCode));
  const optOutSuppressions = suppressions.filter((item) => isOptOutCode(item.reasonCode));
  const optOutVerifications = verifications.filter((item) => item.status === "opted_out");
  const bouncedVerifications = verifications.filter((item) => item.status === "bounced");
  const invalidVerifications = verifications.filter((item) => item.status === "invalid");
  const prospectHold = Boolean(prospect && (
    prospect.status === "do_not_contact"
    || prospect.status === "excluded"
    || prospect.queueState === "suppressed"
    || prospect.exclusionMode !== "none"
  ));
  const coverageHold = candidate.coverageQueueState === "suppressed";
  const optedOut = Boolean(
    optOutSuppressions.length
    || optOutVerifications.length
    || candidate.lastReplyClassification === "unsubscribed"
  );
  const bounced = Boolean(
    bouncedVerifications.length
    || candidate.outreachState === "contact_invalid"
    || candidate.lastReplyClassification === "bounced"
  );
  const suppressed = Boolean(
    otherSuppressions.length
    || prospectHold
    || coverageHold
    || (candidate.outreachState === "suppressed" && !optedOut)
  );

  if (suppressed) {
    const prospectReason = joined([
      prospect && (prospect.status === "do_not_contact" || prospect.exclusionMode !== "none")
        ? prospect.exclusionReasonCode
        : "",
      prospect?.queueState === "suppressed" ? prospect.queueReasonCode : "",
      coverageHold ? candidate.coverageReasonCode : ""
    ]);
    const excluded = candidate.outreachState === "suppressed"
      ? candidate.excludedReason || ""
      : "";
    const doNotContact = prospect?.status === "do_not_contact"
      || otherSuppressions.some((item) => item.reasonCode === "HUMAN_DO_NOT_CONTACT");
    notices.push({
      kind: "suppressed",
      label: doNotContact ? "禁止联系" : "已抑制",
      reason: reasonOrMissing(
        joined(otherSuppressions.map((item) => item.reasonNote))
        || joined(otherSuppressions.map((item) => item.reasonCode))
        || prospectReason
        || excluded
      ),
      source: ""
    });
  }

  if (optedOut) {
    const excluded = candidate.lastReplyClassification === "unsubscribed"
      ? candidate.excludedReason || ""
      : "";
    notices.push({
      kind: "opted_out",
      label: "已退订",
      reason: reasonOrMissing(
        joined(optOutSuppressions.map((item) => item.reasonNote))
        || joined(optOutVerifications.map((item) => item.reasonCode))
        || joined(optOutSuppressions.map((item) => item.reasonCode))
        || excluded
      ),
      source: joined(optOutVerifications.map((item) => item.providerCode), "、")
    });
  }

  if (bounced) {
    notices.push({
      kind: "bounced",
      label: "已退信",
      reason: reasonOrMissing(joined(bouncedVerifications.map((item) => item.reasonCode))),
      source: joined(bouncedVerifications.map((item) => item.providerCode), "、")
    });
  }

  if (invalidVerifications.length) {
    notices.push({
      kind: "invalid",
      label: "联系方式无效",
      reason: reasonOrMissing(joined(invalidVerifications.map((item) => item.reasonCode))),
      source: joined(invalidVerifications.map((item) => item.providerCode), "、")
    });
  }

  return notices;
}
