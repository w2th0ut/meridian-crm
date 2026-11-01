import { randomUUID } from "node:crypto";
import { hasIamPermission, type IamActor } from "./auth.js";
import { outboundInstant } from "./outbound-call.js";
import {
  outboundCallRecordVisible,
  presentOutboundCallRecord,
  resolveOutboundCallRecordAccess
} from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type { CallRecordTag, CallTag, CallTagAudit, OutboundCallRecord, SessionUser } from "./types.js";

/**
 * 通话自定义标签。管理员单条新增、重命名或停用。
 * 坐席在自己看得到的通话上单条添加或去掉启用中的标签。
 * 停用后已打上的关联还在。不拨号，不发信，不调用外部接口。
 */

export const CALL_TAG_NAME_MAX = 40;
export const CALL_TAG_PERMISSION = "communication.read";
const TAG_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FORMULA_PREFIX = new Set(["=", "+", "-", "@"]);
const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes", "templates", "templateIds", "scripts", "versions", "versionIds", "favorites", "favoriteIds", "scenarios", "scenarioIds", "codes", "names", "tags", "tagIds"] as const;

export interface CallTagView {
  id: string;
  name: string;
  enabled: boolean;
}

export function canManageCallTags(user: { role?: string; teamId?: string } | undefined) {
  if (!user?.teamId || user.teamId === "all") return false;
  return user.role === "admin" || user.role === "super_admin";
}

export function formatCallTagValue(value: Pick<CallTagView, "enabled" | "name"> | null) {
  if (!value) return "";
  return [`enabled=${value.enabled ? "1" : "0"}`, `name=${value.name}`].join("\n");
}

/** 名称以 = + - @ 开头时先加单引号，避免拼进 CSV 后被当成公式。 */
export function guardCallTagName(name: string) {
  if (name && FORMULA_PREFIX.has(name[0] || "")) return `'${name}`;
  return name;
}

export function callTagCsvCell(tags: readonly CallTagView[]) {
  return tags.map((item) => guardCallTagName(item.name)).join("、");
}

function compareTags(left: CallTagView, right: CallTagView) {
  return left.name.localeCompare(right.name, "zh") || left.id.localeCompare(right.id);
}

function presentTag(row: CallTag): CallTagView {
  return { id: row.id, name: row.name, enabled: row.enabled };
}

function tagRows(store: { callTags?: readonly CallTag[] }) {
  return store.callTags ?? [];
}

function linkRows(store: { callRecordTags?: readonly CallRecordTag[] }) {
  return store.callRecordTags ?? [];
}

export function callTagsOnRecord(
  store: { callTags?: readonly CallTag[]; callRecordTags?: readonly CallRecordTag[] },
  teamId: string,
  callRecordId: string
): CallTagView[] {
  const ids = new Set(
    linkRows(store)
      .filter((item) => item.teamId === teamId && item.callRecordId === callRecordId)
      .map((item) => item.tagId)
  );
  return tagRows(store)
    .filter((item) => item.teamId === teamId && ids.has(item.id))
    .map(presentTag)
    .sort(compareTags);
}

export function enabledCallTagChoices(
  store: { callTags?: readonly CallTag[] },
  teamId: string
): CallTagView[] {
  return tagRows(store)
    .filter((item) => item.teamId === teamId && item.enabled)
    .map(presentTag)
    .sort(compareTags);
}

/** 筛选用。启用的标签，再加上这一批通话已经打上的标签（含已停用）。 */
export function tagFilterChoices(
  store: { callTags?: readonly CallTag[]; callRecordTags?: readonly CallRecordTag[] },
  teamId: string,
  recordIds: readonly string[]
): CallTagView[] {
  const wanted = new Set(recordIds);
  const ids = new Set<string>();
  for (const tag of tagRows(store)) {
    if (tag.teamId === teamId && tag.enabled) ids.add(tag.id);
  }
  for (const link of linkRows(store)) {
    if (link.teamId === teamId && wanted.has(link.callRecordId)) ids.add(link.tagId);
  }
  return tagRows(store)
    .filter((item) => item.teamId === teamId && ids.has(item.id))
    .map(presentTag)
    .sort(compareTags);
}

export function recordsMatchingCallTag<T extends { id: string }>(
  records: T[],
  tag: string | null,
  links: readonly Pick<CallRecordTag, "teamId" | "callRecordId" | "tagId">[],
  teamId: string
) {
  if (!tag) return records;
  const mine = links.filter((item) => item.teamId === teamId);
  if (tag === "none") {
    const tagged = new Set(mine.map((item) => item.callRecordId));
    return records.filter((record) => !tagged.has(record.id));
  }
  const matched = new Set(mine.filter((item) => item.tagId === tag).map((item) => item.callRecordId));
  return records.filter((record) => matched.has(record.id));
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
  if (reason === "invalid_name") return `名称必填，最多 ${CALL_TAG_NAME_MAX} 个字符，不能换行`;
  if (reason === "duplicate_name") return "标签名称已存在";
  if (reason === "disabled") return "已停用的标签不能添加或去掉";
  if (reason === "not_found") return "没有这个通话标签";
  if (reason === "forbidden") return "没有操作这条通话记录的权限";
  return "一次只能处理一个通话标签";
}

