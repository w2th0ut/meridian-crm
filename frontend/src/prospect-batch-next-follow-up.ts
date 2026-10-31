/** 搜客清单批量设置或清空下次跟进日期。只组请求和入口，不发信，不发消息，不推进序列，不放行批次。 */

export const PROSPECT_NEXT_FOLLOW_UP_BATCH_LIMIT = 100;
export const PROSPECT_NEXT_FOLLOW_UP_CLOCK = "23:59";

export function showProspectNextFollowUpEntry(canExecute: boolean) {
  return canExecute;
}

function localIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function earliestProspectNextFollowDate(now = new Date()) {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  day.setDate(day.getDate() - 1);
  return localIsoDate(day);
}

export function normalizeProspectNextFollowDate(
  value: string,
  now = new Date()
): { ok: true; date: string } | { ok: false; message: string } {
  const text = String(value ?? "").trim();
  if (!text) return { ok: false, message: "请填写下次跟进日期" };
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return { ok: false, message: "下次跟进日期不正确" };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return { ok: false, message: "下次跟进日期不正确" };
  }
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (date < earliestProspectNextFollowDate(now)) return { ok: false, message: "下次跟进日期不能早于昨天" };
  return { ok: true, date };
}

export function buildProspectNextFollowUpBody(
  ids: string[],
  action: "set" | "clear",
  rawDate = "",
  now = new Date()
): { ok: true; body: { ids: string[]; action: "set" | "clear"; date?: string } } | { ok: false; message: string } {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (!unique.length) return { ok: false, message: "请先选择候选" };
  if (unique.length > PROSPECT_NEXT_FOLLOW_UP_BATCH_LIMIT) return { ok: false, message: "一次最多 100 条" };
  if (action === "clear") return { ok: true, body: { ids: unique, action } };
  const normalized = normalizeProspectNextFollowDate(rawDate, now);
  if (!normalized.ok) return normalized;
  return { ok: true, body: { ids: unique, action, date: normalized.date } };
}

export function summarizeProspectNextFollowUpChange(
  action: "set" | "clear",
  results: Array<{ ok: boolean; reason?: string }>
) {
  const changed = results.filter((item) => item.ok).length;
  const failed = results.filter((item) => !item.ok);
  const done = action === "set" ? `已为 ${changed} 条设置下次跟进` : `已清空 ${changed} 条下次跟进`;
  if (!failed.length) return done;
  const reasons = [...new Set(failed.map((item) => item.reason || "未修改"))].join("；");
  if (!changed) return reasons;
  return `${done}。未改 ${failed.length} 条：${reasons}`;
}
