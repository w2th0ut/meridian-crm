/**
 * 序列最近一步日龄的只读分类。
 * 发件邮箱没有可只读复用的健康、错误、授权到期或发送配额字段。
 * 收信同步不是发件健康。失败或退信不是发件健康。
 * 这里不展示邮箱异常，也不展示邮箱正常，也不展示无健康信息。
 * 主路径：只读 Day17 同一条外联序列上已经带出的最近一步发出时间。
 * 那份时间是已发出步骤里最晚的一份，不是下一步的计划时间。
 * 不另存一份时间，也不新做日龄字段。
 * 不读下一步计划时间、失败步骤、跳过步骤、正在发或待发步骤。
 * 不读序列更新时间、序列下一次执行时间、序列上另存的汇总发送时间。
 * 不读跟进、加入时间、下次跟进、开发信发出时间、回复、打开、抑制或收信同步。
 * 相对现在：超过 7 天标「最近一步超七日」；未超过（含刚好 7 天）标「最近一步七日内」。
 * 没有已发出步骤，或时间解析不了，标「无最近一步」。
 * 不发信，不推进序列，不放行批次，不解除抑制，不改名单，不改邮箱配置，也不碰门禁。
 * 文案不和回复日龄、打开或点击日龄、失败退信日龄、抑制名单日龄、待放行批次、回复积压、序列到期、外联空档、静默、跟进空档、逾期混用。
 */

export const SEQUENCE_LAST_STEP_AGE_WINDOW_DAYS = 7;
export const SEQUENCE_LAST_STEP_AGE_WINDOW_MS = SEQUENCE_LAST_STEP_AGE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
export const SEQUENCE_LAST_STEP_AGE_LIMIT = 8;

export type SequenceLastStepAgeKind = "none" | "long" | "recent";
export type SequenceLastStepAgeListFilter = "all" | "long";

export interface SequenceLastStepAgeInput {
  /** 当前这条序列上有已发出步骤才为 true。没有已发出步骤为 false，即使带了时间也不算。 */
  sent: boolean;
  /** 已发出步骤上已有的发出时间。空字符串表示没有可解析时间。 */
  at: string;
}

export interface SequenceLastStepAgeView {
  kind: SequenceLastStepAgeKind;
  /** 能解析的发出时间戳。解析不了是 0。 */
  atMs: number;
}

export const SEQUENCE_LAST_STEP_AGE_BOUNDARY = "这里只按 Day17 同一条外联序列上已有的最近一步发出时间，相对现在判断日龄。时间是已发出步骤里最晚的一份。有已发出步骤且距现在超过 7 天算最近一步超七日。未超过算最近一步七日内，刚好 7 天仍算最近一步七日内。没有已发出步骤，或时间解析不了，写无最近一步，也不编造。发件邮箱没有可只读复用的健康、错误、授权到期或发送配额字段。收信同步不是发件健康。失败或退信不是发件健康。这里不展示邮箱异常，也不展示邮箱正常，也不展示无健康信息。下一步的计划时间不算这一步的发出时间。失败步骤的时间不算这一步的发出时间。跳过步骤的时间不算这一步的发出时间。正在发或待发步骤的时间不算这一步的发出时间。序列更新时间不算这一步的发出时间。序列下一次执行时间不算这一步的发出时间。序列上另存的汇总发送时间不算这一步的发出时间。打开或点击的发生时间不算这一步的发出时间。失败或退信的发生时间不算这一步的发出时间。抑制或退订的生效时间不算这一步的发出时间。待放行批次的更新时间不算这一步的发出时间。跟进记录不算这一步的发出时间。加入短名单的时间不算这一步的发出时间。下次跟进那种时间不算这一步的发出时间。最近一封开发信的发出时间不算这一步的发出时间。开发信回复的时间不算这一步的发出时间。最近触达（含话机）不算这一步的发出时间。收信同步的账号状态不算这一步的发出时间。这不是开发信回复日龄，也不是打开或点击日龄，也不是失败退信日龄，也不是抑制名单日龄，也不是待放行批次，也不是回复待处理积压，也不是序列下一步到期，也不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄，也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口，也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住，也不是待记跟进或今日到期，也不是待发草稿、外联序列进度，也不是打开或点击、失败或退信、收信同步。不替代外联序列那一块，也不替代序列下一步到期。不会发信，不会推进序列，不会放行批次，不会解除抑制，不会改名单，不会改邮箱配置，也不会改 convert_to_lead 或 approved_contactable。";

