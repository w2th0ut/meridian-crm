import { randomUUID } from "node:crypto";
import { hasIamPermission, type IamActor } from "./auth.js";
import { outboundInstant, zonedDateKey } from "./outbound-call.js";
import {
  countCallOutcomes,
  resolveOutboundCallRecordAccess,
  selectOutboundCallRecords,
  summarizeOutboundCallRecords
} from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type { AgentCallTarget, AgentCallTargetAudit, AliyunAgentMapping, OutboundCallRecord, SessionUser } from "./types.js";

/**
 * 坐席每日外呼目标。只写本地目标和 agent_call_target_audits。
 * 进度复用通话记录统计：接通看 establishedTimeRaw，意向只数「有意向」。
 * 小结完成目标写在同一行的 wrapup_target，不另建表。
 * 今日按 Asia/Shanghai。不拨号，不发信，不推进序列，不改抑制。
 */

export const AGENT_CALL_TARGET_TIME_ZONE = "Asia/Shanghai";
export const AGENT_CALL_TARGET_MAX = 10000;
export const AGENT_CALL_TARGET_PERMISSION = "communication.read";

const AGENT_PATTERN = /^[A-Za-z0-9_@.:-]{1,128}$/;
const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes", "agents", "agentIds"] as const;

export interface AgentCallTargetNumbers {
  dialTarget: number;
  connectedTarget: number;
  intentTarget: number | null;
  wrapupTarget?: number | null;
}

export interface AgentCallProgress {
  dialed: number;
  connected: number;
  intent: number;
}

export function canManageAgentCallTargets(user: { role?: string; teamId?: string } | undefined) {
  if (!user?.teamId || user.teamId === "all") return false;
  return user.role === "admin" || user.role === "super_admin";
}

/** 小结完成目标。主管、管理员和超级管理员可以改。拨打、接通、意向仍只给管理员。 */
export function canEditWrapupTarget(user: { role?: string; teamId?: string } | undefined) {
  if (!user?.teamId || user.teamId === "all") return false;
  return user.role === "manager" || user.role === "admin" || user.role === "super_admin";
}

/** 旧值和新值。没有目标时是空。没有意向数时第三段是空。没有小结目标时不写第四段。 */
export function formatAgentCallTargetValue(target: AgentCallTargetNumbers | null) {
  if (!target) return "";
  const head = `${target.dialTarget}|${target.connectedTarget}|${target.intentTarget === null || target.intentTarget === undefined ? "" : target.intentTarget}`;
  if (target.wrapupTarget === null || target.wrapupTarget === undefined) return head;
  return `${head}|${target.wrapupTarget}`;
}

export function sameAgentCallTarget(left: AgentCallTargetNumbers | null, right: AgentCallTargetNumbers | null) {
  return formatAgentCallTargetValue(left) === formatAgentCallTargetValue(right);
}

export function targetAction(previous: AgentCallTargetNumbers | null, next: AgentCallTargetNumbers | null): AgentCallTargetAudit["action"] {
  if (!next) return "clear";
  if (!previous) return "set";
  return "update";
}

function parseCount(value: unknown, required: boolean): number | null | "bad" {
  if (value === undefined || value === null) return required ? "bad" : null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > AGENT_CALL_TARGET_MAX) return "bad";
  return value;
}

