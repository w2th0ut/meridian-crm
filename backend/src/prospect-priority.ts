import { canSeeOwner, hasIamPermission, type IamActor } from "./auth.js";

export const PROSPECT_PRIORITY_BATCH_LIMIT = 100;
export const PROSPECT_PRIORITY_VALUES = ["high", "normal", "low"] as const;
export const PROSPECT_PRIORITY_DENIED = "无权修改该候选的优先级";

export type ProspectPriority = (typeof PROSPECT_PRIORITY_VALUES)[number];

/** 候选上原来没有优先级、星级或重要度。只认 high、normal、low，其余视为未设置。 */
export function readProspectPriority(value: unknown): ProspectPriority | null {
  return value === "high" || value === "normal" || value === "low" ? value : null;
}

/**
 * 设置时只接受 high、normal、low。空值和其余文字整批不能写。
 * 首尾空白会去掉。大小写不放宽。
 */
export function normalizeProspectPriority(
  value: unknown
): { ok: true; priority: ProspectPriority } | { ok: false; message: string } {
  if (value == null) return { ok: false, message: "请填写优先级" };
  const text = String(value).trim();
  if (!text) return { ok: false, message: "请填写优先级" };
  if (text !== "high" && text !== "normal" && text !== "low") {
    return { ok: false, message: "优先级不正确" };
  }
  return { ok: true, priority: text };
}

/**
 * 逐行判断操作人能不能改这条候选的优先级。
 * 写优先级要 prospect.execute，并沿用现有租户和归属可见范围。
 * 返回 null 表示可以改。
 */
export function prospectPriorityBlock(
  actor: IamActor,
  candidate: { ownerId: string; teamId: string } | undefined
) {
  if (!candidate) return PROSPECT_PRIORITY_DENIED;
  if (!hasIamPermission(actor, "prospect.execute")) return PROSPECT_PRIORITY_DENIED;
  if (candidate.teamId !== actor.teamId) return PROSPECT_PRIORITY_DENIED;
  if (!canSeeOwner(actor, candidate.ownerId, candidate.teamId)) return PROSPECT_PRIORITY_DENIED;
  return null;
}

/** 写成 high、normal、low，或清空为 null。已经是这个值时不算改动。 */
export function applyProspectPriority(current: unknown, next: ProspectPriority | null) {
  const previous = readProspectPriority(current);
  if (previous === next) return { changed: false, priority: previous };
  return { changed: true, priority: next };
}
