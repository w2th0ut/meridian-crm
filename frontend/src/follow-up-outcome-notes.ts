/**
 * 客户和线索跟进旁边的已有通话结果备注。只渲染接口返回的结果名称、备注、时间和已经脱敏的号码。
 * 点查看才读取。没有外呼按钮。
 */

export interface FollowUpOutcomeNoteItem {
  callRecordId: string;
  outcomeLabel?: string;
  note?: string;
  at?: string;
  maskedNumber?: string;
}

export interface FollowUpOutcomeNotesResponse {
  targetType?: string;
  targetId?: string;
  empty?: boolean;
  items?: FollowUpOutcomeNoteItem[];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderFollowUpOutcomeNotesShell(targetType: "customer" | "lead", targetId: string) {
  const label = targetType === "customer" ? "这个客户" : "这条线索";
  return `<section data-follow-up-outcome-notes="1" data-target-type="${escapeHtml(targetType)}" data-target-id="${escapeHtml(targetId)}"><h3>通话结果备注</h3><p>${label}上已经写下的通话结果备注。只读，不改标注，也不改下次跟进。</p><button class="btn" type="button" data-follow-up-outcome-notes-load="1">查看通话结果备注</button><div data-follow-up-outcome-notes-body="1"><p data-follow-up-outcome-notes-idle="1">点查看后才读取${label}的通话结果备注。</p></div></section>`;
}

export function renderFollowUpOutcomeNotesEmpty() {
  return `<p data-follow-up-outcome-notes-empty="1">还没有通话结果备注。</p>`;
}

export function renderFollowUpOutcomeNotesFailure(message: string) {
  const text = message.trim() || "通话结果备注没有加载";
  return `<p data-follow-up-outcome-notes-error="1">${escapeHtml(text)}</p>`;
}

function whenText(value: string | undefined) {
  const text = (value || "").trim();
  if (!text) return "—";
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

export function renderFollowUpOutcomeNotes(data: FollowUpOutcomeNotesResponse | undefined) {
  const rows = data?.items || [];
  if (!rows.length) return renderFollowUpOutcomeNotesEmpty();
  return rows.map((item) => {
    const number = (item.maskedNumber || "").trim();
    const label = (item.outcomeLabel || "").trim() || "未标注";
    return `<article data-follow-up-outcome-note="1" data-call-record-id="${escapeHtml(item.callRecordId)}"><button type="button" class="btn" data-follow-up-outcome-note-open="1" data-call-record-id="${escapeHtml(item.callRecordId)}">打开这通</button><b data-follow-up-outcome-label="1">${escapeHtml(label)}</b><span>${escapeHtml((item.note || "").trim())}</span><small>${number ? `${escapeHtml(number)} · ` : ""}<time data-follow-up-outcome-note-at="1">${escapeHtml(whenText(item.at))}</time></small></article>`;
  }).join("");
}
