import { randomUUID } from "node:crypto";
import { hasIamPermission, type IamActor } from "./auth.js";
import { outboundInstant } from "./outbound-call.js";
import type { CrmStore } from "./store.js";
import type { CallScriptAudit, CallScriptScenario, CallScriptTemplate, SessionUser } from "./types.js";

/**
 * 外呼话术模板。只写本地模板和 call_script_audits。
 * 停用保留原行。不拨号，不发信，不调用外部接口。
 */

export const CALL_SCRIPT_TITLE_MAX = 80;
export const CALL_SCRIPT_BODY_MAX = 2000;
export const CALL_SCRIPT_LANGUAGE_MAX = 16;
export const CALL_SCRIPT_PERMISSION = "communication.read";

export const CALL_SCRIPT_SCENARIOS: Array<{ id: CallScriptScenario; label: string }> = [
  { id: "first_call", label: "首呼" },
  { id: "follow_up", label: "回访" },
  { id: "missed_callback", label: "未接通回拨" },
  { id: "objection", label: "异议处理" }
];

const SCENARIO_IDS = new Set(CALL_SCRIPT_SCENARIOS.map((item) => item.id));
const LANGUAGE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,2}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes", "templates", "templateIds", "scripts"] as const;

export interface CallScriptSnapshot {
  title: string;
  scenario: CallScriptScenario;
  language: string;
  body: string;
  enabled: boolean;
}

export function canManageCallScripts(user: { role?: string; teamId?: string } | undefined) {
  if (!user?.teamId || user.teamId === "all") return false;
  return user.role === "admin" || user.role === "super_admin";
}

export function callScriptScenarioLabel(scenario: string) {
  return CALL_SCRIPT_SCENARIOS.find((item) => item.id === scenario)?.label || scenario;
}

export function characterCount(value: string) {
  return Array.from(value).length;
}

/** 旧值和新值。没有模板时是空。正文原样放在分隔线后面。 */
export function formatCallScriptValue(value: CallScriptSnapshot | null) {
  if (!value) return "";
  return [
    `enabled=${value.enabled ? "1" : "0"}`,
    `scenario=${value.scenario}`,
    `language=${value.language}`,
    `title=${value.title}`,
    "---",
    value.body
  ].join("\n");
}

export function sameCallScript(left: CallScriptSnapshot | null, right: CallScriptSnapshot | null) {
  return formatCallScriptValue(left) === formatCallScriptValue(right);
}

function isScenario(value: string): value is CallScriptScenario {
  return SCENARIO_IDS.has(value as CallScriptScenario);
}

function reject(reason: string, message: string, status = 400, extra: Record<string, unknown> = {}) {
  return { status, body: { result: "rejected" as const, reason, message, ...extra } };
}

function validationMessage(reason: string) {
  if (reason === "invalid_title") return `标题必填，最多 ${CALL_SCRIPT_TITLE_MAX} 个字符`;
  if (reason === "invalid_body") return `正文必填，最多 ${CALL_SCRIPT_BODY_MAX} 个字符`;
  if (reason === "invalid_scenario") return "场景只能是首呼、回访、未接通回拨或异议处理";
  if (reason === "invalid_language") return "语言标签可省略；填写时例如 zh 或 zh-CN，最长 16 个字符";
  if (reason === "invalid_scenario_filter") return "场景筛选不合法";
  if (reason === "disabled") return "已停用的话术不能再编辑";
  return "一次只能处理一条话术模板";
}

function snapshotOf(template: CallScriptTemplate | null): CallScriptSnapshot | null {
  if (!template) return null;
  return {
    title: template.title,
    scenario: template.scenario,
    language: template.language,
    body: template.body,
    enabled: template.enabled
  };
}

function readText(value: unknown): string | "bad" {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return "bad";
  return value;
}

function parseTitle(value: unknown): string | "bad" {
  if (typeof value !== "string" || /[\r\n]/.test(value)) return "bad";
  const title = value.trim();
  if (!title || characterCount(title) > CALL_SCRIPT_TITLE_MAX) return "bad";
  return title;
}

function parseBody(value: unknown): string | "bad" {
  if (typeof value !== "string") return "bad";
  const body = value.trim();
  if (!body || characterCount(body) > CALL_SCRIPT_BODY_MAX) return "bad";
  return body;
}

