/**
 * 来电弹屏。只读匹配，不建客户、不改线索、不改候选。
 * 号码比较只去掉非数字。是否去掉国家码 86，待核实。
 * SDK onCallComing 的 callContext 里，除 caller、callee、jobId、callType 以外的字段待核实，这里不用。
 */

import { randomUUID } from "node:crypto";
import { canSeeOwner, hasIamPermission, type IamActor } from "./auth.js";
import { maskOutboundNumber, outboundPhoneDigits } from "./outbound-call.js";
import type { CrmStore } from "./store.js";
import type { AliyunScreenPop, SessionUser } from "./types.js";

const INBOUND_EVENTS = new Set(["Ringing", "AgentRinging"]);

export interface ScreenPopMatch {
  targetType: "customer" | "lead" | "prospect";
  targetId: string;
  title: string;
  view: "customers" | "leads" | "lead-finder";
}

export interface ScreenPopCard {
  id: string;
  at: string;
  contactId: string;
  callType: string;
  maskedNumber: string;
  unknown: boolean;
  label: string;
  matches: ScreenPopMatch[];
}

function clip(value: string, max: number) {
  return value.trim().slice(0, max);
}

async function withScope<T>(store: CrmStore, user: SessionUser, permission: string, read: () => T) {
  if (!hasIamPermission(user, permission)) return [] as T;
  const previous = user.iamDataScope;
  if (store.resolveIamDataScope) {
    user.iamDataScope = {
      permissionCode: permission,
      ...await store.resolveIamDataScope(user, permission)
    };
  } else {
    const scopes = user.iamPermissions?.[permission] || [];
    const organizationWide = scopes.includes("org_unit") || scopes.includes("org_subtree");
    user.iamDataScope = {
      permissionCode: permission,
      tenantWide: scopes.includes("tenant"),
      ownerIds: organizationWide
        ? store.users.filter((item) => item.teamId === user.teamId && item.status === "active").map((item) => item.id)
        : scopes.includes("self") ? [user.id] : []
    };
  }
  try {
    return read();
  } finally {
    user.iamDataScope = previous;
  }
}

function visible(user: IamActor, ownerId: string, teamId: string) {
  return teamId === user.teamId && canSeeOwner(user, ownerId, teamId);
}

export async function matchScreenPopTargets(store: CrmStore, user: SessionUser, input: {
  callType: string;
  caller: string;
  callee: string;
  jobId: string;
}) {
  const matches: ScreenPopMatch[] = [];
  const seen = new Set<string>();
  const add = (match: ScreenPopMatch) => {
    const key = `${match.targetType}:${match.targetId}`;
    if (seen.has(key)) return;
    seen.add(key);
    matches.push(match);
  };
  const jobId = input.jobId.trim();
  const jobTargets = jobId ? [
    ...store.outboundCallAudits.filter((item) => item.teamId === user.teamId && item.result === "allowed" && item.jobId === jobId),
    ...store.outboundCallRecords.filter((item) => item.teamId === user.teamId && item.contactId === jobId)
  ] : [];
  const callType = input.callType.trim().toUpperCase();
  const rawNumber = callType === "INBOUND" ? input.caller : callType === "OUTBOUND" ? input.callee : "";
  const digits = outboundPhoneDigits(rawNumber);
  if (digits.length >= 5 || jobTargets.length) {
    const customers = await withScope(store, user, "customer.read", () => store.customers.filter((item) => {
      if (!visible(user, item.ownerId, item.teamId)) return false;
      if (jobTargets.some((job) => job.targetType === "customer" && job.targetId === item.id)) return true;
      return digits.length >= 5 && outboundPhoneDigits(item.phone || "") === digits;
    }));
    for (const customer of customers) add({ targetType: "customer", targetId: customer.id, title: customer.company || "客户", view: "customers" });
    const leads = await withScope(store, user, "lead.read", () => store.leads.filter((item) => {
      if (item.deletedAt || !visible(user, item.ownerId, item.teamId)) return false;
      if (jobTargets.some((job) => job.targetType === "lead" && job.targetId === item.id)) return true;
      return digits.length >= 5 && outboundPhoneDigits(item.phone || "") === digits;
    }));
    for (const lead of leads) add({ targetType: "lead", targetId: lead.id, title: lead.company || "线索", view: "leads" });
    const prospects = await withScope(store, user, "prospect.read", () => store.websiteOpportunities.filter((item) => {
      if (!visible(user, item.ownerId, item.teamId)) return false;
      if (jobTargets.some((job) => job.targetType === "prospect" && job.targetId === item.id)) return true;
      if (!item.tenantProspectId || digits.length < 5) return false;
      return store.prospectContactChannels.some((channel) =>
        channel.teamId === item.teamId
        && channel.prospectId === item.tenantProspectId
        && channel.channelType === "phone"
        && outboundPhoneDigits(channel.value || "") === digits
      );
    }));
    for (const candidate of prospects) add({ targetType: "prospect", targetId: candidate.id, title: candidate.company || "候选", view: "lead-finder" });
  }
  return matches;
}

