import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  CCC_MONO_RECORDING_EXPIRE_SECONDS,
  type CallDetailRecord,
  type MonoRecording
} from "./aliyun-ccc-make-call.js";
import { decryptAliyunOutboundSecret } from "./credential-security.js";
import { appendFollowUpAudit } from "./follow-up-audit.js";
import { maskOutboundNumber, outboundDialerFor } from "./outbound-call.js";
import { recordProspectFollowUp } from "./prospect-follow-up.js";
import type { CrmStore } from "./store.js";
import type {
  AliyunCccEventAudit,
  AliyunOutboundConfig,
  CustomerActivity,
  LeadActivity,
  OutboundCallAudit,
  OutboundCallRecord
} from "./types.js";

/**
 * CCC 事件回调。
 *
 * 官方事件格式页没有签名字段。入站先用路径令牌做常量时间比较，再核对 instanceId。
 * Webhook 的 HTTP 方法、Content-Type、重试次数和成功状态码，官方页没有写：待核实。
 * 本入口按产品约定接受 POST JSON。
 *
 * 写跟进和通话记录之前，用拨号器上的 GetCallDetailRecord 回查。
 * 跟进里的结果、时长和坐席以回查为准，不用事件正文覆盖。
 * 录音只留 ContactId 引用和 GetMonoRecording 的短期链接，不下载文件。
 */

const TERMINAL_EVENTS = new Set(["Released", "CDRReady"]);
const RECORDING_EVENTS = new Set(["RecordingReady", "DualTrackRecordingReady"]);

