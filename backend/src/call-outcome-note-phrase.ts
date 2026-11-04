import { randomUUID } from "node:crypto";
import { hasIamPermission, type IamActor } from "./auth.js";
import { canManageCallScripts, characterCount } from "./call-script.js";
import { outboundInstant } from "./outbound-call.js";
import type { CrmStore } from "./store.js";
import type { CallScriptAudit, CallScriptTemplate, SessionUser } from "./types.js";

/**
 * 通话结果备注的常用短语。行仍在 call_script_templates，usage_kind 为 outcome_note。
 * 个人短语的 owner_id 是保存人，团队短语的 owner_id 为空。
 * 只写这张表现有行和 call_script_audits。点插入发生在页面上，这里不改通话结果。
 * 不拨号，不发信，不调用外部接口。
 */

export const CALL_OUTCOME_NOTE_PHRASE_MAX = 200;
export const CALL_OUTCOME_NOTE_PHRASE_PERMISSION = "communication.read";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes", "templates", "templateIds", "scripts", "phrases", "phraseIds", "texts", "notes"] as const;

export interface OutcomeNotePhraseView {
  id: string;
  text: string;
  scope: "personal" | "team";
  enabled: boolean;
  canDisable: boolean;
}

export function formatOutcomeNotePhraseValue(value: { enabled: boolean; scope: "personal" | "team"; text: string } | null) {
  if (!value) return "";
  return [`enabled=${value.enabled ? "1" : "0"}`, `scope=${value.scope}`, "---", value.text].join("\n");
}

function reject(reason: string, message: string, status = 400, extra: Record<string, unknown> = {}) {
  return { status, body: { result: "rejected" as const, reason, message, ...extra } };
}

function validationMessage(reason: string) {
  if (reason === "forbidden") return "当前账号没有执行该业务操作的权限";
  if (reason === "not_found") return "没有这条常用短语";
  return "一次只能保存或停用一条常用短语";
}

function isPlainObject(body: unknown): body is Record<string, unknown> {
  return Boolean(body) && typeof body === "object" && !Array.isArray(body);
}

