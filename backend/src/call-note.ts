import { randomUUID } from "node:crypto";
import { outboundInstant } from "./outbound-call.js";
import {
  outboundCallRecordVisible,
  presentOutboundCallRecord,
  resolveOutboundCallRecordAccess
} from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type { CallNoteAudit, SessionUser } from "./types.js";

/**
 * 给一条通话记录填写、修改或清空纪要。
 * 只改本条的正文和要点，并在有变化或越权时写 call_note_audits。
 * 不拨号，不发信，不调用外部接口，不推进序列，不改抑制，不转线索。
 */

export const CALL_NOTE_TAGS = ["需求", "预算", "决策人", "竞品", "异议"] as const;
export type CallNoteTag = (typeof CALL_NOTE_TAGS)[number];
export const CALL_NOTE_MAX = 1000;

const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes"] as const;

export function callNoteLength(note: string) {
  return Array.from(note).length;
}

export function isCallNoteTag(value: string): value is CallNoteTag {
  return (CALL_NOTE_TAGS as readonly string[]).includes(value);
}

export function splitCallNoteTags(value: string) {
  return value.split(",").map((item) => item.trim()).filter((item) => isCallNoteTag(item));
}

export function recordHasCallNote(record: { callNote?: string; callNoteTags?: string }) {
  return Boolean((record.callNote || "").trim() || (record.callNoteTags || "").trim());
}

export function callNoteAction(previousNote: string, previousTags: string, nextNote: string, nextTags: string): CallNoteAudit["action"] {
  const had = Boolean(previousNote || previousTags);
  const has = Boolean(nextNote || nextTags);
  if (!has) return "clear";
  if (!had) return "create";
  return "update";
}

export function normalizeCallNoteText(value: unknown):
  | { ok: true; note: string }
  | { ok: false; reason: "invalid_note" | "note_too_long" } {
  if (value === undefined || value === null) return { ok: true, note: "" };
  if (typeof value !== "string") return { ok: false, reason: "invalid_note" };
  const note = value.trim();
  if (callNoteLength(note) > CALL_NOTE_MAX) return { ok: false, reason: "note_too_long" };
  return { ok: true, note };
}

export function normalizeCallNoteTags(value: unknown):
  | { ok: true; tags: string }
  | { ok: false; reason: "invalid_tags" } {
  if (value === undefined || value === null) return { ok: true, tags: "" };
  if (!Array.isArray(value)) return { ok: false, reason: "invalid_tags" };
  const picked = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !isCallNoteTag(item)) return { ok: false, reason: "invalid_tags" };
    picked.add(item);
  }
  return { ok: true, tags: CALL_NOTE_TAGS.filter((item) => picked.has(item)).join(",") };
}

export function parseCallNoteRequest(body: unknown):
  | { ok: true; note: string; tags: string }
  | { ok: false; reason: "invalid_request" | "invalid_note" | "note_too_long" | "invalid_tags" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "invalid_request" };
  }
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(record).some((key) => key !== "note" && key !== "tags")) {
    return { ok: false, reason: "invalid_request" };
  }
  const note = normalizeCallNoteText(record.note);
  if (!note.ok) return note;
  const tags = normalizeCallNoteTags(record.tags);
  if (!tags.ok) return tags;
  return { ok: true, note: note.note, tags: tags.tags };
}

export interface CallNoteTimelineEntry {
  callRecordId: string;
  note: string;
  tags: string[];
  at: string;
  maskedNumber: string;
}

