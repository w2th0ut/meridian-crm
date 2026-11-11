import { canSeeOwner, hasIamPermission, hasIamScope, isPlatformIdentity, type IamActor } from "./auth.js";
import { isPublicCustomer } from "./customer-public-pool.js";
import { outboundInstant, tenantTimeZoneFor, zonedDateKey } from "./outbound-call.js";
import {
  callLocalDate,
  isCallOutcome,
  outboundCallRecordVisible,
  splitAgentIds,
  OUTBOUND_CALL_RECORD_PERMISSION
} from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type { OutboundCallRecord, SessionUser } from "./types.js";

/**
 * 工作台现有名单上只读的今日已拨次数、最近一次通话结果和最近一次通话开始时间。
 * 只读 outbound_call_records。不写审计，不建表，不加列，不改外呼门禁。
 * 今日按租户时区，用话单 startTimeRaw 的当地日。解析不出的不计入今日。
 * 最近一次的比较与 §61 相同。结果只认已有五项，否则写「未标注」。
 * 开始时间只格式化这一通的 startTimeRaw，按租户时区写成 YYYY-MM-DD HH:mm。
 * 没有看得到的通话，或开始时间解析不了，写成「—」，不用 createdAt 代替。
 * 看不见的通话不参与。对象本身读不到时不带这三格，名单行仍按原来的规则。
 */

export const QUEUE_CALL_GLANCE_UNLABELED = "未标注";
export const QUEUE_CALL_GLANCE_NO_TIME = "—";

const OBJECT_PERMISSION: Record<string, string> = {
  customer: "customer.read",
  lead: "lead.read",
  prospect: "prospect.read"
};

export interface QueueCallGlance {
  todayCallCount: number;
  lastCallOutcome: string;
  /** 最近一次看得到的通话的开始时间。没有或解析不了时是「—」。 */
  lastCallAt: string;
  /** 最近一次看得到的通话。没有时是空，不把看不见的记录 id 带出来。 */
  latestCallRecordId: string;
}

type GlanceRow = { targetType: string; targetId: string };

/** 去掉首尾空白后正好是五项之一，否则「未标注」。话单枚举不算。 */
export function queueCallOutcomeLabel(value: string) {
  const text = (value || "").trim();
  return isCallOutcome(text) ? text : QUEUE_CALL_GLANCE_UNLABELED;
}

/** 与 §61 callRecencyRank 相同：startTimeRaw 的正整数毫秒优先，否则 createdAt，再 updatedAt，再 id。 */
export function queueCallRecencyRank(record: Pick<OutboundCallRecord, "startTimeRaw" | "createdAt" | "updatedAt" | "id">) {
  const text = (record.startTimeRaw || "").trim();
  let start = 0;
  if (/^\d+$/.test(text)) {
    const value = Number(text);
    if (Number.isSafeInteger(value) && value > 0) start = value;
  }
  if (start === 0) {
    const created = Date.parse(record.createdAt || "");
    if (Number.isFinite(created)) start = created;
  }
  const updated = Date.parse(record.updatedAt || "");
  return { start, updated: Number.isFinite(updated) ? updated : 0, id: record.id || "" };
}

export function isMoreRecentQueueCall(
  candidate: Pick<OutboundCallRecord, "startTimeRaw" | "createdAt" | "updatedAt" | "id">,
  current: Pick<OutboundCallRecord, "startTimeRaw" | "createdAt" | "updatedAt" | "id">
) {
  const left = queueCallRecencyRank(candidate);
  const right = queueCallRecencyRank(current);
  if (left.start !== right.start) return left.start > right.start;
  if (left.updated !== right.updated) return left.updated > right.updated;
  return left.id > right.id;
}

/** startTimeRaw 只接受正整数毫秒。解析不了不用 createdAt 代替。 */
export function queueCallStartMs(startTimeRaw: string) {
  const text = (startTimeRaw || "").trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

/**
 * 话单开始时间在租户时区里的 YYYY-MM-DD HH:mm。
 * 与未接通待处理行上的时间格式相同。解析不了或时区无效时是空字符串。
 */
export function formatQueueCallStartedAt(startTimeRaw: string, timeZone: string) {
  const epoch = queueCallStartMs(startTimeRaw);
  if (epoch === null) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(epoch));
    const pick = (type: string) => parts.find((part) => part.type === type)?.value || "";
    let hour = pick("hour");
    if (hour === "24") hour = "00";
    if (!pick("year") || !pick("month") || !pick("day") || !hour || !pick("minute")) return "";
    return `${pick("year")}-${pick("month")}-${pick("day")} ${hour}:${pick("minute")}`;
  } catch {
    return "";
  }
}

