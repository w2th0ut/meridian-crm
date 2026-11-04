import { randomUUID } from "node:crypto";
import { hasIamPermission } from "./auth.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import { collectIntentFollowupRows } from "./intent-followup-queue.js";
import { appendNextFollowUpAudit } from "./next-follow-up-audit.js";
import { collectOtherOutcomeFollowupRows } from "./other-outcome-followup.js";
import { outboundInstant } from "./outbound-call.js";
import { CALL_OUTCOME_NOTE_MAX, callOutcomeNoteLength, resolveOutboundCallRecordAccess, type OutboundCallRecordAccess } from "./outbound-call-records.js";
import {
  ProspectFollowUpError,
  normalizeProspectNextFollowAt,
  prospectFollowUpWriteAllowed,
  setProspectNextFollowAt
} from "./prospect-follow-up.js";
import type { CrmStore } from "./store.js";
import { collectUnansweredPendingRows } from "./unanswered-pending-queue.js";
import { collectUnlabeledConnectedFollowupRows } from "./unlabeled-connected-followup.js";
import type { NextFollowUpAuditEvent, SessionUser, WebsiteOpportunity } from "./types.js";

/**
 * 工作台里还没有下次跟进的对象，一次写下同一个时间和同一条备注。
 * 只收当前账号看得到的意向回访、未接通待处理、其他结果还没有下次跟进、已接通未标注还没有下次跟进。
 * 下次跟进仍写客户 nextReminder、线索和搜客 nextFollowAt。
 * 有备注时在原来的跟进记录里写一条备注，不改线索状态。没有备注时不新写跟进。
 * 审计仍写 next_follow_up_audits。同一次共用 batch_id。不另建表。
 * 有一个看不见，整批不写。
 * 不拨号，不发信，不调用 AI，不碰抑制或合规。
 */

export const MISSING_NEXT_FOLLOWUP_BATCH_MAX = 100;

const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ALLOWED_BODY = new Set(["targets", "nextFollowAt", "note"]);
const ALLOWED_TARGET = new Set(["targetType", "targetId"]);

export type MissingNextFollowupTargetType = "customer" | "lead" | "prospect";

export interface MissingNextFollowupTarget {
  targetType: MissingNextFollowupTargetType;
  targetId: string;
}

interface PendingRow {
  targetType: MissingNextFollowupTargetType;
  targetId: string;
  suppressionNotice: string;
  previous: string;
}

type WriteFailure = {
  ok: false;
  status: 403 | 409;
  reason: "forbidden" | "public_pool" | "not_contactable";
  message: string;
  target: MissingNextFollowupTarget;
};

function isTargetType(value: string): value is MissingNextFollowupTargetType {
  return value === "customer" || value === "lead" || value === "prospect";
}

function auditObjectType(targetType: MissingNextFollowupTargetType): NextFollowUpAuditEvent["objectType"] {
  if (targetType === "customer") return "customer";
  if (targetType === "lead") return "lead";
  return "prospect_candidate";
}

function clip(value: string) {
  const chars = Array.from(value || "");
  if (chars.length <= CALL_OUTCOME_NOTE_MAX) return value || "";
  return chars.slice(0, CALL_OUTCOME_NOTE_MAX).join("");
}

function keyOf(targetType: string, targetId: string) {
  return `${targetType}:${targetId}`;
}

function canViewTeam(user: { role?: string } | undefined) {
  return user?.role === "manager" || user?.role === "admin" || user?.role === "super_admin";
}

