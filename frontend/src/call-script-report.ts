/**
 * 话术效果对比。数字只渲染接口给的字段。接口没给的列不展示，缺了的格子不写成 0。
 */

export interface CallScriptReportOutcomes {
  有意向?: number;
  需回访?: number;
  无意向?: number;
  号码错误?: number;
  其他?: number;
  未标注?: number;
}

export interface CallScriptReportRow {
  templateId?: string;
  title?: string;
  scenario?: string;
  scenarioLabel?: string;
  enabled?: boolean | null;
  linked?: boolean;
  callCount?: number;
  connectedCount?: number;
  outcomes?: CallScriptReportOutcomes;
  averageConnectedDurationSeconds?: number | null;
  callbackAppointmentCount?: number;
}

export interface CallScriptReportMetrics {
  callCount?: boolean;
  connectedCount?: boolean;
  outcomes?: boolean;
  averageConnectedDurationSeconds?: boolean;
  callbackAppointmentCount?: boolean;
}

export interface CallScriptReportResponse {
  filters?: { from?: string; to?: string; agentId?: string; scenario?: string };
  agents?: Array<{ id?: string; label?: string }>;
  metrics?: CallScriptReportMetrics;
  rows?: CallScriptReportRow[];
}

const OUTCOME_KEYS = ["有意向", "需回访", "无意向", "号码错误", "其他", "未标注"] as const;

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

export function formatCallScriptReportAverage(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} 秒`;
}

export function callScriptReportQuery(input: { from?: string; to?: string; agentId?: string; scenario?: string }) {
  const params = new URLSearchParams();
  if (input.from) params.set("from", input.from);
  if (input.to) params.set("to", input.to);
  if (input.agentId) params.set("agentId", input.agentId);
  if (input.scenario) params.set("scenario", input.scenario);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function renderCallScriptReportAgentOptions(agents: Array<{ id?: string; label?: string }> | undefined, selected: string) {
  const rows = [{ id: "", label: "全部" }, ...(agents || []).filter((item) => item.id)];
  return rows.map((item) => {
    const id = item.id || "";
    const current = id === selected ? " selected" : "";
    return `<option value="${escapeHtml(id)}"${current}>${escapeHtml(item.label || id || "全部")}</option>`;
  }).join("");
}

export function renderCallScriptReport(data: CallScriptReportResponse | undefined) {
  const metrics = data?.metrics || {};
  const rows = data?.rows || [];
  if (!rows.length) return `<div class="empty-cell" data-call-script-report-empty="1">这个范围内还没有话术。</div>`;
  const outcomeHeaders = metrics.outcomes === true
    ? OUTCOME_KEYS.map((key) => `<th>${escapeHtml(key)}</th>`).join("")
    : "";
  const head = [
    "<th>话术</th><th>场景</th><th>启用</th>",
    metrics.callCount === true ? "<th>通话数</th>" : "",
    metrics.connectedCount === true ? "<th>接通数</th>" : "",
    outcomeHeaders,
    metrics.averageConnectedDurationSeconds === true ? "<th>平均通话时长</th>" : "",
    metrics.callbackAppointmentCount === true ? "<th>回拨预约数</th>" : ""
  ].join("");
  const body = rows.map((row) => {
    const key = row.linked === false ? "none" : (row.templateId || "");
    const title = row.title || (row.linked === false ? "未选用" : "");
    const enabled = row.linked === false ? "—" : row.enabled === false ? "已停用" : row.enabled === true ? "启用" : "—";
    const outcomes = metrics.outcomes === true
      ? OUTCOME_KEYS.map((name) => {
        const value = row.outcomes?.[name];
        return `<td data-outcome="${escapeHtml(name)}">${escapeHtml(countCell(value))}</td>`;
      }).join("")
      : "";
    const average = formatCallScriptReportAverage(row.averageConnectedDurationSeconds);
    return `<tr data-call-script-report-row="${escapeHtml(key)}"><td>${escapeHtml(title)}</td><td>${escapeHtml(row.scenarioLabel || "")}</td><td>${escapeHtml(enabled)}</td>${metrics.callCount === true ? `<td data-call-count="1">${escapeHtml(countCell(row.callCount))}</td>` : ""}${metrics.connectedCount === true ? `<td data-connected-count="1">${escapeHtml(countCell(row.connectedCount))}</td>` : ""}${outcomes}${metrics.averageConnectedDurationSeconds === true ? `<td data-average="1">${escapeHtml(average)}</td>` : ""}${metrics.callbackAppointmentCount === true ? `<td data-callback-count="1">${escapeHtml(countCell(row.callbackAppointmentCount))}</td>` : ""}</tr>`;
  }).join("");
  return `<div class="call-script-report-wrap" data-call-script-report="1"><table class="call-script-report-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
