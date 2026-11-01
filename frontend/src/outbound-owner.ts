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
