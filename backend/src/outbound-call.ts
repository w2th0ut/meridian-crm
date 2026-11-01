import { createHash, randomUUID } from "node:crypto";
import { canSeeOwner, hasIamPermission, type IamActor } from "./auth.js";
import {
  ALIYUN_CCC_REGION_IDS,
  callWindowMinutes,
  outboundCallingPolicy
} from "./aliyun-outbound-config.js";
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
import { isPhoneMarkedInvalid } from "./phone-validity-state.js";
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
  | "unmapped"
  | "ambiguous"
  | "outside_window"
  | "daily_limit"
  | "min_interval"
  | "invalid_number"
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
  unmapped: "当前用户没有对应的云联络中心坐席",
  ambiguous: "这个号码对应多条记录，请从对应页面单独发起",
  outside_window: "当前不在允许拨打时段",
  daily_limit: "同一号码今日拨打次数已达上限",
  min_interval: "距上次拨打未满最小间隔",
  invalid_number: "该号码已标记无效",
  dial_failed: "外呼没有发出"
};

function statusFor(reason: OutboundCallReason) {
  if (reason === "invalid_request" || reason === "outside_window" || reason === "daily_limit" || reason === "min_interval" || reason === "invalid_number") return 400;
  if (reason === "forbidden" || reason === "disabled" || reason === "unmapped") return 403;
  if (reason === "not_found") return 404;
  if (reason === "dial_failed") return 502;
  return 409;
}

let dialerOverride: OutboundDialer | undefined;

/** 测试注入 mock。传入 undefined 恢复为不访问网络的默认传输。 */
export function setOutboundDialerForTests(dialer: OutboundDialer | undefined) {
  dialerOverride = dialer;
}

/** 没有单独设置时区的租户与 IAM 建租户时的默认值一致。 */
export const DEFAULT_TENANT_TIMEZONE = "Asia/Shanghai";

let outboundNowOverride: Date | undefined;
const tenantTimezoneOverrides = new WeakMap<object, Map<string, string>>();

/** 测试冻结“现在”。传入 undefined 恢复为真实时间。 */
export function setOutboundNowForTests(value: Date | undefined) {
  outboundNowOverride = value ? new Date(value.getTime()) : undefined;
}

/** 测试指定租户时区。传入 undefined 去掉覆盖，改回默认或 IAM 记录。 */
export function setTenantTimezoneOverride(store: object, teamId: string, timeZone: string | undefined) {
  const current = tenantTimezoneOverrides.get(store);
  if (!timeZone) {
    current?.delete(teamId);
    return;
  }
  if (!isValidTimeZone(timeZone)) return;
  const map = current || new Map<string, string>();
  if (!current) tenantTimezoneOverrides.set(store, map);
  map.set(teamId, timeZone);
}

function outboundNow() {
  return outboundNowOverride ? new Date(outboundNowOverride.getTime()) : new Date();
}

/** 跟进默认时间用的“现在”。测试里和拨号时段是同一只时钟。 */
export function outboundInstant() {
  return outboundNow();
}

function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function zonedClock(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(at);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || "";
  let hour = Number(pick("hour"));
  if (hour === 24) hour = 0;
  return {
    dateKey: `${pick("year")}-${pick("month")}-${pick("day")}`,
    minutes: hour * 60 + Number(pick("minute"))
  };
}

async function resolveTenantTimezone(store: CrmStore, teamId: string) {
  const override = tenantTimezoneOverrides.get(store)?.get(teamId);
  if (override && isValidTimeZone(override)) return override;
  if (store.readTenantTimezone) {
    try {
      const value = (await store.readTenantTimezone(teamId)).trim();
      if (value && isValidTimeZone(value)) return value;
    } catch {
      // 读不到租户时区时用默认值，不因此把拨号放过去或拦死。
    }
  }
  return DEFAULT_TENANT_TIMEZONE;
}

/** 租户当地日，格式 YYYY-MM-DD。和拨号时段用的是同一套时区。 */
export function zonedDateKey(at: Date, timeZone: string) {
  return zonedClock(at, timeZone).dateKey;
}

