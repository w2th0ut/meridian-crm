/**
 * 工作台上的待小结通话。点一行打开这一通的通话小结。
 * 无需小结要先选原因。已标记的可以撤销。这里没有拨号按钮。
 */

export const CALL_WRAPUP_SKIP_REASONS = [
  { code: "missed", label: "未接通" },
  { code: "wrong_number", label: "打错" },
  { code: "internal", label: "内部通话" },
  { code: "duplicate", label: "重复通话" },
  { code: "other", label: "其他" }
] as const;

export interface CallWrapupQueueItem {
  callRecordId: string;
  targetType?: string;
  targetLabel?: string;
  name?: string;
  maskedNumber?: string;
  endedAgoLabel?: string;
  agentLabel?: string;
}

export interface CallWrapupSkippedItem extends CallWrapupQueueItem {
  reason?: string;
  reasonLabel?: string;
}

export interface CallWrapupQueueResponse {
  canViewCounts?: boolean;
  empty?: boolean;
  items?: CallWrapupQueueItem[];
  skipped?: CallWrapupSkippedItem[];
  reasons?: Array<{ code: string; label: string }>;
}

export interface CallWrapupCountRow {
  agentId: string;
  agentLabel?: string;
  pendingCount?: number;
}

export interface CallWrapupCountResponse {
  empty?: boolean;
  pendingTotal?: number;
  rows?: CallWrapupCountRow[];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function reasonOptions(reasons: Array<{ code: string; label: string }> | undefined) {
  const rows = reasons?.length ? reasons : CALL_WRAPUP_SKIP_REASONS.map((item) => ({ code: item.code, label: item.label }));
  const options = rows.map((item) => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.label)}</option>`);
  return `<option value="">请选择原因</option>${options.join("")}`;
}

function identity(item: CallWrapupQueueItem) {
  const kind = item.targetLabel || "未关联";
  const name = item.name?.trim() || "未命名";
  return `${kind} · ${name}`;
}

export function renderCallWrapupQueue(data: CallWrapupQueueResponse) {
  const reasons = reasonOptions(data.reasons);
  const items = data.items || [];
  const skipped = data.skipped || [];
  const pending = items.length
    ? `<ul data-call-wrapup-queue-list="1">${items.map((item) => {
      const id = escapeHtml(item.callRecordId || "");
      return `<li data-call-wrapup-queue-row="${id}"><button type="button" class="btn" data-call-wrapup-open="${id}">${escapeHtml(identity(item))}</button><span data-call-wrapup-number="${id}">${escapeHtml(item.maskedNumber || "—")}</span><span data-call-wrapup-age="${id}">${escapeHtml(item.endedAgoLabel || "—")}</span><form data-call-wrapup-skip-form="${id}"><label>原因<select data-call-wrapup-skip-reason>${reasons}</select></label><button class="btn" type="submit">无需小结</button></form></li>`;
    }).join("")}</ul>`
    : `<p data-call-wrapup-queue-empty="1">没有待小结的通话</p>`;
  const skippedHtml = skipped.length
    ? `<ul data-call-wrapup-skipped-list="1">${skipped.map((item) => {
      const id = escapeHtml(item.callRecordId || "");
      return `<li data-call-wrapup-skipped-row="${id}"><button type="button" class="btn" data-call-wrapup-open="${id}">${escapeHtml(identity(item))}</button><span data-call-wrapup-number="${id}">${escapeHtml(item.maskedNumber || "—")}</span><span data-call-wrapup-age="${id}">${escapeHtml(item.endedAgoLabel || "—")}</span><span data-call-wrapup-skip-reason="${id}">${escapeHtml(item.reasonLabel || "")}</span><button type="button" class="btn" data-call-wrapup-restore="${id}">撤销</button></li>`;
    }).join("")}</ul>`
    : `<p data-call-wrapup-skipped-empty="1">没有已标记无需小结的通话</p>`;
  return `<div data-call-wrapup-queue="1">${pending}<h3>已标记无需小结</h3>${skippedHtml}</div>`;
}

export function renderCallWrapupCounts(data: CallWrapupCountResponse) {
  const rows = data.rows || [];
  if (!rows.length) return `<p data-call-wrapup-counts-empty="1">没有可显示的坐席</p>`;
  const body = rows.map((row) => {
    const count = Number.isFinite(row.pendingCount) ? String(row.pendingCount) : "0";
    return `<tr data-call-wrapup-count-row="${escapeHtml(row.agentId)}"><td>${escapeHtml(row.agentLabel || row.agentId || "未分配坐席")}</td><td data-call-wrapup-count="${escapeHtml(row.agentId)}">${escapeHtml(count)}</td></tr>`;
  }).join("");
  const note = data.empty ? `<p data-call-wrapup-counts-empty="1">目前没有待小结</p>` : "";
  return `<div data-call-wrapup-counts="1">${note}<table><thead><tr><th>坐席</th><th>待小结</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

export function renderCallWrapupQueueFailure(message: string) {
  return `<p data-call-wrapup-queue-error="1">${escapeHtml(message)}</p>`;
}
