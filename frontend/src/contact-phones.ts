/**
 * 客户和线索的附加电话。一次只添加、修改或删除一个号码。
 * 拨打仍走一键外呼，这里的按钮不拨号。
 */

export const CONTACT_PHONE_LABELS = ["手机", "座机", "总机"] as const;
export type ContactPhoneLabel = (typeof CONTACT_PHONE_LABELS)[number];

export function contactPhoneChoiceLabel(label: string, phone: string) {
  const name = label.trim();
  const number = phone.trim();
  return name ? `${name} ${number}` : number;
}

export function contactPhoneCreateBody(input: {
  targetType: string;
  targetId: string;
  label: string;
  phone: string;
}) {
  return {
    targetType: input.targetType,
    targetId: input.targetId,
    label: input.label,
    phone: input.phone
  };
}

export function contactPhoneUpdateBody(input: {
  targetType: string;
  targetId: string;
  phoneId: string;
  label: string;
  phone: string;
}) {
  return {
    targetType: input.targetType,
    targetId: input.targetId,
    phoneId: input.phoneId,
    label: input.label,
    phone: input.phone
  };
}

export function contactPhoneDeleteBody(input: { targetType: string; targetId: string; phoneId: string }) {
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

function labelOptions(selected: string) {
  return CONTACT_PHONE_LABELS.map((label) => {
    const picked = label === selected ? " selected" : "";
    return `<option value="${escapeHtml(label)}"${picked}>${escapeHtml(label)}</option>`;
  }).join("");
}

/**
 * 只渲染附加号码的单条编辑。主号不在这里改。
 * 没有写权限时不显示添加、保存或删除。
 */
export function renderContactPhoneEditor(input: {
  targetType: string;
  targetId: string;
  extras: Array<{ phoneId: string; label: string; phone: string }>;
  canWrite: boolean;
}) {
  if (!input.canWrite) return "";
  const rows = input.extras.map((item) => `
    <div class="contact-phone-row" data-contact-phone-id="${escapeHtml(item.phoneId)}">
      <select data-contact-phone-label aria-label="号码标签">${labelOptions(item.label)}</select>
      <input data-contact-phone-number value="${escapeHtml(item.phone)}" autocomplete="off" aria-label="附加号码" />
      <button class="btn" type="button" data-contact-phone-save="1">保存</button>
      <button class="btn" type="button" data-contact-phone-delete="1">删除</button>
    </div>`).join("");
  return `<div class="contact-phone-editor" data-contact-phone-editor="1" data-contact-type="${escapeHtml(input.targetType)}" data-contact-id="${escapeHtml(input.targetId)}">
    <p class="contact-phone-note">附加号码一次只添加、保存或删除一个。主号仍在原来的电话栏，这里不能改主号。添加和保存都不会拨出。</p>
    ${rows}
    <div class="contact-phone-add">
      <select data-contact-phone-label aria-label="新号码标签">${labelOptions("手机")}</select>
      <input data-contact-phone-number placeholder="附加号码" autocomplete="off" aria-label="新附加号码" />
      <button class="btn" type="button" data-contact-phone-add="1">添加号码</button>
    </div>
  </div>`;
}
