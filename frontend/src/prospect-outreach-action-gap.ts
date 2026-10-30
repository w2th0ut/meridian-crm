/**
 * 外联最近动作空档的只读分类。
 * 只读候选上已经有的最近一封开发信时间（lastDevelopmentEmailAt，ISO）。
 * 不读跟进注记、加入时间、下次跟进那种墙上时钟、最近触达或话机。
 * 相对现在：最近一封开发信距现在超过 7 天标「空档」，未超过标「近期有外联」。
 * 没有开发信时间，或时间解析不了，标「无外联记录」。刚好 7 天仍算近期有外联。
 * 不发信，不改名单，不推进序列，不自动记下跟进，也不碰门禁。
 * 文案不和名单静默、跟进记录空档、短名单加入日龄、联系方式缺口混用。
 */

export const OUTREACH_ACTION_GAP_WINDOW_DAYS = 7;
export const OUTREACH_ACTION_GAP_WINDOW_MS = OUTREACH_ACTION_GAP_WINDOW_DAYS * 24 * 60 * 60 * 1000;
export const OUTREACH_ACTION_GAP_LIMIT = 8;

export type OutreachActionGapKind = "none" | "gap" | "recent";
export type OutreachActionGapListFilter = "all" | "gap";

export interface OutreachActionGapInput {
  /** 最近一封开发信的 ISO 时间。空字符串表示没有记录。 */
  at: string;
}

export interface OutreachActionGapView {
  kind: OutreachActionGapKind;
  /** 能解析的开发信时间戳。解析不了是 0。 */
  atMs: number;
}

export const OUTREACH_ACTION_GAP_BOUNDARY = "这里只按已有最近一封开发信的时间，相对现在判断空档。最近一封开发信距现在超过 7 天算空档，未超过算近期有外联。没有开发信时间，或时间解析不了，写无外联记录。刚好 7 天仍算近期有外联。跟进记录不算开发信时间。加入短名单的时间不算开发信时间。创建时间不算开发信时间。下次跟进那种时间不算开发信时间。最近触达（含话机）不算开发信时间。这不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄，也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口，也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住，也不是待记跟进或今日到期，也不是待发草稿、外联序列、回复、打开或点击、失败或抑制、收信同步。不会发信，不会改名单，不会推进序列，不会自动记下跟进，也不会改 convert_to_lead 或 approved_contactable。";

const KIND_LABEL: Record<Exclude<OutreachActionGapKind, "none">, string> = {
  gap: "空档",
  recent: "近期有外联"
};

export function emptyOutreachActionGap(): OutreachActionGapView {
  return { kind: "none", atMs: 0 };
}

/**
 * 只认带 T 的 ISO 时间，这是最近一封开发信的时间。
 * 下次跟进那种墙上时钟即使能被 Date.parse 认出来，也写成无外联记录。
 */
function parseOutreachAt(value: string) {
  const text = value.trim();
  if (!text.includes("T")) return Number.NaN;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * 超过 7 天算空档，刚好 7 天和更近的算近期有外联。
 * 没有时间、解析不了、或不是 ISO 开发信时间，都是无外联记录。
 */
export function presentOutreachActionGap(input: OutreachActionGapInput, now = new Date()): OutreachActionGapView {
  const atMs = parseOutreachAt(input.at || "");
  if (!Number.isFinite(atMs)) return emptyOutreachActionGap();
  const age = now.getTime() - atMs;
  return {
    kind: age > OUTREACH_ACTION_GAP_WINDOW_MS ? "gap" : "recent",
    atMs
  };
}

export function outreachActionGapMatchesFilter(view: OutreachActionGapView, filter: OutreachActionGapListFilter) {
  if (filter === "gap") return view.kind === "gap";
  return true;
}

export function outreachActionGapRank(view: OutreachActionGapView) {
  if (view.kind === "gap") return 0;
  if (view.kind === "recent") return 1;
  return 2;
}

/** 从工作台打开时，空档落到空档筛选，近期有外联保持全部。 */
export function outreachActionGapListFilterForOpen(view: OutreachActionGapView): OutreachActionGapListFilter {
  if (view.kind === "gap") return "gap";
  return "all";
}

export function formatOutreachActionGapAt(ms: number) {
  if (!ms) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

export function outreachActionGapLineLabel(view: OutreachActionGapView) {
  if (view.kind === "none") return "无外联记录";
  const when = formatOutreachActionGapAt(view.atMs);
  return [KIND_LABEL[view.kind], when].filter(Boolean).join(" · ");
}

export function outreachActionGapStatusLabel(view: OutreachActionGapView) {
  if (view.kind === "none") return "无外联记录";
  return KIND_LABEL[view.kind];
}

export function outreachActionGapEntryLabel() {
  return "查看最近开发信";
}

export function outreachActionGapSummary(view: OutreachActionGapView) {
  if (view.kind === "none") return `无外联记录。${OUTREACH_ACTION_GAP_BOUNDARY}`;
  const when = formatOutreachActionGapAt(view.atMs);
  return `${KIND_LABEL[view.kind]} ${when}。${OUTREACH_ACTION_GAP_BOUNDARY}`;
}

export function listOutreachActionGapQueue<T extends { id: string }>(
  rows: readonly T[],
  viewOf: (row: T) => OutreachActionGapView,
  limit = OUTREACH_ACTION_GAP_LIMIT
) {
  const ranked = rows
    .map((row) => ({ row, view: viewOf(row) }))
    .filter((item) => item.view.kind !== "none")
    .sort((left, right) => {
      const rank = outreachActionGapRank(left.view) - outreachActionGapRank(right.view);
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