export async function tenantTimeZoneFor(store: CrmStore, teamId: string) {
  return resolveTenantTimezone(store, teamId);
}

/** 只摘要数字。审计里不留号码本身。 */
export function outboundNumberKey(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  return createHash("sha256").update(digits).digest("hex");
}

/**
 * 原有门禁通过之后才看。先时段，再当日上限，再最小间隔。
 * 只统计结果为允许的拨打。拒绝不占次数，也不刷新间隔。
 */
async function callingLimitReason(store: CrmStore, teamId: string, phone: string, at: Date): Promise<OutboundCallReason | null> {
  const policy = outboundCallingPolicy(store.aliyunOutboundConfigs.find((item) => item.teamId === teamId));
  const timeZone = await resolveTenantTimezone(store, teamId);
  const local = zonedClock(at, timeZone);
  const start = callWindowMinutes(policy.callWindowStart);
  const end = callWindowMinutes(policy.callWindowEnd);
  if (local.minutes < start || local.minutes > end) return "outside_window";
  const key = outboundNumberKey(phone);
  if (!key) return null;
  const allowed = store.outboundCallAudits.filter((item) =>
    item.teamId === teamId && item.result === "allowed" && item.numberKey === key
  );
  const todayCount = allowed.filter((item) => {
    const parsed = Date.parse(item.at);
    if (!Number.isFinite(parsed)) return false;
    return zonedClock(new Date(parsed), timeZone).dateKey === local.dateKey;
  }).length;
  if (todayCount >= policy.maxCallsPerNumberPerDay) return "daily_limit";
  if (policy.minIntervalMinutes > 0) {
    let latest = 0;
    for (const item of allowed) {
      const parsed = Date.parse(item.at);
      if (Number.isFinite(parsed) && parsed > latest) latest = parsed;
    }
    if (latest && at.getTime() - latest < policy.minIntervalMinutes * 60_000) return "min_interval";
  }
  return null;
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
    at: outboundNow().toISOString(),
    numberKey: input.numberKey || "",
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

function mappedCccUserId(store: CrmStore, user: SessionUser) {
  const mapped = store.aliyunAgentMappings.find((item) => item.teamId === user.teamId && item.crmUserId === user.id);
  return mapped?.cccUserId.trim() || "";
}

/** 只去掉空格和常见分隔符后的数字。不去掉国家码 86，这一步待核实。 */
export function outboundPhoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

export interface VisiblePhoneMatch {
  targetType: OutboundTargetType;
  targetId: string;
  phoneId: string;
  phone: string;
}

/** 当前用户可见范围内，数字完全相同的电话。多条不自动挑一条。 */
export function listExactPhoneMatches(store: CrmStore, user: SessionUser, rawPhone: string): VisiblePhoneMatch[] {
  const digits = outboundPhoneDigits(rawPhone);
  if (digits.length < 5) return [];
  const matches: VisiblePhoneMatch[] = [];
  for (const customer of store.customers) {
    if (customer.teamId !== user.teamId) continue;
    if (!canDialOwner(user, customer.ownerId, customer.teamId)) continue;
    const phone = (customer.phone || "").trim();
    if (!phone || outboundPhoneDigits(phone) !== digits) continue;
    matches.push({ targetType: "customer", targetId: customer.id, phoneId: customerPhoneId(customer.id), phone });
  }
  for (const lead of store.leads) {
    if (lead.deletedAt || lead.teamId !== user.teamId) continue;
    if (!canDialOwner(user, lead.ownerId, lead.teamId)) continue;
    const phone = (lead.phone || "").trim();
    if (!phone || outboundPhoneDigits(phone) !== digits) continue;
    matches.push({ targetType: "lead", targetId: lead.id, phoneId: leadPhoneId(lead.id), phone });
  }
  for (const candidate of store.websiteOpportunities) {
    if (candidate.teamId !== user.teamId || !candidate.tenantProspectId) continue;
    if (!canDialOwner(user, candidate.ownerId, candidate.teamId)) continue;
    for (const channel of store.prospectContactChannels) {
      if (channel.teamId !== candidate.teamId || channel.prospectId !== candidate.tenantProspectId) continue;
      if (channel.channelType !== "phone") continue;
      const phone = (channel.value || "").trim();
      if (!phone || outboundPhoneDigits(phone) !== digits) continue;
      matches.push({ targetType: "prospect", targetId: candidate.id, phoneId: channel.id, phone });
    }
  }
  return matches;
}

async function resolveWorkbenchCallee(store: CrmStore, user: SessionUser, callee: string) {
  const config = readDialConfig(store, user.teamId);
  const permitted = hasIamPermission(user, OUTBOUND_CALL_PERMISSION);
  if (permitted) await assignOutboundScope(store, user);
  let reason: OutboundCallReason | null = null;
  if (!config.enabled) reason = "disabled";
  else if (!config.complete) reason = "config_incomplete";
  else if (!permitted) reason = "forbidden";
  else if (!mappedCccUserId(store, user)) reason = "unmapped";
  const matches = reason ? [] : listExactPhoneMatches(store, user, callee);
  if (!reason && matches.length === 0) reason = "not_found";
  if (!reason && matches.length > 1) reason = "ambiguous";
  return { reason, match: matches.length === 1 ? matches[0] : null, masked: maskOutboundNumber(callee) };
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
  const numberKey = located.visible && located.phone ? outboundNumberKey(located.phone) : "";

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
  } else if (!mappedCccUserId(store, user)) reason = "unmapped";

  if (!reason && located.phone) {
    const limitReason = await callingLimitReason(store, user.teamId, located.phone, outboundNow());
    if (limitReason) reason = limitReason;
  }
  // 原有门禁都通过之后才拒绝无效号码。不改前面的原因，也不放宽它们。
  if (!reason && isPhoneMarkedInvalid(store, user.teamId, parsed.phoneId)) reason = "invalid_number";

  if (reason) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      phoneId: parsed.phoneId,
      maskedNumber,
      numberKey,
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

  const seatUserId = mappedCccUserId(store, user);
  const params: MakeCallParams = {
    InstanceId: config.instanceId,
    DeviceId: CCC_MAKE_CALL_DEVICE_ID,
    Callee: located.phone,
    Caller: config.callerNumber,
    UserId: seatUserId,
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
      numberKey,
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
      numberKey,
      result: "rejected",
      reason: "dial_failed",
      jobId: ""
    });
    return rejected("dial_failed");
  }
}

