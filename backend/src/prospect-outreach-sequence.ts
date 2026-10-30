/**
 * 外联序列进度的只读投影。
 * 只读已有自动发送方案、发信批次步骤，以及邮件触达序列。
 * 不写库，不推进步骤，不发下一封，也不代替回复、打开/点击、失败或抑制。
 * 草稿批次还没放行，不算已经在跑的序列。即刻沟通序列不在这条外联进度里。
 */

export type OutreachSequenceProgress = "none" | "active" | "stopped" | "done";
export type OutreachSequenceSource = "none" | "plan" | "batch" | "sequence";

export interface ProspectOutreachSequenceView {
  progress: OutreachSequenceProgress;
  statusLabel: string;
  name: string;
  stepName: string;
  source: OutreachSequenceSource;
  sourceId: string;
  updatedAt: string;
  /**
   * 下一步（正在发，否则待发）上已经有的 scheduledAt。
   * 没有下一步，或时间不是带 T 的 ISO，留空。不另存到期，也不读方案/批次的下一次运行时间。
   */
  scheduledAt: string;
}

export interface OutreachSequenceCandidate {
  id: string;
  teamId: string;
  leadId?: string;
  customerId?: string;
}

export interface OutreachSequenceStep {
  subject?: string;
  status?: string;
  /** 这一步计划发送时间。只读，不在这里改排期。 */
  scheduledAt?: string;
  /** 失败原因留给失败条，序列进度不读、不回传。 */
  error?: string;
}

export interface OutreachSequenceItem {
  candidateId?: string;
  leadId?: string;
  entityType?: string;
  status?: string;
  steps?: OutreachSequenceStep[];
}

export interface OutreachSequencePlan {
  id: string;
  teamId: string;
  name?: string;
  status?: string;
  updatedAt?: string;
  items?: OutreachSequenceItem[];
}

export interface OutreachSequenceBatch {
  id: string;
  teamId: string;
  status?: string;
  updatedAt?: string;
  items?: OutreachSequenceItem[];
}

export interface OutreachSequenceRecord {
  id: string;
  teamId: string;
  entityType?: string;
  entityId?: string;
  channel?: string;
  status?: string;
  updatedAt?: string;
  steps?: OutreachSequenceStep[];
}

export interface OutreachSequenceEmailLog {
  teamId: string;
  entityType?: string;
  entityId?: string;
  sequenceId?: string;
}

const NAME_LENGTH = 48;

interface SequenceHit {
  progress: Exclude<OutreachSequenceProgress, "none">;
  statusLabel: string;
  name: string;
  stepName: string;
  source: Exclude<OutreachSequenceSource, "none">;
  sourceId: string;
  updatedAt: string;
  scheduledAt: string;
}