export function parseMissingNextFollowupBatch(body: unknown):
  | { ok: true; targets: MissingNextFollowupTarget[]; nextFollowAt: string; note: string }
  | { ok: false; reason: "invalid_request" | "too_many" | "invalid_note" | "note_too_long" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !ALLOWED_BODY.has(key))) return { ok: false, reason: "invalid_request" };
  if (!Array.isArray(record.targets) || record.targets.length === 0) return { ok: false, reason: "invalid_request" };
  if (record.targets.length > MISSING_NEXT_FOLLOWUP_BATCH_MAX) return { ok: false, reason: "too_many" };
  const targets: MissingNextFollowupTarget[] = [];
  for (const item of record.targets) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return { ok: false, reason: "invalid_request" };
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some((key) => !ALLOWED_TARGET.has(key))) return { ok: false, reason: "invalid_request" };
    if (typeof row.targetType !== "string" || !isTargetType(row.targetType.trim())) return { ok: false, reason: "invalid_request" };
    if (typeof row.targetId !== "string" || !TARGET_ID_PATTERN.test(row.targetId.trim())) return { ok: false, reason: "invalid_request" };
    targets.push({ targetType: row.targetType.trim() as MissingNextFollowupTargetType, targetId: row.targetId.trim() });
  }
  if (new Set(targets.map((item) => keyOf(item.targetType, item.targetId))).size !== targets.length) {
    return { ok: false, reason: "invalid_request" };
  }
  if (typeof record.nextFollowAt !== "string" || !record.nextFollowAt.trim()) return { ok: false, reason: "invalid_request" };
  if (record.note !== undefined && record.note !== null && typeof record.note !== "string") return { ok: false, reason: "invalid_note" };
  const note = typeof record.note === "string" ? record.note.trim() : "";
  if (callOutcomeNoteLength(note) > CALL_OUTCOME_NOTE_MAX) return { ok: false, reason: "note_too_long" };
  return { ok: true, targets, nextFollowAt: record.nextFollowAt, note };
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
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

function pendingRows(store: CrmStore, user: SessionUser, access: OutboundCallRecordAccess) {
  const scope: "mine" | "team" = canViewTeam(user) ? "team" : "mine";
  const rows = new Map<string, PendingRow>();
  const put = (targetType: string, targetId: string, suppressionNotice: string, previous: string) => {
    if (!isTargetType(targetType) || !targetId) return;
    const key = keyOf(targetType, targetId);
    const current = rows.get(key);
    const notice = (suppressionNotice || "").trim();
    if (!current) {
      rows.set(key, { targetType, targetId, suppressionNotice: notice, previous: previous || "" });
      return;
    }
    if (!current.suppressionNotice && notice) current.suppressionNotice = notice;
  };
  for (const item of collectIntentFollowupRows(store, user, access)) {
    put(item.targetType, item.targetId, item.suppressionNotice || "", "");
  }
  for (const item of collectUnansweredPendingRows(store, user, access, scope)) {
    put(item.targetType, item.targetId, "", "");
  }
  for (const item of collectOtherOutcomeFollowupRows(store, user, access, scope)) {
    put(item.targetType, item.targetId, item.suppressionNotice || "", item.nextFollowAt || "");
  }
  for (const item of collectUnlabeledConnectedFollowupRows(store, user, access, scope)) {
    put(item.targetType, item.targetId, item.suppressionNotice || "", item.nextFollowAt || "");
  }
  return rows;
}

async function readable(store: CrmStore, user: SessionUser, target: MissingNextFollowupTarget) {
  if (target.targetType === "customer") {
    const customer = store.customers.find((item) => item.id === target.targetId && item.teamId === user.teamId);
    if (!customer) return false;
    if (isPublicCustomer(customer)) return hasIamPermission(user, "customer.read");
    return ownerVisible(store, user, "customer.read", customer.ownerId, customer.teamId);
  }
  if (target.targetType === "lead") {
    const lead = store.leads.find((item) => item.id === target.targetId && item.teamId === user.teamId && !item.deletedAt);
    if (!lead) return false;
    return ownerVisible(store, user, "lead.read", lead.ownerId, lead.teamId);
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === target.targetId && item.teamId === user.teamId);
  if (!candidate) return false;
  return ownerVisible(store, user, "prospect.read", candidate.ownerId, candidate.teamId);
}

