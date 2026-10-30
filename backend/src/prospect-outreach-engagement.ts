/**
 * 开发信打开 / 点击的只读投影。
 * 只读已有发信台账、候选计数和邮件触点上的打开、点击字段。
 * 仓内没有送达回执字段（没有 deliveredAt，触点事件也没有 deliver）。
 * 发送成功不算送达。不写库，不跟进，不发下一封，也不代替失败条或抑制条。
 */

export interface OutreachEngagementSignal {
  count: number;
  at: string;
}

export interface ProspectOutreachEngagementView {
  status: "none" | "hit";
  open: OutreachEngagementSignal;
  click: OutreachEngagementSignal;
}

export interface OutreachEngagementCandidate {
  id: string;
  teamId: string;
  openCount?: number;
  clickCount?: number;
  lastOpenedAt?: string;
  lastClickedAt?: string;
}

export interface OutreachEngagementEmailLog {
  teamId: string;
  entityType: string;
  entityId: string;
  openCount?: number;
  clickCount?: number;
  firstOpenedAt?: string;
  lastOpenedAt?: string;
  lastClickedAt?: string;
}

export interface OutreachEngagementTouchpoint {
  teamId: string;
  prospectCandidateId: string;
  channel?: string;
  eventType?: string;
  occurredAt?: string;
}

const EMPTY_SIGNAL: OutreachEngagementSignal = { count: 0, at: "" };

function text(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function positiveCount(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(1_000_000, Math.floor(parsed));
}

function validTime(value: unknown) {
  const cleaned = text(value);
  if (!cleaned) return "";
  const parsed = Date.parse(cleaned);
  return Number.isFinite(parsed) ? cleaned : "";
}

function latestTime(values: string[]) {
  let best = "";
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const cleaned = validTime(value);
    if (!cleaned) continue;
    const parsed = Date.parse(cleaned);
    if (parsed >= bestMs) {
      bestMs = parsed;
      best = cleaned;
    }
  }
  return best;
}

function emptyEngagement(): ProspectOutreachEngagementView {
  return {
    status: "none",
    open: { ...EMPTY_SIGNAL },
    click: { ...EMPTY_SIGNAL }
  };
}

function sameCandidateLog(
  candidate: OutreachEngagementCandidate,
  log: OutreachEngagementEmailLog
) {
  return log.teamId === candidate.teamId
    && log.entityType === "prospect_candidate"
    && log.entityId === candidate.id;
}

function sameCandidateTouchpoint(
  candidate: OutreachEngagementCandidate,
  item: OutreachEngagementTouchpoint,
  eventType: "open" | "click"
) {
  return item.teamId === candidate.teamId
    && item.prospectCandidateId === candidate.id
    && item.channel === "email"
    && item.eventType === eventType;
}

function signalFrom(input: {
  candidateCount: number;
  candidateAt: string;
  logs: Array<{ count: number; at: string }>;
  touchpoints: Array<{ at: string }>;
}): OutreachEngagementSignal {
  const logCount = input.logs.reduce((sum, item) => sum + item.count, 0);
  let count = Math.max(input.candidateCount, logCount, input.touchpoints.length);
  const at = latestTime([
    input.candidateAt,
    ...input.logs.map((item) => item.at),
    ...input.touchpoints.map((item) => item.at)
  ]);
  if (!count && at) count = 1;
  if (!count) return { ...EMPTY_SIGNAL };
  return { count, at };
}

/**
 * 取这条候选已经记下的打开和点击次数，以及各自最近一次时间。
 * 没有打开也没有点击时是「无打开或点击」。退信、发送失败、抑制和已发送都不算。
 */
export function describeProspectOutreachEngagement(input: {
  candidate: OutreachEngagementCandidate;
  emailLogs?: OutreachEngagementEmailLog[];
  touchpoints?: OutreachEngagementTouchpoint[];
}): ProspectOutreachEngagementView {
  const candidate = input.candidate;
  const logs = (input.emailLogs || []).filter((item) => sameCandidateLog(candidate, item));
  const touchpoints = input.touchpoints || [];
  const open = signalFrom({
    candidateCount: positiveCount(candidate.openCount),
    candidateAt: validTime(candidate.lastOpenedAt),
    logs: logs.map((item) => ({
      count: positiveCount(item.openCount) || (validTime(item.lastOpenedAt) || validTime(item.firstOpenedAt) ? 1 : 0),
      at: validTime(item.lastOpenedAt) || validTime(item.firstOpenedAt)
    })).filter((item) => item.count || item.at),
    touchpoints: touchpoints
      .filter((item) => sameCandidateTouchpoint(candidate, item, "open"))
      .map((item) => ({ at: validTime(item.occurredAt) }))
  });
  const click = signalFrom({
    candidateCount: positiveCount(candidate.clickCount),
    candidateAt: validTime(candidate.lastClickedAt),
    logs: logs.map((item) => ({
      count: positiveCount(item.clickCount) || (validTime(item.lastClickedAt) ? 1 : 0),
      at: validTime(item.lastClickedAt)
    })).filter((item) => item.count || item.at),
    touchpoints: touchpoints
      .filter((item) => sameCandidateTouchpoint(candidate, item, "click"))
      .map((item) => ({ at: validTime(item.occurredAt) }))
  });
  if (!open.count && !click.count) return emptyEngagement();
  return { status: "hit", open, click };
}
