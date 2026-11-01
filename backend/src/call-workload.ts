import { randomUUID } from "node:crypto";
import { hasSuccessfulCallWrapup, callEndedAtMs } from "./call-wrapup-queue.js";
import { outboundInstant, zonedDateKey } from "./outbound-call.js";
import {
  callLocalDate,
  isEstablishedCall,
  outboundCallRecordVisible,
  parseCallDurationSeconds,
  recordHasCallNote,
  resolveOutboundCallRecordAccess,
  splitAgentIds,
  type OutboundCallRecordAccess
} from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type {
  AliyunAgentMapping,
  CallWorkloadViewAudit,
  CallWrapupAudit,
  CallWrapupEditAudit,
  CallWrapupSkip,
  OutboundCallAudit,
  OutboundCallRecord,
  SessionUser
} from "./types.js";

/**
 * 今日通话负荷。坐席看自己的今日，主管及以上看权限范围内的团队。
 * 今日拨打只数人工点击后写下的通话记录。小结完成、待处理、无需小结只看 call_wrapup_* 表。
 * 改正只数成功的 call_wrapup_edit_audits。通话时长只加已经记下的整数秒。
 * 没有记下的时长不写成 0。不另造接通率或评分。
 * 主管查看团队时写入 call_workload_view_audits。不拨号，不发信，不调用外部接口。
 */

export const CALL_WORKLOAD_TIME_ZONE = "Asia/Shanghai";
export const UNASSIGNED_AGENT_ID = "none";

const AGENT_PATTERN = /^[A-Za-z0-9_@.:-]{1,128}$/;

export interface CallWorkloadQuery {
  scope: "self" | "team";
  agentId: string | null;
}

export interface CallWorkloadRow {
  agentId: string;
  label: string;
  callsMade: number;
  wrapupCompleted: number;
  wrapupPending: number;
  wrapupSkipped: number;
  correctionsMade: number;
  talkTimeSeconds: number | null;
}

export function canViewTeamCallWorkload(user: { role?: string } | undefined) {
  return user?.role === "manager" || user?.role === "admin" || user?.role === "super_admin";
}

function oneQuery(value: unknown) {
  if (Array.isArray(value)) return null;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value.trim() : null;
}

