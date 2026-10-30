/**
 * 待发草稿积压的只读投影。
 * 只读还没放行的发信批次（status = draft）里、待发送目标上尚未发出的步骤。
 * 不写库，不放行，不发信，也不代替外联序列、回复、打开/点击、失败或抑制。
 * 已放行或已结束的批次属于序列进度，这里不读。开发信页上的草稿不落库，这里也不编造。
 */

export type OutreachDraftBacklog = "none" | "pending";

export interface ProspectOutreachDraftBacklogView {
  backlog: OutreachDraftBacklog;
  count: number;
  subject: string;
  batchId: string;
  updatedAt: string;
}

export interface OutreachDraftCandidate {
  id: string;
  teamId: string;
  leadId?: string;
  customerId?: string;
}

export interface OutreachDraftStep {
  subject?: string;
  status?: string;
  /** 失败原因留给失败条，草稿积压不读、不回传。 */
  error?: string;
}

export interface OutreachDraftItem {
  candidateId?: string;
  leadId?: string;
  entityType?: string;
  status?: string;
  steps?: OutreachDraftStep[];
}

export interface OutreachDraftBatch {
  id: string;
  teamId: string;
  ownerId?: string;
  status?: string;
  updatedAt?: string;
  items?: OutreachDraftItem[];
}

const SUBJECT_LENGTH = 48;

interface DraftHit {
  batchId: string;
  updatedAt: string;
  count: number;
  subject: string;
}

function text(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function clip(value: string) {
  if (value.length <= SUBJECT_LENGTH) return value;
  return `${value.slice(0, SUBJECT_LENGTH)}…`;
}

function validTime(value: unknown) {
  const cleaned = text(value);
  if (!cleaned || Number.isNaN(Date.parse(cleaned))) return "";
  return cleaned;
}

function time(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyBacklog(): ProspectOutreachDraftBacklogView {
  return { backlog: "none", count: 0, subject: "", batchId: "", updatedAt: "" };
}

function itemMatches(candidate: OutreachDraftCandidate, item: OutreachDraftItem) {
  const entityType = text(item.entityType) || "candidate";
  if (entityType === "candidate") return text(item.candidateId) === candidate.id;
  if (entityType === "lead") {
    const leadId = text(candidate.leadId);
    if (!leadId) return false;
    return text(item.leadId) === leadId || text(item.candidateId) === leadId;
  }
  if (entityType === "customer") {
    const customerId = text(candidate.customerId);
    return Boolean(customerId) && text(item.candidateId) === customerId;
  }
  return false;
}

/** 只数还没发出的步骤。已发、失败、跳过和发送中都不算积压。 */
function pendingDraft(item: OutreachDraftItem): { count: number; subject: string } | null {
  if (text(item.status) !== "ready") return null;
  const pending = (item.steps || []).filter((step) => {
    const status = text(step.status);
    return status === "" || status === "pending";
  });
  if (!pending.length) return null;
  const named = pending.find((step) => text(step.subject));
  return { count: pending.length, subject: clip(text(named?.subject)) };
}

function prefer(left: DraftHit, right: DraftHit) {
  const timeDifference = time(right.updatedAt) - time(left.updatedAt);
  if (timeDifference) return timeDifference > 0 ? right : left;
  return left.batchId <= right.batchId ? left : right;
}

/**
 * 取这条候选还没放行的待发草稿。
 * 没有草稿批次，或目标不是待发送、步骤已经不在待发时，是清空态。
 * 多份草稿的封数相加；入口指向最近更新的那一份。
 */
export function describeProspectOutreachDraftBacklog(input: {
  candidate: OutreachDraftCandidate;
  /** 当前账号。发信批次只对创建人可见，别人的草稿不算进这份积压。 */
  ownerId: string;
  batches?: OutreachDraftBatch[];
}): ProspectOutreachDraftBacklogView {
  const candidate = input.candidate;
  const ownerId = text(input.ownerId);
  const hits: DraftHit[] = [];
  for (const batch of input.batches || []) {
    if (!ownerId || text(batch.ownerId) !== ownerId) continue;
    if (batch.teamId !== candidate.teamId || text(batch.status) !== "draft") continue;
    const batchId = text(batch.id);
    if (!batchId) continue;
    let count = 0;
    let subject = "";
    for (const item of batch.items || []) {
      if (!itemMatches(candidate, item)) continue;
      const pending = pendingDraft(item);
      if (!pending) continue;
      count += pending.count;
      if (!subject && pending.subject) subject = pending.subject;
    }
    if (!count) continue;
    hits.push({
      batchId,
      updatedAt: validTime(batch.updatedAt),
      count,
      subject
    });
  }
  if (!hits.length) return emptyBacklog();
  const current = hits.reduce((left, right) => prefer(left, right));
  const count = hits.reduce((sum, hit) => sum + hit.count, 0);
  return {
    backlog: "pending",
    count,
    subject: current.subject,
    batchId: current.batchId,
    updatedAt: current.updatedAt
  };
}
