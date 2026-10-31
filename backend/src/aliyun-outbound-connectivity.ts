/**
 * 管理员手动发起的云联络中心连通性自检。
 *
 * 只使用已经加密保存的配置。只允许 ListUsers 这一只只读查询。
 * 默认传输不访问网络；测试注入 mock。不拨号，不改功能开关。
 */

import { randomUUID } from "node:crypto";
import type { IamActor } from "./auth.js";
import { canManageAliyunOutboundConfig, ALIYUN_CCC_REGION_IDS } from "./aliyun-outbound-config.js";
import { CCC_MAKE_CALL_VERSION, cccPublicEndpoint, type CccRpcRequest } from "./aliyun-ccc-make-call.js";
import { decryptAliyunOutboundSecret } from "./credential-security.js";
import type { AliyunAgentMapping, AliyunOutboundConfig, AliyunOutboundConnectivityAudit } from "./types.js";

type Actor = IamActor & { id: string };

/** 连通性自检允许调用的 CCC 动作。除此之外一律在进入传输之前拒绝。 */
export const CONNECTIVITY_READONLY_ACTIONS = ["ListUsers"] as const;

export const CONNECTIVITY_CHECK_LIMIT = 5;
export const CONNECTIVITY_CHECK_WINDOW_MS = 10 * 60 * 1000;

const INSTANCE_ID_PATTERN = /^[A-Za-z0-9_@.:-]{1,128}$/;
const CALLER_NUMBER_PATTERN = /^[0-9+\-\s]{5,32}$/;
const LIST_USERS_PARAM_KEYS = new Set(["InstanceId", "PageNumber", "PageSize"]);

/**
 * 公共 OpenAPI 客户端错误码。CCC ListUsers 是否原样返回它们，见方案第 9 节，待核实。
 * 只认这几个码。响应 Message 不读取、不回显。
 */
const CREDENTIAL_CODES = new Set([
  "InvalidAccessKeyId.NotFound",
  "InvalidAccessKeyId.Inactive",
  "SignatureDoesNotMatch"
]);

export type ConnectivityItemId = "config_complete" | "credentials" | "instance" | "agent_mapping" | "callback";

export interface ConnectivityItem {
  id: ConnectivityItemId;
  ok: boolean;
  detail: string;
}

export interface ConnectivityCheckStore {
  aliyunOutboundConfigs: AliyunOutboundConfig[];
  aliyunAgentMappings: AliyunAgentMapping[];
  aliyunOutboundConnectivityAudits: AliyunOutboundConnectivityAudit[];
  persist(): Promise<void>;
}

export type ConnectivityTransport = (request: CccRpcRequest) => Promise<unknown>;

export class ConnectivityReadonlyDeniedError extends Error {
  constructor() {
    super("连通性自检只允许只读查询");
    this.name = "ConnectivityReadonlyDeniedError";
  }
}

export interface ConnectivityCheckResult {
  status: number;
  body: Record<string, unknown>;
}

let transportOverride: ConnectivityTransport | undefined;
let nowOverride: (() => number) | undefined;

export function setConnectivityTransportForTests(transport: ConnectivityTransport | undefined) {
  transportOverride = transport;
}

export function setConnectivityClockForTests(clock: (() => number) | undefined) {
  nowOverride = clock;
}

function nowMs() {
  return nowOverride ? nowOverride() : Date.now();
}

export function assertConnectivityReadonlyAction(action: string): asserts action is "ListUsers" {
  if (!(CONNECTIVITY_READONLY_ACTIONS as readonly string[]).includes(action)) {
    throw new ConnectivityReadonlyDeniedError();
  }
}

/** 白名单通过之后才把请求交给传输。拨号和写入动作到不了 transport。 */
export async function invokeConnectivityReadonly(
  action: string,
  region: string,
  params: Record<string, string | number>,
  transport: ConnectivityTransport
) {
  assertConnectivityReadonlyAction(action);
  for (const key of Object.keys(params)) {
    if (!LIST_USERS_PARAM_KEYS.has(key)) throw new ConnectivityReadonlyDeniedError();
  }
  const host = cccPublicEndpoint(region);
  if (!host) throw new ConnectivityReadonlyDeniedError();
  const request: CccRpcRequest = {
    action,
    version: CCC_MAKE_CALL_VERSION,
    host,
    params: {
      InstanceId: String(params.InstanceId || ""),
      PageNumber: Number(params.PageNumber),
      PageSize: Number(params.PageSize)
    }
  };
  if (request.action !== "ListUsers") throw new ConnectivityReadonlyDeniedError();
  return transport(request);
}

