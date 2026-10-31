/**
 * 工作台记跟进。只组请求、判断入口该不该出现，并在写入后重算已有的跟进空档和次回跟进。
 * 不发信，不发消息，不推进序列，不放行批次，也不改批准。
 */
import { presentFollowUpGap, type FollowUpGapView } from "./prospect-follow-up-gap";
import { presentNextFollowDue, type NextFollowDueView } from "./prospect-next-follow-due";

export const PROSPECT_FOLLOW_UP_TYPES = [
  "call",
  "wechat",
  "whatsapp",
  "linkedin",
  "email",
  "meeting",
  "note"
] as const;

export const CUSTOMER_FOLLOW_UP_TYPES = [
  "call",
  "email",
  "whatsapp",
  "wechat",
  "meeting",
  "note"
] as const;

export const WORKBENCH_FOLLOW_UP_TYPE_LABEL: Record<string, string> = {
  call: "电话",
  wechat: "微信",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  email: "邮件",
  meeting: "会面",
  note: "备注"
};

export type WorkbenchFollowUpSubject = "prospect" | "customer";

export function followUpTypesFor(subject: WorkbenchFollowUpSubject): readonly string[] {
  return subject === "customer" ? CUSTOMER_FOLLOW_UP_TYPES : PROSPECT_FOLLOW_UP_TYPES;
}

/** 跟进内容必填。方式必须落在该对象已有的跟进类型里。下次跟进可空。 */
export function buildWorkbenchFollowUpBody(input: {
  subject: WorkbenchFollowUpSubject;
  content: string;
  type: string;
  nextFollowAt: string;
}): { ok: true; body: Record<string, string> } | { ok: false; message: string } {
  const content = input.content.trim();
  if (!content) return { ok: false, message: "请填写跟进内容" };
  if (content.length > 2000) return { ok: false, message: "跟进内容过长" };
  const types = followUpTypesFor(input.subject);
  if (!types.includes(input.type)) return { ok: false, message: "跟进方式不正确" };
  const next = input.nextFollowAt.trim();
  if (input.subject === "customer") {
    const body: Record<string, string> = { type: input.type, content };
    if (next) body.nextReminder = next.includes("T") ? next.replace("T", " ") : next;
    return { ok: true, body };
  }
  const body: Record<string, string> = { type: input.type, content };
  if (next) body.nextFollowAt = next;
  return { ok: true, body };
}

/**
 * 候选记跟进入口。只给归属业务员，且已经可联系、已联系、已是线索，或当前仍有人工可联系批准。
 * 不放宽 convert_to_lead / approved_contactable：未批准的待处理不出现入口。
 */
export function showProspectRecordEntry(input: {
  userId?: string;
  ownerId: string;
  status: string;
  leadId?: string;
  contactableApproved?: boolean;
}) {
  if (!input.userId || input.ownerId !== input.userId) return false;
  if (input.status === "excluded") return false;
  if (input.status === "contactable" || input.status === "contacted" || input.status === "synced" || input.leadId) {
    return true;
  }
  return Boolean(input.contactableApproved);
}

/**
 * 客户记跟进入口。客户必须已经在当前用户可写的客户列表里。
 * 归属人可以记。主管、管理员看得到同团队客户时也可以记。没有写权限不出现入口。
 */
export function showCustomerRecordEntry(input: {
  userId?: string;
  ownerId: string;
  teamId: string;
  userTeamId?: string;
  userRole?: string;
  inOwnedList: boolean;
  tenantWide?: boolean;
}) {
  if (!input.userId || !input.inOwnedList) return false;
  if (input.ownerId === input.userId) return true;
  if (input.tenantWide) return true;
  if (input.userRole === "super_admin") return true;
  if ((input.userRole === "manager" || input.userRole === "admin") && input.userTeamId && input.userTeamId === input.teamId) {
    return true;
  }
  return false;
}

/** 写入成功后，用已有的只读规则重算这一行的跟进空档和次回跟进。 */
export function prospectReadoutsAfterFollowUp(input: {
  latestFollowUpAt: string;
  nextFollowAt: string;
}, now = new Date()): { gap: FollowUpGapView; next: NextFollowDueView } {
  return {
    gap: presentFollowUpGap({ at: input.latestFollowUpAt }, now),
    next: presentNextFollowDue(input.nextFollowAt, now)
  };
}