export function parseCallTagName(value: unknown): string | "bad" {
  if (typeof value !== "string" || /[\r\n]/.test(value)) return "bad";
  const name = value.trim();
  if (!name || Array.from(name).length > CALL_TAG_NAME_MAX) return "bad";
  return name;
}

export function parseCallTagId(value: unknown): string | "bad" {
  if (typeof value !== "string" || !TAG_ID.test(value)) return "bad";
  return value;
}

export function parseCallTagCreate(body: unknown):
  | { ok: true; name: string }
  | { ok: false; reason: "invalid_request" | "invalid_name" } {
  if (!isPlainObject(body) || hasBatchKey(body)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(body).some((key) => key !== "name")) return { ok: false, reason: "invalid_request" };
  const name = parseCallTagName(body.name);
  if (name === "bad") return { ok: false, reason: "invalid_name" };
  return { ok: true, name };
}

export function parseCallTagRename(body: unknown):
  | { ok: true; id: string; name: string }
  | { ok: false; reason: "invalid_request" | "invalid_name" } {
  if (!isPlainObject(body) || hasBatchKey(body)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(body).some((key) => key !== "id" && key !== "name")) return { ok: false, reason: "invalid_request" };
  const id = parseCallTagId(body.id);
  const name = parseCallTagName(body.name);
  if (id === "bad") return { ok: false, reason: "invalid_request" };
  if (name === "bad") return { ok: false, reason: "invalid_name" };
  return { ok: true, id, name };
}

export function parseCallTagDisable(body: unknown):
  | { ok: true; id: string }
  | { ok: false; reason: "invalid_request" } {
  if (!isPlainObject(body) || hasBatchKey(body)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(body).some((key) => key !== "id")) return { ok: false, reason: "invalid_request" };
  const id = parseCallTagId(body.id);
  if (id === "bad") return { ok: false, reason: "invalid_request" };
  return { ok: true, id };
}

export function parseCallRecordTagRequest(body: unknown):
  | { ok: true; tagId: string }
  | { ok: false; reason: "invalid_request" } {
  if (!isPlainObject(body) || hasBatchKey(body)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(body).some((key) => key !== "tagId")) return { ok: false, reason: "invalid_request" };
  if (!("tagId" in body)) return { ok: false, reason: "invalid_request" };
  const tagId = parseCallTagId(body.tagId);
  if (tagId === "bad") return { ok: false, reason: "invalid_request" };
  return { ok: true, tagId };
}

export function parseCallTagQuery(query: Record<string, unknown>):
  | { ok: true }
  | { ok: false; reason: "invalid_request" } {
  if (Object.keys(query).length > 0) return { ok: false, reason: "invalid_request" };
  if (Object.values(query).some((value) => Array.isArray(value))) return { ok: false, reason: "invalid_request" };
  return { ok: true };
}

function canRead(user: SessionUser) {
  return hasIamPermission(user as IamActor, CALL_TAG_PERMISSION);
}

function canView(user: SessionUser) {
  return canManageCallTags(user) || canRead(user);
}

function findTag(store: Pick<CrmStore, "callTags">, teamId: string, id: string) {
  return store.callTags.find((item) => item.teamId === teamId && item.id === id) || null;
}

function findLink(store: Pick<CrmStore, "callRecordTags">, teamId: string, callRecordId: string, tagId: string) {
  return store.callRecordTags.find((item) => item.teamId === teamId && item.callRecordId === callRecordId && item.tagId === tagId) || null;
}

function clipId(value: string) {
  return value.slice(0, 64);
}