export function parseCallWorkloadQuery(query: Record<string, unknown>): CallWorkloadQuery | null {
  const allowed = new Set(["scope", "agentId"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) return null;
  if (Object.values(query).some((value) => Array.isArray(value))) return null;
  const scopeRaw = oneQuery(query.scope);
  const agentRaw = oneQuery(query.agentId);
  if (scopeRaw === null || agentRaw === null) return null;
  if (scopeRaw !== "self" && scopeRaw !== "team") return null;
  const agentId = agentRaw || null;
  if (scopeRaw === "self" && agentId) return null;
  if (agentId && agentId !== UNASSIGNED_AGENT_ID && !AGENT_PATTERN.test(agentId)) return null;
  return { scope: scopeRaw, agentId };
}

export function callWorkloadFiltersText(query: CallWorkloadQuery) {
  return JSON.stringify({
    scope: query.scope,
    agentId: query.agentId || ""
  });
}

/** 人工点击留下的通话记录：同一租户里有一条结果为 allowed 的外呼审计。拒绝的点击和没有审计的记录都不算。 */
export function isHumanClickedCallRecord(record: OutboundCallRecord, audits: OutboundCallAudit[]) {
  const auditId = (record.outboundCallAuditId || "").trim();
  if (!auditId) return false;
  return audits.some((item) => item.id === auditId && item.teamId === record.teamId && item.result === "allowed");
}

function localDay(at: string, timeZone: string) {
  const text = (at || "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  try {
    return zonedDateKey(parsed, timeZone);
  } catch {
    return null;
  }
}

function agentLabel(mapping: AliyunAgentMapping | undefined, id: string) {
  return mapping?.displayName || mapping?.loginName || id;
}

interface Bucket {
  callsMade: number;
  wrapupCompleted: number;
  wrapupPending: number;
  wrapupSkipped: number;
  correctionsMade: number;
  talkSamples: number;
  talkSum: number;
}

function emptyBucket(): Bucket {
  return {
    callsMade: 0,
    wrapupCompleted: 0,
    wrapupPending: 0,
    wrapupSkipped: 0,
    correctionsMade: 0,
    talkSamples: 0,
    talkSum: 0
  };
}

function activeSkip(skips: CallWrapupSkip[], teamId: string, callRecordId: string) {
  return skips.some((item) => item.teamId === teamId && item.callRecordId === callRecordId && item.active);
}

function classifyWrapup(
  record: OutboundCallRecord,
  wrapups: CallWrapupAudit[],
  skips: CallWrapupSkip[]
): "completed" | "skipped" | "pending" | "" {
  if (hasSuccessfulCallWrapup(wrapups, record.teamId, record.id)) return "completed";
  if (activeSkip(skips, record.teamId, record.id)) return "skipped";
  if (callEndedAtMs(record.releaseTimeRaw) === null) return "";
  if (recordHasCallNote(record)) return "";
  return "pending";
}

function addTalk(bucket: Bucket, record: OutboundCallRecord) {
  if (!isEstablishedCall(record.establishedTimeRaw)) return;
  const seconds = parseCallDurationSeconds(record.callDurationRaw);
  if (seconds === null) return;
  bucket.talkSamples += 1;
  bucket.talkSum += seconds;
}

function toRow(agentId: string, label: string, bucket: Bucket): CallWorkloadRow {
  return {
    agentId,
    label,
    callsMade: bucket.callsMade,
    wrapupCompleted: bucket.wrapupCompleted,
    wrapupPending: bucket.wrapupPending,
    wrapupSkipped: bucket.wrapupSkipped,
    correctionsMade: bucket.correctionsMade,
    talkTimeSeconds: bucket.talkSamples === 0 ? null : bucket.talkSum
  };
}

function rowHasSignal(row: CallWorkloadRow) {
  return row.callsMade > 0
    || row.wrapupCompleted > 0
    || row.wrapupPending > 0
    || row.wrapupSkipped > 0
    || row.correctionsMade > 0
    || row.talkTimeSeconds !== null;
}

export function buildCallWorkload(input: {
  teamId: string;
  today: string;
  timeZone: string;
  scope: "self" | "team";
  agentId: string | null;
  ownAgentIds: string[];
  roster: Map<string, string>;
  allowed: ReadonlySet<string>;
  tenantWide: boolean;
  records: OutboundCallRecord[];
  callAudits: OutboundCallAudit[];
  wrapups: CallWrapupAudit[];
  skips: CallWrapupSkip[];
  edits: CallWrapupEditAudit[];
  visible: (record: OutboundCallRecord) => boolean;
}): { rows: CallWorkloadRow[]; knownAgentIds: Set<string> } {
  const buckets = new Map<string, Bucket>();
  const ensure = (agentId: string) => {
    let bucket = buckets.get(agentId);
    if (!bucket) {
      bucket = emptyBucket();
      buckets.set(agentId, bucket);
    }
    return bucket;
  };
  for (const agentId of input.scope === "self" ? input.ownAgentIds : input.roster.keys()) {
    ensure(agentId);
  }
  const acceptAgent = (agentId: string) => {
    if (input.scope === "self") return input.ownAgentIds.includes(agentId);
    if (input.agentId && input.agentId !== UNASSIGNED_AGENT_ID) return agentId === input.agentId;
    if (input.tenantWide) return true;
    return input.allowed.has(agentId);
  };
  const acceptUnassigned = () => {
    if (input.scope !== "team") return false;
    return !input.agentId || input.agentId === UNASSIGNED_AGENT_ID;
  };

  for (const record of input.records) {
    if (record.teamId !== input.teamId || !input.visible(record)) continue;
    if (!isHumanClickedCallRecord(record, input.callAudits)) continue;
    if (callLocalDate(record.startTimeRaw, input.timeZone) !== input.today) continue;
    const agents = [...new Set(splitAgentIds(record.agentIds))];
    const targets = agents.length ? agents.filter((id) => acceptAgent(id)) : [];
    const includeUnassigned = !agents.length && acceptUnassigned();
    if (!targets.length && !includeUnassigned) continue;
    const kind = classifyWrapup(record, input.wrapups, input.skips);
    const apply = (bucket: Bucket) => {
      bucket.callsMade += 1;
      if (kind === "completed") bucket.wrapupCompleted += 1;
      else if (kind === "skipped") bucket.wrapupSkipped += 1;
      else if (kind === "pending") bucket.wrapupPending += 1;
      addTalk(bucket, record);
    };
    for (const agentId of targets) apply(ensure(agentId));
    if (includeUnassigned) apply(ensure(UNASSIGNED_AGENT_ID));
  }

  for (const edit of input.edits) {
    if (edit.teamId !== input.teamId || edit.result !== "updated") continue;
    if (localDay(edit.at, input.timeZone) !== input.today) continue;
    const record = input.records.find((item) => item.teamId === input.teamId && item.id === edit.callRecordId);
    if (!record || !input.visible(record)) continue;
    const agents = [...new Set(splitAgentIds(record.agentIds))];
    const targets = agents.length ? agents.filter((id) => acceptAgent(id)) : [];
    const includeUnassigned = !agents.length && acceptUnassigned();
    for (const agentId of targets) ensure(agentId).correctionsMade += 1;
    if (includeUnassigned) ensure(UNASSIGNED_AGENT_ID).correctionsMade += 1;
  }

  const rows: CallWorkloadRow[] = [];
  const ids = input.scope === "self"
    ? input.ownAgentIds
    : [...input.roster.keys()].filter((id) => !input.agentId || input.agentId === id);
  const emitted = new Set<string>();
  for (const agentId of ids) {
    if (input.agentId === UNASSIGNED_AGENT_ID) continue;
    emitted.add(agentId);
    rows.push(toRow(agentId, input.roster.get(agentId) || agentId, buckets.get(agentId) || emptyBucket()));
  }
  for (const [agentId, bucket] of buckets) {
    if (agentId === UNASSIGNED_AGENT_ID || emitted.has(agentId)) continue;
    if (input.scope === "self") continue;
    if (input.agentId && input.agentId !== agentId) continue;
    const row = toRow(agentId, input.roster.get(agentId) || agentId, bucket);
    if (rowHasSignal(row)) rows.push(row);
  }
  const unassigned = buckets.get(UNASSIGNED_AGENT_ID);
  if (unassigned && acceptUnassigned()) {
    const row = toRow(UNASSIGNED_AGENT_ID, "未分配坐席", unassigned);
    if (rowHasSignal(row)) rows.push(row);
  }
  rows.sort((left, right) => {
    if (left.agentId === UNASSIGNED_AGENT_ID) return 1;
    if (right.agentId === UNASSIGNED_AGENT_ID) return -1;
    return left.label.localeCompare(right.label, "zh") || left.agentId.localeCompare(right.agentId);
  });
  return { rows, knownAgentIds: new Set(input.roster.keys()) };
}

function reject(status: number, reason: string, message: string) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function rosterFor(
  store: CrmStore,
  teamId: string,
  access: OutboundCallRecordAccess
) {
  const roster = new Map<string, string>();
  const mappings = store.aliyunAgentMappings.filter((item) => item.teamId === teamId && item.cccUserId);
  const labels = new Map(mappings.map((item) => [item.cccUserId, agentLabel(item, item.cccUserId)]));
  for (const mapping of mappings) {
    if (!access.tenantWide && !access.allowed.has(mapping.cccUserId)) continue;
    if (!roster.has(mapping.cccUserId)) roster.set(mapping.cccUserId, labels.get(mapping.cccUserId) || mapping.cccUserId);
  }
  return roster;
}

function ownAgentIds(store: CrmStore, user: SessionUser) {
  const ids: string[] = [];
  for (const mapping of store.aliyunAgentMappings) {
    if (mapping.teamId !== user.teamId || mapping.crmUserId !== user.id || !mapping.cccUserId) continue;
    if (!ids.includes(mapping.cccUserId)) ids.push(mapping.cccUserId);
  }
  return ids;
}

async function writeAudit(store: CrmStore, input: Omit<CallWorkloadViewAudit, "id" | "at">) {
  const audit: CallWorkloadViewAudit = {
    id: `cwva_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.callWorkloadViewAudits.unshift(audit);
  await store.persist();
  return audit;
}

export async function listCallWorkload(
  store: CrmStore,
  user: SessionUser | undefined,
  query: Record<string, unknown>,
  now = outboundInstant()
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallWorkloadQuery(query);
  if (!parsed) return reject(400, "invalid_request", "今日通话负荷的范围不正确");
  const teamView = parsed.scope === "team";
  if (teamView && !canViewTeamCallWorkload(user)) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "read",
      scope: "team",
      agentId: (parsed.agentId || "").slice(0, 128),
      rowCount: 0,
      result: "rejected",
      reason: "forbidden"
    });
    return reject(403, "forbidden", "只有主管和管理员可以查看团队今日通话负荷");
  }
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  if (!resolved.ok) {
    if (teamView) {
      await writeAudit(store, {
        teamId: user.teamId,
        actorId: user.id,
        action: "read",
        scope: "team",
        agentId: (parsed.agentId || "").slice(0, 128),
        rowCount: 0,
        result: "rejected",
        reason: "forbidden"
      });
    }
    return { status: resolved.status, body: resolved.body };
  }
  const roster = rosterFor(store, user.teamId, resolved.access);
  const own = ownAgentIds(store, user);
  const selfLabels = new Map(own.map((id) => {
    const mapping = store.aliyunAgentMappings.find((item) => item.teamId === user.teamId && item.cccUserId === id);
    return [id, roster.get(id) || agentLabel(mapping, id)] as const;
  }));
  const agentKnown = (agentId: string) => {
    if (roster.has(agentId)) return true;
    return store.outboundCallRecords.some((record) =>
      record.teamId === user.teamId
      && outboundCallRecordVisible(record, user.teamId, resolved.access)
      && splitAgentIds(record.agentIds).includes(agentId)
      && (resolved.access.tenantWide || resolved.access.allowed.has(agentId))
    );
  };
  if (teamView && parsed.agentId && parsed.agentId !== UNASSIGNED_AGENT_ID && !agentKnown(parsed.agentId)) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "read",
      scope: "team",
      agentId: parsed.agentId.slice(0, 128),
      rowCount: 0,
      result: "rejected",
      reason: "forbidden"
    });
    return reject(403, "forbidden", "没有查看这位坐席今日通话负荷的权限");
  }
  const today = zonedDateKey(now, CALL_WORKLOAD_TIME_ZONE);
  const built = buildCallWorkload({
    teamId: user.teamId,
    today,
    timeZone: CALL_WORKLOAD_TIME_ZONE,
    scope: parsed.scope,
    agentId: teamView ? parsed.agentId : null,
    ownAgentIds: own,
    roster: parsed.scope === "self" ? selfLabels : roster,
    allowed: resolved.access.allowed,
    tenantWide: resolved.access.tenantWide,
    records: store.outboundCallRecords,
    callAudits: store.outboundCallAudits,
    wrapups: store.callWrapupAudits,
    skips: store.callWrapupSkips,
    edits: store.callWrapupEditAudits,
    visible: (record) => outboundCallRecordVisible(record, user.teamId, resolved.access)
  });
  if (teamView) {
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "read",
      scope: "team",
      agentId: parsed.agentId || "",
      rowCount: built.rows.length,
      result: "read",
      reason: ""
    });
  }
  return {
    status: 200,
    body: {
      scope: parsed.scope,
      timeZone: CALL_WORKLOAD_TIME_ZONE,
      today,
      unmapped: parsed.scope === "self" && own.length === 0,
      metrics: {
        callsMade: true,
        wrapupCompleted: true,
        wrapupPending: true,
        wrapupSkipped: true,
        correctionsMade: true,
        talkTimeSeconds: true
      },
      criteria: {
        callsBy: "humanClickedCallRecord",
        callAuditResult: "allowed",
        dateField: "startTimeRaw",
        correctionDateField: "at",
        talkTimeField: "callDurationRaw",
        talkTimeUnit: "seconds",
        establishedBy: "establishedTimeRaw"
      },
      rows: built.rows
    }
  };
}
