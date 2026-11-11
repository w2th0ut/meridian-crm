import { randomUUID } from "node:crypto";
import {
  isSameDayFollowChoice,
  planCallOutcomeNextFollow,
  planExplicitCallOutcomeNextFollow,
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
import { normalizeProspectNextFollowAt, ProspectFollowUpError } from "./prospect-follow-up.js";
import { appendOwnerReassignAudit } from "./owner-reassign-audit.js";
import {
  CALL_OUTCOME_NOTE_MAX,
  callOutcomeNoteLength,
  isCallOutcome,
  isEstablishedCall,
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
 * 未接通还可以选 2 小时后或 4 小时后。已接通不能选。不撤销暂停，也不拨号。
 * 号码错误可以同时把这一通对上的号码标为无效，并在首选正是它时改到另一个有效号码。
 * 可以同时把关联对象的负责人转给同租户的另一位同事。不选则不改负责人。
 * 只改本条的 callOutcome 和 callOutcomeNote，以及该对象已有的下次跟进、无效号、首选和 ownerId。
 * 结果正好是「未标注」时，把人工标注清空成空字符串，不另存第六项。空字符串和其他文字仍拒绝。
 * preserveNote 为 true 时不改原来的备注。不带时，省略备注仍是没有备注。
 * 行内登记可以另带租户当地的墙上时间，或显式清空下次跟进。不带则不改原来的下次跟进。
 * 不拨号，不发信，不推进序列，不解除抑制，不转线索。
 */

export const CALL_OUTCOME_CLEAR_LABEL = "未标注";

export type QueueInlineNextFollow =
  | { kind: "omit" }
  | { kind: "set"; value: string }
  | { kind: "clear" };

/**
 * 行内登记把「未标注」当成清空，并可以要求保留备注。
 * 清空在交给原来的解析前换成一项合法结果，真正写入时仍是空字符串。
 * 不带 preserveNote 时，请求体保持原样。
 * inlineNextFollow 是租户当地的 YYYY-MM-DD HH:mm。空着或不带就是不改下次跟进。
 * clearInlineNextFollow 为 true 才清空。不接受再带手填的 nextFollowAt。
 */
export function prepareQueueCallOutcomeWrite(body: unknown):
  | { ok: true; body: unknown; clearing: boolean; preserveNote: boolean; inlineNextFollow: QueueInlineNextFollow }
  | { ok: false; reason: "invalid_request" | "invalid_next_follow" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: true, body, clearing: false, preserveNote: false, inlineNextFollow: { kind: "omit" } };
  }
  const record = { ...(body as Record<string, unknown>) };
  let preserveNote = false;
  if ("preserveNote" in record) {
    if (record.preserveNote !== true && record.preserveNote !== false) {
      return { ok: false, reason: "invalid_request" };
    }
    preserveNote = record.preserveNote === true;
    delete record.preserveNote;
  }
  const inline = readInlineNextFollow(record);
  if (!inline.ok) return inline;
  delete record.inlineNextFollow;
  delete record.clearInlineNextFollow;
  const outcome = typeof record.outcome === "string" ? record.outcome.trim() : "";
  const clearing = outcome === CALL_OUTCOME_CLEAR_LABEL;
  if (clearing) record.outcome = "其他";
  return { ok: true, body: record, clearing, preserveNote, inlineNextFollow: inline.follow };
}

