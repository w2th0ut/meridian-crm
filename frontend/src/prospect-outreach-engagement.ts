/**
 * 开发信打开 / 点击的只读展示。
 * 只消费清单接口带回的打开和点击，不另写追踪，也不把失败条或抑制条说成打开。
 * 仓内没有送达回执，这里不显示送达次数。
 */

export type OutreachEngagementListFilter = "all" | "hit" | "clear";

export interface OutreachEngagementSignal {
  count: number;
  at: string;
}

export interface OutreachEngagementView {
  status: "none" | "hit";
  open: OutreachEngagementSignal;
  click: OutreachEngagementSignal;
}

const EMPTY_SIGNAL: OutreachEngagementSignal = { count: 0, at: "" };

export function emptyOutreachEngagement(): OutreachEngagementView {
  return {
    status: "none",
    open: { ...EMPTY_SIGNAL },
    click: { ...EMPTY_SIGNAL }
  };
}

function text(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function countOf(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(1_000_000, Math.floor(parsed));
}

function timeOf(value: unknown) {
  const cleaned = text(value);
  if (!cleaned || Number.isNaN(Date.parse(cleaned))) return "";
  return cleaned;
}

function signalOf(raw: unknown): OutreachEngagementSignal {
  if (!raw || typeof raw !== "object") return { ...EMPTY_SIGNAL };
  const record = raw as Record<string, unknown>;
  const count = countOf(record.count);
  if (!count) return { ...EMPTY_SIGNAL };
  return { count, at: timeOf(record.at) };
}

/** 只接受接口带回的打开或点击。失败、抑制和没有次数的记录都当成没有触达反馈。 */
export function presentOutreachEngagement(raw: unknown): OutreachEngagementView {
  if (!raw || typeof raw !== "object") return emptyOutreachEngagement();
  const record = raw as Record<string, unknown>;
  if (record.status !== "hit") return emptyOutreachEngagement();
  if ("kind" in record || "reason" in record) return emptyOutreachEngagement();
  const open = signalOf(record.open);
  const click = signalOf(record.click);
  if (!open.count && !click.count) return emptyOutreachEngagement();
  return { status: "hit", open, click };
}

export function outreachEngagementMatchesFilter(
  view: OutreachEngagementView,
  filter: OutreachEngagementListFilter
) {
  if (filter === "hit") return view.status === "hit";
  if (filter === "clear") return view.status === "none";
  return true;
}

export function outreachEngagementSignalLabel(
  kind: "打开" | "点击",
  signal: OutreachEngagementSignal,
  formattedAt = ""
) {
  if (!signal.count) return kind === "打开" ? "无打开" : "无点击";
  const when = formattedAt ? ` · ${formattedAt}` : "";
  return `${kind} ${signal.count} 次${when}`;
}

export function outreachEngagementLatestAt(view: OutreachEngagementView) {
  const times = [view.open.at, view.click.at]
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  if (!times.length) return 0;
  return Math.max(...times);
}

export function outreachEngagementSummary(
  view: OutreachEngagementView,
  openAt = "",
  clickAt = ""
) {
  const boundary = "这里只统计打开和点击的次数与最近时间。这不是失败条，也不是抑制条。仓内没有送达回执，发送成功不算送达。不会自动跟进，也不会自动发下一封。";
  if (view.status === "none") return `无打开或点击。${boundary}`;
  const open = view.open.count
    ? `打开 ${view.open.count} 次${openAt ? `，最近 ${openAt}` : ""}。`
    : "无打开。";
  const click = view.click.count
    ? `点击 ${view.click.count} 次${clickAt ? `，最近 ${clickAt}` : ""}。`
    : "无点击。";
  return `${open}${click}${boundary}`;
}
