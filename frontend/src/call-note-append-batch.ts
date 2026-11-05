/** 已标结果和未接通待处理上，勾选最近一通，先预览再追加同一句备注。这里不发起外呼。 */

import { renderOutcomeNotePhraseShell } from "./call-outcome-note-phrase";

export interface CallNoteAppendView {
  customer: boolean;
  lead: boolean;
  prospect: boolean;
}

export interface CallNoteAppendPreviewItem {
  callRecordId?: string;
  name?: string;
  outcome?: string;
  previousNote?: string;
  nextNote?: string;
  status?: string;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function showCallNoteAppend(view: CallNoteAppendView | undefined) {
  return Boolean(view && (view.customer || view.lead || view.prospect));
}

export function callNoteAppendPick(targetType: string, callRecordId: string, view: CallNoteAppendView | undefined) {
  if (!view || !callRecordId) return "";
  if (targetType === "customer" && !view.customer) return "";
  if (targetType === "lead" && !view.lead) return "";
  if (targetType === "prospect" && !view.prospect) return "";
  if (targetType !== "customer" && targetType !== "lead" && targetType !== "prospect") return "";
  return `<label><input type="checkbox" data-call-note-append-pick="1" value="${escapeHtml(callRecordId)}">补备注</label>`;
}

export function callNoteAppendForm(view: CallNoteAppendView | undefined) {
  if (!showCallNoteAppend(view)) return "";
  return `<form data-call-note-append="1"><label><input type="checkbox" data-call-note-append-all="1">全选这一页</label><label>追加备注<input data-call-note-append-note maxlength="200"></label>${renderOutcomeNotePhraseShell()}<button class="btn" type="button" data-call-note-append-preview="1">预览补备注</button><button class="btn" type="submit" data-call-note-append-submit="1" disabled>确认补备注</button><div data-call-note-append-preview-box="1"></div><p data-call-note-append-hint="1">勾选最多 100 通最近通话。先预览再确认，一次追加同一句备注，不覆盖原来的备注。常用短语可以插进这一句。不会拨出。</p></form>`;
}

export function callNoteAppendFormFor(
  rows: Array<{ targetType?: string; callRecordId?: string }> | undefined,
  view: CallNoteAppendView | undefined
) {
  const visible = (rows || []).some((row) => callNoteAppendPick(row.targetType || "", row.callRecordId || "", view));
  if (!visible) return "";
  return callNoteAppendForm(view);
}

export function callNoteAppendBody(input: { callRecordIds: string[]; note?: string; phraseId?: string }) {
  const note = (input.note || "").trim();
  const phraseId = (input.phraseId || "").trim();
  return {
    callRecordIds: input.callRecordIds,
    ...(note ? { note } : {}),
    ...(phraseId ? { phraseId } : {})
  };
}

export function renderCallNoteAppendPreview(items: CallNoteAppendPreviewItem[] | undefined) {
  const rows = (items || []).map((item) => {
    const name = escapeHtml((item.name || item.callRecordId || "").trim() || "—");
    const id = escapeHtml(item.callRecordId || "");
    const outcome = escapeHtml((item.outcome || "").trim() || "—");
    if (item.status === "too_long") {
      return `<li data-call-note-append-skip="1" data-call-record-id="${id}">${name} ${outcome} 备注放不下，不追加</li>`;
    }
    const previous = (item.previousNote || "").trim();
    const next = escapeHtml((item.nextNote || "").trim() || "—");
    const before = previous ? `原备注 ${escapeHtml(previous)}` : "原来没有备注";
    return `<li data-call-note-append-ready="1" data-call-record-id="${id}">${name} ${outcome} ${before}，追加后 ${next}</li>`;
  }).join("");
  return `<ul data-call-note-append-preview-list="1">${rows}</ul>`;
}
