import { randomUUID } from "node:crypto";
import { hasIamPermission } from "./auth.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import { appendFollowUpAudit } from "./follow-up-audit.js";
import { suggestedMissedFollowAt, SUPPRESSION_FOLLOW_UP_NOTICE } from "./outbound-missed-follow-up.js";
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
  normalizeProspectNextFollowAt,
  recordProspectFollowUp
} from "./prospect-follow-up.js";
import type { CrmStore } from "./store.js";
import type {
  CallOutcomeAudit,
  IntentFollowupArrangement,
  IntentFollowupQueueAudit,
  OutboundCallRecord,
  SessionUser,
  WebsiteOpportunity
} from "./types.js";

/**
 * 意向回访队列。
 * 最近一次通话标注为有意向或需回访，且关联对象没有未完成下次跟进时入队。
 * 安排跟进只写本地下次跟进。忽略可以撤销。两次都写审计。
 * 不拨号，不发信，不推进序列，不解除抑制。
 */

export const INTENT_FOLLOWUP_OUTCOMES = ["有意向", "需回访"] as const;
export type IntentFollowupOutcome = (typeof INTENT_FOLLOWUP_OUTCOMES)[number];
export type IntentFollowupTargetType = "customer" | "lead" | "prospect";

const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes"] as const;
const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const TARGET_LABEL: Record<IntentFollowupTargetType, string> = {
  customer: "客户",
  lead: "线索",
  prospect: "搜客"
};

export function isIntentFollowupOutcome(value: string): value is IntentFollowupOutcome {
  return (INTENT_FOLLOWUP_OUTCOMES as readonly string[]).includes(value);
}

/** 去掉空白后还有内容，就算还有未完成的下次跟进。空字符串才算没有。 */
export function hasOpenNextFollowUp(value: string | undefined | null) {
  return (value || "").trim().length > 0;
}

export function intentFollowupKey(targetType: string, targetId: string) {
  return `${targetType}:${targetId}`;
}

export function callRecencyRank(record: Pick<OutboundCallRecord, "startTimeRaw" | "createdAt" | "updatedAt" | "id">) {
  const text = (record.startTimeRaw || "").trim();
  let start = 0;
  if (/^\d+$/.test(text)) {
    const value = Number(text);
    if (Number.isSafeInteger(value) && value > 0) start = value;
  }
  if (start === 0) {
    const created = Date.parse(record.createdAt || "");
    if (Number.isFinite(created)) start = created;
  }
  const updated = Date.parse(record.updatedAt || "");
  return { start, updated: Number.isFinite(updated) ? updated : 0, id: record.id || "" };
}

export function isMoreRecentCall(
  candidate: Pick<OutboundCallRecord, "startTimeRaw" | "createdAt" | "updatedAt" | "id">,
  current: Pick<OutboundCallRecord, "startTimeRaw" | "createdAt" | "updatedAt" | "id">
) {
  const left = callRecencyRank(candidate);
  const right = callRecencyRank(current);
  if (left.start !== right.start) return left.start > right.start;
  if (left.updated !== right.updated) return left.updated > right.updated;
  return left.id > right.id;
}

/** 当前标注对应的最近一条审计时间。没有审计时用通话记录的更新时间。 */
export function intentFollowupLabeledAt(record: OutboundCallRecord, audits: CallOutcomeAudit[]) {
  const outcome = record.callOutcome || "";
  let latest = "";
  for (const audit of audits) {
    if (audit.teamId !== record.teamId || audit.callRecordId !== record.id) continue;
    if (audit.nextOutcome !== outcome || !audit.at) continue;
    if (!latest || audit.at > latest) latest = audit.at;
  }
  return latest || record.updatedAt || record.createdAt || "";
}

export interface IntentFollowupObjectSnapshot {
  targetType: IntentFollowupTargetType;
  targetId: string;
  teamId: string;
  name: string;
  nextFollowAt: string;
  deleted?: boolean;
  suppressed?: boolean;
}

export interface IntentFollowupQueueRow {
  targetType: IntentFollowupTargetType;
  targetId: string;
  targetLabel: string;
  name: string;
  callRecordId: string;
  outcome: IntentFollowupOutcome;
  labeledAt: string;
  agentIds: string[];
  agentLabel: string;
  maskedNumber: string;
  suppressionNotice: string;
}

