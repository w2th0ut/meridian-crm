/**
 * 工作台里已接通、还没标成五项结果的通话。
 * 勾选多通之后，一次标成同一个结果。这里不发起外呼。
 */

import { CALL_OUTCOME_NOTE_MAX, CALL_OUTCOMES } from "./outbound-call-records.js";

export interface UnlabeledConnectedCallItem {
  callRecordId: string;
  outcome?: string;
  maskedNumber?: string;
  agentLabel?: string;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  name?: string;
  startedAt?: string;
}

export interface UnlabeledConnectedCallResponse {
  scope?: "mine" | "team";
  empty?: boolean;
  items?: UnlabeledConnectedCallItem[];
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

function whenText(value: string | undefined) {
  const text = (value || "").trim();
  if (!text) return "—";
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

export function unlabeledConnectedCallQuery(input: { scope: "mine" | "team" }) {
  return `?scope=${encodeURIComponent(input.scope)}`;
}

export function callOutcomeBatchBody(input: { callRecordIds: string[]; outcome: string; note?: string }) {
  const body: { callRecordIds: string[]; outcome: string; note?: string } = {
    callRecordIds: input.callRecordIds,
    outcome: input.outcome
  };
  const note = (input.note || "").trim();
  if (note) body.note = note;
  return body;
}

export function renderUnlabeledConnectedCallEmpty() {
  return `<p data-call-outcome-batch-empty="1">这个范围内没有已接通还没标注的通话。</p>`;
}

export function renderUnlabeledConnectedCallFailure(message: string) {
  const text = message.trim() || "已接通未标注通话没有加载";
  return `<p data-call-outcome-batch-error="1">${escapeHtml(text)}</p>`;
}

export function renderCallOutcomeBatchOptions() {
  return CALL_OUTCOMES.map((item) => `<option value="${item}">${item}</option>`).join("");
}

export function renderUnlabeledConnectedCalls(data: UnlabeledConnectedCallResponse | undefined) {
  const rows = data?.items || [];
  if (!rows.length) return renderUnlabeledConnectedCallEmpty();
  const scope = data?.scope === "team" ? "团队" : "我的";
  const body = rows.map((item) => {
    const id = item.callRecordId || "";
    return `<li data-call-outcome-batch-row="1" data-call-record-id="${escapeHtml(id)}"><label><input type="checkbox" data-call-outcome-batch-id="${escapeHtml(id)}" value="${escapeHtml(id)}">选择</label><button type="button" class="btn" data-call-outcome-batch-open="1">${escapeHtml(item.name || id || "这通通话")}</button><span>${escapeHtml(textOrDash(item.targetLabel))}</span><span data-call-outcome-batch-outcome="1">未标注</span><time data-call-outcome-batch-at="1">${escapeHtml(whenText(item.startedAt))}</time><span data-call-outcome-batch-agent="1">${escapeHtml(textOrDash(item.agentLabel))}</span><span data-call-outcome-batch-number="1">${escapeHtml(textOrDash(item.maskedNumber))}</span></li>`;
  }).join("");
  return `<div data-call-outcome-batch-list="1"><p data-call-outcome-batch-scope="${escapeHtml(data?.scope || "mine")}">${escapeHtml(scope)}</p><label data-call-outcome-batch-all-wrap="1"><input type="checkbox" data-call-outcome-batch-all="1">全选这一页</label><ul>${body}</ul></div>`;
}

export { CALL_OUTCOME_NOTE_MAX };
