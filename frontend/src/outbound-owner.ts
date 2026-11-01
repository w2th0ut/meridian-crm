/**
 * 外呼负责坐席。详情里显示，管理员可以单条指派、改派或清除。
 * 不放外呼按钮，不触发拨号。
 */

export interface OutboundOwnerAgentOption {
  agentId: string;
  displayName: string;
}

export interface OutboundOwnerPanel {
  targetType?: string;
  targetId?: string;
  name?: string;
  ownerAgentId?: string;
  ownerAgentLabel?: string;
  canManage?: boolean;
  agents?: OutboundOwnerAgentOption[];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function outboundOwnerLabel(agentId: string | undefined, label: string | undefined) {
  if (!agentId) return "未指派";
  return label || agentId;
}

export function outboundOwnerAssignBody(input: { targetType: string; targetId: string; agentId: string }) {
  return { targetType: input.targetType, targetId: input.targetId, agentId: input.agentId };
}

export function outboundOwnerClearBody(input: { targetType: string; targetId: string }) {
  return { targetType: input.targetType, targetId: input.targetId };
}

export interface OutboundOwnerListMeta {
  canManage?: boolean;
  myAgentIds?: string[];
  agents?: OutboundOwnerAgentOption[];
}

export function matchesOutboundOwnerList(agentId: string | undefined, filter: string, myAgentIds: readonly string[]) {
  if (!filter) return true;
  if (filter === "unassigned") return !agentId;
  if (filter === "mine") return Boolean(agentId && myAgentIds.includes(agentId));
  return agentId === filter;
}

export function outboundOwnerFilterEmptyText(kind: "客户" | "线索" | "候选") {
  return `没有符合外呼负责坐席筛选的${kind}`;
}

export function renderOutboundOwnerFilterOptions(agents: OutboundOwnerAgentOption[], selected: string) {
  const choices = [
    { value: "", label: "全部负责坐席" },
    { value: "mine", label: "我负责的" },
    { value: "unassigned", label: "待指派" },
    ...agents.map((item) => ({ value: item.agentId, label: item.displayName || item.agentId }))
  ];
  if (selected && !choices.some((item) => item.value === selected)) {
    choices.push({ value: selected, label: selected });
  }
  return choices.map((item) => {
    const picked = item.value === selected ? " selected" : "";
    return `<option value="${escapeHtml(item.value)}"${picked}>${escapeHtml(item.label)}</option>`;
  }).join("");
}

export function renderOutboundOwnerListCell(input: {
  targetType: string;
  targetId: string;
  ownerAgentId?: string;
  ownerAgentLabel?: string;
  canManage?: boolean;
  agents?: OutboundOwnerAgentOption[];
  tag?: "td" | "div";
}) {
  const tag = input.tag === "div" ? "div" : "td";
  const targetType = input.targetType || "";
  const targetId = input.targetId || "";
  const ownerAgentId = input.ownerAgentId || "";
  const label = outboundOwnerLabel(ownerAgentId, input.ownerAgentLabel);
  const text = `<span data-outbound-owner-label="1" data-owner-agent="${escapeHtml(ownerAgentId)}">外呼负责坐席：${escapeHtml(label)}</span>`;
  let control = "";
  if (input.canManage && targetType && targetId) {
    const agents = [...(input.agents || [])];
    if (ownerAgentId && !agents.some((item) => item.agentId === ownerAgentId)) {
      agents.unshift({ agentId: ownerAgentId, displayName: input.ownerAgentLabel || ownerAgentId });
    }
    const options = [`<option value="">未指派</option>`].concat(agents.map((item) => {
      const picked = item.agentId === ownerAgentId ? " selected" : "";
      return `<option value="${escapeHtml(item.agentId)}"${picked}>${escapeHtml(item.displayName || item.agentId)}</option>`;
    })).join("");
    control = `<form data-outbound-owner-row="1" data-target-type="${escapeHtml(targetType)}" data-target-id="${escapeHtml(targetId)}"><select data-outbound-owner-agent aria-label="指派外呼负责坐席">${options}</select><button class="btn" type="submit" title="只改这一条。不会拨号。">保存</button></form>`;
  }
  return `<${tag} data-outbound-owner-cell="1" data-target-type="${escapeHtml(targetType)}" data-target-id="${escapeHtml(targetId)}"><div class="outbound-owner-cell">${text}${control}</div></${tag}>`;
}

export function renderOutboundOwnerPanel(input: OutboundOwnerPanel) {
  const targetType = input.targetType || "";
  const targetId = input.targetId || "";
  const ownerAgentId = input.ownerAgentId || "";
  const label = outboundOwnerLabel(ownerAgentId, input.ownerAgentLabel);
  const shown = `<p data-outbound-owner="1" data-owner-agent="${escapeHtml(ownerAgentId)}">外呼负责坐席：${escapeHtml(label)}</p>`;
  if (!input.canManage || !targetType || !targetId) return shown;
  const agents = [...(input.agents || [])];
  if (ownerAgentId && !agents.some((item) => item.agentId === ownerAgentId)) {
    agents.unshift({ agentId: ownerAgentId, displayName: input.ownerAgentLabel || ownerAgentId });
  }
  const options = [`<option value="">未指派</option>`].concat(agents.map((item) => {
    const picked = item.agentId === ownerAgentId ? " selected" : "";
    return `<option value="${escapeHtml(item.agentId)}"${picked}>${escapeHtml(item.displayName || item.agentId)}</option>`;
  })).join("");
  return `${shown}<form data-outbound-owner-form="1" data-target-type="${escapeHtml(targetType)}" data-target-id="${escapeHtml(targetId)}"><label>负责坐席<select data-outbound-owner-agent>${options}</select></label><button class="btn" type="submit">保存负责坐席</button><small>只改这一条。不会拨号，也不会改拨号门禁。</small></form>`;
}
