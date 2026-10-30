/**
 * 开发信回复的只读投影。
 * 只读已有邮件触点里的 reply，以及发信台账上的 repliedAt。
 * 不读新的收信管道。退信仍归失败条，抑制和退订仍归原因条。
 * 不写库，不跟进，不发下一封。
 * 分类字段单独出现时没有回复时间，也不拿它充当回复。
 */

export interface ProspectOutreachReplyView {
  status: "none" | "hit";
  at: string;
  excerpt: string;
}

export interface OutreachReplyCandidate {
  id: string;
  teamId: string;
}

export interface OutreachReplyEmailLog {
  teamId: string;
  entityType: string;
  entityId: string;
  repliedAt?: string;
}

export interface OutreachReplyTouchpoint {
  teamId: string;
  prospectCandidateId: string;
  channel?: string;
  direction?: string;
  eventType?: string;
  replyClassification?: string;
  subject?: string;
  content?: string;
  occurredAt?: string;
}

const EXCERPT_LENGTH = 48;
const GENERIC_SUBJECTS = new Set([
  "回复",
  "回信",
  "客户回信",
  "re",
  "re:"
]);

interface ReplyEvent {
  at: string;
  excerpt: string;
}

function text(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function validTime(value: unknown) {
  const cleaned = text(value);
  if (!cleaned) return "";
  const parsed = Date.parse(cleaned);
  return Number.isFinite(parsed) ? cleaned : "";
}

function time(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clip(value: string) {
  if (value.length <= EXCERPT_LENGTH) return value;
  return `${value.slice(0, EXCERPT_LENGTH)}…`;
}

function excerptOf(content: unknown, subject: unknown) {
  const body = text(content);
  if (body) return clip(body);
  const title = text(subject);
  if (!title || GENERIC_SUBJECTS.has(title.toLowerCase())) return "";
  return clip(title);
}

function emptyReply(): ProspectOutreachReplyView {
  return { status: "none", at: "", excerpt: "" };
}

function sameCandidateLog(candidate: OutreachReplyCandidate, log: OutreachReplyEmailLog) {
  return log.teamId === candidate.teamId
    && log.entityType === "prospect_candidate"
    && log.entityId === candidate.id;
}

function sameCandidateTouchpoint(
  candidate: OutreachReplyCandidate,
  item: OutreachReplyTouchpoint
) {
  return item.teamId === candidate.teamId && item.prospectCandidateId === candidate.id;
}

/**
 * 邮件触点上的 reply。退信、打开、点击、发出和 WhatsApp / 电话都不算。
 * 没有 eventType 的入站邮件沿用写入时的默认：非退信入站就是回复。
 */
function isEmailReply(item: OutreachReplyTouchpoint) {
  if (item.channel !== "email") return false;
  if (item.replyClassification === "bounced") return false;
  if (item.eventType === "bounce"
    || item.eventType === "open"
    || item.eventType === "click"
    || item.eventType === "send") return false;
  if (item.eventType === "reply") return true;
  return item.direction === "inbound" && !item.eventType;
}

/**
 * 取这条候选最近一次开发信回复的时间和短摘。
 * 有正文或可用主题时给短摘；只有时间时短摘为空，界面写「有回复」。
 * 没有回复时是清空态。
 */
export function describeProspectOutreachReply(input: {
  candidate: OutreachReplyCandidate;
  emailLogs?: OutreachReplyEmailLog[];
  touchpoints?: OutreachReplyTouchpoint[];
}): ProspectOutreachReplyView {
  const candidate = input.candidate;
  const events: ReplyEvent[] = [];

  for (const item of input.touchpoints || []) {
    if (!sameCandidateTouchpoint(candidate, item) || !isEmailReply(item)) continue;
    const at = validTime(item.occurredAt);
    const excerpt = excerptOf(item.content, item.subject);
    if (!at && !excerpt) continue;
    events.push({ at, excerpt });
  }

  for (const log of input.emailLogs || []) {
    if (!sameCandidateLog(candidate, log)) continue;
    const at = validTime(log.repliedAt);
    if (!at) continue;
    events.push({ at, excerpt: "" });
  }

  if (!events.length) return emptyReply();
  events.sort((left, right) => {
    const difference = time(right.at) - time(left.at);
    if (difference) return difference;
    if (left.excerpt && !right.excerpt) return -1;
    if (!left.excerpt && right.excerpt) return 1;
    return 0;
  });
  const latest = events[0];
  return {
    status: "hit",
    at: latest.at,
    excerpt: latest.excerpt
  };
}
