import { renderCallbackScheduleForm } from "./callback-schedule";
import { renderCallNoteForm } from "./call-note";
import { renderCallWrapupPanel } from "./call-wrapup";
import { renderCallTagChips, renderCallTagPanel, type CallTagChoice } from "./call-tag";
import { renderCallScriptUsageForm, type CallScriptChoice } from "./call-script-usage";

/**
 * 外呼通话记录页。统计只渲染接口返回的数字。
 * 没有记录时是空状态，不补 0。
 * 未接通的记录可以打开详情，生成一条下次跟进。
 * 列表和详情都可以给单条记录标注通话结果。没有拨号，也没有批量入口。
 */

export const CALL_OUTCOMES = ["有意向", "需回访", "无意向", "号码错误", "其他"] as const;
export const CALL_OUTCOME_NOTE_MAX = 200;

export interface OutboundCallRecordStats {
  totalCalls: number;
  connectedCalls: number;
  connectRate: number | null;
  averageConnectedDurationSeconds: number | null;
}

export interface OutboundCallRecordRow {
  id: string;
  maskedNumber?: string;
  contactDisposition?: string;
  established?: boolean;
  callDurationRaw?: string;
  agentLabel?: string;
  localDate?: string | null;
  targetType?: string;
  targetId?: string;
  followUpGenerated?: boolean;
  callOutcome?: string;
  callOutcomeNote?: string;
  phoneId?: string;
  phoneInvalid?: boolean;
  callbackScheduledAt?: string;
  callbackNote?: string;
  callbackDue?: string;
  callNote?: string;
  callNoteTags?: string[];
  callNoteUpdatedAt?: string;
  callScriptTemplateId?: string;
  callScriptTitle?: string;
  callScriptEnabled?: boolean;
  callTags?: CallTagChoice[];
}

export interface OutboundCallRecordDetail {
  record?: OutboundCallRecordRow;
  suggestedNextFollowAt?: string;
  suppressionNotice?: string;
  scriptChoices?: CallScriptChoice[];
  tagChoices?: CallTagChoice[];
  followUp?: { activityId?: string; nextFollowAt?: string; suppressed?: boolean } | null;
}

export interface OutboundCallRecordAgentOption {
  cccUserId: string;
  label: string;
}

