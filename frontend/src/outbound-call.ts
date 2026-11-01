/**
 * 客户、线索、候选的一键外呼。只组单次请求、判断按钮是否出现，并在确认后提交。
 * 不批量，不定时，不自动重拨，也不放宽服务端门禁。
 */

export type OutboundTargetType = "customer" | "lead" | "prospect";

export interface OutboundCallTarget {
  targetType: OutboundTargetType;
  targetId: string;
  phoneId: string;
  phone: string;
}

export interface OutboundCallAvailability {
  enabled: boolean;
  permitted: boolean;
}

export interface OutboundCallBody {
  targetType: OutboundTargetType;
  targetId: string;
  phoneId: string;
}

export interface OutboundCallResponse {
  result?: string;
  reason?: string;
  message?: string;
  jobId?: string;
}

/** 与服务端拒绝文案一致。服务端带了 message 时优先用服务端的。 */
export const OUTBOUND_CALL_REASON_TEXT: Record<string, string> = {
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
  dial_failed: "外呼没有发出",
  invalid_request: "参数格式错误"
};

export function customerOutboundPhoneId(customerId: string) {
  return `customer-phone:${customerId}`;
}

export function leadOutboundPhoneId(leadId: string) {
  return `lead-phone:${leadId}`;
}

export function outboundTargetKey(target: { targetType: string; targetId: string; phoneId: string }) {
  return `${target.targetType}:${target.targetId}:${target.phoneId}`;
}

/** 开关开启、有外呼权限、并且号码非空时才显示。缺一不可。无效号码仍显示，但由调用方置灰。 */
export function showOutboundCallButton(input: OutboundCallAvailability & { phone: string }) {
  return input.enabled === true && input.permitted === true && input.phone.trim().length > 0;
}

/** 已标记无效时按钮置灰，不因此隐藏。 */
export function outboundCallButtonDisabled(phoneInvalid: boolean) {
  return phoneInvalid === true;
}

export function outboundCallButtonTitle(phoneInvalid: boolean) {
  return phoneInvalid ? "该号码已标记无效" : "只拨这一个号码";
}

export function customerOutboundTarget(customerId: string, phone: string): OutboundCallTarget | null {
  const value = phone.trim();
  const id = customerId.trim();
  if (!id || !value) return null;
  return {
    targetType: "customer",
    targetId: id,
    phoneId: customerOutboundPhoneId(id),
    phone: value
  };
}

export function leadOutboundTarget(leadId: string, phone: string): OutboundCallTarget | null {
  const value = phone.trim();
  const id = leadId.trim();
  if (!id || !value) return null;
  return {
    targetType: "lead",
    targetId: id,
    phoneId: leadOutboundPhoneId(id),
    phone: value
  };
}

/** 只取电话渠道。每个渠道单独成一次外呼，不合并成批量。 */
export function prospectOutboundTargets(
  candidateId: string,
  channels: Array<{ id: string; channelType: string; value: string }>
): OutboundCallTarget[] {
  const id = candidateId.trim();
  if (!id) return [];
  return channels.flatMap((channel) => {
    const phone = channel.value.trim();
    const phoneId = channel.id.trim();
    if (channel.channelType !== "phone" || !phone || !phoneId) return [];
    return [{
      targetType: "prospect" as const,
      targetId: id,
      phoneId,
      phone
    }];
  });
}

/** 请求体只有目标类型、目标 ID 和号码 ID。不传被叫号码，也不接受批量字段。 */
export function buildOutboundCallBody(target: OutboundCallTarget): OutboundCallBody {
  return {
    targetType: target.targetType,
    targetId: target.targetId,
    phoneId: target.phoneId
  };
}

export function outboundCallFeedback(input: OutboundCallResponse): { tone: "ok" | "error"; message: string } {
  if (input.result === "allowed") {
    const jobId = (input.jobId || "").trim();
    return { tone: "ok", message: jobId ? `外呼已受理，通话编号 ${jobId}` : "外呼已受理" };
  }
  const message = (input.message || "").trim();
  const fallback = OUTBOUND_CALL_REASON_TEXT[input.reason || ""] || "外呼没有发出";
  return { tone: "error", message: message || fallback };
}

export function createOutboundCallInFlight() {
  const pending = new Set<string>();
  return {
    tryBegin(target: { targetType: string; targetId: string; phoneId: string }) {
      const key = outboundTargetKey(target);
      if (pending.has(key)) return false;
      pending.add(key);
      return true;
    },
    end(target: { targetType: string; targetId: string; phoneId: string }) {
      pending.delete(outboundTargetKey(target));
    }
  };
}

export interface ConfirmedOutboundCallResult {
  sent: boolean;
  cancelled: boolean;
  busy: boolean;
  feedback: { tone: "ok" | "error"; message: string } | null;
}

/**
 * 先占住这一通，再等确认。取消不发请求。确认后只 post 一次。
 * 同一目标在返回前再次进入时 busy，不再 post。
 */
export async function runConfirmedOutboundCall(input: {
  target: OutboundCallTarget;
  gate: ReturnType<typeof createOutboundCallInFlight>;
  confirm: () => Promise<boolean>;
  post: (body: OutboundCallBody) => Promise<OutboundCallResponse>;
  onPending?: (phase: "confirm" | "request" | "idle") => void;
}): Promise<ConfirmedOutboundCallResult> {
  if (!input.gate.tryBegin(input.target)) {
    return { sent: false, cancelled: false, busy: true, feedback: null };
  }
  try {
    input.onPending?.("confirm");
    const confirmed = await input.confirm();
    if (!confirmed) {
      return { sent: false, cancelled: true, busy: false, feedback: null };
    }
    input.onPending?.("request");
    try {
      const body = await input.post(buildOutboundCallBody(input.target));
      return { sent: true, cancelled: false, busy: false, feedback: outboundCallFeedback(body) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      return {
        sent: true,
        cancelled: false,
        busy: false,
        feedback: outboundCallFeedback({ result: "rejected", message })
      };
    }
  } finally {
    input.gate.end(input.target);
    input.onPending?.("idle");
  }
}
