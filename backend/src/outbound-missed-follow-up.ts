import { randomUUID } from "node:crypto";
import { hasIamPermission } from "./auth.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import { outboundCallingPolicy } from "./aliyun-outbound-config.js";
import { appendFollowUpAudit } from "./follow-up-audit.js";
import {
  isEstablishedCall,
  presentOutboundCallRecord,
  resolveOutboundCallRecordAccess,
  outboundCallRecordVisible
} from "./outbound-call-records.js";
import { outboundInstant, tenantTimeZoneFor, zonedDateKey } from "./outbound-call.js";
import { describeProspectComplianceNotices } from "./prospect-compliance-notice.js";
import {
  ProspectFollowUpError,
  normalizeProspectNextFollowAt,
  recordProspectFollowUp
} from "./prospect-follow-up.js";
import type { CrmStore } from "./store.js";
import type {
  OutboundCallRecord,
  OutboundMissedFollowUp,
  OutboundMissedFollowUpAudit,
  SessionUser,
  WebsiteOpportunity
} from "./types.js";

/**
 * 未接通通话生成一条下次跟进。
 * 未接通与统计相同：establishedTimeRaw 去掉空白后为空。
 * 只写跟进和时间，不拨号，不发信，不推进序列，不改抑制。
 */

export const SUPPRESSION_FOLLOW_UP_NOTICE = "该对象在抑制或退订名单中。这次只记下下次跟进，不改变抑制状态。";

const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets"] as const;

type TargetType = "customer" | "lead" | "prospect";

function addCalendarDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  const nextYear = utc.getUTCFullYear();
  const nextMonth = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(utc.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function calendarWeekday(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** 下一工作日。周一到周五，跳过周六和周日。没有节假日日历。 */
export function nextBusinessDateKey(dateKey: string) {
  let cursor = addCalendarDays(dateKey, 1);
  for (let step = 0; step < 7; step += 1) {
    const weekday = calendarWeekday(cursor);
    if (weekday !== 0 && weekday !== 6) return cursor;
    cursor = addCalendarDays(cursor, 1);
  }
  return cursor;
}

/** 租户时区的下一工作日，时刻是允许拨打时段的开始。开始这一分钟算在时段内。 */
export async function suggestedMissedFollowAt(store: CrmStore, teamId: string, now: Date) {
  const timeZone = await tenantTimeZoneFor(store, teamId);
  const policy = outboundCallingPolicy(store.aliyunOutboundConfigs.find((item) => item.teamId === teamId));
  return `${nextBusinessDateKey(zonedDateKey(now, timeZone))} ${policy.callWindowStart}`;
}

function followUpContent(maskedNumber: string, nextFollowAt: string) {
  const number = maskedNumber ? `号码 ${maskedNumber}。` : "";
  return `未接通，已安排下次跟进。${number}时间 ${nextFollowAt}`;
}

function objectSuppressed(store: CrmStore, targetType: TargetType, targetId: string, teamId: string, at: string) {
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

function parseFollowRequest(body: unknown): { ok: true; nextFollowAt: string | null } | { ok: false } {
  if (body === undefined || body === null) return { ok: true, nextFollowAt: null };
  if (Array.isArray(body) || typeof body !== "object") return { ok: false };
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return { ok: false };
  const value = record.nextFollowAt;
  if (value === undefined || value === null || value === "") return { ok: true, nextFollowAt: null };
  if (typeof value !== "string") return { ok: false };
  return { ok: true, nextFollowAt: value };
}

function emptyBody(callRecordId: string, message: string, reason: string) {
  return {
    result: "rejected" as const,
    replayed: false,
    reason,
    message,
    callRecordId,
    targetType: "",
    targetId: "",
    activityId: "",
    nextFollowAt: "",
    suppressionNotice: ""
  };
}

async function writeAudit(store: CrmStore, input: Omit<OutboundMissedFollowUpAudit, "id" | "at">) {
  const audit: OutboundMissedFollowUpAudit = {
    id: `omfa_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.outboundMissedFollowUpAudits.unshift(audit);
  await store.persist();
  return audit;
}

function existingLink(store: CrmStore, callRecordId: string) {
  return store.outboundMissedFollowUps.find((item) => item.callRecordId === callRecordId);
}

function noticeFor(suppressed: boolean) {
  return suppressed ? SUPPRESSION_FOLLOW_UP_NOTICE : "";
}

function duplicateBody(link: OutboundMissedFollowUp) {
  return {
    result: "duplicate" as const,
    replayed: true,
    reason: "duplicate",
    message: "这条通话已经生成过下次跟进",
    callRecordId: link.callRecordId,
    targetType: link.targetType,
    targetId: link.targetId,
    activityId: link.activityId,
    nextFollowAt: link.nextFollowAt,
    suppressionNotice: noticeFor(link.suppressed)
  };
}

export async function readMissedCallFollowUpDetail(store: CrmStore, user: SessionUser | undefined, callRecordId: string) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const record = store.outboundCallRecords.find((item) => item.id === callRecordId);
  if (!record || !outboundCallRecordVisible(record, user.teamId, resolved.access)) {
    return { status: 404, body: { message: "通话记录不存在" } };
  }
  const established = isEstablishedCall(record.establishedTimeRaw);
  const link = existingLink(store, record.id);
  const suggestedNextFollowAt = established
    ? ""
    : await suggestedMissedFollowAt(store, user.teamId, outboundInstant());
  const suppressed = !established && objectSuppressed(store, record.targetType, record.targetId, record.teamId, outboundInstant().toISOString());
  return {
    status: 200,
    body: {
      record: {
        ...presentOutboundCallRecord(record, resolved.access.timeZone, resolved.access.labels),
        followUpGenerated: Boolean(link)
      },
      suggestedNextFollowAt,
      suppressionNotice: noticeFor(suppressed),
      followUp: link ? {
        activityId: link.activityId,
        nextFollowAt: link.nextFollowAt,
        suppressed: link.suppressed,
        at: link.at
      } : null
    }
  };
}

async function reject(store: CrmStore, input: {
  user: SessionUser;
  callRecordId: string;
  targetType?: TargetType | "";
  targetId?: string;
  status: number;
  reason: string;
  message: string;
}) {
  await writeAudit(store, {
    teamId: input.user.teamId,
    actorId: input.user.id,
    callRecordId: input.callRecordId,
    targetType: input.targetType || "",
    targetId: input.targetId || "",
    activityId: "",
    nextFollowAt: "",
    result: "rejected",
    reason: input.reason,
    suppressed: false
  });
  return {
    status: input.status,
    body: {
      ...emptyBody(input.callRecordId, input.message, input.reason),
      targetType: input.targetType || "",
      targetId: input.targetId || ""
    }
  };
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

async function prepareTarget(store: CrmStore, user: SessionUser, record: OutboundCallRecord) {
  if (record.targetType === "customer") {
    const customer = store.customers.find((item) => item.id === record.targetId);
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
    return { ok: true as const, targetType: "customer" as const, targetId: customer.id };
  }
  if (record.targetType === "lead") {
    const lead = store.leads.find((item) => item.id === record.targetId);
    if (!lead || lead.teamId !== user.teamId || lead.deletedAt) {
      return { ok: false as const, status: 404, reason: "not_found", message: "线索不存在、已删除或无权访问" };
    }
    if (!hasIamPermission(user, "lead.update")) {
      return { ok: false as const, status: 403, reason: "forbidden", message: "没有维护该线索的权限" };
    }
    if (!await ownerVisible(store, user, "lead.update", lead.ownerId, lead.teamId)) {
      return { ok: false as const, status: 404, reason: "not_found", message: "线索不存在、已删除或无权访问" };
    }
    return { ok: true as const, targetType: "lead" as const, targetId: lead.id };
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === record.targetId);
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
  return { ok: true as const, targetType: "prospect" as const, targetId: candidate.id, candidate };
}

export async function generateMissedCallFollowUp(
  store: CrmStore,
  user: SessionUser | undefined,
  callRecordId: string,
  body: unknown
) {
  if (!user?.id || !user.teamId) {
    return { status: 401, body: emptyBody(callRecordId, "未登录", "forbidden") };
  }
  const parsed = parseFollowRequest(body);
  if (!parsed.ok) {
    return reject(store, {
      user,
      callRecordId,
      status: 400,
      reason: "invalid_request",
      message: "一次只能为一条通话记录生成下次跟进"
    });
  }
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const record = store.outboundCallRecords.find((item) => item.id === callRecordId);
  if (!record || !outboundCallRecordVisible(record, user.teamId, resolved.access)) {
    return reject(store, {
      user,
      callRecordId,
      status: 404,
      reason: "not_found",
      message: "通话记录不存在"
    });
  }
  if (isEstablishedCall(record.establishedTimeRaw)) {
    return reject(store, {
      user,
      callRecordId,
      targetType: record.targetType,
      targetId: record.targetId,
      status: 409,
      reason: "established",
      message: "这通已经接通，不能从这里生成下次跟进"
    });
  }
  const link = existingLink(store, record.id);
  if (link) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      callRecordId: record.id,
      targetType: link.targetType,
      targetId: link.targetId,
      activityId: link.activityId,
      nextFollowAt: link.nextFollowAt,
      result: "duplicate",
      reason: "duplicate",
      suppressed: link.suppressed
    });
    return { status: 200, body: duplicateBody(link) };
  }

  let nextFollowAt = "";
  try {
    nextFollowAt = parsed.nextFollowAt === null
      ? await suggestedMissedFollowAt(store, user.teamId, outboundInstant())
      : normalizeProspectNextFollowAt(parsed.nextFollowAt);
  } catch (error) {
    if (error instanceof ProspectFollowUpError) {
      return reject(store, {
        user,
        callRecordId,
        targetType: record.targetType,
        targetId: record.targetId,
        status: error.status,
        reason: "invalid_request",
        message: error.message
      });
    }
    throw error;
  }
  if (!nextFollowAt) {
    return reject(store, {
      user,
      callRecordId,
      targetType: record.targetType,
      targetId: record.targetId,
      status: 400,
      reason: "invalid_request",
      message: "下次跟进时间请用日期和时间，例如 2026-10-30 15:30"
    });
  }

  let prepared: Awaited<ReturnType<typeof prepareTarget>>;
  try {
    prepared = await prepareTarget(store, user, record);
  } catch (error) {
    if (error instanceof ProspectFollowUpError) {
      return reject(store, {
        user,
        callRecordId,
        targetType: record.targetType,
        targetId: record.targetId,
        status: error.status,
        reason: error.status === 403 ? "forbidden" : "not_contactable",
        message: error.message
      });
    }
    throw error;
  }
  if (!prepared.ok) {
    return reject(store, {
      user,
      callRecordId,
      targetType: record.targetType,
      targetId: record.targetId,
      status: prepared.status,
      reason: prepared.reason,
      message: prepared.message
    });
  }
  const raced = existingLink(store, record.id);
  if (raced) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      callRecordId: record.id,
      targetType: raced.targetType,
      targetId: raced.targetId,
      activityId: raced.activityId,
      nextFollowAt: raced.nextFollowAt,
      result: "duplicate",
      reason: "duplicate",
      suppressed: raced.suppressed
    });
    return { status: 200, body: duplicateBody(raced) };
  }

  const at = outboundInstant().toISOString();
  const suppressed = objectSuppressed(store, prepared.targetType, prepared.targetId, user.teamId, at);
  const content = followUpContent(record.maskedNumber, nextFollowAt);
  let activityId = "";
  try {
    if (prepared.targetType === "customer") {
      activityId = createCustomerFollowUp(store, user, prepared.targetId, content, nextFollowAt, at);
    } else if (prepared.targetType === "lead") {
      activityId = createLeadFollowUp(store, user, prepared.targetId, content, nextFollowAt, at);
    } else if (prepared.candidate) {
      activityId = createProspectFollowUp(store, user, prepared.candidate, content, nextFollowAt, at);
    }
  } catch (error) {
    if (error instanceof ProspectFollowUpError) {
      return reject(store, {
        user,
        callRecordId,
        targetType: prepared.targetType,
        targetId: prepared.targetId,
        status: error.status,
        reason: error.status === 403 ? "forbidden" : "not_contactable",
        message: error.message
      });
    }
    throw error;
  }
  if (!activityId) {
    return reject(store, {
      user,
      callRecordId,
      targetType: prepared.targetType,
      targetId: prepared.targetId,
      status: 404,
      reason: "not_found",
      message: "跟进对象不存在"
    });
  }

  const created: OutboundMissedFollowUp = {
    id: `omf_${randomUUID()}`,
    teamId: user.teamId,
    actorId: user.id,
    at,
    callRecordId: record.id,
    targetType: prepared.targetType,
    targetId: prepared.targetId,
    activityId,
    nextFollowAt,
    suppressed
  };
  store.outboundMissedFollowUps.unshift(created);
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    callRecordId: record.id,
    targetType: prepared.targetType,
    targetId: prepared.targetId,
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
      message: "已生成下次跟进",
      callRecordId: record.id,
      targetType: prepared.targetType,
      targetId: prepared.targetId,
      activityId,
      nextFollowAt,
      suppressionNotice: noticeFor(suppressed)
    }
  };
}
