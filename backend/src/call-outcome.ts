import { randomUUID } from "node:crypto";
import {
  planCallOutcomeNextFollow,
  parseCallOutcomeNextFollowChoice,
  type CallOutcomeNextFollowChoice
} from "./call-outcome-next-follow.js";
import { parseCallOutcomeTransfer, planCallOutcomeTransfer } from "./call-outcome-transfer.js";
import {
  appendWrongNumberRejection,
  parseMarkNumberInvalid,
  planWrongNumberInvalid,
  type WrongNumberEffect
} from "./call-outcome-wrong-number.js";
import { appendNextFollowUpAudit } from "./next-follow-up-audit.js";
import { appendOwnerReassignAudit } from "./owner-reassign-audit.js";
import {
  CALL_OUTCOME_NOTE_MAX,
  callOutcomeNoteLength,
  isCallOutcome,
  outboundCallRecordVisible,
  presentOutboundCallRecord,
  resolveOutboundCallRecordAccess,
  type CallOutcome
} from "./outbound-call-records.js";
import { outboundInstant } from "./outbound-call.js";
import type { CrmStore } from "./store.js";
import type { CallOutcomeAudit, SessionUser } from "./types.js";

/**
 * 给一条通话记录标注结果。
 * 可以同时按明天、3 天后、1 周后写下关联对象的下次跟进。不设则不改下次跟进。
 * 号码错误可以同时把这一通对上的号码标为无效，并在首选正是它时改到另一个有效号码。
 * 可以同时把关联对象的负责人转给同租户的另一位同事。不选则不改负责人。
 * 只改本条的 callOutcome 和 callOutcomeNote，以及该对象已有的下次跟进、无效号、首选和 ownerId。
 * 不拨号，不发信，不推进序列，不解除抑制，不转线索。
 */

const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "outcomes", "phones", "phoneIds", "ownerIds", "assignees", "users"] as const;

export function normalizeCallOutcomeNote(value: unknown):
  | { ok: true; note: string }
  | { ok: false; reason: "invalid_note" | "note_too_long" } {
  if (value === undefined || value === null) return { ok: true, note: "" };
  if (typeof value !== "string") return { ok: false, reason: "invalid_note" };
  const note = value.trim();
  if (callOutcomeNoteLength(note) > CALL_OUTCOME_NOTE_MAX) return { ok: false, reason: "note_too_long" };
  return { ok: true, note };
}

