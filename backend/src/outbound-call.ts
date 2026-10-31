import { randomUUID } from "node:crypto";
import { canSeeOwner, hasIamPermission, type IamActor } from "./auth.js";
import { ALIYUN_CCC_REGION_IDS } from "./aliyun-outbound-config.js";
import {
  CCC_MAKE_CALL_DEVICE_ID,
  createAliyunCccMakeCallDialer,
  type MakeCallParams,
  type OutboundDialer
} from "./aliyun-ccc-make-call.js";
import { decryptAliyunOutboundSecret } from "./credential-security.js";
import { describeProspectComplianceNotices } from "./prospect-compliance-notice.js";
import {
  currentContactabilityDecision,
  ProspectQualificationError
} from "./prospect-qualification.js";
import type { CrmStore } from "./store.js";
import type {
  OutboundCallAudit,
  ProspectContactabilityDecision,
  SessionUser,
  WebsiteOpportunity
} from "./types.js";

/** 外呼权限沿用「发送客户通信」。不新增权限码。 */
export const OUTBOUND_CALL_PERMISSION = "communication.send";

const INSTANCE_ID_PATTERN = /^[A-Za-z0-9_@.:-]{1,128}$/;
const CALLER_NUMBER_PATTERN = /^[0-9+\-\s]{5,32}$/;
const TARGET_TYPES = ["customer", "lead", "prospect"] as const;

export type OutboundTargetType = (typeof TARGET_TYPES)[number];

export type OutboundCallReason =
  | "invalid_request"
  | "disabled"
  | "config_incomplete"
  | "forbidden"
  | "not_found"
  | "suppressed"
  | "not_contactable"
  | "dial_failed";

export function customerPhoneId(customerId: string) {
  return `customer-phone:${customerId}`;
}

export function leadPhoneId(leadId: string) {
  return `lead-phone:${leadId}`;
}

/** 只保留末 4 位数字，其余用星号。不足 4 位则全部遮住。 */
export function maskOutboundNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length <= 4) return "*".repeat(digits.length);
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

const MESSAGES: Record<OutboundCallReason, string> = {
  invalid_request: "参数格式错误",
  disabled: "外呼功能未开启",
  config_incomplete: "阿里云外呼配置不完整",
  forbidden: "没有外呼权限，或对象不在当前租户和归属范围内",
  not_found: "外呼对象或号码不存在",
  suppressed: "号码在抑制或退订名单中",
  not_contactable: "候选还不是已批准可联系",
  dial_failed: "外呼没有发出"
};

function statusFor(reason: OutboundCallReason) {
  if (reason === "invalid_request") return 400;
  if (reason === "forbidden" || reason === "disabled") return 403;
  if (reason === "not_found") return 404;
  if (reason === "dial_failed") return 502;
  return 409;
}

let dialerOverride: OutboundDialer | undefined;

/** 测试注入 mock。传入 undefined 恢复为不访问网络的默认传输。 */
export function setOutboundDialerForTests(dialer: OutboundDialer | undefined) {
  dialerOverride = dialer;
}

function dialerFor(region: string) {
  if (dialerOverride) return dialerOverride;
  return createAliyunCccMakeCallDialer({
    region,
    transport: async () => {
      throw new Error("外呼传输未注入");
    }
  });
}

/** 回调和拨号共用这一只客户端。测试注入的 mock 会同时盖住回查。 */
export function outboundDialerFor(region: string) {
  return dialerFor(region);
}

function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

function secretPresent(teamId: string, field: "accessKeyId" | "accessKeySecret", encrypted: string) {
  if (!encrypted) return false;
  try {
    return Boolean(decryptAliyunOutboundSecret(teamId, field, encrypted));
  } catch {
    return false;
  }
}