export async function previewWorkbenchCallee(store: CrmStore, user: SessionUser | undefined, callee: unknown) {
  if (!user?.id || !user.teamId) {
    return { status: 401, body: { allowed: false, reason: "forbidden", message: "未登录" } };
  }
  const raw = typeof callee === "string" ? callee.trim() : "";
  if (!raw || raw.length > 32) {
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
  const resolved = await resolveWorkbenchCallee(store, user, raw);
  if (resolved.reason) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      targetType: "",
      targetId: "",
      phoneId: "",
      maskedNumber: resolved.masked,
      result: "rejected",
      reason: resolved.reason,
      jobId: ""
    });
    const outcome = rejected(resolved.reason);
    return { status: outcome.status, body: { allowed: false, ...outcome.body } };
  }
  return { status: 200, body: { allowed: true, reason: "", message: "" } };
}

/** 工作台 MakeCall 只在唯一可见号码上走原门禁。不接受调用方指定坐席。 */
export async function dialWorkbenchCallee(store: CrmStore, user: SessionUser | undefined, callee: unknown) {
  if (!user?.id || !user.teamId) {
    return { status: 401, body: { result: "rejected" as const, reason: "forbidden", message: "未登录" } };
  }
  const raw = typeof callee === "string" ? callee.trim() : "";
  if (!raw || raw.length > 32) {
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
  const resolved = await resolveWorkbenchCallee(store, user, raw);
  if (resolved.reason || !resolved.match) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      targetType: "",
      targetId: "",
      phoneId: "",
      maskedNumber: resolved.masked,
      result: "rejected",
      reason: resolved.reason || "not_found",
      jobId: ""
    });
    return rejected(resolved.reason || "not_found");
  }
  return requestOutboundCall(store, user, {
    targetType: resolved.match.targetType,
    targetId: resolved.match.targetId,
    phoneId: resolved.match.phoneId
  });
}

