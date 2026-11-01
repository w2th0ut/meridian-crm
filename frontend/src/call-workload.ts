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
  callsTarget?: number | null;
  wrapupTarget?: number | null;
}

export interface CallWorkloadMetrics {
  callsMade?: boolean;
  wrapupCompleted?: boolean;
  wrapupPending?: boolean;
  wrapupSkipped?: boolean;
  correctionsMade?: boolean;
  talkTimeSeconds?: boolean;
  callsTarget?: boolean;
  wrapupTarget?: boolean;
}

export interface CallWorkloadResponse {
  scope?: "self" | "team";
  today?: string;
  timeZone?: string;
  unmapped?: boolean;
  canEditWrapupTarget?: boolean;
  metrics?: CallWorkloadMetrics;
  rows?: CallWorkloadRow[];
}

const COLUMNS: Array<{ key: keyof CallWorkloadMetrics; label: string; talk?: boolean; progress?: "callsMade" | "wrapupCompleted" }> = [
  { key: "callsMade", label: "今日拨打" },
  { key: "wrapupCompleted", label: "小结已完成" },
  { key: "wrapupPending", label: "小结待处理" },
  { key: "wrapupSkipped", label: "无需小结" },
  { key: "correctionsMade", label: "改正" },
  { key: "talkTimeSeconds", label: "通话时长", talk: true },
  { key: "callsTarget", label: "人工拨打/拨打目标", progress: "callsMade" },
  { key: "wrapupTarget", label: "小结完成/小结目标", progress: "wrapupCompleted" }
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

function cell(row: CallWorkloadRow, column: (typeof COLUMNS)[number]) {
  if (column.progress) {
    const target = row[column.key];
    if (!finite(target)) return "—";
    const actual = row[column.progress];
    const actualText = finite(actual) ? String(actual) : "—";
    return `${actualText}/${target}`;
  }
  const value = row[column.key];
  if (!finite(value)) return "—";
  return column.talk ? `${value}秒` : String(value);
}

export function readWrapupTargetCount(value: string):
  | { ok: true; wrapupTarget: number | null }
  | { ok: false; message: string } {
  const text = value.trim();
  if (!text) return { ok: true, wrapupTarget: null };
  if (!/^\d+$/.test(text)) return { ok: false, message: "小结目标必须是 0 到 10000 的整数" };
  const number = Number(text);
  if (!Number.isInteger(number) || number > 10000) return { ok: false, message: "小结目标必须是 0 到 10000 的整数" };
  return { ok: true, wrapupTarget: number };
}

function wrapupEditor(agentId: string, current: number | null) {
  const value = current === null ? "" : String(current);
  return `<form data-call-wrapup-target-form="${escapeHtml(agentId)}"><input data-wrapup-agent type="hidden" value="${escapeHtml(agentId)}"><input data-wrapup-target inputmode="numeric" autocomplete="off" value="${escapeHtml(value)}" aria-label="小结目标"><button class="btn" type="submit">保存小结目标</button></form>`;
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
  const editable = data?.canEditWrapupTarget === true;
  const body = rows.map((row) => {
    const id = row.agentId || "";
    const cells = columns.map((column) => {
      const text = cell(row, column);
      const editor = editable && column.key === "wrapupTarget" && id && id !== "none"
        ? wrapupEditor(id, finite(row.wrapupTarget) ? Number(row.wrapupTarget) : null)
        : "";
      return `<td data-workload-${column.key}="${escapeHtml(text)}">${escapeHtml(text)}${editor}</td>`;
    }).join("");
    return `<tr data-call-workload-row="${escapeHtml(id)}"><td>${escapeHtml(row.label || id || "未分配坐席")}</td>${cells}</tr>`;
  }).join("");
  const today = data?.today ? `今日 ${data.today}` : "今日";
  return `<div class="call-workload-wrap" data-call-workload="1"><p data-call-workload-today="${escapeHtml(data?.today || "")}">${escapeHtml(today)} · ${escapeHtml(data?.scope === "team" ? "团队" : "我的今日")}</p><table class="call-workload-table"><thead><tr><th>坐席</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
