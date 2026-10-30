/**
 * 待发草稿积压的只读展示。
 * 只消费清单接口带回的未放行草稿封数、主题和现有发信批次入口。
 * 不放行，不发信，也不把外联序列、回复、打开/点击、失败条或抑制条说成草稿。
 */

export type OutreachDraftBacklogListFilter = "all" | "pending" | "clear";
export type OutreachDraftBacklog = "none" | "pending";

export interface OutreachDraftBacklogView {
  backlog: OutreachDraftBacklog;
  count: number;
  subject: string;
  batchId: string;
  updatedAt: string;
}

const SUBJECT_LENGTH = 48;

export function emptyOutreachDraftBacklog(): OutreachDraftBacklogView {
  return { backlog: "none", count: 0, subject: "", batchId: "", updatedAt: "" };
}

function text(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function clip(value: string) {
  if (value.length <= SUBJECT_LENGTH) return value;
  return `${value.slice(0, SUBJECT_LENGTH)}…`;
}

function timeOf(value: unknown) {
  const cleaned = text(value);
  if (!cleaned || Number.isNaN(Date.parse(cleaned))) return "";
  return cleaned;
}

const BOUNDARY = "这里只展示还没放行的发信批次草稿。这不是外联序列，也不是回复条，也不是打开或点击条，也不是失败条，也不是抑制条。不会放行批次，也不会发送。";

/** 只接受接口带回的待发草稿。序列、回复、打开点击、失败和抑制记录都当成没有积压。 */
export function presentOutreachDraftBacklog(raw: unknown): OutreachDraftBacklogView {
  if (!raw || typeof raw !== "object") return emptyOutreachDraftBacklog();
  const record = raw as Record<string, unknown>;
  if (
    "progress" in record
    || "excerpt" in record
    || "open" in record
    || "click" in record
    || "kind" in record
    || "reason" in record
    || "at" in record
    || "source" in record
    || "statusLabel" in record
  ) {
    return emptyOutreachDraftBacklog();
  }
  if (record.backlog !== "pending") return emptyOutreachDraftBacklog();
  const count = record.count;
  const batchId = text(record.batchId);
  if (!Number.isInteger(count) || Number(count) < 1 || Number(count) > 9999 || !batchId) {
    return emptyOutreachDraftBacklog();
  }
  return {
    backlog: "pending",
    count: Number(count),
    subject: clip(text(record.subject)),
    batchId,
    updatedAt: timeOf(record.updatedAt)
  };
}

export function outreachDraftBacklogMatchesFilter(
  view: OutreachDraftBacklogView,
  filter: OutreachDraftBacklogListFilter
) {
  if (filter === "pending") return view.backlog === "pending";
  if (filter === "clear") return view.backlog === "none";
  return true;
}

export function outreachDraftBacklogCount(view: OutreachDraftBacklogView) {
  return view.backlog === "pending" ? view.count : 0;
}

export function outreachDraftBacklogUpdatedAt(view: OutreachDraftBacklogView) {
  const parsed = Date.parse(view.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function outreachDraftBacklogLineLabel(view: OutreachDraftBacklogView) {
  if (view.backlog === "none") return "无待发草稿";
  return view.subject ? `待发 ${view.count} 封 · ${view.subject}` : `待发 ${view.count} 封`;
}

export function outreachDraftBacklogEntryLabel(view: OutreachDraftBacklogView) {
  if (view.backlog === "none" || !view.batchId) return "";
  return "查看发信批次";
}

export function outreachDraftBacklogSummary(view: OutreachDraftBacklogView) {
  if (view.backlog === "none") return `无待发草稿。${BOUNDARY}`;
  const subject = view.subject ? `最近一份主题是 ${view.subject}。` : "";
  return `待发 ${view.count} 封。${subject}${BOUNDARY}`;
}
