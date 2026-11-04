import { randomUUID } from "node:crypto";
import { hasIamPermission } from "./auth.js";
import { displayMaskedNumber } from "./call-wrapup-queue.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import {
  hasOpenNextFollowUp,
  intentFollowupLabeledAt,
  isMoreRecentCall
} from "./intent-followup-queue.js";
import { suggestedMissedFollowAt } from "./outbound-missed-follow-up.js";
import { outboundInstant } from "./outbound-call.js";
import {
  isCallOutcome,
  isEstablishedCall,
  outboundCallRecordVisible,
  resolveOutboundCallRecordAccess,
  splitAgentIds,
  type OutboundCallRecordAccess
} from "./outbound-call-records.js";
import { describeProspectComplianceNotices } from "./prospect-compliance-notice.js";
import {
  ProspectFollowUpError,
  normalizeProspectNextFollowAt,
  prospectFollowUpWriteAllowed,
  setProspectNextFollowAt
} from "./prospect-follow-up.js";
import type { CrmStore } from "./store.js";
import type {
  CallOutcomeAudit,
  OutboundCallRecord,
  SessionUser,
  UnlabeledConnectedFollowupAudit
} from "./types.js";

/**
 * 已接通未标注还没有下次跟进。
 * 最近一通人工标注去掉首尾空白后不是五项之一，这一通已经接通，并且对象上没有未完成的下次跟进，才入队。
 * 页面上的结果格固定写「未标注」，不把话单枚举或原文当成第六项结果。
 * 下次跟进仍是客户 nextReminder、线索和搜客 nextFollowAt。不另建跟进表。
 * 记下只写这一处。搜客走原来的 setProspectNextFollowAt，不新写跟进注记，也不改通话结果。
 * 查看和记下写入 unlabeled_connected_followup_audits。
 * 不拨号，不发信，不调用 AI，不碰抑制或合规。
 */

export const UNLABELED_CONNECTED_OUTCOME = "未标注";
export type UnlabeledConnectedTargetType = "customer" | "lead" | "prospect";

const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes"] as const;
const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const FOLLOW_MAX = 200;

const TARGET_LABEL: Record<UnlabeledConnectedTargetType, string> = {
  customer: "客户",
  lead: "线索",
  prospect: "搜客"
};

export interface UnlabeledConnectedObject {
  targetType: UnlabeledConnectedTargetType;
  targetId: string;
  teamId: string;
  name: string;
  nextFollowAt: string;
  deleted?: boolean;
  suppressed?: boolean;
}

export interface UnlabeledConnectedQuery {
  scope: "mine" | "team";
}

export interface UnlabeledConnectedQueueItem {
  targetType: UnlabeledConnectedTargetType;
  targetId: string;
  targetLabel: string;
  name: string;
  callRecordId: string;
  outcome: typeof UNLABELED_CONNECTED_OUTCOME;
  labeledAt: string;
  nextFollowAt: string;
  agentIds: string[];
  agentLabel: string;
  maskedNumber: string;
  suppressionNotice: string;
}

export function isUnlabeledHumanOutcome(value: string) {
  return !isCallOutcome((value || "").trim());
}

export function canViewTeamUnlabeledConnectedFollowup(user: { role?: string } | undefined) {
  return user?.role === "manager" || user?.role === "admin" || user?.role === "super_admin";
}

function oneQuery(value: unknown) {
  if (Array.isArray(value)) return null;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value.trim() : null;
}

