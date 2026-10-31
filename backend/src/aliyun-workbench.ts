/**
 * 坐席工作台嵌入。
 *
 * 按 2026-10-31 打开的官方 3.x 文档：
 * https://help.aliyun.com/zh/ccs/cccai/use-cases/ccc-sdk-frontend-access-3
 * SDK 把请求发到 ajaxPath，服务端转发 OpenAPI，再把 JSON 交回 SDK。
 * 浏览器不持有 AK/SK。OAuth2 地址和 scope、STS 临时凭证端点都待核实，所以这里不签发凭证。
 *
 * SDK 请求体里业务参数放在哪一层，该页只写了和 request 同一层级，待核实。
 * 默认 ajax 使用 axios 时，HTTP 正文应是 { code, data, httpStatusCode, requestId }。
 * 若运行时要的是 CCC 原始 Code/Data 包一层，改 toWorkbenchApiBody。
 */

import { hasIamPermission } from "./auth.js";
import { ALIYUN_CCC_REGION_IDS } from "./aliyun-outbound-config.js";
import { cccDirectoryFor } from "./aliyun-ccc-directory.js";
import { OUTBOUND_CALL_PERMISSION, dialWorkbenchCallee, previewWorkbenchCallee } from "./outbound-call.js";
import type { CrmStore } from "./store.js";
import type { SessionUser } from "./types.js";

export const CCC_WORKBENCH_VERSION = "3.8.1";
export const CCC_WORKBENCH_AJAX_PATH = "/api/aliyun-outbound/workbench/api";

/** 官方「服务端准备工作」里软电话要转发的接口。监听、拉黑、建坐席和预测式写入不在里面。 */
export const WORKBENCH_FORWARD_ACTIONS = [
  "GetLoginDetails",
  "GetUser",
  "ListSkillLevelsOfUser",
  "ListOutboundNumbersOfUser",
  "ListConfigItems",
  "GetTurnServerList",
  "ListPrivilegesOfUser",
  "GetTurnCredentials",
  "ListDevices",
  "PickOutboundNumbers",
  "GetNumberLocation",
  "ListRealtimeAgentStates",
  "ListAgentStates",
  "ResetAgentState",
  "ListRecentCallDetailRecords",
  "ListSkillGroups",
  "ListBriefSkillGroups",
  "ListHistoricalAgentReport",
  "SaveTerminalLog",
  "SignInGroup",
  "PollUserStatus",
  "LaunchAuthentication",
  "ChangeVisibility",
  "SignOutGroup",
  "ListFlashSmsApplications",
  "ListFlashSmsTemplates",
  "GetIvrTrackingSummary",
  "TakeBreak",
  "ReadyForService",
  "AnswerCall",
  "ReleaseCall",
  "HoldCall",
  "RetrieveCall",
  "BlindTransfer",
  "InitiateAttendedTransfer",
  "CompleteAttendedTransfer",
  "CancelAttendedTransfer",
  "SendDtmfSignaling",
  "MuteCall",
  "UnmuteCall",
  "LaunchSurvey",
  "ChangeWorkMode"
] as const;

const FORWARDABLE = new Set<string>(WORKBENCH_FORWARD_ACTIONS);
const SECRET_KEYS = new Set(["accesskeyid", "accesskeysecret", "accesskey", "securitytoken"]);

export interface WorkbenchResult {
  status: number;
  body: Record<string, unknown>;
}

function denied(status: number, message: string): WorkbenchResult {
  return { status, body: { code: "Forbidden", data: null, httpStatusCode: status, requestId: "", message } };
}

function mappingFor(store: CrmStore, user: SessionUser) {
  return store.aliyunAgentMappings.find((item) => item.teamId === user.teamId && item.crmUserId === user.id) || null;
}

function readyConfig(store: CrmStore, teamId: string) {
  const current = store.aliyunOutboundConfigs.find((item) => item.teamId === teamId);
  if (!current || current.aliyunOutboundEnabled !== true) return null;
  const instanceId = current.instanceId.trim();
  const region = current.region.trim();
  if (!instanceId || !(ALIYUN_CCC_REGION_IDS as readonly string[]).includes(region)) return null;
  return { instanceId, region };
}

export function readWorkbenchSession(store: CrmStore, user: SessionUser | undefined): WorkbenchResult {
  if (!user?.id || !user.teamId) return { status: 401, body: { load: false, message: "未登录" } };
  const enabled = store.aliyunOutboundConfigs.find((item) => item.teamId === user.teamId)?.aliyunOutboundEnabled === true;
  const permitted = hasIamPermission(user, OUTBOUND_CALL_PERMISSION);
  const mapping = mappingFor(store, user);
  const ready = readyConfig(store, user.teamId);
  const load = Boolean(enabled && permitted && mapping && ready);
  const body: Record<string, unknown> = {
    load,
    enabled,
    permitted,
    mapped: Boolean(mapping),
    ajaxPath: CCC_WORKBENCH_AJAX_PATH,
    domId: "ccc-workbench-container",
    workbenchVersion: CCC_WORKBENCH_VERSION,
    pendingVerification: [
      "OAuth2 授权地址和 scope 待核实",
      "STS 临时凭证签发端点待核实。本接口不下发 AccessKey。"
    ]
  };
  if (load && ready) {
    body.instanceId = ready.instanceId;
    body.regionId = ready.region;
  }
  return { status: 200, body };
}

