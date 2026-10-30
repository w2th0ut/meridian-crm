import { randomUUID } from "node:crypto";
import type {
  Lead,
  LeadActivity,
  LeadActivityType,
  ProspectContactabilityDecision,
  WebsiteOpportunity
} from "./types.js";

/**
 * 搜客清单上的人工跟进，复用线索活动（LeadActivity），不另建记录表。
 * 还没转成线索时 leadId 留空，只挂 prospectCandidateId；转入后由
 * linkProspectFollowUpNotes 补上 leadId，线索抽屉里的同一条时间线能接着看。
 * 系统流水（system / stage）不是销售跟进，不出现在「最近跟进」里。
 */

const HUMAN_FOLLOW_UP_TYPES = new Set<LeadActivityType>([
  "call",
  "wechat",
  "whatsapp",
  "linkedin",
  "email",
  "meeting",
  "note"
]);

const TYPE_LABEL: Record<string, string> = {
  call: "电话",
  wechat: "微信",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  email: "邮件",
  meeting: "会面",
  note: "备注"
};

const CONTACTABLE_STATUSES = new Set<WebsiteOpportunity["status"]>([
  "contactable",
  "contacted",
  "synced"
]);

const EXCERPT_LENGTH = 48;

export interface ProspectFollowUpSummary {
  id: string;
  at: string;
  type: LeadActivityType;
  typeLabel: string;
  excerpt: string;
}

export class ProspectFollowUpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ProspectFollowUpError";
    this.status = status;
  }
}

type FollowUpStore = {
  leadActivities: LeadActivity[];
  leads: Lead[];
  prospectContactabilityDecisions: ProspectContactabilityDecision[];
};

function excerpt(content: string) {
  const text = content.replace(/\s+/gu, " ").trim();
  if (text.length <= EXCERPT_LENGTH) return text;
  return `${text.slice(0, EXCERPT_LENGTH)}…`;
}

function isHumanFollowUp(activity: LeadActivity) {
  return HUMAN_FOLLOW_UP_TYPES.has(activity.type);
}

/**
 * 只读：当前业务员在某一联系方式上的最新决定仍是 approved_contactable。
 * 不写入、不新建批准，也不代替 convert_to_lead。
 */
export function hasCurrentApprovedContactable(
  store: Pick<FollowUpStore, "prospectContactabilityDecisions">,
  candidate: WebsiteOpportunity,
  actorId: string
) {
  if (!candidate.tenantProspectId || candidate.ownerId !== actorId) return false;
  const latestByChannel = new Map<string, ProspectContactabilityDecision>();
  for (const decision of store.prospectContactabilityDecisions) {
    if (decision.teamId !== candidate.teamId) continue;
    if (decision.ownerId !== actorId || decision.approvedBy !== actorId) continue;
    if (decision.prospectId !== candidate.tenantProspectId) continue;
    const current = latestByChannel.get(decision.channelId);
    if (!current || current.createdAt < decision.createdAt) {
      latestByChannel.set(decision.channelId, decision);
    }
  }
  return [...latestByChannel.values()].some((item) => item.status === "approved_contactable");
}

/** 已可联系、已联系、已是线索，或当前仍有人工可联系批准。未批准的待处理不开放。 */
export function prospectFollowUpWriteAllowed(
  store: Pick<FollowUpStore, "prospectContactabilityDecisions">,
  candidate: WebsiteOpportunity,
  actorId: string
) {
  if (candidate.ownerId !== actorId) return false;
  if (candidate.status === "excluded") return false;
  if (CONTACTABLE_STATUSES.has(candidate.status) || Boolean(candidate.leadId)) return true;
  return hasCurrentApprovedContactable(store, candidate, actorId);
}

export function listProspectFollowUps(
  store: Pick<FollowUpStore, "leadActivities">,
  candidate: WebsiteOpportunity
) {
  const seen = new Set<string>();
  const matched: LeadActivity[] = [];
  for (const activity of store.leadActivities) {
    if (!isHumanFollowUp(activity) || seen.has(activity.id)) continue;
    const byProspect = Boolean(activity.prospectCandidateId)
      && activity.prospectCandidateId === candidate.id;
    const byLead = Boolean(candidate.leadId) && activity.leadId === candidate.leadId;
    if (!byProspect && !byLead) continue;
    seen.add(activity.id);
    matched.push(activity);
  }
  matched.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
  );
  return matched;
}

export function describeProspectLatestFollowUp(
  store: Pick<FollowUpStore, "leadActivities">,
  candidate: WebsiteOpportunity
): ProspectFollowUpSummary | null {
  const latest = listProspectFollowUps(store, candidate)[0];
  if (!latest) return null;
  return {
    id: latest.id,
    at: latest.createdAt,
    type: latest.type,
    typeLabel: TYPE_LABEL[latest.type] || latest.type,
    excerpt: excerpt(latest.content)
  };
}

export function recordProspectFollowUp(
  store: FollowUpStore,
  input: {
    candidate: WebsiteOpportunity;
    actorId: string;
    content: string;
    createdAt?: string;
  }
) {
  const content = input.content.trim();
  if (!content) {
    throw new ProspectFollowUpError(400, "请填写跟进内容");
  }
  if (content.length > 2000) {
    throw new ProspectFollowUpError(400, "跟进内容过长");
  }
  if (input.candidate.ownerId !== input.actorId) {
    throw new ProspectFollowUpError(403, "只有候选归属业务员可以记录跟进");
  }
  if (!prospectFollowUpWriteAllowed(store, input.candidate, input.actorId)) {
    throw new ProspectFollowUpError(
      409,
      input.candidate.status === "excluded"
        ? "已排除的候选不在这里记录跟进"
        : "达到可联系后再记录跟进"
    );
  }
  const createdAt = input.createdAt || new Date().toISOString();
  const activity: LeadActivity = {
    id: `la_${randomUUID()}`,
    leadId: input.candidate.leadId || "",
    prospectCandidateId: input.candidate.id,
    type: "note",
    content,
    operatorId: input.actorId,
    nextFollowAt: "",
    createdAt
  };
  store.leadActivities.unshift(activity);
  const lead = activity.leadId
    ? store.leads.find((item) =>
      item.id === activity.leadId
      && item.ownerId === input.actorId
      && item.teamId === input.candidate.teamId
      && !item.deletedAt
    )
    : undefined;
  if (lead) {
    lead.lastActivityAt = "刚刚";
    if (lead.status === "new") lead.status = "following";
  }
  return {
    activity,
    latestFollowUp: describeProspectLatestFollowUp(store, input.candidate)
  };
}

/** 转入线索后把此前挂在候选上的注记补上 leadId。不改批准，也不新建活动。 */
export function linkProspectFollowUpNotes(
  store: Pick<FollowUpStore, "leadActivities">,
  candidate: WebsiteOpportunity,
  leadId: string
) {
  if (!leadId) return;
  store.leadActivities.forEach((activity) => {
    if (activity.prospectCandidateId !== candidate.id) return;
    if (activity.leadId) return;
    activity.leadId = leadId;
  });
}
