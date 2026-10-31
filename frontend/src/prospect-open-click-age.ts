/**
 * 打开或点击日龄的只读分类。
 * 主路径：只读候选上 Day15 开发信打开或点击说明已经带出的发生时间。
 * 那份时间就是详情「开发信打开或点击」上的同一份 `at`。
 * 打开和点击都有可解析时间时，取较晚的那一份。
 * 不另存一份时间，也不新做日龄字段。失败和退信不进这里。
 * 不读跟进、加入时间、下次跟进、开发信发出时间、序列下一步、最近回复、最近触达、待放行批次、抑制生效时间或收信同步。
 * 相对现在：超过 7 天标「打开超七日」；未超过（含刚好 7 天）标「打开七日内」。
 * 没有打开或点击，或时间解析不了，标「无打开日龄」。
 * 不自动跟进，不自动发下一封，不推进序列，不发信，不改名单，也不碰门禁。
 * 文案不和失败退信日龄、抑制名单日龄、待放行批次、回复积压、序列到期、外联空档、静默、跟进空档、逾期混用。
 */

export const OPEN_CLICK_AGE_WINDOW_DAYS = 7;
export const OPEN_CLICK_AGE_WINDOW_MS = OPEN_CLICK_AGE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
export const OPEN_CLICK_AGE_LIMIT = 8;

export type OpenClickAgeKind = "none" | "long" | "recent";
export type OpenClickAgeListFilter = "all" | "long";

export interface OpenClickAgeInput {
  /** 当前有打开或点击才为 true。没有这类记录为 false，即使带了时间也不算。 */
  opened: boolean;
  /** Day15 打开或点击说明上已有的发生时间。打开和点击都有时，调用方传入较晚的那一份。空字符串表示没有可解析时间。 */
  at: string;
}

export interface OpenClickAgeView {
  kind: OpenClickAgeKind;
  /** 能解析的打开或点击发生时间戳。解析不了是 0。 */
  atMs: number;
}

export const OPEN_CLICK_AGE_BOUNDARY = "这里只按候选上已有的开发信打开或点击发生时间，相对现在判断日龄。时间是 Day15 开发信打开或点击说明已经带出的发生时间，和详情上那一块是同一份。打开和点击都有可解析时间时，取较晚的那一份。打开或点击且距现在超过 7 天算打开超七日。未超过算打开七日内，刚好 7 天仍算打开七日内。没有打开或点击，或时间解析不了，写无打开日龄。只有别的状态、没有这份发生时间时也不编造。失败或退信的发生时间不算这次打开的时间。抑制或退订的生效时间不算这次打开的时间。待放行批次的更新时间不算这次打开的时间。跟进记录不算这次打开的时间。加入短名单的时间不算这次打开的时间。下次跟进那种时间不算这次打开的时间。最近一封开发信的发出时间不算这次打开的时间。序列下一步的计划时间不算这次打开的时间。最近一次开发信回复的时间不算这次打开的时间。最近触达（含话机）不算这次打开的时间。收信同步的账号状态不算这次打开的时间。这不是失败退信日龄，也不是抑制名单日龄，也不是待放行批次，也不是回复待处理积压，也不是序列下一步到期，也不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄，也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口，也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住，也不是待记跟进或今日到期，也不是待发草稿、外联序列进度，也不是失败或退信、收信同步。不替代开发信打开或点击那一块。不会自动跟进，不会自动发下一封，不会推进序列，不会发信，不会改名单，也不会改 convert_to_lead 或 approved_contactable。";

const KIND_LABEL: Record<Exclude<OpenClickAgeKind, "none">, string> = {
  long: "打开超七日",
  recent: "打开七日内"
};

export function emptyOpenClickAge(): OpenClickAgeView {
  return { kind: "none", atMs: 0 };
}

/** 跟 Day15 投影一样，认 Date.parse 能解析的发生时间。解析不了就是无打开日龄。 */
function parseAt(value: string) {
  const text = value.trim();
  if (!text) return Number.NaN;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * 详情「开发信打开或点击」上两份 `at` 里较晚的那一份。
 * 都解析不了则空字符串。时间相同用打开那一份。不另造时间。
 */
export function openClickOccurrenceAt(openAt: string, clickAt: string) {
  const openMs = parseAt(openAt || "");
  const clickMs = parseAt(clickAt || "");
  const openOk = Number.isFinite(openMs);
  const clickOk = Number.isFinite(clickMs);
  if (!openOk && !clickOk) return "";
  if (openOk && (!clickOk || openMs >= clickMs)) return openAt.trim();
  return clickAt.trim();
}

/**
 * 距现在超过 7 天算打开超七日。未超过（含刚好 7 天、含此刻、含更晚的时间）算打开七日内。
 * 没有打开或点击，或时间解析不了，都是无打开日龄。
 */
export function presentOpenClickAge(input: OpenClickAgeInput, now = new Date()): OpenClickAgeView {
  if (!input.opened) return emptyOpenClickAge();
  const atMs = parseAt(input.at || "");
  if (!Number.isFinite(atMs)) return emptyOpenClickAge();
  const age = now.getTime() - atMs;
  if (age > OPEN_CLICK_AGE_WINDOW_MS) return { kind: "long", atMs };
  return { kind: "recent", atMs };
}

export function openClickAgeMatchesFilter(view: OpenClickAgeView, filter: OpenClickAgeListFilter) {
  if (filter === "long") return view.kind === "long";
  return true;
}

export function openClickAgeRank(view: OpenClickAgeView) {
  if (view.kind === "long") return 0;
  if (view.kind === "recent") return 1;
  return 2;
}

/** 从工作台打开时，打开超七日落到打开超七日筛选，打开七日内保持全部。 */
export function openClickAgeListFilterForOpen(view: OpenClickAgeView): OpenClickAgeListFilter {
  if (view.kind === "long") return "long";
  return "all";
}

export function formatOpenClickAgeAt(ms: number) {
  if (!ms) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

export function openClickAgeLineLabel(view: OpenClickAgeView) {
  if (view.kind === "none") return "无打开日龄";
  const when = formatOpenClickAgeAt(view.atMs);
  return [KIND_LABEL[view.kind], when].filter(Boolean).join(" · ");
}

export function openClickAgeStatusLabel(view: OpenClickAgeView) {
  if (view.kind === "none") return "无打开日龄";
  return KIND_LABEL[view.kind];
}

export function openClickAgeEntryLabel() {
  return "查看打开或点击";
}

export function openClickAgeSummary(view: OpenClickAgeView) {
  if (view.kind === "none") return `无打开日龄。${OPEN_CLICK_AGE_BOUNDARY}`;
  const when = formatOpenClickAgeAt(view.atMs);
  return `${KIND_LABEL[view.kind]} ${when}。${OPEN_CLICK_AGE_BOUNDARY}`;
}

export function listOpenClickAgeQueue<T extends { id: string }>(
  rows: readonly T[],
  viewOf: (row: T) => OpenClickAgeView,
  limit = OPEN_CLICK_AGE_LIMIT
) {
  const ranked = rows
    .map((row) => ({ row, view: viewOf(row) }))
    .filter((item) => item.view.kind !== "none")
    .sort((left, right) => {
      const rank = openClickAgeRank(left.view) - openClickAgeRank(right.view);
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