function cardFrom(pop: AliyunScreenPop, matches: ScreenPopMatch[]): ScreenPopCard {
  return {
    id: pop.id,
    at: pop.at,
    contactId: pop.contactId,
    callType: pop.callType,
    maskedNumber: pop.maskedNumber,
    unknown: matches.length === 0,
    label: matches.length === 0 ? "未知来电" : matches.map((item) => item.title).join("、"),
    matches
  };
}

function mappedSelf(store: CrmStore, user: SessionUser) {
  return store.aliyunAgentMappings.find((item) => item.teamId === user.teamId && item.crmUserId === user.id) || null;
}

function canReadAny(user: SessionUser) {
  return hasIamPermission(user, "customer.read")
    || hasIamPermission(user, "lead.read")
    || hasIamPermission(user, "prospect.read");
}

export async function listScreenPops(store: CrmStore, user: SessionUser | undefined) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  if (!mappedSelf(store, user)) return { status: 403, body: { message: "当前用户没有对应的云联络中心坐席" } };
  if (!canReadAny(user)) return { status: 403, body: { message: "没有查看来电匹配的权限" } };
  const pops = store.aliyunScreenPops.filter((item) => item.teamId === user.teamId && item.crmUserId === user.id).slice(0, 10);
  const cards: ScreenPopCard[] = [];
  for (const pop of pops) {
    const matches = await matchScreenPopTargets(store, user, {
      callType: pop.callType,
      caller: pop.phoneDigits,
      callee: "",
      jobId: pop.contactId
    });
    cards.push(cardFrom(pop, matches));
  }
  return { status: 200, body: { pops: cards } };
}

export async function matchLiveScreenPop(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  if (!mappedSelf(store, user)) return { status: 403, body: { message: "当前用户没有对应的云联络中心坐席" } };
  if (!canReadAny(user)) return { status: 403, body: { message: "没有查看来电匹配的权限" } };
  const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const caller = typeof record.caller === "string" ? record.caller : "";
  const callee = typeof record.callee === "string" ? record.callee : "";
  const callType = typeof record.callType === "string" ? record.callType : "";
  const jobId = typeof record.jobId === "string" ? record.jobId : "";
  const matches = await matchScreenPopTargets(store, user, { callType, caller, callee, jobId });
  const callTypeUpper = callType.trim().toUpperCase();
  const shown = callTypeUpper === "INBOUND" ? caller : callTypeUpper === "OUTBOUND" ? callee : "";
  return {
    status: 200,
    body: {
      unknown: matches.length === 0,
      label: matches.length === 0 ? "未知来电" : matches.map((item) => item.title).join("、"),
      maskedNumber: maskOutboundNumber(shown),
      matches
    }
  };
}

/** 回调验签通过之后才调用。不改变回调的接受或拒绝。callType 为空时不弹，是否能当来电待核实。 */
export function noteInboundScreenPop(store: CrmStore, teamId: string, event: {
  eventType: string;
  eventTime: string;
  callType: string;
  agentId: string;
  caller: string;
  contactId: string;
}) {
  if (!INBOUND_EVENTS.has(event.eventType)) return;
  if (event.callType.trim().toUpperCase() !== "INBOUND") return;
  const agentId = event.agentId.trim();
  if (!agentId || !teamId) return;
  const mapping = store.aliyunAgentMappings.find((item) => item.teamId === teamId && item.cccUserId === agentId);
  if (!mapping) return;
  const digits = outboundPhoneDigits(event.caller).slice(0, 32);
  if (digits.length < 5) return;
  const contactId = clip(event.contactId, 128);
  const eventTime = clip(event.eventTime, 64);
  const duplicate = store.aliyunScreenPops.some((item) =>
    item.teamId === teamId
    && item.cccUserId === agentId
    && item.contactId === contactId
    && item.eventType === event.eventType
    && item.eventTime === eventTime
  );
  if (duplicate) return;
  store.aliyunScreenPops.unshift({
    id: `asp_${randomUUID()}`,
    teamId,
    cccUserId: agentId,
    crmUserId: mapping.crmUserId,
    contactId,
    eventType: clip(event.eventType, 64),
    eventTime,
    callType: "INBOUND",
    maskedNumber: maskOutboundNumber(event.caller),
    phoneDigits: digits,
    at: new Date().toISOString()
  });
  if (store.aliyunScreenPops.length > 200) store.aliyunScreenPops.length = 200;
}
