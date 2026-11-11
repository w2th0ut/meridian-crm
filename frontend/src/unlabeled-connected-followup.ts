/**
 * 已接通未标注还没有下次跟进。只渲染接口返回的对象、固定的「未标注」、标注时间和已经脱敏的号码。
 * 记下下次跟进是单条提交。勾选后可以一次设置同一个时间和备注。没有外呼按钮。
 */

import { missingNextFollowupBatchForm, missingNextFollowupPick } from "./missing-next-followup-batch";
import { queueOwnerReassignFormFor, queueOwnerReassignPick, type QueueOwnerReassignView } from "./queue-owner-reassign";
import { backupNumberBatchFormFor, backupNumberBatchPick } from "./backup-number-batch";
import { phoneInvalidBatchFormFor, phoneInvalidBatchPick, type PhoneInvalidBatchView } from "./phone-invalid-batch";
import { appendQueueCallGlanceQuery, queueCallGlanceFilterActive, queueCallGlanceFilterEmpty, queueCallGlanceMarkup, type QueueCallGlanceQuery } from "./queue-call-glance";
import { sameDaySkipBatchFormFor, sameDaySkipBatchPick } from "./same-day-skip-batch";

export interface UnlabeledConnectedFollowupItem {
  targetType: string;
  targetId: string;
  targetLabel?: string;
  name?: string;
  callRecordId: string;
  outcome?: string;
  labeledAt?: string;
  nextFollowAt?: string;
  agentLabel?: string;
  maskedNumber?: string;
  suppressionNotice?: string;
  todayCallCount?: number;
  lastCallOutcome?: string;
  lastCallAt?: string;
}

export interface UnlabeledConnectedFollowupResponse extends QueueCallGlanceQuery {
  scope?: "mine" | "team";
  empty?: boolean;
  items?: UnlabeledConnectedFollowupItem[];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function unlabeledConnectedFollowupQuery(input: { scope: "mine" | "team" } & QueueCallGlanceQuery) {
  const params = new URLSearchParams();
  params.set("scope", input.scope);
  appendQueueCallGlanceQuery(params, input);
  return `?${params.toString()}`;
}

export function renderUnlabeledConnectedFollowupEmpty() {
  return `<p data-unlabeled-connected-followup-empty="1">这个范围内没有已接通、还没标注、也还没有下次跟进的对象。</p>`;
}

export function renderUnlabeledConnectedFollowupFailure(message: string) {
  const text = message.trim() || "已接通未标注跟进没有加载";
  return `<p data-unlabeled-connected-followup-error="1">${escapeHtml(text)}</p>`;
}

function textOrDash(value: string | undefined) {
  const text = (value || "").trim();
  return text || "—";
}

export function renderUnlabeledConnectedFollowup(data: UnlabeledConnectedFollowupResponse | undefined, view?: QueueOwnerReassignView, canSkip = false, markView?: PhoneInvalidBatchView) {
  const rows = data?.items || [];
  if (!rows.length) {
    if (queueCallGlanceFilterActive(data)) return queueCallGlanceFilterEmpty('data-unlabeled-connected-followup-empty="1"');
    return renderUnlabeledConnectedFollowupEmpty();
  }
  const body = rows.map((item) => {
    const notice = (item.suppressionNotice || "").trim();
    const noticeHtml = notice
      ? `<p data-unlabeled-connected-followup-notice="1">${escapeHtml(notice)}</p>`
      : "";
    return `<li data-unlabeled-connected-followup-row="1" data-target-type="${escapeHtml(item.targetType)}" data-target-id="${escapeHtml(item.targetId)}" data-call-record-id="${escapeHtml(item.callRecordId)}">${missingNextFollowupPick(item.targetType, item.targetId)}${queueOwnerReassignPick(item.targetType, item.targetId, view)}${sameDaySkipBatchPick(item.targetType, item.targetId, canSkip)}${phoneInvalidBatchPick(item.targetType, item.targetId, markView)}${backupNumberBatchPick(item.targetType, item.targetId, markView)}<button type="button" class="btn" data-unlabeled-connected-followup-open="1">${escapeHtml(item.name || item.targetId)}</button>${queueCallGlanceMarkup(item)}<span>${escapeHtml(item.targetLabel || item.targetType)}</span><span data-unlabeled-connected-followup-outcome="1">${escapeHtml(textOrDash(item.outcome))}</span><time data-unlabeled-connected-followup-at="1">${escapeHtml(textOrDash(item.labeledAt))}</time><span data-unlabeled-connected-followup-next="1">${escapeHtml(textOrDash(item.nextFollowAt))}</span><span data-unlabeled-connected-followup-agent="1">通话坐席 ${escapeHtml(textOrDash(item.agentLabel))}</span><span data-unlabeled-connected-followup-number="1">${escapeHtml(textOrDash(item.maskedNumber))}</span>${noticeHtml}<form data-unlabeled-connected-followup-schedule="1" data-target-type="${escapeHtml(item.targetType)}" data-target-id="${escapeHtml(item.targetId)}"><label>下次跟进<input type="datetime-local" data-unlabeled-connected-follow-at></label><button class="btn" type="submit">记下下次跟进</button></form></li>`;
  }).join("");
  const scope = data?.scope === "team" ? "团队" : "我的";
  return `<div data-unlabeled-connected-followup="1"><p data-unlabeled-connected-followup-scope="${escapeHtml(data?.scope || "mine")}">${escapeHtml(scope)}</p>${missingNextFollowupBatchForm()}${queueOwnerReassignFormFor(rows, view)}${sameDaySkipBatchFormFor(rows, canSkip)}${phoneInvalidBatchFormFor(rows, markView)}${backupNumberBatchFormFor(rows, markView)}<ul>${body}</ul></div>`;
}
