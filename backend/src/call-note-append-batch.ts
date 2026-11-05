import { randomUUID } from "node:crypto";
import { hasIamPermission } from "./auth.js";
import { displayMaskedNumber } from "./call-wrapup-queue.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import { collectIntentFollowupRows } from "./intent-followup-queue.js";
import { collectNegativeOutcomeFollowupRows } from "./negative-outcome-followup.js";
import { collectOtherOutcomeFollowupRows } from "./other-outcome-followup.js";
import { outboundInstant } from "./outbound-call.js";
import {
  CALL_OUTCOME_NOTE_MAX,
  callOutcomeNoteLength,
  outboundCallRecordVisible,
  resolveOutboundCallRecordAccess
} from "./outbound-call-records.js";
import { prospectFollowUpWriteAllowed } from "./prospect-follow-up.js";
import type { CrmStore } from "./store.js";
import { collectUnansweredPendingRows } from "./unanswered-pending-queue.js";
import type { CallOutcomeAudit, OutboundCallRecord, SessionUser } from "./types.js";

/**
 * 工作台里已经标了结果的最近一通，以及未接通待处理的最近一通。
 * 坐席勾选最多 100 通，先预览再确认，一次追加同一句备注。
 * 只追加，不覆盖原来的备注，也不改通话结果。
 * 可选一句 §104 常用短语，短语仍读 call_script_templates，不新写短语。
 * 审计仍写 call_outcome_audits，同一次共用已有的 batch_id，动作是 append。
 * 不另建表，也不加列。
 * 有一通看不见，整批不写，也不写审计。有一通无权，整批不改备注，只给无权的写拒绝审计。
 * 不拨号，不发信，不调用 AI，不碰抑制或合规，不新增外呼拦截。
 */

export const CALL_NOTE_APPEND_MAX = 100;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ALLOWED_BODY = new Set(["callRecordIds", "note", "phraseId"]);

export type CallNoteAppendTargetType = "customer" | "lead" | "prospect";

const WRITE_PERMISSION: Record<CallNoteAppendTargetType, string> = {
  customer: "customer.update",
  lead: "lead.update",
  prospect: "prospect.execute"
};

function isTargetType(value: string): value is CallNoteAppendTargetType {
  return value === "customer" || value === "lead" || value === "prospect";
}

function canViewTeam(user: { role?: string } | undefined) {
  return user?.role === "manager" || user?.role === "admin" || user?.role === "super_admin";
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

export function appendCallOutcomeNote(previous: string, addition: string):
  | { status: "ready"; next: string }
  | { status: "too_long" } {
  const base = previous.trim();
  const next = base ? `${base} ${addition}` : addition;
  if (callOutcomeNoteLength(next) > CALL_OUTCOME_NOTE_MAX) return { status: "too_long" };
  return { status: "ready", next };
}

export function parseCallNoteAppendBatch(body: unknown):
  | { ok: true; callRecordIds: string[]; note: string; phraseId: string }
  | { ok: false; reason: "invalid_request" | "invalid_note" | "note_too_long" | "too_many" | "invalid_phrase" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !ALLOWED_BODY.has(key))) return { ok: false, reason: "invalid_request" };
  const rawIds = record.callRecordIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) return { ok: false, reason: "invalid_request" };
  if (rawIds.length > CALL_NOTE_APPEND_MAX) return { ok: false, reason: "too_many" };
  if (rawIds.some((item) => typeof item !== "string" || !ID_PATTERN.test(item))) return { ok: false, reason: "invalid_request" };
  const callRecordIds = rawIds as string[];
  if (new Set(callRecordIds).size !== callRecordIds.length) return { ok: false, reason: "invalid_request" };
  if (record.note !== undefined && record.note !== null && typeof record.note !== "string") return { ok: false, reason: "invalid_note" };
  const note = typeof record.note === "string" ? record.note.trim() : "";
  if (callOutcomeNoteLength(note) > CALL_OUTCOME_NOTE_MAX) return { ok: false, reason: "note_too_long" };
  if (record.phraseId !== undefined && record.phraseId !== null && typeof record.phraseId !== "string") {
    return { ok: false, reason: "invalid_phrase" };
  }
  const phraseId = typeof record.phraseId === "string" ? record.phraseId.trim() : "";
  if (phraseId && !ID_PATTERN.test(phraseId)) return { ok: false, reason: "invalid_phrase" };
  if (!note && !phraseId) return { ok: false, reason: "invalid_request" };
  return { ok: true, callRecordIds, note, phraseId };
}