async function checkWrite(store: CrmStore, user: SessionUser, target: MissingNextFollowupTarget): Promise<{ ok: true } | WriteFailure> {
  if (target.targetType === "customer") {
    const customer = store.customers.find((item) => item.id === target.targetId && item.teamId === user.teamId);
    if (!customer) return { ok: false, status: 403, reason: "forbidden", message: "没有维护该客户的权限", target };
    if (isPublicCustomer(customer)) {
      return { ok: false, status: 409, reason: "public_pool", message: "公池客户为只读，请先领取后再操作", target };
    }
    if (!hasIamPermission(user, "customer.update")) {
      return { ok: false, status: 403, reason: "forbidden", message: "没有维护该客户的权限", target };
    }
    if (!await ownerVisible(store, user, "customer.update", customer.ownerId, customer.teamId)) {
      return { ok: false, status: 403, reason: "forbidden", message: "没有维护该客户的权限", target };
    }
    return { ok: true };
  }
  if (target.targetType === "lead") {
    const lead = store.leads.find((item) => item.id === target.targetId && item.teamId === user.teamId && !item.deletedAt);
    if (!lead) return { ok: false, status: 403, reason: "forbidden", message: "没有维护该线索的权限", target };
    if (!hasIamPermission(user, "lead.update")) {
      return { ok: false, status: 403, reason: "forbidden", message: "没有维护该线索的权限", target };
    }
    if (!await ownerVisible(store, user, "lead.update", lead.ownerId, lead.teamId)) {
      return { ok: false, status: 403, reason: "forbidden", message: "没有维护该线索的权限", target };
    }
    return { ok: true };
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === target.targetId && item.teamId === user.teamId);
  if (!candidate) return { ok: false, status: 403, reason: "forbidden", message: "没有执行获客任务的权限", target };
  if (!hasIamPermission(user, "prospect.execute")) {
    return { ok: false, status: 403, reason: "forbidden", message: "没有执行获客任务的权限", target };
  }
  if (!await ownerVisible(store, user, "prospect.execute", candidate.ownerId, candidate.teamId)) {
    return { ok: false, status: 403, reason: "forbidden", message: "没有执行获客任务的权限", target };
  }
  if (candidate.ownerId !== user.id || !prospectFollowUpWriteAllowed(store, candidate, user.id)) {
    return {
      ok: false,
      status: candidate.ownerId !== user.id ? 403 : 409,
      reason: candidate.ownerId !== user.id ? "forbidden" : "not_contactable",
      message: candidate.ownerId !== user.id
        ? "只有候选归属业务员可以记录跟进"
        : candidate.status === "excluded" ? "已排除的候选不在这里记录跟进" : "达到可联系后再记录跟进",
      target
    };
  }
  return { ok: true };
}

function previousFollow(store: CrmStore, user: SessionUser, target: MissingNextFollowupTarget) {
  if (target.targetType === "customer") {
    return store.customers.find((item) => item.id === target.targetId && item.teamId === user.teamId)?.nextReminder || "";
  }
  if (target.targetType === "lead") {
    return store.leads.find((item) => item.id === target.targetId && item.teamId === user.teamId)?.nextFollowAt || "";
  }
  return store.websiteOpportunities.find((item) => item.id === target.targetId && item.teamId === user.teamId)?.nextFollowAt || "";
}

function writeNote(store: CrmStore, user: SessionUser, target: MissingNextFollowupTarget, note: string, nextFollowAt: string, at: string) {
  if (!note) return;
  if (target.targetType === "customer") {
    store.customerActivities.unshift({
      id: `ca_${randomUUID()}`,
      customerId: target.targetId,
      type: "note",
      content: note,
      operatorId: user.id,
      nextReminder: nextFollowAt,
      createdAt: at
    });
    return;
  }
  const candidate = target.targetType === "prospect"
    ? store.websiteOpportunities.find((item) => item.id === target.targetId && item.teamId === user.teamId)
    : undefined;
  const leadId = target.targetType === "lead" ? target.targetId : candidate?.leadId || "";
  store.leadActivities.unshift({
    id: `la_${randomUUID()}`,
    leadId,
    prospectCandidateId: target.targetType === "prospect" ? target.targetId : undefined,
    type: "note",
    content: note,
    operatorId: user.id,
    nextFollowAt,
    createdAt: at
  });
  if (leadId) {
    const lead = store.leads.find((item) => item.id === leadId && item.teamId === user.teamId && !item.deletedAt);
    if (lead && lead.ownerId === user.id) lead.lastActivityAt = "刚刚";
  }
}

