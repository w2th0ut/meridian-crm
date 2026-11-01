/**
 * 回拨预约。只渲染接口返回的时间和备注。
 * 保存和取消都是单条。到期提醒没有拨号按钮。
 */

export const CALLBACK_NOTE_MAX = 200;

export interface CallbackScheduleFields {
  targetType?: string;
  targetId?: string;
  callbackScheduledAt?: string;
  callbackNote?: string;
  callbackDue?: string;
}

export interface CallbackReminder {
  targetType: string;
  targetId: string;
  targetLabel?: string;
  name?: string;
  scheduledAt: string;
  note?: string;
  due: "today" | "overdue" | string;
}

export interface CallbackReminderResponse {
  due?: string;
  empty?: boolean;
  items?: CallbackReminder[];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function toCallbackDateTimeLocal(value: string) {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return match ? `${match[1]}T${match[2]}` : "";
}

export function callbackDueLabel(due: string) {
  if (due === "today") return "今日到期";
  if (due === "overdue") return "已逾期";
  if (due === "later") return "未到";
  return "";
}

export function renderCallbackScheduleForm(input: {
  recordId?: string;
  targetType?: string;
  targetId?: string;
  scheduledAt?: string;
  note?: string;
  due?: string;
}) {
  const recordId = input.recordId || "";
  const targetType = input.targetType || "";
  const targetId = input.targetId || "";
  if (!recordId && (!targetType || !targetId)) return "";
  const identity = recordId
    ? `data-callback-record="${escapeHtml(recordId)}"`
    : `data-target-type="${escapeHtml(targetType)}" data-target-id="${escapeHtml(targetId)}"`;
  const due = callbackDueLabel(input.due || "");
  const dueMark = due ? `<span data-callback-due="${escapeHtml(input.due || "")}">${escapeHtml(due)}</span>` : "";
  const cancel = input.scheduledAt
    ? `<button class="btn" type="button" data-callback-cancel="1">取消回拨</button>`
    : "";
  return `<form class="outbound-record-outcome-form callback-schedule-form" data-callback-schedule-form="1" ${identity}><label>回拨预约<input type="datetime-local" data-callback-at value="${escapeHtml(toCallbackDateTimeLocal(input.scheduledAt || ""))}"></label><label>备注<input data-callback-note maxlength="${CALLBACK_NOTE_MAX}" value="${escapeHtml(input.note || "")}"></label>${dueMark}<button class="btn" type="submit">保存回拨</button>${cancel}</form>`;
}

export function renderCallbackReminderEmpty() {
  return `<p data-callback-reminder-empty="1">这个范围内没有今日到期或已逾期的回拨预约。</p>`;
}

export function renderCallbackReminderFailure(message: string) {
  const text = message.trim() || "回拨预约没有加载";
  return `<p data-callback-reminder-empty="1">${escapeHtml(text)}</p>`;
}

export function renderCallbackReminderList(items: CallbackReminder[] | undefined) {
  const rows = items || [];
  if (!rows.length) return renderCallbackReminderEmpty();
  const shown = rows.slice(0, 8);
  const more = rows.length > 8
    ? `<p data-callback-reminder-more="1">还有更多到期回拨。到意向回访里筛选。这里不会自动拨号，也不会批量拨号。</p>`
    : "";
  const body = shown.map((item) => {
    const due = item.due === "overdue" ? "已逾期" : "今日到期";
    const note = item.note ? `<small>${escapeHtml(item.note)}</small>` : "";
    return `<div data-callback-reminder="1" data-callback-due="${escapeHtml(item.due)}"><b>${escapeHtml(item.name || item.targetId)}</b><span>${escapeHtml(item.targetLabel || item.targetType)}</span><time>${escapeHtml(item.scheduledAt)}</time><em>${due}</em>${note}<button class="btn" type="button" data-callback-open="intent-followup-queue">查看意向回访</button></div>`;
  }).join("");
  return `<div data-callback-reminders="1">${body}</div>${more}`;
}