function readDialConfig(store: CrmStore, teamId: string) {
  const current = store.aliyunOutboundConfigs.find((item) => item.teamId === teamId);
  const enabled = current?.aliyunOutboundEnabled === true;
  if (!current || !enabled) {
    return { enabled: false, complete: false, instanceId: "", region: "", callerNumber: "" };
  }
  const instanceId = current.instanceId.trim();
  const region = current.region.trim();
  const callerNumber = current.callerNumber.trim();
  const complete = Boolean(
    INSTANCE_ID_PATTERN.test(instanceId)
    && (ALIYUN_CCC_REGION_IDS as readonly string[]).includes(region)
    && CALLER_NUMBER_PATTERN.test(callerNumber)
    && secretPresent(teamId, "accessKeyId", current.accessKeyIdEncrypted)
    && secretPresent(teamId, "accessKeySecret", current.accessKeySecretEncrypted)
  );
  return { enabled: true, complete, instanceId, region, callerNumber };
}

async function assignOutboundScope(store: CrmStore, user: SessionUser) {
  if (store.resolveIamDataScope) {
    user.iamDataScope = {
      permissionCode: OUTBOUND_CALL_PERMISSION,
      ...await store.resolveIamDataScope(user, OUTBOUND_CALL_PERMISSION)
    };
    return;
  }
  const scopes = user.iamPermissions?.[OUTBOUND_CALL_PERMISSION] || [];
  const organizationWide = scopes.includes("org_unit") || scopes.includes("org_subtree");
  user.iamDataScope = {
    permissionCode: OUTBOUND_CALL_PERMISSION,
    tenantWide: scopes.includes("tenant"),
    ownerIds: organizationWide
      ? store.users.filter((item) => item.teamId === user.teamId && item.status === "active").map((item) => item.id)
      : scopes.includes("self") ? [user.id] : []
  };
}

function canDialOwner(user: IamActor, ownerId: string, teamId: string) {
  return teamId === user.teamId && canSeeOwner(user, ownerId, teamId);
}

interface ParsedRequest {
  ok: true;
  targetType: OutboundTargetType;
  targetId: string;
  phoneId: string;
}

interface LocatedTarget {
  found: boolean;
  visible: boolean;
  phone: string;
  candidate?: WebsiteOpportunity;
}

