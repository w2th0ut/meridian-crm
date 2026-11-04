import { randomUUID } from "node:crypto";
import { hasIamPermission } from "./auth.js";
import { displayMaskedNumber } from "./call-wrapup-queue.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import {
  hasOpenNextFollowUp,
  intentFollowupLabeledAt,
  isMoreRecentCall
} from "./intent-followup-queue.js";
import { outboundInstant } from "./outbound-call.js";
import {
  outboundCallRecordVisible,
  resolveOutboundCallRecordAccess,
  splitAgentIds,
  type OutboundCallRecordAccess
} from "./outbound-call-records.js";
import { describeProspectComplianceNotices } from "./prospect-compliance-notice.js";
import {
  ProspectFollowUpError,
  prospectFollowUpWriteAllowed,
  setProspectNextFollowAt
} from "./prospect-follow-up.js";
import type { CrmStore } from "./store.js";
import type {
  CallOutcomeAudit,
  NegativeOutcomeFollowupAudit,
  OutboundCallRecord,
  SessionUser
} from "./types.js";

/**
 * 负向通话结果仍有下次跟进。
 * 最近一通人工标注是无意向或号码错误，并且对象上还有未完成的下次跟进，才入队。
 * 下次跟进仍是客户 nextReminder、线索和搜客 nextFollowAt。不另建跟进表。
 * 清除只把这一处清空。搜客走原来的 setProspectNextFollowAt，不新写跟进注记。
 * 查看和清除写入 negative_outcome_followup_audits。
 * 不拨号，不发信，不调用 AI，不碰抑制或合规。
 */

export const NEGATIVE_FOLLOWUP_OUTCOMES = ["无意向", "号码错误"] as const;
export type NegativeFollowupOutcome = (typeof NEGATIVE_FOLLOWUP_OUTCOMES)[number];
export type NegativeFollowupTargetType = "customer" | "lead" | "prospect";

const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes"] as const;
const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PREVIOUS_FOLLOW_MAX = 200;

const TARGET_LABEL: Record<NegativeFollowupTargetType, string> = {
  customer: "客户",
  lead: "线索",
  prospect: "搜客"
};

export interface NegativeFollowupObject {
  targetType: NegativeFollowupTargetType;
  targetId: string;
  teamId: string;
  name: string;
  nextFollowAt: string;
  deleted?: boolean;
  suppressed?: boolean;
}

export interface NegativeFollowupQuery {
  scope: "mine" | "team";
  outcome: "" | NegativeFollowupOutcome;
}

export interface NegativeFollowupQueueItem {
  targetType: NegativeFollowupTargetType;
  targetId: string;
  targetLabel: string;
  name: string;
  callRecordId: string;
  outcome: NegativeFollowupOutcome;
  labeledAt: string;
  nextFollowAt: string;
  agentIds: string[];
  agentLabel: string;
  maskedNumber: string;
  suppressionNotice: string;
}

export function isNegativeFollowupOutcome(value: string): value is NegativeFollowupOutcome {
  return (NEGATIVE_FOLLOWUP_OUTCOMES as readonly string[]).includes(value);
}

export function canViewTeamNegativeFollowup(user: { role?: string } | undefined) {
  return user?.role === "manager" || user?.role === "admin" || user?.role === "super_admin";
}

function oneQuery(value: unknown) {
  if (Array.isArray(value)) return null;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value.trim() : null;
}

