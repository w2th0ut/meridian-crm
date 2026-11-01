import { randomUUID } from "node:crypto";
import { parseCallCallbackRequest, scheduleCallbackOnCall } from "./callback-schedule.js";
import { CALL_NOTE_MAX, parseCallNoteRequest, saveCallNote } from "./call-note.js";
import { parseCallOutcomeRequest } from "./call-outcome.js";
import { labelCallOutcome } from "./call-outcome.js";
import { parseCallScriptUsageRequest, saveCallScriptUsage, callScriptUsageView } from "./call-script-usage.js";
import { addCallRecordTag, callTagsOnRecord, parseCallRecordTagRequest, removeCallRecordTag } from "./call-tag.js";
import { outboundInstant } from "./outbound-call.js";
import {
  CALL_OUTCOME_NOTE_MAX,
  outboundCallRecordVisible,
  presentOutboundCallRecord,
  resolveOutboundCallRecordAccess
} from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type {
  CallNoteAudit,
  CallOutcomeAudit,
  CallRecordTag,
  CallScriptUsageAudit,
  CallTagAudit,
  CallbackSchedule,
  CallbackScheduleAudit,
  CallWrapupAudit,
  OutboundCallRecord,
  SessionUser
} from "./types.js";

/**
 * 坐席在一条有权看到的通话上，一次提交通话小结。
 * 填了的通话结果、纪要、话术、标签和回拨复用各自的校验、权限和审计。
 * 标签可以一次添加多个启用中的，并去掉已经打上的，含已停用但仍打着的。
 * 这些改动先留在内存里，最后一次 persist 才落库；任一项失败就先恢复快照再决定要不要记拒绝审计。
 * 不拨号，不发信，不调用外部接口，不推进序列，不改抑制，不转线索。
 */

const PART_KEYS = ["outcome", "note", "script", "callTag", "callback"] as const;
export type CallWrapupPart = (typeof PART_KEYS)[number];
const BODY_KEYS = new Set<string>([...PART_KEYS, "callTags"]);
export const CALL_WRAPUP_TAG_LIMIT = 10;

export interface CallWrapupTagChange {
  tagId: string;
  action: "add" | "remove";
}

const BATCH_KEYS = [
  "records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes",
  "templates", "templateIds", "scripts", "versions", "versionIds", "favorites",
  "favoriteIds", "scenarios", "scenarioIds", "codes", "names", "tags", "tagIds"
] as const;

type StepResult = { status: number; body: Record<string, any> };

export function parseCallWrapupRequest(body: unknown):
  | { ok: true; parts: CallWrapupPart[]; callTagAction: "add" | "remove"; callTags: CallWrapupTagChange[] }
  | { ok: false; reason: string; message: string } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "invalid_request", message: "一次只能为一条通话记录提交通话小结" };
  }
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) {
    return { ok: false, reason: "invalid_request", message: "一次只能为一条通话记录提交通话小结" };
  }
  if (Object.keys(record).some((key) => !BODY_KEYS.has(key))) {
    return { ok: false, reason: "invalid_request", message: "一次只能为一条通话记录提交通话小结" };
  }
  const parts = PART_KEYS.filter((key) => key in record || (key === "callTag" && "callTags" in record));
  if (!parts.length) {
    return { ok: false, reason: "invalid_request", message: "请至少填写一项通话小结" };
  }
  if ("outcome" in record) {
    const parsed = parseCallOutcomeRequest(record.outcome);
    if (!parsed.ok) return { ok: false, reason: parsed.reason, message: outcomeMessage(parsed.reason) };
  }
  if ("note" in record) {
    const parsed = parseCallNoteRequest(record.note);
    if (!parsed.ok) return { ok: false, reason: parsed.reason, message: noteMessage(parsed.reason) };
  }
  if ("script" in record) {
    const parsed = parseCallScriptUsageRequest(record.script);
    if (!parsed.ok) return { ok: false, reason: parsed.reason, message: "一次只能为一条通话记录选择话术" };
  }
  const tags = parseWrapupTags(record);
  if (!tags.ok) return { ok: false, reason: tags.reason, message: tags.message };
  if ("callback" in record) {
    const parsed = parseCallCallbackRequest(record.callback);
    if (!parsed.ok) return { ok: false, reason: parsed.reason, message: "回拨预约格式不正确" };
  }
  return { ok: true, parts, callTagAction: tags.callTagAction, callTags: tags.callTags };
}

