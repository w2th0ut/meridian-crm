/**
 * 下次跟进逾期的只读分类。
 * 只读候选上已有的 nextFollowAt（Day10），按当前时刻分成逾期 / 今日 / 未到。
 * 没有时间写「无下次跟进」。不改时间，不自动跟进，不发信，也不碰门禁。
 * 文案不和获客待办摘要、待记跟进、今日到期、待发草稿、外联序列、回复、打开或点击、失败或抑制、收信同步混用。
 */

export const NEXT_FOLLOW_DUE_LIMIT = 8;

export type NextFollowDueKind = "empty" | "overdue" | "today" | "upcoming";
export type NextFollowDueListFilter = "all" | "overdue" | "today";

export interface NextFollowDueView {
  kind: NextFollowDueKind;
  /** 能解析时是 YYYY-MM-DD HH:mm，解析不了时保留原文。空字符串表示没有下次跟进。 */
  at: string;
  /** 能解析时是本地时间戳，否则是 0。 */
  dueAt: number;
}

export const NEXT_FOLLOW_DUE_BOUNDARY = "这里只按已有的下次跟进时间，相对今天标成逾期、今日或未到。这不是获客待办摘要，也不是待记跟进，也不是今日到期，也不是待发草稿，也不是外联序列，也不是回复条，也不是打开或点击条，也不是失败条，也不是抑制条，也不是收信同步。不会自动跟进，不会改时间，不会发信，也不会改 convert_to_lead 或 approved_contactable。";

const STAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/;

const KIND_LABEL: Record<Exclude<NextFollowDueKind, "empty">, string> = {
  overdue: "逾期",
  today: "今日",
  upcoming: "未到"
};

export function emptyNextFollowDue(): NextFollowDueView {
  return { kind: "empty", at: "", dueAt: 0 };
}

/**
 * 与 Day10 classifyProspectNextFollow 同一规则：只认 YYYY-MM-DD HH:mm。
 * 过了当前时刻算逾期，哪怕还在今天；今天还没到的时刻算今日；今天之后算未到。
 * 写不成年月日时刻的旧文本不算逾期，标未到。
 */
export function presentNextFollowDue(value: string | undefined, now = new Date()): NextFollowDueView {
  const raw = (value || "").replace(/\s+/g, " ").trim();
  if (!raw) return emptyNextFollowDue();
  const match = raw.match(STAMP);
  if (!match) return { kind: "upcoming", at: raw, dueAt: 0 };
  const due = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5])
  );
  if (Number.isNaN(due.getTime())) return { kind: "upcoming", at: raw, dueAt: 0 };
  const at = `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
  if (due.getTime() < now.getTime()) return { kind: "overdue", at, dueAt: due.getTime() };
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (due.getTime() < start.getTime() + 86_400_000) return { kind: "today", at, dueAt: due.getTime() };
  return { kind: "upcoming", at, dueAt: due.getTime() };
}

export function nextFollowDueMatchesFilter(view: NextFollowDueView, filter: NextFollowDueListFilter) {
  if (filter === "overdue") return view.kind === "overdue";
  if (filter === "today") return view.kind === "today";
  return true;
}

export function nextFollowDueRank(view: NextFollowDueView) {
  if (view.kind === "overdue") return 0;
  if (view.kind === "today") return 1;
  if (view.kind === "upcoming") return 2;
  return 3;
}

export function formatNextFollowDue(view: NextFollowDueView) {
  const match = view.at.match(STAMP);
  if (!match) return view.at;
  return `${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
}

export function nextFollowDueLineLabel(view: NextFollowDueView) {
  if (view.kind === "empty") return "无下次跟进";
  const when = formatNextFollowDue(view);
  return when ? `${KIND_LABEL[view.kind]} · ${when}` : KIND_LABEL[view.kind];
}

export function nextFollowDueStatusLabel(view: NextFollowDueView) {
  if (view.kind === "empty") return "无下次跟进";
  return KIND_LABEL[view.kind];
}

export function nextFollowDueEntryLabel() {
  return "去下次跟进";
}

export function nextFollowDueSummary(view: NextFollowDueView) {
  if (view.kind === "empty") return `无下次跟进。${NEXT_FOLLOW_DUE_BOUNDARY}`;
  const when = formatNextFollowDue(view);
  return `${KIND_LABEL[view.kind]}${when ? ` ${when}` : ""}。${NEXT_FOLLOW_DUE_BOUNDARY}`;
}

export function listNextFollowDueQueue<T extends { id: string; nextFollowAt?: string }>(
  rows: readonly T[],
  include: (row: T) => boolean,
  now = new Date(),
  limit = NEXT_FOLLOW_DUE_LIMIT
) {
  const ranked = rows
    .filter((row) => include(row))
    .map((row) => ({ row, view: presentNextFollowDue(row.nextFollowAt, now) }))
    .filter((item) => item.view.kind !== "empty")
    .sort((left, right) => {
      const rank = nextFollowDueRank(left.view) - nextFollowDueRank(right.view);
      if (rank) return rank;
      const leftAt = left.view.dueAt > 0 ? left.view.dueAt : Number.MAX_SAFE_INTEGER;
      const rightAt = right.view.dueAt > 0 ? right.view.dueAt : Number.MAX_SAFE_INTEGER;
      if (leftAt !== rightAt) return leftAt - rightAt;
      return left.row.id < right.row.id ? -1 : left.row.id > right.row.id ? 1 : 0;
    });
  const cap = Number.isFinite(limit) ? Math.max(0, limit) : ranked.length;
  return {
    total: ranked.length,
    rows: ranked.slice(0, cap).map((item) => item.row)
  };
}
