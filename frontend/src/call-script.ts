/**
 * 外呼话术模板。管理员单条保存或停用。
 * 坐席只读启用的话术，按场景查看。不放外呼按钮，不触发拨号。
 */

export const CALL_SCRIPT_SCENARIOS = [
  { id: "first_call", label: "首呼" },
  { id: "follow_up", label: "回访" },
  { id: "missed_callback", label: "未接通回拨" },
  { id: "objection", label: "异议处理" }
] as const;

export type CallScriptScenarioId = typeof CALL_SCRIPT_SCENARIOS[number]["id"];

export interface CallScriptTemplateView {
  id: string;
  title: string;
  scenario: string;
  scenarioLabel?: string;
  language?: string;
  body: string;
  enabled?: boolean;
  updatedAt?: string;
}

export interface CallScriptListResponse {
  canManage?: boolean;
  scenarios?: Array<{ id: string; label: string }>;
  templates?: CallScriptTemplateView[];
}

export function escapeCallScriptText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function callScriptScenarioLabel(scenario: string) {
  return CALL_SCRIPT_SCENARIOS.find((item) => item.id === scenario)?.label || scenario;
}

export function filterEnabledCallScripts(templates: CallScriptTemplateView[], scenario: string) {
  return templates.filter((item) => item.enabled !== false && (!scenario || item.scenario === scenario));
}

export function renderCallScriptScenarioOptions(selected = "", includeAll = false) {
  const all = includeAll ? `<option value=""${selected ? "" : " selected"}>全部启用</option>` : "";
  return all + CALL_SCRIPT_SCENARIOS.map((item) => {
    const picked = item.id === selected ? " selected" : "";
    return `<option value="${item.id}"${picked}>${item.label}</option>`;
  }).join("");
}

export function renderCallScriptList(templates: CallScriptTemplateView[], scenario = "") {
  const rows = filterEnabledCallScripts(templates, scenario);
  if (!rows.length) {
    return `<div class="empty-cell" data-call-script-empty="1">这个场景还没有启用的话术。</div>`;
  }
  return rows.map((item) => {
    const language = item.language?.trim() ? ` · ${item.language.trim()}` : "";
    const label = item.scenarioLabel || callScriptScenarioLabel(item.scenario);
    return `<article class="call-script-card" data-call-script="${escapeCallScriptText(item.id)}" data-call-script-scenario="${escapeCallScriptText(item.scenario)}"><h3>${escapeCallScriptText(item.title)}</h3><p>${escapeCallScriptText(label)}${escapeCallScriptText(language)}</p><pre class="call-script-body">${escapeCallScriptText(item.body)}</pre></article>`;
  }).join("");
}

export function renderCallScriptAside(templates: CallScriptTemplateView[], scenario = "first_call") {
  const selected = CALL_SCRIPT_SCENARIOS.some((item) => item.id === scenario) ? scenario : "first_call";
  return `<div class="call-script-aside" data-call-script-aside="1"><label>话术<select data-call-script-scenario>${renderCallScriptScenarioOptions(selected)}</select></label><div data-call-script-view>${renderCallScriptList(templates, selected)}</div></div>`;
}

export function renderCallScriptManageList(templates: CallScriptTemplateView[]) {
  if (!templates.length) return `<div class="empty-cell" data-call-script-manage-empty="1">还没有话术模板。</div>`;
  return templates.map((item) => {
    const label = item.scenarioLabel || callScriptScenarioLabel(item.scenario);
    const state = item.enabled === false ? "已停用" : "启用";
    const edit = item.enabled === false
      ? ""
      : `<button class="btn" type="button" data-call-script-edit="${escapeCallScriptText(item.id)}">编辑</button>`;
    const versions = `<button class="btn" type="button" data-call-script-versions="${escapeCallScriptText(item.id)}">版本</button>`;
    return `<p class="call-script-manage-row" data-call-script-manage="${escapeCallScriptText(item.id)}"><span>${escapeCallScriptText(item.title)} · ${escapeCallScriptText(label)} · ${state}</span>${versions}${edit}</p>`;
  }).join("");
}

