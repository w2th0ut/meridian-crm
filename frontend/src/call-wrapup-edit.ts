/**
 * 通话详情上的小结改正。窗口内、并且这个人能改正时才出现表单。
 * 已改正的通话显示标记和每次成功改正的前值后值。这里没有拨号按钮。
 */

import { CALL_NOTE_MAX } from "./call-note";
import { CALL_WRAPUP_TAG_LIMIT } from "./call-wrapup";
import type { CallTagChoice } from "./call-tag";

const CALL_OUTCOMES = ["有意向", "需回访", "无意向", "号码错误", "其他"] as const;
const CALL_OUTCOME_NOTE_MAX = 200;

export interface CallWrapupEditSnapshotView {
  note?: string;
  outcome?: string;
  outcomeNote?: string;
  tagIds?: string[];
  nextFollowAt?: string;
}

export interface CallWrapupEditHistoryEntry {
  id: string;
  at?: string;
  actorId?: string;
  before?: CallWrapupEditSnapshotView;
  after?: CallWrapupEditSnapshotView;
}

export interface CallWrapupEditView {
  submitted?: boolean;
  edited?: boolean;
  editable?: boolean;
  reason?: string;
  windowHours?: number;
  submittedAt?: string;
  editableUntil?: string;
  nextFollowAt?: string;
  history?: CallWrapupEditHistoryEntry[];
}

export interface CallWrapupEditRecord {
  id: string;
  callOutcome?: string;
  callOutcomeNote?: string;
  callNote?: string;
  callTags?: CallTagChoice[];
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

function outcomeOptions(selected: string) {
  const blank = `<option value="">请选择</option>`;
  const options = CALL_OUTCOMES.map((item) => {
    const picked = item === selected ? " selected" : "";
    return `<option value="${escapeHtml(item)}"${picked}>${escapeHtml(item)}</option>`;
  });
  return blank + options.join("");
}

function tagLists(record: CallWrapupEditRecord, choices: CallTagChoice[]) {
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

function historyItem(entry: CallWrapupEditHistoryEntry) {
  const before = entry.before || {};
  const after = entry.after || {};
  const id = escapeHtml(entry.id);
  const tags = (ids: string[] | undefined) => escapeHtml((ids || []).join(","));
  return `<li data-call-wrapup-edit-entry="${id}" data-call-wrapup-edit-actor="${escapeHtml(entry.actorId || "")}"><span data-call-wrapup-edit-at="${id}">${escapeHtml(entry.at || "")}</span><span data-call-wrapup-edit-before-note="${id}">${escapeHtml(before.note || "")}</span><span data-call-wrapup-edit-after-note="${id}">${escapeHtml(after.note || "")}</span><span data-call-wrapup-edit-before-outcome="${id}">${escapeHtml(before.outcome || "")}</span><span data-call-wrapup-edit-after-outcome="${id}">${escapeHtml(after.outcome || "")}</span><span data-call-wrapup-edit-before-outcome-note="${id}">${escapeHtml(before.outcomeNote || "")}</span><span data-call-wrapup-edit-after-outcome-note="${id}">${escapeHtml(after.outcomeNote || "")}</span><span data-call-wrapup-edit-before-tags="${id}">${tags(before.tagIds)}</span><span data-call-wrapup-edit-after-tags="${id}">${tags(after.tagIds)}</span><span data-call-wrapup-edit-before-follow="${id}">${escapeHtml(before.nextFollowAt || "")}</span><span data-call-wrapup-edit-after-follow="${id}">${escapeHtml(after.nextFollowAt || "")}</span></li>`;
}

function editForm(record: CallWrapupEditRecord, edit: CallWrapupEditView, choices: CallTagChoice[]) {
  const { addable, removable } = tagLists(record, choices);
  const adds = addable.length
    ? addable.map((item) => `<label><input type="checkbox" data-wrapup-edit-tag-add="${escapeHtml(item.id)}" value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</label>`).join("")
    : `<span data-wrapup-edit-tag-add-empty="1">没有可添加的启用标签</span>`;
  const removes = removable.length
    ? removable.map((item) => {
      const state = item.enabled ? "" : "（已停用）";
      return `<label><input type="checkbox" data-wrapup-edit-tag-remove="${escapeHtml(item.id)}" value="${escapeHtml(item.id)}">${escapeHtml(item.name)}${escapeHtml(state)}</label>`;
    }).join("")
    : `<span data-wrapup-edit-tag-remove-empty="1">这条通话还没有标签</span>`;
  return `<form data-call-wrapup-edit-form="1" data-record-id="${escapeHtml(record.id)}"><p data-call-wrapup-edit-hint="1">勾选要改正的项。没勾选的保持原样。窗口 ${escapeHtml(String(edit.windowHours ?? 24))} 小时。</p><fieldset data-wrapup-edit-section="note"><label><input type="checkbox" data-wrapup-edit-include="note">通话纪要</label><label>通话纪要<textarea data-wrapup-edit-note maxlength="${CALL_NOTE_MAX}" rows="3">${escapeHtml(record.callNote || "")}</textarea></label></fieldset><fieldset data-wrapup-edit-section="outcome"><label><input type="checkbox" data-wrapup-edit-include="outcome">通话结果</label><label>通话结果<select data-wrapup-edit-outcome>${outcomeOptions(record.callOutcome || "")}</select></label><label>备注<input data-wrapup-edit-outcome-note maxlength="${CALL_OUTCOME_NOTE_MAX}" value="${escapeHtml(record.callOutcomeNote || "")}"></label></fieldset><fieldset data-wrapup-edit-section="callTag"><label><input type="checkbox" data-wrapup-edit-include="callTag">通话标签</label><p data-wrapup-edit-tag-hint="1">一次最多 ${CALL_WRAPUP_TAG_LIMIT} 个。停用的不能新加，已经打上的可以去掉。</p><div data-wrapup-edit-tag-add-list="1">添加${adds}</div><div data-wrapup-edit-tag-remove-list="1">去掉${removes}</div></fieldset><fieldset data-wrapup-edit-section="nextFollowAt"><label><input type="checkbox" data-wrapup-edit-include="nextFollowAt">下次跟进</label><label>下次跟进<input type="datetime-local" data-wrapup-edit-follow-at value="${escapeHtml(toDateTimeLocal(edit.nextFollowAt || ""))}"></label><label><input type="checkbox" data-wrapup-edit-follow-clear>清除下次跟进</label></fieldset><button class="btn" type="submit">改正通话小结</button></form>`;
}

export function renderCallWrapupEdit(
  record: CallWrapupEditRecord,
  edit: CallWrapupEditView | null | undefined,
  choices: CallTagChoice[] = []
) {
  if (!edit?.submitted) return "";
  const marker = edit.edited ? `<p data-call-wrapup-edited="1">已改正</p>` : "";
  const history = edit.history?.length
    ? `<ol data-call-wrapup-edit-history="1">${edit.history.map(historyItem).join("")}</ol>`
    : `<p data-call-wrapup-edit-history-empty="1">还没有改正记录</p>`;
  let state = "";
  if (edit.editable) state = editForm(record, edit, choices);
  else if (edit.reason === "window_closed") state = `<p data-call-wrapup-edit-closed="1">已超过改正时间</p>`;
  else if (edit.reason === "not_owner") state = `<p data-call-wrapup-edit-forbidden="1">只有提交这条小结的人或主管可以改正</p>`;
  return `<div class="outbound-record-outcome" data-call-wrapup-edit-panel="1"><h3>改正通话小结</h3>${marker}${state}${history}</div>`;
}
