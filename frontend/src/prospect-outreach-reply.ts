/**
 * 开发信回复的只读展示。
 * 只消费清单接口带回的最近回复时间和短摘。
 * 不另写收信，也不把打开/点击、失败条或抑制条说成回复。
 */

export type OutreachReplyListFilter = "all" | "hit" | "clear";

export interface OutreachReplyView {
  status: "none" | "hit";
  at: string;
  excerpt: string;
}

const EXCERPT_LENGTH = 48;

export function emptyOutreachReply(): OutreachReplyView {
  return { status: "none", at: "", excerpt: "" };
}

function text(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function timeOf(value: unknown) {
  const cleaned = text(value);
  if (!cleaned || Number.isNaN(Date.parse(cleaned))) return "";
  return cleaned;
}

function excerptOf(value: unknown) {
  const cleaned = text(value);
  if (!cleaned) return "";
  if (cleaned.length <= EXCERPT_LENGTH) return cleaned;
  return `${cleaned.slice(0, EXCERPT_LENGTH)}…`;
}

/** 只接受接口带回的回复。失败、打开点击、抑制和没有时间也没有摘要的记录都当成没有回复。 */
export function presentOutreachReply(raw: unknown): OutreachReplyView {
  if (!raw || typeof raw !== "object") return emptyOutreachReply();
  const record = raw as Record<string, unknown>;
  if (record.status !== "hit") return emptyOutreachReply();
  if ("kind" in record || "reason" in record || "open" in record || "click" in record) {
    return emptyOutreachReply();
  }
  const at = timeOf(record.at);
  const excerpt = excerptOf(record.excerpt);
  if (!at && !excerpt) return emptyOutreachReply();
  return { status: "hit", at, excerpt };
}

export function outreachReplyMatchesFilter(view: OutreachReplyView, filter: OutreachReplyListFilter) {
  if (filter === "hit") return view.status === "hit";
  if (filter === "clear") return view.status === "none";
  return true;
}

export function outreachReplyLatestAt(view: OutreachReplyView) {
  const parsed = Date.parse(view.at);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function outreachReplyLineLabel(view: OutreachReplyView, formattedAt = "") {
  if (view.status !== "hit") return "无回复";
  const when = formattedAt ? ` · ${formattedAt}` : "";
  return `最近回复${when} · ${view.excerpt || "有回复"}`;
}

export function outreachReplyFollowLabel(view: OutreachReplyView) {
  return view.status === "hit" ? "去跟进记录" : "";
}

export function outreachReplyHistoryLabel(view: OutreachReplyView) {
  return view.status === "hit" ? "查看回复记录" : "";
}

export function outreachReplySummary(view: OutreachReplyView, formattedAt = "") {
  const boundary = "这里只展示最近一次开发信回复的时间和摘要。这不是打开或点击条，也不是失败条，也不是抑制条。不会自动跟进，也不会自动发下一封。";
  if (view.status !== "hit") return `无回复。${boundary}`;
  const when = formattedAt ? `最近回复 ${formattedAt}。` : "";
  const body = view.excerpt ? `${view.excerpt}。` : "有回复。";
  return `${when}${body}${boundary}`;
}