function applyFollow(store: CrmStore, user: SessionUser, target: MissingNextFollowupTarget, nextFollowAt: string) {
  if (target.targetType === "customer") {
    const customer = store.customers.find((item) => item.id === target.targetId && item.teamId === user.teamId);
    if (customer) customer.nextReminder = nextFollowAt;
    return;
  }
  if (target.targetType === "lead") {
    const lead = store.leads.find((item) => item.id === target.targetId && item.teamId === user.teamId && !item.deletedAt);
    if (lead) lead.nextFollowAt = nextFollowAt;
    return;
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === target.targetId && item.teamId === user.teamId);
  if (!candidate) return;
  setProspectNextFollowAt(store, { candidate: candidate as WebsiteOpportunity, actorId: user.id, nextFollowAt });
}

function rejectAction(reason: WriteFailure["reason"]): NextFollowUpAuditEvent["action"] {
  if (reason === "public_pool") return "batch_reject_public_pool";
  if (reason === "not_contactable") return "batch_reject_not_contactable";
  return "batch_reject_forbidden";
}

export async function scheduleMissingNextFollowups(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseMissingNextFollowupBatch(body);
  if (!parsed.ok) {
    const message = parsed.reason === "too_many"
      ? "一次最多 100 个对象"
      : parsed.reason === "note_too_long"
        ? "备注最长 200 字"
        : parsed.reason === "invalid_note"
          ? "备注不正确"
          : "请填写下次跟进时间，并选择客户、线索或搜客对象";
    return reject(parsed.reason === "invalid_request" ? "invalid_request" : parsed.reason, message);
  }
  let nextFollowAt = "";
  try {
    nextFollowAt = normalizeProspectNextFollowAt(parsed.nextFollowAt);
  } catch (error) {
    if (error instanceof ProspectFollowUpError) return reject("invalid_request", error.message, error.status);
    throw error;
  }
  if (!nextFollowAt) return reject("invalid_request", "下次跟进时间请用日期和时间，例如 2026-10-30 15:30");
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const visible = pendingRows(store, user, resolved.access);
  const chosen: PendingRow[] = [];
  let hidden = false;
  let notPending = false;
  for (const target of parsed.targets) {
    const row = visible.get(keyOf(target.targetType, target.targetId));
    if (row) {
      chosen.push(row);
      continue;
    }
    if (!await readable(store, user, target)) hidden = true;
    else notPending = true;
  }
  if (hidden) return reject("not_found", "有对象看不见，这次没有写下", 404);
  if (notPending) return reject("not_pending", "有对象不在缺下次跟进的名单里，这次没有写下");
  const failures: WriteFailure[] = [];
  for (const row of chosen) {
    const checked = await checkWrite(store, user, row);
    if (!checked.ok) failures.push(checked);
  }
  if (failures.length) {
    const batchId = `nfb_${randomUUID()}`;
    const at = outboundInstant().toISOString();
    for (const failure of failures) {
      appendNextFollowUpAudit(store, {
        actorId: user.id,
        objectType: auditObjectType(failure.target.targetType),
        objectId: failure.target.targetId,
        action: rejectAction(failure.reason),
        oldValue: "",
        newValue: "",
        batchId,
        at
      });
    }
    await store.persist();
    const first = failures[0];
    return reject(first.reason, first.message, first.status);
  }
  const batchId = `nfb_${randomUUID()}`;
  const at = outboundInstant().toISOString();
  for (const row of chosen) {
    const previous = previousFollow(store, user, row);
    writeNote(store, user, row, parsed.note, nextFollowAt, at);
    applyFollow(store, user, row, nextFollowAt);
    appendNextFollowUpAudit(store, {
      actorId: user.id,
      objectType: auditObjectType(row.targetType),
      objectId: row.targetId,
      action: "batch_set_next_follow_up",
      oldValue: clip(previous),
      newValue: nextFollowAt,
      batchId,
      at
    });
  }
  await store.persist();
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message: `已为 ${chosen.length} 条设置下次跟进`,
      nextFollowAt,
      note: parsed.note,
      batchId,
      count: chosen.length,
      items: chosen.map((item) => ({
        targetType: item.targetType,
        targetId: item.targetId,
        suppressionNotice: item.suppressionNotice
      }))
    }
  };
}