function parseMessage(reason: "invalid_request" | "invalid_note" | "note_too_long" | "too_many" | "invalid_phrase") {
  if (reason === "too_many") return `一次最多追加 ${CALL_NOTE_APPEND_MAX} 通`;
  if (reason === "note_too_long") return `备注不能超过 ${CALL_OUTCOME_NOTE_MAX} 字`;
  if (reason === "invalid_note") return "备注格式不正确";
  if (reason === "invalid_phrase") return "没有这句可用的常用短语";
  return "请选择通话记录，并写上一句要追加的备注";
}

async function ownerVisible(store: CrmStore, user: SessionUser, permission: string, ownerId: string, teamId: string) {
  if (!hasIamPermission(user, permission)) return false;
  if (store.resolveIamDataScope) {
    const scope = await store.resolveIamDataScope(user, permission);
    return teamId === user.teamId && (scope.tenantWide || scope.ownerIds.includes(ownerId));
  }
  const scopes = user.iamPermissions?.[permission] || [];
  if (scopes.includes("tenant")) return teamId === user.teamId;
  const organizationWide = scopes.includes("org_unit") || scopes.includes("org_subtree");
  const ownerIds = organizationWide
    ? store.users.filter((item) => item.teamId === user.teamId && item.status === "active").map((item) => item.id)
    : scopes.includes("self") ? [user.id] : [];
  return teamId === user.teamId && ownerIds.includes(ownerId);
}

interface EligibleCall {
  callRecordId: string;
  targetType: CallNoteAppendTargetType;
  targetId: string;
  name: string;
  outcomeLabel: string;
  maskedNumber: string;
}

async function eligibleCalls(store: CrmStore, user: SessionUser) {
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return resolved;
  const scope: "mine" | "team" = canViewTeam(user) ? "team" : "mine";
  const rows = new Map<string, EligibleCall>();
  const put = (item: EligibleCall) => {
    if (!item.callRecordId || rows.has(item.callRecordId)) return;
    rows.set(item.callRecordId, item);
  };
  for (const item of collectIntentFollowupRows(store, user, resolved.access)) {
    if (!isTargetType(item.targetType) || item.ignored) continue;
    put({
      callRecordId: item.callRecordId,
      targetType: item.targetType,
      targetId: item.targetId,
      name: item.name || "",
      outcomeLabel: item.outcome || "",
      maskedNumber: displayMaskedNumber(item.maskedNumber || "")
    });
  }
  for (const item of collectNegativeOutcomeFollowupRows(store, user, resolved.access, scope)) {
    if (!isTargetType(item.targetType)) continue;
    put({
      callRecordId: item.callRecordId,
      targetType: item.targetType,
      targetId: item.targetId,
      name: item.name || "",
      outcomeLabel: item.outcome || "",
      maskedNumber: displayMaskedNumber(item.maskedNumber || "")
    });
  }
  for (const item of collectOtherOutcomeFollowupRows(store, user, resolved.access, scope)) {
    if (!isTargetType(item.targetType)) continue;
    put({
      callRecordId: item.callRecordId,
      targetType: item.targetType,
      targetId: item.targetId,
      name: item.name || "",
      outcomeLabel: item.outcome || "",
      maskedNumber: displayMaskedNumber(item.maskedNumber || "")
    });
  }
  for (const item of collectUnansweredPendingRows(store, user, resolved.access, scope)) {
    if (!isTargetType(item.targetType)) continue;
    put({
      callRecordId: item.callRecordId,
      targetType: item.targetType,
      targetId: item.targetId,
      name: item.name || "",
      outcomeLabel: "未接通",
      maskedNumber: displayMaskedNumber(item.maskedNumber || "")
    });
  }
  return { ok: true as const, rows, access: resolved.access };
}

function visibleRecord(store: CrmStore, user: SessionUser, access: { tenantWide: boolean; allowed: Set<string> }, id: string) {
  const record = store.outboundCallRecords.find((item) => item.id === id);
  if (!record || !outboundCallRecordVisible(record, user.teamId, access)) return null;
  return record;
}

type WriteDecision =
  | { kind: "ok" }
  | { kind: "hidden" }
  | { kind: "denied"; status: 403 | 409; reason: "forbidden" | "public_pool" | "not_contactable"; message: string };