export function parseNegativeFollowupQuery(query: Record<string, unknown>): NegativeFollowupQuery | null {
  const allowed = new Set(["scope", "outcome"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) return null;
  if (Object.values(query).some((value) => Array.isArray(value))) return null;
  const scope = oneQuery(query.scope);
  const outcome = oneQuery(query.outcome);
  if (scope === null || outcome === null) return null;
  if (scope !== "mine" && scope !== "team") return null;
  if (outcome !== "" && !isNegativeFollowupOutcome(outcome)) return null;
  return { scope, outcome };
}

export function negativeFollowupKey(targetType: string, targetId: string) {
  return `${targetType}:${targetId}`;
}

function isTargetType(value: string): value is NegativeFollowupTargetType {
  return value === "customer" || value === "lead" || value === "prospect";
}

export function buildNegativeOutcomeFollowupQueue(input: {
  teamId: string;
  records: OutboundCallRecord[];
  objects: NegativeFollowupObject[];
  audits: CallOutcomeAudit[];
  visible: (record: OutboundCallRecord) => boolean;
  labels: Map<string, string>;
  /** null 表示不按通话坐席收窄。空数组表示当前用户没有映射，我的队列为空。 */
  ownAgentIds: string[] | null;
  outcome: "" | NegativeFollowupOutcome;
}) {
  const objects = new Map<string, NegativeFollowupObject>();
  for (const item of input.objects) {
    if (item.teamId !== input.teamId || item.deleted) continue;
    if (!isTargetType(item.targetType)) continue;
    objects.set(negativeFollowupKey(item.targetType, item.targetId), item);
  }
  const latest = new Map<string, OutboundCallRecord>();
  for (const record of input.records) {
    if (record.teamId !== input.teamId) continue;
    if (!isTargetType(record.targetType) || !record.targetId) continue;
    const key = negativeFollowupKey(record.targetType, record.targetId);
    if (!objects.has(key)) continue;
    const current = latest.get(key);
    if (!current || isMoreRecentCall(record, current)) latest.set(key, record);
  }
  const own = input.ownAgentIds === null ? null : new Set(input.ownAgentIds);
  const rows: NegativeFollowupQueueItem[] = [];
  for (const [key, record] of latest) {
    if (!input.visible(record)) continue;
    const outcome = (record.callOutcome || "").trim();
    if (!isNegativeFollowupOutcome(outcome)) continue;
    if (input.outcome && outcome !== input.outcome) continue;
    const object = objects.get(key);
    if (!object || !hasOpenNextFollowUp(object.nextFollowAt)) continue;
    const agents = splitAgentIds(record.agentIds || "");
    if (own && !agents.some((id) => own.has(id))) continue;
    rows.push({
      targetType: object.targetType,
      targetId: object.targetId,
      targetLabel: TARGET_LABEL[object.targetType],
      name: object.name || object.targetId,
      callRecordId: record.id,
      outcome,
      labeledAt: intentFollowupLabeledAt(record, input.audits),
      nextFollowAt: object.nextFollowAt,
      agentIds: agents,
      agentLabel: agents.map((id) => input.labels.get(id) || id).join("、"),
      maskedNumber: displayMaskedNumber(record.maskedNumber || ""),
      suppressionNotice: object.suppressed ? "该对象在抑制或退订名单中。这次只清除下次跟进，不改变抑制状态。" : ""
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

function objectSuppressed(store: CrmStore, targetType: NegativeFollowupTargetType, targetId: string, teamId: string, at: string) {
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

function snapshotsFor(store: CrmStore, teamId: string, at: string): NegativeFollowupObject[] {
  const rows: NegativeFollowupObject[] = [];
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

function queueFromStore(
  store: CrmStore,
  user: SessionUser,
  access: OutboundCallRecordAccess,
  query: NegativeFollowupQuery,
  at: string
) {
  return buildNegativeOutcomeFollowupQueue({
    teamId: user.teamId,
    records: store.outboundCallRecords,
    objects: snapshotsFor(store, user.teamId, at),
    audits: store.callOutcomeAudits,
    visible: (record) => outboundCallRecordVisible(record, user.teamId, access),
    labels: access.labels,
    ownAgentIds: ownAgentIds(store, user, query.scope),
    outcome: query.outcome
  });
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function clipFollow(value: string) {
  const text = value || "";
  return text.length > PREVIOUS_FOLLOW_MAX ? text.slice(0, PREVIOUS_FOLLOW_MAX) : text;
}

async function writeAudit(store: CrmStore, input: Omit<NegativeOutcomeFollowupAudit, "id" | "at">) {
  const audit: NegativeOutcomeFollowupAudit = {
    id: `nofa_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input,
    previousNextFollowAt: clipFollow(input.previousNextFollowAt)
  };
  if (!store.negativeOutcomeFollowupAudits) store.negativeOutcomeFollowupAudits = [];
  store.negativeOutcomeFollowupAudits.unshift(audit);
  await store.persist();
  return audit;
}

export async function listNegativeOutcomeFollowups(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseNegativeFollowupQuery(query);
  if (!parsed) return reject("invalid_request", "负向结果跟进只接受我的或团队，以及无意向或号码错误");
  if (parsed.scope === "team" && !canViewTeamNegativeFollowup(user)) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "read",
      scope: "team",
      outcome: parsed.outcome,
      targetType: "",
      targetId: "",
      callRecordId: "",
      previousNextFollowAt: "",
      rowCount: 0,
      result: "rejected",
      reason: "forbidden"
    });
    return reject("forbidden", "没有查看团队负向结果跟进的权限", 403);
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
    outcome: parsed.outcome,
    targetType: "",
    targetId: "",
    callRecordId: "",
    previousNextFollowAt: "",
    rowCount: items.length,
    result: "read",
    reason: ""
  });
  return {
    status: 200,
    body: {
      scope: parsed.scope,
      outcome: parsed.outcome,
      empty: items.length === 0,
      items
    }
  };
}

function parseClearBody(body: unknown):
  | { ok: true; targetType: NegativeFollowupTargetType; targetId: string }
  | { ok: false } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false };
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return { ok: false };
  const allowed = new Set(["targetType", "targetId"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return { ok: false };
  if (typeof record.targetType !== "string" || !isTargetType(record.targetType.trim())) return { ok: false };
  if (typeof record.targetId !== "string" || !TARGET_ID_PATTERN.test(record.targetId.trim())) return { ok: false };
  return { ok: true, targetType: record.targetType.trim() as NegativeFollowupTargetType, targetId: record.targetId.trim() };
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

async function clearFollowUp(
  store: CrmStore,
  user: SessionUser,
  targetType: NegativeFollowupTargetType,
  targetId: string
): Promise<{ ok: true; previous: string } | { ok: false; status: number; reason: string; message: string }> {
  if (targetType === "customer") {
    const customer = store.customers.find((item) => item.id === targetId && item.teamId === user.teamId);
    if (!customer) return { ok: false, status: 404, reason: "not_found", message: "客户不存在" };
    if (isPublicCustomer(customer)) {
      return { ok: false, status: 409, reason: "public_pool", message: "公池客户为只读，请先领取后再操作" };
    }
    if (!hasIamPermission(user, "customer.update")) {
      return { ok: false, status: 403, reason: "forbidden", message: "没有维护该客户的权限" };
    }
    if (!await ownerVisible(store, user, "customer.update", customer.ownerId, customer.teamId)) {
      return { ok: false, status: 404, reason: "not_found", message: "客户不存在" };
    }
    const previous = customer.nextReminder || "";
    customer.nextReminder = "";
    return { ok: true, previous };
  }
  if (targetType === "lead") {
    const lead = store.leads.find((item) => item.id === targetId && item.teamId === user.teamId && !item.deletedAt);
    if (!lead) return { ok: false, status: 404, reason: "not_found", message: "线索不存在、已删除或无权访问" };
    if (!hasIamPermission(user, "lead.update")) {
      return { ok: false, status: 403, reason: "forbidden", message: "没有维护该线索的权限" };
    }
    if (!await ownerVisible(store, user, "lead.update", lead.ownerId, lead.teamId)) {
      return { ok: false, status: 404, reason: "not_found", message: "线索不存在、已删除或无权访问" };
    }
    const previous = lead.nextFollowAt || "";
    lead.nextFollowAt = "";
    return { ok: true, previous };
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === targetId && item.teamId === user.teamId);
  if (!candidate) return { ok: false, status: 404, reason: "not_found", message: "搜客候选不存在或无权访问" };
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
  const previous = candidate.nextFollowAt || "";
  try {
    setProspectNextFollowAt(store, { candidate, actorId: user.id, nextFollowAt: "" });
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
  return { ok: true, previous };
}

export async function clearNegativeOutcomeFollowup(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseClearBody(body);
  if (!parsed.ok) return reject("invalid_request", "一次只能清除一个对象的下次跟进");
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const scope: "mine" | "team" = canViewTeamNegativeFollowup(user) ? "team" : "mine";
  const now = outboundInstant().toISOString();
  const row = queueFromStore(store, user, resolved.access, { scope, outcome: "" }, now)
    .find((item) => item.targetType === parsed.targetType && item.targetId === parsed.targetId);
  if (!row) return reject("not_pending", "这一条不在负向结果仍有下次跟进里");
  const cleared = await clearFollowUp(store, user, parsed.targetType, parsed.targetId);
  if (!cleared.ok) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "clear",
      scope,
      outcome: row.outcome,
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      callRecordId: row.callRecordId,
      previousNextFollowAt: "",
      rowCount: 0,
      result: "rejected",
      reason: cleared.reason
    });
    return reject(cleared.reason, cleared.message, cleared.status);
  }
  const audit = await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "clear",
    scope,
    outcome: row.outcome,
    targetType: parsed.targetType,
    targetId: parsed.targetId,
    callRecordId: row.callRecordId,
    previousNextFollowAt: cleared.previous,
    rowCount: 0,
    result: "updated",
    reason: ""
  });
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message: "已清除下次跟进",
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      callRecordId: row.callRecordId,
      outcome: row.outcome,
      previousNextFollowAt: clipFollow(cleared.previous),
      nextFollowAt: "",
      suppressionNotice: row.suppressionNotice,
      auditId: audit.id
    }
  };
}
