/**
 * 名单静默无动作日龄的只读分类。
 * 只看已经在短名单上的候选（shortlistedAt 有内容）。
 * 动作时间取最近一条人工跟进和最近一封开发信里较晚的那个。
 * 加入时间、创建时间、下次跟进那种墙上时钟都不算动作时间。
 * 没有可用动作时间，或最近动作距现在超过 7 天，算静默。
 * 没有可用动作时间时写「无动作时间」。未超过算「有动作」。刚好 7 天仍算有动作。
 * 不改名单，不发信，不自动记下跟进，也不碰门禁。
 * 文案不和短名单加入日龄、跟进记录空档、联系方式缺口、覆盖池、获客待办摘要、逾期、卡住混用。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const SILENT_AGE_WINDOW_DAYS = 7;
export const SILENT_AGE_WINDOW_MS = SILENT_AGE_WINDOW_DAYS * DAY_MS;
export const SILENT_AGE_LIMIT = 8;

export type SilentAgeKind = "off" | "missing" | "silent" | "acted";
export type SilentAgeSource = "none" | "follow_up" | "outreach";
export type SilentAgeListFilter = "all" | "silent";

export interface SilentAgeInput {
  /** 短名单加入时间。空字符串表示还不在短名单上，这一节不判断。 */
  shortlistedAt: string;
  /** 最近一条人工跟进的 ISO 时间。空字符串表示没有跟进。 */
  followUpAt: string;
  /** 最近一封开发信的 ISO 时间。空字符串表示没有开发信。 */
  outreachAt: string;
}

export interface SilentAgeView {
  kind: SilentAgeKind;
  source: SilentAgeSource;
  /** 被采用的动作时间戳。没有可用时间是 0。 */
  actionAtMs: number;
  /** 向下取整的日龄。没有动作时间、以及未来时间，记 0。 */
  ageDays: number;
}

export const SILENT_AGE_BOUNDARY = "这里只看已经在短名单上的候选。动作时间取最近一条跟进记录和最近一封开发信里较晚的那个，两者时间一样时仍算跟进。没有可用动作时间，或最近动作距现在超过 7 天，算静默。没有可用动作时间时写无动作时间。未超过算有动作。刚好 7 天仍算有动作。加入短名单的时间不算动作时间。创建时间不算动作时间。下次跟进那种时间不算动作时间。这不是短名单加入日龄，也不是加入时间的日期范围，也不是跟进记录空档，也不是联系方式缺口，也不是覆盖池缺口，也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住，也不是待记跟进或今日到期，也不是待发草稿、外联序列、回复、打开或点击、失败或抑制、收信同步。不会改名单，不会发信，不会自动记下跟进，也不会改 convert_to_lead 或 approved_contactable。";

const KIND_LABEL: Record<"silent" | "acted", string> = {
  silent: "静默",
  acted: "有动作"
};

export function emptySilentAge(): SilentAgeView {
  return { kind: "off", source: "none", actionAtMs: 0, ageDays: 0 };
}

/**
 * 只认带 T 的 ISO 时间。
 * 下次跟进那种墙上时钟即使能被 Date.parse 认出来，也不算动作时间。
 */
