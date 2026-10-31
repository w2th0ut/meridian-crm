import { randomUUID } from "node:crypto";
import { hasIamPermission, type IamActor } from "./auth.js";
import {
  decryptAliyunOutboundSecret,
  encryptAliyunOutboundSecret,
  type AliyunOutboundSecretField
} from "./credential-security.js";
import type {
  AliyunOutboundConfig,
  AliyunOutboundConfigAudit,
  AliyunOutboundConfigView,
  AliyunOutboundSecretMask
} from "./types.js";

/** 官方已列出的 CCC 2020-07-01 地域。其余地域待核实，不放进白名单。 */
export const ALIYUN_CCC_REGION_IDS = ["cn-shanghai", "cn-hangzhou"] as const;

const INSTANCE_ID_PATTERN = /^[A-Za-z0-9_@.:-]{1,128}$/;
const CALLER_NUMBER_PATTERN = /^[0-9+\-\s]{5,32}$/;
const ACCESS_KEY_ID_PATTERN = /^[A-Za-z0-9]{8,128}$/;
const ACCESS_KEY_SECRET_PATTERN = /^[A-Za-z0-9+/=_-]{16,256}$/;
const CALLBACK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const CALL_WINDOW_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 允许拨打时段默认 09:00–20:00，含两端的这一分钟。 */
export const DEFAULT_CALL_WINDOW_START = "09:00";
export const DEFAULT_CALL_WINDOW_END = "20:00";
/** 同一号码每个当地日最多 3 次。 */
export const DEFAULT_MAX_CALLS_PER_NUMBER_PER_DAY = 3;
/** 两次允许拨打之间至少 30 分钟。 */
export const DEFAULT_MIN_INTERVAL_MINUTES = 30;

export interface OutboundCallingPolicy {
  callWindowStart: string;
  callWindowEnd: string;
  maxCallsPerNumberPerDay: number;
  minIntervalMinutes: number;
}

export function callWindowMinutes(value: string) {
  const match = CALL_WINDOW_PATTERN.exec(value);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function normalizeCallWindow(value: string | undefined, fallback: string) {
  const trimmed = (value || "").trim();
  const hhmm = trimmed.length > 5 ? trimmed.slice(0, 5) : trimmed;
  return CALL_WINDOW_PATTERN.test(hhmm) ? hhmm : fallback;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

/** 缺字段或坏值时用默认。开始不早于结束时，时段也回到默认，避免把全天打开。 */
export function outboundCallingPolicy(config: Partial<AliyunOutboundConfig> | undefined): OutboundCallingPolicy {
  const callWindowStart = normalizeCallWindow(config?.callWindowStart, DEFAULT_CALL_WINDOW_START);
  const callWindowEnd = normalizeCallWindow(config?.callWindowEnd, DEFAULT_CALL_WINDOW_END);
  const maxCallsPerNumberPerDay = boundedInteger(
    config?.maxCallsPerNumberPerDay,
    DEFAULT_MAX_CALLS_PER_NUMBER_PER_DAY,
    1,
    50
  );
  const minIntervalMinutes = boundedInteger(
    config?.minIntervalMinutes,
    DEFAULT_MIN_INTERVAL_MINUTES,
    0,
    1440
  );
  if (callWindowMinutes(callWindowStart) >= callWindowMinutes(callWindowEnd)) {
    return {
      callWindowStart: DEFAULT_CALL_WINDOW_START,
      callWindowEnd: DEFAULT_CALL_WINDOW_END,
      maxCallsPerNumberPerDay,
      minIntervalMinutes
    };
  }
  return { callWindowStart, callWindowEnd, maxCallsPerNumberPerDay, minIntervalMinutes };
}

export class AliyunOutboundConfigError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AliyunOutboundConfigError";
    this.status = status;
  }
}

export interface AliyunOutboundConfigStore {
  aliyunOutboundConfigs: AliyunOutboundConfig[];
  aliyunOutboundConfigAudits: AliyunOutboundConfigAudit[];
  persist(): Promise<void>;
}

type Actor = IamActor & { id: string };

export function maskAliyunOutboundSecret(value: string): AliyunOutboundSecretMask {
  if (!value) return { configured: false, last4: "" };
  if (value.length <= 4) return { configured: true, last4: "" };
  return { configured: true, last4: value.slice(-4) };
}

