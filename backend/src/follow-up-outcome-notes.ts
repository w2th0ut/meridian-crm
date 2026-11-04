import { randomUUID } from "node:crypto";
import { canSeeOwner, hasIamPermission, isPlatformIdentity, type IamActor } from "./auth.js";
import { displayMaskedNumber } from "./call-wrapup-queue.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import { outboundInstant } from "./outbound-call.js";
import {
  CALL_OUTCOMES,
  outboundCallRecordVisible,
  resolveOutboundCallRecordAccess
} from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type { CallOutcomeAudit, FollowUpOutcomeNoteViewAudit, OutboundCallRecord, SessionUser } from "./types.js";

/**
 * 客户和线索跟进旁边只读已经写下的通话结果备注。
 * 备注仍在通话记录的 callOutcomeNote 上。时间线里的通话纪要是另一段正文，不在这里返回。
 * 不按通话结果分类，不改下次跟进，也不新写跟进。
 * 查看写入 follow_up_outcome_note_view_audits。不拨号，不发信，不调用外部接口。
 */

const TARGET_ID = /^[A-Za-z0-9_-]{1,64}$/;
const OUTCOME_LABELS = new Set<string>(CALL_OUTCOMES);

export interface FollowUpOutcomeNoteItem {
  callRecordId: string;
  outcomeLabel: string;
  note: string;
  at: string;
  maskedNumber: string;
}

export function followUpOutcomeLabel(value: string) {
  const text = value.trim();
  return OUTCOME_LABELS.has(text) ? text : "未标注";
}

export function parseFollowUpOutcomeNoteQuery(query: Record<string, unknown>): { targetType: "customer" | "lead"; targetId: string } | null {
  const keys = Object.keys(query);
  if (keys.length !== 2 || keys.some((key) => key !== "targetType" && key !== "targetId")) return null;
  if (Object.values(query).some((value) => Array.isArray(value))) return null;
  const targetType = query.targetType;
  if (targetType !== "customer" && targetType !== "lead") return null;
  if (typeof query.targetId !== "string") return null;
  const targetId = query.targetId.trim();
  if (!TARGET_ID.test(targetId)) return null;
  return { targetType, targetId };
}

export function followUpOutcomeNoteAt(record: OutboundCallRecord, audits: readonly CallOutcomeAudit[]) {
  const note = (record.callOutcomeNote || "").trim();
  const matches = audits.filter((item) => (
    item.action !== "read"
    && item.teamId === record.teamId
    && item.callRecordId === record.id
    && (item.nextNote || "").trim() === note
    && (item.at || "").trim()
  ));
  if (matches.length) {
    const latest = [...matches].sort((left, right) => {
      if (left.at !== right.at) return left.at < right.at ? 1 : -1;
      return left.id < right.id ? 1 : -1;
    })[0];
    return latest?.at || "";
  }
  return (record.updatedAt || "").trim() || (record.createdAt || "").trim();
}

export function followUpOutcomeNotesForTarget(input: {
  teamId: string;
  targetType: "customer" | "lead";
  targetId: string;
  records: readonly OutboundCallRecord[];
  audits: readonly CallOutcomeAudit[];
  visible: (record: OutboundCallRecord) => boolean;
}): FollowUpOutcomeNoteItem[] {
  return input.records
    .filter((record) => (
      record.teamId === input.teamId
      && record.targetType === input.targetType
      && record.targetId === input.targetId
      && (record.callOutcomeNote || "").trim()
      && input.visible(record)
    ))
    .map((record) => ({
      callRecordId: record.id,
      outcomeLabel: followUpOutcomeLabel(record.callOutcome || ""),
      note: (record.callOutcomeNote || "").trim(),
      at: followUpOutcomeNoteAt(record, input.audits),
      maskedNumber: displayMaskedNumber(record.maskedNumber || "")
    }))
    .sort((left, right) => {
      if (left.at !== right.at) return left.at < right.at ? 1 : -1;
      return left.callRecordId < right.callRecordId ? 1 : -1;
    });
}

function clipId(value: string) {
  return value.slice(0, 64);
}

