import { canSeeOwner, hasIamPermission } from "./auth.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import {
  PROSPECT_OWNER_REASSIGN_SYNCED,
  prospectOwnerReassignBlock
} from "./prospect-owner-reassign.js";
import type { CrmStore } from "./store.js";
import type { OutboundCallRecord, OwnerReassignAuditEvent, SessionUser } from "./types.js";

/**
 * 单条通话结果保存时，可以顺手把关联对象的负责人改成同租户的另一位同事。
 * 负责人仍写客户、线索、搜客上已有的 ownerId。
 * 搜客沿用 prospectOwnerReassignBlock：lead.assign、归属可见范围，已入线索的不能改。
 * 客户用 customer.assign，线索用 lead.assign，可见范围仍是 canSeeOwner。
 * 成功和拒绝都写原来的 owner_reassign_audits。不拨号，不改抑制，不转线索。
 */

const ASSIGN_PERMISSION = {
  customer: "customer.assign",
  lead: "lead.assign",
  prospect: "lead.assign"
} as const;

type TargetType = keyof typeof ASSIGN_PERMISSION;
type AuditObjectType = OwnerReassignAuditEvent["objectType"];

export type CallOutcomeTransferPlan =
  | { ok: true; kind: "skip" }
  | {
    ok: true;
    kind: "write";
    objectType: AuditObjectType;
    objectId: string;
    previous: string;
    next: string;
    apply: () => void;
  }
  | {
    ok: false;
    status: number;
    reason: string;
    message: string;
    audit: {
      action: OwnerReassignAuditEvent["action"];
      objectType: AuditObjectType;
      objectId: string;
      previousOwnerId: string;
      nextOwnerId: string;
    } | null;
  };

export function parseCallOutcomeTransfer(value: unknown):
  | { ok: true; transferTo: string }
  | { ok: false; reason: "invalid_request" } {
  if (value === undefined || value === null) return { ok: true, transferTo: "" };
  if (typeof value !== "string") return { ok: false, reason: "invalid_request" };
  const transferTo = value.trim();
  if (!transferTo) return { ok: true, transferTo: "" };
  if (transferTo.length > 64) return { ok: false, reason: "invalid_request" };
  return { ok: true, transferTo };
}

function rejectPlan(
  status: number,
  reason: string,
  message: string,
  audit: Extract<CallOutcomeTransferPlan, { ok: false }>["audit"]
): CallOutcomeTransferPlan {
  return { ok: false, status, reason, message, audit };
}

function sameTenantAssignee(store: CrmStore, teamId: string, userId: string) {
  return store.users.find((item) => item.id === userId && item.status === "active" && item.teamId === teamId);
}

export function planCallOutcomeTransfer(
  store: CrmStore,
  user: SessionUser,
  record: Pick<OutboundCallRecord, "targetType" | "targetId">,
  transferTo: string
): CallOutcomeTransferPlan {
  if (!transferTo) return { ok: true, kind: "skip" };
  const assignee = sameTenantAssignee(store, user.teamId, transferTo);
  if (!assignee) {
    return rejectPlan(400, "invalid_assignee", "新负责人不存在、不在当前租户或账号已停用", null);
  }
  const targetType = record.targetType;
  const targetId = (record.targetId || "").trim();
  if ((targetType !== "customer" && targetType !== "lead" && targetType !== "prospect") || !targetId) {
    return rejectPlan(400, "no_target", "这条通话没有关联对象，不能转交负责人", null);
  }
  if (targetType === "customer") {
    return planCustomer(store, user, targetId, assignee.id);
  }
  if (targetType === "lead") {
    return planLead(store, user, targetId, assignee.id);
  }
  return planProspect(store, user, targetId, assignee.id);
}

