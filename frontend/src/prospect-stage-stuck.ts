/**
 * 转化阶段卡住的只读分类。
 * 复用 Day11 推导出的阶段，以及它已经选好的进入时间（enteredAt）。
 * 只认 ISO 进入时间。下次跟进那种 follow 文本不是阶段进入时间。
 * 相对现在：进入时间距现在超过 7 天标「卡住」，未超过标「推进中」。
 * 没有可用进入时间标「无阶段」。不另存字段，不改阶段，不自动跟进，不发信，也不碰门禁。
 * 文案不和获客阶段计数、获客待办摘要、下次跟进逾期、待记跟进、今日到期、待发草稿、外联序列、回复、打开或点击、失败或抑制、收信同步混用。
 */

export const STAGE_STUCK_WINDOW_DAYS = 7;
export const STAGE_STUCK_WINDOW_MS = STAGE_STUCK_WINDOW_DAYS * 24 * 60 * 60 * 1000;
export const STAGE_STUCK_LIMIT = 8;

export type StageStuckKind = "none" | "stuck" | "moving";
export type StageStuckListFilter = "all" | "stuck";

export interface StageStuckInput {
  stageKey: string;
  stageLabel: string;
  enteredAt: string;
  enteredKind: "iso" | "follow" | "";
  enteredLabel: string;
}

export interface StageStuckView {
  kind: StageStuckKind;
  stageKey: string;
  stageLabel: string;
  enteredLabel: string;
  /** 能解析的 ISO 进入时间戳。解析不了是 0。 */
  enteredAtMs: number;
}

export const STAGE_STUCK_BOUNDARY = "这里只按已有阶段的进入时间，相对现在判断停留。进入时间距现在超过 7 天算卡住，未超过算推进中。没有可用的阶段进入时间，或只有下次跟进那种时间，写无阶段。这不是获客阶段计数，也不是获客待办摘要，也不是下次跟进逾期，也不是待记跟进或今日到期，也不是待发草稿、外联序列、回复、打开或点击、失败或抑制、收信同步。不会改阶段，不会自动跟进，不会发信，也不会改 convert_to_lead 或 approved_contactable。";

const KIND_LABEL: Record<Exclude<StageStuckKind, "none">, string> = {
  stuck: "卡住",
  moving: "推进中"
};

export function emptyStageStuck(input?: Partial<StageStuckInput>): StageStuckView {
  return {
    kind: "none",
    stageKey: (input?.stageKey || "").trim(),
    stageLabel: (input?.stageLabel || "").trim(),
    enteredLabel: "",
    enteredAtMs: 0
  };
}

function parseIso(value: string) {
  const parsed = Date.parse(value.trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * 超过 7 天算卡住，刚好 7 天和更近的算推进中。
 * follow 文本和解析不了的时间都是无阶段。
 */
export function presentStageStuck(input: StageStuckInput, now = new Date()): StageStuckView {
  const stageKey = (input.stageKey || "").trim();
  const stageLabel = (input.stageLabel || "").trim();
  if (input.enteredKind !== "iso") return emptyStageStuck({ stageKey, stageLabel });
  const enteredAtMs = parseIso(input.enteredAt || "");
  if (!Number.isFinite(enteredAtMs)) return emptyStageStuck({ stageKey, stageLabel });
  const age = now.getTime() - enteredAtMs;
  return {
    kind: age > STAGE_STUCK_WINDOW_MS ? "stuck" : "moving",
    stageKey,
    stageLabel,
    enteredLabel: (input.enteredLabel || "").trim(),
    enteredAtMs
  };
}

export function stageStuckMatchesFilter(view: StageStuckView, filter: StageStuckListFilter) {
  if (filter === "stuck") return view.kind === "stuck";
  return true;
}

export function stageStuckRank(view: StageStuckView) {
  if (view.kind === "stuck") return 0;
  if (view.kind === "moving") return 1;
  return 2;
}

export function formatStageStuckAt(ms: number) {
  if (!ms) return "";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}

export function stageStuckLineLabel(view: StageStuckView) {
  if (view.kind === "none") return "无阶段";
  const when = formatStageStuckAt(view.enteredAtMs);
  return [KIND_LABEL[view.kind], view.stageLabel, when].filter(Boolean).join(" · ");
}

export function stageStuckStatusLabel(view: StageStuckView) {
  if (view.kind === "none") return "无阶段";
  return KIND_LABEL[view.kind];
}

export function stageStuckEntryLabel() {
  return "查看当前阶段";
}

export function stageStuckSummary(view: StageStuckView) {
  if (view.kind === "none") return `无阶段。${STAGE_STUCK_BOUNDARY}`;
  const when = formatStageStuckAt(view.enteredAtMs);
  const via = view.enteredLabel ? `${view.enteredLabel} ` : "";
  return `${KIND_LABEL[view.kind]} ${view.stageLabel} ${via}${when}。${STAGE_STUCK_BOUNDARY}`;
}

export function listStageStuckQueue<T extends { id: string }>(
  rows: readonly T[],
  viewOf: (row: T) => StageStuckView,
  limit = STAGE_STUCK_LIMIT
) {
  const ranked = rows
    .map((row) => ({ row, view: viewOf(row) }))
    .filter((item) => item.view.kind !== "none")
    .sort((left, right) => {
      const rank = stageStuckRank(left.view) - stageStuckRank(right.view);
      if (rank) return rank;
      if (left.view.enteredAtMs !== right.view.enteredAtMs) return left.view.enteredAtMs - right.view.enteredAtMs;
      return left.row.id < right.row.id ? -1 : left.row.id > right.row.id ? 1 : 0;
    });
  const cap = Number.isFinite(limit) ? Math.max(0, limit) : ranked.length;
  return {
    total: ranked.length,
    rows: ranked.slice(0, cap).map((item) => item.row)
  };
}
