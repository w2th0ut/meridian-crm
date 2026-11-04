/**
 * 搜客跟进旁边的已有通话纪要。只渲染接口返回的正文、要点、时间和已经脱敏的号码。
 * 点查看才读取。没有外呼按钮。
 */

export interface ProspectCallNoteItem {
  callRecordId: string;
  note?: string;
  tags?: string[];
  at?: string;
  maskedNumber?: string;
}

export interface ProspectCallNotesResponse {
  candidateId?: string;
  empty?: boolean;
  items?: ProspectCallNoteItem[];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderProspectCallNotesShell(candidateId: string) {
  return `<section data-prospect-call-notes="1" data-candidate-id="${escapeHtml(candidateId)}"><h3>通话纪要</h3><p>这个搜客对象上已经写下的通话纪要。只读，不另写跟进，也不改下次跟进。</p><button class="btn" type="button" data-prospect-call-notes-load="1">查看通话纪要</button><div data-prospect-call-notes-body="1"><p data-prospect-call-notes-idle="1">点查看后才读取这个搜客对象的通话纪要。</p></div></section>`;
}

export function renderProspectCallNotesEmpty() {
  return `<p data-prospect-call-notes-empty="1">还没有通话纪要。</p>`;
}

export function renderProspectCallNotesFailure(message: string) {
  const text = message.trim() || "通话纪要没有加载";
  return `<p data-prospect-call-notes-error="1">${escapeHtml(text)}</p>`;
}

function whenText(value: string | undefined) {
  const text = (value || "").trim();
  if (!text) return "—";
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

export function renderProspectCallNotes(data: ProspectCallNotesResponse | undefined) {
  const rows = data?.items || [];
  if (!rows.length) return renderProspectCallNotesEmpty();
  return rows.map((item) => {
    const tags = (item.tags || []).filter(Boolean).join("、");
    const tagText = tags ? `要点：${tags}` : "未选要点";
    const number = (item.maskedNumber || "").trim();
    return `<article data-prospect-call-note="1" data-call-record-id="${escapeHtml(item.callRecordId)}"><button type="button" class="btn" data-prospect-call-note-open="1" data-call-record-id="${escapeHtml(item.callRecordId)}">打开这通</button><span>${escapeHtml((item.note || "").trim())}</span><small>${escapeHtml(tagText)}${number ? ` · ${escapeHtml(number)}` : ""} · <time data-prospect-call-note-at="1">${escapeHtml(whenText(item.at))}</time></small></article>`;
  }).join("");
}
