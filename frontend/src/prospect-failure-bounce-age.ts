/**
 * 失败退信日龄的只读分类。
 * 主路径：只读候选上 Day14 开发信失败或退信说明已经带出的发生时间。
 * 那份时间就是详情「开发信失败或退信」上的同一份发生时间。
 * 不另存一份时间，也不新做日龄字段。抑制和退订不进这里。
 * 不读跟进、加入时间、下次跟进、开发信发出时间、序列下一步、最近回复、最近触达、待放行批次或收信同步。
 * 相对现在：超过 7 天标「失败超七日」；未超过（含刚好 7 天）标「失败七日内」。
 * 没有失败或退信，或时间解析不了，标「无失败日龄」。
 * 不自动重发，不解除抑制，不发信，不改名单，也不碰门禁。
 * 文案不和抑制名单日龄、待放行批次、回复积压、序列到期、外联空档、静默、跟进空档、逾期混用。
 */

export const FAILURE_BOUNCE_AGE_WINDOW_DAYS = 7;
export const FAILURE_BOUNCE_AGE_WINDOW_MS = FAILURE_BOUNCE_AGE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
export const FAILURE_BOUNCE_AGE_LIMIT = 8;

export type FailureBounceAgeKind = "none" | "long" | "recent";
export type FailureBounceAgeListFilter = "all" | "long";

export interface FailureBounceAgeInput {
  /** 当前有失败或退信才为 true。没有这类记录为 false，即使带了时间也不算。 */
  failed: boolean;
  /** Day14 失败或退信说明上已有的发生时间。空字符串表示没有可解析时间。 */
  at: string;
}

export interface FailureBounceAgeView {
  kind: FailureBounceAgeKind;
  /** 能解析的失败或退信发生时间戳。解析不了是 0。 */
  atMs: number;
}

export const FAILURE_BOUNCE_AGE_BOUNDARY = "这里只按候选上已有的开发信失败或退信发生时间，相对现在判断日龄。时间是 Day14 开发信失败或退信说明已经带出的发生时间，和详情上那一块是同一份。失败或退信且距现在超过 7 天算失败超七日。未超过算失败七日内，刚好 7 天仍算失败七日内。没有失败或退信，或时间解析不了，写无失败日龄。只有别的状态、没有这份发生时间时也不编造。抑制或退订的生效时间不算这次失败的时间。待放行批次的更新时间不算这次失败的时间。跟进记录不算这次失败的时间。加入短名单的时间不算这次失败的时间。下次跟进那种时间不算这次失败的时间。最近一封开发信的发出时间不算这次失败的时间。序列下一步的计划时间不算这次失败的时间。最近一次开发信回复的时间不算这次失败的时间。最近触达（含话机）不算这次失败的时间。收信同步的账号状态不算这次失败的时间。这不是抑制名单日龄，也不是待放行批次，也不是回复待处理积压，也不是序列下一步到期，也不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄，也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口，也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住，也不是待记跟进或今日到期，也不是待发草稿、外联序列进度，也不是打开或点击、收信同步。不替代开发信失败或退信那一块。不会自动重发，不会解除抑制，不会发信，不会改名单，也不会改 convert_to_lead 或 approved_contactable。";

const KIND_LABEL: Record<Exclude<FailureBounceAgeKind, "none">, string> = {
  long: "失败超七日",
  recent: "失败七日内"
};

export function emptyFailureBounceAge(): FailureBounceAgeView {
  return { kind: "none", atMs: 0 };
}

/** 跟 Day14 投影一样，认 Date.parse 能解析的发生时间。解析不了就是无失败日龄。 */
function parseAt(value: string) {
  const text = value.trim();
  if (!text) return Number.NaN;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * 距现在超过 7 天算失败超七日。未超过（含刚好 7 天、含此刻、含更晚的时间）算失败七日内。
 * 没有失败或退信，或时间解析不了，都是无失败日龄。
 */
export function presentFailureBounceAge(input: FailureBounceAgeInput, now = new Date()): FailureBounceAgeView {
  if (!input.failed) return emptyFailureBounceAge();
  const atMs = parseAt(input.at || "");
  if (!Number.isFinite(atMs)) return emptyFailureBounceAge();
  const age = now.getTime() - atMs;
  if (age > FAILURE_BOUNCE_AGE_WINDOW_MS) return { kind: "long", atMs };
  return { kind: "recent", atMs };
}

export function failureBounceAgeMatchesFilter(view: FailureBounceAgeView, filter: FailureBounceAgeListFilter) {
  if (filter === "long") return view.kind === "long";
  return true;
}

export function failureBounceAgeRank(view: FailureBounceAgeView) {
  if (view.kind === "long") return 0;
  if (view.kind === "recent") return 1;
  return 2;
}

/** 从工作台打开时，失败超七日落到失败超七日筛选，失败七日内保持全部。 */
export function failureBounceAgeListFilterForOpen(view: FailureBounceAgeView): FailureBounceAgeListFilter {
  if (view.kind === "long") return "long";
  return "all";
}

export function formatFailureBounceAgeAt(ms: number) {
  if (!ms) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

export function failureBounceAgeLineLabel(view: FailureBounceAgeView) {
  if (view.kind === "none") return "无失败日龄";
  const when = formatFailureBounceAgeAt(view.atMs);
  return [KIND_LABEL[view.kind], when].filter(Boolean).join(" · ");
}

export function failureBounceAgeStatusLabel(view: FailureBounceAgeView) {
  if (view.kind === "none") return "无失败日龄";
  return KIND_LABEL[view.kind];
}

export function failureBounceAgeEntryLabel() {
  return "查看失败或退信";
}

export function failureBounceAgeSummary(view: FailureBounceAgeView) {
  if (view.kind === "none") return `无失败日龄。${FAILURE_BOUNCE_AGE_BOUNDARY}`;
  const when = formatFailureBounceAgeAt(view.atMs);
  return `${KIND_LABEL[view.kind]} ${when}。${FAILURE_BOUNCE_AGE_BOUNDARY}`;
}

export function listFailureBounceAgeQueue<T extends { id: string }>(
  rows: readonly T[],
  viewOf: (row: T) => FailureBounceAgeView,
  limit = FAILURE_BOUNCE_AGE_LIMIT
) {
  const ranked = rows
    .map((row) => ({ row, view: viewOf(row) }))
    .filter((item) => item.view.kind !== "none")
    .sort((left, right) => {
      const rank = failureBounceAgeRank(left.view) - failureBounceAgeRank(right.view);
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