function readInlineNextFollow(record: Record<string, unknown>):
  | { ok: true; follow: QueueInlineNextFollow }
  | { ok: false; reason: "invalid_request" | "invalid_next_follow" } {
  const hasTime = "inlineNextFollow" in record;
  const hasClear = "clearInlineNextFollow" in record;
  if (!hasTime && !hasClear) return { ok: true, follow: { kind: "omit" } };
  if (hasClear && record.clearInlineNextFollow !== true && record.clearInlineNextFollow !== false) {
    return { ok: false, reason: "invalid_request" };
  }
  if (hasTime && record.inlineNextFollow !== null && typeof record.inlineNextFollow !== "string") {
    return { ok: false, reason: "invalid_request" };
  }
  const clear = record.clearInlineNextFollow === true;
  const raw = typeof record.inlineNextFollow === "string" ? record.inlineNextFollow.trim() : "";
  if (clear && raw) return { ok: false, reason: "invalid_request" };
  if (clear) return { ok: true, follow: { kind: "clear" } };
  if (!raw) return { ok: true, follow: { kind: "omit" } };
  try {
    return { ok: true, follow: { kind: "set", value: normalizeProspectNextFollowAt(raw) } };
  } catch (error) {
    if (error instanceof ProspectFollowUpError) return { ok: false, reason: "invalid_next_follow" };
    throw error;
  }
}

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
  const prepared = prepareQueueCallOutcomeWrite(body);
  if (!prepared.ok) {
    if (prepared.reason === "invalid_next_follow") {
      return reject("invalid_next_follow", "下次跟进时间请用日期和时间，例如 2026-10-30 15:30");
    }
    return reject("invalid_request", "一次只能为一条通话记录标注结果");
  }
  const parsed = parseCallOutcomeRequest(prepared.body);
  if (!parsed.ok) {
    const message = parsed.reason === "note_too_long"
      ? `备注不能超过 ${CALL_OUTCOME_NOTE_MAX} 字`
      : parsed.reason === "invalid_outcome"
        ? "通话结果不在可选范围内"
        : parsed.reason === "invalid_note"
          ? "备注格式不正确"
          : parsed.reason === "invalid_next_follow"
            ? "下次跟进只能选明天、3 天后、1 周后、2 小时后、4 小时后或不设"
            : parsed.reason === "invalid_mark"
              ? "只有号码错误可以同时把号码标为无效"
              : "一次只能为一条通话记录标注结果";
    return reject(parsed.reason, message);
  }
  if (prepared.inlineNextFollow.kind !== "omit" && parsed.nextFollowChoice !== "none") {
    return reject("invalid_request", "一次只能为一条通话记录标注结果");
  }
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const record = store.outboundCallRecords.find((item) => item.id === callRecordId);
  if (!record || !outboundCallRecordVisible(record, user.teamId, resolved.access)) {
    return reject("not_found", "通话记录不存在", 404);
  }
  if (isSameDayFollowChoice(parsed.nextFollowChoice) && isEstablishedCall(record.establishedTimeRaw)) {
    return reject("not_unanswered", "只有未接通的通话可以选 2 小时后或 4 小时后");
  }
  const now = outboundInstant();
  const follow = prepared.inlineNextFollow.kind === "omit"
    ? await planCallOutcomeNextFollow(store, user, record, parsed.nextFollowChoice, now)
    : await planExplicitCallOutcomeNextFollow(
      store,
      user,
      record,
      prepared.inlineNextFollow.kind === "clear" ? "" : prepared.inlineNextFollow.value,
      now
    );
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
  const writtenOutcome = prepared.clearing ? "" : parsed.outcome;
  const writtenNote = prepared.preserveNote ? previousNote : parsed.note;
  const outcomeChanged = previousOutcome !== writtenOutcome || previousNote !== writtenNote;
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
        outcome: writtenOutcome,
        note: writtenNote,
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
    record.callOutcome = writtenOutcome;
    record.callOutcomeNote = writtenNote;
    auditId = writeOutcomeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      callRecordId: record.id,
      previousOutcome,
      nextOutcome: writtenOutcome,
      previousNote,
      nextNote: writtenNote
    }).id;
  }
  if (followChanged && follow.kind === "write") {
    appendNextFollowUpAudit(store, {
      actorId: user.id,
      objectType: follow.objectType,
      objectId: follow.objectId,
      action: follow.next ? "set_next_follow_up" : "clear_next_follow_up",
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
  const followText = !followChanged
    ? ""
    : follow.kind === "write" && follow.next === ""
      ? "已清除下次跟进"
      : "已记下下次跟进";
  const baseMessage = !validityChanged && preferredSwitchResult !== "updated" && preferredSwitchResult !== "cleared"
    ? outcomeChanged && followChanged
      ? followText === "已清除下次跟进"
        ? "已保存通话结果，已清除下次跟进"
        : "已保存通话结果，并记下下次跟进"
      : followText || "已保存通话结果"
    : [
      outcomeChanged ? "已保存通话结果" : "",
      followText,
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
      outcome: writtenOutcome,
      note: writtenNote,
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