export function parseCallOutcomeRequest(body: unknown):
  | { ok: true; outcome: CallOutcome; note: string; nextFollowChoice: CallOutcomeNextFollowChoice; markNumberInvalid: boolean; transferTo: string }
  | { ok: false; reason: "invalid_request" | "invalid_outcome" | "invalid_note" | "note_too_long" | "invalid_next_follow" | "invalid_mark" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "invalid_request" };
  }
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record) || "nextFollowAt" in record) return { ok: false, reason: "invalid_request" };
  if (typeof record.outcome !== "string" || !isCallOutcome(record.outcome.trim())) {
    return { ok: false, reason: "invalid_outcome" };
  }
  const note = normalizeCallOutcomeNote(record.note);
  if (!note.ok) return note;
  const choice = parseCallOutcomeNextFollowChoice(record.nextFollowChoice);
  if (!choice.ok) return { ok: false, reason: "invalid_next_follow" };
  const outcome = record.outcome.trim();
  const mark = parseMarkNumberInvalid(outcome, record.markNumberInvalid);
  if (!mark.ok) return { ok: false, reason: mark.reason };
  const transfer = parseCallOutcomeTransfer(record.transferTo);
  if (!transfer.ok) return { ok: false, reason: transfer.reason };
  return {
    ok: true,
    outcome: outcome as CallOutcome,
    note: note.note,
    nextFollowChoice: choice.choice,
    markNumberInvalid: mark.mark,
    transferTo: transfer.transferTo
  };
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function writeOutcomeAudit(store: CrmStore, input: Omit<CallOutcomeAudit, "id" | "at">) {
  const audit: CallOutcomeAudit = {
    id: `coa_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.callOutcomeAudits.unshift(audit);
  return audit;
}

export async function labelCallOutcome(
  store: CrmStore,
  user: SessionUser | undefined,
  callRecordId: string,
  body: unknown
) {
  if (!user?.id || !user.teamId) {
    return { status: 401, body: { message: "未登录" } };
  }
  const parsed = parseCallOutcomeRequest(body);
  if (!parsed.ok) {
    const message = parsed.reason === "note_too_long"
      ? `备注不能超过 ${CALL_OUTCOME_NOTE_MAX} 字`
      : parsed.reason === "invalid_outcome"
        ? "通话结果不在可选范围内"
        : parsed.reason === "invalid_note"
          ? "备注格式不正确"
          : parsed.reason === "invalid_next_follow"
            ? "下次跟进只能选明天、3 天后、1 周后或不设"
            : parsed.reason === "invalid_mark"
              ? "只有号码错误可以同时把号码标为无效"
              : "一次只能为一条通话记录标注结果";
    return reject(parsed.reason, message);
  }
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const record = store.outboundCallRecords.find((item) => item.id === callRecordId);
  if (!record || !outboundCallRecordVisible(record, user.teamId, resolved.access)) {
    return reject("not_found", "通话记录不存在", 404);
  }
  const now = outboundInstant();
  const follow = await planCallOutcomeNextFollow(store, user, record, parsed.nextFollowChoice, now);
  if (!follow.ok) {
    if (follow.audit) {
      appendNextFollowUpAudit(store, {
        actorId: user.id,
        objectType: follow.audit.objectType,
        objectId: follow.audit.objectId,
        action: follow.audit.action,
        oldValue: "",
        newValue: "",
        callRecordId: record.id,
        at: now.toISOString()
      });
      await store.persist();
    }
    return reject(follow.reason, follow.message, follow.status);
  }
  const wrong = parsed.markNumberInvalid
    ? await planWrongNumberInvalid(store, user, record)
    : { ok: true as const, kind: "skip" as const };
  if (!wrong.ok) {
    if (wrong.audit) {
      appendWrongNumberRejection(store, user, record.id, wrong.audit);
      await store.persist();
    }
    return reject(wrong.reason, wrong.message, wrong.status);
  }
  const transfer = planCallOutcomeTransfer(store, user, record, parsed.transferTo);
  if (!transfer.ok) {
    if (transfer.audit) {
      appendOwnerReassignAudit(store, {
        actorId: user.id,
        objectType: transfer.audit.objectType,
        objectId: transfer.audit.objectId,
        action: transfer.audit.action,
        previousOwnerId: transfer.audit.previousOwnerId,
        nextOwnerId: transfer.audit.nextOwnerId,
        callRecordId: record.id,
        at: now.toISOString()
      });
      await store.persist();
    }
    return reject(transfer.reason, transfer.message, transfer.status);
  }
  const previousOutcome = record.callOutcome || "";
  const previousNote = record.callOutcomeNote || "";
  const outcomeChanged = previousOutcome !== parsed.outcome || previousNote !== parsed.note;
  const followChanged = follow.kind === "write" && follow.previous !== follow.next;
  const nextFollowAt = follow.kind === "write" ? follow.next : "";
  const nextFollowResult = follow.kind === "skip" ? "skipped" as const : followChanged ? "updated" as const : "unchanged" as const;
  const notice = follow.kind === "write" ? follow.notice : "";
  const markPreview: WrongNumberEffect | null = wrong.kind === "apply" ? wrong.preview() : null;
  const phoneInvalidResult = markPreview?.validity ?? "skipped" as const;
  const preferredSwitchResult = markPreview?.preferred ?? "skipped" as const;
  const validityChanged = phoneInvalidResult === "updated";
  const preferredChanged = preferredSwitchResult === "updated" || preferredSwitchResult === "cleared";
  const ownerChanged = transfer.kind === "write" && transfer.previous !== transfer.next;
  const ownerResult = transfer.kind === "skip" ? "skipped" as const : ownerChanged ? "updated" as const : "unchanged" as const;
  const markFields = {
    markNumberInvalid: parsed.markNumberInvalid,
    phoneInvalidResult,
    preferredSwitchResult,
    ...(wrong.kind === "apply" ? { phoneId: wrong.phoneId } : {})
  };
  const transferFields = {
    transferTo: parsed.transferTo,
    ownerResult,
    ...(transfer.kind === "write" ? { previousOwnerId: transfer.previous, ownerId: transfer.next } : {})
  };
  if (!outcomeChanged && !followChanged && !validityChanged && !preferredChanged && !ownerChanged) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: "标注没有变化",
        callRecordId: record.id,
        outcome: parsed.outcome,
        note: parsed.note,
        nextFollowChoice: parsed.nextFollowChoice,
        nextFollowAt,
        nextFollowResult,
        ...markFields,
        ...transferFields,
        ...(notice ? { suppressionNotice: notice } : {})
      }
    };
  }
  if (followChanged && follow.kind === "write") follow.apply();
  if (wrong.kind === "apply" && (validityChanged || preferredChanged)) wrong.apply();
  if (ownerChanged && transfer.kind === "write") transfer.apply();
  let auditId = "";
  if (outcomeChanged) {
    record.callOutcome = parsed.outcome;
    record.callOutcomeNote = parsed.note;
    auditId = writeOutcomeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      callRecordId: record.id,
      previousOutcome,
      nextOutcome: parsed.outcome,
      previousNote,
      nextNote: parsed.note
    }).id;
  }
  if (followChanged && follow.kind === "write") {
    appendNextFollowUpAudit(store, {
      actorId: user.id,
      objectType: follow.objectType,
      objectId: follow.objectId,
      action: "set_next_follow_up",
      oldValue: follow.previous,
      newValue: follow.next,
      callRecordId: record.id,
      at: now.toISOString()
    });
  }
  if (ownerChanged && transfer.kind === "write") {
    appendOwnerReassignAudit(store, {
      actorId: user.id,
      objectType: transfer.objectType,
      objectId: transfer.objectId,
      action: "reassign_owner",
      previousOwnerId: transfer.previous,
      nextOwnerId: transfer.next,
      callRecordId: record.id,
      at: now.toISOString()
    });
  }
  await store.persist();
  const baseMessage = !validityChanged && preferredSwitchResult !== "updated" && preferredSwitchResult !== "cleared"
    ? outcomeChanged && followChanged
      ? "已保存通话结果，并记下下次跟进"
      : followChanged
        ? "已记下下次跟进"
        : "已保存通话结果"
    : [
      outcomeChanged ? "已保存通话结果" : "",
      followChanged ? "已记下下次跟进" : "",
      validityChanged ? "已把这个号码标为无效" : "",
      preferredSwitchResult === "updated" ? "已把首选改到另一个号码" : "",
      preferredSwitchResult === "cleared" ? "这个号码不再是首选" : ""
    ].filter(Boolean).join("，");
  const message = ownerChanged
    ? baseMessage && baseMessage !== "已保存通话结果"
      ? `${baseMessage}，已转交负责人`
      : outcomeChanged
        ? "已保存通话结果，已转交负责人"
        : "已转交负责人"
    : baseMessage;
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message,
      callRecordId: record.id,
      outcome: parsed.outcome,
      note: parsed.note,
      ...(auditId ? { auditId } : {}),
      nextFollowChoice: parsed.nextFollowChoice,
      nextFollowAt,
      nextFollowResult,
      ...markFields,
      ...transferFields,
      ...(notice ? { suppressionNotice: notice } : {}),
      record: presentOutboundCallRecord(record, resolved.access.timeZone, resolved.access.labels)
    }
  };
}
