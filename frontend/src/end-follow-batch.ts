/** 负向结果仍有下次跟进和今日待跟进上，勾选后先预览再一次清空下次跟进。这里不发起外呼。 */

export interface EndFollowBatchView {
  customer: boolean;
  lead: boolean;
  prospect: boolean;
}

export interface EndFollowPreviewItem {
  targetType?: string;
  targetId?: string;
  name?: string;
  status?: string;
  nextFollowAt?: string;
  reason?: string;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function showEndFollowBatch(view: EndFollowBatchView | undefined) {
  return Boolean(view && (view.customer || view.lead || view.prospect));
}

export function endFollowBatchPick(targetType: string, targetId: string, view: EndFollowBatchView | undefined) {
  if (!view || !targetId) return "";
  if (targetType === "customer" && !view.customer) return "";
  if (targetType === "lead" && !view.lead) return "";
  if (targetType === "prospect" && !view.prospect) return "";
  if (targetType !== "customer" && targetType !== "lead" && targetType !== "prospect") return "";
  const value = `${targetType}:${targetId}`;
  return `<label><input type="checkbox" data-end-follow-batch-pick="1" value="${escapeHtml(value)}">结束跟进</label>`;
}

export function endFollowBatchForm(view: EndFollowBatchView | undefined) {
  if (!showEndFollowBatch(view)) return "";
  return `<form data-end-follow-batch="1"><label><input type="checkbox" data-end-follow-batch-all="1">全选这一页</label><label>原因<input data-end-follow-reason maxlength="200"></label><button class="btn" type="button" data-end-follow-batch-preview="1">预览结束跟进</button><button class="btn" type="submit" data-end-follow-batch-submit="1" disabled>确认结束跟进</button><div data-end-follow-batch-preview-box="1"></div><p data-end-follow-batch-hint="1">勾选最多 100 个。先预览再确认，一次清空下次跟进。原因可以不填。不会拨出。</p></form>`;
}

export function endFollowBatchFormFor(
  rows: Array<{ targetType?: string; targetId?: string }> | undefined,
  view: EndFollowBatchView | undefined
) {
  const visible = (rows || []).some((row) => endFollowBatchPick(row.targetType || "", row.targetId || "", view));
  if (!visible) return "";
  return endFollowBatchForm(view);
}

export function endFollowBatchBody(input: { targets: Array<{ targetType: string; targetId: string }>; reason?: string }) {
  const reason = (input.reason || "").trim();
  return reason
    ? { targets: input.targets, reason }
    : { targets: input.targets };
}

export function renderEndFollowPreview(items: EndFollowPreviewItem[] | undefined) {
  const rows = (items || []).map((item) => {
    const name = escapeHtml((item.name || item.targetId || "").trim() || "—");
    const id = escapeHtml(item.targetId || "");
    if (item.status === "already_clear") {
      return `<li data-end-follow-batch-skip="1" data-target-id="${id}">${name} 没有下次跟进，不清空</li>`;
    }
    const when = escapeHtml((item.nextFollowAt || "").trim() || "—");
    return `<li data-end-follow-batch-ready="1" data-target-id="${id}">${name} 下次跟进 ${when} 将清空</li>`;
  }).join("");
  const reason = (items || []).map((item) => (item.reason || "").trim()).find(Boolean) || "";
  const reasonHtml = reason
    ? `<p data-end-follow-batch-reason="1">原因 ${escapeHtml(reason)}</p>`
    : "";
  return `${reasonHtml}<ul data-end-follow-batch-preview-list="1">${rows}</ul>`;
}
