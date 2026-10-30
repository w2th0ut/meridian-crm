/**
 * 跟进记录空档的只读分类。
 * 只读 Day9 已经挂在候选上的最近一条人工跟进时间（latestFollowUp.at，ISO createdAt）。
 * 不读下次跟进那种 YYYY-MM-DD HH:mm，也不另存一份空档字段。
 * 相对现在：最近一条跟进距现在超过 7 天标「空档」，未超过标「近期有跟进」。
 * 没有跟进记录，或时间解析不了，标「无记录」。刚好 7 天仍算近期有跟进。
 * 不自动记下跟进，不改下次跟进，不发信，也不碰门禁。
 * 文案不和下次跟进逾期、转化阶段卡住、获客待办摘要、待记跟进、今日到期、待发草稿、外联序列、回复、打开或点击、失败或抑制、收信同步混用。
 */

export const FOLLOW_UP_GAP_WINDOW_DAYS = 7;
export const FOLLOW_UP_GAP_WINDOW_MS = FOLLOW_UP_GAP_WINDOW_DAYS * 24 * 60 * 60 * 1000;
export const FOLLOW_UP_GAP_LIMIT = 8;

export type FollowUpGapKind = "none" | "gap" | "recent";
export type FollowUpGapListFilter = "all" | "gap";

export interface FollowUpGapInput {
  /** Day9 跟进注记的 ISO 时间。空字符串表示没有记录。 */
  at: string;
}

export interface FollowUpGapView {
  kind: FollowUpGapKind;
  /** 能解析的跟进时间戳。解析不了是 0。 */
  atMs: number;
}

export const FOLLOW_UP_GAP_BOUNDARY = "这里只按已有跟进记录的时间，相对现在判断空档。最近一条跟进距现在超过 7 天算空档，未超过算近期有跟进。没有跟进记录，或时间解析不了，写无记录。下次跟进那种时间不算跟进记录。这不是下次跟进逾期，也不是转化阶段卡住，也不是获客待办摘要，也不是待记跟进或今日到期，也不是待发草稿、外联序列、回复、打开或点击、失败或抑制、收信同步。不会自动记下跟进，不会改下次跟进，不会发信，也不会改 convert_to_lead 或 approved_contactable。";

const KIND_LABEL: Record<Exclude<FollowUpGapKind, "none">, string> = {
  gap: "空档",
  recent: "近期有跟进"
};

export function emptyFollowUpGap(): FollowUpGapView {
  return { kind: "none", atMs: 0 };
}

/**
 * 只认带 T 的 ISO 时间，这是 Day9 注记的 createdAt。
 * 下次跟进那种墙上时钟即使能被 Date.parse 认出来，也写成无记录。
 */
function parseNoteAt(value: string) {
  const text = value.trim();
  if (!text.includes("T")) return Number.NaN;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * 超过 7 天算空档，刚好 7 天和更近的算近期有跟进。
 * 没有时间、解析不了、或不是 ISO 跟进时间，都是无记录。
 */
export function presentFollowUpGap(input: FollowUpGapInput, now = new Date()): FollowUpGapView {
  const atMs = parseNoteAt(input.at || "");
  if (!Number.isFinite(atMs)) return emptyFollowUpGap();
  const age = now.getTime() - atMs;
  return {
    kind: age > FOLLOW_UP_GAP_WINDOW_MS ? "gap" : "recent",
    atMs
  };
}

export function followUpGapMatchesFilter(view: FollowUpGapView, filter: FollowUpGapListFilter) {
  if (filter === "gap") return view.kind === "gap";
  return true;
}

export function followUpGapRank(view: FollowUpGapView) {
  if (view.kind === "gap") return 0;
  if (view.kind === "recent") return 1;
  return 2;
}

export function formatFollowUpGapAt(ms: number) {
  if (!ms) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

export function followUpGapLineLabel(view: FollowUpGapView) {
  if (view.kind === "none") return "无记录";
  const when = formatFollowUpGapAt(view.atMs);
  return [KIND_LABEL[view.kind], when].filter(Boolean).join(" · ");
}

export function followUpGapStatusLabel(view: FollowUpGapView) {
  if (view.kind === "none") return "无记录";
  return KIND_LABEL[view.kind];
}

export function followUpGapEntryLabel() {
  return "去跟进记录";
}

export function followUpGapSummary(view: FollowUpGapView) {
  if (view.kind === "none") return `无记录。${FOLLOW_UP_GAP_BOUNDARY}`;
  const when = formatFollowUpGapAt(view.atMs);
  return `${KIND_LABEL[view.kind]} ${when}。${FOLLOW_UP_GAP_BOUNDARY}`;
}

export function listFollowUpGapQueue<T extends { id: string }>(
  rows: readonly T[],
  viewOf: (row: T) => FollowUpGapView,
  limit = FOLLOW_UP_GAP_LIMIT
) {
  const ranked = rows
    .map((row) => ({ row, view: viewOf(row) }))
    .filter((item) => item.view.kind !== "none")
    .sort((left, right) => {
      const rank = followUpGapRank(left.view) - followUpGapRank(right.view);
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
