/**
 * 回复待处理积压的只读分类。
 * 只读 Day16 已经投影到候选上的最近一次开发信回复时间（详情「最近回复」同一份 outreachReply.at）。
 * 候选上没有单独的已读、未读或已处理标记，入站线程待办也没有投影到候选上。
 * 记下且能解析的回复时间就是待人工处理。
 * 不读跟进、加入时间、下次跟进、开发信发出时间、序列下一步、最近触达或收信同步账号状态。
 * 相对现在：超过 7 天标「积压较久」；未超过（含刚好 7 天）标「积压较新」。
 * 没有可解析的回复时间，标「无待处理回复」。
 * 不发信，不自动回复，不标成已处理，不改名单，也不碰门禁。
 * 文案不和空档、已到期、静默、跟进空档、逾期混用。
 */

export const REPLY_BACKLOG_WINDOW_DAYS = 7;
export const REPLY_BACKLOG_WINDOW_MS = REPLY_BACKLOG_WINDOW_DAYS * 24 * 60 * 60 * 1000;
export const REPLY_BACKLOG_LIMIT = 8;

export type ReplyBacklogKind = "none" | "stale" | "fresh";
export type ReplyBacklogListFilter = "all" | "stale";

export interface ReplyBacklogInput {
  /** 最近一次开发信回复的时间。空字符串表示没有可解析的待处理回复。 */
  replyAt: string;
}

export interface ReplyBacklogView {
  kind: ReplyBacklogKind;
  /** 能解析的回复时间戳。解析不了是 0。 */
  replyMs: number;
}

export const REPLY_BACKLOG_BOUNDARY = "这里只按候选上已有的最近一次开发信回复时间，相对现在判断积压。有待处理回复且距现在超过 7 天算积压较久。未超过算积压较新，刚好 7 天仍算积压较新。没有回复，或时间解析不了，写无待处理回复。没有单独的已读或未读，记下的回复时间就是待人工处理。跟进记录不算这封回复的时间。加入短名单的时间不算这封回复的时间。下次跟进那种时间不算这封回复的时间。最近一封开发信的发出时间不算这封回复的时间。序列下一步的计划时间不算这封回复的时间。最近触达（含话机）不算这封回复的时间。收信同步的账号状态不算这封回复的时间。这不是序列下一步到期，也不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄，也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口，也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住，也不是待记跟进或今日到期，也不是待发草稿，也不是外联序列进度，也不是打开或点击、失败或抑制、收信同步。不替代开发信回复那一块。不会发信，不会自动回复，不会标成已处理，不会改名单，也不会改 convert_to_lead 或 approved_contactable。";

const KIND_LABEL: Record<Exclude<ReplyBacklogKind, "none">, string> = {
  stale: "积压较久",
  fresh: "积压较新"
};

export function emptyReplyBacklog(): ReplyBacklogView {
  return { kind: "none", replyMs: 0 };
}

/** 跟详情「最近回复」一样，认 Date.parse 能解析的回复时间。解析不了就是无待处理回复。 */
function parseReplyAt(value: string) {
  const text = value.trim();
  if (!text) return Number.NaN;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * 距现在超过 7 天算积压较久。未超过（含刚好 7 天、含此刻、含更晚的时间）算积压较新。
 * 没有时间或解析不了，都是无待处理回复。
 */
export function presentReplyBacklog(input: ReplyBacklogInput, now = new Date()): ReplyBacklogView {
  const replyMs = parseReplyAt(input.replyAt || "");
  if (!Number.isFinite(replyMs)) return emptyReplyBacklog();
  const age = now.getTime() - replyMs;
  if (age > REPLY_BACKLOG_WINDOW_MS) return { kind: "stale", replyMs };
  return { kind: "fresh", replyMs };
}

export function replyBacklogMatchesFilter(view: ReplyBacklogView, filter: ReplyBacklogListFilter) {
  if (filter === "stale") return view.kind === "stale";
  return true;
}

export function replyBacklogRank(view: ReplyBacklogView) {
  if (view.kind === "stale") return 0;
  if (view.kind === "fresh") return 1;
  return 2;
}

/** 从工作台打开时，积压较久落到积压较久筛选，积压较新保持全部。 */
export function replyBacklogListFilterForOpen(view: ReplyBacklogView): ReplyBacklogListFilter {
  if (view.kind === "stale") return "stale";
  return "all";
}

export function formatReplyBacklogAt(ms: number) {
  if (!ms) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

export function replyBacklogLineLabel(view: ReplyBacklogView) {
  if (view.kind === "none") return "无待处理回复";
  const when = formatReplyBacklogAt(view.replyMs);
  return [KIND_LABEL[view.kind], when].filter(Boolean).join(" · ");
}

export function replyBacklogStatusLabel(view: ReplyBacklogView) {
  if (view.kind === "none") return "无待处理回复";
  return KIND_LABEL[view.kind];
}

export function replyBacklogEntryLabel() {
  return "查看最近回复";
}

export function replyBacklogSummary(view: ReplyBacklogView) {
  if (view.kind === "none") return `无待处理回复。${REPLY_BACKLOG_BOUNDARY}`;
  const when = formatReplyBacklogAt(view.replyMs);
  return `${KIND_LABEL[view.kind]} ${when}。${REPLY_BACKLOG_BOUNDARY}`;
}

export function listReplyBacklogQueue<T extends { id: string }>(
  rows: readonly T[],
  viewOf: (row: T) => ReplyBacklogView,
  limit = REPLY_BACKLOG_LIMIT
) {
  const ranked = rows
    .map((row) => ({ row, view: viewOf(row) }))
    .filter((item) => item.view.kind !== "none")
    .sort((left, right) => {
      const rank = replyBacklogRank(left.view) - replyBacklogRank(right.view);
      if (rank) return rank;
      if (left.view.replyMs !== right.view.replyMs) return left.view.replyMs - right.view.replyMs;
      return left.row.id < right.row.id ? -1 : left.row.id > right.row.id ? 1 : 0;
    });
  const cap = Number.isFinite(limit) ? Math.max(0, limit) : ranked.length;
  return {
    total: ranked.length,
    rows: ranked.slice(0, cap).map((item) => item.row)
  };
}
