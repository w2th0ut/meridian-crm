import { randomUUID } from "node:crypto";
import { parseCallbackScheduledAt } from "./callback-schedule-state.js";
import { CALL_NOTE_MAX, parseCallNoteRequest, saveCallNote, splitCallNoteTags } from "./call-note.js";
import { labelCallOutcome, parseCallOutcomeRequest } from "./call-outcome.js";
import { addCallRecordTag, callTagsOnRecord, parseCallRecordTagRequest, removeCallRecordTag } from "./call-tag.js";
import { CALL_WRAPUP_TAG_LIMIT } from "./call-wrapup.js";
import { outboundInstant } from "./outbound-call.js";
import {
  CALL_OUTCOME_NOTE_MAX,
  outboundCallRecordVisible,
  resolveOutboundCallRecordAccess
} from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type {
  CallNoteAudit,
  CallOutcomeAudit,
  CallRecordTag,
  CallTagAudit,
  CallWrapupEditAudit,
  CallWrapupEditSnapshot,
  OutboundCallRecord,
  SessionUser
} from "./types.js";

/**
 * 改正一条已经提交成功的通话小结。
 * 只能改纪要正文、通话结果、通话标签和下次跟进时间，并且只在窗口内。
 * 提交过成功小结的人，或主管及以上，才可以改正。
 * 前值和后值写入 call_wrapup_edit_audits。不拨号，不发信，不调用外部接口。
 */

export const CALL_WRAPUP_EDIT_WINDOW_HOURS = 24;
export const CALL_WRAPUP_EDIT_WINDOW_MIN = 1;
export const CALL_WRAPUP_EDIT_WINDOW_MAX = 168;

const BODY_KEYS = new Set(["note", "outcome", "callTag", "callTags", "nextFollowAt"]);
const BATCH_KEYS = [
  "records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes",
  "templates", "templateIds", "scripts", "versions", "versionIds", "favorites",
  "favoriteIds", "scenarios", "scenarioIds", "codes", "names", "tags", "tagIds"
] as const;

export interface CallWrapupEditTagChange {
  tagId: string;
  action: "add" | "remove";
}

export interface ParsedCallWrapupEdit {
  note: string | null;
  outcome: { outcome: string; note: string | null } | null;
  callTags: CallWrapupEditTagChange[];
  nextFollowAt: string | null;
}

type StepResult = { status: number; body: Record<string, unknown> };

function emptySnapshot(): CallWrapupEditSnapshot {
  return { note: "", outcome: "", outcomeNote: "", tagIds: [], nextFollowAt: "" };
}

