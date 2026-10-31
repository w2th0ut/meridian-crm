/**
 * 状态变更日龄的只读分类。
 * 只读候选上已经有的 statusChangedAt（库字段 status_changed_at，状态变更写下的时间）。
 * 不另存一份时间，也不新做日龄字段。
 * 不读入库时间、核验时间、加入短名单的时间、跟进、下次跟进、开发信、序列、回复、打开、失败、抑制、待放行或收信同步。
 * 只有候选状态、没有这份状态变更时间时，不拿状态本身冒充。
 * 获客阶段上的进入时间不是这一节。
 * 相对现在：超过 7 天标「状态变更超七日」；未超过（含刚好 7 天）标「状态变更七日内」。
 * 没有状态变更时间，或时间解析不了，标「无状态变更日龄」。
 * 只认带 T 的时间。墙上时钟不算。
 * 不发信，不解除抑制，不推进序列，不放行批次，不改名单，不改邮箱配置，不改核验状态，也不碰门禁。
 * 文案不和候选入库日龄、收信同步异常日龄、序列最近一步、回复日龄、打开或点击日龄、失败退信日龄、抑制名单日龄、待放行批次、回复积压、序列到期、外联空档、静默、跟进空档、加入日龄混用。
 */

export const STATUS_CHANGE_AGE_WINDOW_DAYS = 7;
export const STATUS_CHANGE_AGE_WINDOW_MS = STATUS_CHANGE_AGE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
export const STATUS_CHANGE_AGE_LIMIT = 8;

export type StatusChangeAgeKind = "none" | "long" | "recent";
export type StatusChangeAgeListFilter = "all" | "long";

export interface StatusChangeAgeInput {
  /** 候选上已经有的状态变更时间。空字符串表示没有可解析时间。 */
  at: string;
}

export interface StatusChangeAgeView {
  kind: StatusChangeAgeKind;
  /** 能解析的状态变更时间戳。解析不了是 0。 */
  atMs: number;
}

export const STATUS_CHANGE_AGE_BOUNDARY = "这里只按候选上已有的状态变更时间，相对现在判断日龄。时间就是候选上已经有的 statusChangedAt，对应库里的 status_changed_at。这是状态变更写下的时间，不是更新时间，也不是核验时间，也不是入库时间。状态变更且距现在超过 7 天算状态变更超七日。未超过算状态变更七日内，刚好 7 天仍算状态变更七日内。没有状态变更时间，或时间解析不了，写无状态变更日龄，也不编造。只认带 T 的时间。墙上时钟不算。只有候选状态、没有这份状态变更时间时，不拿状态本身冒充。核验时间不算状态变更时间。入库时间不算状态变更时间。加入短名单的时间不算状态变更时间。跟进记录不算状态变更时间。下次跟进那种时间不算状态变更时间。最近一封开发信的发出时间不算状态变更时间。序列下一步的计划时间不算状态变更时间。已发出步骤的时间不算状态变更时间。开发信回复的时间不算状态变更时间。打开或点击的发生时间不算状态变更时间。失败或退信的发生时间不算状态变更时间。抑制或退订的生效时间不算状态变更时间。待放行批次的更新时间不算状态变更时间。最近触达（含话机）不算状态变更时间。收信同步的账号状态不算状态变更时间。获客阶段上的进入时间不是这一节。这不是候选入库日龄，也不是收信同步异常日龄，也不是序列最近一步日龄，也不是开发信回复日龄，也不是打开或点击日龄，也不是失败退信日龄，也不是抑制名单日龄，也不是待放行批次，也不是回复待处理积压，也不是序列下一步到期，也不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄，也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口，也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住，也不是待记跟进或今日到期，也不是待发草稿、外联序列进度，也不是打开或点击、失败或退信、收信同步那一块。不替代候选入库日龄，也不替代获客阶段。不会发信，不会解除抑制，不会推进序列，不会放行批次，不会改名单，不会改邮箱配置，不会改核验状态，也不会改 convert_to_lead 或 approved_contactable。";

const KIND_LABEL: Record<Exclude<StatusChangeAgeKind, "none">, string> = {
  long: "状态变更超七日",
  recent: "状态变更七日内"
};

export function emptyStatusChangeAge(): StatusChangeAgeView {
  return { kind: "none", atMs: 0 };
}

/** 只认带 T 的时间。墙上时钟和空字符串都是无状态变更日龄。 */
function parseAt(value: string) {
  const text = value.trim();
  if (!text.includes("T")) return Number.NaN;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * 距现在超过 7 天算状态变更超七日。未超过（含刚好 7 天、含此刻、含更晚的时间）算状态变更七日内。
 * 没有状态变更时间，或时间解析不了，都是无状态变更日龄。
 */
export function presentStatusChangeAge(input: StatusChangeAgeInput, now = new Date()): StatusChangeAgeView {
  const atMs = parseAt(input.at || "");
  if (!Number.isFinite(atMs)) return emptyStatusChangeAge();
  const age = now.getTime() - atMs;
  if (age > STATUS_CHANGE_AGE_WINDOW_MS) return { kind: "long", atMs };
  return { kind: "recent", atMs };
}

export function statusChangeAgeMatchesFilter(view: StatusChangeAgeView, filter: StatusChangeAgeListFilter) {
  if (filter === "long") return view.kind === "long";
  return true;
}

export function statusChangeAgeRank(view: StatusChangeAgeView) {
  if (view.kind === "long") return 0;
  if (view.kind === "recent") return 1;
  return 2;
}

/** 从工作台打开时，状态变更超七日落到状态变更超七日筛选，状态变更七日内保持全部。 */
export function statusChangeAgeListFilterForOpen(view: StatusChangeAgeView): StatusChangeAgeListFilter {
  if (view.kind === "long") return "long";
  return "all";
}

export function formatStatusChangeAgeAt(ms: number) {
  if (!ms) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

export function statusChangeAgeLineLabel(view: StatusChangeAgeView) {
  if (view.kind === "none") return "无状态变更日龄";
  const when = formatStatusChangeAgeAt(view.atMs);
  return [KIND_LABEL[view.kind], when].filter(Boolean).join(" · ");
}

export function statusChangeAgeStatusLabel(view: StatusChangeAgeView) {
  if (view.kind === "none") return "无状态变更日龄";
  return KIND_LABEL[view.kind];
}

export function statusChangeAgeEntryLabel() {
  return "查看候选详情";
}

export function statusChangeAgeSummary(view: StatusChangeAgeView) {
  if (view.kind === "none") return `无状态变更日龄。${STATUS_CHANGE_AGE_BOUNDARY}`;
  const when = formatStatusChangeAgeAt(view.atMs);
  return `${KIND_LABEL[view.kind]} ${when}。${STATUS_CHANGE_AGE_BOUNDARY}`;
}

export function listStatusChangeAgeQueue<T extends { id: string }>(
  rows: readonly T[],
  viewOf: (row: T) => StatusChangeAgeView,
  limit = STATUS_CHANGE_AGE_LIMIT
) {
  const ranked = rows
    .map((row) => ({ row, view: viewOf(row) }))
    .filter((item) => item.view.kind !== "none")
    .sort((left, right) => {
      const rank = statusChangeAgeRank(left.view) - statusChangeAgeRank(right.view);
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
