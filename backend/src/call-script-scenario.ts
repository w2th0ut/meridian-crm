import { createHash, randomUUID } from "node:crypto";
import { hasIamPermission, type IamActor } from "./auth.js";
import { outboundInstant } from "./outbound-call.js";
import type { CrmStore } from "./store.js";
import type { CallScriptScenario, CallScriptScenarioAudit, CallScriptScenarioRow, SessionUser } from "./types.js";

/**
 * 话术场景分类。管理员单条新增、重命名、调整排序或停用。
 * 停用保留原行。模板上的 scenario 列不改名、不删除。
 * 不拨号，不发信，不调用外部接口。
 */

export const CALL_SCRIPT_SCENARIO_NAME_MAX = 40;
export const CALL_SCRIPT_SCENARIO_SORT_MAX = 10000;
export const CALL_SCRIPT_SCENARIO_PERMISSION = "communication.read";
const CODE_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes", "templates", "templateIds", "scripts", "versions", "versionIds", "favorites", "favoriteIds", "scenarios", "scenarioIds", "codes", "names"] as const;

export const CALL_SCRIPT_SCENARIOS: Array<{ id: CallScriptScenario; label: string }> = [
  { id: "first_call", label: "首呼" },
  { id: "follow_up", label: "回访" },
  { id: "missed_callback", label: "未接通回拨" },
  { id: "objection", label: "异议处理" }
];

const BUILTIN_SORT = new Map<string, number>([
  ["first_call", 10],
  ["follow_up", 20],
  ["missed_callback", 30],
  ["objection", 40]
]);

export interface CallScriptScenarioView {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  enabled: boolean;
}

export interface CallScriptScenarioChoice {
  id: string;
  label: string;
  scenarioId: string;
  code: string;
  name: string;
  sortOrder: number;
  enabled: boolean;
}

export function canManageCallScripts(user: { role?: string; teamId?: string } | undefined) {
  if (!user?.teamId || user.teamId === "all") return false;
  return user.role === "admin" || user.role === "super_admin";
}

export function callScriptScenarioLabel(scenario: string) {
  return CALL_SCRIPT_SCENARIOS.find((item) => item.id === scenario)?.label || scenario;
}

export function importedCallScriptScenarioId(teamId: string, code: string) {
  return `css_${createHash("md5").update(`${teamId}:${code}`).digest("hex").slice(0, 20)}`;
}

export function formatCallScriptScenarioValue(value: Pick<CallScriptScenarioView, "enabled" | "code" | "sortOrder" | "name"> | null) {
  if (!value) return "";
  return [
    `enabled=${value.enabled ? "1" : "0"}`,
    `code=${value.code}`,
    `sort=${value.sortOrder}`,
    `name=${value.name}`
  ].join("\n");
}

function builtinSort(code: string) {
  return BUILTIN_SORT.get(code) ?? 100;
}

function isBuiltin(code: string) {
  return BUILTIN_SORT.has(code);
}

