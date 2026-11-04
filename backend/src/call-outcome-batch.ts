import { randomUUID } from "node:crypto";
import { displayMaskedNumber } from "./call-wrapup-queue.js";
import { isMoreRecentCall } from "./intent-followup-queue.js";
import { outboundInstant } from "./outbound-call.js";
import {
  CALL_OUTCOME_NOTE_MAX,
  callOutcomeNoteLength,
  isCallOutcome,
  isEstablishedCall,
  outboundCallRecordVisible,
  resolveOutboundCallRecordAccess,
  splitAgentIds,
  type CallOutcome,
  type OutboundCallRecordAccess
} from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type { CallOutcomeAudit, OutboundCallRecord, SessionUser } from "./types.js";

/**
 * 工作台里已接通、人工结果还不是五项的通话。
 * 坐席勾选多通，一次标成同一个结果。
 * 结果仍写 callOutcome / callOutcomeNote，审计仍写 call_outcome_audits。
 * 同一次批量共用 batch_id。不另建表。
 * 不拨号，不发信，不调用 AI，不碰抑制或合规。
 */

export const CALL_OUTCOME_BATCH_MAX = 100;
export const UNLABELED_CALL_OUTCOME = "未标注";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ALLOWED_BODY = new Set(["callRecordIds", "outcome", "note"]);

export interface UnlabeledConnectedCallItem {
  callRecordId: string;
  outcome: typeof UNLABELED_CALL_OUTCOME;
  maskedNumber: string;
  agentLabel: string;
  targetType: "" | "customer" | "lead" | "prospect";
  targetId: string;
  targetLabel: string;
  name: string;
  startedAt: string;
}

const TARGET_LABEL: Record<"customer" | "lead" | "prospect", string> = {
  customer: "客户",
  lead: "线索",
  prospect: "搜客"
};

export function canViewTeamUnlabeledConnectedCalls(user: { role?: string } | undefined) {
  return user?.role === "manager" || user?.role === "admin" || user?.role === "super_admin";
}

export function isPendingUnlabeledCall(record: Pick<OutboundCallRecord, "establishedTimeRaw" | "callOutcome">) {
  return isEstablishedCall(record.establishedTimeRaw || "") && !isCallOutcome((record.callOutcome || "").trim());
}

function oneQuery(value: unknown) {
  if (Array.isArray(value)) return null;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value.trim() : null;
}

export function parseUnlabeledConnectedCallQuery(query: Record<string, unknown>): { scope: "mine" | "team" } | null {
  const allowed = new Set(["scope"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) return null;
  if (Object.values(query).some((value) => Array.isArray(value))) return null;
  const scope = oneQuery(query.scope);
  if (scope !== "mine" && scope !== "team") return null;
  return { scope };
}

export function parseCallOutcomeBatchRequest(body: unknown):
  | { ok: true; callRecordIds: string[]; outcome: CallOutcome; note: string }
  | { ok: false; reason: "invalid_request" | "invalid_outcome" | "invalid_note" | "note_too_long" | "too_many" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "invalid_request" };
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !ALLOWED_BODY.has(key))) return { ok: false, reason: "invalid_request" };
  const rawIds = record.callRecordIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) return { ok: false, reason: "invalid_request" };
  if (rawIds.length > CALL_OUTCOME_BATCH_MAX) return { ok: false, reason: "too_many" };
  if (rawIds.some((item) => typeof item !== "string" || !ID_PATTERN.test(item))) {
    return { ok: false, reason: "invalid_request" };
  }
  const callRecordIds = rawIds as string[];
  if (new Set(callRecordIds).size !== callRecordIds.length) return { ok: false, reason: "invalid_request" };
  if (typeof record.outcome !== "string" || !isCallOutcome(record.outcome.trim())) {
    return { ok: false, reason: "invalid_outcome" };
  }
  if (record.note !== undefined && record.note !== null && typeof record.note !== "string") {
    return { ok: false, reason: "invalid_note" };
  }
  const note = typeof record.note === "string" ? record.note.trim() : "";
  if (callOutcomeNoteLength(note) > CALL_OUTCOME_NOTE_MAX) return { ok: false, reason: "note_too_long" };
  return { ok: true, callRecordIds, outcome: record.outcome.trim() as CallOutcome, note };
}