async function assignReadScope(store: CrmStore, user: SessionUser, permissionCode: string) {
  if (store.resolveIamDataScope) {
    user.iamDataScope = {
      permissionCode,
      ...await store.resolveIamDataScope(user, permissionCode)
    };
    return;
  }
  const scopes = (user.iamPermissions?.[permissionCode] || []) as Array<"self" | "org_unit" | "org_subtree" | "tenant" | "public_pool">;
  const organizationWide = scopes.includes("org_unit") || scopes.includes("org_subtree");
  user.iamDataScope = {
    permissionCode,
    tenantWide: scopes.includes("tenant"),
    ownerIds: organizationWide
      ? store.users.filter((item) => item.teamId === user.teamId && item.status === "active").map((item) => item.id)
      : scopes.includes("self") ? [user.id] : []
  };
}

function targetVisible(
  store: CrmStore,
  user: SessionUser,
  targetType: "customer" | "lead",
  targetId: string
) {
  if (targetType === "customer") {
    const customer = store.customers.find((item) => item.id === targetId && item.teamId === user.teamId);
    if (!customer) return false;
    if (isPublicCustomer(customer)) return !isPlatformIdentity(user);
    return canSeeOwner(user, customer.ownerId, customer.teamId);
  }
  const lead = store.leads.find((item) => item.id === targetId && item.teamId === user.teamId && !item.deletedAt);
  if (!lead) return false;
  return canSeeOwner(user, lead.ownerId, lead.teamId);
}

async function writeAudit(store: CrmStore, input: Omit<FollowUpOutcomeNoteViewAudit, "id" | "at">) {
  const audit: FollowUpOutcomeNoteViewAudit = {
    id: `fona_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input,
    targetId: clipId(input.targetId),
    rowCount: Number.isFinite(input.rowCount) ? input.rowCount : 0
  };
  store.followUpOutcomeNoteViewAudits.unshift(audit);
  await store.persist();
  return audit;
}

async function deny(
  store: CrmStore,
  user: SessionUser,
  targetType: "customer" | "lead",
  targetId: string
) {
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "read",
    targetType,
    targetId,
    rowCount: 0,
    result: "rejected",
    reason: "forbidden"
  });
  const label = targetType === "customer" ? "客户" : "线索";
  return {
    status: 403,
    body: {
      result: "rejected" as const,
      reason: "forbidden",
      message: `没有查看这个${label}通话结果备注的权限`
    }
  };
}

export async function listFollowUpOutcomeNotes(
  store: CrmStore,
  user: SessionUser | undefined,
  query: Record<string, unknown>
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseFollowUpOutcomeNoteQuery(query);
  if (!parsed) {
    return {
      status: 400,
      body: {
        result: "rejected" as const,
        reason: "invalid_request",
        message: "一次只能查看一个客户或一条线索的通话结果备注"
      }
    };
  }
  const objectPermission = parsed.targetType === "customer" ? "customer.read" : "lead.read";
  if (!hasIamPermission(user as IamActor, "communication.read") || !hasIamPermission(user as IamActor, objectPermission)) {
    return deny(store, user, parsed.targetType, parsed.targetId);
  }
  const scopeBefore = user.iamDataScope;
  try {
    await assignReadScope(store, user, objectPermission);
    if (!targetVisible(store, user, parsed.targetType, parsed.targetId)) {
      return await deny(store, user, parsed.targetType, parsed.targetId);
    }
    const resolved = await resolveOutboundCallRecordAccess(store, user);
    if (!resolved.ok) return await deny(store, user, parsed.targetType, parsed.targetId);
    const items = followUpOutcomeNotesForTarget({
      teamId: user.teamId,
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      records: store.outboundCallRecords,
      audits: store.callOutcomeAudits,
      visible: (record) => outboundCallRecordVisible(record, user.teamId, resolved.access)
    });
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "read",
      targetType: parsed.targetType,
      targetId: parsed.targetId,
      rowCount: items.length,
      result: "read",
      reason: ""
    });
    return {
      status: 200,
      body: {
        targetType: parsed.targetType,
        targetId: parsed.targetId,
        empty: items.length === 0,
        items
      }
    };
  } finally {
    user.iamDataScope = scopeBefore;
  }
}