/** 把模板上已经写下的场景代码补进场景表。已有的行不改、不删。 */
export function importCallScriptScenariosFromTemplates(store: Pick<CrmStore, "callScriptTemplates" | "callScriptScenarios">) {
  const seen = new Set(store.callScriptScenarios.map((item) => `${item.teamId}\0${item.code}`));
  const now = outboundInstant().toISOString();
  let added = 0;
  for (const template of store.callScriptTemplates) {
    const code = template.scenario;
    if (!code || !CODE_PATTERN.test(code)) continue;
    const key = `${template.teamId}\0${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    store.callScriptScenarios.push({
      id: importedCallScriptScenarioId(template.teamId, code),
      teamId: template.teamId,
      code,
      name: callScriptScenarioLabel(code).slice(0, CALL_SCRIPT_SCENARIO_NAME_MAX),
      sortOrder: builtinSort(code),
      enabled: true,
      createdBy: "",
      updatedBy: "",
      createdAt: now,
      updatedAt: now,
      disabledAt: ""
    });
    added += 1;
  }
  return added;
}

export function scenarioViews(store: Pick<CrmStore, "callScriptTemplates" | "callScriptScenarios">, teamId: string): CallScriptScenarioView[] {
  importCallScriptScenariosFromTemplates(store);
  const rows = store.callScriptScenarios.filter((item) => item.teamId === teamId);
  const codes = new Set(rows.map((item) => item.code));
  const views: CallScriptScenarioView[] = rows.map(presentView);
  for (const builtin of CALL_SCRIPT_SCENARIOS) {
    if (codes.has(builtin.id)) continue;
    views.push({
      id: "",
      code: builtin.id,
      name: builtin.label,
      sortOrder: builtinSort(builtin.id),
      enabled: true
    });
  }
  views.sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh") || left.code.localeCompare(right.code));
  return views;
}

export function callScriptScenarioChoices(store: Pick<CrmStore, "callScriptTemplates" | "callScriptScenarios">, teamId: string): CallScriptScenarioChoice[] {
  return scenarioViews(store, teamId).map((item) => ({
    id: item.code,
    label: item.name,
    scenarioId: item.id,
    code: item.code,
    name: item.name,
    sortOrder: item.sortOrder,
    enabled: item.enabled
  }));
}

export function scenarioLabelFor(store: object, teamId: string, code: string) {
  const rows = "callScriptScenarios" in store && Array.isArray(store.callScriptScenarios)
    ? store.callScriptScenarios as readonly CallScriptScenarioRow[]
    : undefined;
  const row = rows?.find((item) => item.teamId === teamId && item.code === code);
  if (row?.name) return row.name;
  return callScriptScenarioLabel(code);
}

export function knownScenarioCodes(store: Pick<CrmStore, "callScriptTemplates" | "callScriptScenarios">, teamId: string) {
  const codes = new Set<string>(CALL_SCRIPT_SCENARIOS.map((item) => item.id));
  for (const view of scenarioViews(store, teamId)) codes.add(view.code);
  return codes;
}

export function enabledScenarioCodes(store: Pick<CrmStore, "callScriptTemplates" | "callScriptScenarios">, teamId: string) {
  const codes = new Set<string>();
  for (const view of scenarioViews(store, teamId)) {
    if (view.enabled) codes.add(view.code);
  }
  return codes;
}

function presentView(row: CallScriptScenarioRow): CallScriptScenarioView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    sortOrder: row.sortOrder,
    enabled: row.enabled
  };
}

function presentChoice(view: CallScriptScenarioView): CallScriptScenarioChoice {
  return {
    id: view.code,
    label: view.name,
    scenarioId: view.id,
    code: view.code,
    name: view.name,
    sortOrder: view.sortOrder,
    enabled: view.enabled
  };
}

function isPlainObject(body: unknown): body is Record<string, unknown> {
  return body !== null && typeof body === "object" && !Array.isArray(body);
}

function hasBatchKey(record: Record<string, unknown>) {
  return BATCH_KEYS.some((key) => key in record);
}

function reject(reason: string, message: string, status = 400, extra: Record<string, unknown> = {}) {
  return { status, body: { result: "rejected" as const, reason, message, ...extra } };
}

function validationMessage(reason: string) {
  if (reason === "invalid_name") return `名称必填，最多 ${CALL_SCRIPT_SCENARIO_NAME_MAX} 个字符`;
  if (reason === "duplicate_name") return "场景名称已存在";
  if (reason === "invalid_sort") return `排序必须是 0 到 ${CALL_SCRIPT_SCENARIO_SORT_MAX} 的整数`;
  return "一次只能处理一个话术场景";
}

export function parseCallScriptScenarioName(value: unknown): string | "bad" {
  if (typeof value !== "string" || /[\r\n]/.test(value)) return "bad";
  const name = value.trim();
  if (!name || Array.from(name).length > CALL_SCRIPT_SCENARIO_NAME_MAX) return "bad";
  return name;
}

export function parseCallScriptScenarioCode(value: unknown): string | "bad" {
  if (typeof value !== "string" || !CODE_PATTERN.test(value)) return "bad";
  return value;
}

export function parseCallScriptScenarioCreate(body: unknown):
  | { ok: true; name: string }
  | { ok: false; reason: "invalid_request" | "invalid_name" } {
  if (!isPlainObject(body) || hasBatchKey(body)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(body).some((key) => key !== "name")) return { ok: false, reason: "invalid_request" };
  const name = parseCallScriptScenarioName(body.name);
  if (name === "bad") return { ok: false, reason: "invalid_name" };
  return { ok: true, name };
}

export function parseCallScriptScenarioRename(body: unknown):
  | { ok: true; code: string; name: string }
  | { ok: false; reason: "invalid_request" | "invalid_name" } {
  if (!isPlainObject(body) || hasBatchKey(body)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(body).some((key) => key !== "code" && key !== "name")) return { ok: false, reason: "invalid_request" };
  const code = parseCallScriptScenarioCode(body.code);
  const name = parseCallScriptScenarioName(body.name);
  if (code === "bad") return { ok: false, reason: "invalid_request" };
  if (name === "bad") return { ok: false, reason: "invalid_name" };
  return { ok: true, code, name };
}

export function parseCallScriptScenarioReorder(body: unknown):
  | { ok: true; code: string; sortOrder: number }
  | { ok: false; reason: "invalid_request" | "invalid_sort" } {
  if (!isPlainObject(body) || hasBatchKey(body)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(body).some((key) => key !== "code" && key !== "sortOrder")) return { ok: false, reason: "invalid_request" };
  const code = parseCallScriptScenarioCode(body.code);
  if (code === "bad") return { ok: false, reason: "invalid_request" };
  const sortOrder = body.sortOrder;
  if (typeof sortOrder !== "number" || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > CALL_SCRIPT_SCENARIO_SORT_MAX) {
    return { ok: false, reason: "invalid_sort" };
  }
  return { ok: true, code, sortOrder };
}

export function parseCallScriptScenarioDisable(body: unknown):
  | { ok: true; code: string }
  | { ok: false; reason: "invalid_request" } {
  if (!isPlainObject(body) || hasBatchKey(body)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(body).some((key) => key !== "code")) return { ok: false, reason: "invalid_request" };
  const code = parseCallScriptScenarioCode(body.code);
  if (code === "bad") return { ok: false, reason: "invalid_request" };
  return { ok: true, code };
}

export function parseCallScriptScenarioQuery(query: Record<string, unknown>):
  | { ok: true }
  | { ok: false; reason: "invalid_request" } {
  if (Object.keys(query).length > 0) return { ok: false, reason: "invalid_request" };
  if (Object.values(query).some((value) => Array.isArray(value))) return { ok: false, reason: "invalid_request" };
  return { ok: true };
}

function canRead(user: SessionUser) {
  return hasIamPermission(user as IamActor, CALL_SCRIPT_SCENARIO_PERMISSION);
}

function canView(user: SessionUser) {
  return canManageCallScripts(user) || canRead(user);
}

function findRow(store: Pick<CrmStore, "callScriptScenarios">, teamId: string, code: string) {
  return store.callScriptScenarios.find((item) => item.teamId === teamId && item.code === code) || null;
}

function viewFor(store: Pick<CrmStore, "callScriptTemplates" | "callScriptScenarios">, teamId: string, code: string) {
  return scenarioViews(store, teamId).find((item) => item.code === code) || null;
}

function ensureRow(store: CrmStore, teamId: string, view: CallScriptScenarioView, userId: string) {
  const existing = findRow(store, teamId, view.code);
  if (existing) return existing;
  const now = outboundInstant().toISOString();
  const row: CallScriptScenarioRow = {
    id: importedCallScriptScenarioId(teamId, view.code),
    teamId,
    code: view.code,
    name: view.name,
    sortOrder: view.sortOrder,
    enabled: view.enabled,
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now,
    disabledAt: view.enabled ? "" : now
  };
  store.callScriptScenarios.push(row);
  return row;
}

function freshCode(store: Pick<CrmStore, "callScriptScenarios">, teamId: string) {
  const taken = new Set(store.callScriptScenarios.filter((item) => item.teamId === teamId).map((item) => item.code));
  for (const builtin of CALL_SCRIPT_SCENARIOS) taken.add(builtin.id);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = `scn${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    if (!taken.has(code) && CODE_PATTERN.test(code)) return code;
  }
  return `scn${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

async function writeAudit(store: CrmStore, input: Omit<CallScriptScenarioAudit, "id" | "at">) {
  const audit: CallScriptScenarioAudit = {
    id: `cssa_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.callScriptScenarioAudits.unshift(audit);
  await store.persist();
  return audit;
}

async function rejectWithAudit(
  store: CrmStore,
  user: SessionUser,
  input: {
    scenarioId: string;
    action: CallScriptScenarioAudit["action"];
    previous: string;
    next: string;
    reason: string;
    message: string;
    status: number;
    extra?: Record<string, unknown>;
  }
) {
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    scenarioId: input.scenarioId.slice(0, 64),
    action: input.action,
    previousValue: input.previous,
    nextValue: input.next,
    result: "rejected",
    reason: input.reason
  });
  return reject(input.reason, input.message, input.status, input.extra);
}