function planCustomer(store: CrmStore, user: SessionUser, targetId: string, nextOwnerId: string): CallOutcomeTransferPlan {
  const customer = store.customers.find((item) => item.id === targetId && item.teamId === user.teamId);
  if (!customer) {
    return rejectPlan(404, "not_found", "客户不存在", {
      action: "reject_not_found",
      objectType: "customer",
      objectId: targetId,
      previousOwnerId: "",
      nextOwnerId
    });
  }
  if (isPublicCustomer(customer)) {
    return rejectPlan(409, "public_pool", "公池客户为只读，请先领取后再操作", {
      action: "reject_public_pool",
      objectType: "customer",
      objectId: customer.id,
      previousOwnerId: customer.ownerId || "",
      nextOwnerId
    });
  }
  if (!hasIamPermission(user, ASSIGN_PERMISSION.customer)) {
    return rejectPlan(403, "forbidden", "没有分配该客户负责人的权限", {
      action: "reject_forbidden",
      objectType: "customer",
      objectId: customer.id,
      previousOwnerId: customer.ownerId || "",
      nextOwnerId
    });
  }
  if (!canSeeOwner(user, customer.ownerId, customer.teamId)) {
    return rejectPlan(404, "not_found", "客户不存在", {
      action: "reject_not_found",
      objectType: "customer",
      objectId: customer.id,
      previousOwnerId: customer.ownerId || "",
      nextOwnerId
    });
  }
  const previous = customer.ownerId || "";
  return {
    ok: true,
    kind: "write",
    objectType: "customer",
    objectId: customer.id,
    previous,
    next: nextOwnerId,
    apply: () => {
      customer.ownerId = nextOwnerId;
    }
  };
}

function planLead(store: CrmStore, user: SessionUser, targetId: string, nextOwnerId: string): CallOutcomeTransferPlan {
  const lead = store.leads.find((item) => item.id === targetId && item.teamId === user.teamId && !item.deletedAt);
  if (!lead) {
    return rejectPlan(404, "not_found", "线索不存在、已删除或无权访问", {
      action: "reject_not_found",
      objectType: "lead",
      objectId: targetId,
      previousOwnerId: "",
      nextOwnerId
    });
  }
  if (!hasIamPermission(user, ASSIGN_PERMISSION.lead)) {
    return rejectPlan(403, "forbidden", "没有分配该线索负责人的权限", {
      action: "reject_forbidden",
      objectType: "lead",
      objectId: lead.id,
      previousOwnerId: lead.ownerId || "",
      nextOwnerId
    });
  }
  if (!canSeeOwner(user, lead.ownerId, lead.teamId)) {
    return rejectPlan(404, "not_found", "线索不存在、已删除或无权访问", {
      action: "reject_not_found",
      objectType: "lead",
      objectId: lead.id,
      previousOwnerId: lead.ownerId || "",
      nextOwnerId
    });
  }
  const previous = lead.ownerId || "";
  return {
    ok: true,
    kind: "write",
    objectType: "lead",
    objectId: lead.id,
    previous,
    next: nextOwnerId,
    apply: () => {
      lead.ownerId = nextOwnerId;
    }
  };
}

function planProspect(store: CrmStore, user: SessionUser, targetId: string, nextOwnerId: string): CallOutcomeTransferPlan {
  const candidate = store.websiteOpportunities.find((item) => item.id === targetId && item.teamId === user.teamId);
  if (!candidate) {
    return rejectPlan(404, "not_found", "搜客候选不存在或无权访问", {
      action: "reject_not_found",
      objectType: "prospect_candidate",
      objectId: targetId,
      previousOwnerId: "",
      nextOwnerId
    });
  }
  const block = prospectOwnerReassignBlock(user, candidate);
  if (block === PROSPECT_OWNER_REASSIGN_SYNCED) {
    return rejectPlan(400, "synced", PROSPECT_OWNER_REASSIGN_SYNCED, null);
  }
  if (block) {
    if (!hasIamPermission(user, ASSIGN_PERMISSION.prospect)) {
      return rejectPlan(403, "forbidden", "没有分配该搜客对象负责人的权限", {
        action: "reject_forbidden",
        objectType: "prospect_candidate",
        objectId: candidate.id,
        previousOwnerId: candidate.ownerId || "",
        nextOwnerId
      });
    }
    return rejectPlan(404, "not_found", "搜客候选不存在或无权访问", {
      action: "reject_not_found",
      objectType: "prospect_candidate",
      objectId: candidate.id,
      previousOwnerId: candidate.ownerId || "",
      nextOwnerId
    });
  }
  const previous = candidate.ownerId || "";
  return {
    ok: true,
    kind: "write",
    objectType: "prospect_candidate",
    objectId: candidate.id,
    previous,
    next: nextOwnerId,
    apply: () => {
      candidate.ownerId = nextOwnerId;
    }
  };
}