export function parseCallWrapupEditRequest(body: unknown):
  | { ok: true; edit: ParsedCallWrapupEdit }
  | { ok: false; reason: string; message: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "invalid_request", message: "一次只能改正一条通话小结" };
  }
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) {
    return { ok: false, reason: "invalid_request", message: "一次只能改正一条通话小结" };
  }
  if (Object.keys(record).some((key) => !BODY_KEYS.has(key))) {
    return { ok: false, reason: "invalid_request", message: "一次只能改正一条通话小结" };
  }
  const present = BODY_KEYS.size > 0 && [...BODY_KEYS].some((key) => key in record);
  if (!present) return { ok: false, reason: "invalid_request", message: "请至少改正一项通话小结" };

  let note: string | null = null;
  if ("note" in record) {
    if (typeof record.note !== "string") {
      return { ok: false, reason: "invalid_note", message: "通话纪要格式不正确" };
    }
    const parsed = parseCallNoteRequest({ note: record.note, tags: [] });
    if (!parsed.ok) {
      return {
        ok: false,
        reason: parsed.reason,
        message: parsed.reason === "note_too_long" ? `通话纪要不能超过 ${CALL_NOTE_MAX} 字` : "通话纪要格式不正确"
      };
    }
    note = parsed.note;
  }

  let outcome: { outcome: string; note: string | null } | null = null;
  if ("outcome" in record) {
    if (record.outcome === null || typeof record.outcome !== "object" || Array.isArray(record.outcome)) {
      return { ok: false, reason: "invalid_request", message: "一次只能改正一条通话小结" };
    }
    const raw = record.outcome as Record<string, unknown>;
    if (BATCH_KEYS.some((key) => key in raw)) {
      return { ok: false, reason: "invalid_request", message: "一次只能改正一条通话小结" };
    }
    if (Object.keys(raw).some((key) => key !== "outcome" && key !== "note")) {
      return { ok: false, reason: "invalid_request", message: "一次只能改正一条通话小结" };
    }
    const noteOmitted = !("note" in raw);
    const parsed = parseCallOutcomeRequest(noteOmitted ? { outcome: raw.outcome, note: "" } : raw);
    if (!parsed.ok) {
      const message = parsed.reason === "note_too_long"
        ? `备注不能超过 ${CALL_OUTCOME_NOTE_MAX} 字`
        : parsed.reason === "invalid_outcome"
          ? "通话结果不在可选范围内"
          : parsed.reason === "invalid_note"
            ? "备注格式不正确"
            : "一次只能改正一条通话小结";
      return { ok: false, reason: parsed.reason, message };
    }
    outcome = { outcome: parsed.outcome, note: noteOmitted ? null : parsed.note };
  }

  const tags = parseEditTags(record);
  if (!tags.ok) return tags;

  let nextFollowAt: string | null = null;
  if ("nextFollowAt" in record) {
    const parsed = parseNextFollowAt(record.nextFollowAt);
    if (!parsed.ok) return { ok: false, reason: "invalid_request", message: "下次跟进时间请用日期和时间，例如 2026-10-30 15:30" };
    nextFollowAt = parsed.nextFollowAt;
  }

  return { ok: true, edit: { note, outcome, callTags: tags.callTags, nextFollowAt } };
}

export function parseCallWrapupEditWindowRequest(body: unknown):
  | { ok: true; windowHours: number }
  | { ok: false; reason: "invalid_request"; message: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "invalid_request", message: "改正窗口格式不正确" };
  }
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record) || Object.keys(record).some((key) => key !== "windowHours")) {
    return { ok: false, reason: "invalid_request", message: "改正窗口格式不正确" };
  }
  const hours = record.windowHours;
  if (typeof hours !== "number" || !Number.isInteger(hours) || hours < CALL_WRAPUP_EDIT_WINDOW_MIN || hours > CALL_WRAPUP_EDIT_WINDOW_MAX) {
    return { ok: false, reason: "invalid_request", message: `改正窗口要是 ${CALL_WRAPUP_EDIT_WINDOW_MIN} 到 ${CALL_WRAPUP_EDIT_WINDOW_MAX} 的整数小时` };
  }
  return { ok: true, windowHours: hours };
}

function parseNextFollowAt(value: unknown): { ok: true; nextFollowAt: string } | { ok: false } {
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, nextFollowAt: "" };
  const parsed = parseCallbackScheduledAt(trimmed.replace("T", " "));
  if (!parsed) return { ok: false };
  return { ok: true, nextFollowAt: parsed };
}

function parseEditTagChange(body: unknown):
  | { ok: true; change: CallWrapupEditTagChange }
  | { ok: false; reason: "invalid_request" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(record).some((key) => key !== "tagId" && key !== "action")) return { ok: false, reason: "invalid_request" };
  const parsed = parseCallRecordTagRequest({ tagId: record.tagId });
  if (!parsed.ok) return { ok: false, reason: "invalid_request" };
  if (record.action === undefined) return { ok: true, change: { tagId: parsed.tagId, action: "add" } };
  if (record.action !== "add" && record.action !== "remove") return { ok: false, reason: "invalid_request" };
  return { ok: true, change: { tagId: parsed.tagId, action: record.action } };
}

