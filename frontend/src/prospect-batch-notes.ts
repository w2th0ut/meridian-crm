/** 搜客清单批量追加备注。只组请求和入口，不发信，不发消息，不推进序列，不放行批次。 */

export const PROSPECT_NOTE_BATCH_LIMIT = 100;
export const PROSPECT_NOTE_TEXT_MAX = 1000;

export function showProspectNoteEntry(canExecute: boolean) {
  return canExecute;
}

export function buildProspectNoteBody(
  ids: string[],
  raw: string
): { ok: true; body: { ids: string[]; note: string } } | { ok: false; message: string } {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (!unique.length) return { ok: false, message: "请先选择候选" };
  if (unique.length > PROSPECT_NOTE_BATCH_LIMIT) return { ok: false, message: "一次最多 100 条" };
  const note = String(raw ?? "").trim();
  if (!note) return { ok: false, message: "请填写备注" };
  if (note.length > PROSPECT_NOTE_TEXT_MAX) return { ok: false, message: "备注过长" };
  return { ok: true, body: { ids: unique, note } };
}

export function summarizeProspectNoteChange(
  results: Array<{ ok: boolean; reason?: string }>
) {
  const changed = results.filter((item) => item.ok).length;
  const failed = results.filter((item) => !item.ok);
  const done = `已为 ${changed} 条追加备注`;
  if (!failed.length) return done;
  const reasons = [...new Set(failed.map((item) => item.reason || "未修改"))].join("；");
  if (!changed) return reasons;
  return `${done}。未改 ${failed.length} 条：${reasons}`;
}
