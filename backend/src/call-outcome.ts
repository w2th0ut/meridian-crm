import { randomUUID } from "node:crypto";
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
 * 只改本条的 callOutcome 和 callOutcomeNote，并在有变化时写 call_outcome_audits。
 * 不拨号，不发信，不推进序列，不解除抑制，不转线索。
 */

const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "outcomes"] as const;

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
  | { ok: true; outcome: CallOutcome; note: string }
  | { ok: false; reason: "invalid_request" | "invalid_outcome" | "invalid_note" | "note_too_long" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "invalid_request" };
  }
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return { ok: false, reason: "invalid_request" };
  if (typeof record.outcome !== "string" || !isCallOutcome(record.outcome.trim())) {
    return { ok: false, reason: "invalid_outcome" };
  }
  const note = normalizeCallOutcomeNote(record.note);
  if (!note.ok) return note;
  return { ok: true, outcome: record.outcome.trim() as CallOutcome, note: note.note };
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

async function writeAudit(store: CrmStore, input: Omit<CallOutcomeAudit, "id" | "at">) {
  const audit: CallOutcomeAudit = {
    id: `coa_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.callOutcomeAudits.unshift(audit);
  await store.persist();
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
          : "一次只能为一条通话记录标注结果";
    return reject(parsed.reason, message);
  }
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const record = store.outboundCallRecords.find((item) => item.id === callRecordId);
  if (!record || !outboundCallRecordVisible(record, user.teamId, resolved.access)) {
    return reject("not_found", "通话记录不存在", 404);
  }
  const previousOutcome = record.callOutcome || "";
  const previousNote = record.callOutcomeNote || "";
  if (previousOutcome === parsed.outcome && previousNote === parsed.note) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: "标注没有变化",
        callRecordId: record.id,
        outcome: parsed.outcome,
        note: parsed.note
      }
    };
  }
  record.callOutcome = parsed.outcome;
  record.callOutcomeNote = parsed.note;
  const audit = await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    callRecordId: record.id,
    previousOutcome,
    nextOutcome: parsed.outcome,
    previousNote,
    nextNote: parsed.note
  });
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message: "已保存通话结果",
      callRecordId: record.id,
      outcome: parsed.outcome,
      note: parsed.note,
      auditId: audit.id,
      record: presentOutboundCallRecord(record, resolved.access.timeZone, resolved.access.labels)
    }
  };
}
