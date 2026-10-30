/**
 * 抑制名单日龄的只读分类。
 * 主路径：只读候选上 Day8 抑制/退订说明已经带出的生效时间。
 * 那份时间是抑制事件的 effectiveAt；退订没有抑制事件时，投影才改用同一条退订核验的 verifiedAt。
 * 不另存一份时间，也不新做日龄字段。退信和联系方式无效不进这里。
 * 不读跟进、加入时间、下次跟进、开发信发出时间、序列下一步、最近回复、最近触达、待放行批次或收信同步。
 * 相对现在：超过 7 天标「抑制超七日」；未超过（含刚好 7 天）标「抑制七日内」。
 * 没有抑制或退订，或时间解析不了，标「无抑制日龄」。
 * 不解除抑制，不发信，不改名单，也不碰门禁。
 * 文案不和待放行批次、回复积压、序列到期、外联空档、静默、跟进空档、逾期混用。
 */

export const SUPPRESS_LIST_AGE_WINDOW_DAYS = 7;
export const SUPPRESS_LIST_AGE_WINDOW_MS = SUPPRESS_LIST_AGE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
export const SUPPRESS_LIST_AGE_LIMIT = 8;

export type SuppressListAgeKind = "none" | "long" | "recent";
export type SuppressListAgeListFilter = "all" | "long";

export interface SuppressListAgeInput {
  /** 当前有抑制或退订才为 true。退信、无效或没有这类说明为 false，即使带了时间也不算。 */
  held: boolean;
  /** Day8 抑制或退订说明上已有的生效时间。空字符串表示没有可解析时间。 */
  effectiveAt: string;
}

export interface SuppressListAgeView {
  kind: SuppressListAgeKind;
  /** 能解析的抑制或退订生效时间戳。解析不了是 0。 */
  effectiveMs: number;
}

export const SUPPRESS_LIST_AGE_BOUNDARY = "这里只按候选上已有的抑制或退订生效时间，相对现在判断日龄。时间是 Day8 抑制或退订说明已经带出的生效时间：抑制事件的生效时间；退订没有抑制事件时，才用同一条退订核验上已有的核验时间。抑制或退订且距现在超过 7 天算抑制超七日。未超过算抑制七日内，刚好 7 天仍算抑制七日内。没有抑制或退订，或时间解析不了，写无抑制日龄。退信和联系方式无效不算抑制名单。只有状态、没有这份生效时间时也不编造。跟进记录不算这次抑制的时间。加入短名单的时间不算这次抑制的时间。下次跟进那种时间不算这次抑制的时间。最近一封开发信的发出时间不算这次抑制的时间。序列下一步的计划时间不算这次抑制的时间。最近一次开发信回复的时间不算这次抑制的时间。最近触达（含话机）不算这次抑制的时间。收信同步的账号状态不算这次抑制的时间。待放行批次的更新时间不算这次抑制的时间。这不是待放行批次，也不是回复待处理积压，也不是序列下一步到期，也不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄，也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口，也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住，也不是待记跟进或今日到期，也不是待发草稿、外联序列进度，也不是打开或点击、失败或退信、收信同步。不替代抑制或退订原因那一块。不会解除抑制，不会发信，不会改名单，也不会改 convert_to_lead 或 approved_contactable。";

const KIND_LABEL: Record<Exclude<SuppressListAgeKind, "none">, string> = {
  long: "抑制超七日",
  recent: "抑制七日内"
};

export function emptySuppressListAge(): SuppressListAgeView {
  return { kind: "none", effectiveMs: 0 };
}

/** 跟 Day8 投影一样，认 Date.parse 能解析的生效时间。解析不了就是无抑制日龄。 */
function parseEffectiveAt(value: string) {
  const text = value.trim();
  if (!text) return Number.NaN;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * 距现在超过 7 天算抑制超七日。未超过（含刚好 7 天、含此刻、含更晚的时间）算抑制七日内。
 * 没有抑制或退订，或时间解析不了，都是无抑制日龄。
 */
export function presentSuppressListAge(input: SuppressListAgeInput, now = new Date()): SuppressListAgeView {
  if (!input.held) return emptySuppressListAge();
  const effectiveMs = parseEffectiveAt(input.effectiveAt || "");
  if (!Number.isFinite(effectiveMs)) return emptySuppressListAge();
  const age = now.getTime() - effectiveMs;
  if (age > SUPPRESS_LIST_AGE_WINDOW_MS) return { kind: "long", effectiveMs };
  return { kind: "recent", effectiveMs };
}

export function suppressListAgeMatchesFilter(view: SuppressListAgeView, filter: SuppressListAgeListFilter) {
  if (filter === "long") return view.kind === "long";
  return true;
}

export function suppressListAgeRank(view: SuppressListAgeView) {
  if (view.kind === "long") return 0;
  if (view.kind === "recent") return 1;
  return 2;
}

/** 从工作台打开时，抑制超七日落到抑制超七日筛选，抑制七日内保持全部。 */
export function suppressListAgeListFilterForOpen(view: SuppressListAgeView): SuppressListAgeListFilter {
  if (view.kind === "long") return "long";
  return "all";
}

export function formatSuppressListAgeAt(ms: number) {
  if (!ms) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

export function suppressListAgeLineLabel(view: SuppressListAgeView) {
  if (view.kind === "none") return "无抑制日龄";
  const when = formatSuppressListAgeAt(view.effectiveMs);
  return [KIND_LABEL[view.kind], when].filter(Boolean).join(" · ");
}

export function suppressListAgeStatusLabel(view: SuppressListAgeView) {
  if (view.kind === "none") return "无抑制日龄";
  return KIND_LABEL[view.kind];
}

export function suppressListAgeEntryLabel() {
  return "查看抑制或退订";
}

export function suppressListAgeSummary(view: SuppressListAgeView) {
  if (view.kind === "none") return `无抑制日龄。${SUPPRESS_LIST_AGE_BOUNDARY}`;
  const when = formatSuppressListAgeAt(view.effectiveMs);
  return `${KIND_LABEL[view.kind]} ${when}。${SUPPRESS_LIST_AGE_BOUNDARY}`;
}

export function listSuppressListAgeQueue<T extends { id: string }>(
  rows: readonly T[],
  viewOf: (row: T) => SuppressListAgeView,
  limit = SUPPRESS_LIST_AGE_LIMIT
) {
  const ranked = rows
    .map((row) => ({ row, view: viewOf(row) }))
    .filter((item) => item.view.kind !== "none")
    .sort((left, right) => {
      const rank = suppressListAgeRank(left.view) - suppressListAgeRank(right.view);
      if (rank) return rank;
      if (left.view.effectiveMs !== right.view.effectiveMs) return left.view.effectiveMs - right.view.effectiveMs;
      return left.row.id < right.row.id ? -1 : left.row.id > right.row.id ? 1 : 0;
    });
  const cap = Number.isFinite(limit) ? Math.max(0, limit) : ranked.length;
  return {
    total: ranked.length,
    rows: ranked.slice(0, cap).map((item) => item.row)
  };
}
