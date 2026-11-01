/**
 * 通话记录上的所用话术。详情里单条选择、更换或清除。
 * 列表只显示标题。管理员看到的使用次数来自接口，页面不算第二套。
 */

export interface CallScriptChoice {
  id: string;
  title: string;
  scenario?: string;
  scenarioLabel?: string;
  enabled?: boolean;
}

export interface CallScriptUsageStat extends CallScriptChoice {
  usageCount?: number;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function callScriptUsageBody(templateId: string | null) {
  return { templateId: templateId ? templateId : null };
}

export function renderCallScriptUsageForm(
  record: { id: string; callScriptTemplateId?: string; callScriptTitle?: string; callScriptEnabled?: boolean },
  choices: CallScriptChoice[]
) {
  const current = (record.callScriptTemplateId || "").trim();
  const options = [{ id: "", label: "未选用" }];
  for (const item of choices) {
    if (!item.id || options.some((row) => row.id === item.id)) continue;
    const label = item.scenarioLabel ? `${item.title} · ${item.scenarioLabel}` : item.title;
    options.push({ id: item.id, label });
  }
  if (current && !options.some((row) => row.id === current)) {
    const title = record.callScriptTitle?.trim() || "";
    const label = title
      ? `${title}${record.callScriptEnabled === false ? "（已停用）" : ""}`
      : "（找不到话术）";
    options.push({ id: current, label });
  }
  const select = options.map((item) => {
    const picked = item.id === current ? " selected" : "";
    return `<option value="${escapeHtml(item.id)}"${picked}>${escapeHtml(item.label)}</option>`;
  }).join("");
  const currentText = current
    ? (record.callScriptTitle?.trim()
      ? `${record.callScriptTitle.trim()}${record.callScriptEnabled === false ? "（已停用）" : ""}`
      : "（找不到话术）")
    : "未选用";
  return `<form data-call-script-usage-form="1" data-record-id="${escapeHtml(record.id)}"><p data-call-script-usage-current="1">当前：${escapeHtml(currentText)}</p><label>选用<select data-call-script-usage>${select}</select></label><button class="btn" type="submit">保存话术</button><button class="btn" type="button" data-call-script-usage-clear="1">清除</button></form>`;
}

/** 次数只渲染接口给的数字。缺了就不写成 0。 */
export function renderCallScriptUsageStats(rows: CallScriptUsageStat[] | undefined) {
  if (!rows?.length) return `<div class="empty-cell" data-call-script-usage-empty="1">还没有话术模板。</div>`;
  return `<div data-call-script-usage-stats="1">${rows.map((row) => {
    const state = row.enabled === false ? "已停用" : "启用";
    const label = row.scenarioLabel ? `${row.title} · ${row.scenarioLabel}` : row.title;
    const count = typeof row.usageCount === "number" && Number.isFinite(row.usageCount) ? String(row.usageCount) : "—";
    return `<p data-call-script-usage="${escapeHtml(row.id)}"><span>${escapeHtml(label)} · ${state}</span><b data-usage-count="${escapeHtml(count)}">${escapeHtml(count)}</b></p>`;
  }).join("")}</div>`;
}
