/**
 * 收信同步异常的只读投影。
 * 只读账号上已经记下的 lastInboundSyncStatus / lastInboundSyncError / lastInboundSyncAt。
 * 这是 IMAP 收信同步，不是发件健康。不写库，不改授权，不重连，不触发同步，也不发信。
 */

export type InboundSyncCondition = "clear" | "error";

export interface InboundSyncStatusView {
  condition: InboundSyncCondition;
  label: "正常" | "收信同步异常";
  error: string;
  syncedAt: string;
  accountId: string;
  accountName: string;
}

const ERROR_LENGTH = 80;

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

/**
 * 只有 status 正好是 error 才算收信异常。
 * ok、空值、还没同步，以及其他字样都是清空态「正常」，不新造健康检查。
 */
export function describeInboundSyncStatus(input: {
  id?: unknown;
  name?: unknown;
  lastInboundSyncStatus?: unknown;
  lastInboundSyncError?: unknown;
  lastInboundSyncAt?: unknown;
}): InboundSyncStatusView {
  const accountId = text(input.id);
  const accountName = text(input.name);
  const syncedAt = validTime(input.lastInboundSyncAt);
  if (text(input.lastInboundSyncStatus) !== "error") {
    return { condition: "clear", label: "正常", error: "", syncedAt, accountId, accountName };
  }
  return {
    condition: "error",
    label: "收信同步异常",
    error: clip(text(input.lastInboundSyncError)),
    syncedAt,
    accountId,
    accountName
  };
}