export function parseAgentCallTargetWrite(body: unknown):
  | { ok: true; mode: "full"; agentId: string; dialTarget: number; connectedTarget: number; intentTarget: number | null; wrapupTarget: number | null | undefined }
  | { ok: true; mode: "wrapup"; agentId: string; wrapupTarget: number | null }
  | { ok: false; reason: "invalid_request" | "invalid_target" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return { ok: false, reason: "invalid_request" };
  const allowed = new Set(["agentId", "dialTarget", "connectedTarget", "intentTarget", "wrapupTarget"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return { ok: false, reason: "invalid_request" };
  if (typeof record.agentId !== "string" || !AGENT_PATTERN.test(record.agentId)) return { ok: false, reason: "invalid_request" };
  const wrapupOnly = !("dialTarget" in record) && !("connectedTarget" in record) && !("intentTarget" in record) && ("wrapupTarget" in record);
  if (wrapupOnly) {
    const wrapupTarget = parseCount(record.wrapupTarget, false);
    if (wrapupTarget === "bad") return { ok: false, reason: "invalid_target" };
    return { ok: true, mode: "wrapup", agentId: record.agentId, wrapupTarget };
  }
  const dialTarget = parseCount(record.dialTarget, true);
  const connectedTarget = parseCount(record.connectedTarget, true);
  const intentTarget = parseCount(record.intentTarget, false);
  if (dialTarget === "bad" || connectedTarget === "bad" || intentTarget === "bad") return { ok: false, reason: "invalid_target" };
  if (dialTarget === null || connectedTarget === null) return { ok: false, reason: "invalid_target" };
  if ("wrapupTarget" in record) {
    const wrapupTarget = parseCount(record.wrapupTarget, false);
    if (wrapupTarget === "bad") return { ok: false, reason: "invalid_target" };
    return { ok: true, mode: "full", agentId: record.agentId, dialTarget, connectedTarget, intentTarget, wrapupTarget };
  }
  return { ok: true, mode: "full", agentId: record.agentId, dialTarget, connectedTarget, intentTarget, wrapupTarget: undefined };
}

export function parseAgentCallTargetClear(body: unknown):
  | { ok: true; agentId: string }
  | { ok: false; reason: "invalid_request" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(record).some((key) => key !== "agentId")) return { ok: false, reason: "invalid_request" };
  if (typeof record.agentId !== "string" || !AGENT_PATTERN.test(record.agentId)) return { ok: false, reason: "invalid_request" };
  return { ok: true, agentId: record.agentId };
}

export function parseAgentCallTargetQuery(query: Record<string, unknown>):
  | { ok: true; agentId: string | null }
  | { ok: false; reason: "invalid_request" } {
  const raw = query.agentId;
  if (Array.isArray(raw)) return { ok: false, reason: "invalid_request" };
  if (raw === undefined || raw === null || raw === "") return { ok: true, agentId: null };
  if (typeof raw !== "string") return { ok: false, reason: "invalid_request" };
  const agentId = raw.trim();
  if (!agentId) return { ok: true, agentId: null };
  if (!AGENT_PATTERN.test(agentId)) return { ok: false, reason: "invalid_request" };
  return { ok: true, agentId };
}

/**
 * 今日已拨、接通、意向。接通沿用 isEstablishedCall。
 * 意向只数人工标注「有意向」。日期按 Asia/Shanghai，不用租户时区。
 */
export function todayCallProgress(
  records: OutboundCallRecord[],
  teamId: string,
  agentId: string,
  now = outboundInstant()
): AgentCallProgress & { today: string } {
  const today = zonedDateKey(now, AGENT_CALL_TARGET_TIME_ZONE);
  const selected = selectOutboundCallRecords({
    records,
    teamId,
    teamWide: true,
    agentIds: new Set([agentId]),
    agentId,
    from: today,
    to: today,
    timeZone: AGENT_CALL_TARGET_TIME_ZONE
  });
  const summary = summarizeOutboundCallRecords(selected);
  return {
    today,
    dialed: summary.totalCalls,
    connected: summary.connectedCalls,
    intent: countCallOutcomes(selected)["有意向"]
  };
}

function reject(reason: string, message: string, status = 400, extra: Record<string, unknown> = {}) {
  return { status, body: { result: "rejected" as const, reason, message, ...extra } };
}

function validationMessage(reason: string) {
  if (reason === "invalid_target") return `每日目标必须是 0 到 ${AGENT_CALL_TARGET_MAX} 的整数`;
  return "一次只能为一个坐席设置每日外呼目标";
}

function numbersOf(target: AgentCallTarget | null): AgentCallTargetNumbers | null {
  if (!target) return null;
  return {
    dialTarget: target.dialTarget,
    connectedTarget: target.connectedTarget,
    intentTarget: target.intentTarget,
    wrapupTarget: target.wrapupTarget ?? null
  };
}

function sameTeamTarget(store: CrmStore, teamId: string, agentId: string) {
  return store.agentCallTargets.find((item) => item.teamId === teamId && item.agentId === agentId) || null;
}

function sameTeamMapping(store: CrmStore, teamId: string, agentId: string) {
  return store.aliyunAgentMappings.find((item) => item.teamId === teamId && item.cccUserId === agentId) || null;
}

function agentLabel(mapping: AliyunAgentMapping | null, agentId: string) {
  return mapping?.displayName || mapping?.loginName || agentId;
}

function canRead(user: SessionUser) {
  return hasIamPermission(user as IamActor, AGENT_CALL_TARGET_PERMISSION);
}

async function writeAudit(store: CrmStore, input: Omit<AgentCallTargetAudit, "id" | "at">) {
  const audit: AgentCallTargetAudit = {
    id: `acta_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.agentCallTargetAudits.unshift(audit);
  await store.persist();
  return audit;
}

async function rejectWithAudit(
  store: CrmStore,
  user: SessionUser,
  input: {
    agentId: string;
    action: AgentCallTargetAudit["action"];
    previous: AgentCallTargetNumbers | null;
    next: AgentCallTargetNumbers | null;
    reason: string;
    message: string;
    status: number;
    extra?: Record<string, unknown>;
  }
) {
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    agentId: input.agentId.slice(0, 128),
    action: input.action,
    previousValue: formatAgentCallTargetValue(input.previous),
    nextValue: formatAgentCallTargetValue(input.next),
    result: "rejected",
    reason: input.reason
  });
  return reject(input.reason, input.message, input.status, input.extra);
}

function progressBody(store: CrmStore, teamId: string, agentId: string, displayName: string, mapped: boolean, now: Date) {
  const progress = todayCallProgress(store.outboundCallRecords, teamId, agentId, now);
  const target = numbersOf(sameTeamTarget(store, teamId, agentId));
  return {
    agentId,
    displayName,
    mapped,
    dialed: progress.dialed,
    connected: progress.connected,
    intent: progress.intent,
    dialTarget: target ? target.dialTarget : null,
    connectedTarget: target ? target.connectedTarget : null,
    intentTarget: target ? target.intentTarget : null,
    wrapupTarget: target ? (target.wrapupTarget ?? null) : null
  };
}

function visibleAgentIds(store: CrmStore, user: SessionUser, manage: boolean) {
  const mappings = store.aliyunAgentMappings.filter((item) => item.teamId === user.teamId);
  if (!manage) {
    return mappings
      .filter((item) => item.crmUserId === user.id)
      .map((item) => ({ agentId: item.cccUserId, displayName: agentLabel(item, item.cccUserId), mapped: true }));
  }
  const seen = new Map<string, { agentId: string; displayName: string; mapped: boolean }>();
  for (const item of mappings) {
    seen.set(item.cccUserId, { agentId: item.cccUserId, displayName: agentLabel(item, item.cccUserId), mapped: true });
  }
  for (const target of store.agentCallTargets) {
    if (target.teamId !== user.teamId || seen.has(target.agentId)) continue;
    seen.set(target.agentId, { agentId: target.agentId, displayName: target.agentId, mapped: false });
  }
  return [...seen.values()];
}

function listBody(store: CrmStore, user: SessionUser, rows: ReturnType<typeof progressBody>[], now: Date) {
  const today = zonedDateKey(now, AGENT_CALL_TARGET_TIME_ZONE);
  return {
    status: 200,
    body: {
      timeZone: AGENT_CALL_TARGET_TIME_ZONE,
      today,
      canManage: canManageAgentCallTargets(user),
      canEditWrapupTarget: canEditWrapupTarget(user),
      criteria: {
        connectedBy: "establishedTimeRaw",
        intentBy: "有意向",
        dateField: "startTimeRaw",
        timeZone: AGENT_CALL_TARGET_TIME_ZONE
      },
      rows: rows.sort((left, right) => left.displayName.localeCompare(right.displayName, "zh") || left.agentId.localeCompare(right.agentId))
    }
  };
}

export async function listAgentCallTargets(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseAgentCallTargetQuery(query);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  const now = outboundInstant();
  if (!canRead(user)) {
    return rejectWithAudit(store, user, {
      agentId: parsed.agentId || "",
      action: "read",
      previous: null,
      next: null,
      reason: "forbidden",
      message: "当前账号没有执行该业务操作的权限",
      status: 403,
      extra: { permissionCode: AGENT_CALL_TARGET_PERMISSION }
    });
  }
  const manage = canManageAgentCallTargets(user);
  if (parsed.agentId) {
    const mapping = sameTeamMapping(store, user.teamId, parsed.agentId);
    const target = sameTeamTarget(store, user.teamId, parsed.agentId);
    const own = Boolean(mapping && mapping.crmUserId === user.id);
    if (!mapping && !target) {
      if (!manage) {
        return rejectWithAudit(store, user, {
          agentId: parsed.agentId,
          action: "read",
          previous: null,
          next: null,
          reason: "forbidden",
          message: "不能查看这个坐席的外呼进度",
          status: 403
        });
      }
      return rejectWithAudit(store, user, {
        agentId: parsed.agentId,
        action: "read",
        previous: null,
        next: null,
        reason: "not_found",
        message: "没有这个坐席",
        status: 404
      });
    }
    if (!manage && !own) {
      return rejectWithAudit(store, user, {
        agentId: parsed.agentId,
        action: "read",
        previous: numbersOf(target),
        next: null,
        reason: "forbidden",
        message: "不能查看这个坐席的外呼进度",
        status: 403
      });
    }
    return listBody(store, user, [progressBody(store, user.teamId, parsed.agentId, agentLabel(mapping, parsed.agentId), Boolean(mapping), now)], now);
  }
  const rows = visibleAgentIds(store, user, manage).map((item) => progressBody(store, user.teamId, item.agentId, item.displayName, item.mapped, now));
  return listBody(store, user, rows, now);
}

function presentTarget(target: AgentCallTarget | null) {
  if (!target) return null;
  return {
    agentId: target.agentId,
    dialTarget: target.dialTarget,
    connectedTarget: target.connectedTarget,
    intentTarget: target.intentTarget,
    wrapupTarget: target.wrapupTarget ?? null
  };
}

function wrapupAttemptValue(previous: AgentCallTargetNumbers | null, wrapupTarget: number | null) {
  if (!previous) return wrapupTarget === null ? "" : `|||${wrapupTarget}`;
  return formatAgentCallTargetValue({ ...previous, wrapupTarget });
}

async function rejectWrapup(
  store: CrmStore,
  user: SessionUser,
  input: {
    agentId: string;
    action: AgentCallTargetAudit["action"];
    previous: AgentCallTargetNumbers | null;
    nextValue: string;
    reason: string;
    message: string;
    status: number;
    extra?: Record<string, unknown>;
  }
) {
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    agentId: input.agentId.slice(0, 128),
    action: input.action,
    previousValue: formatAgentCallTargetValue(input.previous),
    nextValue: input.nextValue,
    result: "rejected",
    reason: input.reason
  });
  return reject(input.reason, input.message, input.status, input.extra);
}

async function saveWrapupTarget(
  store: CrmStore,
  user: SessionUser,
  parsed: { agentId: string; wrapupTarget: number | null }
) {
  const local = sameTeamTarget(store, user.teamId, parsed.agentId);
  const previous = numbersOf(local);
  const action: AgentCallTargetAudit["action"] = previous ? "update" : "set";
  const nextValue = wrapupAttemptValue(previous, parsed.wrapupTarget);
  if (!canRead(user)) {
    return rejectWrapup(store, user, {
      agentId: parsed.agentId,
      action,
      previous,
      nextValue,
      reason: "forbidden",
      message: "当前账号没有执行该业务操作的权限",
      status: 403,
      extra: { permissionCode: AGENT_CALL_TARGET_PERMISSION }
    });
  }
  if (!canEditWrapupTarget(user)) {
    return rejectWrapup(store, user, {
      agentId: parsed.agentId,
      action,
      previous,
      nextValue,
      reason: "forbidden",
      message: "只有主管和管理员可以设置小结完成目标",
      status: 403
    });
  }
  const mapping = sameTeamMapping(store, user.teamId, parsed.agentId);
  if (user.role === "manager") {
    const resolved = await resolveOutboundCallRecordAccess(store, user);
    if (!resolved.ok) return { status: resolved.status, body: resolved.body };
    const own = mapping?.crmUserId === user.id;
    const visible = own || resolved.access.tenantWide || resolved.access.allowed.has(parsed.agentId);
    if (!visible) {
      return rejectWrapup(store, user, {
        agentId: parsed.agentId,
        action,
        previous,
        nextValue,
        reason: "forbidden",
        message: "不能设置这个坐席的小结目标",
        status: 403
      });
    }
  }
  if (!mapping) {
    return rejectWrapup(store, user, {
      agentId: parsed.agentId,
      action,
      previous,
      nextValue,
      reason: "not_found",
      message: "没有这个坐席映射，不能设置目标",
      status: 404
    });
  }
  if (!local) {
    if (parsed.wrapupTarget === null) {
      return {
        status: 200,
        body: {
          result: "unchanged" as const,
          target: null,
          progress: progressBody(store, user.teamId, parsed.agentId, agentLabel(mapping, parsed.agentId), true, outboundInstant())
        }
      };
    }
    return rejectWrapup(store, user, {
      agentId: parsed.agentId,
      action: "set",
      previous: null,
      nextValue,
      reason: "no_target",
      message: "还没有这位坐席的每日外呼目标，不能只写小结目标",
      status: 400
    });
  }
  if ((previous?.wrapupTarget ?? null) === parsed.wrapupTarget) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        target: presentTarget(local),
        progress: progressBody(store, user.teamId, parsed.agentId, agentLabel(mapping, parsed.agentId), true, outboundInstant())
      }
    };
  }
  local.wrapupTarget = parsed.wrapupTarget;
  local.updatedBy = user.id;
  local.updatedAt = outboundInstant().toISOString();
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    agentId: parsed.agentId,
    action: "update",
    previousValue: formatAgentCallTargetValue(previous),
    nextValue: formatAgentCallTargetValue(numbersOf(local)),
    result: "updated",
    reason: ""
  });
  return {
    status: 200,
    body: {
      result: "updated" as const,
      target: presentTarget(local),
      progress: progressBody(store, user.teamId, parsed.agentId, agentLabel(mapping, parsed.agentId), true, outboundInstant())
    }
  };
}

export async function saveAgentCallTarget(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseAgentCallTargetWrite(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  if (parsed.mode === "wrapup") return saveWrapupTarget(store, user, parsed);
  const local = sameTeamTarget(store, user.teamId, parsed.agentId);
  const previous = numbersOf(local);
  const next: AgentCallTargetNumbers = {
    dialTarget: parsed.dialTarget,
    connectedTarget: parsed.connectedTarget,
    intentTarget: parsed.intentTarget,
    wrapupTarget: parsed.wrapupTarget === undefined ? (previous?.wrapupTarget ?? null) : parsed.wrapupTarget
  };
  if (!canRead(user)) {
    return rejectWithAudit(store, user, {
      agentId: parsed.agentId,
      action: targetAction(previous, next),
      previous,
      next,
      reason: "forbidden",
      message: "当前账号没有执行该业务操作的权限",
      status: 403,
      extra: { permissionCode: AGENT_CALL_TARGET_PERMISSION }
    });
  }
  if (!canManageAgentCallTargets(user)) {
    return rejectWithAudit(store, user, {
      agentId: parsed.agentId,
      action: targetAction(previous, next),
      previous,
      next,
      reason: "forbidden",
      message: "只有管理员可以设置每日外呼目标",
      status: 403
    });
  }
  const mapping = sameTeamMapping(store, user.teamId, parsed.agentId);
  if (!mapping) {
    return rejectWithAudit(store, user, {
      agentId: parsed.agentId,
      action: targetAction(previous, next),
      previous,
      next,
      reason: "not_found",
      message: "没有这个坐席映射，不能设置目标",
      status: 404
    });
  }
  if (sameAgentCallTarget(previous, next)) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        target: presentTarget(local),
        progress: progressBody(store, user.teamId, parsed.agentId, agentLabel(mapping, parsed.agentId), true, outboundInstant())
      }
    };
  }
  const now = outboundInstant().toISOString();
  let saved: AgentCallTarget;
  if (local) {
    local.dialTarget = next.dialTarget;
    local.connectedTarget = next.connectedTarget;
    local.intentTarget = next.intentTarget;
    local.wrapupTarget = next.wrapupTarget ?? null;
    local.updatedBy = user.id;
    local.updatedAt = now;
    saved = local;
  } else {
    saved = {
      id: `act_${randomUUID()}`,
      teamId: user.teamId,
      agentId: parsed.agentId,
      dialTarget: next.dialTarget,
      connectedTarget: next.connectedTarget,
      intentTarget: next.intentTarget,
      wrapupTarget: next.wrapupTarget ?? null,
      updatedBy: user.id,
      updatedAt: now
    };
    store.agentCallTargets.unshift(saved);
  }
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    agentId: parsed.agentId,
    action: targetAction(previous, next),
    previousValue: formatAgentCallTargetValue(previous),
    nextValue: formatAgentCallTargetValue(next),
    result: "updated",
    reason: ""
  });
  return {
    status: 200,
    body: {
      result: "updated" as const,
      target: presentTarget(saved),
      progress: progressBody(store, user.teamId, parsed.agentId, agentLabel(mapping, parsed.agentId), true, outboundInstant())
    }
  };
}

export async function clearAgentCallTarget(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseAgentCallTargetClear(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  const local = sameTeamTarget(store, user.teamId, parsed.agentId);
  const previous = numbersOf(local);
  if (!canRead(user)) {
    return rejectWithAudit(store, user, {
      agentId: parsed.agentId,
      action: "clear",
      previous,
      next: null,
      reason: "forbidden",
      message: "当前账号没有执行该业务操作的权限",
      status: 403,
      extra: { permissionCode: AGENT_CALL_TARGET_PERMISSION }
    });
  }
  if (!canManageAgentCallTargets(user)) {
    return rejectWithAudit(store, user, {
      agentId: parsed.agentId,
      action: "clear",
      previous,
      next: null,
      reason: "forbidden",
      message: "只有管理员可以设置每日外呼目标",
      status: 403
    });
  }
  const mapping = sameTeamMapping(store, user.teamId, parsed.agentId);
  if (!local && !mapping) {
    return rejectWithAudit(store, user, {
      agentId: parsed.agentId,
      action: "clear",
      previous: null,
      next: null,
      reason: "not_found",
      message: "没有这个坐席",
      status: 404
    });
  }
  if (!local) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        target: null,
        progress: progressBody(store, user.teamId, parsed.agentId, agentLabel(mapping, parsed.agentId), Boolean(mapping), outboundInstant())
      }
    };
  }
  const index = store.agentCallTargets.findIndex((item) => item.id === local.id);
  if (index >= 0) store.agentCallTargets.splice(index, 1);
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    agentId: parsed.agentId,
    action: "clear",
    previousValue: formatAgentCallTargetValue(previous),
    nextValue: "",
    result: "updated",
    reason: ""
  });
  return {
    status: 200,
    body: {
      result: "cleared" as const,
      target: null,
      progress: progressBody(store, user.teamId, parsed.agentId, agentLabel(mapping, parsed.agentId), Boolean(mapping), outboundInstant())
    }
  };
}
