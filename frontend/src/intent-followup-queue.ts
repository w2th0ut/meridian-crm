/**
 * 意向回访队列。
 * 只渲染接口返回的对象。空列表是空状态，不补 0。
 * 每一行单独安排跟进或忽略。没有拨号，也没有批量入口。
 */

export interface IntentFollowupQueueRow {
  targetType: "customer" | "lead" | "prospect" | string;
  targetId: string;
  targetLabel?: string;
  name?: string;
  callRecordId?: string;
  outcome?: string;
  labeledAt?: string;
  agentLabel?: string;
  maskedNumber?: string;
  suppressionNotice?: string;
}

export interface IntentFollowupAgentOption {
  cccUserId: string;
  label: string;
}

export interface IntentFollowupQueueResponse {
  scope?: "self" | "team";
  timeZone?: string;
  agents?: IntentFollowupAgentOption[];
  suggestedNextFollowAt?: string;
  empty?: boolean;
  items?: IntentFollowupQueueRow[];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function toDateTimeLocal(value: string) {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return match ? `${match[1]}T${match[2]}` : "";
}

export function renderIntentFollowupEmpty() {
  return `<p data-intent-followup-empty="1">这个范围内还没有待回访的对象。</p>`;
}

export function renderIntentFollowupFailure(message: string) {
  const text = message.trim() || "意向回访队列没有加载";
  return `<p data-intent-followup-empty="1">${escapeHtml(text)}</p>`;
}

function formatStamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "—";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function notice(row: IntentFollowupQueueRow) {
  if (!row.suppressionNotice) return "";
  return `<p class="outbound-record-follow-notice" data-follow-up-notice="1">${escapeHtml(row.suppressionNotice)}</p>`;
}

function identity(row: IntentFollowupQueueRow) {
  return `data-target-type="${escapeHtml(row.targetType)}" data-target-id="${escapeHtml(row.targetId)}"`;
}

export function renderIntentFollowupRows(rows: IntentFollowupQueueRow[] | undefined, suggestedNextFollowAt: string) {
  if (!rows?.length) return "";
  const suggested = toDateTimeLocal(suggestedNextFollowAt);
  const body = rows.map((row) => {
    return `<tr data-intent-followup-row="1" ${identity(row)}><td><b>${escapeHtml(row.name || row.targetId)}</b><div>${escapeHtml(row.targetLabel || row.targetType)}</div>${notice(row)}</td><td>${escapeHtml(row.outcome || "—")}</td><td data-labeled-at="${escapeHtml(row.labeledAt || "")}">${escapeHtml(formatStamp(row.labeledAt || ""))}</td><td data-agent-label="${escapeHtml(row.agentLabel || "")}">${escapeHtml(row.agentLabel || "—")}</td><td>${escapeHtml(row.maskedNumber || "—")}</td><td><form class="intent-followup-actions" data-intent-followup-form="1" ${identity(row)}><label>下次跟进<input type="datetime-local" data-intent-follow-at value="${escapeHtml(suggested)}"></label><button class="btn" type="submit">安排跟进</button></form></td></tr>`;
  }).join("");
  return `<div class="outbound-record-table-wrap"><table class="outbound-record-table"><thead><tr><th>对象</th><th>通话结果</th><th>标注时间</th><th>坐席</th><th>号码</th><th>操作</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

export function renderIntentFollowupQueue(input: IntentFollowupQueueResponse) {
  const items = renderIntentFollowupRows(input.items, input.suggestedNextFollowAt || "");
  return items || renderIntentFollowupEmpty();
}
