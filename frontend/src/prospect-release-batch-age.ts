/**
 * 待放行批次的只读日龄。
 * 只读候选上已经投影的待放行批次：Day22 待发草稿那份 outreachDraftBacklog，
 * 状态仍是 pending（还没放行）时，用它已有的 updatedAt。
 * 不另存一份时间，也不新做批次字段。已放行的批次不进这里。
 * 不读跟进、加入时间、下次跟进、开发信发出时间、序列下一步、最近回复、最近触达或收信同步。
 * 相对现在：超过 7 天标「待放已久」；未超过（含刚好 7 天）标「待放未久」。
 * 没有待放行批次，或时间解析不了，标「无待放行」。
 * 不放行，不发信，不推进序列，不改名单，也不碰门禁。
 * 文案不和序列到期、回复积压、外联空档、静默、跟进空档、逾期混用。
 */

export const RELEASE_BATCH_AGE_WINDOW_DAYS = 7;
export const RELEASE_BATCH_AGE_WINDOW_MS = RELEASE_BATCH_AGE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
export const RELEASE_BATCH_AGE_LIMIT = 8;

export type ReleaseBatchAgeKind = "none" | "held" | "recent";
export type ReleaseBatchAgeListFilter = "all" | "held";

export interface ReleaseBatchAgeInput {
  /** 还没放行才为 true。已放行或没有批次为 false，即使带了时间也不算。 */
  pending: boolean;
  /** 待放行批次上已有的更新时间。空字符串表示没有可解析的待放行批次。 */
  updatedAt: string;
}

export interface ReleaseBatchAgeView {
  kind: ReleaseBatchAgeKind;
  /** 能解析的待放行批次时间戳。解析不了是 0。 */
  updatedMs: number;
}

export const RELEASE_BATCH_AGE_BOUNDARY = "这里只按候选上已有的待放行批次更新时间，相对现在判断搁置。待放行且距现在超过 7 天算待放已久。未超过算待放未久，刚好 7 天仍算待放未久。没有待放行批次，或时间解析不了，写无待放行。已放行的批次不算待放行。跟进记录不算这批的时间。加入短名单的时间不算这批的时间。下次跟进那种时间不算这批的时间。最近一封开发信的发出时间不算这批的时间。序列下一步的计划时间不算这批的时间。最近一次开发信回复的时间不算这批的时间。最近触达（含话机）不算这批的时间。收信同步的账号状态不算这批的时间。这不是回复待处理积压，也不是序列下一步到期，也不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄，也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口，也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住，也不是待记跟进或今日到期，也不是外联序列进度，也不是打开或点击、失败或抑制、收信同步。不替代待发草稿那一块。不会放行批次，不会发信，不会推进序列，不会改名单，也不会改 convert_to_lead 或 approved_contactable。";

const KIND_LABEL: Record<Exclude<ReleaseBatchAgeKind, "none">, string> = {
  held: "待放已久",
  recent: "待放未久"
};

export function emptyReleaseBatchAge(): ReleaseBatchAgeView {
  return { kind: "none", updatedMs: 0 };
}

/** 跟待发草稿投影一样，认 Date.parse 能解析的批次更新时间。解析不了就是无待放行。 */
function parseUpdatedAt(value: string) {
  const text = value.trim();
  if (!text) return Number.NaN;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * 距现在超过 7 天算待放已久。未超过（含刚好 7 天、含此刻、含更晚的时间）算待放未久。
 * 没有待放行批次，或时间解析不了，都是无待放行。
 */
export function presentReleaseBatchAge(input: ReleaseBatchAgeInput, now = new Date()): ReleaseBatchAgeView {
  if (!input.pending) return emptyReleaseBatchAge();
  const updatedMs = parseUpdatedAt(input.updatedAt || "");
  if (!Number.isFinite(updatedMs)) return emptyReleaseBatchAge();
  const age = now.getTime() - updatedMs;
  if (age > RELEASE_BATCH_AGE_WINDOW_MS) return { kind: "held", updatedMs };
  return { kind: "recent", updatedMs };
}

export function releaseBatchAgeMatchesFilter(view: ReleaseBatchAgeView, filter: ReleaseBatchAgeListFilter) {
  if (filter === "held") return view.kind === "held";
  return true;
}

export function releaseBatchAgeRank(view: ReleaseBatchAgeView) {
  if (view.kind === "held") return 0;
  if (view.kind === "recent") return 1;
  return 2;
}

/** 从工作台打开时，待放已久落到待放已久筛选，待放未久保持全部。 */
export function releaseBatchAgeListFilterForOpen(view: ReleaseBatchAgeView): ReleaseBatchAgeListFilter {
  if (view.kind === "held") return "held";
  return "all";
}

export function formatReleaseBatchAgeAt(ms: number) {
  if (!ms) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

export function releaseBatchAgeLineLabel(view: ReleaseBatchAgeView) {
  if (view.kind === "none") return "无待放行";
  const when = formatReleaseBatchAgeAt(view.updatedMs);
  return [KIND_LABEL[view.kind], when].filter(Boolean).join(" · ");
}

export function releaseBatchAgeStatusLabel(view: ReleaseBatchAgeView) {
  if (view.kind === "none") return "无待放行";
  return KIND_LABEL[view.kind];
}

export function releaseBatchAgeEntryLabel() {
  return "查看待放行批次";
}

export function releaseBatchAgeSummary(view: ReleaseBatchAgeView) {
  if (view.kind === "none") return `无待放行。${RELEASE_BATCH_AGE_BOUNDARY}`;
  const when = formatReleaseBatchAgeAt(view.updatedMs);
  return `${KIND_LABEL[view.kind]} ${when}。${RELEASE_BATCH_AGE_BOUNDARY}`;
}

export function listReleaseBatchAgeQueue<T extends { id: string }>(
  rows: readonly T[],
  viewOf: (row: T) => ReleaseBatchAgeView,
  limit = RELEASE_BATCH_AGE_LIMIT
) {
  const ranked = rows
    .map((row) => ({ row, view: viewOf(row) }))
    .filter((item) => item.view.kind !== "none")
    .sort((left, right) => {
      const rank = releaseBatchAgeRank(left.view) - releaseBatchAgeRank(right.view);
      if (rank) return rank;
      if (left.view.updatedMs !== right.view.updatedMs) return left.view.updatedMs - right.view.updatedMs;
      return left.row.id < right.row.id ? -1 : left.row.id > right.row.id ? 1 : 0;
    });
  const cap = Number.isFinite(limit) ? Math.max(0, limit) : ranked.length;
  return {
    total: ranked.length,
    rows: ranked.slice(0, cap).map((item) => item.row)
  };
}
