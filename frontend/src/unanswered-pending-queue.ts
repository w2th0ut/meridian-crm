/**
 * 未接通待处理队列。只渲染接口返回的对象、最近未接通时间、日龄、通话坐席和已经脱敏的号码。
 * 生成下次跟进和设置回拨预约提交原来的接口。没有外呼按钮。
 */

import { CALLBACK_NOTE_MAX } from "./callback-schedule";
import { missingNextFollowupBatchForm, missingNextFollowupPick } from "./missing-next-followup-batch";
import { queueOwnerReassignFormFor, queueOwnerReassignPick, type QueueOwnerReassignView } from "./queue-owner-reassign";
import { backupNumberBatchFormFor, backupNumberBatchPick } from "./backup-number-batch";
import { phoneInvalidBatchFormFor, phoneInvalidBatchPick, type PhoneInvalidBatchView } from "./phone-invalid-batch";
import { callNoteAppendFormFor, callNoteAppendPick } from "./call-note-append-batch";
import { renderQueueCallOutcomeForm } from "./queue-call-outcome";
import { appendQueueCallGlanceQuery, queueCallGlanceFilterActive, queueCallGlanceFilterEmpty, queueCallGlanceMarkup, type QueueCallGlanceQuery } from "./queue-call-glance";
import { sameDaySkipBatchFormFor, sameDaySkipBatchPick } from "./same-day-skip-batch";

export interface UnansweredPendingQueueItem {
  targetType: string;
  targetId: string;
  targetLabel?: string;
  name?: string;
  callRecordId: string;
  outcome?: string;
  unansweredAt?: string;
  ageSeconds?: number | null;
  ageLabel?: string;
  agentIds?: string[];
  agentLabel?: string;
  maskedNumber?: string;
  todayCallCount?: number;
  lastCallOutcome?: string;
  lastCallAt?: string;
}

export interface UnansweredPendingQueueResponse extends QueueCallGlanceQuery {
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

export function unansweredPendingQueueQuery(input: { scope: "mine" | "team"; age?: "" | "within7" | "over7" } & QueueCallGlanceQuery) {
  const params = new URLSearchParams();
  params.set("scope", input.scope);
  if (input.age) params.set("age", input.age);
  appendQueueCallGlanceQuery(params, input);
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

export function renderUnansweredPendingQueue(data: UnansweredPendingQueueResponse | undefined, view?: QueueOwnerReassignView, canSkip = false, markView?: PhoneInvalidBatchView) {
  const rows = data?.items || [];
  if (!rows.length) {
    if (queueCallGlanceFilterActive(data)) return queueCallGlanceFilterEmpty('data-unanswered-pending-empty="1"');
    return renderUnansweredPendingQueueEmpty();
  }
  const body = rows.map((item) => {
    const when = (item.unansweredAt || "").trim() || "—";
    const agent = (item.agentLabel || "").trim() || "—";
    const number = (item.maskedNumber || "").trim() || "—";
    const outcomeForm = renderQueueCallOutcomeForm(item);
    return `<li data-unanswered-pending-row="1" data-target-type="${escapeHtml(item.targetType)}" data-target-id="${escapeHtml(item.targetId)}" data-call-record-id="${escapeHtml(item.callRecordId)}">${missingNextFollowupPick(item.targetType, item.targetId)}${queueOwnerReassignPick(item.targetType, item.targetId, view)}${sameDaySkipBatchPick(item.targetType, item.targetId, canSkip)}${phoneInvalidBatchPick(item.targetType, item.targetId, markView)}${backupNumberBatchPick(item.targetType, item.targetId, markView)}${callNoteAppendPick(item.targetType, item.callRecordId, markView)}<button type="button" class="btn" data-unanswered-pending-open="1">${escapeHtml(item.name || item.targetId)}</button>${queueCallGlanceMarkup(item)}<span>${escapeHtml(item.targetLabel || item.targetType)}</span><time data-unanswered-pending-at="1">${escapeHtml(when)}</time><span data-unanswered-pending-age="1">${escapeHtml(ageText(item))}</span><span data-unanswered-pending-agent="1">通话坐席 ${escapeHtml(agent)}</span><span data-unanswered-pending-number="1">${escapeHtml(number)}</span>${outcomeForm}<form data-unanswered-pending-follow-up="1" data-call-record-id="${escapeHtml(item.callRecordId)}"><label>下次跟进<input type="datetime-local" data-unanswered-follow-at></label><button class="btn" type="submit">生成下次跟进</button></form><form data-unanswered-pending-callback="1" data-call-record-id="${escapeHtml(item.callRecordId)}"><label>回拨预约<input type="datetime-local" data-unanswered-callback-at></label><label>备注<input data-unanswered-callback-note maxlength="${CALLBACK_NOTE_MAX}"></label><button class="btn" type="submit">保存回拨预约</button></form></li>`;
  }).join("");
  const scope = data?.scope === "team" ? "团队" : "我的";
  const age = data?.age === "over7" ? "超过七日" : data?.age === "within7" ? "七日及以内" : "全部日龄";
  return `<div data-unanswered-pending-queue="1"><p data-unanswered-pending-scope="${escapeHtml(data?.scope || "mine")}">${escapeHtml(scope)} · ${escapeHtml(age)}</p>${missingNextFollowupBatchForm()}${queueOwnerReassignFormFor(rows, view)}${sameDaySkipBatchFormFor(rows, canSkip)}${phoneInvalidBatchFormFor(rows, markView)}${backupNumberBatchFormFor(rows, markView)}${callNoteAppendFormFor(rows, markView)}<ul>${body}</ul></div>`;
}
