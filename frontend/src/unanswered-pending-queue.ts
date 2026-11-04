/**
 * 未接通待处理队列。只渲染接口返回的对象、最近未接通时间、日龄、通话坐席和已经脱敏的号码。
 * 生成下次跟进和设置回拨预约提交原来的接口。没有外呼按钮。
 */

import { CALLBACK_NOTE_MAX } from "./callback-schedule";

export interface UnansweredPendingQueueItem {
  targetType: string;
  targetId: string;
  targetLabel?: string;
  name?: string;
  callRecordId: string;
  unansweredAt?: string;
  ageSeconds?: number | null;
  ageLabel?: string;
  agentIds?: string[];
  agentLabel?: string;
  maskedNumber?: string;
}

export interface UnansweredPendingQueueResponse {
  scope?: "mine" | "team";
  age?: "" | "within7" | "over7";
  timeZone?: string;
  empty?: boolean;
  items?: UnansweredPendingQueueItem[];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function unansweredPendingQueueQuery(input: { scope: "mine" | "team"; age?: "" | "within7" | "over7" }) {
  const params = new URLSearchParams();
  params.set("scope", input.scope);
  if (input.age) params.set("age", input.age);
  return `?${params.toString()}`;
}

export function renderUnansweredPendingQueueEmpty() {
  return `<p data-unanswered-pending-empty="1">这个范围内没有待处理的未接通。</p>`;
}

export function renderUnansweredPendingQueueFailure(message: string) {
  const text = message.trim() || "未接通待处理队列没有加载";
  return `<p data-unanswered-pending-error="1">${escapeHtml(text)}</p>`;
}

function ageText(item: UnansweredPendingQueueItem) {
  const label = (item.ageLabel || "").trim();
  return label || "—";
}

export function renderUnansweredPendingQueue(data: UnansweredPendingQueueResponse | undefined) {
  const rows = data?.items || [];
  if (!rows.length) return renderUnansweredPendingQueueEmpty();
  const body = rows.map((item) => {
    const when = (item.unansweredAt || "").trim() || "—";
    const agent = (item.agentLabel || "").trim() || "—";
    const number = (item.maskedNumber || "").trim() || "—";
    return `<li data-unanswered-pending-row="1" data-target-type="${escapeHtml(item.targetType)}" data-target-id="${escapeHtml(item.targetId)}" data-call-record-id="${escapeHtml(item.callRecordId)}"><button type="button" class="btn" data-unanswered-pending-open="1">${escapeHtml(item.name || item.targetId)}</button><span>${escapeHtml(item.targetLabel || item.targetType)}</span><time data-unanswered-pending-at="1">${escapeHtml(when)}</time><span data-unanswered-pending-age="1">${escapeHtml(ageText(item))}</span><span data-unanswered-pending-agent="1">通话坐席 ${escapeHtml(agent)}</span><span data-unanswered-pending-number="1">${escapeHtml(number)}</span><form data-unanswered-pending-follow-up="1" data-call-record-id="${escapeHtml(item.callRecordId)}"><label>下次跟进<input type="datetime-local" data-unanswered-follow-at></label><button class="btn" type="submit">生成下次跟进</button></form><form data-unanswered-pending-callback="1" data-call-record-id="${escapeHtml(item.callRecordId)}"><label>回拨预约<input type="datetime-local" data-unanswered-callback-at></label><label>备注<input data-unanswered-callback-note maxlength="${CALLBACK_NOTE_MAX}"></label><button class="btn" type="submit">保存回拨预约</button></form></li>`;
  }).join("");
  const scope = data?.scope === "team" ? "团队" : "我的";
  const age = data?.age === "over7" ? "超过七日" : data?.age === "within7" ? "七日及以内" : "全部日龄";
  return `<div data-unanswered-pending-queue="1"><p data-unanswered-pending-scope="${escapeHtml(data?.scope || "mine")}">${escapeHtml(scope)} · ${escapeHtml(age)}</p><ul>${body}</ul></div>`;
}
