/**
 * 外呼通话记录页。统计只渲染接口返回的数字。
 * 没有记录时是空状态，不补 0。
 * 未接通的记录可以打开详情，生成一条下次跟进。没有拨号，也没有批量入口。
 */

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
}

export interface OutboundCallRecordDetail {
  record?: OutboundCallRecordRow;
  suggestedNextFollowAt?: string;
  suppressionNotice?: string;
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
  records?: OutboundCallRecordRow[];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function outboundCallRecordQuery(input: { agentId?: string; from?: string; to?: string }) {
  const params = new URLSearchParams();
  if (input.agentId) params.set("agentId", input.agentId);
  if (input.from) params.set("from", input.from);
  if (input.to) params.set("to", input.to);
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
  return `<div class="outbound-record-stats" data-outbound-record-stats="1"><div class="outbound-record-stat"><span>总拨打</span><b data-stat="total">${stats.totalCalls}</b></div><div class="outbound-record-stat"><span>接通</span><b data-stat="connected">${stats.connectedCalls}</b></div><div class="outbound-record-stat"><span>接通率</span><b data-stat="rate">${formatConnectRate(stats.connectRate)}</b></div><div class="outbound-record-stat"><span>平均时长</span><b data-stat="average">${formatAverageSeconds(stats.averageConnectedDurationSeconds)}</b></div></div>`;
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

function followUpButton(record: OutboundCallRecordRow) {
  if (record.established === true) return "—";
  return `<button class="btn" type="button" data-open-missed-follow="${escapeHtml(record.id)}">生成下次跟进</button>`;
}

export function renderOutboundCallRecordList(records: OutboundCallRecordRow[] | undefined) {
  if (!records?.length) return "";
  const rows = records.map((record) => {
    const established = record.established === true ? "是" : "否";
    return `<tr data-record-id="${escapeHtml(record.id)}"><td>${escapeHtml(record.localDate || "—")}</td><td>${escapeHtml(record.agentLabel || "—")}</td><td>${escapeHtml(record.maskedNumber || "—")}</td><td>${escapeHtml(record.contactDisposition || "—")}</td><td>${established}</td><td>${escapeHtml(record.callDurationRaw || "—")}</td><td>${escapeHtml(record.targetType || "—")}</td><td>${followUpButton(record)}</td></tr>`;
  }).join("");
  return `<div class="outbound-record-table-wrap"><table class="outbound-record-table"><thead><tr><th>当地日期</th><th>坐席</th><th>号码</th><th>话单结果</th><th>接通</th><th>时长原文</th><th>对象</th><th>下次跟进</th></tr></thead><tbody>${rows}</tbody></table></div>`;
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
  return `<section class="outbound-record-detail" data-call-detail="${escapeHtml(record.id)}"><h2>通话详情</h2><p>号码 ${escapeHtml(record.maskedNumber || "—")} · 话单结果 ${escapeHtml(record.contactDisposition || "—")} · 接通 ${established ? "是" : "否"}</p>${generated}${form}${notice}</section>`;
}
