/**
 * 负向通话结果仍有下次跟进。只渲染接口返回的对象、通话结果、标注时间、下次跟进和已经脱敏的号码。
 * 清除下次跟进是单条提交。有分配权限时可以勾选后一次转交负责人。没有外呼按钮。
 */

import { queueOwnerReassignFormFor, queueOwnerReassignPick, type QueueOwnerReassignView } from "./queue-owner-reassign";
import { phoneInvalidBatchFormFor, phoneInvalidBatchPick, type PhoneInvalidBatchView } from "./phone-invalid-batch";
import { sameDaySkipBatchFormFor, sameDaySkipBatchPick } from "./same-day-skip-batch";

export interface NegativeOutcomeFollowupItem {
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

export interface NegativeOutcomeFollowupResponse {
  scope?: "mine" | "team";
  outcome?: "" | "无意向" | "号码错误";
  empty?: boolean;
  items?: NegativeOutcomeFollowupItem[];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function negativeOutcomeFollowupQuery(input: { scope: "mine" | "team"; outcome?: "" | "无意向" | "号码错误" }) {
  const params = new URLSearchParams();
  params.set("scope", input.scope);
  if (input.outcome) params.set("outcome", input.outcome);
  return `?${params.toString()}`;
}

export function renderNegativeOutcomeFollowupEmpty() {
  return `<p data-negative-outcome-followup-empty="1">这个范围内没有负向结果仍挂着下次跟进的对象。</p>`;
}

export function renderNegativeOutcomeFollowupFailure(message: string) {
  const text = message.trim() || "负向结果跟进没有加载";
  return `<p data-negative-outcome-followup-error="1">${escapeHtml(text)}</p>`;
}

function textOrDash(value: string | undefined) {
  const text = (value || "").trim();
  return text || "—";
}

export function renderNegativeOutcomeFollowup(data: NegativeOutcomeFollowupResponse | undefined, view?: QueueOwnerReassignView, canSkip = false, markView?: PhoneInvalidBatchView) {
  const rows = data?.items || [];
  if (!rows.length) return renderNegativeOutcomeFollowupEmpty();
  const body = rows.map((item) => {
    const notice = (item.suppressionNotice || "").trim();
    const noticeHtml = notice
      ? `<p data-negative-outcome-followup-notice="1">${escapeHtml(notice)}</p>`
      : "";
    return `<li data-negative-outcome-followup-row="1" data-target-type="${escapeHtml(item.targetType)}" data-target-id="${escapeHtml(item.targetId)}" data-call-record-id="${escapeHtml(item.callRecordId)}">${queueOwnerReassignPick(item.targetType, item.targetId, view)}${sameDaySkipBatchPick(item.targetType, item.targetId, canSkip)}${phoneInvalidBatchPick(item.targetType, item.targetId, markView)}<button type="button" class="btn" data-negative-outcome-followup-open="1">${escapeHtml(item.name || item.targetId)}</button><span>${escapeHtml(item.targetLabel || item.targetType)}</span><span data-negative-outcome-followup-outcome="1">${escapeHtml(textOrDash(item.outcome))}</span><time data-negative-outcome-followup-at="1">${escapeHtml(textOrDash(item.labeledAt))}</time><span data-negative-outcome-followup-next="1">${escapeHtml(textOrDash(item.nextFollowAt))}</span><span data-negative-outcome-followup-agent="1">通话坐席 ${escapeHtml(textOrDash(item.agentLabel))}</span><span data-negative-outcome-followup-number="1">${escapeHtml(textOrDash(item.maskedNumber))}</span>${noticeHtml}<form data-negative-outcome-followup-clear="1" data-target-type="${escapeHtml(item.targetType)}" data-target-id="${escapeHtml(item.targetId)}"><button class="btn" type="submit">清除下次跟进</button></form></li>`;
  }).join("");
  const scope = data?.scope === "team" ? "团队" : "我的";
  const outcome = data?.outcome === "无意向" || data?.outcome === "号码错误" ? data.outcome : "全部负向结果";
  return `<div data-negative-outcome-followup="1"><p data-negative-outcome-followup-scope="${escapeHtml(data?.scope || "mine")}">${escapeHtml(scope)} · ${escapeHtml(outcome)}</p>${queueOwnerReassignFormFor(rows, view)}${sameDaySkipBatchFormFor(rows, canSkip)}${phoneInvalidBatchFormFor(rows, markView)}<ul>${body}</ul></div>`;
}