async function writeDecision(store: CrmStore, user: SessionUser, targetType: CallNoteAppendTargetType, targetId: string): Promise<WriteDecision> {
  if (targetType === "customer") {
    const customer = store.customers.find((item) => item.id === targetId && item.teamId === user.teamId);
    if (!customer) return { kind: "hidden" };
    if (isPublicCustomer(customer)) {
      return { kind: "denied", status: 409, reason: "public_pool", message: "公池客户为只读，请先领取后再操作" };
    }
    if (!await ownerVisible(store, user, WRITE_PERMISSION.customer, customer.ownerId, user.teamId)) {
      return { kind: "denied", status: 403, reason: "forbidden", message: "没有维护该对象的权限" };
    }
    return { kind: "ok" };
  }
  if (targetType === "lead") {
    const lead = store.leads.find((item) => item.id === targetId && item.teamId === user.teamId && !item.deletedAt);
    if (!lead) return { kind: "hidden" };
    if (!await ownerVisible(store, user, WRITE_PERMISSION.lead, lead.ownerId, user.teamId)) {
      return { kind: "denied", status: 403, reason: "forbidden", message: "没有维护该对象的权限" };
    }
    return { kind: "ok" };
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === targetId && item.teamId === user.teamId);
  if (!candidate) return { kind: "hidden" };
  if (!hasIamPermission(user, WRITE_PERMISSION.prospect) || candidate.ownerId !== user.id) {
    return { kind: "denied", status: 403, reason: "forbidden", message: "没有维护该对象的权限" };
  }
  if (!prospectFollowUpWriteAllowed(store, candidate, user.id)) {
    return { kind: "denied", status: 409, reason: "not_contactable", message: "达到可联系后再补通话备注" };
  }
  return { kind: "ok" };
}

function resolveAddition(store: CrmStore, user: SessionUser, note: string, phraseId: string):
  | { ok: true; text: string }
  | { ok: false; reason: "invalid_request" | "invalid_phrase" } {
  if (!phraseId) return note ? { ok: true, text: note } : { ok: false, reason: "invalid_request" };
  const template = store.callScriptTemplates.find((item) => item.id === phraseId);
  const own = !template?.ownerId || template.ownerId === user.id;
  if (!template || template.teamId !== user.teamId || template.usageKind !== "outcome_note" || !template.enabled || !own) {
    return { ok: false, reason: "invalid_phrase" };
  }
  const text = (template.body || "").trim();
  if (!text || callOutcomeNoteLength(text) > CALL_OUTCOME_NOTE_MAX) return { ok: false, reason: "invalid_phrase" };
  if (note && note !== text) return { ok: false, reason: "invalid_request" };
  return { ok: true, text };
}

interface AppendPlan {
  record: OutboundCallRecord;
  row: EligibleCall;
  previous: string;
  next: string;
  status: "ready" | "too_long";
}

function planFor(record: OutboundCallRecord, row: EligibleCall, addition: string): AppendPlan {
  const previous = record.callOutcomeNote || "";
  const appended = appendCallOutcomeNote(previous, addition);
  if (appended.status === "too_long") {
    return { record, row, previous, next: previous, status: "too_long" };
  }
  return { record, row, previous, next: appended.next, status: "ready" };
}

function previewItem(plan: AppendPlan) {
  return {
    callRecordId: plan.row.callRecordId,
    targetType: plan.row.targetType,
    targetId: plan.row.targetId,
    name: plan.row.name,
    outcome: plan.row.outcomeLabel,
    maskedNumber: plan.row.maskedNumber,
    previousNote: plan.previous,
    nextNote: plan.status === "ready" ? plan.next : plan.previous,
    status: plan.status
  };
}