export function canManageAliyunOutboundConfig(user: IamActor | undefined) {
  if (!user?.teamId || user.teamId === "all") return false;
  return hasIamPermission(user, "system.settings.manage");
}

function assertCanManage(user: Actor | undefined): asserts user is Actor {
  if (!user?.id || !canManageAliyunOutboundConfig(user)) {
    throw new AliyunOutboundConfigError(403, "只有管理员可以读取或修改阿里云外呼配置");
  }
}

function assertSameTenant(user: Actor, requested: unknown) {
  if (requested === undefined || requested === null || requested === "") return;
  if (typeof requested !== "string" || requested !== user.teamId) {
    throw new AliyunOutboundConfigError(403, "不能读取或修改其他租户的阿里云外呼配置");
  }
}

function blankConfig(teamId: string): AliyunOutboundConfig {
  return {
    teamId,
    aliyunOutboundEnabled: false,
    instanceId: "",
    region: "",
    callerNumber: "",
    callWindowStart: DEFAULT_CALL_WINDOW_START,
    callWindowEnd: DEFAULT_CALL_WINDOW_END,
    maxCallsPerNumberPerDay: DEFAULT_MAX_CALLS_PER_NUMBER_PER_DAY,
    minIntervalMinutes: DEFAULT_MIN_INTERVAL_MINUTES,
    accessKeyIdEncrypted: "",
    accessKeySecretEncrypted: "",
    callbackPathTokenEncrypted: "",
    updatedBy: "",
    updatedAt: ""
  };
}

function reveal(teamId: string, field: AliyunOutboundSecretField, encrypted: string) {
  if (!encrypted) return "";
  try {
    return decryptAliyunOutboundSecret(teamId, field, encrypted);
  } catch {
    throw new AliyunOutboundConfigError(500, "阿里云外呼配置无法读取");
  }
}

function present(config: AliyunOutboundConfig): AliyunOutboundConfigView {
  const policy = outboundCallingPolicy(config);
  return {
    aliyunOutboundEnabled: config.aliyunOutboundEnabled === true,
    instanceId: config.instanceId,
    region: config.region,
    callerNumber: config.callerNumber,
    callWindowStart: policy.callWindowStart,
    callWindowEnd: policy.callWindowEnd,
    maxCallsPerNumberPerDay: policy.maxCallsPerNumberPerDay,
    minIntervalMinutes: policy.minIntervalMinutes,
    accessKeyId: maskAliyunOutboundSecret(reveal(config.teamId, "accessKeyId", config.accessKeyIdEncrypted)),
    accessKeySecret: maskAliyunOutboundSecret(reveal(config.teamId, "accessKeySecret", config.accessKeySecretEncrypted)),
    callbackPathToken: maskAliyunOutboundSecret(reveal(config.teamId, "callbackPathToken", config.callbackPathTokenEncrypted))
  };
}

function responseFor(user: Actor, config: AliyunOutboundConfig) {
  return {
    teamId: user.teamId,
    config: present(config),
    canManage: true,
    regions: [...ALIYUN_CCC_REGION_IDS]
  };
}

export function readAliyunOutboundConfig(store: AliyunOutboundConfigStore, user: Actor | undefined, requestedTeamId?: unknown) {
  assertCanManage(user);
  assertSameTenant(user, requestedTeamId);
  const current = store.aliyunOutboundConfigs.find((item) => item.teamId === user.teamId) || blankConfig(user.teamId);
  return responseFor(user, current);
}

function asRecord(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AliyunOutboundConfigError(400, "参数格式错误");
  }
  return body as Record<string, unknown>;
}

function optionalString(body: Record<string, unknown>, key: string, max: number) {
  if (!Object.prototype.hasOwnProperty.call(body, key) || body[key] === undefined) return undefined;
  if (typeof body[key] !== "string" || (body[key] as string).length > max) {
    throw new AliyunOutboundConfigError(400, "参数格式错误");
  }
  return body[key] as string;
}

function optionalBoolean(body: Record<string, unknown>, key: string) {
  if (!Object.prototype.hasOwnProperty.call(body, key) || body[key] === undefined) return undefined;
  if (typeof body[key] !== "boolean") throw new AliyunOutboundConfigError(400, "参数格式错误");
  return body[key] as boolean;
}

