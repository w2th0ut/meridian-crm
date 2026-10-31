import { canSeeOwner, hasIamPermission, type IamActor } from "./auth.js";

export const PROSPECT_OWNER_REASSIGN_LIMIT = 100;
export const PROSPECT_OWNER_REASSIGN_DENIED = "无权修改该候选的负责人";
export const PROSPECT_OWNER_REASSIGN_SYNCED = "已入线索的数据不能重新分配";

/**
 * 逐行判断操作人能不能改这条候选的负责人。
 * 改归属仍要 lead.assign，并且沿用现有租户和归属可见范围。
 * 已入线索的记录沿用原来的限制，但这不是无权。
 * 返回 null 表示可以改。
 */
export function prospectOwnerReassignBlock(
  actor: IamActor,
  candidate: { ownerId: string; teamId: string; status?: string } | undefined
) {
  if (!candidate) return PROSPECT_OWNER_REASSIGN_DENIED;
  if (!hasIamPermission(actor, "lead.assign")) return PROSPECT_OWNER_REASSIGN_DENIED;
  if (!canSeeOwner(actor, candidate.ownerId, candidate.teamId)) return PROSPECT_OWNER_REASSIGN_DENIED;
  if (candidate.status === "synced") return PROSPECT_OWNER_REASSIGN_SYNCED;
  return null;
}