function text(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function clip(value: string) {
  if (value.length <= NAME_LENGTH) return value;
  return `${value.slice(0, NAME_LENGTH)}…`;
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

function emptySequence(): ProspectOutreachSequenceView {
  return {
    progress: "none",
    statusLabel: "",
    name: "",
    stepName: "",
    source: "none",
    sourceId: "",
    updatedAt: "",
    scheduledAt: ""
  };
}

/** 只认带 T 的 ISO。墙上时钟和空字符串都不算下一步到期。 */
function isoTime(value: unknown) {
  const cleaned = text(value);
  if (!cleaned.includes("T") || Number.isNaN(Date.parse(cleaned))) return "";
  return cleaned;
}

/** 正在发优先，否则第一条待发。已发出的 scheduledAt 不是下一步。 */
function nextOpenStepDue(steps: OutreachSequenceStep[] | undefined) {
  const list = steps || [];
  const next = list.find((step) => text(step.status) === "sending")
    || list.find((step) => text(step.status) === "pending");
  if (!next) return "";
  return isoTime(next.scheduledAt);
}

function currentStepName(steps: OutreachSequenceStep[] | undefined) {
  const list = steps || [];
  const ranked = [
    ...list.filter((step) => step.status === "sending"),
    ...list.filter((step) => step.status === "pending"),
    ...[...list].reverse().filter((step) => step.status === "sent" || step.status === "failed")
  ];
  const named = ranked.find((step) => text(step.subject));
  return clip(text(named?.subject));
}

function rank(progress: SequenceHit["progress"]) {
  if (progress === "active") return 3;
  if (progress === "stopped") return 2;
  return 1;
}

function better(left: SequenceHit, right: SequenceHit) {
  const difference = rank(right.progress) - rank(left.progress);
  if (difference) return difference > 0 ? right : left;
  const timeDifference = time(right.updatedAt) - time(left.updatedAt);
  if (timeDifference) return timeDifference > 0 ? right : left;
  if (right.name && !left.name) return right;
  if (left.name && !right.name) return left;
  return left.sourceId <= right.sourceId ? left : right;
}

type ParentPace = "running" | "paused" | "stopped" | "completed" | "cancelled" | "approved";

function describeItem(
  parent: ParentPace,
  item: OutreachSequenceItem
): Pick<SequenceHit, "progress" | "statusLabel" | "stepName"> | null {
  const status = text(item.status);
  if (status === "skipped" || status === "removed") return null;
  const steps = item.steps || [];
  const stepName = currentStepName(steps);
  if (status === "sent") return { progress: "done", statusLabel: "已完成", stepName };
  if (status === "failed") return { progress: "stopped", statusLabel: "发送受阻", stepName };
  if (status === "stopped") return { progress: "stopped", statusLabel: "已停止", stepName };
  if (parent === "paused") return { progress: "stopped", statusLabel: "已暂停", stepName };
  if (parent === "stopped") return { progress: "stopped", statusLabel: "已停止", stepName };
  if (parent === "cancelled") return { progress: "stopped", statusLabel: "已取消", stepName };
  if (parent === "completed") {
    const open = steps.some((step) => step.status === "pending" || step.status === "sending");
    if (!open) return { progress: "done", statusLabel: "已完成", stepName };
    return { progress: "stopped", statusLabel: "已停止", stepName };
  }
  if (status && status !== "ready" && status !== "sending") return null;
  const open = steps.some((step) => step.status === "pending" || step.status === "sending");
  if (steps.length && !open && steps.every((step) => step.status === "sent" || step.status === "skipped")) {
    return { progress: "done", statusLabel: "已完成", stepName };
  }
  if (steps.length && !open && steps.some((step) => step.status === "failed")) {
    return { progress: "stopped", statusLabel: "发送受阻", stepName };
  }
  return { progress: "active", statusLabel: "进行中", stepName };
}

function itemMatches(candidate: OutreachSequenceCandidate, item: OutreachSequenceItem) {
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

function planPace(status: string): ParentPace | "" {
  if (status === "running" || status === "paused" || status === "stopped" || status === "completed") return status;
  return "";
}

function batchPace(status: string): ParentPace | "" {
  if (status === "approved") return "approved";
  if (status === "paused" || status === "completed" || status === "cancelled") return status;
  return "";
}

function describeSequenceRecord(sequence: OutreachSequenceRecord): Pick<SequenceHit, "progress" | "statusLabel" | "stepName"> | null {
  if (text(sequence.channel) !== "email") return null;
  const stepName = currentStepName(sequence.steps);
  const status = text(sequence.status);
  if (status === "active") return { progress: "active", statusLabel: "进行中", stepName };
  if (status === "paused") return { progress: "stopped", statusLabel: "已暂停", stepName };
  if (status === "stopped") return { progress: "stopped", statusLabel: "已停止", stepName };
  if (status === "cancelled") return { progress: "stopped", statusLabel: "已取消", stepName };
  if (status === "failed") return { progress: "stopped", statusLabel: "发送受阻", stepName };
  if (status === "completed") return { progress: "done", statusLabel: "已完成", stepName };
  return null;
}

function sequenceMatches(
  candidate: OutreachSequenceCandidate,
  sequence: OutreachSequenceRecord,
  emailLogs: OutreachSequenceEmailLog[]
) {
  if (sequence.teamId !== candidate.teamId) return false;
  const entityId = text(sequence.entityId);
  if (text(sequence.entityType) === "lead" && entityId && entityId === text(candidate.leadId)) return true;
  if (text(sequence.entityType) === "customer" && entityId && entityId === text(candidate.customerId)) return true;
  return emailLogs.some((log) =>
    log.teamId === candidate.teamId
    && text(log.entityType) === "prospect_candidate"
    && text(log.entityId) === candidate.id
    && text(log.sequenceId) === sequence.id
  );
}

/**
 * 取这条候选当前的外联序列。
 * 有方案名就用方案名，否则用当前步骤主题。没有序列时是清空态。
 * 进行中优先于已停，已停优先于已完成；同一档取最近更新的。
 */
export function describeProspectOutreachSequence(input: {
  candidate: OutreachSequenceCandidate;
  plans?: OutreachSequencePlan[];
  batches?: OutreachSequenceBatch[];
  sequences?: OutreachSequenceRecord[];
  emailLogs?: OutreachSequenceEmailLog[];
}): ProspectOutreachSequenceView {
  const candidate = input.candidate;
  const hits: SequenceHit[] = [];
  const remember = (hit: SequenceHit | null) => {
    if (!hit || !hit.sourceId) return;
    const index = hits.findIndex((item) => item.source === hit.source && item.sourceId === hit.sourceId);
    if (index < 0) {
      hits.push(hit);
      return;
    }
    hits[index] = better(hits[index], hit);
  };

  for (const plan of input.plans || []) {
    if (plan.teamId !== candidate.teamId) continue;
    const pace = planPace(text(plan.status));
    if (!pace) continue;
    const name = clip(text(plan.name));
    for (const item of plan.items || []) {
      if (!itemMatches(candidate, item)) continue;
      const described = describeItem(pace, item);
      if (!described) continue;
      remember({
        ...described,
        name,
        source: "plan",
        sourceId: text(plan.id),
        updatedAt: validTime(plan.updatedAt),
        scheduledAt: nextOpenStepDue(item.steps)
      });
    }
  }

  for (const batch of input.batches || []) {
    if (batch.teamId !== candidate.teamId) continue;
    const pace = batchPace(text(batch.status));
    if (!pace) continue;
    for (const item of batch.items || []) {
      if (!itemMatches(candidate, item)) continue;
      const described = describeItem(pace, item);
      if (!described) continue;
      remember({
        ...described,
        name: "",
        source: "batch",
        sourceId: text(batch.id),
        updatedAt: validTime(batch.updatedAt),
        scheduledAt: nextOpenStepDue(item.steps)
      });
    }
  }

  const emailLogs = input.emailLogs || [];
  for (const sequence of input.sequences || []) {
    if (!sequenceMatches(candidate, sequence, emailLogs)) continue;
    const described = describeSequenceRecord(sequence);
    if (!described) continue;
    remember({
      ...described,
      name: "",
      source: "sequence",
      sourceId: text(sequence.id),
      updatedAt: validTime(sequence.updatedAt),
      scheduledAt: nextOpenStepDue(sequence.steps)
    });
  }

  if (!hits.length) return emptySequence();
  const current = hits.reduce((left, right) => better(left, right));
  return {
    progress: current.progress,
    statusLabel: current.statusLabel,
    name: current.name,
    stepName: current.stepName,
    source: current.source,
    sourceId: current.sourceId,
    updatedAt: current.updatedAt,
    scheduledAt: current.scheduledAt
  };
}