function startedAtIso(startTimeRaw: string) {
  const text = (startTimeRaw || "").trim();
  if (!/^\d+$/.test(text)) return "";
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return at.toISOString();
}

function isTargetType(value: string): value is "customer" | "lead" | "prospect" {
  return value === "customer" || value === "lead" || value === "prospect";
}

function objectName(store: CrmStore, teamId: string, targetType: string, targetId: string) {
  if (!isTargetType(targetType) || !targetId) return { targetType: "" as const, targetId: "", targetLabel: "", name: "" };
  if (targetType === "customer") {
    const customer = store.customers.find((item) => item.teamId === teamId && item.id === targetId);
    return { targetType, targetId, targetLabel: TARGET_LABEL.customer, name: customer?.company || "" };
  }
  if (targetType === "lead") {
    const lead = store.leads.find((item) => item.teamId === teamId && item.id === targetId);
    return { targetType, targetId, targetLabel: TARGET_LABEL.lead, name: lead?.company || "" };
  }
  const candidate = store.websiteOpportunities.find((item) => item.teamId === teamId && item.id === targetId);
  return { targetType, targetId, targetLabel: TARGET_LABEL.prospect, name: candidate?.company || "" };
}

export function buildUnlabeledConnectedCalls(input: {
  teamId: string;
  records: OutboundCallRecord[];
  visible: (record: OutboundCallRecord) => boolean;
  labels: Map<string, string>;
  names: (record: OutboundCallRecord) => { targetType: "" | "customer" | "lead" | "prospect"; targetId: string; targetLabel: string; name: string };
  /** null 表示不按通话坐席收窄。空数组表示当前用户没有映射，我的列表为空。 */
  ownAgentIds: string[] | null;
}): UnlabeledConnectedCallItem[] {
  const own = input.ownAgentIds === null ? null : new Set(input.ownAgentIds);
  const pending = input.records.filter((record) => {
    if (record.teamId !== input.teamId) return false;
    if (!input.visible(record)) return false;
    if (!isPendingUnlabeledCall(record)) return false;
    if (own && !splitAgentIds(record.agentIds || "").some((id) => own.has(id))) return false;
    return true;
  });
  pending.sort((left, right) => {
    if (left.id === right.id) return 0;
    return isMoreRecentCall(left, right) ? -1 : 1;
  });
  return pending.map((record) => {
    const agents = splitAgentIds(record.agentIds || "");
    const named = input.names(record);
    return {
      callRecordId: record.id,
      outcome: UNLABELED_CALL_OUTCOME,
      maskedNumber: displayMaskedNumber(record.maskedNumber || ""),
      agentLabel: agents.map((id) => input.labels.get(id) || id).join("、"),
      targetType: named.targetType,
      targetId: named.targetId,
      targetLabel: named.targetLabel,
      name: named.name,
      startedAt: startedAtIso(record.startTimeRaw || "")
    };
  });
}

function ownAgentIds(store: CrmStore, user: SessionUser, scope: "mine" | "team") {
  if (scope !== "mine") return null;
  return store.aliyunAgentMappings
    .filter((item) => item.teamId === user.teamId && item.crmUserId === user.id && item.cccUserId)
    .map((item) => item.cccUserId);
}

