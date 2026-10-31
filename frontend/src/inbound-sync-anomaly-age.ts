/**
 * 收信同步异常日龄的只读分类。
 * 只读 Day19 已经投影好的收信异常：状态正好是 error，时间是同一份 syncedAt。
 * 那份时间来自账号上的 lastInboundSyncAt，是最近一次失败同步写下的时刻。
 * 库里没有单独的首次异常时间，不另造。
 * 状态不是 error 时，即使带了时间也不算异常日龄。
 * 不另存一份时间，也不新做日龄字段。
 * 不读发件配置、跟进、加入时间、下次跟进、开发信、序列、回复、打开、失败、抑制或待放行。
 * 相对现在：超过 7 天标「同步异常超七日」；未超过（含刚好 7 天）标「同步异常七日内」。
 * 没有异常，或时间解析不了，标「无同步异常日龄」。
 * 不发信，不解除抑制，不推进序列，不放行批次，不改邮箱配置，不改授权，不重连，不触发同步，也不碰门禁。
 * 文案不和序列最近一步、回复日龄、打开或点击日龄、失败退信日龄、抑制名单日龄、待放行批次、回复积压、序列到期、外联空档、静默、跟进空档、逾期、收信同步那一块混用。
 */

export const INBOUND_SYNC_ANOMALY_AGE_WINDOW_DAYS = 7;
export const INBOUND_SYNC_ANOMALY_AGE_WINDOW_MS = INBOUND_SYNC_ANOMALY_AGE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
export const INBOUND_SYNC_ANOMALY_AGE_LIMIT = 8;

export type InboundSyncAnomalyAgeKind = "none" | "long" | "recent";
export type InboundSyncAnomalyAgeListFilter = "all" | "long";

export interface InboundSyncAnomalyAgeInput {
  /** 收信状态正好是 error 才为 true。正常、空着、还没同步为 false，即使带了时间也不算。 */
  anomaly: boolean;
  /** Day19 投影上已有的同步时间。空字符串表示没有可解析时间。 */
  at: string;
}

export interface InboundSyncAnomalyAgeView {
  kind: InboundSyncAnomalyAgeKind;
  /** 能解析的异常时间戳。解析不了是 0。 */
  atMs: number;
}

export const INBOUND_SYNC_ANOMALY_AGE_BOUNDARY = "这里只按 Day19 收信同步异常已经带出的失败同步时间，相对现在判断日龄。时间是状态正好为 error 时账号上已有的最近一次同步时间。有异常且距现在超过 7 天算同步异常超七日。未超过算同步异常七日内，刚好 7 天仍算同步异常七日内。没有异常，或时间解析不了，写无同步异常日龄，也不编造。成功同步写下的时间不算异常日龄。只认带 T 的时间。墙上时钟不算这次异常的时间。发件邮箱没有可只读复用的健康、错误、授权到期或发送配额字段。这里不展示邮箱异常，也不展示邮箱正常，也不展示无健康信息。跟进记录不算这次异常的时间。加入短名单的时间不算这次异常的时间。下次跟进那种时间不算这次异常的时间。最近一封开发信的发出时间不算这次异常的时间。序列下一步的计划时间不算这次异常的时间。已发出步骤的时间不算这次异常的时间。开发信回复的时间不算这次异常的时间。打开或点击的发生时间不算这次异常的时间。失败或退信的发生时间不算这次异常的时间。抑制或退订的生效时间不算这次异常的时间。待放行批次的更新时间不算这次异常的时间。最近触达（含话机）不算这次异常的时间。这是账号上的收信同步，不是某一家候选公司的日龄。这不是序列最近一步日龄，也不是开发信回复日龄，也不是打开或点击日龄，也不是失败退信日龄，也不是抑制名单日龄，也不是待放行批次，也不是回复待处理积压，也不是序列下一步到期，也不是外联最近动作空档，也不是名单静默无动作日龄，也不是跟进记录空档，也不是短名单加入日龄，也不是加入时间的日期范围，也不是联系方式缺口，也不是覆盖池缺口，也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住，也不是待记跟进或今日到期，也不是待发草稿、外联序列进度，也不是打开或点击、失败或退信、收信同步那一块。不替代收信同步那一块。不会发信，不会解除抑制，不会推进序列，不会放行批次，不会改邮箱配置，不会改授权，不会重连，不会触发同步，也不会改 convert_to_lead 或 approved_contactable。";