function parseActionAt(value: string) {
  const text = value.trim();
  if (!text.includes("T")) return Number.NaN;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * 超过 7 天算静默，刚好 7 天和更近的算有动作。
 * 还没加入短名单时不判断。加入了但没有可用动作时间，写无动作时间，筛选仍归静默。
 * 跟进和开发信都有时用较晚的；时间一样时用跟进。
 */
export function presentSilentAge(input: SilentAgeInput, now = new Date()): SilentAgeView {
  if (!(input.shortlistedAt || "").trim()) return emptySilentAge();
  const followMs = parseActionAt(input.followUpAt || "");
  const outreachMs = parseActionAt(input.outreachAt || "");
  const followOk = Number.isFinite(followMs);
  const outreachOk = Number.isFinite(outreachMs);
  if (!followOk && !outreachOk) {
    return { kind: "missing", source: "none", actionAtMs: 0, ageDays: 0 };
  }
  const useFollow = followOk && (!outreachOk || followMs >= outreachMs);
  const actionAtMs = useFollow ? followMs : outreachMs;
  const ageMs = now.getTime() - actionAtMs;
  return {
    kind: ageMs > SILENT_AGE_WINDOW_MS ? "silent" : "acted",
    source: useFollow ? "follow_up" : "outreach",
    actionAtMs,
    ageDays: Math.max(0, Math.floor(ageMs / DAY_MS))
  };
}

export function silentAgeMatchesFilter(view: SilentAgeView, filter: SilentAgeListFilter) {
  if (filter === "silent") return view.kind === "silent" || view.kind === "missing";
  return true;
}

/** 静默（含无动作时间）在前，有动作在后。不在短名单的不进队列。 */
export function silentAgeRank(view: SilentAgeView) {
  if (view.kind === "silent" || view.kind === "missing") return 0;
  if (view.kind === "acted") return 1;
  return 2;
}

export function silentAgeIsSilent(view: SilentAgeView) {
  return view.kind === "silent" || view.kind === "missing";
}

/** 从工作台打开时，静默和无动作时间落到静默筛选，有动作保持全部。 */
export function silentAgeListFilterForOpen(view: SilentAgeView): SilentAgeListFilter {
  if (view.kind === "silent" || view.kind === "missing") return "silent";
  return "all";
}

export function formatSilentAgeAt(ms: number) {
  if (!ms) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

export function silentAgeDaysLabel(view: SilentAgeView) {
  if (view.kind !== "silent" && view.kind !== "acted") return "";
  return `${view.ageDays} 天`;
}

export function silentAgeLineLabel(view: SilentAgeView) {
  if (view.kind === "off") return "不在短名单";
  if (view.kind === "missing") return "无动作时间";
  const when = formatSilentAgeAt(view.actionAtMs);
  return [KIND_LABEL[view.kind], silentAgeDaysLabel(view), when].filter(Boolean).join(" · ");
}

export function silentAgeStatusLabel(view: SilentAgeView) {
  if (view.kind === "off") return "不在短名单";
  if (view.kind === "missing") return "无动作时间";
  return KIND_LABEL[view.kind];
}

export function silentAgeEntryLabel() {
  return "查看最近动作";
}

export function silentAgeSummary(view: SilentAgeView) {
  if (view.kind === "off") return `不在短名单。${SILENT_AGE_BOUNDARY}`;
  if (view.kind === "missing") return `无动作时间。${SILENT_AGE_BOUNDARY}`;
  const when = formatSilentAgeAt(view.actionAtMs);
  return `${KIND_LABEL[view.kind]} ${view.ageDays} 天${when ? ` ${when}` : ""}。${SILENT_AGE_BOUNDARY}`;
}

export function listSilentAgeQueue<T extends { id: string }>(
  rows: readonly T[],
  viewOf: (row: T) => SilentAgeView,
  limit = SILENT_AGE_LIMIT
) {
  const ranked = rows
    .map((row) => ({ row, view: viewOf(row) }))
    .filter((item) => item.view.kind !== "off")
    .sort((left, right) => {
      const rank = silentAgeRank(left.view) - silentAgeRank(right.view);
      if (rank) return rank;
      if (left.view.actionAtMs !== right.view.actionAtMs) return left.view.actionAtMs - right.view.actionAtMs;
      return left.row.id < right.row.id ? -1 : left.row.id > right.row.id ? 1 : 0;
    });
  const cap = Number.isFinite(limit) ? Math.max(0, limit) : ranked.length;
  return {
    total: ranked.length,
    rows: ranked.slice(0, cap).map((item) => item.row)
  };
}