function writeAudit(store: CrmStore, input: Omit<CallOutcomeAudit, "id" | "at">) {
  const audit: CallOutcomeAudit = {
    id: `cna_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.callOutcomeAudits.unshift(audit);
  return audit;
}

async function screen(store: CrmStore, user: SessionUser, body: unknown, writeRejections: boolean) {
  const parsed = parseCallNoteAppendBatch(body);
  if (!parsed.ok) return { ok: false as const, error: reject(parsed.reason, parseMessage(parsed.reason)) };
  const addition = resolveAddition(store, user, parsed.note, parsed.phraseId);
  if (!addition.ok) {
    return {
      ok: false as const,
      error: reject(addition.reason, addition.reason === "invalid_phrase" ? "没有这句可用的常用短语" : "备注和常用短语不是同一句")
    };
  }
  const listed = await eligibleCalls(store, user);
  if (!listed.ok) return { ok: false as const, error: { status: listed.status, body: listed.body } };
  let hidden = false;
  let notPending = false;
  const chosen: EligibleCall[] = [];
  for (const id of parsed.callRecordIds) {
    const row = listed.rows.get(id);
    if (row) {
      chosen.push(row);
      continue;
    }
    if (!visibleRecord(store, user, listed.access, id)) hidden = true;
    else notPending = true;
  }
  if (hidden) return { ok: false as const, error: reject("not_found", "有通话看不见，这次没有追加", 404) };
  if (notPending) return { ok: false as const, error: reject("not_pending", "有通话不在已标结果或未接通待处理里，这次没有追加") };
  const decisions = [];
  for (const row of chosen) {
    decisions.push({ row, decision: await writeDecision(store, user, row.targetType, row.targetId) });
  }
  if (decisions.some((item) => item.decision.kind === "hidden")) {
    return { ok: false as const, error: reject("not_found", "有通话看不见，这次没有追加", 404) };
  }
  const denied = decisions.filter((item) => item.decision.kind === "denied");
  if (denied.length) {
    if (writeRejections) {
      const batchId = `cna_${randomUUID()}`;
      for (const item of denied) {
        if (item.decision.kind !== "denied") continue;
        writeAudit(store, {
          teamId: user.teamId,
          actorId: user.id,
          callRecordId: item.row.callRecordId,
          previousOutcome: "",
          nextOutcome: "",
          previousNote: "",
          nextNote: "",
          batchId,
          action: "append",
          scope: "",
          rowCount: denied.length,
          result: "rejected",
          reason: item.decision.reason
        });
      }
      await store.persist();
    }
    const first = denied[0]?.decision;
    if (!first || first.kind !== "denied") return { ok: false as const, error: reject("forbidden", "没有维护该对象的权限", 403) };
    return { ok: false as const, error: reject(first.reason, first.message, first.status) };
  }
  const plans = chosen.map((row) => {
    const record = store.outboundCallRecords.find((item) => item.id === row.callRecordId);
    if (!record) return null;
    return planFor(record, row, addition.text);
  }).filter((item): item is AppendPlan => Boolean(item));
  if (plans.length !== chosen.length) {
    return { ok: false as const, error: reject("not_found", "有通话看不见，这次没有追加", 404) };
  }
  return { ok: true as const, text: addition.text, plans };
}

export async function previewCallNoteAppendBatch(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const screened = await screen(store, user, body, false);
  if (!screened.ok) return screened.error;
  const items = screened.plans.map((plan) => previewItem(plan));
  const skipped = items.filter((item) => item.status === "too_long");
  return {
    status: 200,
    body: {
      result: "preview" as const,
      message: "已列出将要追加的备注。确认之后才会写下",
      note: screened.text,
      count: items.length - skipped.length,
      skipped: skipped.length,
      items
    }
  };
}

export async function applyCallNoteAppendBatch(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const screened = await screen(store, user, body, true);
  if (!screened.ok) return screened.error;
  const ready = screened.plans.filter((item) => item.status === "ready");
  const skipped = screened.plans.filter((item) => item.status === "too_long").map((plan) => previewItem(plan));
  if (!ready.length) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: "没有放得下的备注",
        count: 0,
        batchId: "",
        note: screened.text,
        skipped
      }
    };
  }
  const batchId = `cna_${randomUUID()}`;
  const items = ready.map((plan) => {
    const previousOutcome = plan.record.callOutcome || "";
    plan.record.callOutcomeNote = plan.next;
    writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      callRecordId: plan.record.id,
      previousOutcome,
      nextOutcome: previousOutcome,
      previousNote: plan.previous,
      nextNote: plan.next,
      batchId,
      action: "append",
      scope: "",
      rowCount: ready.length,
      result: "updated",
      reason: ""
    });
    return previewItem(plan);
  });
  await store.persist();
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message: `已追加 ${items.length} 通备注`,
      batchId,
      note: screened.text,
      count: items.length,
      items,
      skipped
    }
  };
}