const KIND_LABEL: Record<Exclude<InboundSyncAnomalyAgeKind, "none">, string> = {
  long: "同步异常超七日",
  recent: "同步异常七日内"
};

export function emptyInboundSyncAnomalyAge(): InboundSyncAnomalyAgeView {
  return { kind: "none", atMs: 0 };
}

/** 只认带 T 的时间。墙上时钟和空字符串都是无同步异常日龄。 */
function parseAt(value: string) {
  const text = value.trim();
  if (!text.includes("T")) return Number.NaN;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * 距现在超过 7 天算同步异常超七日。未超过（含刚好 7 天、含此刻、含更晚的时间）算同步异常七日内。
 * 没有异常，或时间解析不了，都是无同步异常日龄。
 */
export function presentInboundSyncAnomalyAge(input: InboundSyncAnomalyAgeInput, now = new Date()): InboundSyncAnomalyAgeView {
  if (!input.anomaly) return emptyInboundSyncAnomalyAge();
  const atMs = parseAt(input.at || "");
  if (!Number.isFinite(atMs)) return emptyInboundSyncAnomalyAge();
  const age = now.getTime() - atMs;
  if (age > INBOUND_SYNC_ANOMALY_AGE_WINDOW_MS) return { kind: "long", atMs };
  return { kind: "recent", atMs };
}

export function inboundSyncAnomalyAgeMatchesFilter(view: InboundSyncAnomalyAgeView, filter: InboundSyncAnomalyAgeListFilter) {
  if (filter === "long") return view.kind === "long";
  return true;
}

export function inboundSyncAnomalyAgeRank(view: InboundSyncAnomalyAgeView) {
  if (view.kind === "long") return 0;
  if (view.kind === "recent") return 1;
  return 2;
}

/** 从工作台打开时，同步异常超七日落到同步异常超七日筛选，同步异常七日内保持全部。 */
export function inboundSyncAnomalyAgeListFilterForOpen(view: InboundSyncAnomalyAgeView): InboundSyncAnomalyAgeListFilter {
  if (view.kind === "long") return "long";
  return "all";
}

export function formatInboundSyncAnomalyAgeAt(ms: number) {
  if (!ms) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

export function inboundSyncAnomalyAgeLineLabel(view: InboundSyncAnomalyAgeView) {
  if (view.kind === "none") return "无同步异常日龄";
  const when = formatInboundSyncAnomalyAgeAt(view.atMs);
  return [KIND_LABEL[view.kind], when].filter(Boolean).join(" · ");
}

export function inboundSyncAnomalyAgeStatusLabel(view: InboundSyncAnomalyAgeView) {
  if (view.kind === "none") return "无同步异常日龄";
  return KIND_LABEL[view.kind];
}

export function inboundSyncAnomalyAgeEntryLabel() {
  return "查看收信同步";
}

export function inboundSyncAnomalyAgeSummary(view: InboundSyncAnomalyAgeView) {
  if (view.kind === "none") return `无同步异常日龄。${INBOUND_SYNC_ANOMALY_AGE_BOUNDARY}`;
  const when = formatInboundSyncAnomalyAgeAt(view.atMs);
  return `${KIND_LABEL[view.kind]} ${when}。${INBOUND_SYNC_ANOMALY_AGE_BOUNDARY}`;
}

export function listInboundSyncAnomalyAgeQueue<T extends { id: string }>(
  rows: readonly T[],
  viewOf: (row: T) => InboundSyncAnomalyAgeView,
  limit = INBOUND_SYNC_ANOMALY_AGE_LIMIT,
  filter: InboundSyncAnomalyAgeListFilter = "all"
) {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const row of rows) {
    if (!row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    unique.push(row);
  }
  const ranked = unique
    .map((row) => ({ row, view: viewOf(row) }))
    .filter((item) => item.view.kind !== "none" && inboundSyncAnomalyAgeMatchesFilter(item.view, filter))
    .sort((left, right) => {
      const rank = inboundSyncAnomalyAgeRank(left.view) - inboundSyncAnomalyAgeRank(right.view);
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
