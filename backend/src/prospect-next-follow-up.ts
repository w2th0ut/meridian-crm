import { canSeeOwner, hasIamPermission, type IamActor } from "./auth.js";
import type { Lead, WebsiteOpportunity } from "./types.js";

export const PROSPECT_NEXT_FOLLOW_UP_BATCH_LIMIT = 100;
/** 日期写入已有的 nextFollowAt 时，时刻固定为当天结束前的最后一分钟。 */
export const PROSPECT_NEXT_FOLLOW_UP_CLOCK = "23:59";
export const PROSPECT_NEXT_FOLLOW_UP_DENIED = "无权修改该候选的下次跟进";

/**
 * 逐行判断操作人能不能改这条候选的下次跟进。
 * 写日期要 prospect.execute，并沿用现有租户和归属可见范围。
 * 返回 null 表示可以改。
 */
export function prospectNextFollowUpBlock(
  actor: IamActor,
  candidate: { ownerId: string; teamId: string } | undefined
) {
  if (!candidate) return PROSPECT_NEXT_FOLLOW_UP_DENIED;
  if (!hasIamPermission(actor, "prospect.execute")) return PROSPECT_NEXT_FOLLOW_UP_DENIED;
  if (candidate.teamId !== actor.teamId) return PROSPECT_NEXT_FOLLOW_UP_DENIED;
  if (!canSeeOwner(actor, candidate.ownerId, candidate.teamId)) return PROSPECT_NEXT_FOLLOW_UP_DENIED;
  return null;
}

function localIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 允许的最早日历日：今天减 1 天。昨天可以，再早不行。 */
export function earliestProspectNextFollowDate(now = new Date()) {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  day.setDate(day.getDate() - 1);
  return localIsoDate(day);
}

/**
 * 只接受 YYYY-MM-DD。不合法，或早于今天减 1 天，整批不能写。
 * 合法日期收成已有 nextFollowAt 用的墙上时钟，时刻固定为 23:59。
 */
export function normalizeProspectNextFollowDate(
  value: string,
  now = new Date()
): { ok: true; date: string; nextFollowAt: string } | { ok: false; message: string } {
  const text = String(value ?? "").trim();
  if (!text) return { ok: false, message: "请填写下次跟进日期" };
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return { ok: false, message: "下次跟进日期不正确" };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) {
    return { ok: false, message: "下次跟进日期不正确" };
  }
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (date < earliestProspectNextFollowDate(now)) {
    return { ok: false, message: "下次跟进日期不能早于昨天" };
  }
  return { ok: true, date, nextFollowAt: `${date} ${PROSPECT_NEXT_FOLLOW_UP_CLOCK}` };
}

type NextFollowStore = {
  leads: Lead[];
};

/** 只改候选已有的 nextFollowAt。同一归属人的线索同步同一字段，不新建待办，不记跟进。 */
export function applyProspectNextFollowUpValue(
  store: NextFollowStore,
  candidate: WebsiteOpportunity,
  nextFollowAt: string
) {
  candidate.nextFollowAt = nextFollowAt;
  if (!candidate.leadId) return;
  const lead = store.leads.find((item) =>
    item.id === candidate.leadId
    && item.ownerId === candidate.ownerId
    && item.teamId === candidate.teamId
    && !item.deletedAt
  );
  if (lead) lead.nextFollowAt = nextFollowAt;
}
