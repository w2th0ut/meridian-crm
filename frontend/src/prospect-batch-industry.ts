/** 搜客清单批量设置或清除行业。只组请求和入口，不发信，不发消息，不推进序列，不放行批次。 */

export const PROSPECT_INDUSTRY_BATCH_LIMIT = 100;
export const PROSPECT_INDUSTRY_TEXT_MAX = 120;

export function showProspectIndustryEntry(canExecute: boolean) {
  return canExecute;
}

export function prospectIndustryLabel(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text || text.length > PROSPECT_INDUSTRY_TEXT_MAX) return "未设行业";
  return text;
}

export function buildProspectIndustryBody(
  ids: string[],
  action: "set" | "clear",
  rawIndustry = ""
): { ok: true; body: { ids: string[]; action: "set" | "clear"; industry?: string } } | { ok: false; message: string } {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (!unique.length) return { ok: false, message: "请先选择候选" };
  if (unique.length > PROSPECT_INDUSTRY_BATCH_LIMIT) return { ok: false, message: "一次最多 100 条" };
  if (action === "clear") return { ok: true, body: { ids: unique, action } };
  const industry = String(rawIndustry ?? "").trim();
  if (!industry) return { ok: false, message: "请填写行业" };
  if (industry.length > PROSPECT_INDUSTRY_TEXT_MAX) return { ok: false, message: "行业过长" };
  return { ok: true, body: { ids: unique, action, industry } };
}

export function summarizeProspectIndustryChange(
  action: "set" | "clear",
  results: Array<{ ok: boolean; reason?: string }>
) {
  const changed = results.filter((item) => item.ok).length;
  const failed = results.filter((item) => !item.ok);
  const done = action === "set" ? `已为 ${changed} 条设置行业` : `已清除 ${changed} 条行业`;
  if (!failed.length) return done;
  const reasons = [...new Set(failed.map((item) => item.reason || "未修改"))].join("；");
  if (!changed) return reasons;
  return `${done}。未改 ${failed.length} 条：${reasons}`;
}