function optionalClock(body: Record<string, unknown>, key: string) {
  if (!Object.prototype.hasOwnProperty.call(body, key) || body[key] === undefined) return undefined;
  if (typeof body[key] !== "string") throw new AliyunOutboundConfigError(400, "允许拨打时段必须是 HH:MM");
  const trimmed = (body[key] as string).trim();
  const hhmm = trimmed.length > 5 ? trimmed.slice(0, 5) : trimmed;
  const restOk = trimmed.length === 5 || /^\d{2}:\d{2}:\d{2}$/.test(trimmed);
  if (!restOk || !CALL_WINDOW_PATTERN.test(hhmm)) {
    throw new AliyunOutboundConfigError(400, "允许拨打时段必须是 HH:MM");
  }
  return hhmm;
}

function optionalBoundedInteger(body: Record<string, unknown>, key: string, min: number, max: number, message: string) {
  if (!Object.prototype.hasOwnProperty.call(body, key) || body[key] === undefined) return undefined;
  const value = body[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new AliyunOutboundConfigError(400, message);
  }
  return value;
}

function normalizePlain(value: string | undefined) {
  return value === undefined ? undefined : value.trim();
}

function isAllowedRegion(region: string) {
  return (ALIYUN_CCC_REGION_IDS as readonly string[]).includes(region);
}

function assertRegion(region: string) {
  if (!region) return;
  if (!isAllowedRegion(region)) {
    throw new AliyunOutboundConfigError(400, "地域必须是 cn-shanghai 或 cn-hangzhou");
  }
}

function assertInstanceId(value: string) {
  if (value && !INSTANCE_ID_PATTERN.test(value)) throw new AliyunOutboundConfigError(400, "实例 ID 不正确");
}

function assertCallerNumber(value: string) {
  if (value && !CALLER_NUMBER_PATTERN.test(value)) throw new AliyunOutboundConfigError(400, "主叫号码不正确");
}

function assertSecretShape(value: string, pattern: RegExp, message: string) {
  if (value && !pattern.test(value)) throw new AliyunOutboundConfigError(400, message);
}

type SecretChange = "unchanged" | "configured" | "replaced" | "cleared";

function resolveSecret(input: {
  teamId: string;
  field: AliyunOutboundSecretField;
  currentEncrypted: string;
  provided: string | undefined;
  clear: boolean;
}): { encrypted: string; plaintext: string; previous: string; change: SecretChange } {
  const current = reveal(input.teamId, input.field, input.currentEncrypted);
  if (input.clear && input.provided) {
    throw new AliyunOutboundConfigError(400, "不能同时填写并清除密钥");
  }
  if (input.clear) {
    if (!current) return { encrypted: "", plaintext: "", previous: "", change: "unchanged" };
    return { encrypted: "", plaintext: "", previous: current, change: "cleared" };
  }
  if (input.provided === undefined || input.provided === "") {
    return { encrypted: input.currentEncrypted, plaintext: current, previous: current, change: "unchanged" };
  }
  if (input.provided === current) {
    return { encrypted: input.currentEncrypted, plaintext: current, previous: current, change: "unchanged" };
  }
  return {
    encrypted: encryptAliyunOutboundSecret(input.teamId, input.field, input.provided),
    plaintext: input.provided,
    previous: current,
    change: current ? "replaced" : "configured"
  };
}

function displayValue(value: string) {
  return value || "（空）";
}

function assertValueDoesNotContainSecrets(value: string, secrets: string[]) {
  if (!value) return;
  for (const secret of secrets) {
    if (secret && secret.length >= 8 && value.includes(secret)) {
      throw new AliyunOutboundConfigError(400, "实例、地域和主叫号码不能包含密钥");
    }
  }
}

const SECRET_AUDIT_LABEL: Record<SecretChange, string> = {
  unchanged: "",
  configured: "已配置",
  replaced: "已更换",
  cleared: "已清除"
};

