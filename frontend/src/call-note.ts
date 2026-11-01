/**
 * 单条通话纪要的表单和时间线。不拨号，也不批量填写。
 */

export const CALL_NOTE_TAGS = ["需求", "预算", "决策人", "竞品", "异议"] as const;
export const CALL_NOTE_MAX = 1000;

export interface CallNoteTimelineEntry {
  callRecordId: string;
  note: string;
  tags: string[];
  at: string;
  maskedNumber?: string;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderCallNoteTagOptions(selected: string[] | undefined) {
  const picked = new Set(selected || []);
  return CALL_NOTE_TAGS.map((tag) => {
    const checked = picked.has(tag) ? " checked" : "";
    return `<label><input type="checkbox" data-call-note-tag value="${escapeHtml(tag)}"${checked}>${escapeHtml(tag)}</label>`;
  }).join("");
}

export function renderCallNoteForm(record: { id: string; callNote?: string; callNoteTags?: string[] }) {
  return `<form class="outbound-record-note-form" data-call-note-form="1" data-record-id="${escapeHtml(record.id)}"><label>通话纪要<textarea data-call-note maxlength="${CALL_NOTE_MAX}" rows="3">${escapeHtml(record.callNote || "")}</textarea></label><div class="outbound-record-note-tags" data-call-note-tags="1">${renderCallNoteTagOptions(record.callNoteTags)}</div><button class="btn" type="submit">保存纪要</button><button class="btn" type="button" data-call-note-clear="1">清空纪要</button></form>`;
}

export function renderCallNoteTimeline(entries: CallNoteTimelineEntry[] | undefined) {
  const rows = (entries || []).filter((entry) => (entry.note || "").trim() || (entry.tags || []).length);
  if (!rows.length) return "";
  return rows.map((entry) => {
    const tags = (entry.tags || []).filter(Boolean).join("、");
    const tagText = tags ? `要点：${tags}` : "未选要点";
    const when = entry.at ? new Date(entry.at).toLocaleString("zh-CN", { hour12: false }) : "";
    return `<article class="timeline-item customer-page-followup" data-call-note="${escapeHtml(entry.callRecordId)}"><b>通话纪要</b><span>${escapeHtml(entry.note || "")}</span><small>${escapeHtml(tagText)}${entry.maskedNumber ? ` · ${escapeHtml(entry.maskedNumber)}` : ""}${when ? ` · ${escapeHtml(when)}` : ""}</small></article>`;
  }).join("");
}

export function renderOutboundCallNoteFilterEmpty() {
  return `<p data-note-filter-empty="1">这个纪要筛选下还没有通话。</p>`;
}
