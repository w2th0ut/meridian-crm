import { canSeeOwner, hasIamPermission, type IamActor } from "./auth.js";

export const PROSPECT_NOTE_BATCH_LIMIT = 100;
export const PROSPECT_NOTE_TEXT_MAX = 1000;
export const PROSPECT_NOTE_DENIED = "无权追加该候选的备注";

/**
 * 先去掉首尾空白。空内容或超过 1000 字时整批不能写。
 * 详情里的「候选备注」是核验资料 description，会进入资格依据。
 * 跟进方式里的「备注」会记一条跟进，并受可联系门禁。
 * 这两处都不是只追加、又不改资格的备注，所以写在候选的 notes 上。
 */
export function normalizeProspectNote(value: string): { ok: true; note: string } | { ok: false; message: string } {
  const note = String(value ?? "").trim();
  if (!note) return { ok: false, message: "请填写备注" };
  if (note.length > PROSPECT_NOTE_TEXT_MAX) return { ok: false, message: "备注过长" };
  return { ok: true, note };
}

/**
 * 逐行判断操作人能不能给这条候选追加备注。
 * 写备注要 prospect.execute，并沿用现有租户和归属可见范围。
 * 返回 null 表示可以写。
 */
export function prospectNoteBlock(
  actor: IamActor,
  candidate: { ownerId: string; teamId: string } | undefined
) {
  if (!candidate) return PROSPECT_NOTE_DENIED;
  if (!hasIamPermission(actor, "prospect.execute")) return PROSPECT_NOTE_DENIED;
  if (candidate.teamId !== actor.teamId) return PROSPECT_NOTE_DENIED;
  if (!canSeeOwner(actor, candidate.ownerId, candidate.teamId)) return PROSPECT_NOTE_DENIED;
  return null;
}

/**
 * 把这一条接在已有 notes 后面。已有文字原样留下，不去掉、不覆盖。
 * 原来没有内容时直接写下这一条，不在前面加空行。
 */
export function appendProspectNote(current: string | undefined, note: string) {
  const existing = typeof current === "string" ? current : "";
  const text = String(note ?? "");
  if (!text) return { changed: false, notes: existing, appended: "" };
  const notes = existing ? `${existing}\n${text}` : text;
  return { changed: true, notes, appended: text };
}
