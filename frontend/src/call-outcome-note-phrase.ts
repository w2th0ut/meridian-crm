/**
 * 通话结果备注的常用短语。只把已保存的正文插进备注框。
 * 不提交标注，不拨号，不调用外部接口。
 */

export const CALL_OUTCOME_NOTE_PHRASE_MAX = 200;

export interface OutcomeNotePhraseView {
  id: string;
  text: string;
  scope?: "personal" | "team";
  enabled?: boolean;
  canDisable?: boolean;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function applyOutcomeNotePhrase(current: string, phrase: string, max = CALL_OUTCOME_NOTE_PHRASE_MAX) {
  const text = phrase.trim();
  if (!text || /[\r\n]/.test(text)) return { value: current, inserted: false };
  const existing = current.replace(/\s+$/u, "");
  const next = existing.trim() ? `${existing} ${text}` : text;
  if (Array.from(next).length > max) return { value: current, inserted: false };
  return { value: next, inserted: true };
}

export function renderOutcomeNotePhraseShell() {
  return `<div data-outcome-note-phrases="1"><p data-outcome-note-phrase-hint="1">常用短语只插入备注，不会自动保存标注。</p><button class="btn" type="button" data-outcome-note-phrase-load="1">常用短语</button><div data-outcome-note-phrase-body="1"><p data-outcome-note-phrase-idle="1">点常用短语后才读取。</p></div></div>`;
}

export function renderOutcomeNotePhrases(phrases: OutcomeNotePhraseView[] | undefined, options?: { shortcut?: boolean }) {
  const rows = (phrases || []).filter((item) => item.enabled !== false && (item.text || "").trim());
  const buttons = rows.map((item, index) => {
    const text = item.text.trim();
    const scope = item.scope === "team" ? "团队" : "自己";
    const key = options?.shortcut && index < 9 ? String(index + 1) : "";
    const hint = key ? `<kbd data-outcome-note-phrase-key="${key}">Alt+${key}</kbd>` : "";
    return `<button class="btn" type="button" data-outcome-note-phrase="1" data-outcome-note-phrase-text="${escapeHtml(text)}">${hint}${escapeHtml(text)}<small>${scope}</small></button>`;
  }).join("");
  const disables = (phrases || []).filter((item) => item.enabled !== false && item.canDisable && item.id).map((item) => {
    return `<button class="btn" type="button" data-outcome-note-phrase-disable="${escapeHtml(item.id)}">停用 ${escapeHtml(item.text.trim())}</button>`;
  }).join("");
  const insert = buttons || `<p data-outcome-note-phrase-empty="1">还没有可插入的常用短语。</p>`;
  return `<div data-outcome-note-phrase-ready="1">${insert}<div data-outcome-note-phrase-create="1"><label>短语<input data-outcome-note-phrase-draft maxlength="${CALL_OUTCOME_NOTE_PHRASE_MAX}"></label><label>范围<select data-outcome-note-phrase-scope><option value="personal">自己的</option><option value="team">团队的</option></select></label><button class="btn" type="button" data-outcome-note-phrase-save="1">保存短语</button></div>${disables}</div>`;
}
