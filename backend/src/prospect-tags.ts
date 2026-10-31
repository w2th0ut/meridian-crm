import { canSeeOwner, hasIamPermission, type IamActor } from "./auth.js";

export const PROSPECT_TAG_BATCH_LIMIT = 100;
export const PROSPECT_TAG_TEXT_MAX = 40;
export const PROSPECT_TAG_COUNT_MAX = 20;
export const PROSPECT_CANDIDATE_TAGS_MAX = 30;
export const PROSPECT_TAG_DENIED = "无权修改该候选的标签";
export const PROSPECT_TAG_CAP = "标签数量超过上限";

/**
 * 去掉首尾空白、丢掉空标签、按出现顺序去重，并限制单条长度和一次个数。
 * 返回 null 表示可以写入；否则是 400 用的说明。
 */
export function normalizeProspectTags(tags: string[]): { ok: true; tags: string[] } | { ok: false; message: string } {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = String(raw ?? "").trim();
    if (!tag) continue;
    if (tag.length > PROSPECT_TAG_TEXT_MAX) return { ok: false, message: "标签过长" };
    if (seen.has(tag)) continue;
    seen.add(tag);
    next.push(tag);
  }
  if (!next.length) return { ok: false, message: "请填写标签" };
  if (next.length > PROSPECT_TAG_COUNT_MAX) return { ok: false, message: "一次最多 20 个标签" };
  return { ok: true, tags: next };
}

/**
 * 逐行判断操作人能不能改这条候选的标签。
 * 写标签要 prospect.execute，并沿用现有租户和归属可见范围。
 * 返回 null 表示可以改。
 */
export function prospectTagBlock(
  actor: IamActor,
  candidate: { ownerId: string; teamId: string } | undefined
) {
  if (!candidate) return PROSPECT_TAG_DENIED;
  if (!hasIamPermission(actor, "prospect.execute")) return PROSPECT_TAG_DENIED;
  if (candidate.teamId !== actor.teamId) return PROSPECT_TAG_DENIED;
  if (!canSeeOwner(actor, candidate.ownerId, candidate.teamId)) return PROSPECT_TAG_DENIED;
  return null;
}

/** 在已有标签上加上或去掉这一批。超过候选标签上限时整行不改。 */
export function applyProspectTags(
  current: string[] | undefined,
  action: "add" | "remove",
  tags: string[]
): { ok: true; changed: boolean; tags: string[]; applied: string[] } | { ok: false; reason: string } {
  const existing = (current || []).filter((tag) => typeof tag === "string" && tag.length > 0);
  if (action === "remove") {
    const remove = new Set(tags);
    const applied = existing.filter((tag) => remove.has(tag));
    if (!applied.length) return { ok: true, changed: false, tags: existing, applied: [] };
    return {
      ok: true,
      changed: true,
      tags: existing.filter((tag) => !remove.has(tag)),
      applied
    };
  }
  const seen = new Set(existing);
  const applied = tags.filter((tag) => !seen.has(tag));
  if (!applied.length) return { ok: true, changed: false, tags: existing, applied: [] };
  if (existing.length + applied.length > PROSPECT_CANDIDATE_TAGS_MAX) {
    return { ok: false, reason: PROSPECT_TAG_CAP };
  }
  return { ok: true, changed: true, tags: [...existing, ...applied], applied };
}
