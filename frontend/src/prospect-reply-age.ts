/**
 * 开发信回复日龄的只读分类。
 * 主路径：只读候选上 Day16 开发信回复说明已经带出的回复时间。
 * 那份时间就是详情「开发信回复」里「最近回复」上的同一份 `at`。
 * 不另存一份时间，也不新做日龄字段。打开、点击、失败和退信不进这里。
 * 不读跟进、加入时间、下次跟进、开发信发出时间、序列下一步、最近触达、待放行批次、抑制生效时间或收信同步。
 * 相对现在：超过 7 天标「回复超七日」；未超过（含刚好 7 天）标「回复七日内」。
 * 没有回复，或时间解析不了，标「无回复日龄」。
 * 不发信，不自动回复，不标成已处理，不解除抑制，不推进序列，不放行批次，不改名单，也不碰门禁。
 * 文案不和打开或点击日龄、失败退信日龄、抑制名单日龄、待放行批次、回复积压、序列到期、外联空档、静默、跟进空档、逾期混用。
 */

export const REPLY_AGE_WINDOW_DAYS = 7;
export const REPLY_AGE_WINDOW_MS = REPLY_AGE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
export const REPLY_AGE_LIMIT = 8;

export type ReplyAgeKind = "none" | "long" | "recent";
export type ReplyAgeListFilter = "all" | "long";

export interface ReplyAgeInput {
  /** 当前有开发信回复才为 true。没有回复为 false，即使带了时间也不算。 */
  replied: boolean;
  /** Day16 开发信回复说明上已有的回复时间。空字符串表示没有可解析时间。 */
  at: string;
}

export interface ReplyAgeView {
  kind: ReplyAgeKind;
  /** 能解析的回复时间戳。解析不了是 0。 */
  atMs: number;
}

export const REPLY_AGE_BOUNDARY = "这里只按候选上已有的开发信回复时间，相对现在判断日龄。时间是 Day16 开发信回复说明已经带出的回复时间，和详情「最近回复」上那一份是同一份。有回复且距现在超过 7 天算回复超七日。未超过算回复七日内，刚好 7 天仍算回复七日内。没有回复，或时间解析不了，写无回复日龄。只有摘要、没有回复时间时也不编造。打开或点击的发生时间不算这次回复的时间。失败或退信的发生时间不算这次回复的时间。抑制或退订的生效时间不算这次回复的时间。待放行批次的更新时间不算这次回复的时间。跟进记录不算这次回复的时间。加入短名单的时间不算这次回复的时间。下次跟进那种时间不算这次回复的时间。最近一封开发信的发出时间不算这次回复的时间。序列下一步的计划时间不算这次回复的时间。最近触达（含话机）不算这次回复的时间。收信同步的账号状态不算这次回复的时间。这不是打开或点击日龄，也不是失败退信日龄，也不是抑制名单日龄，也不是待放行批次，也不是回复待处理积压，也不是序列下一步到期，也不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄，也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口，也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住，也不是待记跟进或今日到期，也不是待发草稿、外联序列进度，也不是打开或点击、失败或退信、收信同步。不替代开发信回复那一块，也不替代回复待处理积压。不会发信，不会自动回复，不会标成已处理，不会解除抑制，不会推进序列，不会放行批次，不会改名单，也不会改 convert_to_lead 或 approved_contactable。";

const KIND_LABEL: Record<Exclude<ReplyAgeKind, "none">, string> = {
  long: "回复超七日",
  recent: "回复七日内"
};

export function emptyReplyAge(): ReplyAgeView {
  return { kind: "none", atMs: 0 };
}

/** 跟 Day16 投影一样，认 Date.parse 能解析的回复时间。解析不了就是无回复日龄。 */
function parseAt(value: string) {
  const text = value.trim();
  if (!text) return Number.NaN;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * 距现在超过 7 天算回复超七日。未超过（含刚好 7 天、含此刻、含更晚的时间）算回复七日内。
 * 没有回复，或时间解析不了，都是无回复日龄。
 */
export function presentReplyAge(input: ReplyAgeInput, now = new Date()): ReplyAgeView {
  if (!input.replied) return emptyReplyAge();
  const atMs = parseAt(input.at || "");
  if (!Number.isFinite(atMs)) return emptyReplyAge();
  const age = now.getTime() - atMs;
  if (age > REPLY_AGE_WINDOW_MS) return { kind: "long", atMs };
  return { kind: "recent", atMs };
}

export function replyAgeMatchesFilter(view: ReplyAgeView, filter: ReplyAgeListFilter) {
  if (filter === "long") return view.kind === "long";
  return true;
}

export function replyAgeRank(view: ReplyAgeView) {
  if (view.kind === "long") return 0;
  if (view.kind === "recent") return 1;
  return 2;
}

/** 从工作台打开时，回复超七日落到回复超七日筛选，回复七日内保持全部。 */
export function replyAgeListFilterForOpen(view: ReplyAgeView): ReplyAgeListFilter {
  if (view.kind === "long") return "long";
  return "all";
}

export function formatReplyAgeAt(ms: number) {
  if (!ms) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

export function replyAgeLineLabel(view: ReplyAgeView) {
  if (view.kind === "none") return "无回复日龄";
  const when = formatReplyAgeAt(view.atMs);
  return [KIND_LABEL[view.kind], when].filter(Boolean).join(" · ");
}

export function replyAgeStatusLabel(view: ReplyAgeView) {
  if (view.kind === "none") return "无回复日龄";
  return KIND_LABEL[view.kind];
}

export function replyAgeEntryLabel() {
  return "查看开发信回复";
}

export function replyAgeSummary(view: ReplyAgeView) {
  if (view.kind === "none") return `无回复日龄。${REPLY_AGE_BOUNDARY}`;
  const when = formatReplyAgeAt(view.atMs);
  return `${KIND_LABEL[view.kind]} ${when}。${REPLY_AGE_BOUNDARY}`;
}

export function listReplyAgeQueue<T extends { id: string }>(
  rows: readonly T[],
  viewOf: (row: T) => ReplyAgeView,
  limit = REPLY_AGE_LIMIT
) {
  const ranked = rows
    .map((row) => ({ row, view: viewOf(row) }))
    .filter((item) => item.view.kind !== "none")
    .sort((left, right) => {
      const rank = replyAgeRank(left.view) - replyAgeRank(right.view);
      if (rank) return rank;
      if (left.view.atMs !== right.view.atMs) return left.view.atMs - right.view.atMs;
      return left.row.id < right.row.id ? -1 : left.row.id > right.row.id ? 1 : 0;
    });
  const cap = Number.isFinite(limit) ? Math.max(0, limit) : ranked.length;
  return {
    total: ranked.length,
    rows: ranked.slice(0, cap).map((item) => item.row)
  };
}
