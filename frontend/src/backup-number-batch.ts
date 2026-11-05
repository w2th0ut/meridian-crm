/** 工作台未接通待处理和待跟进名单上，勾选后预览并一次换成下一个有效备用号。这里不发起外呼。 */

export interface BackupNumberBatchView {
  customer: boolean;
  lead: boolean;
  prospect: boolean;
}

export interface BackupNumberPreviewItem {
  targetType?: string;
  targetId?: string;
  name?: string;
  status?: string;
  maskedCurrent?: string;
  maskedNext?: string;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function showBackupNumberBatch(view: BackupNumberBatchView | undefined) {
  return Boolean(view && (view.customer || view.lead || view.prospect));
}

export function backupNumberBatchPick(targetType: string, targetId: string, view: BackupNumberBatchView | undefined) {
  if (!view || !targetId) return "";
  if (targetType === "customer" && !view.customer) return "";
  if (targetType === "lead" && !view.lead) return "";
  if (targetType === "prospect" && !view.prospect) return "";
  if (targetType !== "customer" && targetType !== "lead" && targetType !== "prospect") return "";
  const value = `${targetType}:${targetId}`;
  return `<label><input type="checkbox" data-backup-number-batch-pick="1" value="${escapeHtml(value)}">换备用号</label>`;
}

export function backupNumberBatchForm(view: BackupNumberBatchView | undefined) {
  if (!showBackupNumberBatch(view)) return "";
  return `<form data-backup-number-batch="1"><label><input type="checkbox" data-backup-number-batch-all="1">全选这一页</label><button class="btn" type="button" data-backup-number-batch-preview="1">预览备用号</button><button class="btn" type="submit" data-backup-number-batch-submit="1" disabled>确认切换</button><div data-backup-number-batch-preview-box="1"></div><p data-backup-number-batch-hint="1">勾选最多 100 个。没有备用号的会列出来，并且不切换。不会拨出。</p></form>`;
}

export function backupNumberBatchFormFor(
  rows: Array<{ targetType?: string; targetId?: string }> | undefined,
  view: BackupNumberBatchView | undefined
) {
  const visible = (rows || []).some((row) => backupNumberBatchPick(row.targetType || "", row.targetId || "", view));
  if (!visible) return "";
  return backupNumberBatchForm(view);
}

export function backupNumberBatchBody(input: { targets: Array<{ targetType: string; targetId: string }> }) {
  return { targets: input.targets };
}

export function renderBackupNumberPreview(items: BackupNumberPreviewItem[] | undefined) {
  const rows = (items || []).map((item) => {
    const name = escapeHtml((item.name || item.targetId || "").trim() || "—");
    const id = escapeHtml(item.targetId || "");
    if (item.status === "no_backup") {
      return `<li data-backup-number-batch-skip="1" data-target-id="${id}">${name} 没有备用号，不切换</li>`;
    }
    const current = escapeHtml((item.maskedCurrent || "").trim() || "—");
    const next = escapeHtml((item.maskedNext || "").trim() || "—");
    return `<li data-backup-number-batch-ready="1" data-target-id="${id}">${name} ${current} → ${next}</li>`;
  }).join("");
  return `<ul data-backup-number-batch-preview-list="1">${rows}</ul>`;
}
