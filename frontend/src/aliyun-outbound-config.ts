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
  if (accessKeyId) body.accessKeyId = accessKeyId;
  if (accessKeySecret) body.accessKeySecret = accessKeySecret;
  if (callbackPathToken) body.callbackPathToken = callbackPathToken;
  return { ok: true, body };
}