export function buildIntentFollowupQueue(input: {
  teamId: string;
  records: OutboundCallRecord[];
  audits: CallOutcomeAudit[];
  objects: IntentFollowupObjectSnapshot[];
  arrangements: Array<{ teamId: string; targetType: string; targetId: string }>;
  visible: (record: OutboundCallRecord) => boolean;
  labels: Map<string, string>;
}) {
  const objects = new Map<string, IntentFollowupObjectSnapshot>();
  for (const item of input.objects) {
    if (item.teamId !== input.teamId || item.deleted) continue;
    objects.set(intentFollowupKey(item.targetType, item.targetId), item);
  }
  const arranged = new Set(input.arrangements
    .filter((item) => item.teamId === input.teamId)
    .map((item) => intentFollowupKey(item.targetType, item.targetId)));
  const latest = new Map<string, OutboundCallRecord>();
  for (const record of input.records) {
    if (record.teamId !== input.teamId) continue;
    const key = intentFollowupKey(record.targetType, record.targetId);
    if (!objects.has(key)) continue;
    const current = latest.get(key);
    if (!current || isMoreRecentCall(record, current)) latest.set(key, record);
  }
  const active: IntentFollowupQueueRow[] = [];
  for (const [key, record] of latest) {
    const outcome = record.callOutcome || "";
    if (!isIntentFollowupOutcome(outcome)) continue;
    if (!input.visible(record)) continue;
    const object = objects.get(key);
    if (!object || hasOpenNextFollowUp(object.nextFollowAt) || arranged.has(key)) continue;
    const agents = splitAgentIds(record.agentIds);
    active.push({
      targetType: object.targetType,
      targetId: object.targetId,
      targetLabel: TARGET_LABEL[object.targetType],
      name: object.name || object.targetId,
      callRecordId: record.id,
      outcome,
      labeledAt: intentFollowupLabeledAt(record, input.audits),
      agentIds: agents,
      agentLabel: agents.map((id) => input.labels.get(id) || id).join("、"),
      maskedNumber: record.maskedNumber || "",
      suppressionNotice: object.suppressed ? SUPPRESSION_FOLLOW_UP_NOTICE : ""
    });
  }
  active.sort((left, right) => {
    if (left.labeledAt !== right.labeledAt) return left.labeledAt < right.labeledAt ? 1 : -1;
    return left.targetId < right.targetId ? 1 : left.targetId > right.targetId ? -1 : 0;
  });
  return active;
}

