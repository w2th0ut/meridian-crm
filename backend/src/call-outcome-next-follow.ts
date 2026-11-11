import { hasIamPermission } from "./auth.js";
import { callWindowMinutes, outboundCallingPolicy } from "./aliyun-outbound-config.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import { tenantTimeZoneFor, zonedDateKey, zonedWallMinute } from "./outbound-call.js";
import { describeProspectComplianceNotices } from "./prospect-compliance-notice.js";
import {
  prospectFollowUpWriteAllowed,
  setProspectNextFollowAt
} from "./prospect-follow-up.js";
import type { CrmStore } from "./store.js";
import type { NextFollowUpAuditEvent, OutboundCallRecord, SessionUser } from "./types.js";

/**
 * 单条通话结果保存时顺手定下次跟进。
 * 只写客户 nextReminder、线索和搜客 nextFollowAt。
 * 明天、3 天后、1 周后是租户当地日历日，时刻用允许拨打时段的开始。
 * 2 小时后、4 小时后只给未接通的通话，从现在算起；落在时段外就顶到下一个允许时段的开始。
 * 不设不改已有时间。不写跟进注记，不拨号，不改抑制，也不改暂停。
 */

export const CALL_OUTCOME_NEXT_FOLLOW_CHOICES = ["tomorrow", "plus3", "plus7", "plus2h", "plus4h", "none"] as const;

export type CallOutcomeNextFollowChoice = (typeof CALL_OUTCOME_NEXT_FOLLOW_CHOICES)[number];

export const CALL_OUTCOME_NEXT_FOLLOW_NOTICE = "该对象在抑制或退订名单中。这次只记下下次跟进，不改变抑制状态。";

const DAY_OFFSET: Record<"tomorrow" | "plus3" | "plus7", number> = {
  tomorrow: 1,
  plus3: 3,
  plus7: 7
};

const HOUR_OFFSET = { plus2h: 2, plus4h: 4 } as const;

export function isSameDayFollowChoice(choice: CallOutcomeNextFollowChoice): choice is "plus2h" | "plus4h" {
  return choice === "plus2h" || choice === "plus4h";
}

export function parseCallOutcomeNextFollowChoice(value: unknown):
  | { ok: true; choice: CallOutcomeNextFollowChoice }
  | { ok: false } {
  if (value === undefined || value === null) return { ok: true, choice: "none" };
  if (typeof value !== "string") return { ok: false };
  const text = value.trim();
  if (text === "" || text === "none" || text === "不设") return { ok: true, choice: "none" };
  if (text === "tomorrow" || text === "明天") return { ok: true, choice: "tomorrow" };
  if (text === "plus3" || text === "3天后" || text === "3 天后") return { ok: true, choice: "plus3" };
  if (text === "plus7" || text === "1周后" || text === "1 周后") return { ok: true, choice: "plus7" };
  if (text === "plus2h" || text === "2小时后" || text === "2 小时后") return { ok: true, choice: "plus2h" };
  if (text === "plus4h" || text === "4小时后" || text === "4 小时后") return { ok: true, choice: "plus4h" };
  return { ok: false };
}

