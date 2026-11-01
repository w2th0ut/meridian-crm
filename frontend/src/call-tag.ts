/**
 * 通话自定义标签。管理员单条新增、重命名或停用。
 * 详情里单条添加或去掉启用中的标签。已停用但仍打着的只展示，置灰，不能去掉。
 */

export interface CallTagChoice {
  id: string;
  name: string;
  enabled?: boolean;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function callTagCreateBody(name: string) {
  return { name: name.trim() };
}

export function callTagRenameBody(id: string, name: string) {
  return { id, name: name.trim() };
}

export function callTagDisableBody(id: string) {
  return { id };
}

export function callTagAssignBody(tagId: string) {
  return { tagId };
}

export function renderCallTagChips(tags: CallTagChoice[] | undefined, options?: { removable?: boolean }) {
  const rows = tags || [];
  if (!rows.length) return `<span data-call-tag-empty="1">无标签</span>`;
  return rows.map((tag) => {
    const disabled = tag.enabled === false;
    const state = disabled ? " is-disabled" : "";
    const flag = disabled ? "1" : "0";
    const remove = options?.removable && !disabled
      ? `<button class="btn" type="button" data-call-tag-remove="${escapeHtml(tag.id)}">去掉</button>`
      : "";
    return `<span class="call-tag-chip${state}" data-call-tag="${escapeHtml(tag.id)}" data-call-tag-disabled="${flag}">${escapeHtml(tag.name)}${remove}</span>`;
  }).join("");
}

export function renderCallTagPanel(
  record: { id: string; callTags?: CallTagChoice[] },
  choices: CallTagChoice[]
) {
  const applied = record.callTags || [];
  const taken = new Set(applied.map((item) => item.id));
  const options = choices
    .filter((item) => item.id && item.enabled !== false && !taken.has(item.id))
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)
    .join("");
  return `<div class="outbound-record-outcome" data-call-tag-panel="1"><h3>通话标签</h3><div data-call-tag-applied="1">${renderCallTagChips(applied, { removable: true })}</div><form data-call-tag-add-form="1" data-record-id="${escapeHtml(record.id)}"><label>添加<select data-call-tag-add><option value="">请选择</option>${options}</select></label><button class="btn" type="submit">添加标签</button></form></div>`;
}

export function renderCallTagAdmin(tags: CallTagChoice[] | undefined, canManage: boolean) {
  if (!canManage) return "";
  const rows = (tags || []).map((tag) => {
    const disabled = tag.enabled === false;
    const state = disabled ? "已停用" : "启用";
    const disable = disabled
      ? ""
      : `<button class="btn" type="button" data-call-tag-disable="${escapeHtml(tag.id)}">停用</button>`;
    return `<p class="call-tag-manage-row${disabled ? " is-disabled" : ""}" data-call-tag-row="${escapeHtml(tag.id)}" data-call-tag-enabled="${disabled ? "0" : "1"}"><input data-call-tag-rename-name="${escapeHtml(tag.id)}" value="${escapeHtml(tag.name)}" maxlength="40" autocomplete="off"><span>${state}</span><button class="btn" type="button" data-call-tag-rename="${escapeHtml(tag.id)}">重命名</button>${disable}</p>`;
  }).join("");
  const empty = rows ? "" : `<p data-call-tag-admin-empty="1">还没有通话标签。</p>`;
  return `<section data-call-tag-admin="1"><h2>通话标签</h2><form data-call-tag-create="1"><label>名称<input data-call-tag-name maxlength="40" autocomplete="off"></label><button class="btn" type="submit">新增</button></form>${empty}${rows}</section>`;
}