export interface ParsedCccEvent {
  eventType: string;
  eventTime: string;
  instanceId: string;
  contactId: string;
  /**
   * 事件格式页的话务 ID 是 contactId。
   * 正文如果只有 ContactId 或 MakeCall 的 jobId，按等价字段读取：待核实。
   */
  contactIdSource: "contactId" | "ContactId" | "jobId" | "";
  callType: string;
  caller: string;
  callee: string;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 官方示例是扁平 JSON。若包在 data、event 或 message 里：待核实，这里防御性展开一层。
 * 事件格式页公共字段是 eventTime、eventType、instanceId。话务类还有 contactId。
 */
export function parseCccEvent(body: unknown): ParsedCccEvent | null {
  const root = asRecord(body);
  if (!root) return null;
  let record = root;
  if (typeof root.eventType !== "string") {
    for (const key of ["data", "event", "message"]) {
      const nested = asRecord(root[key]);
      if (nested && typeof nested.eventType === "string") {
        record = nested;
        break;
      }
    }
  }
  const contactId = readString(record, "contactId");
  const contactPascal = readString(record, "ContactId");
  const jobId = readString(record, "jobId");
  let resolved = "";
  let contactIdSource: ParsedCccEvent["contactIdSource"] = "";
  if (contactId) {
    resolved = contactId;
    contactIdSource = "contactId";
  } else if (contactPascal) {
    resolved = contactPascal;
    contactIdSource = "ContactId";
  } else if (jobId) {
    resolved = jobId;
    contactIdSource = "jobId";
  }
  // 事件格式页写的是 instanceId。InstanceId 只作防御性兜底，是否会出现：待核实。
  const instanceId = readString(record, "instanceId") || readString(record, "InstanceId");
  return {
    eventType: readString(record, "eventType"),
    eventTime: readString(record, "eventTime"),
    instanceId,
    contactId: resolved,
    contactIdSource,
    callType: readString(record, "callType"),
    caller: readString(record, "caller"),
    callee: readString(record, "callee")
  };
}

/** 先哈希再比较，长度不同也不会抛，摘要比较本身是常量时间。 */
export function callbackTokensEqual(expected: string, provided: string) {
  const left = createHash("sha256").update(expected, "utf8").digest();
  const material = provided.length > 1024 ? "\0" : provided;
  const right = createHash("sha256").update(material, "utf8").digest();
  return timingSafeEqual(left, right);
}

function matchCallbackConfig(store: CrmStore, pathToken: string) {
  let matched: AliyunOutboundConfig | undefined;
  for (const config of store.aliyunOutboundConfigs) {
    let plain = "";
    try {
      plain = decryptAliyunOutboundSecret(config.teamId, "callbackPathToken", config.callbackPathTokenEncrypted);
    } catch {
      plain = "";
    }
    const same = callbackTokensEqual(plain, pathToken);
    if (same && plain && !matched) matched = config;
  }
  return matched;
}

function clip(value: string, max: number) {
  return value.length <= max ? value : value.slice(0, max);
}

function masks(event: ParsedCccEvent | null) {
  return {
    maskedCaller: maskOutboundNumber(event?.caller || ""),
    maskedCallee: maskOutboundNumber(event?.callee || "")
  };
}

async function finish(
  store: CrmStore,
  audit: Omit<AliyunCccEventAudit, "id" | "at">,
  status: number
) {
  store.aliyunCccEventAudits.unshift({
    id: `acea_${randomUUID()}`,
    at: new Date().toISOString(),
    ...audit,
    instanceId: clip(audit.instanceId, 128),
    contactId: clip(audit.contactId, 128),
    eventType: clip(audit.eventType, 64),
    eventTime: clip(audit.eventTime, 64),
    reason: clip(audit.reason, 64)
  });
  await store.persist();
  return {
    status,
    body: { accepted: audit.decision === "accepted", reason: audit.reason }
  };
}

function alreadyAccepted(store: CrmStore, event: ParsedCccEvent) {
  return store.aliyunCccEventAudits.some((item) =>
    item.decision === "accepted"
    && item.reason !== "duplicate"
    && item.instanceId === event.instanceId
    && item.contactId === event.contactId
    && item.eventType === event.eventType
    && item.eventTime === event.eventTime
  );
}

function findDialAudit(store: CrmStore, teamId: string, contactId: string) {
  return store.outboundCallAudits.find((item) =>
    item.teamId === teamId
    && item.result === "allowed"
    && item.jobId === contactId
    && (item.targetType === "customer" || item.targetType === "lead" || item.targetType === "prospect")
    && Boolean(item.targetId)
  );
}

function targetExists(store: CrmStore, audit: OutboundCallAudit) {
  if (audit.targetType === "customer") {
    return store.customers.some((item) => item.id === audit.targetId && item.teamId === audit.teamId);
  }
  if (audit.targetType === "lead") {
    return store.leads.some((item) => item.id === audit.targetId && item.teamId === audit.teamId && !item.deletedAt);
  }
  if (audit.targetType === "prospect") {
    return store.websiteOpportunities.some((item) => item.id === audit.targetId && item.teamId === audit.teamId);
  }
  return false;
}

function followUpContent(detail: CallDetailRecord) {
  const duration = detail.callDurationRaw
    ? `${detail.callDurationRaw}（GetCallDetailRecord.CallDuration 原文；该页写整数秒，与列表接口口径冲突，待核实，不折算）`
    : "无";
  return [
    `云联络中心通话 ${detail.contactId}`,
    `结果：${detail.contactDisposition || "未知"}`,
    `早媒体：${detail.earlyMediaState || "无"}`,
    `时长：${duration}`,
    `坐席：${detail.agentIds || "无"}`,
    `录音引用：${detail.contactId}`
  ].join("\n");
}

function createCallFollowUp(store: CrmStore, audit: OutboundCallAudit, content: string) {
  const now = new Date().toISOString();
  if (audit.targetType === "customer") {
    const customer = store.customers.find((item) => item.id === audit.targetId && item.teamId === audit.teamId);
    if (!customer) throw new Error("跟进对象不存在");
    const activity: CustomerActivity = {
      id: `ca_${randomUUID()}`,
      customerId: customer.id,
      type: "call",
      content,
      operatorId: audit.actorId,
      nextReminder: "",
      createdAt: now
    };
    store.customerActivities.unshift(activity);
    appendFollowUpAudit(store, {
      actorId: audit.actorId,
      objectType: "customer",
      objectId: customer.id,
      activityId: activity.id,
      at: now
    });
    return activity.id;
  }
  if (audit.targetType === "lead") {
    const lead = store.leads.find((item) => item.id === audit.targetId && item.teamId === audit.teamId && !item.deletedAt);
    if (!lead) throw new Error("跟进对象不存在");
    const activity: LeadActivity = {
      id: `la_${randomUUID()}`,
      leadId: lead.id,
      type: "call",
      content,
      operatorId: audit.actorId,
      nextFollowAt: "",
      createdAt: now
    };
    store.leadActivities.unshift(activity);
    lead.lastActivityAt = "刚刚";
    if (lead.status === "new") lead.status = "following";
    return activity.id;
  }
  const candidate = store.websiteOpportunities.find((item) => item.id === audit.targetId && item.teamId === audit.teamId);
  if (!candidate) throw new Error("跟进对象不存在");
  const recorded = recordProspectFollowUp(store, {
    candidate,
    actorId: audit.actorId,
    content,
    type: "call",
    createdAt: now
  });
  appendFollowUpAudit(store, {
    actorId: audit.actorId,
    objectType: "prospect_candidate",
    objectId: candidate.id,
    activityId: recorded.activity.id,
    at: recorded.activity.createdAt
  });
  return recorded.activity.id;
}

function refreshFollowUp(store: CrmStore, record: OutboundCallRecord, content: string, actorId: string) {
  if (!record.followUpActivityId) return;
  if (record.targetType === "customer") {
    const activity = store.customerActivities.find((item) =>
      item.id === record.followUpActivityId && item.customerId === record.targetId
    );
    if (!activity) return;
    activity.content = content;
    activity.updatedAt = new Date().toISOString();
    activity.editedBy = actorId;
    return;
  }
  const activity = store.leadActivities.find((item) => item.id === record.followUpActivityId);
  if (!activity) return;
  activity.content = content;
}

function fill(current: string, next: string) {
  return next || current;
}

function storableRecordingUrl(url: string, secrets: string[]) {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed) || trimmed.length > 2000) return "";
  const digits = trimmed.replace(/\D/g, "");
  for (const secret of secrets) {
    if (!secret) continue;
    if (trimmed.includes(secret)) return "";
    const needle = secret.replace(/\D/g, "");
    if (needle.length >= 6 && digits.includes(needle)) return "";
  }
  return trimmed;
}