const defaultTransport: ConnectivityTransport = async () => {
  throw new Error(TRANSPORT_UNWIRED);
};

function activeTransport() {
  return transportOverride || defaultTransport;
}

function denied(status: number, message: string): ConnectivityCheckResult {
  return { status, body: { message } };
}

function secretText(teamId: string, field: "accessKeyId" | "accessKeySecret" | "callbackPathToken", encrypted: string) {
  if (!encrypted) return "";
  try {
    return decryptAliyunOutboundSecret(teamId, field, encrypted);
  } catch {
    return null;
  }
}

function configIsComplete(config: AliyunOutboundConfig, accessKeyId: string | null, accessKeySecret: string | null) {
  if (accessKeyId === null || accessKeySecret === null) return false;
  return Boolean(
    INSTANCE_ID_PATTERN.test(config.instanceId.trim())
    && (ALIYUN_CCC_REGION_IDS as readonly string[]).includes(config.region.trim())
    && CALLER_NUMBER_PATTERN.test(config.callerNumber.trim())
    && accessKeyId
    && accessKeySecret
  );
}

type ProbeOutcome = "skipped" | "ok" | "credentials" | "rejected" | "unwired";

const TRANSPORT_UNWIRED = "云联络中心传输未注入";

function classifyProbeBody(body: unknown): ProbeOutcome {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "rejected";
  const code = typeof (body as { Code?: unknown }).Code === "string" ? (body as { Code: string }).Code : "";
  if (CREDENTIAL_CODES.has(code)) return "credentials";
  if (code && code !== "OK") return "rejected";
  const httpStatus = (body as { HttpStatusCode?: unknown }).HttpStatusCode;
  if (typeof httpStatus === "number" && httpStatus !== 200) return "rejected";
  return "ok";
}

function item(id: ConnectivityItemId, ok: boolean, detail: string): ConnectivityItem {
  return { id, ok, detail };
}

function containsSecret(value: string, secrets: string[]) {
  return secrets.some((secret) => secret.length >= 8 && value.includes(secret));
}

function recentAttempts(store: ConnectivityCheckStore, teamId: string, now: number) {
  return store.aliyunOutboundConnectivityAudits.filter((entry) => {
    if (entry.teamId !== teamId) return false;
    const at = Date.parse(entry.at);
    return Number.isFinite(at) && now - at < CONNECTIVITY_CHECK_WINDOW_MS;
  }).length;
}

async function writeAudit(
  store: ConnectivityCheckStore,
  input: { teamId: string; actorId: string; at: string; result: AliyunOutboundConnectivityAudit["result"]; summary: string },
  secrets: string[]
) {
  if (containsSecret(input.summary, secrets)) {
    return denied(500, "自检结果不能包含密钥");
  }
  store.aliyunOutboundConnectivityAudits.unshift({
    id: `aocc_${randomUUID()}`,
    teamId: input.teamId,
    actorId: input.actorId,
    at: input.at,
    result: input.result,
    summary: input.summary
  });
  await store.persist();
  return null;
}

function summaryFor(result: "completed" | "rate_limited", items?: ConnectivityItem[]) {
  if (result === "rate_limited" || !items) return "result=rate_limited";
  const flags = items.map((entry) => `${entry.id}=${entry.ok ? "1" : "0"}`).join(";");
  return `result=completed;${flags}`;
}

