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

export const CCC_GET_CALL_DETAIL_RECORD_ACTION = "GetCallDetailRecord" as const;
export const CCC_GET_MONO_RECORDING_ACTION = "GetMonoRecording" as const;
/**
 * GetMonoRecording 的 ExpireSeconds 示例是 300。
 * 同一页又写 FileUrl 有效期为 1 天。两者关系待核实。这里按示例请求短期签名，不把链接当永久地址。
 */
export const CCC_MONO_RECORDING_EXPIRE_SECONDS = 300;

export interface GetCallDetailRecordParams {
  InstanceId: string;
  ContactId: string;
}

/**
 * 话单里和跟进相关的字段。时长、时间保留原文。
 * GetCallDetailRecord 把 CallDuration 写成整数秒，列表接口的口径不一致，待核实，这里不折算。
 * StartTime 该页写「呼出从接通开始计算」，事件 CDRReady 写「呼出从拨号开始」，起算点待核实。
 */
export interface CallDetailRecord {
  contactId: string;
  instanceId: string;
  contactType: string;
  contactDisposition: string;
  earlyMediaState: string;
  callDurationRaw: string;
  establishedTimeRaw: string;
  releaseTimeRaw: string;
  startTimeRaw: string;
  callingNumber: string;
  calledNumber: string;
  agentIds: string;
  skillGroupIds: string;
  recordingReady: boolean | null;
  releaseInitiator: string;
  releaseReason: string;
}

export interface GetMonoRecordingParams {
  InstanceId: string;
  ContactId: string;
  ExpireSeconds?: number;
}

/**
 * Duration 该页写毫秒。事件 RecordingReady.duration 写秒。单位待核实，单独保留原文，不写进 CallDuration。
 */
export interface MonoRecording {
  fileUrl: string;
  fileName: string;
  durationRaw: string;
}

export interface CccRpcRequest {
  action: string;
  version: typeof CCC_MAKE_CALL_VERSION;
  host: string;
  params: Record<string, string | number>;
}

export interface OutboundDialer {
  makeCall(params: MakeCallParams): Promise<MakeCallResult>;
  getCallDetailRecord?(params: GetCallDetailRecordParams): Promise<CallDetailRecord>;
  getMonoRecording?(params: GetMonoRecordingParams): Promise<MonoRecording>;
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

function rpcText(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`缺少 ${name}`);
  return value.trim();
}

function rawScalar(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value.trim();
  return "";
}

function readData(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("云联络中心响应无效");
  const record = body as Record<string, unknown>;
  if (typeof record.Code === "string" && record.Code && record.Code !== "OK") {
    throw new Error("云联络中心响应未成功");
  }
  if (typeof record.HttpStatusCode === "number" && record.HttpStatusCode !== 200) {
    throw new Error("云联络中心响应未成功");
  }
  const data = record.Data;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("云联络中心响应没有数据");
  return data as Record<string, unknown>;
}

/** 按 GetCallDetailRecord 的返回解析。缺 InstanceId 时不拒绝：该字段是否总是出现，待核实。 */
export function readCallDetailRecord(
  body: unknown,
  expected: { instanceId: string; contactId: string }
): CallDetailRecord {
  const data = readData(body);
  const contactId = typeof data.ContactId === "string" ? data.ContactId.trim() : "";
  if (!contactId || contactId !== expected.contactId) throw new Error("话单和 ContactId 不一致");
  const instanceId = typeof data.InstanceId === "string" ? data.InstanceId.trim() : "";
  if (instanceId && instanceId !== expected.instanceId) throw new Error("话单和实例不一致");
  return {
    contactId,
    instanceId,
    contactType: rawScalar(data.ContactType),
    contactDisposition: rawScalar(data.ContactDisposition),
    earlyMediaState: rawScalar(data.EarlyMediaState),
    callDurationRaw: rawScalar(data.CallDuration),
    establishedTimeRaw: rawScalar(data.EstablishedTime),
    releaseTimeRaw: rawScalar(data.ReleaseTime),
    startTimeRaw: rawScalar(data.StartTime),
    callingNumber: rawScalar(data.CallingNumber),
    calledNumber: rawScalar(data.CalledNumber),
    agentIds: rawScalar(data.AgentIds),
    skillGroupIds: rawScalar(data.SkillGroupIds),
    recordingReady: typeof data.RecordingReady === "boolean" ? data.RecordingReady : null,
    releaseInitiator: rawScalar(data.ReleaseInitiator),
    releaseReason: rawScalar(data.ReleaseReason)
  };
}

export function readMonoRecording(body: unknown): MonoRecording {
  const data = readData(body);
  const fileUrl = rawScalar(data.FileUrl);
  if (!fileUrl) throw new Error("录音响应没有 FileUrl");
  return {
    fileUrl,
    fileName: rawScalar(data.FileName),
    durationRaw: rawScalar(data.Duration)
  };
}

/** 按地域选择官方公网接入点，把参数交给注入的传输。传输未注入时调用方不应创建这个拨号器。 */
export function createAliyunCccMakeCallDialer(options: {
  region: string;
  transport: (request: CccMakeCallRequest | CccRpcRequest) => Promise<unknown>;
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
    },
    async getCallDetailRecord(input) {
      const instanceId = rpcText(input.InstanceId, "InstanceId");
      const contactId = rpcText(input.ContactId, "ContactId");
      const body = await options.transport({
        action: CCC_GET_CALL_DETAIL_RECORD_ACTION,
        version: CCC_MAKE_CALL_VERSION,
        host,
        params: { InstanceId: instanceId, ContactId: contactId }
      });
      return readCallDetailRecord(body, { instanceId, contactId });
    },
    async getMonoRecording(input) {
      const instanceId = rpcText(input.InstanceId, "InstanceId");
      const contactId = rpcText(input.ContactId, "ContactId");
      const params: Record<string, string | number> = { InstanceId: instanceId, ContactId: contactId };
      if (input.ExpireSeconds !== undefined) {
        if (!Number.isInteger(input.ExpireSeconds) || input.ExpireSeconds < 1 || input.ExpireSeconds > 86400) {
          throw new Error("GetMonoRecording ExpireSeconds 无效");
        }
        params.ExpireSeconds = input.ExpireSeconds;
      }
      const body = await options.transport({
        action: CCC_GET_MONO_RECORDING_ACTION,
        version: CCC_MAKE_CALL_VERSION,
        host,
        params
      });
      return readMonoRecording(body);
    }
  };
}
