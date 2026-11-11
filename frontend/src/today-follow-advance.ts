/**
 * 保存通话结果后，工作台打开今日待跟进队列里的下一位。
 * 这里只展示对象和脱敏的首选号码。有分配权限时可以勾选后转交负责人。没有外呼按钮，也不会自己拨号。
 */

import { queueOwnerReassignFormFor, queueOwnerReassignPick, type QueueOwnerReassignView } from "./queue-owner-reassign";
import { backupNumberBatchFormFor, backupNumberBatchPick } from "./backup-number-batch";
import { endFollowBatchFormFor, endFollowBatchPick, type EndFollowBatchView } from "./end-follow-batch";
import { phoneInvalidBatchFormFor, phoneInvalidBatchPick, type PhoneInvalidBatchView } from "./phone-invalid-batch";
import { appendQueueCallGlanceQuery, queueCallGlanceFilterActive, queueCallGlanceFilterEmpty, queueCallGlanceMarkup, type QueueCallGlanceQuery } from "./queue-call-glance";
import { sameDaySkipBatchFormFor, sameDaySkipBatchPick } from "./same-day-skip-batch";

export interface TodayFollowNextRow {
  targetType: "customer" | "lead" | "prospect";
  targetId: string;
  targetLabel?: string;
  name?: string;
  nextFollowAt?: string;
  phoneId?: string;
  preferred?: boolean;
  maskedNumber?: string;
  todayCallCount?: number;
  lastCallOutcome?: string;
}

export interface TodayFollowNextResponse extends QueueCallGlanceQuery {
  scope?: "mine" | "team";
  date?: string;
  empty?: boolean;
  message?: string;
  next?: TodayFollowNextRow | null;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textOrDash(value: string | undefined) {
  const text = (value || "").trim();
  return text || "—";
}

export function todayFollowNextQuery(input: { scope: "mine" | "team"; afterType?: string; afterId?: string } & QueueCallGlanceQuery) {
  const params = new URLSearchParams();
  params.set("scope", input.scope);
  const afterType = (input.afterType || "").trim();
  const afterId = (input.afterId || "").trim();
  if (afterType && afterId) {
    params.set("afterType", afterType);
    params.set("afterId", afterId);
  }
  appendQueueCallGlanceQuery(params, input);
  return `?${params.toString()}`;
}

export function renderTodayFollowNextEmpty() {
  return `<p data-today-follow-next-empty="1">今天没有下一位待跟进。</p>`;
}

export function renderTodayFollowNextFailure(message: string) {
  const text = message.trim() || "下一位待跟进没有打开";
  return `<p data-today-follow-next-error="1">${escapeHtml(text)}</p>`;
}

export function renderTodayFollowNext(data: TodayFollowNextResponse | undefined, view?: QueueOwnerReassignView, canSkip = false, markView?: PhoneInvalidBatchView, endView?: EndFollowBatchView) {
  const next = data?.next;
  if (!next?.targetId) {
    if (queueCallGlanceFilterActive(data)) return queueCallGlanceFilterEmpty('data-today-follow-next-empty="1"');
    return renderTodayFollowNextEmpty();
  }
  const phoneLabel = next.preferred ? "首选" : "号码";
  const phone = (next.maskedNumber || "").trim();
  const pick = queueOwnerReassignPick(next.targetType, next.targetId, view);
  const skipPick = sameDaySkipBatchPick(next.targetType, next.targetId, canSkip);
  const markPick = phoneInvalidBatchPick(next.targetType, next.targetId, markView);
  const backupPick = backupNumberBatchPick(next.targetType, next.targetId, markView);
  const endPick = endFollowBatchPick(next.targetType, next.targetId, endView);
  return `<div data-today-follow-next="1" data-target-type="${escapeHtml(next.targetType)}" data-target-id="${escapeHtml(next.targetId)}"><p data-today-follow-next-hint="1">下一位待跟进。外呼仍要自己点，不会自动拨号。</p>${queueOwnerReassignFormFor(pick ? [next] : [], view)}${sameDaySkipBatchFormFor(skipPick ? [next] : [], canSkip)}${phoneInvalidBatchFormFor(markPick ? [next] : [], markView)}${backupNumberBatchFormFor(backupPick ? [next] : [], markView)}${endFollowBatchFormFor(endPick ? [next] : [], endView)}${pick}${skipPick}${markPick}${backupPick}${endPick}<button type="button" class="btn" data-today-follow-next-open="1">${escapeHtml(next.name || next.targetId)}</button>${queueCallGlanceMarkup(next)}<span>${escapeHtml(next.targetLabel || next.targetType)}</span><time data-today-follow-next-at="1">${escapeHtml(textOrDash(next.nextFollowAt))}</time><span data-today-follow-next-phone="1" data-preferred="${next.preferred ? "1" : "0"}">${escapeHtml(phoneLabel)} ${escapeHtml(textOrDash(phone))}</span></div>`;
}
