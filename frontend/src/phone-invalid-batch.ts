/** 工作台未接通待处理和待跟进名单上，勾选后一次把当前外呼号码标为无效。这里不发起外呼。 */

export const PHONE_INVALID_BATCH_REASONS = [
  { value: "bad_number", label: "空号" },
  { value: "out_of_service", label: "停机" },
  { value: "wrong_number", label: "号码错误" }
] as const;

export interface PhoneInvalidBatchView {
  customer: boolean;
  lead: boolean;
  prospect: boolean;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function showPhoneInvalidBatch(view: PhoneInvalidBatchView | undefined) {
  return Boolean(view && (view.customer || view.lead || view.prospect));
}

export function phoneInvalidBatchPick(targetType: string, targetId: string, view: PhoneInvalidBatchView | undefined) {
  if (!view || !targetId) return "";
  if (targetType === "customer" && !view.customer) return "";
  if (targetType === "lead" && !view.lead) return "";
  if (targetType === "prospect" && !view.prospect) return "";
  if (targetType !== "customer" && targetType !== "lead" && targetType !== "prospect") return "";
  const value = `${targetType}:${targetId}`;
  return `<label><input type="checkbox" data-phone-invalid-batch-pick="1" value="${escapeHtml(value)}">标无效</label>`;
}

export function phoneInvalidBatchForm(view: PhoneInvalidBatchView | undefined) {
  if (!showPhoneInvalidBatch(view)) return "";
  const options = PHONE_INVALID_BATCH_REASONS.map((item) => `<option value="${item.value}">${item.label}</option>`).join("");
  return `<form data-phone-invalid-batch="1"><label><input type="checkbox" data-phone-invalid-batch-all="1">全选这一页</label><label>原因<select data-phone-invalid-batch-reason="1"><option value="">请选择原因</option>${options}</select></label><button class="btn" type="submit" data-phone-invalid-batch-submit="1">标号码无效</button><p data-phone-invalid-batch-hint="1">勾选最多 100 个，一次把当前号码标为无效。不会拨出。</p></form>`;
}

export function phoneInvalidBatchFormFor(
  rows: Array<{ targetType?: string; targetId?: string }> | undefined,
  view: PhoneInvalidBatchView | undefined
) {
  const visible = (rows || []).some((row) => phoneInvalidBatchPick(row.targetType || "", row.targetId || "", view));
  if (!visible) return "";
  return phoneInvalidBatchForm(view);
}

export function phoneInvalidBatchBody(input: {
  targets: Array<{ targetType: string; targetId: string }>;
  reason: string;
}) {
  return {
    targets: input.targets,
    reason: input.reason.trim()
  };
}
