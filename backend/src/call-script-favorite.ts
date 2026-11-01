import { randomUUID } from "node:crypto";
import { hasIamPermission, type IamActor } from "./auth.js";
import { CALL_SCRIPT_PERMISSION, canManageCallScripts } from "./call-script.js";
import { scenarioLabelFor } from "./call-script-scenario.js";
import { outboundInstant } from "./outbound-call.js";
import type { CrmStore } from "./store.js";
import type { CallScriptFavorite, CallScriptFavoriteAudit, CallScriptTemplate, SessionUser } from "./types.js";

/**
 * 坐席把自己常用的话术收进 call_script_favorites。
 * 只写自己的收藏和 call_script_favorite_audits。
 * 停用不删收藏行。不拨号，不发信，不调用外部接口。
 */

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes", "templates", "templateIds", "scripts", "versions", "versionIds", "favorites", "favoriteIds"] as const;

export function parseCallScriptFavoriteBody(body: unknown):
  | { ok: true; templateId: string; actorId: string | null }
  | { ok: false; reason: "invalid_request" } {
  if (!isPlainObject(body)) return { ok: false, reason: "invalid_request" };
  if (BATCH_KEYS.some((key) => key in body)) return { ok: false, reason: "invalid_request" };
  const allowed = new Set(["templateId", "actorId"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return { ok: false, reason: "invalid_request" };
  if (typeof body.templateId !== "string" || !ID_PATTERN.test(body.templateId)) return { ok: false, reason: "invalid_request" };
  if (!("actorId" in body) || body.actorId === undefined || body.actorId === null || body.actorId === "") {
    return { ok: true, templateId: body.templateId, actorId: null };
  }
  if (typeof body.actorId !== "string" || !ID_PATTERN.test(body.actorId)) return { ok: false, reason: "invalid_request" };
  return { ok: true, templateId: body.templateId, actorId: body.actorId };
}

export function parseCallScriptFavoriteQuery(query: Record<string, unknown>):
  | { ok: true; actorId: string | null }
  | { ok: false; reason: "invalid_request" } {
  if (Object.values(query).some((value) => Array.isArray(value))) return { ok: false, reason: "invalid_request" };
  if (Object.keys(query).some((key) => key !== "actorId")) return { ok: false, reason: "invalid_request" };
  const raw = query.actorId;
  if (raw === undefined || raw === null || raw === "") return { ok: true, actorId: null };
  if (typeof raw !== "string" || !ID_PATTERN.test(raw)) return { ok: false, reason: "invalid_request" };
  return { ok: true, actorId: raw };
}

function isPlainObject(body: unknown): body is Record<string, unknown> {
  return body !== null && typeof body === "object" && !Array.isArray(body);
}

function canView(user: SessionUser) {
  return canManageCallScripts(user) || hasIamPermission(user as IamActor, CALL_SCRIPT_PERMISSION);
}

function reject(reason: string, message: string, status = 400, extra: Record<string, unknown> = {}) {
  return { status, body: { result: "rejected" as const, reason, message, ...extra } };
}

function validationMessage(action: "favorite" | "unfavorite" | "read", reason: string) {
  if (reason === "disabled" && action === "unfavorite") return "已停用的话术不能取消收藏";
  if (reason === "disabled") return "已停用的话术不能收藏";
  if (reason === "not_found") return "没有这条话术模板";
  if (reason === "forbidden") return "不能操作他人的话术收藏";
  if (action === "read") return "不能查看他人的话术收藏";
  return "一次只能收藏或取消一条话术";
}

function findOwn(store: Pick<CrmStore, "callScriptFavorites">, teamId: string, actorId: string, templateId: string) {
  return store.callScriptFavorites.find((item) => item.teamId === teamId && item.actorId === actorId && item.templateId === templateId) || null;
}

function findTemplate(store: Pick<CrmStore, "callScriptTemplates">, teamId: string, templateId: string) {
  return store.callScriptTemplates.find((item) => item.id === templateId && item.teamId === teamId) || null;
}

function presentFavorite(store: Pick<CrmStore, "callScriptTemplates">, row: CallScriptFavorite) {
  const template = findTemplate(store, row.teamId, row.templateId);
  const enabled = template?.enabled === true;
  return {
    id: row.id,
    templateId: row.templateId,
    createdAt: row.createdAt,
    title: template?.title || "",
    scenario: template?.scenario || "",
    scenarioLabel: template ? scenarioLabelFor(store, row.teamId, template.scenario) : "",
    language: template?.language || "",
    body: template?.body || "",
    enabled,
    selectable: enabled
  };
}

async function writeAudit(store: CrmStore, input: Omit<CallScriptFavoriteAudit, "id" | "at">) {
  const audit: CallScriptFavoriteAudit = {
    id: `csfa_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.callScriptFavoriteAudits.unshift(audit);
  await store.persist();
  return audit;
}

async function rejectWithAudit(
  store: CrmStore,
  user: SessionUser,
  input: {
    templateId: string;
    ownerId: string;
    action: CallScriptFavoriteAudit["action"];
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
    ownerId: input.ownerId.slice(0, 64),
    action: input.action,
    result: "rejected",
    reason: input.reason
  });
  return reject(input.reason, input.message, input.status, input.extra);
}

function ownFavorites(store: Pick<CrmStore, "callScriptFavorites" | "callScriptTemplates">, teamId: string, actorId: string) {
  return store.callScriptFavorites
    .filter((item) => item.teamId === teamId && item.actorId === actorId)
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.templateId.localeCompare(right.templateId))
    .map((item) => presentFavorite(store, item));
}

export function callScriptPickerChoices(
  store: Pick<CrmStore, "callScriptTemplates" | "callScriptFavorites">,
  teamId: string,
  actorId: string
) {
  const favorites = store.callScriptFavorites
    .filter((item) => item.teamId === teamId && item.actorId === actorId)
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.templateId.localeCompare(right.templateId));
  const favoriteIds = favorites.map((item) => item.templateId);
  const favoriteSet = new Set(favoriteIds);
  const favoriteRows = favoriteIds.map((templateId) => {
    const template = findTemplate(store, teamId, templateId);
    return presentChoice(store, teamId, template, templateId, true);
  });
  const rest = store.callScriptTemplates
    .filter((item) => item.teamId === teamId && item.enabled && !favoriteSet.has(item.id))
    .slice()
    .sort((left, right) => left.title.localeCompare(right.title, "zh") || left.id.localeCompare(right.id))
    .map((template) => presentChoice(store, teamId, template, template.id, false));
  return [...favoriteRows, ...rest];
}

function presentChoice(store: object, teamId: string, template: CallScriptTemplate | null, templateId: string, favorited: boolean) {
  const enabled = template?.enabled === true;
  return {
    id: template?.id || templateId,
    title: template?.title || "",
    scenario: template?.scenario || "",
    scenarioLabel: template ? scenarioLabelFor(store, teamId, template.scenario) : "",
    enabled,
    favorited,
    selectable: enabled
  };
}

export async function listCallScriptFavorites(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallScriptFavoriteQuery(query);
  if (!parsed.ok) return reject(parsed.reason, validationMessage("read", parsed.reason));
  if (parsed.actorId && parsed.actorId !== user.id) {
    return rejectWithAudit(store, user, {
      templateId: "",
      ownerId: parsed.actorId,
      action: "read",
      reason: "forbidden",
      message: validationMessage("read", "forbidden"),
      status: 403
    });
  }
  if (!canView(user)) {
    return rejectWithAudit(store, user, {
      templateId: "",
      ownerId: user.id,
      action: "read",
      reason: "forbidden",
      message: "当前账号没有执行该业务操作的权限",
      status: 403,
      extra: { permissionCode: CALL_SCRIPT_PERMISSION }
    });
  }
  return { status: 200, body: { favorites: ownFavorites(store, user.teamId, user.id) } };
}

async function guardOwn(
  store: CrmStore,
  user: SessionUser,
  parsed: { templateId: string; actorId: string | null },
  action: "favorite" | "unfavorite"
) {
  if (parsed.actorId && parsed.actorId !== user.id) {
    return rejectWithAudit(store, user, {
      templateId: parsed.templateId,
      ownerId: parsed.actorId,
      action,
      reason: "forbidden",
      message: "不能操作他人的话术收藏",
      status: 403
    });
  }
  if (!canView(user)) {
    return rejectWithAudit(store, user, {
      templateId: parsed.templateId,
      ownerId: user.id,
      action,
      reason: "forbidden",
      message: "当前账号没有执行该业务操作的权限",
      status: 403,
      extra: { permissionCode: CALL_SCRIPT_PERMISSION }
    });
  }
  return null;
}

export async function favoriteCallScript(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallScriptFavoriteBody(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage("favorite", parsed.reason));
  const denied = await guardOwn(store, user, parsed, "favorite");
  if (denied) return denied;
  const template = findTemplate(store, user.teamId, parsed.templateId);
  if (!template) {
    return rejectWithAudit(store, user, {
      templateId: parsed.templateId,
      ownerId: user.id,
      action: "favorite",
      reason: "not_found",
      message: validationMessage("favorite", "not_found"),
      status: 404
    });
  }
  if (!template.enabled) return reject("disabled", validationMessage("favorite", "disabled"));
  const existing = findOwn(store, user.teamId, user.id, template.id);
  if (existing) {
    return { status: 200, body: { result: "unchanged" as const, favorite: presentFavorite(store, existing) } };
  }
  const saved: CallScriptFavorite = {
    id: `csf_${randomUUID()}`,
    teamId: user.teamId,
    actorId: user.id,
    templateId: template.id,
    createdAt: outboundInstant().toISOString()
  };
  store.callScriptFavorites.unshift(saved);
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    templateId: template.id,
    ownerId: user.id,
    action: "favorite",
    result: "updated",
    reason: ""
  });
  return { status: 200, body: { result: "created" as const, favorite: presentFavorite(store, saved) } };
}

export async function unfavoriteCallScript(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallScriptFavoriteBody(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage("unfavorite", parsed.reason));
  const denied = await guardOwn(store, user, parsed, "unfavorite");
  if (denied) return denied;
  const template = findTemplate(store, user.teamId, parsed.templateId);
  if (!template) {
    return rejectWithAudit(store, user, {
      templateId: parsed.templateId,
      ownerId: user.id,
      action: "unfavorite",
      reason: "not_found",
      message: validationMessage("unfavorite", "not_found"),
      status: 404
    });
  }
  if (!template.enabled) return reject("disabled", validationMessage("unfavorite", "disabled"));
  const existing = findOwn(store, user.teamId, user.id, template.id);
  if (!existing) return { status: 200, body: { result: "unchanged" as const, templateId: template.id } };
  store.callScriptFavorites = store.callScriptFavorites.filter((item) => item.id !== existing.id);
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    templateId: template.id,
    ownerId: user.id,
    action: "unfavorite",
    result: "updated",
    reason: ""
  });
  return { status: 200, body: { result: "removed" as const, templateId: template.id } };
}