function outcomeMessage(reason: string) {
  if (reason === "note_too_long") return `备注不能超过 ${CALL_OUTCOME_NOTE_MAX} 字`;
  if (reason === "invalid_outcome") return "通话结果不在可选范围内";
  if (reason === "invalid_note") return "备注格式不正确";
  return "一次只能为一条通话记录标注结果";
}

function noteMessage(reason: string) {
  if (reason === "note_too_long") return `通话纪要不能超过 ${CALL_NOTE_MAX} 字`;
  if (reason === "invalid_note") return "通话纪要格式不正确";
  if (reason === "invalid_tags") return "通话纪要要点不在可选范围内";
  return "一次只能为一条通话记录填写纪要";
}

function parseWrapupTagChange(body: unknown):
  | { ok: true; change: CallWrapupTagChange }
  | { ok: false; reason: "invalid_request" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_request" };
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(record).some((key) => key !== "tagId" && key !== "action")) return { ok: false, reason: "invalid_request" };
  const parsed = parseCallRecordTagRequest({ tagId: record.tagId });
  if (!parsed.ok) return { ok: false, reason: "invalid_request" };
  if (record.action === undefined) return { ok: true, change: { tagId: parsed.tagId, action: "add" } };
  if (record.action !== "add" && record.action !== "remove") return { ok: false, reason: "invalid_request" };
  return { ok: true, change: { tagId: parsed.tagId, action: record.action } };
}

function parseWrapupTags(record: Record<string, unknown>):
  | { ok: true; callTagAction: "add" | "remove"; callTags: CallWrapupTagChange[] }
  | { ok: false; reason: string; message: string } {
  const callTags: CallWrapupTagChange[] = [];
  let callTagAction: "add" | "remove" = "add";
  if ("callTag" in record) {
    const parsed = parseWrapupTagChange(record.callTag);
    if (!parsed.ok) return { ok: false, reason: parsed.reason, message: "一次只能为一条通话记录添加或去掉一个标签" };
    callTags.push(parsed.change);
    callTagAction = parsed.change.action;
  }
  if ("callTags" in record) {
    if (!Array.isArray(record.callTags) || record.callTags.length === 0) {
      return { ok: false, reason: "invalid_request", message: "一次只能为一条通话记录添加或去掉通话标签" };
    }
    for (const item of record.callTags) {
      const parsed = parseWrapupTagChange(item);
      if (!parsed.ok) return { ok: false, reason: "invalid_request", message: "一次只能为一条通话记录添加或去掉通话标签" };
      callTags.push(parsed.change);
    }
    if (!("callTag" in record)) callTagAction = callTags[0].action;
  }
  if (callTags.length > CALL_WRAPUP_TAG_LIMIT) {
    return { ok: false, reason: "too_many_tags", message: `一次最多添加或去掉 ${CALL_WRAPUP_TAG_LIMIT} 个通话标签` };
  }
  const seen = new Set<string>();
  for (const change of callTags) {
    if (seen.has(change.tagId)) {
      return { ok: false, reason: "invalid_request", message: "一次不能重复提交同一个通话标签" };
    }
    seen.add(change.tagId);
  }
  return { ok: true, callTagAction, callTags };
}

function tagIdsText(ids: string[]) {
  return JSON.stringify(ids).slice(0, 1000);
}

