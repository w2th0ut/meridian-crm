/** 与后端白名单一致：CCC 2020-07-01 已列出的地域。 */
export const ALIYUN_CCC_REGION_IDS = ["cn-shanghai", "cn-hangzhou"] as const;

export interface AliyunOutboundSecretMask {
  configured: boolean;
  last4: string;
}

export interface AliyunOutboundConfigView {
  aliyunOutboundEnabled: boolean;
  instanceId: string;
  region: string;
  callerNumber: string;
  callWindowStart: string;
  callWindowEnd: string;
  maxCallsPerNumberPerDay: number;
  minIntervalMinutes: number;
  accessKeyId: AliyunOutboundSecretMask;
  accessKeySecret: AliyunOutboundSecretMask;
  callbackPathToken: AliyunOutboundSecretMask;
}

export interface AliyunOutboundConfigResponse {
  config: AliyunOutboundConfigView;
  canManage: boolean;
  regions: string[];
  teamId?: string;
}

export interface AliyunOutboundConfigDraft {
  aliyunOutboundEnabled: boolean;
  instanceId: string;
  region: string;
  callerNumber: string;
  accessKeyId: string;
  accessKeySecret: string;
  callbackPathToken: string;
  callWindowStart?: string;
  callWindowEnd?: string;
  maxCallsPerNumberPerDay?: number;
  minIntervalMinutes?: number;
}

const CALL_WINDOW_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function clockField(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return { ok: false as const, message: "允许拨打时段必须是 HH:MM" };
  const hhmm = trimmed.length > 5 ? trimmed.slice(0, 5) : trimmed;
  const restOk = trimmed.length === 5 || /^\d{2}:\d{2}:\d{2}$/.test(trimmed);
  if (!restOk || !CALL_WINDOW_PATTERN.test(hhmm)) {
    return { ok: false as const, message: "允许拨打时段必须是 HH:MM" };
  }
  return { ok: true as const, value: hhmm };
}

function boundedIntegerField(value: number | undefined, min: number, max: number, message: string) {
  if (value === undefined) return { ok: false as const, message };
  if (!Number.isInteger(value) || value < min || value > max) return { ok: false as const, message };
  return { ok: true as const, value };
}

export function showAliyunOutboundSettings(canManage: boolean) {
  return canManage === true;
}

export function secretStatusText(mask: AliyunOutboundSecretMask) {
  if (!mask?.configured) return "未配置";
  if (!mask.last4) return "已配置";
  return `已配置，末 4 位 ${mask.last4}`;
}

export function buildAliyunOutboundConfigBody(draft: AliyunOutboundConfigDraft):
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; message: string } {
  const region = draft.region.trim();
  if (region && !(ALIYUN_CCC_REGION_IDS as readonly string[]).includes(region)) {
    return { ok: false, message: "地域必须是 cn-shanghai 或 cn-hangzhou" };
  }
  const accessKeyId = draft.accessKeyId.trim();
  const accessKeySecret = draft.accessKeySecret.trim();
  const callbackPathToken = draft.callbackPathToken.trim();
  if (accessKeyId && !/^[A-Za-z0-9]{8,128}$/.test(accessKeyId)) {
    return { ok: false, message: "AccessKeyId 不正确" };
  }
  if (accessKeySecret && !/^[A-Za-z0-9+/=_-]{16,256}$/.test(accessKeySecret)) {
    return { ok: false, message: "AccessKeySecret 不正确" };
  }
  if (callbackPathToken && !/^[A-Za-z0-9_-]{16,128}$/.test(callbackPathToken)) {
    return { ok: false, message: "回调路径令牌不正确" };
  }
  const body: Record<string, unknown> = {
    aliyunOutboundEnabled: draft.aliyunOutboundEnabled === true,
    instanceId: draft.instanceId.trim(),
    region,
    callerNumber: draft.callerNumber.trim()
  };
  const windowTouched = draft.callWindowStart !== undefined
    || draft.callWindowEnd !== undefined
    || draft.maxCallsPerNumberPerDay !== undefined
    || draft.minIntervalMinutes !== undefined;
  if (windowTouched) {
    const start = clockField(draft.callWindowStart);
    if (!start.ok) return start;
    const end = clockField(draft.callWindowEnd);
    if (!end.ok) return end;
    const startMinutes = Number(start.value.slice(0, 2)) * 60 + Number(start.value.slice(3));
    const endMinutes = Number(end.value.slice(0, 2)) * 60 + Number(end.value.slice(3));
    if (startMinutes >= endMinutes) return { ok: false, message: "允许拨打时段的开始必须早于结束" };
    const maxCalls = boundedIntegerField(draft.maxCallsPerNumberPerDay, 1, 50, "同一号码每日上限必须是 1 到 50 的整数");
    if (!maxCalls.ok) return maxCalls;
    const minInterval = boundedIntegerField(draft.minIntervalMinutes, 0, 1440, "两次拨打间隔必须是 0 到 1440 的整数");
    if (!minInterval.ok) return minInterval;
    body.callWindowStart = start.value;
    body.callWindowEnd = end.value;
    body.maxCallsPerNumberPerDay = maxCalls.value;
    body.minIntervalMinutes = minInterval.value;
  }
  if (accessKeyId) body.accessKeyId = accessKeyId;
  if (accessKeySecret) body.accessKeySecret = accessKeySecret;
  if (callbackPathToken) body.callbackPathToken = callbackPathToken;
  return { ok: true, body };
}