export function parseUnlabeledConnectedFollowupQuery(query: Record<string, unknown>): UnlabeledConnectedQuery | null {
  const allowed = new Set(["scope"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) return null;
  if (Object.values(query).some((value) => Array.isArray(value))) return null;
  const scope = oneQuery(query.scope);
  if (scope !== "mine" && scope !== "team") return null;
  return { scope };
}

export function unlabeledConnectedFollowupKey(targetType: string, targetId: string) {
  return `${targetType}:${targetId}`;
}

function isTargetType(value: string): value is UnlabeledConnectedTargetType {
  return value === "customer" || value === "lead" || value === "prospect";
}

export function buildUnlabeledConnectedFollowupQueue(input: {
  teamId: string;
  records: OutboundCallRecord[];
  objects: UnlabeledConnectedObject[];
  audits: CallOutcomeAudit[];
  visible: (record: OutboundCallRecord) => boolean;
  labels: Map<string, string>;
  /** null 表示不按通话坐席收窄。空数组表示当前用户没有映射，我的队列为空。 */
  ownAgentIds: string[] | null;
}) {
  const objects = new Map<string, UnlabeledConnectedObject>();
  for (const item of input.objects) {
    if (item.teamId !== input.teamId || item.deleted) continue;
    if (!isTargetType(item.targetType)) continue;
    objects.set(unlabeledConnectedFollowupKey(item.targetType, item.targetId), item);
  }
  const latest = new Map<string, OutboundCallRecord>();
  for (const record of input.records) {
    if (record.teamId !== input.teamId) continue;
    if (!isTargetType(record.targetType) || !record.targetId) continue;
    const key = unlabeledConnectedFollowupKey(record.targetType, record.targetId);
    if (!objects.has(key)) continue;
    const current = latest.get(key);
    if (!current || isMoreRecentCall(record, current)) latest.set(key, record);
  }
  const own = input.ownAgentIds === null ? null : new Set(input.ownAgentIds);
  const rows: UnlabeledConnectedQueueItem[] = [];
  for (const [key, record] of latest) {
    if (!input.visible(record)) continue;
    if (!isUnlabeledHumanOutcome(record.callOutcome || "")) continue;
    if (!isEstablishedCall(record.establishedTimeRaw || "")) continue;
    const object = objects.get(key);
    if (!object || hasOpenNextFollowUp(object.nextFollowAt)) continue;
    const agents = splitAgentIds(record.agentIds || "");
    if (own && !agents.some((id) => own.has(id))) continue;
    rows.push({
      targetType: object.targetType,
      targetId: object.targetId,
      targetLabel: TARGET_LABEL[object.targetType],
      name: object.name || object.targetId,
      callRecordId: record.id,
      outcome: UNLABELED_CONNECTED_OUTCOME,
      labeledAt: intentFollowupLabeledAt(record, input.audits),
      nextFollowAt: "",
      agentIds: agents,
      agentLabel: agents.map((id) => input.labels.get(id) || id).join("、"),
      maskedNumber: displayMaskedNumber(record.maskedNumber || ""),
      suppressionNotice: object.suppressed ? "该对象在抑制或退订名单中。这次只记下下次跟进，不改变抑制状态。" : ""
    });
  }
  rows.sort((left, right) => {
    if (left.labeledAt !== right.labeledAt) {
      if (!left.labeledAt) return 1;
      if (!right.labeledAt) return -1;
      return left.labeledAt < right.labeledAt ? 1 : -1;
    }
    return left.callRecordId < right.callRecordId ? 1 : left.callRecordId > right.callRecordId ? -1 : 0;
  });
  return rows;
}

function objectSuppressed(store: CrmStore, targetType: UnlabeledConnectedTargetType, targetId: string, teamId: string, at: string) {
  return store.websiteOpportunities.some((candidate) => {
    if (candidate.teamId !== teamId) return false;
    const linked = targetType === "prospect"
      ? candidate.id === targetId
      : targetType === "customer"
        ? candidate.customerId === targetId
        : candidate.leadId === targetId;
    if (!linked) return false;
    return describeProspectComplianceNotices(store, candidate, at).some((notice) =>
      notice.kind === "suppressed" || notice.kind === "opted_out"
    );
  });
}

function snapshotsFor(store: CrmStore, teamId: string, at: string): UnlabeledConnectedObject[] {
  const rows: UnlabeledConnectedObject[] = [];
  for (const customer of store.customers) {
    if (customer.teamId !== teamId) continue;
    rows.push({
      targetType: "customer",
      targetId: customer.id,
      teamId: customer.teamId,
      name: customer.company,
      nextFollowAt: customer.nextReminder || "",
      suppressed: objectSuppressed(store, "customer", customer.id, teamId, at)
    });
  }
  for (const lead of store.leads) {
    if (lead.teamId !== teamId) continue;
    rows.push({
      targetType: "lead",
      targetId: lead.id,
      teamId: lead.teamId,
      name: lead.company,
      nextFollowAt: lead.nextFollowAt || "",
      deleted: Boolean(lead.deletedAt),
      suppressed: objectSuppressed(store, "lead", lead.id, teamId, at)
    });
  }
  for (const candidate of store.websiteOpportunities) {
    if (candidate.teamId !== teamId) continue;
    rows.push({
      targetType: "prospect",
      targetId: candidate.id,
      teamId: candidate.teamId,
      name: candidate.company,
      nextFollowAt: candidate.nextFollowAt || "",
      suppressed: objectSuppressed(store, "prospect", candidate.id, teamId, at)
    });
  }
  return rows;
}

function ownAgentIds(store: CrmStore, user: SessionUser, scope: "mine" | "team") {
  if (scope !== "mine") return null;
  return store.aliyunAgentMappings
    .filter((item) => item.teamId === user.teamId && item.crmUserId === user.id && item.cccUserId)
    .map((item) => item.cccUserId);
}

export function collectUnlabeledConnectedFollowupRows(
  store: CrmStore,
  user: SessionUser,
  access: OutboundCallRecordAccess,
  scope: "mine" | "team"
) {
  return queueFromStore(store, user, access, { scope }, outboundInstant().toISOString());
}

function queueFromStore(
  store: CrmStore,
  user: SessionUser,
  access: OutboundCallRecordAccess,
  query: UnlabeledConnectedQuery,
  at: string
) {
  return buildUnlabeledConnectedFollowupQueue({
    teamId: user.teamId,
    records: store.outboundCallRecords,
    objects: snapshotsFor(store, user.teamId, at),
    audits: store.callOutcomeAudits,
    visible: (record) => outboundCallRecordVisible(record, user.teamId, access),
    labels: access.labels,
    ownAgentIds: ownAgentIds(store, user, query.scope)
  });
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function clipFollow(value: string) {
  const text = value || "";
  return text.length > FOLLOW_MAX ? text.slice(0, FOLLOW_MAX) : text;
}

async function writeAudit(store: CrmStore, input: Omit<UnlabeledConnectedFollowupAudit, "id" | "at">) {
  const audit: UnlabeledConnectedFollowupAudit = {
    id: `ucfa_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input,
    nextFollowAt: clipFollow(input.nextFollowAt)
  };
  if (!store.unlabeledConnectedFollowupAudits) store.unlabeledConnectedFollowupAudits = [];
  store.unlabeledConnectedFollowupAudits.unshift(audit);
  await store.persist();
  return audit;
}

export async function listUnlabeledConnectedFollowups(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseUnlabeledConnectedFollowupQuery(query);
  if (!parsed) return reject("invalid_request", "已接通未标注跟进只接受我的或团队");
  if (parsed.scope === "team" && !canViewTeamUnlabeledConnectedFollowup(user)) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "read",
      scope: "team",
      targetType: "",
      targetId: "",
      callRecordId: "",
      nextFollowAt: "",
      rowCount: 0,
      result: "rejected",
      reason: "forbidden"
    });
    return reject("forbidden", "没有查看团队已接通未标注跟进的权限", 403);
  }
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const now = outboundInstant().toISOString();
  const items = queueFromStore(store, user, resolved.access, parsed, now);
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "read",
    scope: parsed.scope,
    targetType: "",
    targetId: "",
    callRecordId: "",
    nextFollowAt: "",
    rowCount: items.length,
    result: "read",
    reason: ""
  });
  return {
    status: 200,
    body: {
      scope: parsed.scope,
      empty: items.length === 0,
      items
    }
  };
}

function parseScheduleBody(body: unknown):
  | { ok: true; targetType: UnlabeledConnectedTargetType; targetId: string; nextFollowAt: string | null }
  | { ok: false } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false };
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return { ok: false };
  const allowed = new Set(["targetType", "targetId", "nextFollowAt"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return { ok: false };
  if (typeof record.targetType !== "string" || !isTargetType(record.targetType.trim())) return { ok: false };
  if (typeof record.targetId !== "string" || !TARGET_ID_PATTERN.test(record.targetId.trim())) return { ok: false };
  const raw = record.nextFollowAt;
  if (raw === undefined || raw === null || (typeof raw === "string" && !raw.trim())) {
    return { ok: true, targetType: record.targetType.trim() as UnlabeledConnectedTargetType, targetId: record.targetId.trim(), nextFollowAt: null };
  }
  if (typeof raw !== "string") return { ok: false };
  return { ok: true, targetType: record.targetType.trim() as UnlabeledConnectedTargetType, targetId: record.targetId.trim(), nextFollowAt: raw };
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

async function setFollowUp(
  store: CrmStore,
  user: SessionUser,
  targetType: UnlabeledConnectedTargetType,
  targetId: string,
  nextFollowAt: string
): Promise<{ ok: true } | { ok: false; status: number; reason: string; message: string }> {
  if (targetType === "customer") {
    const customer = store.customers.find((item) => item.id === targetId && item.teamId === user.teamId);
    if (!customer) return { ok: false, status: 404, reason: "not_found", message: "客户不存在" };
    if (hasOpenNextFollowUp(customer.nextReminder || "")) {
      return { ok: false, status: 400, reason: "not_pending", message: "这一条不在已接通未标注还没有下次跟进里" };
    }
    if (isPublicCustomer(customer)) {
      return { ok: false, status: 409, reason: "public_pool", message: "公池客户为只读，请先领取后再操作" };
    }
    if (!hasIamPermission(user, "customer.update")) {
      return { ok: false, status: 403, reason: "forbidden", message: "没有维护该客户的权限" };
    }
    if (!await ownerVisible(store, user, "customer.update", customer.ownerId, customer.teamId)) {
      return { ok: false, status: 404, reason: "not_found", message: "客户不存在" };
    }
    customer.nextReminder = nextFollowAt;
    return { ok: true };
  }
  if (targetType === "lead") {
    const lead = store.leads.find((item) => item.id === targetId && item.teamId === user.teamId && !item.deletedAt);
    if (!lead) return { ok: false, status: 404, reason: "not_found", message: "线索不存在、已删除或无权访问" };
    if (hasOpenNextFollowUp(lead.nextFollowAt || "")) {
      return { ok: false, status: 400, reason: "not_pending", message: "这一条不在已接通未标注还没有下次跟进里" };
    }
    if (!hasIamPermission(user, "lead.update")) {
      return { ok: false, status: 403, reason: "forbidden", message: "没有维护该线索的权限" };
    }
    if (!await ownerVisible(store, user, "lead.update", lead.ownerId, lead.teamId)) {
      return { ok: false, status: 404, reason: "not_found", message: "线索不存在、已删除或无权访问" };
    }
    lead.nextFollowAt = nextFollowAt;
    return { ok: true };
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === targetId && item.teamId === user.teamId);
  if (!candidate) return { ok: false, status: 404, reason: "not_found", message: "搜客候选不存在或无权访问" };
  if (hasOpenNextFollowUp(candidate.nextFollowAt || "")) {
    return { ok: false, status: 400, reason: "not_pending", message: "这一条不在已接通未标注还没有下次跟进里" };
  }
  if (!hasIamPermission(user, "prospect.execute")) {
    return { ok: false, status: 403, reason: "forbidden", message: "没有执行获客任务的权限" };
  }
  if (!await ownerVisible(store, user, "prospect.execute", candidate.ownerId, candidate.teamId)) {
    return { ok: false, status: 404, reason: "not_found", message: "搜客候选不存在或无权访问" };
  }
  if (candidate.ownerId !== user.id) {
    return { ok: false, status: 403, reason: "forbidden", message: "只有候选归属业务员可以记录跟进" };
  }
  if (!prospectFollowUpWriteAllowed(store, candidate, user.id)) {
    return {
      ok: false,
      status: 409,
      reason: "not_contactable",
      message: candidate.status === "excluded" ? "已排除的候选不在这里记录跟进" : "达到可联系后再记录跟进"
    };
  }
  try {
    setProspectNextFollowAt(store, { candidate, actorId: user.id, nextFollowAt });
  } catch (error) {
    if (error instanceof ProspectFollowUpError) {
      return {
        ok: false,
        status: error.status,
        reason: error.status === 409 ? "not_contactable" : "forbidden",
        message: error.message
      };
    }
    throw error;
  }
  return { ok: true };
}

export async function scheduleUnlabeledConnectedFollowup(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseScheduleBody(body);
  if (!parsed.ok) return reject("invalid_request", "一次只能为一个对象记下下次跟进");
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const scope: "mine" | "team" = canViewTeamUnlabeledConnectedFollowup(user) ? "team" : "mine";
  const now = outboundInstant().toISOString();
  const row = queueFromStore(store, user, resolved.access, { scope }, now)
    .find((item) => item.targetType === parsed.targetType && item.targetId === parsed.targetId);
  if (!row) return reject("not_pending", "这一条不在已接通未标注还没有下次跟进里");
  let nextFollowAt = "";
  try {
    nextFollowAt = parsed.nextFollowAt === null
      ? await suggestedMissedFollowAt(store, user.teamId, outboundInstant())
      : normalizeProspectNextFollowAt(parsed.nextFollowAt);
  } catch (error) {
    if (error instanceof ProspectFollowUpError) {
      await writeAudit(store, {
        teamId: user.teamId,
        actorId: user.id,
        action: "schedule",
        scope,
        targetType: parsed.targetType,
        targetId: parsed.targetId,
        callRecordId: row.callRecordId,
        nextFollowAt: "",
        rowCount: 0,
        result: "rejected",
        reason: "invalid_request"
      });
      return reject("invalid_request", error.message, error.status);
    }
    throw error;
  }
  if (!nextFollowAt) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "schedule",
      scope,
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      callRecordId: row.callRecordId,
      nextFollowAt: "",
      rowCount: 0,
      result: "rejected",
      reason: "invalid_request"
    });
    return reject("invalid_request", "下次跟进时间请用日期和时间，例如 2026-10-30 15:30");
  }
  const written = await setFollowUp(store, user, parsed.targetType, parsed.targetId, nextFollowAt);
  if (!written.ok) {
    if (written.reason === "not_pending") return reject(written.reason, written.message, written.status);
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "schedule",
      scope,
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      callRecordId: row.callRecordId,
      nextFollowAt: "",
      rowCount: 0,
      result: "rejected",
      reason: written.reason
    });
    return reject(written.reason, written.message, written.status);
  }
  const audit = await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "schedule",
    scope,
    targetType: parsed.targetType,
    targetId: parsed.targetId,
    callRecordId: row.callRecordId,
    nextFollowAt,
    rowCount: 0,
    result: "updated",
    reason: ""
  });
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message: "已记下下次跟进",
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      callRecordId: row.callRecordId,
      outcome: UNLABELED_CONNECTED_OUTCOME,
      nextFollowAt: clipFollow(nextFollowAt),
      suppressionNotice: row.suppressionNotice,
      auditId: audit.id
    }
  };
}