function requestedTagIds(changes: CallWrapupTagChange[], action: "add" | "remove") {
  return tagIdsText(changes.filter((item) => item.action === action).map((item) => item.tagId));
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function clipId(value: string) {
  return value.slice(0, 64);
}

function partsJson(states: Partial<Record<CallWrapupPart, string>>) {
  const body: Record<string, string> = {};
  for (const key of PART_KEYS) {
    const value = states[key];
    if (value) body[key] = value;
  }
  return JSON.stringify(body).slice(0, 1000);
}

function partState(result: unknown) {
  return result === "unchanged" ? "unchanged" : "updated";
}

function auditFingerprint(store: CrmStore) {
  return [
    store.callOutcomeAudits.length,
    store.callNoteAudits.length,
    store.callScriptUsageAudits.length,
    store.callTagAudits.length,
    store.callbackScheduleAudits.length
  ].join(":");
}

interface Snapshot {
  record: OutboundCallRecord | null;
  fields: Partial<OutboundCallRecord> | null;
  callOutcomeAudits: CallOutcomeAudit[];
  callNoteAudits: CallNoteAudit[];
  callScriptUsageAudits: CallScriptUsageAudit[];
  callTagAudits: CallTagAudit[];
  callRecordTags: CallRecordTag[];
  callbackSchedules: CallbackSchedule[];
  callbackScheduleAudits: CallbackScheduleAudit[];
}

function capture(store: CrmStore, callRecordId: string): Snapshot {
  const record = store.outboundCallRecords.find((item) => item.id === callRecordId) || null;
  return {
    record,
    fields: record ? {
      callOutcome: record.callOutcome,
      callOutcomeNote: record.callOutcomeNote,
      callNote: record.callNote,
      callNoteTags: record.callNoteTags,
      callNoteUpdatedAt: record.callNoteUpdatedAt,
      callScriptTemplateId: record.callScriptTemplateId,
      callScriptUpdatedAt: record.callScriptUpdatedAt,
      updatedAt: record.updatedAt
    } : null,
    callOutcomeAudits: store.callOutcomeAudits.slice(),
    callNoteAudits: store.callNoteAudits.slice(),
    callScriptUsageAudits: store.callScriptUsageAudits.slice(),
    callTagAudits: store.callTagAudits.slice(),
    callRecordTags: store.callRecordTags.slice(),
    callbackSchedules: store.callbackSchedules.map((item) => ({ ...item })),
    callbackScheduleAudits: store.callbackScheduleAudits.slice()
  };
}

function restore(store: CrmStore, snapshot: Snapshot) {
  if (snapshot.record && snapshot.fields) Object.assign(snapshot.record, snapshot.fields);
  store.callOutcomeAudits = snapshot.callOutcomeAudits.slice();
  store.callNoteAudits = snapshot.callNoteAudits.slice();
  store.callScriptUsageAudits = snapshot.callScriptUsageAudits.slice();
  store.callTagAudits = snapshot.callTagAudits.slice();
  store.callRecordTags = snapshot.callRecordTags.slice();
  store.callbackSchedules = snapshot.callbackSchedules.map((item) => ({ ...item }));
  store.callbackScheduleAudits = snapshot.callbackScheduleAudits.slice();
}

function deferredStore(store: CrmStore) {
  const view = new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "persist") return async () => {};
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) as CrmStore;
  return { view, flush: () => store.persist() };
}

