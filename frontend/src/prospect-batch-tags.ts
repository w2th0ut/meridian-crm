/** 搜客清单批量打标签或移除标签。只组请求和入口，不发信，不发消息，不推进序列，不放行批次。 */

export const PROSPECT_TAG_BATCH_LIMIT = 100;
export const PROSPECT_TAG_TEXT_MAX = 40;
export const PROSPECT_TAG_COUNT_MAX = 20;

export function showProspectTagEntry(canExecute: boolean) {
  return canExecute;
}

export function buildProspectTagBody(
  ids: string[],
  action: "add" | "remove",
  raw: string
): { ok: true; body: { ids: string[]; action: "add" | "remove"; tags: string[] } } | { ok: false; message: string } {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (!unique.length) return { ok: false, message: "请先选择候选" };
  if (unique.length > PROSPECT_TAG_BATCH_LIMIT) return { ok: false, message: "一次最多 100 条" };
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[，,]/u)) {
    const tag = part.trim();
    if (!tag) continue;
    if (tag.length > PROSPECT_TAG_TEXT_MAX) return { ok: false, message: "标签过长" };
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  if (!tags.length) return { ok: false, message: "请填写标签" };
  if (tags.length > PROSPECT_TAG_COUNT_MAX) return { ok: false, message: "一次最多 20 个标签" };
  return { ok: true, body: { ids: unique, action, tags } };
}

export function summarizeProspectTagChange(
  action: "add" | "remove",
  results: Array<{ ok: boolean; reason?: string }>
) {
  const changed = results.filter((item) => item.ok).length;
  const failed = results.filter((item) => !item.ok);
  const done = action === "add" ? `已为 ${changed} 条打上标签` : `已从 ${changed} 条移除标签`;
  if (!failed.length) return done;
  const reasons = [...new Set(failed.map((item) => item.reason || "未修改"))].join("；");
  if (!changed) return reasons;
  return `${done}。未改 ${failed.length} 条：${reasons}`;
}
