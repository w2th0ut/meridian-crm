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

/** 人工跟进方式。阶段和系统流水不是销售跟进，不能从记跟进写入。 */
export const PROSPECT_FOLLOW_UP_TYPE_VALUES = [
  "call",
  "wechat",
  "whatsapp",
  "linkedin",
  "email",
  "meeting",
  "note"
] as const;

const HUMAN_FOLLOW_UP_TYPES = new Set<LeadActivityType>(PROSPECT_FOLLOW_UP_TYPE_VALUES);

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

/** 当前下次跟进相对「现在」的位置。空、过期、今天、以后。无法解析的旧文本不算过期。 */
export type ProspectNextFollowKind = "empty" | "overdue" | "today" | "later";

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
 * 下次跟进只接受墙上时钟，存成 `YYYY-MM-DD HH:mm`。
 * 空字符串表示清除。不接受时区，避免和清单上的本地时间对不上。
 */
export function normalizeProspectNextFollowAt(value: string) {
  const text = value.trim();
  if (!text) return "";
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!match) {
    throw new ProspectFollowUpError(400, "下次跟进时间请用日期和时间，例如 2026-10-30 15:30");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59) {
    throw new ProspectFollowUpError(400, "下次跟进时间请用日期和时间，例如 2026-10-30 15:30");
  }
  const parsed = new Date(year, month - 1, day, hour, minute);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    throw new ProspectFollowUpError(400, "下次跟进时间请用日期和时间，例如 2026-10-30 15:30");
  }
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
}

export function classifyProspectNextFollow(value: string, now: Date): ProspectNextFollowKind {
  const text = value.trim();
  if (!text) return "empty";
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return "later";
  const due = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5])
  );
  if (Number.isNaN(due.getTime())) return "later";
  if (due.getTime() < now.getTime()) return "overdue";
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 86_400_000);
  if (due.getTime() < end.getTime()) return "today";
  return "later";
}

function assertFollowUpWriter(
  store: Pick<FollowUpStore, "prospectContactabilityDecisions">,
  candidate: WebsiteOpportunity,
  actorId: string
) {
  if (candidate.ownerId !== actorId) {
    throw new ProspectFollowUpError(403, "只有候选归属业务员可以记录跟进");
  }
  if (!prospectFollowUpWriteAllowed(store, candidate, actorId)) {
    throw new ProspectFollowUpError(
      409,
      candidate.status === "excluded"
        ? "已排除的候选不在这里记录跟进"
        : "达到可联系后再记录跟进"
    );
  }
}

/** 当前下次跟进挂在候选已有的 nextFollowAt。已转入的线索同步同一字段，不新建待办。 */
function applyProspectNextFollowAt(
  store: Pick<FollowUpStore, "leads">,
  candidate: WebsiteOpportunity,
  actorId: string,
  nextFollowAt: string
) {
  candidate.nextFollowAt = nextFollowAt;
  if (!candidate.leadId) return;
  const lead = store.leads.find((item) =>
    item.id === candidate.leadId
    && item.ownerId === actorId
    && item.teamId === candidate.teamId
    && !item.deletedAt
  );
  if (lead) lead.nextFollowAt = nextFollowAt;
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

/**
 * 只改下次跟进，不写新的跟进注记。
 * nextFollowAt 为空表示清除。不发送，不转线索，不生成待办。
 */
export function setProspectNextFollowAt(
  store: FollowUpStore,
  input: {
    candidate: WebsiteOpportunity;
    actorId: string;
    nextFollowAt: string;
  }
) {
  assertFollowUpWriter(store, input.candidate, input.actorId);
  const nextFollowAt = normalizeProspectNextFollowAt(input.nextFollowAt);
  applyProspectNextFollowAt(store, input.candidate, input.actorId, nextFollowAt);
  return { nextFollowAt };
}

export function recordProspectFollowUp(
  store: FollowUpStore,
  input: {
    candidate: WebsiteOpportunity;
    actorId: string;
    content: string;
    /** 省略时仍写备注，和原来的记跟进一致。 */
    type?: LeadActivityType;
    createdAt?: string;
    /** 省略则不改已有下次跟进。空字符串表示清除。 */
    nextFollowAt?: string;
  }
) {
  const content = input.content.trim();
  if (!content) {
    throw new ProspectFollowUpError(400, "请填写跟进内容");
  }
  if (content.length > 2000) {
    throw new ProspectFollowUpError(400, "跟进内容过长");
  }
  const type = input.type || "note";
  if (!HUMAN_FOLLOW_UP_TYPES.has(type)) {
    throw new ProspectFollowUpError(400, "跟进方式不正确");
  }
  assertFollowUpWriter(store, input.candidate, input.actorId);
  const scheduled = input.nextFollowAt === undefined
    ? undefined
    : normalizeProspectNextFollowAt(input.nextFollowAt);
  const createdAt = input.createdAt || new Date().toISOString();
  const activity: LeadActivity = {
    id: `la_${randomUUID()}`,
    leadId: input.candidate.leadId || "",
    prospectCandidateId: input.candidate.id,
    type,
    content,
    operatorId: input.actorId,
    nextFollowAt: scheduled || "",
    createdAt
  };
  store.leadActivities.unshift(activity);
  if (scheduled !== undefined) {
    applyProspectNextFollowAt(store, input.candidate, input.actorId, scheduled);
  }
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
    latestFollowUp: describeProspectLatestFollowUp(store, input.candidate),
    nextFollowAt: input.candidate.nextFollowAt || ""
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
