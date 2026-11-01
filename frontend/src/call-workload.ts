/**
 * 今日通话负荷。数字只渲染接口给的字段。
 * 接口没给的次数或时长写成「—」，不画成 0。
 */

export interface CallWorkloadRow {
  agentId?: string;
  label?: string;
  callsMade?: number | null;
  wrapupCompleted?: number | null;
  wrapupPending?: number | null;
  wrapupSkipped?: number | null;
  correctionsMade?: number | null;
  talkTimeSeconds?: number | null;
}

export interface CallWorkloadMetrics {
  callsMade?: boolean;
  wrapupCompleted?: boolean;
  wrapupPending?: boolean;
  wrapupSkipped?: boolean;
  correctionsMade?: boolean;
  talkTimeSeconds?: boolean;
}

export interface CallWorkloadResponse {
  scope?: "self" | "team";
  today?: string;
  timeZone?: string;
  unmapped?: boolean;
  metrics?: CallWorkloadMetrics;
  rows?: CallWorkloadRow[];
}

const COLUMNS: Array<{ key: keyof CallWorkloadMetrics; label: string; talk?: boolean }> = [
  { key: "callsMade", label: "今日拨打" },
  { key: "wrapupCompleted", label: "小结已完成" },
  { key: "wrapupPending", label: "小结待处理" },
  { key: "wrapupSkipped", label: "无需小结" },
  { key: "correctionsMade", label: "改正" },
  { key: "talkTimeSeconds", label: "通话时长", talk: true }
];

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

export function callWorkloadQuery(input: { scope: "self" | "team"; agentId?: string }) {
  const params = new URLSearchParams();
  params.set("scope", input.scope);
  if (input.agentId) params.set("agentId", input.agentId);
  return `?${params.toString()}`;
}

function cell(row: CallWorkloadRow, key: keyof CallWorkloadMetrics, talk: boolean) {
  const value = row[key];
  if (!finite(value)) return "—";
  return talk ? `${value}秒` : String(value);
}

export function renderCallWorkload(data: CallWorkloadResponse | undefined) {
  if (data?.unmapped) {
    return `<div class="empty-cell" data-call-workload-unmapped="1">还没有坐席映射，今日通话负荷记为 —。</div>`;
  }
  const metrics = data?.metrics || {};
  const columns = COLUMNS.filter((column) => metrics[column.key] === true);
  const rows = data?.rows || [];
  if (!rows.length) {
    return `<div class="empty-cell" data-call-workload-empty="1">这个范围还没有可展示的今日通话负荷。</div>`;
  }
  if (!columns.length) {
    return `<div class="empty-cell" data-call-workload-empty="1">没有可计算的今日通话负荷。</div>`;
  }
  const head = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const body = rows.map((row) => {
    const id = row.agentId || "";
    const cells = columns.map((column) => {
      const text = cell(row, column.key, Boolean(column.talk));
      return `<td data-workload-${column.key}="${escapeHtml(text)}">${escapeHtml(text)}</td>`;
    }).join("");
    return `<tr data-call-workload-row="${escapeHtml(id)}"><td>${escapeHtml(row.label || id || "未分配坐席")}</td>${cells}</tr>`;
  }).join("");
  const today = data?.today ? `今日 ${data.today}` : "今日";
  return `<div class="call-workload-wrap" data-call-workload="1"><p data-call-workload-today="${escapeHtml(data?.today || "")}">${escapeHtml(today)} · ${escapeHtml(data?.scope === "team" ? "团队" : "我的今日")}</p><table class="call-workload-table"><thead><tr><th>坐席</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