function hasBatchKey(record: Record<string, unknown>) {
  return BATCH_KEYS.some((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function phraseScope(template: CallScriptTemplate): "personal" | "team" {
  return template.ownerId ? "personal" : "team";
}

function isPhrase(template: CallScriptTemplate) {
  return template.usageKind === "outcome_note";
}

export function parseOutcomeNotePhraseCreate(body: unknown):
  | { ok: true; text: string; scope: "personal" | "team" }
  | { ok: false; reason: "invalid_request" } {
  if (!isPlainObject(body)) return { ok: false, reason: "invalid_request" };
  if (hasBatchKey(body)) return { ok: false, reason: "invalid_request" };
  const keys = Object.keys(body);
  if (keys.some((key) => key !== "text" && key !== "scope")) return { ok: false, reason: "invalid_request" };
  if (typeof body.text !== "string" || /[\r\n]/.test(body.text)) return { ok: false, reason: "invalid_request" };
  const text = body.text.trim();
  if (!text || characterCount(text) > CALL_OUTCOME_NOTE_PHRASE_MAX) return { ok: false, reason: "invalid_request" };
  if (body.scope !== "personal" && body.scope !== "team") return { ok: false, reason: "invalid_request" };
  return { ok: true, text, scope: body.scope };
}

export function parseOutcomeNotePhraseDisable(body: unknown):
  | { ok: true; id: string }
  | { ok: false; reason: "invalid_request" } {
  if (!isPlainObject(body)) return { ok: false, reason: "invalid_request" };
  if (hasBatchKey(body) || Object.keys(body).some((key) => key !== "id")) return { ok: false, reason: "invalid_request" };
  if (typeof body.id !== "string" || !ID_PATTERN.test(body.id)) return { ok: false, reason: "invalid_request" };
  return { ok: true, id: body.id };
}

export function parseOutcomeNotePhraseQuery(query: Record<string, unknown>):
  | { ok: true; includeDisabled: boolean }
  | { ok: false; reason: "invalid_request" } {
  const keys = Object.keys(query);
  if (keys.some((key) => key !== "includeDisabled")) return { ok: false, reason: "invalid_request" };
  const raw = query.includeDisabled;
  if (raw === undefined || raw === "") return { ok: true, includeDisabled: false };
  if (Array.isArray(raw) || raw !== "1") return { ok: false, reason: "invalid_request" };
  return { ok: true, includeDisabled: true };
}

function canUse(user: SessionUser) {
  if (!user.teamId || user.teamId === "all") return false;
  return canManageCallScripts(user) || hasIamPermission(user as IamActor, CALL_OUTCOME_NOTE_PHRASE_PERMISSION);
}

function canGovernTeam(user: SessionUser) {
  if (!user.teamId || user.teamId === "all") return false;
  return user.role === "manager" || user.role === "admin" || user.role === "super_admin";
}

function canDisable(user: SessionUser, template: CallScriptTemplate) {
  if (template.ownerId) return template.ownerId === user.id;
  if (template.createdBy === user.id) return true;
  return canGovernTeam(user);
}

function snapshotOf(template: CallScriptTemplate | null) {
  if (!template) return null;
  return { enabled: template.enabled, scope: phraseScope(template), text: template.body };
}

function present(user: SessionUser, template: CallScriptTemplate): OutcomeNotePhraseView {
  return {
    id: template.id,
    text: template.body,
    scope: phraseScope(template),
    enabled: template.enabled,
    canDisable: canDisable(user, template)
  };
}

function visiblePhrases(store: CrmStore, user: SessionUser, includeDisabled: boolean) {
  return store.callScriptTemplates
    .filter((item) => item.teamId === user.teamId && isPhrase(item))
    .filter((item) => !item.ownerId || item.ownerId === user.id)
    .filter((item) => item.enabled || (includeDisabled && canDisable(user, item)))
    .slice()
    .sort((left, right) => {
      const leftOwn = left.ownerId === user.id ? 0 : 1;
      const rightOwn = right.ownerId === user.id ? 0 : 1;
      return leftOwn - rightOwn || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
    });
}

function findPhrase(store: CrmStore, id: string) {
  return store.callScriptTemplates.find((item) => item.id === id && isPhrase(item)) || null;
}

function findEnabledDuplicate(store: CrmStore, teamId: string, ownerId: string, text: string) {
  return store.callScriptTemplates.find((item) => item.teamId === teamId && isPhrase(item) && item.enabled && (item.ownerId || "") === ownerId && item.body === text) || null;
}

async function writeAudit(store: CrmStore, input: Omit<CallScriptAudit, "id" | "at">) {
  const audit: CallScriptAudit = {
    id: `cspa_${randomUUID()}`,
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
    action: "phrase_create" | "phrase_disable" | "phrase_read";
    previous: { enabled: boolean; scope: "personal" | "team"; text: string } | null;
    next: { enabled: boolean; scope: "personal" | "team"; text: string } | null;
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
    previousValue: formatOutcomeNotePhraseValue(input.previous),
    nextValue: formatOutcomeNotePhraseValue(input.next),
    result: "rejected",
    reason: input.reason
  });
  return reject(input.reason, input.message, input.status, input.extra);
}

export async function listOutcomeNotePhrases(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseOutcomeNotePhraseQuery(query);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  if (!canUse(user)) {
    return rejectWithAudit(store, user, {
      templateId: "",
      action: "phrase_read",
      previous: null,
      next: null,
      reason: "forbidden",
      message: validationMessage("forbidden"),
      status: 403,
      extra: { permissionCode: CALL_OUTCOME_NOTE_PHRASE_PERMISSION }
    });
  }
  return {
    status: 200,
    body: { phrases: visiblePhrases(store, user, parsed.includeDisabled).map((item) => present(user, item)) }
  };
}

export async function createOutcomeNotePhrase(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseOutcomeNotePhraseCreate(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  const ownerId = parsed.scope === "personal" ? user.id : "";
  const next = { enabled: true, scope: parsed.scope, text: parsed.text };
  if (!canUse(user)) {
    return rejectWithAudit(store, user, {
      templateId: "",
      action: "phrase_create",
      previous: null,
      next,
      reason: "forbidden",
      message: validationMessage("forbidden"),
      status: 403,
      extra: { permissionCode: CALL_OUTCOME_NOTE_PHRASE_PERMISSION }
    });
  }
  const existing = findEnabledDuplicate(store, user.teamId, ownerId, parsed.text);
  if (existing) {
    return { status: 200, body: { result: "unchanged" as const, phrase: present(user, existing) } };
  }
  const now = outboundInstant().toISOString();
  const saved: CallScriptTemplate = {
    id: `csp_${randomUUID()}`,
    teamId: user.teamId,
    title: Array.from(parsed.text).slice(0, 80).join(""),
    scenario: "",
    language: "",
    body: parsed.text,
    enabled: true,
    createdBy: user.id,
    updatedBy: user.id,
    createdAt: now,
    updatedAt: now,
    disabledAt: "",
    usageKind: "outcome_note",
    ownerId
  };
  store.callScriptTemplates.unshift(saved);
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    templateId: saved.id,
    action: "phrase_create",
    previousValue: "",
    nextValue: formatOutcomeNotePhraseValue(next),
    result: "updated",
    reason: ""
  });
  return { status: 200, body: { result: "created" as const, phrase: present(user, saved) } };
}

export async function disableOutcomeNotePhrase(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseOutcomeNotePhraseDisable(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  const found = findPhrase(store, parsed.id);
  const local = found && found.teamId === user.teamId ? found : null;
  if (!canUse(user)) {
    return rejectWithAudit(store, user, {
      templateId: parsed.id,
      action: "phrase_disable",
      previous: null,
      next: null,
      reason: "forbidden",
      message: validationMessage("forbidden"),
      status: 403,
      extra: { permissionCode: CALL_OUTCOME_NOTE_PHRASE_PERMISSION }
    });
  }
  if (!local) {
    return rejectWithAudit(store, user, {
      templateId: parsed.id,
      action: "phrase_disable",
      previous: null,
      next: null,
      reason: "not_found",
      message: validationMessage("not_found"),
      status: 404
    });
  }
  const previous = snapshotOf(local);
  if (!canDisable(user, local)) {
    return rejectWithAudit(store, user, {
      templateId: local.id,
      action: "phrase_disable",
      previous: local.ownerId ? null : previous,
      next: null,
      reason: "forbidden",
      message: validationMessage("forbidden"),
      status: 403
    });
  }
  if (!local.enabled) {
    return { status: 200, body: { result: "unchanged" as const, phrase: present(user, local) } };
  }
  const now = outboundInstant().toISOString();
  local.enabled = false;
  local.updatedBy = user.id;
  local.updatedAt = now;
  local.disabledAt = now;
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    templateId: local.id,
    action: "phrase_disable",
    previousValue: formatOutcomeNotePhraseValue(previous),
    nextValue: formatOutcomeNotePhraseValue({ enabled: false, scope: phraseScope(local), text: local.body }),
    result: "updated",
    reason: ""
  });
  return { status: 200, body: { result: "disabled" as const, phrase: present(user, local) } };
}
