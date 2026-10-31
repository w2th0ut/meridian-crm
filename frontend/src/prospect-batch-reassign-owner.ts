/** 搜客清单批量改负责人。只组请求和入口，不发信，不发消息，不推进序列，不放行批次。 */

export const PROSPECT_OWNER_REASSIGN_LIMIT = 100;

export function showProspectReassignOwnerEntry(canAssign: boolean) {
  return canAssign;
}

export function buildProspectReassignOwnerBody(
  ids: string[],
  ownerId: string
): { ok: true; body: { ids: string[]; ownerId: string } } | { ok: false; message: string } {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (!unique.length) return { ok: false, message: "请先选择候选" };
  if (unique.length > PROSPECT_OWNER_REASSIGN_LIMIT) return { ok: false, message: "一次最多改 100 条" };
  const nextOwnerId = ownerId.trim();
  if (!nextOwnerId) return { ok: false, message: "请选择新负责人" };
  return { ok: true, body: { ids: unique, ownerId: nextOwnerId } };
}

export function summarizeProspectOwnerReassign(
  results: Array<{ ok: boolean; reason?: string }>
) {
  const changed = results.filter((item) => item.ok).length;
  const failed = results.filter((item) => !item.ok);
  if (!failed.length) return `已改 ${changed} 条负责人`;
  const reasons = [...new Set(failed.map((item) => item.reason || "未修改"))].join("；");
  if (!changed) return reasons;
  return `已改 ${changed} 条。未改 ${failed.length} 条：${reasons}`;
}
