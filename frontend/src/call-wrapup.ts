/**
 * 通话详情里的通话小结。一次提交只处理这一通勾选的子项。
 * 没勾选的不放进正文。这里没有拨号按钮。
 */

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

function tagOptions(record: CallWrapupRecord, choices: CallTagChoice[]) {
  const applied = new Set((record.callTags || []).map((item) => item.id));
  const rows = new Map<string, { name: string; enabled: boolean }>();
  for (const item of choices) {
    if (!item.id) continue;
    rows.set(item.id, { name: item.name, enabled: item.enabled !== false });
  }
  for (const item of record.callTags || []) {
    if (!item.id || rows.has(item.id)) continue;
    rows.set(item.id, { name: item.name, enabled: item.enabled !== false });
  }
  const options = [...rows.entries()].map(([id, item]) => {
    const disabled = item.enabled ? "" : " disabled";
    const state = item.enabled ? "" : "（已停用）";
    const mark = applied.has(id) ? "（已打上）" : "";
    return `<option value="${escapeHtml(id)}"${disabled}>${escapeHtml(item.name)}${escapeHtml(mark)}${escapeHtml(state)}</option>`;
  });
  return `<option value="">请选择</option>${options.join("")}`;
}

export function renderCallWrapupForm(
  record: CallWrapupRecord,
  scriptChoices: CallScriptChoice[] = [],
  tagChoices: CallTagChoice[] = []
) {
  const callback = record.targetType && record.targetId
    ? `<fieldset data-wrapup-section="callback"><label><input type="checkbox" data-wrapup-include="callback">回拨预约</label><label>时间<input type="datetime-local" data-wrapup-callback-at value="${escapeHtml(toDateTimeLocal(record.callbackScheduledAt || ""))}"></label><label>备注<input data-wrapup-callback-note maxlength="${CALLBACK_NOTE_MAX}" value="${escapeHtml(record.callbackNote || "")}"></label><label><input type="checkbox" data-wrapup-callback-cancel>取消回拨</label></fieldset>`
    : `<p data-wrapup-callback-missing="1">这条通话没有关联对象，这次小结不能改回拨预约。</p>`;
  return `<form data-call-wrapup-form="1" data-record-id="${escapeHtml(record.id)}"><p data-call-wrapup-hint="1">勾选要一起保存的项。没勾选的保持原样。</p><fieldset data-wrapup-section="outcome"><label><input type="checkbox" data-wrapup-include="outcome">通话结果</label><label>通话结果<select data-wrapup-outcome>${outcomeOptions(record.callOutcome || "")}</select></label><label>备注<input data-wrapup-outcome-note maxlength="${CALL_OUTCOME_NOTE_MAX}" value="${escapeHtml(record.callOutcomeNote || "")}"></label></fieldset><fieldset data-wrapup-section="note"><label><input type="checkbox" data-wrapup-include="note">通话纪要</label><label>通话纪要<textarea data-wrapup-note maxlength="${CALL_NOTE_MAX}" rows="3">${escapeHtml(record.callNote || "")}</textarea></label><div data-wrapup-note-tags="1">${noteTagOptions(record.callNoteTags)}</div></fieldset><fieldset data-wrapup-section="script"><label><input type="checkbox" data-wrapup-include="script">所用话术</label><label>选用<select data-wrapup-script>${scriptOptions(record, scriptChoices)}</select></label></fieldset><fieldset data-wrapup-section="callTag"><label><input type="checkbox" data-wrapup-include="callTag">通话标签</label><label>操作<select data-wrapup-tag-action><option value="add">添加</option><option value="remove">去掉</option></select></label><label>标签<select data-wrapup-tag>${tagOptions(record, tagChoices)}</select></label></fieldset>${callback}<button class="btn" type="submit">提交通话小结</button></form>`;
}

export function renderCallWrapupPanel(
  record: CallWrapupRecord,
  scriptChoices: CallScriptChoice[] = [],
  tagChoices: CallTagChoice[] = []
) {
  return `<div class="outbound-record-outcome" data-call-wrapup-panel="1"><h3>通话小结</h3>${renderCallWrapupForm(record, scriptChoices, tagChoices)}</div>`;
}