function queryText(query: Record<string, unknown>, key: string) {
  const value = query[key];
  return typeof value === "string" ? value.trim() : "";
}

/** 查询串按官方路径：action、product、version、region。正文参数位置待核实。 */
export function readWorkbenchRequest(query: Record<string, unknown>, body: unknown) {
  const action = queryText(query, "action") || queryText(query, "Action");
  const product = queryText(query, "product");
  const version = queryText(query, "version");
  const region = queryText(query, "region");
  return { action, product, version, region, params: readWorkbenchParams(body) };
}

export function readWorkbenchParams(body: unknown) {
  const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  let source: Record<string, unknown> = record;
  if (typeof record.request === "string") {
    try {
      const parsed = JSON.parse(record.request) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) source = parsed as Record<string, unknown>;
    } catch {
      source = record;
    }
  } else if (record.request && typeof record.request === "object" && !Array.isArray(record.request)) {
    source = record.request as Record<string, unknown>;
  }
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "request" || SECRET_KEYS.has(key.toLowerCase())) continue;
    if (typeof value === "string") params[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) params[key] = value;
  }
  return params;
}

export function stripSecretFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecretFields);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.has(key.toLowerCase())) continue;
    output[key] = stripSecretFields(item);
  }
  return output;
}

/** axios 会再包一层 data。HTTP 正文用文档里的 code/data/httpStatusCode/requestId。 */
export function toWorkbenchApiBody(payload: unknown) {
  const stripped = stripSecretFields(payload);
  const record = stripped && typeof stripped === "object" && !Array.isArray(stripped)
    ? stripped as Record<string, unknown>
    : {};
  const data = record.Data !== undefined ? record.Data : record.data !== undefined ? record.data : record;
  return {
    code: typeof record.Code === "string" ? record.Code : typeof record.code === "string" ? record.code : "OK",
    data: stripSecretFields(data),
    httpStatusCode: typeof record.HttpStatusCode === "number" ? record.HttpStatusCode : 200,
    requestId: typeof record.RequestId === "string" ? record.RequestId : ""
  };
}

function calleeFrom(params: Record<string, string | number>) {
  const value = params.Callee ?? params.callee;
  return typeof value === "string" ? value : "";
}

export async function handleWorkbenchApi(
  store: CrmStore,
  user: SessionUser | undefined,
  query: Record<string, unknown>,
  body: unknown
): Promise<WorkbenchResult> {
  if (!user?.id || !user.teamId) return denied(401, "未登录");
  if (!hasIamPermission(user, OUTBOUND_CALL_PERMISSION)) return denied(403, "没有外呼权限");
  const mapping = mappingFor(store, user);
  if (!mapping) return denied(403, "当前用户没有对应的云联络中心坐席");
  const ready = readyConfig(store, user.teamId);
  if (!ready) return denied(403, "外呼功能未开启");
  const request = readWorkbenchRequest(query, body);
  if (request.product !== "CloudCallCenter" || request.version !== "2020-07-01") {
    return denied(400, "工作台请求的产品或版本不正确");
  }
  if (request.region !== ready.region) return denied(403, "工作台地域和本租户配置不一致");
  if (request.action === "MakeCall") {
    const outcome = await dialWorkbenchCallee(store, user, calleeFrom(request.params));
    if (outcome.body.result !== "allowed") {
      return {
        status: outcome.status,
        body: {
          code: "Forbidden",
          data: null,
          httpStatusCode: outcome.status,
          requestId: "",
          message: String(outcome.body.message || "外呼没有发出")
        }
      };
    }
    return {
      status: 200,
      body: toWorkbenchApiBody({
        Code: "OK",
        HttpStatusCode: 200,
        RequestId: "",
        Data: { CallContext: { JobId: outcome.body.jobId, CallType: "OUTBOUND" } }
      })
    };
  }
  if (!FORWARDABLE.has(request.action)) return denied(403, "这个工作台接口未开放");
  const params: Record<string, string | number> = { ...request.params, InstanceId: ready.instanceId };
  if ("UserId" in request.params || "userId" in request.params) params.UserId = mapping.cccUserId;
  delete params.userId;
  try {
    const payload = await cccDirectoryFor(ready.region).invoke(request.action, params);
    return { status: 200, body: toWorkbenchApiBody(payload) };
  } catch {
    return denied(502, "云联络中心没有返回");
  }
}

export async function previewWorkbenchDial(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const outcome = await previewWorkbenchCallee(store, user, record.callee);
  return outcome;
}