async function writeAudit(store: CrmStore, input: Omit<CallWrapupAudit, "id" | "at">, persist: boolean) {
  const audit: CallWrapupAudit = {
    id: `cwu_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.callWrapupAudits.unshift(audit);
  if (persist) await store.persist();
  return audit;
}

function presented(store: CrmStore, record: OutboundCallRecord, access: { timeZone: string; labels: Map<string, string> }) {
  return {
    ...presentOutboundCallRecord(record, access.timeZone, access.labels),
    ...callScriptUsageView(store, record),
    callTags: callTagsOnRecord(store, record.teamId, record.id)
  };
}

export async function submitCallWrapup(
  store: CrmStore,
  user: SessionUser | undefined,
  callRecordId: string,
  body: unknown,
  query: Record<string, unknown> = {}
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  if (Object.keys(query).length > 0) return reject("invalid_request", "一次只能为一条通话记录提交通话小结");
  const parsed = parseCallWrapupRequest(body);
  if (!parsed.ok) return reject(parsed.reason, parsed.message);
  const payload = body as Record<string, unknown>;
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  const local = store.outboundCallRecords.find((item) => item.id === callRecordId && item.teamId === user.teamId);
  const visible = resolved.ok && Boolean(local) && outboundCallRecordVisible(local!, user.teamId, resolved.access);
  if (!visible || !local || !resolved.ok) {
    const states = Object.fromEntries(parsed.parts.map((key) => [key, "rejected"])) as Partial<Record<CallWrapupPart, string>>;
    await writeAudit(store, {
      teamId: user.teamId,
      actorId: user.id,
      callRecordId: clipId(callRecordId),
      action: "submit",
      parts: partsJson(states),
      addedTagIds: requestedTagIds(parsed.callTags, "add"),
      removedTagIds: requestedTagIds(parsed.callTags, "remove"),
      result: "rejected",
      reason: "forbidden"
    }, true);
    const permissionCode = !resolved.ok ? resolved.body.permissionCode : undefined;
    return {
      status: 403,
      body: {
        result: "rejected" as const,
        reason: "forbidden",
        message: "没有操作这条通话记录的权限",
        ...(permissionCode ? { permissionCode } : {})
      }
    };
  }

  const snapshot = capture(store, local.id);
  const { view, flush } = deferredStore(store);
  const states: Partial<Record<CallWrapupPart, string>> = {};
  const appliedAdds: string[] = [];
  const appliedRemoves: string[] = [];
  const steps: Array<{ key: CallWrapupPart; run: () => Promise<StepResult>; tagId?: string }> = [];
  if (parsed.parts.includes("outcome")) {
    steps.push({ key: "outcome", run: () => labelCallOutcome(view, user, local.id, payload.outcome) as Promise<StepResult> });
  }
  if (parsed.parts.includes("note")) {
    steps.push({ key: "note", run: () => saveCallNote(view, user, local.id, payload.note) as Promise<StepResult> });
  }
  if (parsed.parts.includes("script")) {
    steps.push({ key: "script", run: () => saveCallScriptUsage(view, user, local.id, payload.script) as Promise<StepResult> });
  }
  for (const change of parsed.callTags) {
    const tagBody = { tagId: change.tagId };
    const run = change.action === "remove"
      ? () => removeCallRecordTag(view, user, local.id, tagBody, { allowDisabledRemove: true }) as Promise<StepResult>
      : () => addCallRecordTag(view, user, local.id, tagBody) as Promise<StepResult>;
    steps.push({ key: "callTag", run, tagId: change.tagId });
  }
  if (parsed.parts.includes("callback")) {
    steps.push({ key: "callback", run: () => scheduleCallbackOnCall(view, user, local.id, payload.callback) as Promise<StepResult> });
  }

  for (const step of steps) {
    const before = auditFingerprint(store);
    const outcome = await step.run();
    if (outcome.status >= 400) {
      const wroteAudit = auditFingerprint(store) !== before;
      restore(store, snapshot);
      if (!wroteAudit) return outcome;
      const again = await step.run();
      if (again.status < 400) {
        restore(store, snapshot);
        return outcome;
      }
      const failed: Partial<Record<CallWrapupPart, string>> = {};
      for (const key of Object.keys(states) as CallWrapupPart[]) failed[key] = "rolled_back";
      failed[step.key] = "rejected";
      await writeAudit(store, {
        teamId: user.teamId,
        actorId: user.id,
        callRecordId: local.id,
        action: "submit",
        parts: partsJson(failed),
        addedTagIds: requestedTagIds(parsed.callTags, "add"),
        removedTagIds: requestedTagIds(parsed.callTags, "remove"),
        result: "rejected",
        reason: typeof outcome.body.reason === "string" ? outcome.body.reason : "rejected"
      }, false);
      await flush();
      return outcome;
    }
    if (step.key === "callTag") {
      if (outcome.body.result === "added" && step.tagId) appliedAdds.push(step.tagId);
      if (outcome.body.result === "removed" && step.tagId) appliedRemoves.push(step.tagId);
      const next = partState(outcome.body.result);
      states.callTag = states.callTag === "updated" || next === "updated" ? "updated" : "unchanged";
    } else {
      states[step.key] = partState(outcome.body.result);
    }
  }

  const changed = Object.values(states).some((value) => value === "updated");
  if (!changed) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: "通话小结没有变化",
        callRecordId: local.id,
        parts: states,
        record: presented(store, local, resolved.access)
      }
    };
  }
  const audit = await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    callRecordId: local.id,
    action: "submit",
    parts: partsJson(states),
    addedTagIds: tagIdsText(appliedAdds),
    removedTagIds: tagIdsText(appliedRemoves),
    result: "updated",
    reason: ""
  }, false);
  await flush();
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message: "已保存通话小结",
      callRecordId: local.id,
      parts: states,
      auditId: audit.id,
      record: presented(store, local, resolved.access)
    }
  };
}
