/**
 * 通话小结改正报表。次数和前值后值只渲染接口给的字段。
 * 接口没给改正次数时，不把次数画成 0。
 */

export interface CallWrapupEditReportSnapshot {
  note?: string;
  outcome?: string;
  outcomeNote?: string;
  tagIds?: string[];
  nextFollowAt?: string;
}

export interface CallWrapupEditReportRow {
  id?: string;
  at?: string;
  callRecordId?: string;
  actorId?: string;
  actorLabel?: string;
  agentIds?: string[];
  agentLabel?: string;
  changedFields?: string[];
  before?: CallWrapupEditReportSnapshot;
  after?: CallWrapupEditReportSnapshot;
}

export interface CallWrapupEditReportCount {
  agentId?: string;
  label?: string;
  correctionCount?: number;
}

export interface CallWrapupEditReportMetrics {
  correctionCount?: boolean;
}

export interface CallWrapupEditReportResponse {
  filters?: { from?: string; to?: string; agentId?: string; field?: string };
  agents?: Array<{ id?: string; label?: string }>;
  metrics?: CallWrapupEditReportMetrics;
  rowCount?: number;
  counts?: CallWrapupEditReportCount[];
  rows?: CallWrapupEditReportRow[];
}

const FIELD_LABELS: Record<string, string> = {
  note: "纪要正文",
  outcome: "通话结果",
  outcomeNote: "结果备注",
  tagIds: "通话标签",
  nextFollowAt: "下次跟进"
};

const SNAPSHOT_FIELDS = ["note", "outcome", "outcomeNote", "tagIds", "nextFollowAt"] as const;

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

export function callWrapupEditReportQuery(input: { from?: string; to?: string; agentId?: string; field?: string }) {
  const params = new URLSearchParams();
  if (input.from) params.set("from", input.from);
  if (input.to) params.set("to", input.to);
  if (input.agentId) params.set("agentId", input.agentId);
  if (input.field) params.set("field", input.field);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function renderCallWrapupEditReportAgentOptions(agents: Array<{ id?: string; label?: string }> | undefined, selected: string) {
  const rows = [{ id: "", label: "全部" }, ...(agents || []).filter((item) => item.id)];
  return rows.map((item) => {
    const id = item.id || "";
    const current = id === selected ? " selected" : "";
    return `<option value="${escapeHtml(id)}"${current}>${escapeHtml(item.label || id || "全部")}</option>`;
  }).join("");
}

function fieldText(snapshot: CallWrapupEditReportSnapshot | undefined, field: (typeof SNAPSHOT_FIELDS)[number]) {
  if (!snapshot) return "空";
  if (field === "tagIds") {
    const ids = Array.isArray(snapshot.tagIds) ? snapshot.tagIds.filter((item) => typeof item === "string") : [];
    return ids.length ? ids.join("、") : "空";
  }
  const value = snapshot[field];
  return typeof value === "string" && value ? value : "空";
}

function snapshotCells(row: CallWrapupEditReportRow, side: "before" | "after") {
  const snapshot = side === "before" ? row.before : row.after;
  const changed = new Set(row.changedFields || []);
  return SNAPSHOT_FIELDS.map((field) => {
    const mark = changed.has(field) ? ` data-changed="1"` : "";
    return `<div data-${side}-field="${field}"${mark}>${escapeHtml(`${FIELD_LABELS[field]}：${fieldText(snapshot, field)}`)}</div>`;
  }).join("");
}

function countTable(counts: CallWrapupEditReportCount[], metrics: CallWrapupEditReportMetrics) {
  if (metrics.correctionCount !== true) return "";
  const body = counts.map((item) => {
    const id = item.agentId || "";
    const count = finite(item.correctionCount) ? String(item.correctionCount) : "—";
    return `<tr data-wrapup-edit-report-count="${escapeHtml(id)}"><td>${escapeHtml(item.label || id || "未分配坐席")}</td><td data-correction-count="1">${escapeHtml(count)}</td></tr>`;
  }).join("");
  return `<table class="call-wrapup-edit-report-table"><thead><tr><th>坐席</th><th>改正次数</th></tr></thead><tbody>${body}</tbody></table>`;
}

export function renderCallWrapupEditReport(data: CallWrapupEditReportResponse | undefined) {
  const metrics = data?.metrics || {};
  const rows = data?.rows || [];
  if (!rows.length) return `<div class="empty-cell" data-wrapup-edit-report-empty="1">这个范围内还没有通话小结改正。</div>`;
  const total = finite(data?.rowCount) ? data?.rowCount : rows.length;
  const detail = rows.map((row) => {
    const id = row.id || "";
    const changed = (row.changedFields || []).map((field) => FIELD_LABELS[field] || field).join("、") || "无";
    return `<tr data-wrapup-edit-report-row="${escapeHtml(id)}"><td>${escapeHtml(row.at || "")}</td><td>${escapeHtml(row.agentLabel || "未分配坐席")}</td><td>${escapeHtml(row.actorLabel || row.actorId || "")}</td><td>${escapeHtml(row.callRecordId || "")}</td><td>${escapeHtml(changed)}</td><td data-before="1">${snapshotCells(row, "before")}</td><td data-after="1">${snapshotCells(row, "after")}</td></tr>`;
  }).join("");
  return `<div class="call-wrapup-edit-report-wrap" data-wrapup-edit-report="1"><p data-wrapup-edit-report-rows="${escapeHtml(String(total))}">这一筛有 ${escapeHtml(String(total))} 条改正</p>${countTable(data?.counts || [], metrics)}<table class="call-wrapup-edit-report-table"><thead><tr><th>时间</th><th>坐席</th><th>操作人</th><th>通话记录</th><th>变更字段</th><th>改正前</th><th>改正后</th></tr></thead><tbody>${detail}</tbody></table></div>`;
}
