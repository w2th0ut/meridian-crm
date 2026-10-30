/**
 * 外联序列进度的只读展示。
 * 只消费清单接口带回的方案名或步骤名、状态和现有入口。
 * 不推进步骤，也不把回复、打开/点击、失败条或抑制条说成序列。
 */

export type OutreachSequenceListFilter = "all" | "active" | "stopped";
export type OutreachSequenceProgress = "none" | "active" | "stopped" | "done";
export type OutreachSequenceSource = "none" | "plan" | "batch" | "sequence";

export interface OutreachSequenceView {
  progress: OutreachSequenceProgress;
  statusLabel: string;
  name: string;
  stepName: string;
  source: OutreachSequenceSource;
  sourceId: string;
  updatedAt: string;
}

const NAME_LENGTH = 48;
const STOPPED_LABELS = new Set(["已暂停", "已停止", "已取消", "发送受阻"]);

export function emptyOutreachSequence(): OutreachSequenceView {
  return {
    progress: "none",
    statusLabel: "",
    name: "",
    stepName: "",
    source: "none",
    sourceId: "",
    updatedAt: ""
  };
}

function text(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function clip(value: string) {
  if (value.length <= NAME_LENGTH) return value;
  return `${value.slice(0, NAME_LENGTH)}…`;
}

function timeOf(value: unknown) {
  const cleaned = text(value);
  if (!cleaned || Number.isNaN(Date.parse(cleaned))) return "";
  return cleaned;
}

function labelMatches(progress: OutreachSequenceProgress, label: string) {
  if (progress === "active") return label === "进行中";
  if (progress === "done") return label === "已完成";
  if (progress === "stopped") return STOPPED_LABELS.has(label);
  return false;
}

/** 只接受接口带回的序列。回复、打开点击、失败和抑制记录都当成没有序列。 */
export function presentOutreachSequence(raw: unknown): OutreachSequenceView {
  if (!raw || typeof raw !== "object") return emptyOutreachSequence();
  const record = raw as Record<string, unknown>;
  if ("excerpt" in record || "open" in record || "click" in record || "kind" in record || "reason" in record || "at" in record) {
    return emptyOutreachSequence();
  }
  const progress = record.progress;
  if (progress !== "active" && progress !== "stopped" && progress !== "done") return emptyOutreachSequence();
  const source = record.source;
  if (source !== "plan" && source !== "batch" && source !== "sequence") return emptyOutreachSequence();
  const sourceId = text(record.sourceId);
  const statusLabel = text(record.statusLabel);
  if (!sourceId || !labelMatches(progress, statusLabel)) return emptyOutreachSequence();
  return {
    progress,
    statusLabel,
    name: clip(text(record.name)),
    stepName: clip(text(record.stepName)),
    source,
    sourceId,
    updatedAt: timeOf(record.updatedAt)
  };
}

export function outreachSequenceMatchesFilter(view: OutreachSequenceView, filter: OutreachSequenceListFilter) {
  if (filter === "active") return view.progress === "active";
  if (filter === "stopped") return view.progress === "stopped";
  return true;
}

export function outreachSequenceRank(view: OutreachSequenceView) {
  if (view.progress === "active") return 3;
  if (view.progress === "stopped") return 2;
  if (view.progress === "done") return 1;
  return 0;
}

export function outreachSequenceUpdatedAt(view: OutreachSequenceView) {
  const parsed = Date.parse(view.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function outreachSequenceTitle(view: OutreachSequenceView) {
  return view.name || view.stepName;
}

export function outreachSequenceLineLabel(view: OutreachSequenceView) {
  if (view.progress === "none") return "无序列";
  const title = outreachSequenceTitle(view);
  return title ? `${title} · ${view.statusLabel}` : view.statusLabel;
}

export function outreachSequenceEntryLabel(view: OutreachSequenceView) {
  if (view.progress === "none" || !view.sourceId) return "";
  if (view.source === "plan") return "查看方案";
  if (view.source === "batch") return "查看发信批次";
  if (view.source === "sequence") return "查看触达序列";
  return "";
}

export function outreachSequenceSummary(view: OutreachSequenceView) {
  const boundary = "这里只展示当前外联序列或步骤和状态。这不是回复条，也不是打开或点击条，也不是失败条，也不是抑制条。不会推进序列，也不会自动发下一封。";
  if (view.progress === "none") return `无序列。${boundary}`;
  const title = view.name ? `序列 ${view.name}。` : "";
  const step = view.stepName ? `当前步骤 ${view.stepName}。` : "";
  return `${title}${step}${view.statusLabel}。${boundary}`;
}