export async function listCallScriptScenarios(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallScriptScenarioQuery(query);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  if (!canView(user)) {
    return rejectWithAudit(store, user, {
      scenarioId: "",
      action: "read",
      previous: "",
      next: "",
      reason: "forbidden",
      message: "当前账号没有执行该业务操作的权限",
      status: 403,
      extra: { permissionCode: CALL_SCRIPT_SCENARIO_PERMISSION }
    });
  }
  return {
    status: 200,
    body: {
      canManage: canManageCallScripts(user),
      scenarios: callScriptScenarioChoices(store, user.teamId)
    }
  };
}

export async function createCallScriptScenario(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallScriptScenarioCreate(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  const views = scenarioViews(store, user.teamId);
  const taken = views.some((item) => item.name === parsed.name);
  if (!canView(user)) {
    return rejectWithAudit(store, user, {
      scenarioId: "",
      action: "create",
      previous: "",
      next: "",
      reason: "forbidden",
      message: "当前账号没有执行该业务操作的权限",
      status: 403,
      extra: { permissionCode: CALL_SCRIPT_SCENARIO_PERMISSION }
    });
  }
  if (!canManageCallScripts(user)) {
    return rejectWithAudit(store, user, {
      scenarioId: "",
      action: "create",
      previous: "",
      next: "",
      reason: "forbidden",
      message: "只有管理员可以维护话术场景",
      status: 403
    });
  }
  if (taken) return reject("duplicate_name", validationMessage("duplicate_name"));
  const now = outboundInstant().toISOString();
  const sortOrder = views.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 10;
  const saved: CallScriptScenarioRow = {
    id: `css_${randomUUID()}`,
    teamId: user.teamId,
    code: freshCode(store, user.teamId),
    name: parsed.name,
    sortOrder,
    enabled: true,
    createdBy: user.id,
    updatedBy: user.id,
    createdAt: now,
    updatedAt: now,
    disabledAt: ""
  };
  store.callScriptScenarios.push(saved);
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    scenarioId: saved.id,
    action: "create",
    previousValue: "",
    nextValue: formatCallScriptScenarioValue(saved),
    result: "updated",
    reason: ""
  });
  return { status: 200, body: { result: "created" as const, scenario: presentChoice(presentView(saved)) } };
}

