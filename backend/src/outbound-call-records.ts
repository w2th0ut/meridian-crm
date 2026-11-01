import { hasIamPermission, hasIamScope, type IamActor } from "./auth.js";
import { callbackScheduleView } from "./callback-schedule-state.js";
import { callPhoneValidityFields } from "./phone-validity-state.js";
import { outboundInstant, tenantTimeZoneFor, zonedDateKey } from "./outbound-call.js";
import type { CrmStore } from "./store.js";
import type { AliyunAgentMapping, OutboundCallRecord, SessionUser } from "./types.js";

/**
 * 外呼通话记录列表。四项统计仍只读，不因标注结果筛选改掉。
 * 标注走单独接口，只改本条的通话结果和备注，不改话单，不拨号，不请求阿里云。
 * 未接通记录的「生成下次跟进」走单独接口，不在这里改话单。
 *
 * 接通：establishedTimeRaw 去掉空白后非空。单通详情页写未建立时该字段为空。
 * 不把 ContactDisposition 的 Success 单独当成接通。dispositionCode 与话单是否一一对应见接入方案第 9.4 节。
 * 时长：接通通话的 callDurationRaw。单通详情页写 CallDuration 是整数秒。
 * 列表接口的口径不一致，见第 9.3 节。原文不是非负整数的不计入平均，也不当成 0。
 * 日期：startTimeRaw 按 Unix 毫秒切成租户当地日。起算点见第 9.3 节，这里不改原文。
 * 标注结果是人工枚举，不参与接通统计。
 */
export const OUTBOUND_CALL_RECORD_PERMISSION = "communication.read";