export function callScriptCreateBody(input: { title: string; scenario: string; body: string; language: string }) {
  return {
    title: input.title,
    scenario: input.scenario,
    body: input.body,
    language: input.language.trim()
  };
}

export function callScriptUpdateBody(input: { id: string; title: string; scenario: string; body: string; language: string }) {
  return { id: input.id, ...callScriptCreateBody(input) };
}

export function callScriptDisableBody(id: string) {
  return { id };
}

export interface CallScriptVersionView {
  id: string;
  versionNo: number;
  title: string;
  scenario: string;
  scenarioLabel?: string;
  language?: string;
  savedAt?: string;
  source?: string;
  body?: string;
}

export function callScriptRestoreBody(templateId: string, versionId: string) {
  return { templateId, versionId };
}

function callScriptVersionSourceLabel(source: string | undefined) {
  if (source === "restore") return "恢复前";
  if (source === "edit") return "编辑前";
  return "";
}

export function renderCallScriptVersionBody(body: string) {
  return `<pre class="call-script-body" data-call-script-version-body="1">${escapeCallScriptText(body)}</pre>`;
}

export function renderCallScriptVersionPanel(input: {
  templateId: string;
  title: string;
  canRestore: boolean;
  versions: CallScriptVersionView[];
  openedBody?: string | null;
}) {
  const rows = input.versions.length
    ? input.versions.map((item) => {
      const source = callScriptVersionSourceLabel(item.source);
      const when = item.savedAt ? ` · ${item.savedAt}` : "";
      const versionNo = Number.isInteger(item.versionNo) ? String(item.versionNo) : "";
      const restore = input.canRestore
        ? `<button class="btn" type="button" data-call-script-version-restore="${escapeCallScriptText(item.id)}" data-call-script-template="${escapeCallScriptText(input.templateId)}">恢复此版</button>`
        : "";
      return `<p data-call-script-version="${escapeCallScriptText(item.id)}"><span>第 ${versionNo} 版 · ${escapeCallScriptText(item.title)}${source ? ` · ${escapeCallScriptText(source)}` : ""}${escapeCallScriptText(when)}</span><button class="btn" type="button" data-call-script-version-view="${escapeCallScriptText(item.id)}" data-call-script-template="${escapeCallScriptText(input.templateId)}">查看正文</button>${restore}</p>`;
    }).join("")
    : `<div class="empty-cell" data-call-script-versions-empty="1">还没有历史版本。</div>`;
  const opened = input.openedBody == null ? "" : renderCallScriptVersionBody(input.openedBody);
  return `<div data-call-script-version-panel="1" data-call-script-template="${escapeCallScriptText(input.templateId)}"><h3>话术详情</h3><p>${escapeCallScriptText(input.title)}</p>${rows}${opened}</div>`;
}

export function readCallScriptDraft(title: string, scenario: string, body: string, language: string):
  | { ok: true; title: string; scenario: string; body: string; language: string }
  | { ok: false; message: string } {
  const nextTitle = title.trim();
  const nextBody = body.trim();
  const nextLanguage = language.trim();
  if (!nextTitle || Array.from(nextTitle).length > 80 || /[\r\n]/.test(title)) {
    return { ok: false, message: "标题必填，最多 80 个字符" };
  }
  if (!CALL_SCRIPT_SCENARIOS.some((item) => item.id === scenario)) {
    return { ok: false, message: "请选择场景" };
  }
  if (!nextBody || Array.from(nextBody).length > 2000) {
    return { ok: false, message: "正文必填，最多 2000 个字符" };
  }
  if (nextLanguage && (Array.from(nextLanguage).length > 16 || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,2}$/.test(nextLanguage))) {
    return { ok: false, message: "语言标签可省略；填写时例如 zh 或 zh-CN" };
  }
  return { ok: true, title: nextTitle, scenario, body: nextBody, language: nextLanguage };
}
