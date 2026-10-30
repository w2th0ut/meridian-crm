/**
 * 开发信发送失败 / 退信的只读投影。
 * 只读已有发信台账、邮件触点和批次步骤上的失败字段。
 * 不写库，不重发，不解除抑制，也不代替 Day8 的合规原因条。
 */

export type OutreachFailureKind = "send_failed" | "bounced";

export interface ProspectOutreachFailureView {
  status: "none" | "hit";
  kind: "none" | OutreachFailureKind;
  label: "无失败记录" | "发送失败" | "开发信退信";
  reason: string;
  at: string;
}

export interface OutreachFailureCandidate {
  id: string;
  teamId: string;
}

export interface OutreachFailureEmailLog {
  teamId: string;
  entityType: string;
  entityId: string;
  dispatchStatus?: string;
  dispatchError?: string;
  bouncedAt?: string;
  sentAt?: string;
  subject?: string;
}

export interface OutreachFailureTouchpoint {
  teamId: string;
  prospectCandidateId: string;
  channel?: string;
  eventType?: string;
  replyClassification?: string;
  subject?: string;
  content?: string;
  occurredAt?: string;
}

export interface OutreachFailureStep {
  status?: string;
  error?: string;
  sentAt?: string;
  scheduledAt?: string;
}

export interface OutreachFailureDelivery {
  teamId: string;
  updatedAt?: string;
  items?: Array<{
    candidateId?: string;
    steps?: OutreachFailureStep[];
  }>;
}

const SEND_REASON_MISSING = "发送失败说明未写入";
const BOUNCE_REASON_MISSING = "退信说明未写入";
const GENERIC_BOUNCE_SUBJECTS = new Set([
  "退信",
  "退信通知",
  "开发信退信",
  "mail delivery failed",
  "delivery status notification",
  "undelivered mail returned to sender"
]);

interface FailureEvent {
  kind: OutreachFailureKind;
  at: string;
  reason: string;
  fallback: boolean;
}

function text(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function time(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyFailure(): ProspectOutreachFailureView {
  return {
    status: "none",
    kind: "none",
    label: "无失败记录",
    reason: "",
    at: ""
  };
}

function reasonOf(value: string, fallback: string) {
  const cleaned = text(value).slice(0, 160);
  if (!cleaned) return { reason: fallback, fallback: true };
  return { reason: cleaned, fallback: false };
}

function bounceSubjectReason(subject: string) {
  const cleaned = text(subject);
  if (!cleaned || GENERIC_BOUNCE_SUBJECTS.has(cleaned.toLowerCase())) {
    return { reason: BOUNCE_REASON_MISSING, fallback: true };
  }
  return reasonOf(cleaned, BOUNCE_REASON_MISSING);
}

function isEmailBounce(item: OutreachFailureTouchpoint) {
  return item.channel === "email"
    && (item.eventType === "bounce" || item.replyClassification === "bounced");
}

function bounceCopy(item: OutreachFailureTouchpoint) {
  const content = reasonOf(item.content || "", BOUNCE_REASON_MISSING);
  if (!content.fallback) return content;
  return bounceSubjectReason(item.subject || "");
}

function sameCandidateLog(candidate: OutreachFailureCandidate, log: OutreachFailureEmailLog) {
  return log.teamId === candidate.teamId
    && log.entityType === "prospect_candidate"
    && log.entityId === candidate.id;
}

function sameCandidateTouchpoint(
  candidate: OutreachFailureCandidate,
  item: OutreachFailureTouchpoint
) {
  return item.teamId === candidate.teamId && item.prospectCandidateId === candidate.id;
}

/**
 * 取最近一次开发信发送失败或退信。
 * 成功发送、待发、跳过、抑制和退订都不算。没有记录时是「无失败记录」。
 */
export function describeProspectOutreachFailure(input: {
  candidate: OutreachFailureCandidate;
  emailLogs?: OutreachFailureEmailLog[];
  touchpoints?: OutreachFailureTouchpoint[];
  batches?: OutreachFailureDelivery[];
  plans?: OutreachFailureDelivery[];
}): ProspectOutreachFailureView {
  const candidate = input.candidate;
  const events: FailureEvent[] = [];
  const touchpoints = (input.touchpoints || []).filter((item) =>
    sameCandidateTouchpoint(candidate, item) && isEmailBounce(item)
  );

  for (const log of input.emailLogs || []) {
    if (!sameCandidateLog(candidate, log)) continue;
    const bouncedAt = text(log.bouncedAt);
    if (bouncedAt && time(bouncedAt)) {
      const matched = touchpoints.find((item) => text(item.occurredAt) === bouncedAt);
      const copy = matched ? bounceCopy(matched) : { reason: BOUNCE_REASON_MISSING, fallback: true };
      events.push({ kind: "bounced", at: bouncedAt, ...copy });
    }
    if ((log.dispatchStatus || "") === "uncertain") {
      const sentAt = text(log.sentAt);
      if (!sentAt || !time(sentAt)) continue;
      const copy = reasonOf(log.dispatchError || "", SEND_REASON_MISSING);
      events.push({ kind: "send_failed", at: sentAt, ...copy });
    }
  }

  for (const item of touchpoints) {
    const occurredAt = text(item.occurredAt);
    if (!occurredAt || !time(occurredAt)) continue;
    const copy = bounceCopy(item);
    events.push({ kind: "bounced", at: occurredAt, ...copy });
  }

  for (const delivery of [...(input.batches || []), ...(input.plans || [])]) {
    if (delivery.teamId !== candidate.teamId) continue;
    for (const item of delivery.items || []) {
      if (item.candidateId !== candidate.id) continue;
      for (const step of item.steps || []) {
        if (step.status !== "failed") continue;
        const at = text(step.sentAt) || text(step.scheduledAt) || text(delivery.updatedAt);
        if (!at || !time(at)) continue;
        const copy = reasonOf(step.error || "", SEND_REASON_MISSING);
        events.push({ kind: "send_failed", at, ...copy });
      }
    }
  }

  if (!events.length) return emptyFailure();
  events.sort((left, right) => {
    const difference = time(right.at) - time(left.at);
    if (difference) return difference;
    if (left.kind === right.kind) return (left.fallback ? 1 : 0) - (right.fallback ? 1 : 0);
    return left.kind === "bounced" ? -1 : 1;
  });
  const latest = events[0];
  return {
    status: "hit",
    kind: latest.kind,
    label: latest.kind === "bounced" ? "开发信退信" : "发送失败",
    reason: latest.reason,
    at: latest.at
  };
}