function parseEditTags(record: Record<string, unknown>):
  | { ok: true; callTags: CallWrapupEditTagChange[] }
  | { ok: false; reason: string; message: string } {
  const callTags: CallWrapupEditTagChange[] = [];
  if ("callTag" in record) {
    const parsed = parseEditTagChange(record.callTag);
    if (!parsed.ok) return { ok: false, reason: "invalid_request", message: "一次只能改正一条通话的标签" };
    callTags.push(parsed.change);
  }
  if ("callTags" in record) {
    if (!Array.isArray(record.callTags) || record.callTags.length === 0) {
      return { ok: false, reason: "invalid_request", message: "一次只能改正一条通话的标签" };
    }
    for (const item of record.callTags) {
      const parsed = parseEditTagChange(item);
      if (!parsed.ok) return { ok: false, reason: "invalid_request", message: "一次只能改正一条通话的标签" };
      callTags.push(parsed.change);
    }
  }
  if (callTags.length > CALL_WRAPUP_TAG_LIMIT) {
    return { ok: false, reason: "too_many_tags", message: `一次最多改正 ${CALL_WRAPUP_TAG_LIMIT} 个通话标签` };
  }
  const seen = new Set<string>();
  for (const change of callTags) {
    if (seen.has(change.tagId)) return { ok: false, reason: "invalid_request", message: "一次不能重复提交同一个通话标签" };
    seen.add(change.tagId);
  }
  return { ok: true, callTags };
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function clipId(value: string) {
  return value.slice(0, 64);
}

export function isCallWrapupEditManager(user: { role?: string } | undefined) {
  return user?.role === "manager" || user?.role === "admin" || user?.role === "super_admin";
}

export function callWrapupEditWindowHours(store: CrmStore, teamId: string) {
  const row = (store.callWrapupEditWindows || []).find((item) => item.teamId === teamId);
  const hours = row?.windowHours;
  if (typeof hours !== "number" || !Number.isInteger(hours) || hours < CALL_WRAPUP_EDIT_WINDOW_MIN || hours > CALL_WRAPUP_EDIT_WINDOW_MAX) {
    return CALL_WRAPUP_EDIT_WINDOW_HOURS;
  }
  return hours;
}

function successfulSubmits(store: CrmStore, teamId: string, callRecordId: string) {
  return (store.callWrapupAudits || []).filter((item) => (
    item.teamId === teamId
    && item.callRecordId === callRecordId
    && item.action === "submit"
    && item.result === "updated"
  ));
}

function earliestSubmitAt(store: CrmStore, teamId: string, callRecordId: string) {
  let earliest: number | null = null;
  for (const item of successfulSubmits(store, teamId, callRecordId)) {
    const time = Date.parse(item.at);
    if (!Number.isFinite(time)) continue;
    if (earliest === null || time < earliest) earliest = time;
  }
  return earliest;
}

function isWrapupOwner(store: CrmStore, user: SessionUser, callRecordId: string) {
  return successfulSubmits(store, user.teamId, callRecordId).some((item) => item.actorId === user.id);
}

function sortTagIds(ids: string[]) {
  return [...ids].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function tagIdsOn(store: CrmStore, record: OutboundCallRecord) {
  return sortTagIds(callTagsOnRecord(store, record.teamId, record.id).map((item) => item.id));
}

function missedLink(store: CrmStore, record: OutboundCallRecord) {
  return (store.outboundMissedFollowUps || []).find((item) => item.teamId === record.teamId && item.callRecordId === record.id) || null;
}

function followTarget(store: CrmStore, record: OutboundCallRecord) {
  if (record.targetType === "customer") {
    const row = store.customers.find((item) => item.id === record.targetId && item.teamId === record.teamId);
    return row ? { kind: "customer" as const, row } : null;
  }
  if (record.targetType === "lead") {
    const row = store.leads.find((item) => item.id === record.targetId && item.teamId === record.teamId && !item.deletedAt);
    return row ? { kind: "lead" as const, row } : null;
  }
  const row = store.websiteOpportunities.find((item) => item.id === record.targetId && item.teamId === record.teamId);
  return row ? { kind: "prospect" as const, row } : null;
}

export function callWrapupNextFollowAt(store: CrmStore, record: OutboundCallRecord) {
  const link = missedLink(store, record);
  if (link) return link.nextFollowAt || "";
  const target = followTarget(store, record);
  if (!target) return "";
  if (target.kind === "customer") return target.row.nextReminder || "";
  return target.row.nextFollowAt || "";
}

function readSnapshot(store: CrmStore, record: OutboundCallRecord): CallWrapupEditSnapshot {
  return {
    note: record.callNote || "",
    outcome: record.callOutcome || "",
    outcomeNote: record.callOutcomeNote || "",
    tagIds: tagIdsOn(store, record),
    nextFollowAt: callWrapupNextFollowAt(store, record)
  };
}

function intendedSnapshot(before: CallWrapupEditSnapshot, edit: ParsedCallWrapupEdit): CallWrapupEditSnapshot {
  const tagIds = new Set(before.tagIds);
  for (const change of edit.callTags) {
    if (change.action === "add") tagIds.add(change.tagId);
    else tagIds.delete(change.tagId);
  }
  return {
    note: edit.note === null ? before.note : edit.note,
    outcome: edit.outcome ? edit.outcome.outcome : before.outcome,
    outcomeNote: edit.outcome ? (edit.outcome.note === null ? before.outcomeNote : edit.outcome.note) : before.outcomeNote,
    tagIds: sortTagIds([...tagIds]),
    nextFollowAt: edit.nextFollowAt === null ? before.nextFollowAt : edit.nextFollowAt
  };
}

function sameSnapshot(left: CallWrapupEditSnapshot, right: CallWrapupEditSnapshot) {
  return left.note === right.note
    && left.outcome === right.outcome
    && left.outcomeNote === right.outcomeNote
    && left.nextFollowAt === right.nextFollowAt
    && left.tagIds.join("\n") === right.tagIds.join("\n");
}

function snapshotJson(snapshot: CallWrapupEditSnapshot) {
  return JSON.stringify({
    note: snapshot.note,
    outcome: snapshot.outcome,
    outcomeNote: snapshot.outcomeNote,
    tagIds: snapshot.tagIds,
    nextFollowAt: snapshot.nextFollowAt
  });
}

export function readCallWrapupEditSnapshot(value: string): CallWrapupEditSnapshot {
  try {
    const parsed = JSON.parse(value) as Partial<CallWrapupEditSnapshot>;
    return {
      note: typeof parsed.note === "string" ? parsed.note : "",
      outcome: typeof parsed.outcome === "string" ? parsed.outcome : "",
      outcomeNote: typeof parsed.outcomeNote === "string" ? parsed.outcomeNote : "",
      tagIds: Array.isArray(parsed.tagIds) ? parsed.tagIds.filter((item): item is string => typeof item === "string") : [],
      nextFollowAt: typeof parsed.nextFollowAt === "string" ? parsed.nextFollowAt : ""
    };
  } catch {
    return emptySnapshot();
  }
}

interface FollowMemory {
  customerId: string;
  customerReminder: string | null;
  leadId: string;
  leadFollow: string | null;
  prospectId: string;
  prospectFollow: string | null;
  missedId: string;
  missedFollow: string | null;
}

interface Snapshot {
  fields: Partial<OutboundCallRecord> | null;
  callOutcomeAudits: CallOutcomeAudit[];
  callNoteAudits: CallNoteAudit[];
  callTagAudits: CallTagAudit[];
  callRecordTags: CallRecordTag[];
  follow: FollowMemory;
}

function capture(store: CrmStore, record: OutboundCallRecord): Snapshot {
  const target = followTarget(store, record);
  const link = missedLink(store, record);
  return {
    fields: {
      callOutcome: record.callOutcome,
      callOutcomeNote: record.callOutcomeNote,
      callNote: record.callNote,
      callNoteTags: record.callNoteTags,
      callNoteUpdatedAt: record.callNoteUpdatedAt,
      updatedAt: record.updatedAt
    },
    callOutcomeAudits: store.callOutcomeAudits.slice(),
    callNoteAudits: store.callNoteAudits.slice(),
    callTagAudits: store.callTagAudits.slice(),
    callRecordTags: store.callRecordTags.slice(),
    follow: {
      customerId: target?.kind === "customer" ? target.row.id : "",
      customerReminder: target?.kind === "customer" ? target.row.nextReminder || "" : null,
      leadId: target?.kind === "lead" ? target.row.id : "",
      leadFollow: target?.kind === "lead" ? target.row.nextFollowAt || "" : null,
      prospectId: target?.kind === "prospect" ? target.row.id : "",
      prospectFollow: target?.kind === "prospect" ? target.row.nextFollowAt || "" : null,
      missedId: link?.id || "",
      missedFollow: link ? link.nextFollowAt || "" : null
    }
  };
}

function restore(store: CrmStore, record: OutboundCallRecord, snapshot: Snapshot) {
  if (snapshot.fields) Object.assign(record, snapshot.fields);
  store.callOutcomeAudits = snapshot.callOutcomeAudits.slice();
  store.callNoteAudits = snapshot.callNoteAudits.slice();
  store.callTagAudits = snapshot.callTagAudits.slice();
  store.callRecordTags = snapshot.callRecordTags.slice();
  const follow = snapshot.follow;
  if (follow.customerReminder !== null) {
    const row = store.customers.find((item) => item.id === follow.customerId);
    if (row) row.nextReminder = follow.customerReminder;
  }
  if (follow.leadFollow !== null) {
    const row = store.leads.find((item) => item.id === follow.leadId);
    if (row) row.nextFollowAt = follow.leadFollow;
  }
  if (follow.prospectFollow !== null) {
    const row = store.websiteOpportunities.find((item) => item.id === follow.prospectId);
    if (row) row.nextFollowAt = follow.prospectFollow;
  }
  if (follow.missedFollow !== null) {
    const row = store.outboundMissedFollowUps.find((item) => item.id === follow.missedId);
    if (row) row.nextFollowAt = follow.missedFollow;
  }
}

function applyNextFollow(store: CrmStore, record: OutboundCallRecord, nextFollowAt: string) {
  const target = followTarget(store, record);
  if (target?.kind === "customer") target.row.nextReminder = nextFollowAt;
  if (target?.kind === "lead") target.row.nextFollowAt = nextFollowAt;
  if (target?.kind === "prospect") target.row.nextFollowAt = nextFollowAt;
  const link = missedLink(store, record);
  if (link) link.nextFollowAt = nextFollowAt;
}

function deferredStore(store: CrmStore) {
  const view = new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "persist") return async () => {};
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) as CrmStore;
  return { view, flush: () => store.persist() };
}