async function writeAudit(store: CrmStore, input: Omit<CallTagAudit, "id" | "at">) {
  const audit: CallTagAudit = {
    id: `cta_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.callTagAudits.unshift(audit);
  await store.persist();
  return audit;
}

async function rejectWithAudit(
  store: CrmStore,
  user: SessionUser,
  input: {
    tagId: string;
    callRecordId: string;
    action: CallTagAudit["action"];
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
    tagId: clipId(input.tagId),
    callRecordId: clipId(input.callRecordId),
    action: input.action,
    previousValue: input.previous,
    nextValue: input.next,
    result: "rejected",
    reason: input.reason
  });
  return reject(input.reason, input.message, input.status, input.extra);
}

function catalog(store: Pick<CrmStore, "callTags">, teamId: string, includeDisabled: boolean) {
  return store.callTags
    .filter((item) => item.teamId === teamId && (includeDisabled || item.enabled))
    .map(presentTag)
    .sort(compareTags);
}

export async function listCallTags(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallTagQuery(query);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  if (!canView(user)) {
    return rejectWithAudit(store, user, {
      tagId: "",
      callRecordId: "",
      action: "read",
      previous: "",
      next: "",
      reason: "forbidden",
      message: "当前账号没有执行该业务操作的权限",
      status: 403,
      extra: { permissionCode: CALL_TAG_PERMISSION }
    });
  }
  const manage = canManageCallTags(user);
  return {
    status: 200,
    body: {
      canManage: manage,
      tags: catalog(store, user.teamId, manage)
    }
  };
}

export async function createCallTag(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallTagCreate(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  if (!canView(user)) {
    return rejectWithAudit(store, user, {
      tagId: "",
      callRecordId: "",
      action: "create",
      previous: "",
      next: "",
      reason: "forbidden",
      message: "当前账号没有执行该业务操作的权限",
      status: 403,
      extra: { permissionCode: CALL_TAG_PERMISSION }
    });
  }
  if (!canManageCallTags(user)) {
    return rejectWithAudit(store, user, {
      tagId: "",
      callRecordId: "",
      action: "create",
      previous: "",
      next: "",
      reason: "forbidden",
      message: "只有管理员可以维护通话标签",
      status: 403
    });
  }
  if (store.callTags.some((item) => item.teamId === user.teamId && item.name === parsed.name)) {
    return reject("duplicate_name", validationMessage("duplicate_name"));
  }
  const now = outboundInstant().toISOString();
  const saved: CallTag = {
    id: `ctag_${randomUUID()}`,
    teamId: user.teamId,
    name: parsed.name,
    enabled: true,
    createdBy: user.id,
    updatedBy: user.id,
    createdAt: now,
    updatedAt: now,
    disabledAt: ""
  };
  store.callTags.push(saved);
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    tagId: saved.id,
    callRecordId: "",
    action: "create",
    previousValue: "",
    nextValue: formatCallTagValue(saved),
    result: "updated",
    reason: ""
  });
  return { status: 200, body: { result: "created" as const, message: "已新增通话标签", tag: presentTag(saved) } };
}

export async function renameCallTag(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallTagRename(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  const current = findTag(store, user.teamId, parsed.id);
  const previous = formatCallTagValue(current);
  const next = formatCallTagValue(current ? { ...current, name: parsed.name } : null);
  if (!canView(user)) {
    return rejectWithAudit(store, user, {
      tagId: current?.id || "",
      callRecordId: "",
      action: "rename",
      previous,
      next,
      reason: "forbidden",
      message: "当前账号没有执行该业务操作的权限",
      status: 403,
      extra: { permissionCode: CALL_TAG_PERMISSION }
    });
  }
  if (!canManageCallTags(user)) {
    return rejectWithAudit(store, user, {
      tagId: current?.id || "",
      callRecordId: "",
      action: "rename",
      previous,
      next,
      reason: "forbidden",
      message: "只有管理员可以维护通话标签",
      status: 403
    });
  }
  if (!current) {
    return rejectWithAudit(store, user, {
      tagId: "",
      callRecordId: "",
      action: "rename",
      previous: "",
      next: "",
      reason: "not_found",
      message: validationMessage("not_found"),
      status: 404
    });
  }
  if (current.name === parsed.name) {
    return { status: 200, body: { result: "unchanged" as const, message: "通话标签没有变化", tag: presentTag(current) } };
  }
  if (store.callTags.some((item) => item.teamId === user.teamId && item.name === parsed.name && item.id !== current.id)) {
    return reject("duplicate_name", validationMessage("duplicate_name"));
  }
  current.name = parsed.name;
  current.updatedBy = user.id;
  current.updatedAt = outboundInstant().toISOString();
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    tagId: current.id,
    callRecordId: "",
    action: "rename",
    previousValue: previous,
    nextValue: formatCallTagValue(current),
    result: "updated",
    reason: ""
  });
  return { status: 200, body: { result: "renamed" as const, message: "已重命名通话标签", tag: presentTag(current) } };
}

export async function disableCallTag(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallTagDisable(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  const current = findTag(store, user.teamId, parsed.id);
  const previous = formatCallTagValue(current);
  const next = formatCallTagValue(current ? { ...current, enabled: false } : null);
  if (!canView(user)) {
    return rejectWithAudit(store, user, {
      tagId: current?.id || "",
      callRecordId: "",
      action: "disable",
      previous,
      next,
      reason: "forbidden",
      message: "当前账号没有执行该业务操作的权限",
      status: 403,
      extra: { permissionCode: CALL_TAG_PERMISSION }
    });
  }
  if (!canManageCallTags(user)) {
    return rejectWithAudit(store, user, {
      tagId: current?.id || "",
      callRecordId: "",
      action: "disable",
      previous,
      next,
      reason: "forbidden",
      message: "只有管理员可以维护通话标签",
      status: 403
    });
  }
  if (!current) {
    return rejectWithAudit(store, user, {
      tagId: "",
      callRecordId: "",
      action: "disable",
      previous: "",
      next: "",
      reason: "not_found",
      message: validationMessage("not_found"),
      status: 404
    });
  }
  if (!current.enabled) {
    return { status: 200, body: { result: "unchanged" as const, message: "通话标签没有变化", tag: presentTag(current) } };
  }
  const now = outboundInstant().toISOString();
  current.enabled = false;
  current.disabledAt = now;
  current.updatedBy = user.id;
  current.updatedAt = now;
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    tagId: current.id,
    callRecordId: "",
    action: "disable",
    previousValue: previous,
    nextValue: formatCallTagValue(current),
    result: "updated",
    reason: ""
  });
  return { status: 200, body: { result: "disabled" as const, message: "已停用通话标签", tag: presentTag(current) } };
}

function sameTeamRecord(store: CrmStore, teamId: string, callRecordId: string) {
  return store.outboundCallRecords.find((item) => item.id === callRecordId && item.teamId === teamId);
}

function presented(store: CrmStore, record: OutboundCallRecord, access: { timeZone: string; labels: Map<string, string> }) {
  return {
    ...presentOutboundCallRecord(record, access.timeZone, access.labels),
    callTags: callTagsOnRecord(store, record.teamId, record.id)
  };
}

export async function addCallRecordTag(
  store: CrmStore,
  user: SessionUser | undefined,
  callRecordId: string,
  body: unknown
) {
  return changeCallRecordTag(store, user, callRecordId, body, "add");
}

export async function removeCallRecordTag(
  store: CrmStore,
  user: SessionUser | undefined,
  callRecordId: string,
  body: unknown
) {
  return changeCallRecordTag(store, user, callRecordId, body, "remove");
}

async function changeCallRecordTag(
  store: CrmStore,
  user: SessionUser | undefined,
  callRecordId: string,
  body: unknown,
  action: "add" | "remove"
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallRecordTagRequest(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  const local = sameTeamRecord(store, user.teamId, callRecordId);
  const visible = resolved.ok && Boolean(local) && outboundCallRecordVisible(local!, user.teamId, resolved.access);
  if (!visible || !local || !resolved.ok) {
    return rejectWithAudit(store, user, {
      tagId: parsed.tagId,
      callRecordId,
      action,
      previous: "",
      next: "",
      reason: "forbidden",
      message: validationMessage("forbidden"),
      status: 403
    });
  }
  const tag = findTag(store, user.teamId, parsed.tagId);
  if (!tag) {
    return rejectWithAudit(store, user, {
      tagId: parsed.tagId,
      callRecordId: local.id,
      action,
      previous: "",
      next: "",
      reason: "not_found",
      message: validationMessage("not_found"),
      status: 404
    });
  }
  const link = findLink(store, user.teamId, local.id, tag.id);
  if (!tag.enabled && !(action === "add" && link)) {
    return reject("disabled", validationMessage("disabled"));
  }
  if (action === "add" && link) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: "这条通话的标签没有变化",
        callRecordId: local.id,
        tagId: tag.id,
        record: presented(store, local, resolved.access)
      }
    };
  }
  if (action === "remove" && !link) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: "这条通话的标签没有变化",
        callRecordId: local.id,
        tagId: tag.id,
        record: presented(store, local, resolved.access)
      }
    };
  }
  const snapshot = formatCallTagValue(tag);
  if (action === "add") {
    const row: CallRecordTag = {
      id: `crt_${randomUUID()}`,
      teamId: user.teamId,
      callRecordId: local.id,
      tagId: tag.id,
      createdBy: user.id,
      createdAt: outboundInstant().toISOString()
    };
    store.callRecordTags.push(row);
  } else if (link) {
    store.callRecordTags = store.callRecordTags.filter((item) => item.id !== link.id);
  }
  const audit = await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    tagId: tag.id,
    callRecordId: local.id,
    action,
    previousValue: action === "remove" ? snapshot : "",
    nextValue: action === "add" ? snapshot : "",
    result: "updated",
    reason: ""
  });
  return {
    status: 200,
    body: {
      result: action === "add" ? "added" as const : "removed" as const,
      message: action === "add" ? "已添加通话标签" : "已去掉通话标签",
      callRecordId: local.id,
      tagId: tag.id,
      auditId: audit.id,
      record: presented(store, local, resolved.access)
    }
  };
}
