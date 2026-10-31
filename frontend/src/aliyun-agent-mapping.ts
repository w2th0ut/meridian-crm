export interface AgentSeatView {
  userId: string;
  loginName?: string;
  displayName?: string;
  extension?: string;
  workMode?: string;
}

export interface AgentUserView {
  id: string;
  name: string;
}

export interface AgentMappingView {
  id: string;
  crmUserId: string;
  cccUserId: string;
  loginName?: string;
  displayName?: string;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderAgentMappingTable(input: {
  seats: AgentSeatView[];
  users: AgentUserView[];
  mappings: AgentMappingView[];
}) {
  const rows = input.seats.length
    ? input.seats.map((seat) => {
      const mapping = input.mappings.find((item) => item.cccUserId === seat.userId);
      return { seat, mapping };
    })
    : input.mappings.map((mapping) => ({
      seat: {
        userId: mapping.cccUserId,
        loginName: mapping.loginName,
        displayName: mapping.displayName
      },
      mapping
    }));
  if (!rows.length) return `<tr><td colspan="4">还没有坐席。点「读取坐席」后选择用户。</td></tr>`;
  return rows.map(({ seat, mapping }) => {
    const options = input.users.map((user) => {
      const selected = mapping?.crmUserId === user.id ? " selected" : "";
      return `<option value="${escapeHtml(user.id)}"${selected}>${escapeHtml(user.name)}</option>`;
    }).join("");
    const label = escapeHtml(seat.displayName || seat.loginName || seat.userId);
    const remove = mapping
      ? `<button type="button" data-agent-delete="${escapeHtml(mapping.id)}">解除</button>`
      : "";
    return `<tr><td>${label}</td><td>${escapeHtml(seat.userId)}</td><td><select data-agent-user="${escapeHtml(seat.userId)}"><option value="">未映射</option>${options}</select></td><td><button type="button" data-agent-save="${escapeHtml(seat.userId)}">保存</button>${remove}</td></tr>`;
  }).join("");
}

export interface CampaignCaseView {
  caseId: string;
  state: string;
  maskedNumber?: string;
  attemptCount?: number | null;
}

export interface CampaignView {
  campaignId: string;
  name: string;
  state: string;
  totalCases?: number | null;
  casesConnected?: number | null;
  casesUncompleted?: number | null;
  casesAborted?: number | null;
  cases?: CampaignCaseView[];
}

/** 只展示状态。不提供启动、恢复、提交或上传。 */
export function renderCampaignRoster(campaigns: CampaignView[]) {
  if (!campaigns.length) return `<p data-campaign-empty="1">还没有同步到外呼任务。</p>`;
  return campaigns.map((campaign) => {
    const cases = (campaign.cases || []).map((item) =>
      `<li>${escapeHtml(item.maskedNumber || "")} ${escapeHtml(item.state)}</li>`
    ).join("");
    return `<article data-campaign-id="${escapeHtml(campaign.campaignId)}"><h3>${escapeHtml(campaign.name || campaign.campaignId)}</h3><p>${escapeHtml(campaign.state)} · 名单 ${campaign.totalCases ?? "—"} · 接通 ${campaign.casesConnected ?? "—"} · 未完成 ${campaign.casesUncompleted ?? "—"} · 止呼 ${campaign.casesAborted ?? "—"}</p><ul>${cases}</ul></article>`;
  }).join("");
}
