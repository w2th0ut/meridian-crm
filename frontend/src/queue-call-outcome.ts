/**
 * 六份工作台名单的当前行登记这一通的通话结果。
 * 五项沿用原来的标签。未标注表示清空人工标注，不另存第六项。
 * 没有通话记录 id 时不画，避免把看不见的通话写出来。不拨号，不打开详情。
 */

import { CALL_OUTCOMES } from "./outbound-call-records.js";

export const QUEUE_CALL_OUTCOME_CLEAR = "未标注";

const OUTCOME_VALUES = new Set<string>([QUEUE_CALL_OUTCOME_CLEAR, ...CALL_OUTCOMES]);

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function queueCallOutcomeSelection(value: string | undefined) {
  const text = (value || "").trim();
  return (CALL_OUTCOMES as readonly string[]).includes(text) ? text : QUEUE_CALL_OUTCOME_CLEAR;
}

export function queueCallOutcomeBody(outcome: string) {
  return { outcome, preserveNote: true as const };
}

export function isQueueCallOutcomeChoice(value: string) {
  return OUTCOME_VALUES.has(value);
}

export function renderQueueCallOutcomeForm(input: {
  callRecordId?: string;
  targetType?: string;
  targetId?: string;
  outcome?: string;
}) {
  const callRecordId = (input.callRecordId || "").trim();
  const targetType = (input.targetType || "").trim();
  const targetId = (input.targetId || "").trim();
  if (!callRecordId || !targetType || !targetId) return "";
  const selected = queueCallOutcomeSelection(input.outcome);
  const options = [QUEUE_CALL_OUTCOME_CLEAR, ...CALL_OUTCOMES].map((item) => {
    const picked = item === selected ? " selected" : "";
    return `<option value="${escapeHtml(item)}"${picked}>${escapeHtml(item)}</option>`;
  }).join("");
  return `<form data-queue-call-outcome="1" data-call-record-id="${escapeHtml(callRecordId)}" data-target-type="${escapeHtml(targetType)}" data-target-id="${escapeHtml(targetId)}"><label>本次通话结果<select data-queue-call-outcome-value="1">${options}</select></label><button class="btn" type="submit">登记结果</button></form>`;
}