function callsFromStore(
  store: CrmStore,
  user: SessionUser,
  access: OutboundCallRecordAccess,
  scope: "mine" | "team"
) {
  return buildUnlabeledConnectedCalls({
    teamId: user.teamId,
    records: store.outboundCallRecords,
    visible: (record) => outboundCallRecordVisible(record, user.teamId, access),
    labels: access.labels,
    names: (record) => objectName(store, user.teamId, record.targetType, record.targetId),
    ownAgentIds: ownAgentIds(store, user, scope)
  });
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

async function writeAudit(store: CrmStore, input: Omit<CallOutcomeAudit, "id" | "at">) {
  const audit: CallOutcomeAudit = {
    id: input.action === "batch" ? `cob_${randomUUID()}` : `cor_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.callOutcomeAudits.unshift(audit);
  return audit;
}

export async function listUnlabeledConnectedCalls(
  store: CrmStore,
  user: SessionUser | undefined,
  query: Record<string, unknown>
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseUnlabeledConnectedCallQuery(query);
  if (!parsed) return reject("invalid_request", "已接通未标注通话只接受我的或团队");
  if (parsed.scope === "team" && !canViewTeamUnlabeledConnectedCalls(user)) {
    const audit = await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      callRecordId: "",
      previousOutcome: "",
      nextOutcome: "",
      previousNote: "",
      nextNote: "",
      batchId: "",
      action: "read",
      scope: "team",
      rowCount: 0,
      result: "rejected",
      reason: "forbidden"
    });
    await store.persist();
    return {
      status: 403,
      body: { result: "rejected" as const, reason: "forbidden", message: "没有查看团队已接通未标注通话的权限", auditId: audit.id }
    };
  }
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const items = callsFromStore(store, user, resolved.access, parsed.scope);
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    callRecordId: "",
    previousOutcome: "",
    nextOutcome: "",
    previousNote: "",
    nextNote: "",
    batchId: "",
    action: "read",
    scope: parsed.scope,
    rowCount: items.length,
    result: "read",
    reason: ""
  });
  await store.persist();
  return {
    status: 200,
    body: {
      scope: parsed.scope,
      empty: items.length === 0,
      items
    }
  };
}

function batchMessage(reason: "invalid_request" | "invalid_outcome" | "invalid_note" | "note_too_long" | "too_many") {
  if (reason === "note_too_long") return `备注不能超过 ${CALL_OUTCOME_NOTE_MAX} 字`;
  if (reason === "invalid_outcome") return "通话结果不在可选范围内";
  if (reason === "invalid_note") return "备注格式不正确";
  if (reason === "too_many") return `一次最多标注 ${CALL_OUTCOME_BATCH_MAX} 通`;
  return "一次只能把勾选的通话标成同一个结果";
}

export async function labelUnlabeledConnectedCalls(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallOutcomeBatchRequest(body);
  if (!parsed.ok) return reject(parsed.reason, batchMessage(parsed.reason));
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const records: OutboundCallRecord[] = [];
  for (const id of parsed.callRecordIds) {
    const record = store.outboundCallRecords.find((item) => item.id === id);
    if (!record || !outboundCallRecordVisible(record, user.teamId, resolved.access)) {
      return reject("not_found", "有通话不在可以标注的范围内", 404);
    }
    records.push(record);
  }
  if (records.some((record) => !isPendingUnlabeledCall(record))) {
    return reject("not_pending", "有通话不是已接通未标注，这次没有写入");
  }
  const batchId = `batch_${randomUUID()}`;
  const audits: CallOutcomeAudit[] = [];
  for (const record of records) {
    const previousOutcome = record.callOutcome || "";
    const previousNote = record.callOutcomeNote || "";
    record.callOutcome = parsed.outcome;
    record.callOutcomeNote = parsed.note;
    audits.push(await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      callRecordId: record.id,
      previousOutcome,
      nextOutcome: parsed.outcome,
      previousNote,
      nextNote: parsed.note,
      batchId,
      action: "batch",
      scope: "",
      rowCount: records.length,
      result: "updated",
      reason: ""
    }));
  }
  await store.persist();
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message: "已标注所选通话",
      outcome: parsed.outcome,
      note: parsed.note,
      batchId,
      callRecordIds: records.map((record) => record.id),
      auditIds: audits.map((audit) => audit.id)
    }
  };
}