const QUEUE_CALL_WALL_MINUTE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

/**
 * 把 §121 已经写出的 YYYY-MM-DD HH:mm 按租户时区还原到这一分钟的起点。
 * 「—」、解析不了、时区无效，都返回 null，不当成 0。
 */
export function parseQueueCallWallMinute(wall: string, timeZone: string): number | null {
  const text = (wall || "").trim();
  if (!QUEUE_CALL_WALL_MINUTE.test(text) || text === QUEUE_CALL_GLANCE_NO_TIME) return null;
  const asUtc = Date.parse(`${text.replace(" ", "T")}:00Z`);
  if (!Number.isFinite(asUtc)) return null;
  let guess = asUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const shown = formatQueueCallStartedAt(String(guess), timeZone);
    if (shown === text) return wallMinuteStart(guess, text, timeZone);
    if (!shown) return null;
    const shownUtc = Date.parse(`${shown.replace(" ", "T")}:00Z`);
    if (!Number.isFinite(shownUtc)) return null;
    guess += asUtc - shownUtc;
  }
  return formatQueueCallStartedAt(String(guess), timeZone) === text
    ? wallMinuteStart(guess, text, timeZone)
    : null;
}

function wallMinuteStart(seed: number, wall: string, timeZone: string) {
  if (formatQueueCallStartedAt(String(seed), timeZone) !== wall) return null;
  let best = seed;
  let lo = seed - 120_000;
  let hi = seed;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (formatQueueCallStartedAt(String(mid), timeZone) === wall) {
      best = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return best;
}

export function summarizeQueueCallGlance(input: {
  teamId: string;
  targetType: string;
  targetId: string;
  records: readonly OutboundCallRecord[];
  visible: (record: OutboundCallRecord) => boolean;
  timeZone: string;
  today: string;
}): QueueCallGlance {
  let latest: OutboundCallRecord | null = null;
  let todayCallCount = 0;
  for (const record of input.records) {
    if (record.teamId !== input.teamId) continue;
    if (record.targetType !== input.targetType || record.targetId !== input.targetId) continue;
    if (!input.visible(record)) continue;
    const local = callLocalDate(record.startTimeRaw || "", input.timeZone);
    if (local && local === input.today) todayCallCount += 1;
    if (!latest || isMoreRecentQueueCall(record, latest)) latest = record;
  }
  const started = latest ? formatQueueCallStartedAt(latest.startTimeRaw || "", input.timeZone) : "";
  return {
    todayCallCount,
    lastCallOutcome: latest ? queueCallOutcomeLabel(latest.callOutcome || "") : QUEUE_CALL_GLANCE_UNLABELED,
    lastCallAt: started || QUEUE_CALL_GLANCE_NO_TIME,
    latestCallRecordId: latest?.id || ""
  };
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
      ? (store.users || []).filter((item) => item.teamId === user.teamId && item.status === "active").map((item) => item.id)
      : scopes.includes("self") ? [user.id] : []
  };
}

function objectReadable(store: CrmStore, user: SessionUser, targetType: string, targetId: string) {
  if (targetType === "customer") {
    const customer = store.customers.find((item) => item.id === targetId && item.teamId === user.teamId);
    if (!customer) return false;
    if (isPublicCustomer(customer)) return !isPlatformIdentity(user);
    return canSeeOwner(user, customer.ownerId, customer.teamId);
  }
  if (targetType === "lead") {
    const lead = store.leads.find((item) => item.id === targetId && item.teamId === user.teamId && !item.deletedAt);
    if (!lead) return false;
    return canSeeOwner(user, lead.ownerId, lead.teamId);
  }
  if (targetType === "prospect") {
    const candidate = store.websiteOpportunities.find((item) => item.id === targetId && item.teamId === user.teamId);
    if (!candidate) return false;
    return canSeeOwner(user, candidate.ownerId, candidate.teamId);
  }
  return false;
}

