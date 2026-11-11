/**
 * 六份工作台名单的当前行登记这一通的通话结果。
 * 五项沿用原来的标签。未标注表示清空人工标注，不另存第六项。
 * 有对象写权限时，可以同时写下或清空下次跟进。不填则不改原来的下次跟进。
 * 时间是租户当地的墙上时间。没有通话记录 id 时不画，避免把看不见的通话写出来。不拨号，不打开详情。
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

export interface QueueNextFollowWriteView {
  customer: boolean;
  lead: boolean;
  prospect: boolean;
}

export function queueNextFollowWritable(targetType: string | undefined, view: QueueNextFollowWriteView | undefined) {
  if (!view) return false;
  if (targetType === "customer") return view.customer;
  if (targetType === "lead") return view.lead;
  if (targetType === "prospect") return view.prospect;
  return false;
}

export function queueCallOutcomeBody(outcome: string, inlineFollow = "", clearFollow = false) {
  const body: {
    outcome: string;
    preserveNote: true;
    inlineNextFollow?: string;
    clearInlineNextFollow?: true;
  } = { outcome, preserveNote: true };
  const when = inlineFollow.trim();
  if (clearFollow) body.clearInlineNextFollow = true;
  else if (when) body.inlineNextFollow = when;
  return body;
}

export function isQueueCallOutcomeChoice(value: string) {
  return OUTCOME_VALUES.has(value);
}

function nextFollowControls(input: { nextFollowAt?: string; timeZone?: string }) {
  const current = (input.nextFollowAt || "").trim() || "—";
  const zone = (input.timeZone || "").trim() || "租户当地时间";
  return `<label>下次跟进<span data-queue-next-follow-zone="1">（${escapeHtml(zone)}）</span><input type="datetime-local" data-queue-next-follow-at></label><span data-queue-next-follow-current="1">当前 ${escapeHtml(current)}</span><label><input type="checkbox" data-queue-next-follow-clear="1">清空下次跟进</label><p data-queue-next-follow-hint="1">不填则保持原来的下次跟进。时间按上面的时区写入。</p>`;
}

export function renderQueueCallOutcomeForm(input: {
  callRecordId?: string;
  targetType?: string;
  targetId?: string;
  outcome?: string;
  nextFollowAt?: string;
  timeZone?: string;
  canWriteNextFollow?: boolean;
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
  const follow = input.canWriteNextFollow ? nextFollowControls(input) : "";
  return `<form data-queue-call-outcome="1" data-call-record-id="${escapeHtml(callRecordId)}" data-target-type="${escapeHtml(targetType)}" data-target-id="${escapeHtml(targetId)}"><label>本次通话结果<select data-queue-call-outcome-value="1">${options}</select></label>${follow}<button class="btn" type="submit">登记结果</button></form>`;
}
