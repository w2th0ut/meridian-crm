/** 工作台待跟进和还没有下次跟进的名单上，勾选后一次转交负责人。这里不发起外呼。 */

export interface QueueOwnerReassignView {
  assignees: Array<{ id: string; name: string }>;
  customer: boolean;
  lead: boolean;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function showQueueOwnerReassign(view: QueueOwnerReassignView | undefined) {
  return Boolean(view && (view.customer || view.lead));
}

export function queueOwnerReassignPick(targetType: string, targetId: string, view: QueueOwnerReassignView | undefined) {
  if (!view || !targetId) return "";
  if (targetType === "customer" && !view.customer) return "";
  if ((targetType === "lead" || targetType === "prospect") && !view.lead) return "";
  if (targetType !== "customer" && targetType !== "lead" && targetType !== "prospect") return "";
  const value = `${targetType}:${targetId}`;
  return `<label><input type="checkbox" data-queue-owner-reassign-pick="1" value="${escapeHtml(value)}">转交</label>`;
}

export function queueOwnerReassignForm(view: QueueOwnerReassignView | undefined) {
  if (!showQueueOwnerReassign(view)) return "";
  const options = (view?.assignees || []).map((item) => {
    const id = item.id.trim();
    if (!id) return "";
    return `<option value="${escapeHtml(id)}">${escapeHtml(item.name || id)}</option>`;
  }).join("");
  return `<form data-queue-owner-reassign="1"><label><input type="checkbox" data-queue-owner-reassign-all="1">全选这一页</label><label>转交给<select data-queue-owner-reassign-to="1"><option value="">选择同事</option>${options}</select></label><button class="btn" type="submit" data-queue-owner-reassign-submit="1">批量转交负责人</button><p data-queue-owner-reassign-hint="1">勾选后一次转给同一位同租户同事。不会拨出。</p></form>`;
}

export function queueOwnerReassignFormFor(
  rows: Array<{ targetType?: string; targetId?: string }> | undefined,
  view: QueueOwnerReassignView | undefined
) {
  const visible = (rows || []).some((row) => queueOwnerReassignPick(row.targetType || "", row.targetId || "", view));
  if (!visible) return "";
  return queueOwnerReassignForm(view);
}

export function queueOwnerReassignBody(input: { targets: Array<{ targetType: string; targetId: string }>; transferTo: string }) {
  return {
    targets: input.targets,
    transferTo: input.transferTo.trim()
  };
}
