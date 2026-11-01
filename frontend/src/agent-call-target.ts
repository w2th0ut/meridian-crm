/**
 * 坐席每日外呼目标。只展示今日进度，并让管理员单条保存或清除。
 * 不放外呼按钮，不触发拨号。
 */

export interface AgentCallTargetRow {
  agentId: string;
  displayName: string;
  mapped?: boolean;
  dialed: number;
  connected: number;
  intent: number;
  dialTarget: number | null;
  connectedTarget: number | null;
  intentTarget: number | null;
}

export interface AgentCallTargetResponse {
  timeZone?: string;
  today?: string;
  canManage?: boolean;
  rows?: AgentCallTargetRow[];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatTargetPair(actual: number, target: number | null) {
  if (target === null || target === undefined) return `${actual}（未设目标）`;
  return `${actual}/${target}`;
}

export function formatAgentCallProgress(row: AgentCallTargetRow) {
  const name = row.displayName || row.agentId;
  return `${name}：已拨 ${formatTargetPair(row.dialed, row.dialTarget)}，接通 ${formatTargetPair(row.connected, row.connectedTarget)}，意向 ${formatTargetPair(row.intent, row.intentTarget)}`;
}

export function renderAgentCallTargetList(rows: AgentCallTargetRow[]) {
  if (!rows.length) {
    return `<div class="empty-cell" data-agent-call-target-empty="1">还没有可显示的坐席。没有映射时不显示别人的进度。</div>`;
  }
  return rows.map((row) => {
    const text = formatAgentCallProgress(row);
    return `<p class="agent-call-target-row" data-agent-call-target="${escapeHtml(row.agentId)}">${escapeHtml(text)}</p>`;
  }).join("");
}

export function renderAgentCallTargetOptions(rows: AgentCallTargetRow[], selected = "") {
  return rows.map((row) => {
    const name = row.displayName || row.agentId;
    const picked = row.agentId === selected ? " selected" : "";
    return `<option value="${escapeHtml(row.agentId)}"${picked}>${escapeHtml(name)}</option>`;
  }).join("");
}

export function agentCallTargetSetBody(input: {
  agentId: string;
  dialTarget: number;
  connectedTarget: number;
  intentTarget: number | null;
}) {
  return {
    agentId: input.agentId,
    dialTarget: input.dialTarget,
    connectedTarget: input.connectedTarget,
    intentTarget: input.intentTarget
  };
}

export function readAgentCallTargetCounts(dial: string, connected: string, intent: string):
  | { ok: true; dialTarget: number; connectedTarget: number; intentTarget: number | null }
  | { ok: false; message: string } {
  const dialTarget = readCount(dial, false);
  const connectedTarget = readCount(connected, false);
  const intentTarget = readCount(intent, true);
  if (dialTarget === "bad" || connectedTarget === "bad" || intentTarget === "bad") {
    return { ok: false, message: "每日目标必须是 0 到 10000 的整数" };
  }
  if (dialTarget === null || connectedTarget === null) {
    return { ok: false, message: "请填写拨打数和接通数" };
  }
  return { ok: true, dialTarget, connectedTarget, intentTarget };
}

function readCount(value: string, optional: boolean): number | null | "bad" {
  const text = value.trim();
  if (!text) return optional ? null : "bad";
  if (!/^\d+$/.test(text)) return "bad";
  const number = Number(text);
  if (!Number.isInteger(number) || number > 10000) return "bad";
  return number;
}
