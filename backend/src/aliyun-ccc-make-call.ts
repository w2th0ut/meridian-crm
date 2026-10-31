/**
 * CCC 2020-07-01 MakeCall 的参数封装。
 *
 * 只组官方业务参数和已列出的公网接入点。不从实例 ID 拼域名，也不在这里发网络请求。
 * 传输由调用方注入。测试和默认服务端路径都不把传输接到阿里云。
 *
 * 必填：InstanceId、DeviceId、Callee。
 * DeviceId 官方写明无意义，可以填写固定值。
 * UserId、Caller、TimeoutSeconds、MaskedCallee、MediaType、Tags、FlashSmsVariables 为可选。
 * 成功时读 Data.CallContext.JobId；CallType 若出现则应为 OUTBOUND。
 */

export const CCC_MAKE_CALL_ACTION = "MakeCall" as const;
export const CCC_MAKE_CALL_VERSION = "2020-07-01" as const;
export const CCC_MAKE_CALL_DEVICE_ID = "keduoduo-crm";

const PUBLIC_ENDPOINTS: Record<string, string> = {
  "cn-shanghai": "ccc.cn-shanghai.aliyuncs.com",
  "cn-hangzhou": "ccc.cn-hangzhou.aliyuncs.com"
};

export interface MakeCallParams {
  InstanceId: string;
  DeviceId: string;
  Callee: string;
  Caller?: string;
  UserId?: string;
  TimeoutSeconds?: number;
  MaskedCallee?: string;
  MediaType?: "AUDIO" | "VIDEO";
  Tags?: string;
  FlashSmsVariables?: string;
}

export interface CccMakeCallRequest {
  action: typeof CCC_MAKE_CALL_ACTION;
  version: typeof CCC_MAKE_CALL_VERSION;
  host: string;
  params: MakeCallParams;
}

export interface MakeCallResult {
  jobId: string;
  callType: "OUTBOUND";
}

export interface OutboundDialer {
  makeCall(params: MakeCallParams): Promise<MakeCallResult>;
}

export function cccPublicEndpoint(region: string) {
  return PUBLIC_ENDPOINTS[region] || "";
}

function requiredText(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`MakeCall 缺少 ${name}`);
  }
  return value.trim();
}

export function normalizeMakeCallParams(input: MakeCallParams): MakeCallParams {
  const params: MakeCallParams = {
    InstanceId: requiredText(input.InstanceId, "InstanceId"),
    DeviceId: requiredText(input.DeviceId, "DeviceId"),
    Callee: requiredText(input.Callee, "Callee")
  };
  if (input.Caller !== undefined) params.Caller = requiredText(input.Caller, "Caller");
  if (input.UserId !== undefined) params.UserId = requiredText(input.UserId, "UserId");
  if (input.TimeoutSeconds !== undefined) {
    if (!Number.isInteger(input.TimeoutSeconds) || input.TimeoutSeconds < 30 || input.TimeoutSeconds > 300) {
      throw new Error("MakeCall TimeoutSeconds 必须是 30 到 300 的整数");
    }
    params.TimeoutSeconds = input.TimeoutSeconds;
  }
  if (input.MaskedCallee !== undefined) params.MaskedCallee = requiredText(input.MaskedCallee, "MaskedCallee");
  if (input.MediaType !== undefined) {
    if (input.MediaType !== "AUDIO" && input.MediaType !== "VIDEO") {
      throw new Error("MakeCall MediaType 只能是 AUDIO 或 VIDEO");
    }
    params.MediaType = input.MediaType;
  }
  if (input.Tags !== undefined) params.Tags = String(input.Tags);
  if (input.FlashSmsVariables !== undefined) params.FlashSmsVariables = String(input.FlashSmsVariables);
  return params;
}

export function readMakeCallResult(body: unknown): MakeCallResult {
  if (!body || typeof body !== "object") throw new Error("MakeCall 响应无效");
  const context = (body as { Data?: { CallContext?: { JobId?: unknown; CallType?: unknown } } }).Data?.CallContext;
  const jobId = typeof context?.JobId === "string" ? context.JobId.trim() : "";
  if (!jobId) throw new Error("MakeCall 响应没有 JobId");
  if (context?.CallType !== undefined && context.CallType !== "OUTBOUND") {
    throw new Error("MakeCall 响应不是外呼");
  }
  return { jobId, callType: "OUTBOUND" };
}

/** 按地域选择官方公网接入点，把参数交给注入的传输。传输未注入时调用方不应创建这个拨号器。 */
export function createAliyunCccMakeCallDialer(options: {
  region: string;
  transport: (request: CccMakeCallRequest) => Promise<unknown>;
}): OutboundDialer {
  const host = cccPublicEndpoint(options.region);
  if (!host) throw new Error("地域不在云联络中心已列出的接入点中");
  return {
    async makeCall(input) {
      const params = normalizeMakeCallParams(input);
      const body = await options.transport({
        action: CCC_MAKE_CALL_ACTION,
        version: CCC_MAKE_CALL_VERSION,
        host,
        params
      });
      return readMakeCallResult(body);
    }
  };
}
