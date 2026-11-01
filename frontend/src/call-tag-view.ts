/**
 * 客户和线索上的通话标签汇总。只读，点一下打开这个对象带这个标签的通话记录。
 * 停用的标签置灰。次数和最近一次时间都来自接口，这里不另算。
 */

export interface CallTagOnObject {
  id: string;
  name: string;
  enabled?: boolean;
  count: number;
  latestAt?: string;
}

export interface CallTagFilterChoice {
  id: string;
  name: string;
  enabled?: boolean;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatCallTagLatestAt(value: string | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function renderCallTagObjectSummary(tags: CallTagOnObject[] | undefined) {
  const rows = tags || [];
  if (!rows.length) return `<p data-call-tag-summary-empty="1">看得到的通话上还没有标签。</p>`;
  return `<div class="call-tag-summary-list" data-call-tag-summary-list="1">${rows.map((tag) => {
    const disabled = tag.enabled === false;
    const latest = tag.latestAt || "";
    return `<button type="button" class="call-tag-chip${disabled ? " is-disabled" : ""}" data-call-tag-open="${escapeHtml(tag.id)}" data-call-tag-disabled="${disabled ? "1" : "0"}" data-call-tag-count="${tag.count}" data-call-tag-latest="${escapeHtml(latest)}">${escapeHtml(tag.name)}<small>${tag.count} 次 · 最近 ${escapeHtml(formatCallTagLatestAt(latest))}</small></button>`;
  }).join("")}</div>`;
}

export function renderCallTagObjectSummaryFailure(message: string) {
  return `<p data-call-tag-summary-error="1">${escapeHtml(message || "通话标签没有加载")}</p>`;
}

export function renderCallTagFilterOptions(tags: CallTagFilterChoice[] | undefined, selected: string) {
  const choices: CallTagFilterChoice[] = [{ id: "", name: "全部通话标签", enabled: true }];
  for (const tag of tags || []) {
    if (!tag.id || choices.some((item) => item.id === tag.id)) continue;
    choices.push(tag);
  }
  if (selected && !choices.some((item) => item.id === selected)) {
    choices.push({ id: selected, name: "（找不到标签）", enabled: false });
  }
  return choices.map((item) => {
    const picked = item.id === selected ? " selected" : "";
    const disabled = item.enabled === false;
    const label = disabled && item.id ? `${item.name}（已停用）` : item.name;
    return `<option value="${escapeHtml(item.id)}"${picked}${disabled ? ` data-call-tag-disabled="1"` : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

export function callTagFilterEmptyText(kind: "客户" | "线索") {
  return `没有通话打过这个标签的${kind}`;
}

export function renderCallTagTargetNote(input: { targetType?: string; targetId?: string; tag?: string }) {
  if (!input.targetType || !input.targetId) return "";
  const kind = input.targetType === "lead" ? "线索" : "客户";
  const tagText = input.tag ? "带此标签的" : "";
  return `<span data-call-tag-target="1">只显示这个${kind}${tagText}、并且你看得到的通话。</span> <button class="btn" type="button" data-clear-call-target="1">查看全部通话</button>`;
}

export function renderOutboundCallTargetFilterEmpty() {
  return `<p data-call-tag-target-empty="1">这个对象在这个标签下还没有通话。</p>`;
}
