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
  return {
    aliyunOutboundEnabled: config.aliyunOutboundEnabled === true,
    instanceId: config.instanceId,
    region: config.region,
    callerNumber: config.callerNumber,
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
  const nextEnabled = enabled === undefined ? current.aliyunOutboundEnabled : enabled;
  const nextInstanceId = instanceId === undefined ? current.instanceId : instanceId;
  const nextRegion = region === undefined ? current.region : region;
  const nextCallerNumber = callerNumber === undefined ? current.callerNumber : callerNumber;
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
