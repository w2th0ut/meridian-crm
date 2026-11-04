/**
 * 单条通话结果表单上的「转交给」。
 * 没有分配权限时不渲染。不选则不改负责人。
 * 焦点在这个下拉里时，它是选择框，数字和回车仍不拦截。不拨号。
 */

export interface CallOutcomeTransferView {
  assignees: Array<{ id: string; name: string }>;
  customer: boolean;
  lead: boolean;
}

export function showCallOutcomeTransfer(
  record: { targetType?: string; targetId?: string },
  view: CallOutcomeTransferView | undefined
) {
  if (!view) return false;
  const targetType = (record.targetType || "").trim();
  const targetId = (record.targetId || "").trim();
  if (!targetType || !targetId) return false;
  if (targetType === "customer") return view.customer;
  if (targetType === "lead" || targetType === "prospect") return view.lead;
  return false;
}

export function renderCallOutcomeTransfer(
  record: { targetType?: string; targetId?: string },
  view: CallOutcomeTransferView | undefined
) {
  if (!showCallOutcomeTransfer(record, view)) return "";
  const options = (view?.assignees || []).map((item) => {
    const id = item.id.trim();
    if (!id) return "";
    return `<option value="${escapeHtml(id)}">${escapeHtml(item.name || id)}</option>`;
  }).join("");
  return `<label data-call-outcome-transfer-wrap="1">转交给<select data-call-outcome-transfer="1"><option value="">不转交</option>${options}</select></label><p data-call-outcome-transfer-note="1">保存结果时把这个客户、线索或搜客对象的负责人改成所选的同租户同事。不选则不改负责人，也不会拨出。</p>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