function fingerprint(store: CrmStore) {
  return [store.callOutcomeAudits.length, store.callNoteAudits.length, store.callTagAudits.length].join(":");
}

async function writeAudit(
  store: CrmStore,
  input: Omit<CallWrapupEditAudit, "id" | "at">,
  persist: boolean
) {
  const audit: CallWrapupEditAudit = {
    id: `cwe_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.callWrapupEditAudits.unshift(audit);
  if (persist) await store.persist();
  return audit;
}

function windowState(store: CrmStore, teamId: string, callRecordId: string, now: number) {
  const submittedAt = earliestSubmitAt(store, teamId, callRecordId);
  const windowHours = callWrapupEditWindowHours(store, teamId);
  if (submittedAt === null) {
    return { submitted: false, open: false, windowHours, submittedAt: "", editableUntil: "" };
  }
  const until = submittedAt + windowHours * 60 * 60 * 1000;
  return {
    submitted: true,
    open: now <= until,
    windowHours,
    submittedAt: new Date(submittedAt).toISOString(),
    editableUntil: new Date(until).toISOString()
  };
}

export function presentCallWrapupEdit(store: CrmStore, user: SessionUser, callRecordId: string) {
  const record = store.outboundCallRecords.find((item) => item.id === callRecordId && item.teamId === user.teamId) || null;
  const state = windowState(store, user.teamId, callRecordId, outboundInstant().getTime());
  const history = (store.callWrapupEditAudits || [])
    .filter((item) => item.teamId === user.teamId && item.callRecordId === callRecordId && item.result === "updated")
    .map((item) => ({
      id: item.id,
      at: item.at,
      actorId: item.actorId,
      before: readCallWrapupEditSnapshot(item.beforeJson),
      after: readCallWrapupEditSnapshot(item.afterJson)
    }));
  const owner = record ? isWrapupOwner(store, user, record.id) : false;
  const manager = isCallWrapupEditManager(user);
  let reason = "";
  if (!state.submitted) reason = "not_submitted";
  else if (!owner && !manager) reason = "not_owner";
  else if (!state.open) reason = "window_closed";
  return {
    submitted: state.submitted,
    edited: history.length > 0,
    editable: Boolean(record) && state.submitted && state.open && (owner || manager),
    reason,
    windowHours: state.windowHours,
    submittedAt: state.submittedAt,
    editableUntil: state.editableUntil,
    nextFollowAt: record ? callWrapupNextFollowAt(store, record) : "",
    history
  };
}

export async function setCallWrapupEditWindow(
  store: CrmStore,
  user: SessionUser | undefined,
  body: unknown,
  query: Record<string, unknown> = {}
) {
  if (!user?.id || !user.teamId || user.teamId === "all") return { status: 401, body: { message: "未登录" } };
  if (Object.keys(query).length > 0) return reject("invalid_request", "改正窗口格式不正确");
  const parsed = parseCallWrapupEditWindowRequest(body);
  if (!parsed.ok) return reject(parsed.reason, parsed.message);
  if (!isCallWrapupEditManager(user)) {
    return { status: 403, body: { result: "rejected" as const, reason: "forbidden", message: "只有主管可以修改改正窗口" } };
  }
  const current = store.callWrapupEditWindows.find((item) => item.teamId === user.teamId);
  if (current && current.windowHours === parsed.windowHours) {
    return {
      status: 200,
      body: { result: "unchanged" as const, message: "改正窗口没有变化", windowHours: current.windowHours }
    };
  }
  const now = outboundInstant().toISOString();
  if (current) {
    current.windowHours = parsed.windowHours;
    current.updatedBy = user.id;
    current.updatedAt = now;
  } else {
    store.callWrapupEditWindows.unshift({
      teamId: user.teamId,
      windowHours: parsed.windowHours,
      updatedBy: user.id,
      updatedAt: now
    });
  }
  await store.persist();
  return {
    status: 200,
    body: { result: "updated" as const, message: "已保存改正窗口", windowHours: parsed.windowHours }
  };
}

export async function editCallWrapup(
  store: CrmStore,
  user: SessionUser | undefined,
  callRecordId: string,
  body: unknown,
  query: Record<string, unknown> = {}
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  if (Object.keys(query).length > 0) return reject("invalid_request", "一次只能改正一条通话小结");
  const parsed = parseCallWrapupEditRequest(body);
  if (!parsed.ok) return reject(parsed.reason, parsed.message);

  const resolved = await resolveOutboundCallRecordAccess(store, user);
  const local = store.outboundCallRecords.find((item) => item.id === callRecordId && item.teamId === user.teamId);
  const visible = resolved.ok && Boolean(local) && outboundCallRecordVisible(local!, user.teamId, resolved.access);
  if (!visible || !local || !resolved.ok) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      callRecordId: clipId(callRecordId),
      beforeJson: "{}",
      afterJson: "{}",
      result: "rejected",
      reason: "forbidden"
    }, true);
    const permissionCode = !resolved.ok ? resolved.body.permissionCode : undefined;
    return {
      status: 403,
      body: {
        result: "rejected" as const,
        reason: "forbidden",
        message: "没有操作这条通话记录的权限",
        ...(permissionCode ? { permissionCode } : {})
      }
    };
  }

  const submitted = earliestSubmitAt(store, user.teamId, local.id);
  if (submitted === null) return reject("not_submitted", "这通还没有提交成功的通话小结");

  const before = readSnapshot(store, local);
  const afterIntent = intendedSnapshot(before, parsed.edit);
  const owner = isWrapupOwner(store, user, local.id);
  const manager = isCallWrapupEditManager(user);
  if (!owner && !manager) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      callRecordId: local.id,
      beforeJson: snapshotJson(before),
      afterJson: snapshotJson(afterIntent),
      result: "rejected",
      reason: "not_owner"
    }, true);
    return { status: 403, body: { result: "rejected" as const, reason: "not_owner", message: "只有提交这条小结的人或主管可以改正" } };
  }

  const hours = callWrapupEditWindowHours(store, user.teamId);
  const until = submitted + hours * 60 * 60 * 1000;
  if (outboundInstant().getTime() > until) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      callRecordId: local.id,
      beforeJson: snapshotJson(before),
      afterJson: snapshotJson(afterIntent),
      result: "rejected",
      reason: "window_closed"
    }, true);
    return { status: 400, body: { result: "rejected" as const, reason: "window_closed", message: "已超过通话小结的改正时间" } };
  }

  if (parsed.edit.nextFollowAt !== null && !followTarget(store, local)) {
    return reject("not_found", "这条通话没有关联对象，不能改正下次跟进时间");
  }

  const snapshot = capture(store, local);
  const { view, flush } = deferredStore(store);
  const steps: Array<{ run: () => Promise<StepResult> }> = [];
  if (parsed.edit.outcome) {
    const outcomeBody = {
      outcome: parsed.edit.outcome.outcome,
      note: parsed.edit.outcome.note === null ? local.callOutcomeNote || "" : parsed.edit.outcome.note
    };
    steps.push({ run: () => labelCallOutcome(view, user, local.id, outcomeBody) as Promise<StepResult> });
  }
  if (parsed.edit.note !== null) {
    const noteBody = { note: parsed.edit.note, tags: splitCallNoteTags(local.callNoteTags || "") };
    steps.push({ run: () => saveCallNote(view, user, local.id, noteBody) as Promise<StepResult> });
  }
  for (const change of parsed.edit.callTags) {
    const tagBody = { tagId: change.tagId };
    const run = change.action === "remove"
      ? () => removeCallRecordTag(view, user, local.id, tagBody, { allowDisabledRemove: true }) as Promise<StepResult>
      : () => addCallRecordTag(view, user, local.id, tagBody) as Promise<StepResult>;
    steps.push({ run });
  }

  for (const step of steps) {
    const mark = fingerprint(store);
    const outcome = await step.run();
    if (outcome.status >= 400) {
      const wroteAudit = fingerprint(store) !== mark;
      restore(store, local, snapshot);
      if (!wroteAudit) return outcome;
      const again = await step.run();
      if (again.status < 400) {
        restore(store, local, snapshot);
        return outcome;
      }
      await writeAudit(store, {
        teamId: user.teamId,
        actorId: user.id,
        callRecordId: local.id,
        beforeJson: snapshotJson(before),
        afterJson: snapshotJson(afterIntent),
        result: "rejected",
        reason: typeof outcome.body.reason === "string" ? outcome.body.reason : "rejected"
      }, false);
      await flush();
      return outcome;
    }
  }

  if (parsed.edit.nextFollowAt !== null) applyNextFollow(store, local, parsed.edit.nextFollowAt);
  const after = readSnapshot(store, local);
  if (sameSnapshot(before, after)) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: "通话小结没有变化",
        callRecordId: local.id,
        wrapupEdit: presentCallWrapupEdit(store, user, local.id)
      }
    };
  }

  const audit = await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    callRecordId: local.id,
    beforeJson: snapshotJson(before),
    afterJson: snapshotJson(after),
    result: "updated",
    reason: ""
  }, false);
  await flush();
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message: "已改正通话小结",
      callRecordId: local.id,
      auditId: audit.id,
      wrapupEdit: presentCallWrapupEdit(store, user, local.id)
    }
  };
}