function findRecord(store: CrmStore, instanceId: string, contactId: string) {
  return store.outboundCallRecords.find((item) => item.instanceId === instanceId && item.contactId === contactId);
}

function applyCall(
  store: CrmStore,
  audit: OutboundCallAudit,
  event: ParsedCccEvent,
  detail: CallDetailRecord,
  recording: MonoRecording | null,
  pathToken: string
) {
  const terminal = TERMINAL_EVENTS.has(event.eventType);
  const recordingEvent = RECORDING_EVENTS.has(event.eventType);
  const existing = findRecord(store, event.instanceId, event.contactId);
  const snapshot = existing ? { ...existing } : null;
  const record = existing || {
    id: `ocr_${randomUUID()}`,
    teamId: audit.teamId,
    instanceId: event.instanceId,
    contactId: event.contactId,
    outboundCallAuditId: audit.id,
    targetType: audit.targetType as OutboundCallRecord["targetType"],
    targetId: audit.targetId,
    maskedNumber: "",
    contactType: "",
    contactDisposition: "",
    earlyMediaState: "",
    callDurationRaw: "",
    establishedTimeRaw: "",
    releaseTimeRaw: "",
    startTimeRaw: "",
    agentIds: "",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "",
    recordingDurationRaw: "",
    followUpActivityId: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (!existing) store.outboundCallRecords.unshift(record);
  const hadFollowUp = Boolean(record.followUpActivityId);
  try {
    record.maskedNumber = audit.maskedNumber || maskOutboundNumber(
      detail.contactType === "INBOUND" ? detail.callingNumber : detail.calledNumber
    );
    record.contactType = fill(record.contactType, detail.contactType);
    record.contactDisposition = fill(record.contactDisposition, detail.contactDisposition);
    record.earlyMediaState = fill(record.earlyMediaState, detail.earlyMediaState);
    record.callDurationRaw = fill(record.callDurationRaw, detail.callDurationRaw);
    record.establishedTimeRaw = fill(record.establishedTimeRaw, detail.establishedTimeRaw);
    record.releaseTimeRaw = fill(record.releaseTimeRaw, detail.releaseTimeRaw);
    record.startTimeRaw = fill(record.startTimeRaw, detail.startTimeRaw);
    record.agentIds = fill(record.agentIds, detail.agentIds);
    if (detail.recordingReady !== null) record.recordingReady = detail.recordingReady;
    if (recording) {
      const url = storableRecordingUrl(recording.fileUrl, [
        pathToken,
        detail.callingNumber,
        detail.calledNumber,
        event.caller,
        event.callee
      ]);
      if (url) record.recordingUrl = url;
      if (recording.fileName) record.recordingFileName = clip(recording.fileName, 255);
      if (recording.durationRaw) record.recordingDurationRaw = clip(recording.durationRaw, 64);
    }
    if (recordingEvent || detail.recordingReady === true) record.recordingRef = detail.contactId;
    record.updatedAt = new Date().toISOString();
    const content = followUpContent(detail);
    if (terminal && !record.followUpActivityId) {
      record.followUpActivityId = createCallFollowUp(store, audit, content);
    } else if (record.followUpActivityId) {
      refreshFollowUp(store, record, content, audit.actorId);
    }
  } catch {
    if (snapshot) Object.assign(existing!, snapshot);
    else store.outboundCallRecords = store.outboundCallRecords.filter((item) => item.id !== record.id);
    return "follow_up_rejected" as const;
  }
  if (terminal && !hadFollowUp) return "recorded" as const;
  if (!terminal && !hadFollowUp) return "recording_only" as const;
  return "updated" as const;
}

function eventInvalid(event: ParsedCccEvent) {
  if (!event.eventType || !event.eventTime) return true;
  if (event.eventType.length > 64 || event.eventTime.length > 64) return true;
  if (event.contactId.length > 128 || event.instanceId.length > 128) return true;
  return false;
}

export async function receiveAliyunCccEvent(store: CrmStore, pathToken: string, body: unknown) {
  const config = matchCallbackConfig(store, typeof pathToken === "string" ? pathToken : "");
  const event = parseCccEvent(body);
  const masked = masks(event);
  const base = {
    teamId: config?.teamId || "",
    instanceId: event?.instanceId || "",
    contactId: event?.contactId || "",
    eventType: event?.eventType || "",
    eventTime: event?.eventTime || "",
    maskedCaller: masked.maskedCaller,
    maskedCallee: masked.maskedCallee
  };
  if (!config) {
    return finish(store, { ...base, teamId: "", decision: "rejected", reason: "invalid_token" }, 401);
  }
  if (config.aliyunOutboundEnabled !== true) {
    return finish(store, { ...base, decision: "rejected", reason: "disabled" }, 403);
  }
  if (!event?.instanceId || event.instanceId !== config.instanceId.trim()) {
    return finish(store, { ...base, decision: "rejected", reason: "instance_mismatch" }, 403);
  }
  if (eventInvalid(event)) {
    return finish(store, { ...base, decision: "rejected", reason: "invalid_event" }, 400);
  }
  if (alreadyAccepted(store, event)) {
    return finish(store, { ...base, decision: "accepted", reason: "duplicate" }, 200);
  }
  const writing = TERMINAL_EVENTS.has(event.eventType) || RECORDING_EVENTS.has(event.eventType);
  if (!writing) {
    return finish(store, { ...base, decision: "accepted", reason: "ignored" }, 200);
  }
  if (!event.contactId) {
    return finish(store, { ...base, decision: "rejected", reason: "invalid_event" }, 400);
  }
  const dialAudit = findDialAudit(store, config.teamId, event.contactId);
  if (!dialAudit) {
    return finish(store, { ...base, decision: "rejected", reason: "unmatched" }, 409);
  }
  if (!targetExists(store, dialAudit)) {
    return finish(store, { ...base, decision: "rejected", reason: "target_missing" }, 409);
  }

  let detail: CallDetailRecord;
  try {
    const dialer = outboundDialerFor(config.region);
    if (typeof dialer.getCallDetailRecord !== "function") throw new Error("回查未注入");
    detail = await dialer.getCallDetailRecord({
      InstanceId: config.instanceId.trim(),
      ContactId: event.contactId
    });
  } catch {
    return finish(store, { ...base, decision: "rejected", reason: "lookup_failed" }, 502);
  }
  if (alreadyAccepted(store, event)) {
    return finish(store, { ...base, decision: "accepted", reason: "duplicate" }, 200);
  }

  let recording: MonoRecording | null = null;
  const wantRecording = RECORDING_EVENTS.has(event.eventType) || detail.recordingReady === true;
  if (wantRecording) {
    try {
      const dialer = outboundDialerFor(config.region);
      if (typeof dialer.getMonoRecording === "function") {
        recording = await dialer.getMonoRecording({
          InstanceId: config.instanceId.trim(),
          ContactId: event.contactId,
          ExpireSeconds: CCC_MONO_RECORDING_EXPIRE_SECONDS
        });
      }
    } catch {
      recording = null;
    }
  }
  if (alreadyAccepted(store, event)) {
    return finish(store, { ...base, decision: "accepted", reason: "duplicate" }, 200);
  }

  const reason = applyCall(store, dialAudit, event, detail, recording, pathToken);
  if (reason === "follow_up_rejected") {
    return finish(store, { ...base, decision: "rejected", reason }, 409);
  }
  return finish(store, { ...base, decision: "accepted", reason }, 200);
}
