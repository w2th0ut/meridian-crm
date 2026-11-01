/**
 * 对象详情上的号码有效性。一次只标记或取消一个号码。
 * 不是抑制名单，也不改联系方式缺口。
 */

export interface PhoneValidityTarget {
  targetType: "customer" | "lead" | "prospect";
  targetId: string;
  phoneId: string;
}

export function phoneValidityButtonLabel(invalid: boolean) {
  return invalid ? "取消标记该号码无效" : "标记该号码无效";
}

export function phoneValidityRequest(input: PhoneValidityTarget & { invalid: boolean }) {
  return {
    targetType: input.targetType,
    targetId: input.targetId,
    phoneId: input.phoneId,
    invalid: input.invalid
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 没有写权限时，无效号码只留提示。有效号码不占位置。 */
export function renderPhoneValidityControl(input: PhoneValidityTarget & {
  invalid: boolean;
  canWrite: boolean;
  includeStatus?: boolean;
}) {
  const phoneId = input.phoneId.trim();
  const targetId = input.targetId.trim();
  if (!phoneId || !targetId) return "";
  const status = input.invalid && input.includeStatus !== false
    ? `<p class="phone-validity-status" data-phone-invalid="1">该号码已标记无效</p>`
    : "";
  if (!input.canWrite) return status;
  return `<button class="btn phone-validity-button" type="button" data-phone-validity="1" data-phone-validity-type="${escapeHtml(input.targetType)}" data-phone-validity-id="${escapeHtml(targetId)}" data-phone-validity-phone="${escapeHtml(phoneId)}" data-phone-validity-invalid="${input.invalid ? "1" : "0"}">${phoneValidityButtonLabel(input.invalid)}</button>${status}`;
}