function parseLanguage(value: unknown): string | "bad" {
  const text = readText(value);
  if (text === "bad") return "bad";
  const language = text.trim();
  if (!language) return "";
  if (characterCount(language) > CALL_SCRIPT_LANGUAGE_MAX || !LANGUAGE_PATTERN.test(language)) return "bad";
  return language;
}

function parseScenario(value: unknown): CallScriptScenario | "bad" {
  if (typeof value !== "string" || !isScenario(value)) return "bad";
  return value;
}

function hasBatchKey(record: Record<string, unknown>) {
  return BATCH_KEYS.some((key) => key in record);
}

function isPlainObject(body: unknown): body is Record<string, unknown> {
  return body !== null && typeof body === "object" && !Array.isArray(body);
}

export function parseCallScriptCreate(body: unknown):
  | { ok: true; snapshot: CallScriptSnapshot }
  | { ok: false; reason: "invalid_request" | "invalid_title" | "invalid_body" | "invalid_scenario" | "invalid_language" } {
  if (!isPlainObject(body)) return { ok: false, reason: "invalid_request" };
  if (hasBatchKey(body)) return { ok: false, reason: "invalid_request" };
  const allowed = new Set(["title", "scenario", "body", "language"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return { ok: false, reason: "invalid_request" };
  const title = parseTitle(body.title);
  const scenario = parseScenario(body.scenario);
  const text = parseBody(body.body);
  const language = parseLanguage(body.language);
  if (title === "bad") return { ok: false, reason: "invalid_title" };
  if (scenario === "bad") return { ok: false, reason: "invalid_scenario" };
  if (text === "bad") return { ok: false, reason: "invalid_body" };
  if (language === "bad") return { ok: false, reason: "invalid_language" };
  return { ok: true, snapshot: { title, scenario, language, body: text, enabled: true } };
}

export function parseCallScriptUpdate(body: unknown):
  | { ok: true; id: string; snapshot: CallScriptSnapshot }
  | { ok: false; reason: "invalid_request" | "invalid_title" | "invalid_body" | "invalid_scenario" | "invalid_language" } {
  if (!isPlainObject(body)) return { ok: false, reason: "invalid_request" };
  if (hasBatchKey(body)) return { ok: false, reason: "invalid_request" };
  const allowed = new Set(["id", "title", "scenario", "body", "language"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return { ok: false, reason: "invalid_request" };
  if (typeof body.id !== "string" || !ID_PATTERN.test(body.id)) return { ok: false, reason: "invalid_request" };
  const title = parseTitle(body.title);
  const scenario = parseScenario(body.scenario);
  const text = parseBody(body.body);
  const language = parseLanguage(body.language);
  if (title === "bad") return { ok: false, reason: "invalid_title" };
  if (scenario === "bad") return { ok: false, reason: "invalid_scenario" };
  if (text === "bad") return { ok: false, reason: "invalid_body" };
  if (language === "bad") return { ok: false, reason: "invalid_language" };
  return { ok: true, id: body.id, snapshot: { title, scenario, language, body: text, enabled: true } };
}

export function parseCallScriptDisable(body: unknown):
  | { ok: true; id: string }
  | { ok: false; reason: "invalid_request" } {
  if (!isPlainObject(body)) return { ok: false, reason: "invalid_request" };
  if (hasBatchKey(body)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(body).some((key) => key !== "id")) return { ok: false, reason: "invalid_request" };
  if (typeof body.id !== "string" || !ID_PATTERN.test(body.id)) return { ok: false, reason: "invalid_request" };
  return { ok: true, id: body.id };
}

export function parseCallScriptQuery(query: Record<string, unknown>):
  | { ok: true; scenario: CallScriptScenario | null; includeDisabled: boolean }
  | { ok: false; reason: "invalid_request" | "invalid_scenario_filter" } {
  const scenarioRaw = query.scenario;
  const disabledRaw = query.includeDisabled;
  if (Array.isArray(scenarioRaw) || Array.isArray(disabledRaw)) return { ok: false, reason: "invalid_request" };
  let scenario: CallScriptScenario | null = null;
  if (scenarioRaw !== undefined && scenarioRaw !== null && scenarioRaw !== "") {
    if (typeof scenarioRaw !== "string" || !isScenario(scenarioRaw)) return { ok: false, reason: "invalid_scenario_filter" };
    scenario = scenarioRaw;
  }
  if (disabledRaw === undefined || disabledRaw === null || disabledRaw === "" || disabledRaw === "0") {
    return { ok: true, scenario, includeDisabled: false };
  }
  if (disabledRaw === "1") return { ok: true, scenario, includeDisabled: true };
  return { ok: false, reason: "invalid_request" };
}

function canRead(user: SessionUser) {
  return hasIamPermission(user as IamActor, CALL_SCRIPT_PERMISSION);
}

/** 本租户管理员可以查看。主管和业务员仍要有 communication.read。 */
function canView(user: SessionUser) {
  return canManageCallScripts(user) || canRead(user);
}

async function writeAudit(store: CrmStore, input: Omit<CallScriptAudit, "id" | "at">) {
  const audit: CallScriptAudit = {
    id: `csa_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.callScriptAudits.unshift(audit);
  await store.persist();
  return audit;
}

async function rejectWithAudit(
  store: CrmStore,
  user: SessionUser,
  input: {
    templateId: string;
    action: CallScriptAudit["action"];
    previous: CallScriptSnapshot | null;
    next: CallScriptSnapshot | null;
    reason: string;
    message: string;
    status: number;
    extra?: Record<string, unknown>;
  }
) {
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    templateId: input.templateId.slice(0, 64),
    action: input.action,
    previousValue: formatCallScriptValue(input.previous),
    nextValue: formatCallScriptValue(input.next),
    result: "rejected",
    reason: input.reason
  });
  return reject(input.reason, input.message, input.status, input.extra);
}

function findTemplate(store: CrmStore, id: string) {
  return store.callScriptTemplates.find((item) => item.id === id) || null;
}

function presentTemplate(template: CallScriptTemplate) {
  return {
    id: template.id,
    title: template.title,
    scenario: template.scenario,
    scenarioLabel: callScriptScenarioLabel(template.scenario),
    language: template.language,
    body: template.body,
    enabled: template.enabled,
    updatedAt: template.updatedAt
  };
}

function visibleTemplates(store: CrmStore, teamId: string, scenario: CallScriptScenario | null, includeDisabled: boolean) {
  return store.callScriptTemplates
    .filter((item) => item.teamId === teamId)
    .filter((item) => includeDisabled || item.enabled)
    .filter((item) => !scenario || item.scenario === scenario)
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title, "zh"));
}

export async function listCallScripts(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallScriptQuery(query);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  if (!canView(user)) {
    return rejectWithAudit(store, user, {
      templateId: "",
      action: "read",
      previous: null,
      next: null,
      reason: "forbidden",
      message: "当前账号没有执行该业务操作的权限",
      status: 403,
      extra: { permissionCode: CALL_SCRIPT_PERMISSION }
    });
  }
  const manage = canManageCallScripts(user);
  const templates = visibleTemplates(store, user.teamId, parsed.scenario, manage && parsed.includeDisabled);
  return {
    status: 200,
    body: {
      canManage: manage,
      scenarios: CALL_SCRIPT_SCENARIOS,
      templates: templates.map(presentTemplate)
    }
  };
}

export async function createCallScript(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallScriptCreate(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  if (!canView(user)) {
    return rejectWithAudit(store, user, {
      templateId: "",
      action: "create",
      previous: null,
      next: parsed.snapshot,
      reason: "forbidden",
      message: "当前账号没有执行该业务操作的权限",
      status: 403,
      extra: { permissionCode: CALL_SCRIPT_PERMISSION }
    });
  }
  if (!canManageCallScripts(user)) {
    return rejectWithAudit(store, user, {
      templateId: "",
      action: "create",
      previous: null,
      next: parsed.snapshot,
      reason: "forbidden",
      message: "只有管理员可以编辑话术模板",
      status: 403
    });
  }
  const now = outboundInstant().toISOString();
  const saved: CallScriptTemplate = {
    id: `cst_${randomUUID()}`,
    teamId: user.teamId,
    title: parsed.snapshot.title,
    scenario: parsed.snapshot.scenario,
    language: parsed.snapshot.language,
    body: parsed.snapshot.body,
    enabled: true,
    createdBy: user.id,
    updatedBy: user.id,
    createdAt: now,
    updatedAt: now,
    disabledAt: ""
  };
  store.callScriptTemplates.unshift(saved);
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    templateId: saved.id,
    action: "create",
    previousValue: "",
    nextValue: formatCallScriptValue(parsed.snapshot),
    result: "updated",
    reason: ""
  });
  return { status: 200, body: { result: "created" as const, template: presentTemplate(saved) } };
}

export async function updateCallScript(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallScriptUpdate(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  const found = findTemplate(store, parsed.id);
  const local = found && found.teamId === user.teamId ? found : null;
  const previous = snapshotOf(local);
  if (!canView(user)) {
    return rejectWithAudit(store, user, {
      templateId: parsed.id,
      action: "update",
      previous,
      next: parsed.snapshot,
      reason: "forbidden",
      message: "当前账号没有执行该业务操作的权限",
      status: 403,
      extra: { permissionCode: CALL_SCRIPT_PERMISSION }
    });
  }
  if (!canManageCallScripts(user)) {
    return rejectWithAudit(store, user, {
      templateId: parsed.id,
      action: "update",
      previous,
      next: parsed.snapshot,
      reason: "forbidden",
      message: "只有管理员可以编辑话术模板",
      status: 403
    });
  }
  if (!local) {
    return rejectWithAudit(store, user, {
      templateId: parsed.id,
      action: "update",
      previous: null,
      next: null,
      reason: "not_found",
      message: "没有这条话术模板",
      status: 404
    });
  }
  if (!local.enabled) return reject("disabled", validationMessage("disabled"));
  if (sameCallScript(previous, parsed.snapshot)) {
    return { status: 200, body: { result: "unchanged" as const, template: presentTemplate(local) } };
  }
  const now = outboundInstant().toISOString();
  local.title = parsed.snapshot.title;
  local.scenario = parsed.snapshot.scenario;
  local.language = parsed.snapshot.language;
  local.body = parsed.snapshot.body;
  local.updatedBy = user.id;
  local.updatedAt = now;
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    templateId: local.id,
    action: "update",
    previousValue: formatCallScriptValue(previous),
    nextValue: formatCallScriptValue(parsed.snapshot),
    result: "updated",
    reason: ""
  });
  return { status: 200, body: { result: "updated" as const, template: presentTemplate(local) } };
}

export async function disableCallScript(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallScriptDisable(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  const found = findTemplate(store, parsed.id);
  const local = found && found.teamId === user.teamId ? found : null;
  const previous = snapshotOf(local);
  if (!canView(user)) {
    return rejectWithAudit(store, user, {
      templateId: parsed.id,
      action: "disable",
      previous,
      next: previous ? { ...previous, enabled: false } : null,
      reason: "forbidden",
      message: "当前账号没有执行该业务操作的权限",
      status: 403,
      extra: { permissionCode: CALL_SCRIPT_PERMISSION }
    });
  }
  if (!canManageCallScripts(user)) {
    return rejectWithAudit(store, user, {
      templateId: parsed.id,
      action: "disable",
      previous,
      next: previous ? { ...previous, enabled: false } : null,
      reason: "forbidden",
      message: "只有管理员可以编辑话术模板",
      status: 403
    });
  }
  if (!local) {
    return rejectWithAudit(store, user, {
      templateId: parsed.id,
      action: "disable",
      previous: null,
      next: null,
      reason: "not_found",
      message: "没有这条话术模板",
      status: 404
    });
  }
  if (!local.enabled) {
    return { status: 200, body: { result: "unchanged" as const, template: presentTemplate(local) } };
  }
  const next: CallScriptSnapshot = { ...previous!, enabled: false };
  const now = outboundInstant().toISOString();
  local.enabled = false;
  local.updatedBy = user.id;
  local.updatedAt = now;
  local.disabledAt = now;
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    templateId: local.id,
    action: "disable",
    previousValue: formatCallScriptValue(previous),
    nextValue: formatCallScriptValue(next),
    result: "updated",
    reason: ""
  });
  return { status: 200, body: { result: "disabled" as const, template: presentTemplate(local) } };
}