const KIND_LABEL: Record<Exclude<SequenceLastStepAgeKind, "none">, string> = {
  long: "最近一步超七日",
  recent: "最近一步七日内"
};

export function emptySequenceLastStepAge(): SequenceLastStepAgeView {
  return { kind: "none", atMs: 0 };
}

/** 只认带 T 的时间。墙上时钟和空字符串都是无最近一步。 */
function parseAt(value: string) {
  const text = value.trim();
  if (!text.includes("T")) return Number.NaN;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * 距现在超过 7 天算最近一步超七日。未超过（含刚好 7 天、含此刻、含更晚的时间）算最近一步七日内。
 * 没有已发出步骤，或时间解析不了，都是无最近一步。
 */
export function presentSequenceLastStepAge(input: SequenceLastStepAgeInput, now = new Date()): SequenceLastStepAgeView {
  if (!input.sent) return emptySequenceLastStepAge();
  const atMs = parseAt(input.at || "");
  if (!Number.isFinite(atMs)) return emptySequenceLastStepAge();
  const age = now.getTime() - atMs;
  if (age > SEQUENCE_LAST_STEP_AGE_WINDOW_MS) return { kind: "long", atMs };
  return { kind: "recent", atMs };
}

export function sequenceLastStepAgeMatchesFilter(view: SequenceLastStepAgeView, filter: SequenceLastStepAgeListFilter) {
  if (filter === "long") return view.kind === "long";
  return true;
}

export function sequenceLastStepAgeRank(view: SequenceLastStepAgeView) {
  if (view.kind === "long") return 0;
  if (view.kind === "recent") return 1;
  return 2;
}

/** 从工作台打开时，最近一步超七日落到最近一步超七日筛选，最近一步七日内保持全部。 */
export function sequenceLastStepAgeListFilterForOpen(view: SequenceLastStepAgeView): SequenceLastStepAgeListFilter {
  if (view.kind === "long") return "long";
  return "all";
}

export function formatSequenceLastStepAgeAt(ms: number) {
  if (!ms) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

export function sequenceLastStepAgeLineLabel(view: SequenceLastStepAgeView) {
  if (view.kind === "none") return "无最近一步";
  const when = formatSequenceLastStepAgeAt(view.atMs);
  return [KIND_LABEL[view.kind], when].filter(Boolean).join(" · ");
}

export function sequenceLastStepAgeStatusLabel(view: SequenceLastStepAgeView) {
  if (view.kind === "none") return "无最近一步";
  return KIND_LABEL[view.kind];
}

export function sequenceLastStepAgeEntryLabel() {
  return "查看外联序列";
}

export function sequenceLastStepAgeSummary(view: SequenceLastStepAgeView) {
  if (view.kind === "none") return `无最近一步。${SEQUENCE_LAST_STEP_AGE_BOUNDARY}`;
  const when = formatSequenceLastStepAgeAt(view.atMs);
  return `${KIND_LABEL[view.kind]} ${when}。${SEQUENCE_LAST_STEP_AGE_BOUNDARY}`;
}

export function listSequenceLastStepAgeQueue<T extends { id: string }>(
  rows: readonly T[],
  viewOf: (row: T) => SequenceLastStepAgeView,
  limit = SEQUENCE_LAST_STEP_AGE_LIMIT
) {
  const ranked = rows
    .map((row) => ({ row, view: viewOf(row) }))
    .filter((item) => item.view.kind !== "none")
    .sort((left, right) => {
      const rank = sequenceLastStepAgeRank(left.view) - sequenceLastStepAgeRank(right.view);
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
