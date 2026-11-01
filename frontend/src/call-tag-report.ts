/**
 * 通话标签使用统计。数字只渲染接口给的字段。接口没给的列不展示。
 * 停用标签单独成组，并置灰。
 */

export interface CallTagReportRow {
  tagId?: string;
  name?: string;
  enabled?: boolean;
  applyCount?: number;
  callCount?: number;
  customerCount?: number;
  leadCount?: number;
}

export interface CallTagReportMetrics {
  applyCount?: boolean;
  callCount?: boolean;
  customerCount?: boolean;
  leadCount?: boolean;
}

export interface CallTagReportResponse {
  filters?: { from?: string; to?: string; agentId?: string };
  agents?: Array<{ id?: string; label?: string }>;
  metrics?: CallTagReportMetrics;
  rows?: CallTagReportRow[];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function countCell(value: unknown) {
  return finite(value) ? String(value) : "—";
}

export function callTagReportQuery(input: { from?: string; to?: string; agentId?: string }) {
  const params = new URLSearchParams();
  if (input.from) params.set("from", input.from);
  if (input.to) params.set("to", input.to);
  if (input.agentId) params.set("agentId", input.agentId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function renderCallTagReportAgentOptions(agents: Array<{ id?: string; label?: string }> | undefined, selected: string) {
  const rows = [{ id: "", label: "全部" }, ...(agents || []).filter((item) => item.id)];
  return rows.map((item) => {
    const id = item.id || "";
    const current = id === selected ? " selected" : "";
    return `<option value="${escapeHtml(id)}"${current}>${escapeHtml(item.label || id || "全部")}</option>`;
  }).join("");
}

function metricCells(row: CallTagReportRow, metrics: CallTagReportMetrics) {
  return [
    metrics.applyCount === true ? `<td data-apply-count="1">${escapeHtml(countCell(row.applyCount))}</td>` : "",
    metrics.callCount === true ? `<td data-call-count="1">${escapeHtml(countCell(row.callCount))}</td>` : "",
    metrics.customerCount === true ? `<td data-customer-count="1">${escapeHtml(countCell(row.customerCount))}</td>` : "",
    metrics.leadCount === true ? `<td data-lead-count="1">${escapeHtml(countCell(row.leadCount))}</td>` : ""
  ].join("");
}

function columnCount(metrics: CallTagReportMetrics) {
  return 2
    + (metrics.applyCount === true ? 1 : 0)
    + (metrics.callCount === true ? 1 : 0)
    + (metrics.customerCount === true ? 1 : 0)
    + (metrics.leadCount === true ? 1 : 0);
}

export function renderCallTagReport(data: CallTagReportResponse | undefined) {
  const metrics = data?.metrics || {};
  const rows = data?.rows || [];
  if (!rows.length) return `<div class="empty-cell" data-call-tag-report-empty="1">这个范围内还没有通话标签。</div>`;
  const head = [
    "<th>标签</th><th>启用</th>",
    metrics.applyCount === true ? "<th>被打上的次数</th>" : "",
    metrics.callCount === true ? "<th>关联通话数</th>" : "",
    metrics.customerCount === true ? "<th>涉及客户数</th>" : "",
    metrics.leadCount === true ? "<th>涉及线索数</th>" : ""
  ].join("");
  const enabled = rows.filter((row) => row.enabled !== false);
  const disabled = rows.filter((row) => row.enabled === false);
  const bodyFor = (group: CallTagReportRow[], gray: boolean) => group.map((row) => {
    const key = row.tagId || "";
    const name = row.name || "";
    const state = row.enabled === false ? "已停用" : row.enabled === true ? "启用" : "—";
    const grayAttr = gray ? ` class="call-tag-report-disabled" data-call-tag-report-disabled="1"` : "";
    return `<tr data-call-tag-report-row="${escapeHtml(key)}"${grayAttr}><td>${escapeHtml(name)}</td><td>${escapeHtml(state)}</td>${metricCells(row, metrics)}</tr>`;
  }).join("");
  const disabledBody = disabled.length
    ? `<tbody data-call-tag-report-group="disabled"><tr data-call-tag-report-disabled-heading="1"><th colspan="${columnCount(metrics)}">已停用</th></tr>${bodyFor(disabled, true)}</tbody>`
    : "";
  return `<div class="call-tag-report-wrap" data-call-tag-report="1"><table class="call-tag-report-table"><thead><tr>${head}</tr></thead><tbody data-call-tag-report-group="enabled">${bodyFor(enabled, false)}</tbody>${disabledBody}</table></div>`;
}