export async function runAliyunOutboundConnectivityCheck(
  store: ConnectivityCheckStore,
  user: Actor | undefined,
  body: unknown
): Promise<ConnectivityCheckResult> {
  if (!user?.id || !user.teamId || !canManageAliyunOutboundConfig(user)) {
    return denied(403, "只有管理员可以做连通性自检");
  }
  let requested: unknown;
  if (body === undefined || body === null || body === "") requested = undefined;
  else if (typeof body !== "object" || Array.isArray(body)) return denied(400, "参数格式错误");
  else requested = (body as { teamId?: unknown }).teamId;
  if (requested !== undefined && requested !== null && requested !== "" && requested !== user.teamId) {
    return denied(403, "不能检查其他租户的阿里云外呼配置");
  }

  const now = nowMs();
  if (recentAttempts(store, user.teamId, now) >= CONNECTIVITY_CHECK_LIMIT) {
    const blocked = await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      at: new Date(now).toISOString(),
      result: "rate_limited",
      summary: summaryFor("rate_limited")
    }, []);
    if (blocked) return blocked;
    return denied(429, "连通性自检过于频繁，请稍后再试");
  }

  const current = store.aliyunOutboundConfigs.find((entry) => entry.teamId === user.teamId);
  const enabled = current?.aliyunOutboundEnabled === true;
  const accessKeyId = current ? secretText(user.teamId, "accessKeyId", current.accessKeyIdEncrypted) : "";
  const accessKeySecret = current ? secretText(user.teamId, "accessKeySecret", current.accessKeySecretEncrypted) : "";
  const callbackToken = current ? secretText(user.teamId, "callbackPathToken", current.callbackPathTokenEncrypted) : "";
  const secrets = [accessKeyId, accessKeySecret, callbackToken].filter((value): value is string => Boolean(value));
  const secretsReadable = accessKeyId !== null && accessKeySecret !== null;
  const complete = Boolean(current && secretsReadable && configIsComplete(current, accessKeyId, accessKeySecret));
  const mapped = store.aliyunAgentMappings.some((entry) => entry.teamId === user.teamId && entry.cccUserId.trim() && entry.crmUserId.trim());
  const callbackReady = typeof callbackToken === "string" && callbackToken.length > 0;

  let probe: ProbeOutcome = "skipped";
  if (complete && current && accessKeyId && accessKeySecret) {
    try {
      const response = await invokeConnectivityReadonly("ListUsers", current.region.trim(), {
        InstanceId: current.instanceId.trim(),
        PageNumber: 1,
        PageSize: 1
      }, activeTransport());
      probe = classifyProbeBody(response);
    } catch (error) {
      probe = error instanceof Error && error.message === TRANSPORT_UNWIRED ? "unwired" : "rejected";
    }
  }

  const items: ConnectivityItem[] = [
    item(
      "config_complete",
      complete,
      complete ? "实例、地域、主叫号码和访问密钥都已保存" : secretsReadable ? "还缺实例、地域、主叫号码或访问密钥" : "配置无法读取，未发起查询"
    ),
    item(
      "credentials",
      probe === "ok",
      probe === "ok"
        ? "只读查询已通过"
        : probe === "credentials"
          ? "访问凭证不可用"
          : probe === "unwired"
            ? "只读查询没有接通"
            : probe === "skipped"
              ? "配置不完整，未发起查询"
              : "只读查询没有成功"
    ),
    item(
      "instance",
      probe === "ok",
      probe === "ok"
        ? "实例已接受只读查询"
        : probe === "credentials"
          ? "凭证未通过，尚未确认实例"
          : probe === "unwired"
            ? "只读查询没有接通"
            : probe === "skipped"
              ? "配置不完整，未发起查询"
              : "实例没有接受只读查询"
    ),
    item(
      "agent_mapping",
      mapped,
      mapped ? "本租户已保存坐席映射" : "尚未保存坐席映射"
    ),
    item(
      "callback",
      callbackReady,
      callbackReady ? "回调路径令牌已保存" : callbackToken === null ? "配置无法读取" : "未保存回调路径令牌"
    )
  ];

  const responseBody = { aliyunOutboundEnabled: enabled, items };
  const serialized = JSON.stringify(responseBody);
  if (containsSecret(serialized, secrets)) return denied(500, "自检结果不能包含密钥");
  const failedAudit = await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    at: new Date(now).toISOString(),
    result: "completed",
    summary: summaryFor("completed", items)
  }, secrets);
  if (failedAudit) return failedAudit;
  return { status: 200, body: responseBody };
}
