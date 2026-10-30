/**
 * 收信同步异常的只读展示。
 * 只消费账号上已经带回的 lastInboundSyncStatus / lastInboundSyncError / lastInboundSyncAt。
 * 这是收信，不是发件。不改授权，不重连，不触发同步，也不把草稿、序列、回复、打开点击、失败或抑制说成收信异常。
 */

export type InboundSyncListFilter = "all" | "error";
export type InboundSyncCondition = "clear" | "error";

export interface InboundSyncStatusView {
  condition: InboundSyncCondition;
  label: "正常" | "收信同步异常";
  error: string;
  syncedAt: string;
  accountId: string;
  accountName: string;
}

export const INBOUND_SYNC_LIMIT = 8;
const ERROR_LENGTH = 80;

export const INBOUND_SYNC_BOUNDARY = "这是收信同步，不是发件。不是待发草稿，也不是外联序列，也不是回复条，也不是打开或点击条，也不是失败条，也不是抑制条。不会改授权，不会重连，不会触发同步，也不会发信。";

export function emptyInboundSyncStatus(): InboundSyncStatusView {
  return { condition: "clear", label: "正常", error: "", syncedAt: "", accountId: "", accountName: "" };
}

function text(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function clip(value: string) {
  if (value.length <= ERROR_LENGTH) return value;
  return `${value.slice(0, ERROR_LENGTH)}…`;
}

function validTime(value: unknown) {
  const cleaned = text(value);
  if (!cleaned || Number.isNaN(Date.parse(cleaned))) return "";
  return cleaned;
}

function hasSyncFields(record: Record<string, unknown>) {
  return "lastInboundSyncStatus" in record || "lastInboundSyncError" in record || "lastInboundSyncAt" in record;
}

function isOutreachRecord(record: Record<string, unknown>) {
  return "backlog" in record
    || "progress" in record
    || "excerpt" in record
    || "open" in record
    || "click" in record
    || "kind" in record
    || "reason" in record
    || "statusLabel" in record
    || "batchId" in record
    || "subject" in record;
}

function describeFields(record: Record<string, unknown>): InboundSyncStatusView {
  const accountId = text(record.id);
  const accountName = text(record.name);
  const syncedAt = validTime(record.lastInboundSyncAt);
  if (text(record.lastInboundSyncStatus) !== "error") {
    return { condition: "clear", label: "正常", error: "", syncedAt, accountId, accountName };
  }
  return {
    condition: "error",
    label: "收信同步异常",
    error: clip(text(record.lastInboundSyncError)),
    syncedAt,
    accountId,
    accountName
  };
}

function presentView(record: Record<string, unknown>): InboundSyncStatusView {
  if (isOutreachRecord(record)) return emptyInboundSyncStatus();
  const condition = record.condition;
  const label = record.label;
  if (condition === "clear" && label === "正常") {
    return {
      condition: "clear",
      label: "正常",
      error: "",
      syncedAt: validTime(record.syncedAt),
      accountId: text(record.accountId),
      accountName: text(record.accountName)
    };
  }
  if (condition === "error" && label === "收信同步异常") {
    return {
      condition: "error",
      label: "收信同步异常",
      error: clip(text(record.error)),
      syncedAt: validTime(record.syncedAt),
      accountId: text(record.accountId),
      accountName: text(record.accountName)
    };
  }
  return emptyInboundSyncStatus();
}

/** 账号字段优先。草稿、序列、回复、打开点击、失败和抑制记录都当成没有收信异常。 */
export function presentInboundSyncStatus(raw: unknown): InboundSyncStatusView {
  if (!raw || typeof raw !== "object") return emptyInboundSyncStatus();
  const record = raw as Record<string, unknown>;
  if (hasSyncFields(record)) return describeFields(record);
  return presentView(record);
}

export function inboundSyncMatchesFilter(view: InboundSyncStatusView, filter: InboundSyncListFilter) {
  if (filter === "error") return view.condition === "error";
  return true;
}

export function inboundSyncSyncedAt(view: InboundSyncStatusView) {
  const parsed = Date.parse(view.syncedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function inboundSyncLineLabel(view: InboundSyncStatusView) {
  if (view.condition === "error") {
    return view.error ? `收信同步异常 · ${view.error}` : "收信同步异常";
  }
  return "正常";
}

/** 只有当前账号能跳到自己的收信设置。别的账号不打开、也不改。 */
export function inboundSyncEntryLabel(view: InboundSyncStatusView, currentAccountId: string) {
  if (!currentAccountId || view.accountId !== currentAccountId) return "";
  return "收信设置";
}

export function inboundSyncSummary(view: InboundSyncStatusView) {
  if (view.condition === "error") {
    const detail = view.error ? `${view.error}。` : "";
    return `收信同步异常。${detail}${INBOUND_SYNC_BOUNDARY}`;
  }
  return `正常。${INBOUND_SYNC_BOUNDARY}`;
}

/**
 * 当前账号始终占一条（筛「有异常」且它正常时除外）。
 * 其余名额先给有异常的账号。总共不超过 limit。
 */
export function listInboundSyncRows(
  views: InboundSyncStatusView[],
  filter: InboundSyncListFilter,
  limit = INBOUND_SYNC_LIMIT,
  currentAccountId = ""
) {
  const unique: InboundSyncStatusView[] = [];
  const seen = new Set<string>();
  for (const view of views) {
    if (!view.accountId || seen.has(view.accountId)) continue;
    seen.add(view.accountId);
    unique.push(view);
  }
  const matched = unique.filter((view) => inboundSyncMatchesFilter(view, filter));
  const rank = (view: InboundSyncStatusView) => view.condition === "error" ? 1 : 0;
  const byPriority = (left: InboundSyncStatusView, right: InboundSyncStatusView) => {
    const rankDelta = rank(right) - rank(left);
    if (rankDelta) return rankDelta;
    const time = inboundSyncSyncedAt(right) - inboundSyncSyncedAt(left);
    return time || left.accountId.localeCompare(right.accountId);
  };
  const current = currentAccountId
    ? matched.find((view) => view.accountId === currentAccountId)
    : undefined;
  const rest = matched.filter((view) => view.accountId !== currentAccountId).sort(byPriority);
  const ordered = current ? [current, ...rest] : rest;
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : INBOUND_SYNC_LIMIT;
  return { total: matched.length, shown: ordered.slice(0, cap) };
}