export async function updateAliyunOutboundConfig(store: AliyunOutboundConfigStore, user: Actor | undefined, body: unknown) {
  assertCanManage(user);
  const record = asRecord(body);
  assertSameTenant(user, record.teamId);
  const enabled = optionalBoolean(record, "aliyunOutboundEnabled");
  const instanceId = normalizePlain(optionalString(record, "instanceId", 128));
  const region = normalizePlain(optionalString(record, "region", 64));
  const callerNumber = normalizePlain(optionalString(record, "callerNumber", 40));
  const accessKeyId = normalizePlain(optionalString(record, "accessKeyId", 128));
  const accessKeySecret = normalizePlain(optionalString(record, "accessKeySecret", 256));
  const callbackPathToken = normalizePlain(optionalString(record, "callbackPathToken", 128));
  const callWindowStart = optionalClock(record, "callWindowStart");
  const callWindowEnd = optionalClock(record, "callWindowEnd");
  const maxCallsPerNumberPerDay = optionalBoundedInteger(
    record,
    "maxCallsPerNumberPerDay",
    1,
    50,
    "同一号码每日上限必须是 1 到 50 的整数"
  );
  const minIntervalMinutes = optionalBoundedInteger(
    record,
    "minIntervalMinutes",
    0,
    1440,
    "两次拨打间隔必须是 0 到 1440 的整数"
  );
  const clearAccessKeyId = optionalBoolean(record, "clearAccessKeyId") === true;
  const clearAccessKeySecret = optionalBoolean(record, "clearAccessKeySecret") === true;
  const clearCallbackPathToken = optionalBoolean(record, "clearCallbackPathToken") === true;
  if (region !== undefined) assertRegion(region);
  if (instanceId !== undefined) assertInstanceId(instanceId);
  if (callerNumber !== undefined) assertCallerNumber(callerNumber);
  if (accessKeyId) assertSecretShape(accessKeyId, ACCESS_KEY_ID_PATTERN, "AccessKeyId 不正确");
  if (accessKeySecret) assertSecretShape(accessKeySecret, ACCESS_KEY_SECRET_PATTERN, "AccessKeySecret 不正确");
  if (callbackPathToken) assertSecretShape(callbackPathToken, CALLBACK_TOKEN_PATTERN, "回调路径令牌不正确");

  const current = store.aliyunOutboundConfigs.find((item) => item.teamId === user.teamId) || blankConfig(user.teamId);
  const currentPolicy = outboundCallingPolicy(current);
  const nextEnabled = enabled === undefined ? current.aliyunOutboundEnabled : enabled;
  const nextInstanceId = instanceId === undefined ? current.instanceId : instanceId;
  const nextRegion = region === undefined ? current.region : region;
  const nextCallerNumber = callerNumber === undefined ? current.callerNumber : callerNumber;
  const nextCallWindowStart = callWindowStart === undefined ? currentPolicy.callWindowStart : callWindowStart;
  const nextCallWindowEnd = callWindowEnd === undefined ? currentPolicy.callWindowEnd : callWindowEnd;
  const nextMaxCalls = maxCallsPerNumberPerDay === undefined ? currentPolicy.maxCallsPerNumberPerDay : maxCallsPerNumberPerDay;
  const nextMinInterval = minIntervalMinutes === undefined ? currentPolicy.minIntervalMinutes : minIntervalMinutes;
  if (callWindowMinutes(nextCallWindowStart) >= callWindowMinutes(nextCallWindowEnd)) {
    throw new AliyunOutboundConfigError(400, "允许拨打时段的开始必须早于结束");
  }
  const nextAccessKeyId = resolveSecret({
    teamId: user.teamId,
    field: "accessKeyId",
    currentEncrypted: current.accessKeyIdEncrypted,
    provided: accessKeyId,
    clear: clearAccessKeyId
  });
  const nextAccessKeySecret = resolveSecret({
    teamId: user.teamId,
    field: "accessKeySecret",
    currentEncrypted: current.accessKeySecretEncrypted,
    provided: accessKeySecret,
    clear: clearAccessKeySecret
  });
  const nextCallbackToken = resolveSecret({
    teamId: user.teamId,
    field: "callbackPathToken",
    currentEncrypted: current.callbackPathTokenEncrypted,
    provided: callbackPathToken,
    clear: clearCallbackPathToken
  });

  const secretPlaintexts = [
    nextAccessKeyId.plaintext,
    nextAccessKeySecret.plaintext,
    nextCallbackToken.plaintext,
    nextAccessKeyId.previous,
    nextAccessKeySecret.previous,
    nextCallbackToken.previous
  ];
  assertValueDoesNotContainSecrets(nextInstanceId, secretPlaintexts);
  assertValueDoesNotContainSecrets(nextRegion, secretPlaintexts);
  assertValueDoesNotContainSecrets(nextCallerNumber, secretPlaintexts);

  const parts: string[] = [];
  if (nextEnabled !== current.aliyunOutboundEnabled) {
    parts.push(`aliyunOutboundEnabled: ${current.aliyunOutboundEnabled ? "true" : "false"} → ${nextEnabled ? "true" : "false"}`);
  }
  if (nextInstanceId !== current.instanceId) parts.push(`instanceId: ${displayValue(current.instanceId)} → ${displayValue(nextInstanceId)}`);
  if (nextRegion !== current.region) parts.push(`region: ${displayValue(current.region)} → ${displayValue(nextRegion)}`);
  if (nextCallerNumber !== current.callerNumber) parts.push(`callerNumber: ${displayValue(current.callerNumber)} → ${displayValue(nextCallerNumber)}`);
  if (nextCallWindowStart !== currentPolicy.callWindowStart) {
    parts.push(`callWindowStart: ${currentPolicy.callWindowStart} → ${nextCallWindowStart}`);
  }
  if (nextCallWindowEnd !== currentPolicy.callWindowEnd) {
    parts.push(`callWindowEnd: ${currentPolicy.callWindowEnd} → ${nextCallWindowEnd}`);
  }
  if (nextMaxCalls !== currentPolicy.maxCallsPerNumberPerDay) {
    parts.push(`maxCallsPerNumberPerDay: ${currentPolicy.maxCallsPerNumberPerDay} → ${nextMaxCalls}`);
  }
  if (nextMinInterval !== currentPolicy.minIntervalMinutes) {
    parts.push(`minIntervalMinutes: ${currentPolicy.minIntervalMinutes} → ${nextMinInterval}`);
  }
  if (nextAccessKeyId.change !== "unchanged") parts.push(`accessKeyId: ${SECRET_AUDIT_LABEL[nextAccessKeyId.change]}`);
  if (nextAccessKeySecret.change !== "unchanged") parts.push(`accessKeySecret: ${SECRET_AUDIT_LABEL[nextAccessKeySecret.change]}`);
  if (nextCallbackToken.change !== "unchanged") parts.push(`callbackPathToken: ${SECRET_AUDIT_LABEL[nextCallbackToken.change]}`);
  if (!parts.length) return responseFor(user, current);

  const summary = parts.join("；");
  for (const secret of secretPlaintexts) {
    if (secret && summary.includes(secret)) throw new AliyunOutboundConfigError(400, "审计不能包含密钥");
  }

  const next: AliyunOutboundConfig = {
    teamId: user.teamId,
    aliyunOutboundEnabled: nextEnabled,
    instanceId: nextInstanceId,
    region: nextRegion,
    callerNumber: nextCallerNumber,
    callWindowStart: nextCallWindowStart,
    callWindowEnd: nextCallWindowEnd,
    maxCallsPerNumberPerDay: nextMaxCalls,
    minIntervalMinutes: nextMinInterval,
    accessKeyIdEncrypted: nextAccessKeyId.encrypted,
    accessKeySecretEncrypted: nextAccessKeySecret.encrypted,
    callbackPathTokenEncrypted: nextCallbackToken.encrypted,
    updatedBy: user.id,
    updatedAt: new Date().toISOString()
  };
  const audit: AliyunOutboundConfigAudit = {
    id: `aoc_${randomUUID()}`,
    teamId: user.teamId,
    actorId: user.id,
    at: next.updatedAt,
    action: "update_config",
    summary
  };
  const serializedAudit = JSON.stringify(audit);
  for (const secret of secretPlaintexts) {
    if (secret && serializedAudit.includes(secret)) throw new AliyunOutboundConfigError(400, "审计不能包含密钥");
  }
  const existing = store.aliyunOutboundConfigs.find((item) => item.teamId === user.teamId);
  if (existing) Object.assign(existing, next);
  else store.aliyunOutboundConfigs.push(next);
  store.aliyunOutboundConfigAudits.unshift(audit);
  await store.persist();
  return responseFor(user, next);
}