/** 人工标注的通话结果。只接受这五项，不把话单枚举算进来。 */
export const CALL_OUTCOMES = ["有意向", "需回访", "无意向", "号码错误", "其他"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
export const CALL_OUTCOME_NOTE_MAX = 200;

export function isCallOutcome(value: string): value is CallOutcome {
  return (CALL_OUTCOMES as readonly string[]).includes(value);
}

export function callOutcomeNoteLength(note: string) {
  return Array.from(note).length;
}

export function countCallOutcomes(records: Array<{ callOutcome?: string }>): Record<CallOutcome, number> {
  const counts: Record<CallOutcome, number> = {
    "有意向": 0,
    "需回访": 0,
    "无意向": 0,
    "号码错误": 0,
    "其他": 0
  };
  for (const record of records) {
    const value = record.callOutcome || "";
    if (isCallOutcome(value)) counts[value] += 1;
  }
  return counts;
}

export function recordsMatchingOutcome<T extends { callOutcome?: string }>(records: T[], outcome: string | null) {
  if (!outcome) return records;
  return records.filter((record) => (record.callOutcome || "") === outcome);
}

export function recordHasCallNote(record: { callNote?: string; callNoteTags?: string }) {
  return Boolean((record.callNote || "").trim() || (record.callNoteTags || "").trim());
}

export function recordsMatchingNote<T extends { callNote?: string; callNoteTags?: string }>(
  records: T[],
  note: CallNotePresence | null
) {
  if (!note) return records;
  return records.filter((record) => recordHasCallNote(record) === (note === "has"));
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AGENT_PATTERN = /^[A-Za-z0-9_@.:-]{1,128}$/;

export interface OutboundCallRecordStats {
  totalCalls: number;
  connectedCalls: number;
  connectRate: number | null;
  averageConnectedDurationSeconds: number | null;
}

export type CallNotePresence = "has" | "none";

export interface OutboundCallRecordQuery {
  agentId: string | null;
  from: string | null;
  to: string | null;
  outcome: CallOutcome | null;
  note: CallNotePresence | null;
}

export function splitAgentIds(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

/** 话单原文能当成非负整数秒时才返回。不接受小数，也不把空值当成 0。 */
export function parseCallDurationSeconds(raw: string) {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

export function isEstablishedCall(establishedTimeRaw: string) {
  return establishedTimeRaw.trim().length > 0;
}

/** startTimeRaw 只接受正整数毫秒。解析不了就没有当地日，不用入库时间代替。 */
export function callLocalDate(startTimeRaw: string, timeZone: string) {
  const text = startTimeRaw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  try {
    return zonedDateKey(at, timeZone);
  } catch {
    return null;
  }
}

export function recordInDateRange(localDate: string | null, from: string | null, to: string | null) {
  if (!from && !to) return true;
  if (!localDate) return false;
  if (from && localDate < from) return false;
  if (to && localDate > to) return false;
  return true;
}

export function summarizeOutboundCallRecords(
  records: Array<Pick<OutboundCallRecord, "establishedTimeRaw" | "callDurationRaw">>
): OutboundCallRecordStats & { empty: boolean } {
  if (!records.length) {
    return {
      empty: true,
      totalCalls: 0,
      connectedCalls: 0,
      connectRate: null,
      averageConnectedDurationSeconds: null
    };
  }
  let connectedCalls = 0;
  let durationCount = 0;
  let durationSum = 0;
  for (const record of records) {
    if (!isEstablishedCall(record.establishedTimeRaw)) continue;
    connectedCalls += 1;
    const seconds = parseCallDurationSeconds(record.callDurationRaw);
    if (seconds === null) continue;
    durationCount += 1;
    durationSum += seconds;
  }
  return {
    empty: false,
    totalCalls: records.length,
    connectedCalls,
    connectRate: connectedCalls / records.length,
    averageConnectedDurationSeconds: durationCount === 0 ? null : durationSum / durationCount
  };
}

export function selectOutboundCallRecords(input: {
  records: OutboundCallRecord[];
  teamId: string;
  teamWide: boolean;
  agentIds: ReadonlySet<string>;
  agentId: string | null;
  from: string | null;
  to: string | null;
  timeZone: string;
}) {
  return input.records.filter((record) => {
    if (record.teamId !== input.teamId) return false;
    const agents = splitAgentIds(record.agentIds);
    if (input.agentId) {
      if (!agents.includes(input.agentId)) return false;
    } else if (!input.teamWide && !agents.some((id) => input.agentIds.has(id))) {
      return false;
    }
    return recordInDateRange(callLocalDate(record.startTimeRaw, input.timeZone), input.from, input.to);
  });
}

function validDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function oneQuery(value: unknown) {
  if (Array.isArray(value)) return null;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value.trim() : null;
}

export function parseOutboundCallRecordQuery(query: Record<string, unknown>): OutboundCallRecordQuery | null {
  const agentRaw = oneQuery(query.agentId);
  const fromRaw = oneQuery(query.from);
  const toRaw = oneQuery(query.to);
  const outcomeRaw = oneQuery(query.outcome);
  const noteRaw = oneQuery(query.note);
  if (agentRaw === null || fromRaw === null || toRaw === null || outcomeRaw === null || noteRaw === null) return null;
  const agentId = agentRaw || null;
  const from = fromRaw || null;
  const to = toRaw || null;
  if (agentId && !AGENT_PATTERN.test(agentId)) return null;
  if (from && !validDate(from)) return null;
  if (to && !validDate(to)) return null;
  if (from && to && from > to) return null;
  let outcome: CallOutcome | null = null;
  if (outcomeRaw) {
    if (!isCallOutcome(outcomeRaw)) return null;
    outcome = outcomeRaw;
  }
  let note: CallNotePresence | null = null;
  if (noteRaw) {
    if (noteRaw !== "has" && noteRaw !== "none") return null;
    note = noteRaw;
  }
  return { agentId, from, to, outcome, note };
}

async function ensureReadScope(store: CrmStore, user: SessionUser) {
  if (user.iamDataScope?.permissionCode === OUTBOUND_CALL_RECORD_PERMISSION) return;
  if (store.resolveIamDataScope) {
    user.iamDataScope = {
      permissionCode: OUTBOUND_CALL_RECORD_PERMISSION,
      ...await store.resolveIamDataScope(user, OUTBOUND_CALL_RECORD_PERMISSION)
    };
    return;
  }
  const scopes = user.iamPermissions?.[OUTBOUND_CALL_RECORD_PERMISSION] || [];
  const organizationWide = scopes.includes("org_unit") || scopes.includes("org_subtree");
  user.iamDataScope = {
    permissionCode: OUTBOUND_CALL_RECORD_PERMISSION,
    tenantWide: scopes.includes("tenant"),
    ownerIds: organizationWide
      ? store.users.filter((item) => item.teamId === user.teamId && item.status === "active").map((item) => item.id)
      : scopes.includes("self") ? [user.id] : []
  };
}

function agentLabel(mapping: AliyunAgentMapping | undefined, cccUserId: string) {
  return mapping?.displayName || mapping?.loginName || cccUserId;
}

export function presentOutboundCallRecord(record: OutboundCallRecord, timeZone: string, labels: Map<string, string>) {
  const agentIds = splitAgentIds(record.agentIds);
  return {
    id: record.id,
    contactId: record.contactId,
    maskedNumber: record.maskedNumber,
    contactDisposition: record.contactDisposition,
    established: isEstablishedCall(record.establishedTimeRaw),
    callDurationRaw: record.callDurationRaw,
    agentIds,
    agentLabel: agentIds.map((id) => labels.get(id) || id).join("、"),
    localDate: callLocalDate(record.startTimeRaw, timeZone),
    targetType: record.targetType,
    targetId: record.targetId,
    callOutcome: record.callOutcome || "",
    callOutcomeNote: record.callOutcomeNote || "",
    callNote: record.callNote || "",
    callNoteTags: (record.callNoteTags || "").split(",").map((item) => item.trim()).filter(Boolean),
    callNoteUpdatedAt: record.callNoteUpdatedAt || ""
  };
}

export interface OutboundCallRecordAccess {
  tenantWide: boolean;
  teamScope: boolean;
  allowed: Set<string>;
  timeZone: string;
  labels: Map<string, string>;
}

/** 和列表相同的可见范围。tenantWide 为真时，没有坐席 ID 的本租户记录也可见。 */
export function outboundCallRecordVisible(
  record: OutboundCallRecord,
  teamId: string,
  access: Pick<OutboundCallRecordAccess, "tenantWide" | "allowed">
) {
  if (record.teamId !== teamId) return false;
  if (access.tenantWide) return true;
  return splitAgentIds(record.agentIds).some((id) => access.allowed.has(id));
}

export async function resolveOutboundCallRecordAccess(
  store: CrmStore,
  user: SessionUser
): Promise<{ ok: false; status: number; body: Record<string, unknown> } | { ok: true; access: OutboundCallRecordAccess }> {
  if (!hasIamPermission(user as IamActor, OUTBOUND_CALL_RECORD_PERMISSION)) {
    return {
      ok: false,
      status: 403,
      body: { message: "当前账号没有执行该业务操作的权限", permissionCode: OUTBOUND_CALL_RECORD_PERMISSION }
    };
  }
  await ensureReadScope(store, user);
  const tenantWide = user.iamDataScope?.tenantWide === true;
  const teamScope = tenantWide || hasIamScope(user, OUTBOUND_CALL_RECORD_PERMISSION, ["org_unit", "org_subtree", "tenant"]);
  const mappings = store.aliyunAgentMappings.filter((item) => item.teamId === user.teamId);
  const labels = new Map(mappings.map((item) => [item.cccUserId, agentLabel(item, item.cccUserId)]));
  const allowed = new Set<string>();
  if (!teamScope) {
    const own = mappings.find((item) => item.crmUserId === user.id);
    if (own) allowed.add(own.cccUserId);
  } else if (tenantWide) {
    for (const item of mappings) allowed.add(item.cccUserId);
    for (const record of store.outboundCallRecords) {
      if (record.teamId !== user.teamId) continue;
      for (const id of splitAgentIds(record.agentIds)) allowed.add(id);
    }
  } else {
    const owners = new Set(user.iamDataScope?.ownerIds || []);
    for (const item of mappings) {
      if (owners.has(item.crmUserId)) allowed.add(item.cccUserId);
    }
  }
  const timeZone = await tenantTimeZoneFor(store, user.teamId);
  return { ok: true, access: { tenantWide, teamScope, allowed, timeZone, labels } };
}

export async function listOutboundCallRecords(
  store: CrmStore,
  user: SessionUser | undefined,
  query: Record<string, unknown>
) {
  if (!user?.id || !user.teamId) {
    return { status: 401, body: { message: "未登录" } };
  }
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const parsed = parseOutboundCallRecordQuery(query);
  if (!parsed) {
    return { status: 400, body: { result: "rejected", reason: "invalid_request", message: "参数格式错误" } };
  }
  const access = resolved.access;
  if (parsed.agentId && !access.tenantWide && !access.allowed.has(parsed.agentId)) {
    return { status: 403, body: { result: "rejected", reason: "forbidden", message: "不能查看这个坐席的通话记录" } };
  }
  const selected = selectOutboundCallRecords({
    records: store.outboundCallRecords,
    teamId: user.teamId,
    teamWide: access.tenantWide,
    agentIds: access.allowed,
    agentId: parsed.agentId,
    from: parsed.from,
    to: parsed.to,
    timeZone: access.timeZone
  });
  const listed = recordsMatchingNote(recordsMatchingOutcome(selected, parsed.outcome), parsed.note);
  const summary = summarizeOutboundCallRecords(selected);
  const generated = new Set(
    store.outboundMissedFollowUps
      .filter((item) => item.teamId === user.teamId)
      .map((item) => item.callRecordId)
  );
  const today = zonedDateKey(outboundInstant(), access.timeZone);
  const records = listed
    .map((record) => ({
      ...presentOutboundCallRecord(record, access.timeZone, access.labels),
      followUpGenerated: generated.has(record.id),
      ...callPhoneValidityFields(store, record),
      ...callbackScheduleView(store, record.teamId, record.targetType, record.targetId, today)
    }))
    .sort((left, right) => {
      if (left.localDate && right.localDate && left.localDate !== right.localDate) {
        return left.localDate < right.localDate ? 1 : -1;
      }
      if (left.localDate && !right.localDate) return -1;
      if (!left.localDate && right.localDate) return 1;
      return left.id < right.id ? 1 : -1;
    });
  const agents = [...access.allowed].map((cccUserId) => ({
    cccUserId,
    label: access.labels.get(cccUserId) || cccUserId
  })).sort((left, right) => left.label.localeCompare(right.label, "zh") || left.cccUserId.localeCompare(right.cccUserId));
  return {
    status: 200,
    body: {
      scope: access.teamScope ? "team" as const : "self" as const,
      timeZone: access.timeZone,
      filters: parsed,
      agents,
      criteria: {
        connectedBy: "establishedTimeRaw",
        durationUnit: "seconds",
        durationField: "callDurationRaw",
        dateField: "startTimeRaw"
      },
      empty: summary.empty,
      outcomeCounts: summary.empty ? null : countCallOutcomes(selected),
      stats: summary.empty ? null : {
        totalCalls: summary.totalCalls,
        connectedCalls: summary.connectedCalls,
        connectRate: summary.connectRate,
        averageConnectedDurationSeconds: summary.averageConnectedDurationSeconds
      },
      records
    }
  };
}