/** 客户或线索时间线上当前还有内容的纪要。不另写跟进。 */
export function callNotesForTarget(
  store: CrmStore,
  teamId: string,
  targetType: "customer" | "lead",
  targetId: string
): CallNoteTimelineEntry[] {
  return store.outboundCallRecords
    .filter((record) => (
      record.teamId === teamId
      && record.targetType === targetType
      && record.targetId === targetId
      && recordHasCallNote(record)
    ))
    .map((record) => ({
      callRecordId: record.id,
      note: record.callNote || "",
      tags: splitCallNoteTags(record.callNoteTags || ""),
      at: record.callNoteUpdatedAt || "",
      maskedNumber: record.maskedNumber || ""
    }))
    .sort((left, right) => {
      if (left.at !== right.at) return left.at < right.at ? 1 : -1;
      return left.callRecordId < right.callRecordId ? 1 : -1;
    });
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function validationMessage(reason: string) {
  if (reason === "note_too_long") return `通话纪要不能超过 ${CALL_NOTE_MAX} 字`;
  if (reason === "invalid_note") return "通话纪要格式不正确";
  if (reason === "invalid_tags") return "通话纪要要点不在可选范围内";
  return "一次只能为一条通话记录填写纪要";
}

async function writeAudit(store: CrmStore, input: Omit<CallNoteAudit, "id" | "at">) {
  const audit: CallNoteAudit = {
    id: `cna_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.callNoteAudits.unshift(audit);
  await store.persist();
  return audit;
}

function clipId(value: string) {
  return value.slice(0, 64);
}

async function rejectWithAudit(
  store: CrmStore,
  user: SessionUser,
  input: {
    callRecordId: string;
    previousNote: string;
    previousTags: string;
    nextNote: string;
    nextTags: string;
    reason: string;
    message: string;
  }
) {
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    callRecordId: clipId(input.callRecordId),
    action: callNoteAction(input.previousNote, input.previousTags, input.nextNote, input.nextTags),
    previousNote: input.previousNote,
    nextNote: input.nextNote,
    previousTags: input.previousTags,
    nextTags: input.nextTags,
    result: "rejected",
    reason: input.reason
  });
  return reject(input.reason, input.message, 403);
}

function sameTeamRecord(store: CrmStore, teamId: string, callRecordId: string) {
  return store.outboundCallRecords.find((item) => item.id === callRecordId && item.teamId === teamId);
}

export async function saveCallNote(
  store: CrmStore,
  user: SessionUser | undefined,
  callRecordId: string,
  body: unknown
) {
  if (!user?.id || !user.teamId) {
    return { status: 401, body: { message: "未登录" } };
  }
  const parsed = parseCallNoteRequest(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  const local = sameTeamRecord(store, user.teamId, callRecordId);
  const previousNote = local?.callNote || "";
  const previousTags = local?.callNoteTags || "";
  const visible = resolved.ok && Boolean(local) && outboundCallRecordVisible(local!, user.teamId, resolved.access);
  if (!visible || !local || !resolved.ok) {
    return rejectWithAudit(store, user, {
      callRecordId,
      previousNote: local ? previousNote : "",
      previousTags: local ? previousTags : "",
      nextNote: parsed.note,
      nextTags: parsed.tags,
      reason: "forbidden",
      message: "没有操作这条通话记录的权限"
    });
  }
  if (previousNote === parsed.note && previousTags === parsed.tags) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: "通话纪要没有变化",
        callRecordId: local.id,
        note: parsed.note,
        tags: splitCallNoteTags(parsed.tags),
        record: presentOutboundCallRecord(local, resolved.access.timeZone, resolved.access.labels)
      }
    };
  }
  const action = callNoteAction(previousNote, previousTags, parsed.note, parsed.tags);
  local.callNote = parsed.note;
  local.callNoteTags = parsed.tags;
  local.callNoteUpdatedAt = outboundInstant().toISOString();
  const audit = await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    callRecordId: local.id,
    action,
    previousNote,
    nextNote: parsed.note,
    previousTags,
    nextTags: parsed.tags,
    result: "updated",
    reason: ""
  });
  const message = action === "clear" ? "已清空通话纪要" : action === "create" ? "已保存通话纪要" : "已更新通话纪要";
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message,
      callRecordId: local.id,
      action,
      note: parsed.note,
      tags: splitCallNoteTags(parsed.tags),
      auditId: audit.id,
      record: presentOutboundCallRecord(local, resolved.access.timeZone, resolved.access.labels)
    }
  };
}
