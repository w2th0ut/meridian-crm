/**
 * 序列下一步到期的只读分类。
 * 只读外联序列上已经带回的下一步 scheduledAt（和 Day17 同一条序列）。
 * 不读更新时间、方案下一次运行、跟进、加入时间、最近开发信或话机。
 * 相对现在：到期早于现在标「已到期」；还没到且 7 天内（含刚好 7 天、含此刻）标「即将到期」；更远标「未临近」。
 * 没有序列、没有下一步到期，或时间解析不了，标「无序列到期」。
 * 不发信，不推进序列，不改名单，也不碰门禁。
 * 文案不和空档、静默、跟进空档、加入日龄、逾期混用。
 */

export const SEQUENCE_NEXT_DUE_WINDOW_DAYS = 7;
export const SEQUENCE_NEXT_DUE_WINDOW_MS = SEQUENCE_NEXT_DUE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
export const SEQUENCE_NEXT_DUE_LIMIT = 8;

export type SequenceNextDueKind = "none" | "overdue" | "soon" | "later";
export type SequenceNextDueListFilter = "all" | "overdue";

export interface SequenceNextDueInput {
  /** 下一步的 ISO 计划时间。空字符串表示没有可解析的到期。 */
  dueAt: string;
}

export interface SequenceNextDueView {
  kind: SequenceNextDueKind;
  /** 能解析的到期时间戳。解析不了是 0。 */
  dueMs: number;
}

export const SEQUENCE_NEXT_DUE_BOUNDARY = "这里只按外联序列上已有的下一步计划时间，相对现在判断到期。到期早于现在算已到期。还没到且在 7 天内算即将到期，刚好 7 天和此刻仍算即将到期。再远算未临近。没有序列、没有下一步到期，或时间解析不了，写无序列到期。更新时间不算下一步到期。跟进记录不算下一步到期。加入短名单的时间不算下一步到期。下次跟进那种时间不算下一步到期。最近一封开发信的时间不算下一步到期。最近触达（含话机）不算下一步到期。这不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄，也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口，也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住，也不是待记跟进或今日到期，也不是待发草稿，也不是外联序列进度，也不是回复、打开或点击、失败或抑制、收信同步。不会发信，不会推进序列，不会改名单，也不会改 convert_to_lead 或 approved_contactable。";

const KIND_LABEL: Record<Exclude<SequenceNextDueKind, "none">, string> = {
  overdue: "已到期",
  soon: "即将到期",
  later: "未临近"
};

export function emptySequenceNextDue(): SequenceNextDueView {
  return { kind: "none", dueMs: 0 };
}

/**
 * 只认带 T 的 ISO 时间，这是下一步的 scheduledAt。
 * 下次跟进那种墙上时钟即使能被 Date.parse 认出来，也写成无序列到期。
 */
function parseDueAt(value: string) {
  const text = value.trim();
  if (!text.includes("T")) return Number.NaN;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * 早于现在算已到期。还没到且不超过 7 天（含刚好 7 天、含此刻）算即将到期。更远算未临近。
 * 没有时间、解析不了、或不是 ISO，都是无序列到期。
 */
export function presentSequenceNextDue(input: SequenceNextDueInput, now = new Date()): SequenceNextDueView {
  const dueMs = parseDueAt(input.dueAt || "");
  if (!Number.isFinite(dueMs)) return emptySequenceNextDue();
  const delta = dueMs - now.getTime();
  if (delta < 0) return { kind: "overdue", dueMs };
  if (delta <= SEQUENCE_NEXT_DUE_WINDOW_MS) return { kind: "soon", dueMs };
  return { kind: "later", dueMs };
}

export function sequenceNextDueMatchesFilter(view: SequenceNextDueView, filter: SequenceNextDueListFilter) {
  if (filter === "overdue") return view.kind === "overdue";
  return true;
}

export function sequenceNextDueRank(view: SequenceNextDueView) {
  if (view.kind === "overdue") return 0;
  if (view.kind === "soon") return 1;
  if (view.kind === "later") return 2;
  return 3;
}

/** 从工作台打开时，已到期落到已到期筛选，即将到期和未临近保持全部。 */
export function sequenceNextDueListFilterForOpen(view: SequenceNextDueView): SequenceNextDueListFilter {
  if (view.kind === "overdue") return "overdue";
  return "all";
}

export function formatSequenceNextDueAt(ms: number) {
  if (!ms) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

export function sequenceNextDueLineLabel(view: SequenceNextDueView) {
  if (view.kind === "none") return "无序列到期";
  const when = formatSequenceNextDueAt(view.dueMs);
  return [KIND_LABEL[view.kind], when].filter(Boolean).join(" · ");
}

export function sequenceNextDueStatusLabel(view: SequenceNextDueView) {
  if (view.kind === "none") return "无序列到期";
  return KIND_LABEL[view.kind];
}

export function sequenceNextDueEntryLabel() {
  return "查看外联序列";
}

export function sequenceNextDueSummary(view: SequenceNextDueView) {
  if (view.kind === "none") return `无序列到期。${SEQUENCE_NEXT_DUE_BOUNDARY}`;
  const when = formatSequenceNextDueAt(view.dueMs);
  return `${KIND_LABEL[view.kind]} ${when}。${SEQUENCE_NEXT_DUE_BOUNDARY}`;
}

export function listSequenceNextDueQueue<T extends { id: string }>(
  rows: readonly T[],
  viewOf: (row: T) => SequenceNextDueView,
  limit = SEQUENCE_NEXT_DUE_LIMIT
) {
  const ranked = rows
    .map((row) => ({ row, view: viewOf(row) }))
    .filter((item) => item.view.kind !== "none")
    .sort((left, right) => {
      const rank = sequenceNextDueRank(left.view) - sequenceNextDueRank(right.view);
      if (rank) return rank;
      if (left.view.dueMs !== right.view.dueMs) return left.view.dueMs - right.view.dueMs;
      return left.row.id < right.row.id ? -1 : left.row.id > right.row.id ? 1 : 0;
    });
  const cap = Number.isFinite(limit) ? Math.max(0, limit) : ranked.length;
  return {
    total: ranked.length,
    rows: ranked.slice(0, cap).map((item) => item.row)
  };
}