function asRecord(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function parseRequest(body: unknown): ParsedRequest | null {
  const record = asRecord(body);
  if (!record) return null;
  if ("targets" in record || "calls" in record || "phoneIds" in record) return null;
  const targetType = record.targetType;
  const targetId = record.targetId;
  const phoneId = record.phoneId;
  if (typeof targetType !== "string" || !TARGET_TYPES.includes(targetType as OutboundTargetType)) return null;
  if (typeof targetId !== "string" || !targetId.trim() || targetId.trim().length > 64) return null;
  if (typeof phoneId !== "string" || !phoneId.trim() || phoneId.trim().length > 128) return null;
  return {
    ok: true,
    targetType: targetType as OutboundTargetType,
    targetId: targetId.trim(),
    phoneId: phoneId.trim()
  };
}

function locateTarget(store: CrmStore, user: SessionUser, parsed: ParsedRequest): LocatedTarget {
  if (parsed.targetType === "customer") {
    const customer = store.customers.find((item) => item.id === parsed.targetId);
    if (!customer) return { found: false, visible: false, phone: "" };
    if (customer.poolStatus === "public") return { found: true, visible: false, phone: "" };
    const visible = canDialOwner(user, customer.ownerId, customer.teamId);
    const phone = visible && parsed.phoneId === customerPhoneId(customer.id) ? (customer.phone || "").trim() : "";
    return { found: true, visible, phone };
  }
  if (parsed.targetType === "lead") {
    const lead = store.leads.find((item) => item.id === parsed.targetId && !item.deletedAt);
    if (!lead) return { found: false, visible: false, phone: "" };
    const visible = canDialOwner(user, lead.ownerId, lead.teamId);
    const phone = visible && parsed.phoneId === leadPhoneId(lead.id) ? (lead.phone || "").trim() : "";
    return { found: true, visible, phone };
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === parsed.targetId);
  if (!candidate) return { found: false, visible: false, phone: "" };
  const visible = canDialOwner(user, candidate.ownerId, candidate.teamId);
  if (!visible || !candidate.tenantProspectId) return { found: true, visible, phone: "", candidate };
  const channel = store.prospectContactChannels.find((item) =>
    item.id === parsed.phoneId
    && item.teamId === candidate.teamId
    && item.ownerId === candidate.ownerId
    && item.prospectId === candidate.tenantProspectId
    && item.channelType === "phone"
  );
  return { found: true, visible, phone: (channel?.value || "").trim(), candidate };
}

function candidateBlocksNumber(store: CrmStore, candidate: WebsiteOpportunity, at: string) {
  return describeProspectComplianceNotices(store, candidate, at).some((notice) =>
    notice.kind === "suppressed" || notice.kind === "opted_out"
  );
}

function numberSuppressed(store: CrmStore, input: {
  teamId: string;
  phone: string;
  customerId?: string;
  leadId?: string;
  candidateId?: string;
  at: string;
}) {
  const digits = phoneDigits(input.phone);
  return store.websiteOpportunities.some((candidate) => {
    if (candidate.teamId !== input.teamId) return false;
    const linked = candidate.id === input.candidateId
      || Boolean(input.customerId && candidate.customerId === input.customerId)
      || Boolean(input.leadId && candidate.leadId === input.leadId);
    const sameNumber = digits.length >= 6
      && Boolean(candidate.tenantProspectId)
      && store.prospectContactChannels.some((channel) =>
        channel.teamId === candidate.teamId
        && channel.prospectId === candidate.tenantProspectId
        && channel.channelType === "phone"
        && phoneDigits(channel.value) === digits
      );
    if (!linked && !sameNumber) return false;
    return candidateBlocksNumber(store, candidate, input.at);
  });
}

function latestDecision(decisions: ProspectContactabilityDecision[]) {
  return decisions.reduce<ProspectContactabilityDecision | undefined>((latest, item) => {
    if (!latest || latest.createdAt < item.createdAt) return item;
    return latest;
  }, undefined);
}

/**
 * 只读复用现有可联系判定。最新决定必须仍是 approved_contactable，
 * 并且 currentContactabilityDecision 没有把它判成过期。不写入、不批准、不转线索。
 */
export function prospectPhoneApproved(
  store: CrmStore,
  candidate: WebsiteOpportunity,
  channelId: string
) {
  if (!candidate.tenantProspectId) return false;
  const latest = latestDecision(store.prospectContactabilityDecisions.filter((item) =>
    item.teamId === candidate.teamId
    && item.ownerId === candidate.ownerId
    && item.approvedBy === candidate.ownerId
    && item.prospectId === candidate.tenantProspectId
    && item.channelId === channelId
  ));
  if (!latest || latest.status !== "approved_contactable") return false;
  try {
    const current = currentContactabilityDecision(store, {
      teamId: latest.teamId,
      ownerId: latest.ownerId,
      prospectId: latest.prospectId,
      campaignId: latest.campaignId,
      campaignVersion: latest.campaignVersion,
      channelId: latest.channelId
    });
    return Boolean(current && current.id === latest.id && current.status === "approved_contactable");
  } catch (error) {
    if (error instanceof ProspectQualificationError) return false;
    throw error;
  }
}

function rejected(reason: OutboundCallReason) {
  return {
    status: statusFor(reason),
    body: { result: "rejected" as const, reason, message: MESSAGES[reason] }
  };
}

async function writeAudit(store: CrmStore, input: Omit<OutboundCallAudit, "id" | "at">) {
  const audit: OutboundCallAudit = {
    id: `oca_${randomUUID()}`,
    at: new Date().toISOString(),
    ...input
  };
  store.outboundCallAudits.unshift(audit);
  await store.persist();
  return audit;
}

/**
 * 只读：当前租户的外呼开关，以及当前用户是否有外呼权限。
 * 不返回实例、地域、主叫或密钥，不写审计，也不拨号。
 */
export function readOutboundCallAvailability(store: CrmStore, user: SessionUser | undefined) {
  if (!user?.id || !user.teamId) {
    return { status: 401, body: { enabled: false, permitted: false } };
  }
  const current = store.aliyunOutboundConfigs.find((item) => item.teamId === user.teamId);
  return {
    status: 200,
    body: {
      enabled: current?.aliyunOutboundEnabled === true,
      permitted: hasIamPermission(user, OUTBOUND_CALL_PERMISSION)
    }
  };
}

export async function requestOutboundCall(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) {
    return { status: 401, body: { result: "rejected" as const, reason: "forbidden", message: "未登录" } };
  }
  const parsed = parseRequest(body);
  if (!parsed) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      targetType: "",
      targetId: "",
      phoneId: "",
      maskedNumber: "",
      result: "rejected",
      reason: "invalid_request",
      jobId: ""
    });
    return rejected("invalid_request");
  }

  const config = readDialConfig(store, user.teamId);
  const permitted = hasIamPermission(user, OUTBOUND_CALL_PERMISSION);
  if (permitted) await assignOutboundScope(store, user);
  const located = permitted ? locateTarget(store, user, parsed) : { found: false, visible: false, phone: "" };
  const maskedNumber = located.visible && located.phone ? maskOutboundNumber(located.phone) : "";

  let reason: OutboundCallReason | null = null;
  if (!config.enabled) reason = "disabled";
  else if (!config.complete) reason = "config_incomplete";
  else if (!permitted) reason = "forbidden";
  else if (!located.found || !located.phone) reason = located.visible ? "not_found" : located.found ? "forbidden" : "not_found";
  else if (!located.visible) reason = "forbidden";
  else if (numberSuppressed(store, {
    teamId: user.teamId,
    phone: located.phone,
    customerId: parsed.targetType === "customer" ? parsed.targetId : undefined,
    leadId: parsed.targetType === "lead" ? parsed.targetId : undefined,
    candidateId: parsed.targetType === "prospect" ? parsed.targetId : undefined,
    at: new Date().toISOString()
  })) reason = "suppressed";
  else if (parsed.targetType === "prospect" && (!located.candidate || !prospectPhoneApproved(store, located.candidate, parsed.phoneId))) {
    reason = "not_contactable";
  }

  if (reason) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      phoneId: parsed.phoneId,
      maskedNumber,
      result: "rejected",
      reason,
      jobId: ""
    });
    const outcome = rejected(reason);
    if (reason === "forbidden" && !permitted) {
      outcome.body.message = "没有外呼权限";
    } else if (reason === "forbidden") {
      outcome.body.message = "外呼对象不在当前账号的租户或归属范围内";
    }
    return outcome;
  }

  const params: MakeCallParams = {
    InstanceId: config.instanceId,
    DeviceId: CCC_MAKE_CALL_DEVICE_ID,
    Callee: located.phone,
    Caller: config.callerNumber,
    ...(maskedNumber ? { MaskedCallee: maskedNumber } : {})
  };
  try {
    const result = await dialerFor(config.region).makeCall(params);
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      phoneId: parsed.phoneId,
      maskedNumber,
      result: "allowed",
      reason: "",
      jobId: result.jobId
    });
    return {
      status: 200,
      body: {
        result: "allowed" as const,
        reason: "",
        jobId: result.jobId,
        targetType: parsed.targetType,
        targetId: parsed.targetId,
        phoneId: parsed.phoneId
      }
    };
  } catch {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      phoneId: parsed.phoneId,
      maskedNumber,
      result: "rejected",
      reason: "dial_failed",
      jobId: ""
    });
    return rejected("dial_failed");
  }
}
