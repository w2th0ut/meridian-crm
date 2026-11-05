/**
 * 其他通话结果还没有下次跟进。只渲染接口返回的对象、通话结果、标注时间和已经脱敏的号码。
 * 记下下次跟进是单条提交。勾选后可以一次设置同一个时间和备注。没有外呼按钮。
 */

import { missingNextFollowupBatchForm, missingNextFollowupPick } from "./missing-next-followup-batch";
import { queueOwnerReassignFormFor, queueOwnerReassignPick, type QueueOwnerReassignView } from "./queue-owner-reassign";
import { phoneInvalidBatchFormFor, phoneInvalidBatchPick, type PhoneInvalidBatchView } from "./phone-invalid-batch";
import { sameDaySkipBatchFormFor, sameDaySkipBatchPick } from "./same-day-skip-batch";

export interface OtherOutcomeFollowupItem {
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
}

export interface OtherOutcomeFollowupResponse {
  scope?: "mine" | "team";
  empty?: boolean;
  items?: OtherOutcomeFollowupItem[];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function otherOutcomeFollowupQuery(input: { scope: "mine" | "team" }) {
  const params = new URLSearchParams();
  params.set("scope", input.scope);
  return `?${params.toString()}`;
}

export function renderOtherOutcomeFollowupEmpty() {
  return `<p data-other-outcome-followup-empty="1">这个范围内没有「其他」结果还缺下次跟进的对象。</p>`;
}

export function renderOtherOutcomeFollowupFailure(message: string) {
  const text = message.trim() || "其他结果跟进没有加载";
  return `<p data-other-outcome-followup-error="1">${escapeHtml(text)}</p>`;
}

function textOrDash(value: string | undefined) {
  const text = (value || "").trim();
  return text || "—";
}

export function renderOtherOutcomeFollowup(data: OtherOutcomeFollowupResponse | undefined, view?: QueueOwnerReassignView, canSkip = false, markView?: PhoneInvalidBatchView) {
  const rows = data?.items || [];
  if (!rows.length) return renderOtherOutcomeFollowupEmpty();
  const body = rows.map((item) => {
    const notice = (item.suppressionNotice || "").trim();
    const noticeHtml = notice
      ? `<p data-other-outcome-followup-notice="1">${escapeHtml(notice)}</p>`
      : "";
    return `<li data-other-outcome-followup-row="1" data-target-type="${escapeHtml(item.targetType)}" data-target-id="${escapeHtml(item.targetId)}" data-call-record-id="${escapeHtml(item.callRecordId)}">${missingNextFollowupPick(item.targetType, item.targetId)}${queueOwnerReassignPick(item.targetType, item.targetId, view)}${sameDaySkipBatchPick(item.targetType, item.targetId, canSkip)}${phoneInvalidBatchPick(item.targetType, item.targetId, markView)}<button type="button" class="btn" data-other-outcome-followup-open="1">${escapeHtml(item.name || item.targetId)}</button><span>${escapeHtml(item.targetLabel || item.targetType)}</span><span data-other-outcome-followup-outcome="1">${escapeHtml(textOrDash(item.outcome))}</span><time data-other-outcome-followup-at="1">${escapeHtml(textOrDash(item.labeledAt))}</time><span data-other-outcome-followup-next="1">${escapeHtml(textOrDash(item.nextFollowAt))}</span><span data-other-outcome-followup-agent="1">通话坐席 ${escapeHtml(textOrDash(item.agentLabel))}</span><span data-other-outcome-followup-number="1">${escapeHtml(textOrDash(item.maskedNumber))}</span>${noticeHtml}<form data-other-outcome-followup-schedule="1" data-target-type="${escapeHtml(item.targetType)}" data-target-id="${escapeHtml(item.targetId)}"><label>下次跟进<input type="datetime-local" data-other-outcome-follow-at></label><button class="btn" type="submit">记下下次跟进</button></form></li>`;
  }).join("");
  const scope = data?.scope === "team" ? "团队" : "我的";
  return `<div data-other-outcome-followup="1"><p data-other-outcome-followup-scope="${escapeHtml(data?.scope || "mine")}">${escapeHtml(scope)}</p>${missingNextFollowupBatchForm()}${queueOwnerReassignFormFor(rows, view)}${sameDaySkipBatchFormFor(rows, canSkip)}${phoneInvalidBatchFormFor(rows, markView)}<ul>${body}</ul></div>`;
}