function objectSuppressed(store: CrmStore, targetType: IntentFollowupTargetType, targetId: string, teamId: string, at: string) {
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

function snapshotsFor(store: CrmStore, teamId: string, at: string): IntentFollowupObjectSnapshot[] {
  const rows: IntentFollowupObjectSnapshot[] = [];
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

function queueFromStore(store: CrmStore, user: SessionUser, access: OutboundCallRecordAccess) {
  const at = outboundInstant().toISOString();
  return buildIntentFollowupQueue({
    teamId: user.teamId,
    records: store.outboundCallRecords,
    audits: store.callOutcomeAudits,
    objects: snapshotsFor(store, user.teamId, at),
    arrangements: store.intentFollowupArrangements,
    visible: (record) => outboundCallRecordVisible(record, user.teamId, access),
    labels: access.labels
  });
}

export async function listIntentFollowupQueue(store: CrmStore, user: SessionUser | undefined) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const items = queueFromStore(store, user, resolved.access);
  return {
    status: 200,
    body: {
      scope: resolved.access.teamScope ? "team" as const : "self" as const,
      timeZone: resolved.access.timeZone,
      suggestedNextFollowAt: await suggestedMissedFollowAt(store, user.teamId, outboundInstant()),
      empty: items.length === 0,
      items
    }
  };
}

function reject(status: number, reason: string, message: string, extra: Record<string, unknown> = {}) {
  return { status, body: { result: "rejected" as const, reason, message, ...extra } };
}

async function writeAudit(store: CrmStore, input: Omit<IntentFollowupQueueAudit, "id" | "at">) {
  const audit: IntentFollowupQueueAudit = {
    id: `ifqa_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.intentFollowupQueueAudits.unshift(audit);
  await store.persist();
  return audit;
}

function parseTarget(body: unknown):
  | { ok: true; targetType: IntentFollowupTargetType; targetId: string; nextFollowAt: string | null }
  | { ok: false; reason: "invalid_request" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return { ok: false, reason: "invalid_request" };
  const targetType = typeof record.targetType === "string" ? record.targetType.trim() : "";
  const targetId = typeof record.targetId === "string" ? record.targetId.trim() : "";
  if (targetType !== "customer" && targetType !== "lead" && targetType !== "prospect") {
    return { ok: false, reason: "invalid_request" };
  }
  if (!TARGET_ID_PATTERN.test(targetId)) return { ok: false, reason: "invalid_request" };
  const value = record.nextFollowAt;
  if (value === undefined || value === null || value === "") return { ok: true, targetType, targetId, nextFollowAt: null };
  if (typeof value !== "string") return { ok: false, reason: "invalid_request" };
  return { ok: true, targetType, targetId, nextFollowAt: value };
}

function latestCall(store: CrmStore, teamId: string, targetType: IntentFollowupTargetType, targetId: string) {
  let found: OutboundCallRecord | undefined;
  for (const record of store.outboundCallRecords) {
    if (record.teamId !== teamId || record.targetType !== targetType || record.targetId !== targetId) continue;
    if (!found || isMoreRecentCall(record, found)) found = record;
  }
  return found;
}

function findArrangement(store: CrmStore, teamId: string, targetType: string, targetId: string) {
  return store.intentFollowupArrangements.find((item) =>
    item.teamId === teamId && item.targetType === targetType && item.targetId === targetId
  );
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

function openFollowValue(store: CrmStore, teamId: string, targetType: IntentFollowupTargetType, targetId: string) {
  if (targetType === "customer") {
    const customer = store.customers.find((item) => item.id === targetId && item.teamId === teamId);
    return customer ? customer.nextReminder || "" : null;
  }
  if (targetType === "lead") {
    const lead = store.leads.find((item) => item.id === targetId && item.teamId === teamId && !item.deletedAt);
    return lead ? lead.nextFollowAt || "" : null;
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === targetId && item.teamId === teamId);
  return candidate ? candidate.nextFollowAt || "" : null;
}

async function prepareTarget(store: CrmStore, user: SessionUser, targetType: IntentFollowupTargetType, targetId: string) {
  if (targetType === "customer") {
    const customer = store.customers.find((item) => item.id === targetId);
    if (!customer || customer.teamId !== user.teamId) {
      return { ok: false as const, status: 404, reason: "not_found", message: "客户不存在" };
    }
    if (isPublicCustomer(customer)) {
      return { ok: false as const, status: 409, reason: "public_pool", message: "公池客户为只读，请先领取后再操作" };
    }
    if (!hasIamPermission(user, "customer.update")) {
      return { ok: false as const, status: 403, reason: "forbidden", message: "没有维护该客户的权限" };
    }
    if (!await ownerVisible(store, user, "customer.update", customer.ownerId, customer.teamId)) {
      return { ok: false as const, status: 404, reason: "not_found", message: "客户不存在" };
    }
    return { ok: true as const, targetType, targetId: customer.id };
  }
  if (targetType === "lead") {
    const lead = store.leads.find((item) => item.id === targetId);
    if (!lead || lead.teamId !== user.teamId || lead.deletedAt) {
      return { ok: false as const, status: 404, reason: "not_found", message: "线索不存在、已删除或无权访问" };
    }
    if (!hasIamPermission(user, "lead.update")) {
      return { ok: false as const, status: 403, reason: "forbidden", message: "没有维护该线索的权限" };
    }
    if (!await ownerVisible(store, user, "lead.update", lead.ownerId, lead.teamId)) {
      return { ok: false as const, status: 404, reason: "not_found", message: "线索不存在、已删除或无权访问" };
    }
    return { ok: true as const, targetType, targetId: lead.id };
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === targetId);
  if (!candidate || candidate.teamId !== user.teamId) {
    return { ok: false as const, status: 404, reason: "not_found", message: "搜客候选不存在或无权访问" };
  }
  if (!hasIamPermission(user, "prospect.execute")) {
    return { ok: false as const, status: 403, reason: "forbidden", message: "没有执行获客任务的权限" };
  }
  if (!await ownerVisible(store, user, "prospect.execute", candidate.ownerId, candidate.teamId)) {
    return { ok: false as const, status: 404, reason: "not_found", message: "搜客候选不存在或无权访问" };
  }
  if (candidate.ownerId !== user.id) {
    return { ok: false as const, status: 403, reason: "forbidden", message: "只有候选归属业务员可以记录跟进" };
  }
  return { ok: true as const, targetType, targetId: candidate.id, candidate };
}

function followUpContent(outcome: string, maskedNumber: string, nextFollowAt: string) {
  const number = maskedNumber ? `号码 ${maskedNumber}。` : "";
  return `通话结果为${outcome}，已安排下次跟进。${number}时间 ${nextFollowAt}`;
}

function createCustomerFollowUp(store: CrmStore, user: SessionUser, customerId: string, content: string, nextFollowAt: string, at: string) {
  const customer = store.customers.find((item) => item.id === customerId);
  if (!customer) return "";
  const activity = {
    id: `ca_${randomUUID()}`,
    customerId: customer.id,
    type: "call" as const,
    content,
    operatorId: user.id,
    nextReminder: nextFollowAt,
    createdAt: at
  };
  store.customerActivities.unshift(activity);
  customer.nextReminder = nextFollowAt;
  appendFollowUpAudit(store, {
    actorId: user.id,
    objectType: "customer",
    objectId: customer.id,
    activityId: activity.id,
    at
  });
  return activity.id;
}

function createLeadFollowUp(store: CrmStore, user: SessionUser, leadId: string, content: string, nextFollowAt: string, at: string) {
  const lead = store.leads.find((item) => item.id === leadId);
  if (!lead) return "";
  const activity = {
    id: `la_${randomUUID()}`,
    leadId: lead.id,
    type: "call" as const,
    content,
    operatorId: user.id,
    nextFollowAt,
    createdAt: at
  };
  store.leadActivities.unshift(activity);
  lead.nextFollowAt = nextFollowAt;
  lead.lastActivityAt = "刚刚";
  if (lead.status === "new") lead.status = "following";
  return activity.id;
}

function createProspectFollowUp(store: CrmStore, user: SessionUser, candidate: WebsiteOpportunity, content: string, nextFollowAt: string, at: string) {
  const recorded = recordProspectFollowUp(store, {
    candidate,
    actorId: user.id,
    content,
    type: "call",
    nextFollowAt,
    createdAt: at
  });
  appendFollowUpAudit(store, {
    actorId: user.id,
    objectType: "prospect_candidate",
    objectId: candidate.id,
    activityId: recorded.activity.id,
    at
  });
  return recorded.activity.id;
}

function duplicateBody(link: IntentFollowupArrangement) {
  return {
    result: "duplicate" as const,
    replayed: true,
    reason: "duplicate",
    message: "这个对象已经安排过回访",
    targetType: link.targetType,
    targetId: link.targetId,
    callRecordId: link.callRecordId,
    activityId: link.activityId,
    nextFollowAt: link.nextFollowAt,
    suppressionNotice: link.suppressed ? SUPPRESSION_FOLLOW_UP_NOTICE : ""
  };
}

async function loadActionContext(
  store: CrmStore,
  user: SessionUser | undefined,
  body: unknown,
  action: IntentFollowupQueueAudit["action"]
) {
  if (!user?.id || !user.teamId) {
    return { ok: false as const, status: 401, body: { message: "未登录" } };
  }
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return { ok: false as const, status: resolved.status, body: resolved.body };
  const parsed = parseTarget(body);
  if (!parsed.ok) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action,
      targetType: "",
      targetId: "",
      callRecordId: "",
      activityId: "",
      nextFollowAt: "",
      result: "rejected",
      reason: "invalid_request",
      suppressed: false
    });
    return {
      ok: false as const,
      status: 400,
      body: { result: "rejected", reason: "invalid_request", message: "一次只能处理一个对象" }
    };
  }
  const record = latestCall(store, user.teamId, parsed.targetType, parsed.targetId);
  if (!record || !outboundCallRecordVisible(record, user.teamId, resolved.access)) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action,
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      callRecordId: "",
      activityId: "",
      nextFollowAt: "",
      result: "rejected",
      reason: "not_found",
      suppressed: false
    });
    return {
      ok: false as const,
      status: 404,
      body: { result: "rejected", reason: "not_found", message: "对象不存在", targetType: parsed.targetType, targetId: parsed.targetId }
    };
  }
  return { ok: true as const, user, parsed, record };
}

export async function scheduleIntentFollowup(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  const loaded = await loadActionContext(store, user, body, "schedule");
  if (!loaded.ok) return { status: loaded.status, body: loaded.body };
  const { parsed, record } = loaded;
  const actor = loaded.user;
  const existing = findArrangement(store, actor.teamId, parsed.targetType, parsed.targetId);
  if (existing) {
    await writeAudit(store, {
      teamId: actor.teamId,
      actorId: actor.id,
      action: "schedule",
      targetType: existing.targetType,
      targetId: existing.targetId,
      callRecordId: existing.callRecordId,
      activityId: existing.activityId,
      nextFollowAt: existing.nextFollowAt,
      result: "duplicate",
      reason: "duplicate",
      suppressed: existing.suppressed
    });
    return { status: 200, body: duplicateBody(existing) };
  }
  const outcome = record.callOutcome || "";
  if (!isIntentFollowupOutcome(outcome)) {
    await writeAudit(store, {
      teamId: actor.teamId,
      actorId: actor.id,
      action: "schedule",
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      callRecordId: record.id,
      activityId: "",
      nextFollowAt: "",
      result: "rejected",
      reason: "not_eligible",
      suppressed: false
    });
    return reject(409, "not_eligible", "最近一次通话不是有意向或需回访", {
      targetType: parsed.targetType,
      targetId: parsed.targetId
    });
  }
  const openFollow = openFollowValue(store, actor.teamId, parsed.targetType, parsed.targetId);
  if (openFollow === null) {
    await writeAudit(store, {
      teamId: actor.teamId,
      actorId: actor.id,
      action: "schedule",
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      callRecordId: record.id,
      activityId: "",
      nextFollowAt: "",
      result: "rejected",
      reason: "not_found",
      suppressed: false
    });
    return reject(404, "not_found", "对象不存在", { targetType: parsed.targetType, targetId: parsed.targetId });
  }
  if (hasOpenNextFollowUp(openFollow)) {
    await writeAudit(store, {
      teamId: actor.teamId,
      actorId: actor.id,
      action: "schedule",
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      callRecordId: record.id,
      activityId: "",
      nextFollowAt: "",
      result: "rejected",
      reason: "already_has_follow_up",
      suppressed: false
    });
    return reject(409, "already_has_follow_up", "这个对象已有未完成的下次跟进", {
      targetType: parsed.targetType,
      targetId: parsed.targetId
    });
  }

  let nextFollowAt = "";
  try {
    nextFollowAt = parsed.nextFollowAt === null
      ? await suggestedMissedFollowAt(store, actor.teamId, outboundInstant())
      : normalizeProspectNextFollowAt(parsed.nextFollowAt);
  } catch (error) {
    if (error instanceof ProspectFollowUpError) {
      await writeAudit(store, {
        teamId: actor.teamId,
        actorId: actor.id,
        action: "schedule",
        targetType: parsed.targetType,
        targetId: parsed.targetId,
        callRecordId: record.id,
        activityId: "",
        nextFollowAt: "",
        result: "rejected",
        reason: "invalid_request",
        suppressed: false
      });
      return reject(error.status, "invalid_request", error.message, {
        targetType: parsed.targetType,
        targetId: parsed.targetId
      });
    }
    throw error;
  }
  if (!nextFollowAt) {
    await writeAudit(store, {
      teamId: actor.teamId,
      actorId: actor.id,
      action: "schedule",
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      callRecordId: record.id,
      activityId: "",
      nextFollowAt: "",
      result: "rejected",
      reason: "invalid_request",
      suppressed: false
    });
    return reject(400, "invalid_request", "下次跟进时间请用日期和时间，例如 2026-10-30 15:30", {
      targetType: parsed.targetType,
      targetId: parsed.targetId
    });
  }

  let prepared: Awaited<ReturnType<typeof prepareTarget>>;
  try {
    prepared = await prepareTarget(store, actor, parsed.targetType, parsed.targetId);
  } catch (error) {
    if (error instanceof ProspectFollowUpError) {
      await writeAudit(store, {
        teamId: actor.teamId,
        actorId: actor.id,
        action: "schedule",
        targetType: parsed.targetType,
        targetId: parsed.targetId,
        callRecordId: record.id,
        activityId: "",
        nextFollowAt: "",
        result: "rejected",
        reason: error.status === 403 ? "forbidden" : "not_contactable",
        suppressed: false
      });
      return reject(error.status, error.status === 403 ? "forbidden" : "not_contactable", error.message, {
        targetType: parsed.targetType,
        targetId: parsed.targetId
      });
    }
    throw error;
  }
  if (!prepared.ok) {
    await writeAudit(store, {
      teamId: actor.teamId,
      actorId: actor.id,
      action: "schedule",
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      callRecordId: record.id,
      activityId: "",
      nextFollowAt: "",
      result: "rejected",
      reason: prepared.reason,
      suppressed: false
    });
    return reject(prepared.status, prepared.reason, prepared.message, {
      targetType: parsed.targetType,
      targetId: parsed.targetId
    });
  }
  const raced = findArrangement(store, actor.teamId, parsed.targetType, parsed.targetId);
  if (raced) {
    await writeAudit(store, {
      teamId: actor.teamId,
      actorId: actor.id,
      action: "schedule",
      targetType: raced.targetType,
      targetId: raced.targetId,
      callRecordId: raced.callRecordId,
      activityId: raced.activityId,
      nextFollowAt: raced.nextFollowAt,
      result: "duplicate",
      reason: "duplicate",
      suppressed: raced.suppressed
    });
    return { status: 200, body: duplicateBody(raced) };
  }

  const at = outboundInstant().toISOString();
  const suppressed = objectSuppressed(store, prepared.targetType, prepared.targetId, actor.teamId, at);
  const content = followUpContent(outcome, record.maskedNumber, nextFollowAt);
  let activityId = "";
  try {
    if (prepared.targetType === "customer") {
      activityId = createCustomerFollowUp(store, actor, prepared.targetId, content, nextFollowAt, at);
    } else if (prepared.targetType === "lead") {
      activityId = createLeadFollowUp(store, actor, prepared.targetId, content, nextFollowAt, at);
    } else if (prepared.candidate) {
      activityId = createProspectFollowUp(store, actor, prepared.candidate, content, nextFollowAt, at);
    }
  } catch (error) {
    if (error instanceof ProspectFollowUpError) {
      await writeAudit(store, {
        teamId: actor.teamId,
        actorId: actor.id,
        action: "schedule",
        targetType: prepared.targetType,
        targetId: prepared.targetId,
        callRecordId: record.id,
        activityId: "",
        nextFollowAt: "",
        result: "rejected",
        reason: error.status === 403 ? "forbidden" : "not_contactable",
        suppressed: false
      });
      return reject(error.status, error.status === 403 ? "forbidden" : "not_contactable", error.message, {
        targetType: prepared.targetType,
        targetId: prepared.targetId
      });
    }
    throw error;
  }
  if (!activityId) {
    await writeAudit(store, {
      teamId: actor.teamId,
      actorId: actor.id,
      action: "schedule",
      targetType: prepared.targetType,
      targetId: prepared.targetId,
      callRecordId: record.id,
      activityId: "",
      nextFollowAt: "",
      result: "rejected",
      reason: "not_found",
      suppressed: false
    });
    return reject(404, "not_found", "跟进对象不存在", {
      targetType: prepared.targetType,
      targetId: prepared.targetId
    });
  }
  const created: IntentFollowupArrangement = {
    id: `ifa_${randomUUID()}`,
    teamId: actor.teamId,
    actorId: actor.id,
    at,
    targetType: prepared.targetType,
    targetId: prepared.targetId,
    callRecordId: record.id,
    activityId,
    nextFollowAt,
    suppressed
  };
  store.intentFollowupArrangements.unshift(created);
  await writeAudit(store, {
    teamId: actor.teamId,
    actorId: actor.id,
    action: "schedule",
    targetType: prepared.targetType,
    targetId: prepared.targetId,
    callRecordId: record.id,
    activityId,
    nextFollowAt,
    result: "created",
    reason: "",
    suppressed
  });
  return {
    status: 201,
    body: {
      result: "created" as const,
      replayed: false,
      reason: "",
      message: "已安排下次跟进",
      targetType: prepared.targetType,
      targetId: prepared.targetId,
      callRecordId: record.id,
      activityId,
      nextFollowAt,
      suppressionNotice: suppressed ? SUPPRESSION_FOLLOW_UP_NOTICE : ""
    }
  };
}
