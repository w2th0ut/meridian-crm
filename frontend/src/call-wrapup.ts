/**
 * 通话详情里的通话小结。一次提交只处理这一通勾选的子项。
 * 通话标签可以一次勾选多个要添加的启用标签，以及要去掉的已有标签。
 * 没勾选的不放进正文。这里没有拨号按钮。
 */

export const CALL_WRAPUP_TAG_LIMIT = 10;

import { CALL_NOTE_MAX, CALL_NOTE_TAGS } from "./call-note";
import type { CallScriptChoice } from "./call-script-usage";
import type { CallTagChoice } from "./call-tag";

const CALL_OUTCOMES = ["有意向", "需回访", "无意向", "号码错误", "其他"] as const;
const CALL_OUTCOME_NOTE_MAX = 200;
const CALLBACK_NOTE_MAX = 200;

export interface CallWrapupRecord {
  id: string;
  targetType?: string;
  targetId?: string;
  callOutcome?: string;
  callOutcomeNote?: string;
  callNote?: string;
  callNoteTags?: string[];
  callScriptTemplateId?: string;
  callScriptTitle?: string;
  callScriptEnabled?: boolean;
  callTags?: CallTagChoice[];
  callbackScheduledAt?: string;
  callbackNote?: string;
}

export interface CallWrapupBodyInput {
  outcome?: { outcome: string; note: string } | null;
  note?: { note: string; tags: string[] } | null;
  script?: { templateId: string | null } | null;
  callTag?: { tagId: string; action: "add" | "remove" } | null;
  callTags?: Array<{ tagId: string; action: "add" | "remove" }> | null;
  callback?: { cancel: true } | { scheduledAt: string; note: string } | null;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toDateTimeLocal(value: string) {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return match ? `${match[1]}T${match[2]}` : "";
}

export function callWrapupBody(input: CallWrapupBodyInput) {
  const body: Record<string, unknown> = {};
  if (input.outcome) body.outcome = { outcome: input.outcome.outcome, note: input.outcome.note };
  if (input.note) body.note = { note: input.note.note, tags: input.note.tags };
  if (input.script) body.script = { templateId: input.script.templateId ? input.script.templateId : null };
  if (input.callTag) body.callTag = { tagId: input.callTag.tagId, action: input.callTag.action };
  if (input.callTags && input.callTags.length) {
    body.callTags = input.callTags.map((item) => ({ tagId: item.tagId, action: item.action }));
  }
  if (input.callback) body.callback = input.callback;
  return body;
}

function outcomeOptions(selected: string) {
  const blank = `<option value="">请选择</option>`;
  const options = CALL_OUTCOMES.map((item) => {
    const picked = item === selected ? " selected" : "";
    return `<option value="${escapeHtml(item)}"${picked}>${escapeHtml(item)}</option>`;
  });
  return blank + options.join("");
}

function noteTagOptions(selected: string[] | undefined) {
  const picked = new Set(selected || []);
  return CALL_NOTE_TAGS.map((tag) => {
    const checked = picked.has(tag) ? " checked" : "";
    return `<label><input type="checkbox" data-wrapup-note-tag value="${escapeHtml(tag)}"${checked}>${escapeHtml(tag)}</label>`;
  }).join("");
}

function scriptOptions(record: CallWrapupRecord, choices: CallScriptChoice[]) {
  const current = (record.callScriptTemplateId || "").trim();
  const rows: Array<{ id: string; label: string; disabled: boolean }> = [{ id: "", label: "未选用", disabled: false }];
  for (const item of choices) {
    if (!item.id || rows.some((row) => row.id === item.id)) continue;
    const disabled = item.selectable === false || item.enabled === false;
    const label = `${item.title || ""}${disabled ? "（已停用）" : ""}`;
    rows.push({ id: item.id, label, disabled });
  }
  if (current && !rows.some((row) => row.id === current)) {
    const title = record.callScriptTitle?.trim() || "（找不到话术）";
    rows.push({
      id: current,
      label: `${title}${record.callScriptEnabled === false ? "（已停用）" : ""}`,
      disabled: record.callScriptEnabled === false
    });
  }
  return rows.map((item) => {
    const picked = item.id === current ? " selected" : "";
    const blocked = item.disabled && item.id !== current ? " disabled" : "";
    return `<option value="${escapeHtml(item.id)}"${picked}${blocked}>${escapeHtml(item.label)}</option>`;
  }).join("");
}

function wrapupTagLists(record: CallWrapupRecord, choices: CallTagChoice[]) {
  const applied = new Map<string, { name: string; enabled: boolean }>();
  for (const item of record.callTags || []) {
    if (!item.id || applied.has(item.id)) continue;
    applied.set(item.id, { name: item.name || "", enabled: item.enabled !== false });
  }
  const addable: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();
  for (const item of choices) {
    if (!item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    if (applied.has(item.id)) {
      const current = applied.get(item.id)!;
      applied.set(item.id, { name: item.name || current.name, enabled: item.enabled !== false });
      continue;
    }
    if (item.enabled === false) continue;
    addable.push({ id: item.id, name: item.name || "" });
  }
  const byName = (left: { name: string }, right: { name: string }) => left.name.localeCompare(right.name, "zh");
  addable.sort(byName);
  const removable = [...applied.entries()]
    .map(([id, item]) => ({ id, name: item.name, enabled: item.enabled }))
    .sort(byName);
  return { addable, removable };
}

function tagChangeFields(record: CallWrapupRecord, choices: CallTagChoice[]) {
  const { addable, removable } = wrapupTagLists(record, choices);
  const adds = addable.length
    ? addable.map((item) => `<label><input type="checkbox" data-wrapup-tag-add="${escapeHtml(item.id)}" value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</label>`).join("")
    : `<span data-wrapup-tag-add-empty="1">没有可添加的启用标签</span>`;
  const removes = removable.length
    ? removable.map((item) => {
      const state = item.enabled ? "" : "（已停用）";
      return `<label><input type="checkbox" data-wrapup-tag-remove="${escapeHtml(item.id)}" value="${escapeHtml(item.id)}">${escapeHtml(item.name)}${escapeHtml(state)}</label>`;
    }).join("")
    : `<span data-wrapup-tag-remove-empty="1">这条通话还没有标签</span>`;
  return `<p data-wrapup-tag-hint="1">勾选要添加的启用标签，或要去掉的已有标签。一次最多 ${CALL_WRAPUP_TAG_LIMIT} 个。停用的不能新加，已经打上的可以去掉。</p><div data-wrapup-tag-add-list="1">添加${adds}</div><div data-wrapup-tag-remove-list="1">去掉${removes}</div>`;
}

export function renderCallWrapupForm(
  record: CallWrapupRecord,
  scriptChoices: CallScriptChoice[] = [],
  tagChoices: CallTagChoice[] = []
) {
  const callback = record.targetType && record.targetId
    ? `<fieldset data-wrapup-section="callback"><label><input type="checkbox" data-wrapup-include="callback">回拨预约</label><label>时间<input type="datetime-local" data-wrapup-callback-at value="${escapeHtml(toDateTimeLocal(record.callbackScheduledAt || ""))}"></label><label>备注<input data-wrapup-callback-note maxlength="${CALLBACK_NOTE_MAX}" value="${escapeHtml(record.callbackNote || "")}"></label><label><input type="checkbox" data-wrapup-callback-cancel>取消回拨</label></fieldset>`
    : `<p data-wrapup-callback-missing="1">这条通话没有关联对象，这次小结不能改回拨预约。</p>`;
  return `<form data-call-wrapup-form="1" data-record-id="${escapeHtml(record.id)}"><p data-call-wrapup-hint="1">勾选要一起保存的项。没勾选的保持原样。</p><fieldset data-wrapup-section="outcome"><label><input type="checkbox" data-wrapup-include="outcome">通话结果</label><label>通话结果<select data-wrapup-outcome>${outcomeOptions(record.callOutcome || "")}</select></label><label>备注<input data-wrapup-outcome-note maxlength="${CALL_OUTCOME_NOTE_MAX}" value="${escapeHtml(record.callOutcomeNote || "")}"></label></fieldset><fieldset data-wrapup-section="note"><label><input type="checkbox" data-wrapup-include="note">通话纪要</label><label>通话纪要<textarea data-wrapup-note maxlength="${CALL_NOTE_MAX}" rows="3">${escapeHtml(record.callNote || "")}</textarea></label><div data-wrapup-note-tags="1">${noteTagOptions(record.callNoteTags)}</div></fieldset><fieldset data-wrapup-section="script"><label><input type="checkbox" data-wrapup-include="script">所用话术</label><label>选用<select data-wrapup-script>${scriptOptions(record, scriptChoices)}</select></label></fieldset><fieldset data-wrapup-section="callTag"><label><input type="checkbox" data-wrapup-include="callTag">通话标签</label>${tagChangeFields(record, tagChoices)}</fieldset>${callback}<button class="btn" type="submit">提交通话小结</button></form>`;
}

export function renderCallWrapupPanel(
  record: CallWrapupRecord,
  scriptChoices: CallScriptChoice[] = [],
  tagChoices: CallTagChoice[] = []
) {
  return `<div class="outbound-record-outcome" data-call-wrapup-panel="1"><h3>通话小结</h3>${renderCallWrapupForm(record, scriptChoices, tagChoices)}</div>`;
}
