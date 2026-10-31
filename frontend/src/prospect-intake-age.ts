/**
 * 候选入库日龄的只读分类。
 * 只读候选上已经有的 createdAt（入库时写下的创建时间）。
 * 不另存一份时间，也不新做日龄字段。
 * 不读加入短名单的时间、跟进、下次跟进、开发信、序列、回复、打开、失败、抑制、待放行或收信同步。
 * 候选上没有更新时间字段。状态变更时间和核验时间不是更新时间。
 * 撞库说明上的关键时间不是撞库发生时刻，也不算入库时间。
 * 相对现在：超过 7 天标「入库超七日」；未超过（含刚好 7 天）标「入库七日内」。
 * 没有入库时间，或时间解析不了，标「无入库日龄」。
 * 只认带 T 的时间。墙上时钟不算。
 * 不发信，不解除抑制，不推进序列，不放行批次，不改名单，不改邮箱配置，也不碰门禁。
 * 文案不和收信同步异常日龄、序列最近一步、回复日龄、打开或点击日龄、失败退信日龄、抑制名单日龄、待放行批次、回复积压、序列到期、外联空档、静默、跟进空档、加入日龄混用。
 */

export const INTAKE_AGE_WINDOW_DAYS = 7;
export const INTAKE_AGE_WINDOW_MS = INTAKE_AGE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
export const INTAKE_AGE_LIMIT = 8;

export type IntakeAgeKind = "none" | "long" | "recent";
export type IntakeAgeListFilter = "all" | "long";

export interface IntakeAgeInput {
  /** 候选入库时写下的创建时间。空字符串表示没有可解析时间。 */
  at: string;
}

export interface IntakeAgeView {
  kind: IntakeAgeKind;
  /** 能解析的入库时间戳。解析不了是 0。 */
  atMs: number;
}

export const INTAKE_AGE_BOUNDARY = "这里只按候选上已有的入库时间，相对现在判断日龄。时间就是候选创建时写下的那一份，不是加入短名单的时间。入库且距现在超过 7 天算入库超七日。未超过算入库七日内，刚好 7 天仍算入库七日内。没有入库时间，或时间解析不了，写无入库日龄，也不编造。只认带 T 的时间。墙上时钟不算。候选上没有更新时间字段，不拿状态变更时间或核验时间冒充更新时间。撞库说明上的关键时间不是撞库发生时刻，不算入库时间。加入短名单的时间不算入库时间。跟进记录不算入库时间。下次跟进那种时间不算入库时间。最近一封开发信的发出时间不算入库时间。序列下一步的计划时间不算入库时间。已发出步骤的时间不算入库时间。开发信回复的时间不算入库时间。打开或点击的发生时间不算入库时间。失败或退信的发生时间不算入库时间。抑制或退订的生效时间不算入库时间。待放行批次的更新时间不算入库时间。最近触达（含话机）不算入库时间。收信同步的账号状态不算入库时间。这不是收信同步异常日龄，也不是序列最近一步日龄，也不是开发信回复日龄，也不是打开或点击日龄，也不是失败退信日龄，也不是抑制名单日龄，也不是待放行批次，也不是回复待处理积压，也不是序列下一步到期，也不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄，也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口，也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住，也不是待记跟进或今日到期，也不是待发草稿、外联序列进度，也不是打开或点击、失败或退信、收信同步那一块。不替代短名单加入日龄，也不替代加入时间的日期范围。不会发信，不会解除抑制，不会推进序列，不会放行批次，不会改名单，不会改邮箱配置，也不会改 convert_to_lead 或 approved_contactable。";

const KIND_LABEL: Record<Exclude<IntakeAgeKind, "none">, string> = {
  long: "入库超七日",
  recent: "入库七日内"
};

export function emptyIntakeAge(): IntakeAgeView {
  return { kind: "none", atMs: 0 };
}

/** 只认带 T 的时间。墙上时钟和空字符串都是无入库日龄。 */
function parseAt(value: string) {
  const text = value.trim();
  if (!text.includes("T")) return Number.NaN;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * 距现在超过 7 天算入库超七日。未超过（含刚好 7 天、含此刻、含更晚的时间）算入库七日内。
 * 没有入库时间，或时间解析不了，都是无入库日龄。
 */
export function presentIntakeAge(input: IntakeAgeInput, now = new Date()): IntakeAgeView {
  const atMs = parseAt(input.at || "");
  if (!Number.isFinite(atMs)) return emptyIntakeAge();
  const age = now.getTime() - atMs;
  if (age > INTAKE_AGE_WINDOW_MS) return { kind: "long", atMs };
  return { kind: "recent", atMs };
}

export function intakeAgeMatchesFilter(view: IntakeAgeView, filter: IntakeAgeListFilter) {
  if (filter === "long") return view.kind === "long";
  return true;
}

export function intakeAgeRank(view: IntakeAgeView) {
  if (view.kind === "long") return 0;
  if (view.kind === "recent") return 1;
  return 2;
}

/** 从工作台打开时，入库超七日落到入库超七日筛选，入库七日内保持全部。 */
export function intakeAgeListFilterForOpen(view: IntakeAgeView): IntakeAgeListFilter {
  if (view.kind === "long") return "long";
  return "all";
}

export function formatIntakeAgeAt(ms: number) {
  if (!ms) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

export function intakeAgeLineLabel(view: IntakeAgeView) {
  if (view.kind === "none") return "无入库日龄";
  const when = formatIntakeAgeAt(view.atMs);
  return [KIND_LABEL[view.kind], when].filter(Boolean).join(" · ");
}

export function intakeAgeStatusLabel(view: IntakeAgeView) {
  if (view.kind === "none") return "无入库日龄";
  return KIND_LABEL[view.kind];
}

export function intakeAgeEntryLabel() {
  return "查看候选详情";
}

export function intakeAgeSummary(view: IntakeAgeView) {
  if (view.kind === "none") return `无入库日龄。${INTAKE_AGE_BOUNDARY}`;
  const when = formatIntakeAgeAt(view.atMs);
  return `${KIND_LABEL[view.kind]} ${when}。${INTAKE_AGE_BOUNDARY}`;
}

export function listIntakeAgeQueue<T extends { id: string }>(
  rows: readonly T[],
  viewOf: (row: T) => IntakeAgeView,
  limit = INTAKE_AGE_LIMIT
) {
  const ranked = rows
    .map((row) => ({ row, view: viewOf(row) }))
    .filter((item) => item.view.kind !== "none")
    .sort((left, right) => {
      const rank = intakeAgeRank(left.view) - intakeAgeRank(right.view);
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
