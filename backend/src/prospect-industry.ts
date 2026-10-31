import { canSeeOwner, hasIamPermission, type IamActor } from "./auth.js";

export const PROSPECT_INDUSTRY_BATCH_LIMIT = 100;
/** 案例行业列是 VARCHAR(120)。候选上没有行业枚举，按这个长度收自由文本。 */
export const PROSPECT_INDUSTRY_TEXT_MAX = 120;
export const PROSPECT_INDUSTRY_DENIED = "无权修改该候选的行业";

/**
 * 候选上原来没有 industry。
 * 同行和案例的 industry、搜索词 industryTerms 都不在候选上。
 * business 是业务方向，不拿来当行业。
 * 空值和超长视为未设置。
 */
export function readProspectIndustry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > PROSPECT_INDUSTRY_TEXT_MAX) return null;
  return text;
}

/**
 * 设置时去掉首尾空白。空值和超过 120 字整批不能写。
 * 仓库没有行业枚举，不按枚举收窄。
 */
export function normalizeProspectIndustry(
  value: unknown
): { ok: true; industry: string } | { ok: false; message: string } {
  if (value == null) return { ok: false, message: "请填写行业" };
  const text = String(value).trim();
  if (!text) return { ok: false, message: "请填写行业" };
  if (text.length > PROSPECT_INDUSTRY_TEXT_MAX) return { ok: false, message: "行业过长" };
  return { ok: true, industry: text };
}

/**
 * 逐行判断操作人能不能改这条候选的行业。
 * 写行业要 prospect.execute，并沿用现有租户和归属可见范围。
 * 返回 null 表示可以改。
 */
export function prospectIndustryBlock(
  actor: IamActor,
  candidate: { ownerId: string; teamId: string } | undefined
) {
  if (!candidate) return PROSPECT_INDUSTRY_DENIED;
  if (!hasIamPermission(actor, "prospect.execute")) return PROSPECT_INDUSTRY_DENIED;
  if (candidate.teamId !== actor.teamId) return PROSPECT_INDUSTRY_DENIED;
  if (!canSeeOwner(actor, candidate.ownerId, candidate.teamId)) return PROSPECT_INDUSTRY_DENIED;
  return null;
}

/** 写成去掉空白后的行业，或清空为 null。已经是这个值时不算改动。 */
export function applyProspectIndustry(current: unknown, next: string | null) {
  const previous = readProspectIndustry(current);
  if (previous === next) return { changed: false, industry: previous };
  return { changed: true, industry: next };
}
