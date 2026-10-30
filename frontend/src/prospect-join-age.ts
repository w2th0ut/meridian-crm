/**
 * 短名单加入日龄的只读分类。
 * 只读候选上已经有的 shortlistedAt（加入搜客清单的时间）。
 * 不读 createdAt，也不读跟进、外联或联系方式上的时间。
 * 有加入时间，所以这里不是名单静默无动作日龄。
 * 相对现在：加入时间距现在超过 7 天标「较久」，未超过标「新近」。
 * 没有加入时间，或时间解析不了，标「未加入」。刚好 7 天仍算新近。
 * 不改名单，不发信，也不碰门禁。
 * 文案不和加入时间的日期范围、联系方式缺口、覆盖池缺口、跟进记录空档、获客待办摘要、下次跟进逾期、转化阶段卡住、待记跟进、今日到期、待发草稿、外联序列、回复、打开或点击、失败或抑制、收信同步混用。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const JOIN_AGE_WINDOW_DAYS = 7;
export const JOIN_AGE_WINDOW_MS = JOIN_AGE_WINDOW_DAYS * DAY_MS;
export const JOIN_AGE_LIMIT = 8;

export type JoinAgeKind = "none" | "older" | "recent";
export type JoinAgeListFilter = "all" | "older";

export interface JoinAgeInput {
  /** 短名单加入时间。空字符串表示未加入。 */
  shortlistedAt: string;
}

export interface JoinAgeView {
  kind: JoinAgeKind;
  /** 能解析的加入时间戳。解析不了是 0。 */
  joinedAtMs: number;
  /** 向下取整的日龄。未加入、以及未来时间，记 0。 */
  ageDays: number;
}

export const JOIN_AGE_BOUNDARY = "这里只按短名单已有的加入时间，相对现在判断日龄。加入时间距现在超过 7 天算较久，未超过算新近。没有加入时间，或时间解析不了，写未加入。创建时间不算加入时间。刚好 7 天仍算新近。这不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口，也不是跟进记录空档，也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住，也不是待记跟进或今日到期，也不是待发草稿、外联序列、回复、打开或点击、失败或抑制、收信同步。不会改名单，不会发信，也不会改 convert_to_lead 或 approved_contactable。";

const KIND_LABEL: Record<Exclude<JoinAgeKind, "none">, string> = {
  older: "较久",
  recent: "新近"
};

export function emptyJoinAge(): JoinAgeView {
  return { kind: "none", joinedAtMs: 0, ageDays: 0 };
}

/**
 * 超过 7 天算较久，刚好 7 天和更近的算新近。
 * 没有加入时间，或解析不了，都是未加入。
 */
export function presentJoinAge(input: JoinAgeInput, now = new Date()): JoinAgeView {
  const text = (input.shortlistedAt || "").trim();
  if (!text) return emptyJoinAge();
  const joinedAtMs = Date.parse(text);
  if (!Number.isFinite(joinedAtMs)) return emptyJoinAge();
  const ageMs = now.getTime() - joinedAtMs;
  return {
    kind: ageMs > JOIN_AGE_WINDOW_MS ? "older" : "recent",
    joinedAtMs,
    ageDays: Math.max(0, Math.floor(ageMs / DAY_MS))
  };
}

export function joinAgeMatchesFilter(view: JoinAgeView, filter: JoinAgeListFilter) {
  if (filter === "older") return view.kind === "older";
  return true;
}

export function joinAgeRank(view: JoinAgeView) {
  if (view.kind === "older") return 0;
  if (view.kind === "recent") return 1;
  return 2;
}

export function joinAgeIsOlder(view: JoinAgeView) {
  return view.kind === "older";
}

/** 从工作台打开时，较久落到较久筛选，新近保持全部。 */
export function joinAgeListFilterForOpen(view: JoinAgeView): JoinAgeListFilter {
  if (view.kind === "older") return "older";
  return "all";
}

export function formatJoinAgeAt(ms: number) {
  if (!ms) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

export function joinAgeDaysLabel(view: JoinAgeView) {
  if (view.kind === "none") return "";
  return `加入 ${view.ageDays} 天`;
}

export function joinAgeLineLabel(view: JoinAgeView) {
  if (view.kind === "none") return "未加入";
  const when = formatJoinAgeAt(view.joinedAtMs);
  return [KIND_LABEL[view.kind], joinAgeDaysLabel(view), when].filter(Boolean).join(" · ");
}

export function joinAgeStatusLabel(view: JoinAgeView) {
  if (view.kind === "none") return "未加入";
  return KIND_LABEL[view.kind];
}

export function joinAgeEntryLabel() {
  return "查看加入时间";
}

export function joinAgeSummary(view: JoinAgeView) {
  if (view.kind === "none") return `未加入。${JOIN_AGE_BOUNDARY}`;
  const when = formatJoinAgeAt(view.joinedAtMs);
  return `${KIND_LABEL[view.kind]} 加入 ${view.ageDays} 天${when ? ` ${when}` : ""}。${JOIN_AGE_BOUNDARY}`;
}

export function listJoinAgeQueue<T extends { id: string }>(
  rows: readonly T[],
  viewOf: (row: T) => JoinAgeView,
  limit = JOIN_AGE_LIMIT
) {
  const ranked = rows
    .map((row) => ({ row, view: viewOf(row) }))
    .filter((item) => item.view.kind !== "none")
    .sort((left, right) => {
      const rank = joinAgeRank(left.view) - joinAgeRank(right.view);
      if (rank) return rank;
      if (left.view.joinedAtMs !== right.view.joinedAtMs) return left.view.joinedAtMs - right.view.joinedAtMs;
      return left.row.id < right.row.id ? -1 : left.row.id > right.row.id ? 1 : 0;
    });
  const cap = Number.isFinite(limit) ? Math.max(0, limit) : ranked.length;
  return {
    total: ranked.length,
    rows: ranked.slice(0, cap).map((item) => item.row)
  };
}
