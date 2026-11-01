/**
 * 首选拨打号码。只决定一键外呼入口默认选中哪一个号码。
 * 改选和设置都不拨号。拨打仍要点外呼，并走服务端原来的门禁。
 */

export interface PreferredPhoneChoice {
  phoneId: string;
  label: string;
  invalid: boolean;
}

export function selectPreferredPhoneId(
  phoneIds: readonly string[],
  preferredPhoneId: string,
  invalidPhoneIds: ReadonlySet<string> | readonly string[]
) {
  const ids = phoneIds.map((item) => item.trim()).filter(Boolean);
  const invalid = invalidPhoneIds instanceof Set ? invalidPhoneIds : new Set(invalidPhoneIds);
  const preferred = preferredPhoneId.trim();
  if (preferred && ids.includes(preferred) && !invalid.has(preferred)) return preferred;
  return ids.find((item) => !invalid.has(item)) || ids[0] || "";
}

export function preferredChooserActions(input: {
  selectedPhoneId: string;
  preferredPhoneId: string;
  selectedInvalid: boolean;
  canWrite: boolean;
}) {
  const preferred = input.preferredPhoneId.trim();
  const selected = input.selectedPhoneId.trim();
  return {
    saveLabel: preferred ? "更换首选" : "设为首选",
    showSave: input.canWrite && !input.selectedInvalid && selected.length > 0 && selected !== preferred,
    showClear: input.canWrite && preferred.length > 0
  };
}

export function preferredPhoneSetBody(input: { targetType: string; targetId: string; phoneId: string }) {
  return {
    targetType: input.targetType,
    targetId: input.targetId,
    phoneId: input.phoneId
  };
}

export function preferredPhoneClearBody(input: { targetType: string; targetId: string }) {
  return {
    targetType: input.targetType,
    targetId: input.targetId
  };
}

export function preferredPhoneListMark(active: boolean) {
  return active ? `<span class="preferred-phone-mark" data-preferred-phone="1">首选</span>` : "";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 多个号码时用下拉预选首选。只有一个号码时直接显示这个号码。
 * 拨号按钮由调用方按当前选中的号码传入，改选本身不发外呼。
 */
export function renderPreferredPhoneChooser(input: {
  targetType: string;
  targetId: string;
  phones: PreferredPhoneChoice[];
  preferredPhoneId: string;
  canWrite: boolean;
  dialButtonHtml: string;
  validityHtml: string;
  invalidHintHtml: string;
}) {
  const phones = input.phones.filter((item) => item.phoneId.trim() && item.label.trim());
  if (!phones.length) return "";
  const invalid = new Set(phones.filter((item) => item.invalid).map((item) => item.phoneId));
  const preferredPhoneId = input.preferredPhoneId.trim();
  const selectedId = selectPreferredPhoneId(phones.map((item) => item.phoneId), preferredPhoneId, invalid);
  const selected = phones.find((item) => item.phoneId === selectedId) || phones[0];
  const actions = preferredChooserActions({
    selectedPhoneId: selected.phoneId,
    preferredPhoneId,
    selectedInvalid: selected.invalid,
    canWrite: input.canWrite
  });
  const multiple = phones.length > 1;
  const options = phones.map((item) => {
    const preferred = item.phoneId === preferredPhoneId;
    const selectedAttr = item.phoneId === selected.phoneId ? " selected" : "";
    const preferredAttr = preferred ? ` data-preferred-option="1"` : "";
    const label = `${item.label}${preferred ? " 首选" : ""}${item.invalid ? " 无效" : ""}`;
    return `<option value="${escapeHtml(item.phoneId)}"${selectedAttr}${preferredAttr}>${escapeHtml(label)}</option>`;
  }).join("");
  const picker = multiple
    ? `<label class="preferred-phone-picker">拨打号码<select data-preferred-phone-select>${options}</select></label><small data-preferred-manual="1">改选不会拨出，拨打仍需点击外呼</small>`
    : `<b data-preferred-phone-number="1">${escapeHtml(selected.label)}</b>`;
  const mark = selected.phoneId === preferredPhoneId && preferredPhoneId
    ? `<span class="preferred-phone-mark" data-preferred-phone="1">首选</span>`
    : `<span class="preferred-phone-mark" data-preferred-phone="1" hidden>首选</span>`;
  const save = input.canWrite
    ? `<button class="btn preferred-phone-button" type="button" data-preferred-phone-save="1"${actions.showSave ? "" : " hidden"}>${escapeHtml(actions.saveLabel)}</button>`
    : "";
  const clear = input.canWrite
    ? `<button class="btn preferred-phone-button" type="button" data-preferred-phone-clear="1"${actions.showClear ? "" : " hidden"}>清除首选</button>`
    : "";
  return `<div class="outbound-call-line preferred-phone-chooser" data-preferred-phone-chooser="1" data-preferred-type="${escapeHtml(input.targetType)}" data-preferred-id="${escapeHtml(input.targetId)}" data-preferred-current="${escapeHtml(preferredPhoneId)}">${picker}${mark}${input.dialButtonHtml}${save}${clear}<span data-preferred-validity>${input.validityHtml}</span>${input.invalidHintHtml}<p class="outbound-call-status" data-outbound-status role="status" hidden></p></div>`;
}