async function permittedKeys(store: CrmStore, user: SessionUser, rows: readonly GlanceRow[]) {
  const allowed = new Set<string>();
  const types = ["customer", "lead", "prospect"] as const;
  for (const targetType of types) {
    const permission = OBJECT_PERMISSION[targetType];
    if (!permission || !hasIamPermission(user as IamActor, permission)) continue;
    if (!rows.some((row) => row.targetType === targetType)) continue;
    await assignReadScope(store, user, permission);
    for (const row of rows) {
      if (row.targetType !== targetType || !row.targetId) continue;
      if (objectReadable(store, user, targetType, row.targetId)) allowed.add(`${targetType}:${row.targetId}`);
    }
  }
  return allowed;
}

async function glanceAccess(store: CrmStore, user: SessionUser) {
  if (!hasIamPermission(user as IamActor, OUTBOUND_CALL_RECORD_PERMISSION)) return null;
  await assignReadScope(store, user, OUTBOUND_CALL_RECORD_PERMISSION);
  const tenantWide = user.iamDataScope?.tenantWide === true;
  const teamScope = tenantWide || hasIamScope(user, OUTBOUND_CALL_RECORD_PERMISSION, ["org_unit", "org_subtree", "tenant"]);
  const mappings = store.aliyunAgentMappings ?? [];
  const records = store.outboundCallRecords ?? [];
  const allowed = new Set<string>();
  if (!teamScope) {
    const own = mappings.find((item) => item.teamId === user.teamId && item.crmUserId === user.id);
    if (own?.cccUserId) allowed.add(own.cccUserId);
  } else if (tenantWide) {
    for (const item of mappings) {
      if (item.teamId === user.teamId && item.cccUserId) allowed.add(item.cccUserId);
    }
    for (const record of records) {
      if (record.teamId !== user.teamId) continue;
      for (const id of splitAgentIds(record.agentIds)) allowed.add(id);
    }
  } else {
    const owners = new Set(user.iamDataScope?.ownerIds || []);
    for (const item of mappings) {
      if (item.teamId === user.teamId && owners.has(item.crmUserId) && item.cccUserId) allowed.add(item.cccUserId);
    }
  }
  const timeZone = await tenantTimeZoneFor(store, user.teamId);
  return { tenantWide, allowed, timeZone };
}

function withoutGlance<T extends GlanceRow>(row: T): T {
  const copy = { ...row } as T & Partial<QueueCallGlance>;
  delete copy.todayCallCount;
  delete copy.lastCallOutcome;
  delete copy.lastCallAt;
  return copy;
}

/**
 * 给已经列出来的行补上只读三格。读不到对象或读不到通话记录时不补。
 * 不调用 persist，不写审计。
 */
export async function attachQueueCallGlance<T extends GlanceRow>(
  store: CrmStore,
  user: SessionUser,
  rows: readonly T[],
  now = outboundInstant()
): Promise<T[]> {
  if (!rows.length || !user?.id || !user.teamId) return rows.map((row) => withoutGlance(row));
  const saved = user.iamDataScope;
  try {
    const access = await glanceAccess(store, user);
    if (!access) return rows.map((row) => withoutGlance(row));
    const permitted = await permittedKeys(store, user, rows);
    const today = zonedDateKey(now, access.timeZone);
    const records = store.outboundCallRecords ?? [];
    const visible = (record: OutboundCallRecord) => outboundCallRecordVisible(record, user.teamId, access);
    const cache = new Map<string, QueueCallGlance | null>();
    return rows.map((row) => {
      const key = `${row.targetType}:${row.targetId}`;
      if (!cache.has(key)) {
        cache.set(key, permitted.has(key)
          ? summarizeQueueCallGlance({
            teamId: user.teamId,
            targetType: row.targetType,
            targetId: row.targetId,
            records,
            visible,
            timeZone: access.timeZone,
            today
          })
          : null);
      }
      const glance = cache.get(key);
      const copy = withoutGlance(row);
      if (!glance) return copy;
      const withGlance = {
        ...copy,
        todayCallCount: glance.todayCallCount,
        lastCallOutcome: glance.lastCallOutcome,
        lastCallAt: glance.lastCallAt
      };
      const existingCallId = String((copy as { callRecordId?: string }).callRecordId || "").trim();
      if (existingCallId || !glance.latestCallRecordId) return withGlance;
      return { ...withGlance, callRecordId: glance.latestCallRecordId };
    });
  } finally {
    user.iamDataScope = saved;
  }
}