export function addCalendarDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  const nextYear = utc.getUTCFullYear();
  const nextMonth = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(utc.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

/**
 * 明天、3 天后、1 周后是租户当地日历日，时刻是允许拨打的开始，不跳过周末。
 * 2 小时后、4 小时后是从现在起的实际小时。落到允许拨打时段内就用当地的这一分钟。
 * 早于开始，顶到当天开始；晚于结束，顶到下一天的开始。结束这一分钟仍算在时段内。
 */
export async function callOutcomeNextFollowAt(
  store: CrmStore,
  teamId: string,
  choice: Exclude<CallOutcomeNextFollowChoice, "none">,
  now: Date
) {
  const timeZone = await tenantTimeZoneFor(store, teamId);
  const policy = outboundCallingPolicy(store.aliyunOutboundConfigs.find((item) => item.teamId === teamId));
  if (isSameDayFollowChoice(choice)) {
    const shifted = new Date(now.getTime() + HOUR_OFFSET[choice] * 3_600_000);
    const wall = zonedWallMinute(shifted, timeZone);
    const start = callWindowMinutes(policy.callWindowStart);
    const end = callWindowMinutes(policy.callWindowEnd);
    if (wall.minutes >= start && wall.minutes <= end) return `${wall.dateKey} ${wall.hhmm}`;
    if (wall.minutes < start) return `${wall.dateKey} ${policy.callWindowStart}`;
    return `${addCalendarDays(wall.dateKey, 1)} ${policy.callWindowStart}`;
  }
  return `${addCalendarDays(zonedDateKey(now, timeZone), DAY_OFFSET[choice])} ${policy.callWindowStart}`;
}

type FollowObjectType = NextFollowUpAuditEvent["objectType"];
type TargetType = "customer" | "lead" | "prospect";

export type CallOutcomeNextFollowPlan =
  | { ok: true; kind: "skip" }
  | {
    ok: true;
    kind: "write";
    objectType: FollowObjectType;
    objectId: string;
    previous: string;
    next: string;
    notice: string;
    apply: () => void;
  }
  | {
    ok: false;
    status: number;
    reason: string;
    message: string;
    audit: {
      action: NextFollowUpAuditEvent["action"];
      objectType: FollowObjectType;
      objectId: string;
    } | null;
  };

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

function suppressionNotice(store: CrmStore, targetType: TargetType, targetId: string, teamId: string, at: string) {
  const hit = store.websiteOpportunities.some((candidate) => {
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
  return hit ? CALL_OUTCOME_NEXT_FOLLOW_NOTICE : "";
}

function rejectPlan(
  status: number,
  reason: string,
  message: string,
  action: NextFollowUpAuditEvent["action"],
  objectType: FollowObjectType,
  objectId: string
): CallOutcomeNextFollowPlan {
  return { ok: false, status, reason, message, audit: { action, objectType, objectId } };
}

function missingTargetPlan(): CallOutcomeNextFollowPlan {
  return {
    ok: false,
    status: 400,
    reason: "no_target",
    message: "这条通话没有关联对象，不能记下下次跟进",
    audit: null
  };
}

/**
 * 按已经算好的墙上时间写下次跟进。空字符串是清空。
 * 权限、公池、可联系和审计口径与快选相同。
 */
export async function planExplicitCallOutcomeNextFollow(
  store: CrmStore,
  user: SessionUser,
  record: Pick<OutboundCallRecord, "targetType" | "targetId">,
  next: string,
  now: Date
): Promise<CallOutcomeNextFollowPlan> {
  const targetType = record.targetType;
  const targetId = (record.targetId || "").trim();
  if ((targetType !== "customer" && targetType !== "lead" && targetType !== "prospect") || !targetId) {
    return missingTargetPlan();
  }
  return planResolvedCallOutcomeNextFollow(store, user, targetType, targetId, next, now);
}

export async function planCallOutcomeNextFollow(
  store: CrmStore,
  user: SessionUser,
  record: Pick<OutboundCallRecord, "targetType" | "targetId">,
  choice: CallOutcomeNextFollowChoice,
  now: Date
): Promise<CallOutcomeNextFollowPlan> {
  if (choice === "none") return { ok: true, kind: "skip" };
  const targetType = record.targetType;
  const targetId = (record.targetId || "").trim();
  if ((targetType !== "customer" && targetType !== "lead" && targetType !== "prospect") || !targetId) {
    return missingTargetPlan();
  }
  const next = await callOutcomeNextFollowAt(store, user.teamId, choice, now);
  return planResolvedCallOutcomeNextFollow(store, user, targetType, targetId, next, now);
}

async function planResolvedCallOutcomeNextFollow(
  store: CrmStore,
  user: SessionUser,
  targetType: "customer" | "lead" | "prospect",
  targetId: string,
  next: string,
  now: Date
): Promise<CallOutcomeNextFollowPlan> {
  const at = now.toISOString();
  if (targetType === "customer") {
    const customer = store.customers.find((item) => item.id === targetId && item.teamId === user.teamId);
    if (!customer) {
      return rejectPlan(404, "not_found", "客户不存在", "reject_not_found", "customer", targetId);
    }
    if (isPublicCustomer(customer)) {
      return rejectPlan(409, "public_pool", "公池客户为只读，请先领取后再操作", "reject_public_pool", "customer", targetId);
    }
    if (!hasIamPermission(user, "customer.update")) {
      return rejectPlan(403, "forbidden", "没有维护该客户的权限", "reject_forbidden", "customer", targetId);
    }
    if (!await ownerVisible(store, user, "customer.update", customer.ownerId, customer.teamId)) {
      return rejectPlan(404, "not_found", "客户不存在", "reject_not_found", "customer", targetId);
    }
    const previous = customer.nextReminder || "";
    return {
      ok: true,
      kind: "write",
      objectType: "customer",
      objectId: customer.id,
      previous,
      next,
      notice: suppressionNotice(store, "customer", customer.id, user.teamId, at),
      apply: () => {
        customer.nextReminder = next;
      }
    };
  }
  if (targetType === "lead") {
    const lead = store.leads.find((item) => item.id === targetId && item.teamId === user.teamId && !item.deletedAt);
    if (!lead) {
      return rejectPlan(404, "not_found", "线索不存在、已删除或无权访问", "reject_not_found", "lead", targetId);
    }
    if (!hasIamPermission(user, "lead.update")) {
      return rejectPlan(403, "forbidden", "没有维护该线索的权限", "reject_forbidden", "lead", targetId);
    }
    if (!await ownerVisible(store, user, "lead.update", lead.ownerId, lead.teamId)) {
      return rejectPlan(404, "not_found", "线索不存在、已删除或无权访问", "reject_not_found", "lead", targetId);
    }
    const previous = lead.nextFollowAt || "";
    return {
      ok: true,
      kind: "write",
      objectType: "lead",
      objectId: lead.id,
      previous,
      next,
      notice: suppressionNotice(store, "lead", lead.id, user.teamId, at),
      apply: () => {
        lead.nextFollowAt = next;
      }
    };
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === targetId && item.teamId === user.teamId);
  if (!candidate) {
    return rejectPlan(404, "not_found", "搜客候选不存在或无权访问", "reject_not_found", "prospect_candidate", targetId);
  }
  if (!hasIamPermission(user, "prospect.execute")) {
    return rejectPlan(403, "forbidden", "没有执行获客任务的权限", "reject_forbidden", "prospect_candidate", targetId);
  }
  if (!await ownerVisible(store, user, "prospect.execute", candidate.ownerId, candidate.teamId)) {
    return rejectPlan(404, "not_found", "搜客候选不存在或无权访问", "reject_not_found", "prospect_candidate", targetId);
  }
  if (candidate.ownerId !== user.id) {
    return rejectPlan(403, "forbidden", "只有候选归属业务员可以记录跟进", "reject_forbidden", "prospect_candidate", targetId);
  }
  if (!prospectFollowUpWriteAllowed(store, candidate, user.id)) {
    return rejectPlan(
      409,
      "not_contactable",
      candidate.status === "excluded" ? "已排除的候选不在这里记录跟进" : "达到可联系后再记录跟进",
      "reject_not_contactable",
      "prospect_candidate",
      targetId
    );
  }
  const previous = candidate.nextFollowAt || "";
  return {
    ok: true,
    kind: "write",
    objectType: "prospect_candidate",
    objectId: candidate.id,
    previous,
    next,
    notice: suppressionNotice(store, "prospect", candidate.id, user.teamId, at),
    apply: () => {
      setProspectNextFollowAt(store, { candidate, actorId: user.id, nextFollowAt: next });
    }
  };
}
