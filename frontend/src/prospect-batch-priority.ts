/** 搜客清单批量设置或清除优先级。只组请求和入口，不发信，不发消息，不推进序列，不放行批次。 */

export const PROSPECT_PRIORITY_BATCH_LIMIT = 100;
export const PROSPECT_PRIORITY_VALUES = ["high", "normal", "low"] as const;

export type ProspectPriority = (typeof PROSPECT_PRIORITY_VALUES)[number];

export function showProspectPriorityEntry(canExecute: boolean) {
  return canExecute;
}

export function prospectPriorityLabel(value: string | null | undefined) {
  if (value === "high") return "高";
  if (value === "normal") return "普通";
  if (value === "low") return "低";
  return "未设优先级";
}

export function buildProspectPriorityBody(
  ids: string[],
  action: "set" | "clear",
  rawPriority = ""
): { ok: true; body: { ids: string[]; action: "set" | "clear"; priority?: ProspectPriority } } | { ok: false; message: string } {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (!unique.length) return { ok: false, message: "请先选择候选" };
  if (unique.length > PROSPECT_PRIORITY_BATCH_LIMIT) return { ok: false, message: "一次最多 100 条" };
  if (action === "clear") return { ok: true, body: { ids: unique, action } };
  const priority = String(rawPriority ?? "").trim();
  if (!priority) return { ok: false, message: "请填写优先级" };
  if (priority !== "high" && priority !== "normal" && priority !== "low") {
    return { ok: false, message: "优先级不正确" };
  }
  return { ok: true, body: { ids: unique, action, priority } };
}

export function summarizeProspectPriorityChange(
  action: "set" | "clear",
  results: Array<{ ok: boolean; reason?: string }>
) {
  const changed = results.filter((item) => item.ok).length;
  const failed = results.filter((item) => !item.ok);
  const done = action === "set" ? `已为 ${changed} 条设置优先级` : `已清除 ${changed} 条优先级`;
  if (!failed.length) return done;
  const reasons = [...new Set(failed.map((item) => item.reason || "未修改"))].join("；");
  if (!changed) return reasons;
  return `${done}。未改 ${failed.length} 条：${reasons}`;
}