export async function renameCallScriptScenario(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallScriptScenarioRename(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  const current = viewFor(store, user.teamId, parsed.code);
  const previous = formatCallScriptScenarioValue(current);
  const nextView = current ? { ...current, name: parsed.name } : null;
  const next = formatCallScriptScenarioValue(nextView);
  if (!canView(user)) {
    return rejectWithAudit(store, user, {
      scenarioId: current?.id || "",
      action: "rename",
      previous,
      next,
      reason: "forbidden",
      message: "当前账号没有执行该业务操作的权限",
      status: 403,
      extra: { permissionCode: CALL_SCRIPT_SCENARIO_PERMISSION }
    });
  }
  if (!canManageCallScripts(user)) {
    return rejectWithAudit(store, user, {
      scenarioId: current?.id || "",
      action: "rename",
      previous,
      next,
      reason: "forbidden",
      message: "只有管理员可以维护话术场景",
      status: 403
    });
  }
  if (!current || !nextView) {
    return rejectWithAudit(store, user, {
      scenarioId: "",
      action: "rename",
      previous: "",
      next: "",
      reason: "not_found",
      message: "没有这个话术场景",
      status: 404
    });
  }
  if (current.name === parsed.name) {
    return { status: 200, body: { result: "unchanged" as const, scenario: presentChoice(current) } };
  }
  if (scenarioViews(store, user.teamId).some((item) => item.name === parsed.name && item.code !== current.code)) {
    return reject("duplicate_name", validationMessage("duplicate_name"));
  }
  const row = ensureRow(store, user.teamId, current, user.id);
  row.name = parsed.name;
  row.updatedBy = user.id;
  row.updatedAt = outboundInstant().toISOString();
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    scenarioId: row.id,
    action: "rename",
    previousValue: previous,
    nextValue: formatCallScriptScenarioValue(row),
    result: "updated",
    reason: ""
  });
  return { status: 200, body: { result: "renamed" as const, scenario: presentChoice(presentView(row)) } };
}