export interface OutboundCallRecordListResponse {
  scope?: "self" | "team";
  timeZone?: string;
  agents?: OutboundCallRecordAgentOption[];
  empty?: boolean;
  stats?: OutboundCallRecordStats | null;
  outcomeCounts?: Partial<Record<string, number>> | null;
  filters?: { outcome?: string | null };
  records?: OutboundCallRecordRow[];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function outboundCallRecordQuery(input: { agentId?: string; from?: string; to?: string; outcome?: string; note?: string; script?: string; tag?: string; plaintext?: string; targetType?: string; targetId?: string }) {
  const params = new URLSearchParams();
  if (input.agentId) params.set("agentId", input.agentId);
  if (input.from) params.set("from", input.from);
  if (input.to) params.set("to", input.to);
  if (input.outcome) params.set("outcome", input.outcome);
  if (input.note) params.set("note", input.note);
  if (input.script) params.set("script", input.script);
  if (input.tag) params.set("tag", input.tag);
  if (input.targetType && input.targetId) {
    params.set("targetType", input.targetType);
    params.set("targetId", input.targetId);
  }
  if (input.plaintext === "1") params.set("plaintext", "1");
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function formatConnectRate(rate: number | null | undefined) {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "—";
  const pct = Math.round(rate * 1000) / 10;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

export function formatAverageSeconds(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} 秒` : `${rounded.toFixed(1)} 秒`;
}

export function renderOutboundCallAgentOptions(input: {
  scope?: "self" | "team";
  agents?: OutboundCallRecordAgentOption[];
  selected?: string;
}) {
  const agents = input.agents || [];
  const selected = input.selected || "";
  const options = input.scope === "team"
    ? [{ cccUserId: "", label: "全部" }, ...agents]
    : agents.length
      ? agents
      : [{ cccUserId: "", label: "没有对应坐席" }];
  return options.map((item) => {
    const current = item.cccUserId === selected ? " selected" : "";
    return `<option value="${escapeHtml(item.cccUserId)}"${current}>${escapeHtml(item.label || item.cccUserId)}</option>`;
  }).join("");
}

export function renderOutboundCallRecordSummary(input: OutboundCallRecordListResponse) {
  if (input.empty || !input.stats) {
    return `<p data-outbound-record-empty="1">这个范围内还没有通话记录。</p>`;
  }
  const stats = input.stats;
  return `<div class="outbound-record-stats" data-outbound-record-stats="1"><div class="outbound-record-stat"><span>总拨打</span><b data-stat="total">${stats.totalCalls}</b></div><div class="outbound-record-stat"><span>接通</span><b data-stat="connected">${stats.connectedCalls}</b></div><div class="outbound-record-stat"><span>接通率</span><b data-stat="rate">${formatConnectRate(stats.connectRate)}</b></div><div class="outbound-record-stat"><span>平均时长</span><b data-stat="average">${formatAverageSeconds(stats.averageConnectedDurationSeconds)}</b></div></div>${renderOutboundCallOutcomeCounts(input.outcomeCounts)}`;
}

export function renderOutboundCallOutcomeCounts(counts: Partial<Record<string, number>> | null | undefined) {
  if (!counts) return "";
  const rows = CALL_OUTCOMES.flatMap((item) => {
    const value = counts[item];
    if (typeof value !== "number" || !Number.isFinite(value)) return [];
    return [`<div class="outbound-record-stat"><span>${escapeHtml(item)}</span><b data-outcome="${escapeHtml(item)}">${value}</b></div>`];
  });
  if (!rows.length) return "";
  return `<div class="outbound-record-outcome-counts" data-outcome-counts="1">${rows.join("")}</div>`;
}

export function renderCallOutcomeOptions(selected: string) {
  const current = selected || "";
  const blank = `<option value="">请选择</option>`;
  const options = CALL_OUTCOMES.map((item) => {
    const picked = item === current ? " selected" : "";
    return `<option value="${escapeHtml(item)}"${picked}>${escapeHtml(item)}</option>`;
  });
  return blank + options.join("");
}

export function renderCallOutcomeForm(record: { id: string; callOutcome?: string; callOutcomeNote?: string }) {
  return `<form class="outbound-record-outcome-form" data-call-outcome-form="1" data-record-id="${escapeHtml(record.id)}"><label>通话结果<select data-call-outcome>${renderCallOutcomeOptions(record.callOutcome || "")}</select></label><label>备注<input data-call-outcome-note maxlength="${CALL_OUTCOME_NOTE_MAX}" value="${escapeHtml(record.callOutcomeNote || "")}"></label><button class="btn" type="submit">保存标注</button></form>`;
}

/** 只在这一条被标成号码错误、并且对得上现在的号码时出现。已经无效就只提示，不在这里取消。 */
export function renderMarkPhoneInvalid(record: { id: string; callOutcome?: string; phoneId?: string; phoneInvalid?: boolean }) {
  if (record.callOutcome !== "号码错误" || !(record.phoneId || "").trim()) return "";
  if (record.phoneInvalid) {
    return `<p class="phone-validity-status" data-phone-invalid="1">该号码已标记无效</p>`;
  }
  return `<button class="btn" type="button" data-mark-phone-invalid="${escapeHtml(record.id)}">标记该号码无效</button>`;
}

export function renderOutboundCallOutcomeFilterEmpty() {
  return `<p data-outcome-filter-empty="1">这个标注结果下还没有通话。</p>`;
}

export function renderOutboundCallScriptFilterEmpty() {
  return `<p data-script-filter-empty="1">这个话术下还没有通话。</p>`;
}

export function renderOutboundCallTagFilterEmpty() {
  return `<p data-tag-filter-empty="1">这个标签下还没有通话。</p>`;
}

export function renderOutboundCallTagOptions(
  tags: Array<{ id: string; name?: string; enabled?: boolean }> | undefined,
  selected: string
) {
  const rows: Array<{ id: string; title: string }> = [{ id: "", title: "全部" }, { id: "none", title: "无标签" }];
  for (const item of tags || []) {
    if (!item.id || item.id === "none" || rows.some((row) => row.id === item.id)) continue;
    const name = item.name?.trim() || "（找不到标签）";
    rows.push({ id: item.id, title: item.enabled === false ? `${name}（已停用）` : name });
  }
  if (selected && !rows.some((row) => row.id === selected)) {
    rows.push({ id: selected, title: "（找不到标签）" });
  }
  return rows.map((item) => {
    const current = item.id === selected ? " selected" : "";
    return `<option value="${escapeHtml(item.id)}"${current}>${escapeHtml(item.title)}</option>`;
  }).join("");
}

export function renderOutboundCallScriptOptions(
  scripts: Array<{ id: string; title?: string }> | undefined,
  selected: string
) {
  const rows = [{ id: "", title: "全部" }, { id: "none", title: "未选用" }];
  for (const item of scripts || []) {
    if (!item.id || item.id === "none" || rows.some((row) => row.id === item.id)) continue;
    rows.push({ id: item.id, title: item.title?.trim() || "（找不到话术）" });
  }
  if (selected && !rows.some((row) => row.id === selected)) {
    rows.push({ id: selected, title: "（找不到话术）" });
  }
  return rows.map((item) => {
    const current = item.id === selected ? " selected" : "";
    return `<option value="${escapeHtml(item.id)}"${current}>${escapeHtml(item.title)}</option>`;
  }).join("");
}

function scriptListLabel(record: OutboundCallRecordRow) {
  if (record.callScriptTitle?.trim()) return record.callScriptTitle.trim();
  if (record.callScriptTemplateId) return "";
  return "未选用";
}

export function renderOutboundCallRecordFailure(message: string) {
  const text = message.trim() || "通话记录没有加载";
  return `<p data-outbound-record-empty="1">${escapeHtml(text)}</p>`;
}

export function toDateTimeLocal(value: string) {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return match ? `${match[1]}T${match[2]}` : "";
}

export function fromDateTimeLocal(value: string) {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}` : "";
}

function callbackForm(record: OutboundCallRecordRow) {
  if (!record.targetType || !record.targetId) return "";
  return renderCallbackScheduleForm({
    recordId: record.id,
    targetType: record.targetType,
    targetId: record.targetId,
    scheduledAt: record.callbackScheduledAt || "",
    note: record.callbackNote || "",
    due: record.callbackDue || ""
  });
}

function followUpButton(record: OutboundCallRecordRow) {
  if (record.established === true) return "—";
  return `<button class="btn" type="button" data-open-missed-follow="${escapeHtml(record.id)}">生成下次跟进</button>`;
}

export function renderOutboundCallRecordList(records: OutboundCallRecordRow[] | undefined) {
  if (!records?.length) return "";
  const rows = records.map((record) => {
    const established = record.established === true ? "是" : "否";
    return `<tr data-record-id="${escapeHtml(record.id)}"><td>${escapeHtml(record.localDate || "—")}</td><td>${escapeHtml(record.agentLabel || "—")}</td><td>${escapeHtml(record.maskedNumber || "—")}</td><td>${escapeHtml(record.contactDisposition || "—")}</td><td>${established}</td><td>${escapeHtml(record.callDurationRaw || "—")}</td><td>${escapeHtml(record.targetType || "—")}</td><td class="outbound-record-outcome-cell">${renderCallOutcomeForm(record)}${renderMarkPhoneInvalid(record)}${callbackForm(record)}</td><td class="outbound-record-note-cell">${renderCallNoteForm(record)}</td><td data-call-script-usage-label="${escapeHtml(record.id)}">${escapeHtml(scriptListLabel(record))}</td><td class="outbound-record-tags" data-call-tag-cell="${escapeHtml(record.id)}">${renderCallTagChips(record.callTags)}</td><td>${followUpButton(record)}</td></tr>`;
  }).join("");
  return `<div class="outbound-record-table-wrap"><table class="outbound-record-table"><thead><tr><th>当地日期</th><th>坐席</th><th>号码</th><th>话单结果</th><th>接通</th><th>时长原文</th><th>对象</th><th>通话结果</th><th>通话纪要</th><th>所用话术</th><th>通话标签</th><th>下次跟进</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderOutboundCallRecordDetail(input: OutboundCallRecordDetail) {
  const record = input.record;
  if (!record?.id) return `<p data-outbound-record-empty="1">通话记录不存在。</p>`;
  const established = record.established === true;
  const saved = input.followUp?.nextFollowAt || "";
  const suggested = saved || input.suggestedNextFollowAt || "";
  const notice = !established && input.suppressionNotice
    ? `<p class="outbound-record-follow-notice" data-follow-up-notice="1">${escapeHtml(input.suppressionNotice)}</p>`
    : "";
  const generated = saved
    ? `<p data-follow-up-existing="1">这条通话已经生成过下次跟进，时间是 ${escapeHtml(saved)}。再次确认不会改时间，也不会再写一条。</p>`
    : "";
  const form = established
    ? `<p data-follow-up-established="1">这通已经接通，不能从这里生成下次跟进。</p>`
    : `<form data-missed-follow-form="1"><label>下次跟进<input type="datetime-local" data-missed-follow-at value="${escapeHtml(toDateTimeLocal(suggested))}"${saved ? " disabled" : ""}></label><button class="btn" type="submit" data-generate-missed-follow="1">生成下次跟进</button></form>`;
  const wrapup = renderCallWrapupPanel(record, input.scriptChoices || [], input.tagChoices || []);
  const outcome = `<div class="outbound-record-outcome" data-call-outcome-panel="1"><h3>通话结果</h3>${renderCallOutcomeForm(record)}${renderMarkPhoneInvalid(record)}</div>`;
  const note = `<div class="outbound-record-outcome" data-call-note-panel="1"><h3>通话纪要</h3>${renderCallNoteForm(record)}</div>`;
  const script = `<div class="outbound-record-outcome" data-call-script-usage-panel="1"><h3>所用话术</h3>${renderCallScriptUsageForm(record, input.scriptChoices || [])}</div>`;
  const tags = renderCallTagPanel(record, input.tagChoices || []);
  const callback = `<div class="outbound-record-outcome" data-callback-schedule-panel="1"><h3>回拨预约</h3>${callbackForm(record) || `<p data-callback-schedule-missing="1">这条通话没有关联对象，不能设置回拨预约。</p>`}</div>`;
  return `<section class="outbound-record-detail" data-call-detail="${escapeHtml(record.id)}"><h2>通话详情</h2><p>号码 ${escapeHtml(record.maskedNumber || "—")} · 话单结果 ${escapeHtml(record.contactDisposition || "—")} · 接通 ${established ? "是" : "否"}</p>${wrapup}${outcome}${note}${script}${tags}${callback}${generated}${form}${notice}</section>`;
}
