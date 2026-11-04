/**
 * 标无效之后，同一规范化号码若还在其他对象上，只提示数量。
 * 再点一次才把那些对象标无效。不拨号，也不自动提交。
 */

export function sameNumberInvalidRequest(input: { targetType: string; targetId: string; phoneId: string }) {
  return {
    targetType: input.targetType,
    targetId: input.targetId,
    phoneId: input.phoneId
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderSameNumberInvalidLink(input: {
  count: number;
  targetType: string;
  targetId: string;
  phoneId: string;
}) {
  const count = Number.isFinite(input.count) ? Math.floor(input.count) : 0;
  const targetType = input.targetType.trim();
  const targetId = input.targetId.trim();
  const phoneId = input.phoneId.trim();
  if (count < 1 || !targetId || !phoneId) return "";
  if (targetType !== "customer" && targetType !== "lead" && targetType !== "prospect") return "";
  return `<p data-same-number-invalid-note="1">另有 ${count} 个对象也用这个号码</p><button class="btn" type="button" data-same-number-invalid="1" data-same-number-type="${escapeHtml(targetType)}" data-same-number-id="${escapeHtml(targetId)}" data-same-number-phone="${escapeHtml(phoneId)}">把其他对象上的这个号码也标为无效</button><p data-same-number-invalid-hint="1">要再点这一下才会改。不会拨出，也不会自动拨打。</p>`;
}