export async function reorderCallScriptScenario(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallScriptScenarioReorder(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  const current = viewFor(store, user.teamId, parsed.code);
  const previous = formatCallScriptScenarioValue(current);
  const next = formatCallScriptScenarioValue(current ? { ...current, sortOrder: parsed.sortOrder } : null);
  if (!canView(user)) {
    return rejectWithAudit(store, user, {
      scenarioId: current?.id || "",
      action: "reorder",
      previous,
      next,
      reason: "forbidden",
      message: "当前账号没有执行该业务操作的权限",
      status: 403,
      extra: { permissionCode: CALL_SCRIPT_SCENARIO_PERMISSION }
    });
  }
  if (!canManageCallScripts(user)) {
    return rejectWithAudit(store, user, {
      scenarioId: current?.id || "",
      action: "reorder",
      previous,
      next,
      reason: "forbidden",
      message: "只有管理员可以维护话术场景",
      status: 403
    });
  }
  if (!current) {
    return rejectWithAudit(store, user, {
      scenarioId: "",
      action: "reorder",
      previous: "",
      next: "",
      reason: "not_found",
      message: "没有这个话术场景",
      status: 404
    });
  }
  if (current.sortOrder === parsed.sortOrder) {
    return { status: 200, body: { result: "unchanged" as const, scenario: presentChoice(current) } };
  }
  const row = ensureRow(store, user.teamId, current, user.id);
  row.sortOrder = parsed.sortOrder;
  row.updatedBy = user.id;
  row.updatedAt = outboundInstant().toISOString();
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    scenarioId: row.id,
    action: "reorder",
    previousValue: previous,
    nextValue: formatCallScriptScenarioValue(row),
    result: "updated",
    reason: ""
  });
  return { status: 200, body: { result: "reordered" as const, scenario: presentChoice(presentView(row)) } };
}

export async function disableCallScriptScenario(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallScriptScenarioDisable(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  const current = viewFor(store, user.teamId, parsed.code);
  const previous = formatCallScriptScenarioValue(current);
  const next = formatCallScriptScenarioValue(current ? { ...current, enabled: false } : null);
  if (!canView(user)) {
    return rejectWithAudit(store, user, {
      scenarioId: current?.id || "",
      action: "disable",
      previous,
      next,
      reason: "forbidden",
      message: "当前账号没有执行该业务操作的权限",
      status: 403,
      extra: { permissionCode: CALL_SCRIPT_SCENARIO_PERMISSION }
    });
  }
  if (!canManageCallScripts(user)) {
    return rejectWithAudit(store, user, {
      scenarioId: current?.id || "",
      action: "disable",
      previous,
      next,
      reason: "forbidden",
      message: "只有管理员可以维护话术场景",
      status: 403
    });
  }
  if (!current) {
    return rejectWithAudit(store, user, {
      scenarioId: "",
      action: "disable",
      previous: "",
      next: "",
      reason: "not_found",
      message: "没有这个话术场景",
      status: 404
    });
  }
  if (!current.enabled) {
    return { status: 200, body: { result: "unchanged" as const, scenario: presentChoice(current) } };
  }
  const now = outboundInstant().toISOString();
  const row = ensureRow(store, user.teamId, current, user.id);
  row.enabled = false;
  row.disabledAt = now;
  row.updatedBy = user.id;
  row.updatedAt = now;
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    scenarioId: row.id,
    action: "disable",
    previousValue: previous,
    nextValue: formatCallScriptScenarioValue(row),
    result: "updated",
    reason: ""
  });
  return { status: 200, body: { result: "disabled" as const, scenario: presentChoice(presentView(row)) } };
}

export function isBuiltinCallScriptScenario(code: string) {
  return isBuiltin(code);
}
