/**
 * 回拨到期队列。只渲染接口返回的对象、时间和已过多久。
 * 改期提交原来的设置接口。标完成要选原因。没有外呼按钮。
 */

export const CALLBACK_DUE_NOTE_MAX = 200;

export const CALLBACK_DUE_COMPLETE_REASONS = [
  { value: "reached", label: "已回拨" },
  { value: "no_need", label: "无需回拨" },
  { value: "wrong_time", label: "约错时间" },
  { value: "other", label: "其他" }
] as const;

export interface CallbackDueQueueItem {
  targetType: string;
  targetId: string;
  targetLabel?: string;
  name?: string;
  scheduledAt: string;
  note?: string;
  due: "today" | "overdue" | string;
  ownerAgentId?: string;
  ownerAgentLabel?: string;
  ageSeconds?: number | null;
  ageLabel?: string;
}

export interface CallbackDueQueueResponse {
  scope?: "mine" | "team";
  overdueOnly?: boolean;
  today?: string;
  timeZone?: string;
  empty?: boolean;
  items?: CallbackDueQueueItem[];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function callbackDueQueueQuery(input: { scope: "mine" | "team"; overdueOnly?: boolean }) {
  const params = new URLSearchParams();
  params.set("scope", input.scope);
  if (input.overdueOnly) params.set("overdue", "1");
  return `?${params.toString()}`;
}

export function renderCallbackDueQueueEmpty() {
  return `<p data-callback-due-empty="1">这个范围内没有今日到期或已逾期的回拨。</p>`;
}

export function renderCallbackDueQueueFailure(message: string) {
  const text = message.trim() || "回拨到期队列没有加载";
  return `<p data-callback-due-error="1">${escapeHtml(text)}</p>`;
}

function ageText(item: CallbackDueQueueItem) {
  const label = (item.ageLabel || "").trim();
  return label || "—";
}

export function renderCallbackDueQueue(data: CallbackDueQueueResponse | undefined) {
  const rows = data?.items || [];
  if (!rows.length) return renderCallbackDueQueueEmpty();
  const body = rows.map((item) => {
    const due = item.due === "overdue" ? "已逾期" : "今日到期";
    const owner = item.ownerAgentId ? (item.ownerAgentLabel || item.ownerAgentId) : "未指派";
    const reasons = CALLBACK_DUE_COMPLETE_REASONS
      .map((reason) => `<option value="${reason.value}">${reason.label}</option>`)
      .join("");
    const note = item.note || "";
    return `<li data-callback-due-row="1" data-callback-due="${escapeHtml(item.due)}" data-target-type="${escapeHtml(item.targetType)}" data-target-id="${escapeHtml(item.targetId)}"><button type="button" class="btn" data-callback-due-open="1">${escapeHtml(item.name || item.targetId)}</button><span>${escapeHtml(item.targetLabel || item.targetType)}</span><time>${escapeHtml(item.scheduledAt)}</time><em>${due}</em><span data-callback-due-owner="${escapeHtml(item.ownerAgentId || "")}">负责坐席 ${escapeHtml(owner)}</span><span data-callback-due-age="1">${escapeHtml(ageText(item))}</span><small>${escapeHtml(note)}</small><form data-callback-due-complete="1" data-target-type="${escapeHtml(item.targetType)}" data-target-id="${escapeHtml(item.targetId)}"><label>完成原因<select data-callback-due-reason><option value="">请选择</option>${reasons}</select></label><button class="btn" type="submit">标成已完成</button></form><form data-callback-due-reschedule="1" data-target-type="${escapeHtml(item.targetType)}" data-target-id="${escapeHtml(item.targetId)}"><label>改期<input type="datetime-local" data-callback-at></label><label>备注<input data-callback-note maxlength="${CALLBACK_DUE_NOTE_MAX}" value="${escapeHtml(note)}"></label><button class="btn" type="submit">保存改期</button></form></li>`;
  }).join("");
  const today = data?.today ? `当地日 ${data.today}` : "";
  const scope = data?.scope === "team" ? "团队" : "我负责的";
  return `<div data-callback-due-queue="1"><p data-callback-due-scope="${escapeHtml(data?.scope || "mine")}">${escapeHtml(scope)}${today ? ` · ${escapeHtml(today)}` : ""}</p><ul>${body}</ul></div>`;
}
