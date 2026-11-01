import { randomUUID } from "node:crypto";
import { canManageCallScripts } from "./call-script.js";
import { scenarioLabelFor } from "./call-script-scenario.js";
import { outboundInstant } from "./outbound-call.js";
import {
  outboundCallRecordVisible,
  presentOutboundCallRecord,
  resolveOutboundCallRecordAccess
} from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type { CallScriptTemplate, CallScriptUsageAudit, OutboundCallRecord, SessionUser } from "./types.js";

/**
 * 给一条通话记录选择、更换或清除所用话术。
 * 只改本条记下的模板 ID，并在有变化或越权时写 call_script_usage_audits。
 * 使用次数只数本租户当前指向这条模板的通话。不拨号，不发信，不调用外部接口。
 */

const TEMPLATE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const BATCH_KEYS = ["records", "ids", "callRecordIds", "recordIds", "targets", "items", "outcomes", "templates", "templateIds", "scripts"] as const;

export function callScriptUsageAction(previousId: string, nextId: string): Exclude<CallScriptUsageAudit["action"], "read"> {
  if (!nextId) return "clear";
  if (!previousId) return "set";
  return "update";
}

export function parseCallScriptUsageRequest(body: unknown):
  | { ok: true; templateId: string }
  | { ok: false; reason: "invalid_request" } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "invalid_request" };
  }
  const record = body as Record<string, unknown>;
  if (BATCH_KEYS.some((key) => key in record)) return { ok: false, reason: "invalid_request" };
  if (Object.keys(record).some((key) => key !== "templateId")) return { ok: false, reason: "invalid_request" };
  if (!("templateId" in record)) return { ok: false, reason: "invalid_request" };
  const value = record.templateId;
  if (value === null) return { ok: true, templateId: "" };
  if (typeof value !== "string") return { ok: false, reason: "invalid_request" };
  const templateId = value.trim();
  if (!templateId) return { ok: true, templateId: "" };
  if (!TEMPLATE_ID.test(templateId)) return { ok: false, reason: "invalid_request" };
  return { ok: true, templateId };
}

export function callScriptUsageView(store: CrmStore, record: Pick<OutboundCallRecord, "teamId" | "callScriptTemplateId" | "callScriptUpdatedAt">) {
  const templateId = (record.callScriptTemplateId || "").trim();
  const template = templateId ? findTeamTemplate(store, record.teamId, templateId) : null;
  return {
    callScriptTemplateId: templateId,
    callScriptTitle: template?.title || "",
    callScriptScenario: template?.scenario || "",
    callScriptEnabled: template ? template.enabled : false,
    callScriptUpdatedAt: record.callScriptUpdatedAt || ""
  };
}

export function enabledCallScriptChoices(store: CrmStore, teamId: string) {
  return store.callScriptTemplates
    .filter((item) => item.teamId === teamId && item.enabled)
    .slice()
    .sort((left, right) => left.title.localeCompare(right.title, "zh") || left.id.localeCompare(right.id))
    .map(presentChoice);
}

/** 筛选用。启用的模板，再加上这一批通话已经记下的模板（含已停用）。不含使用次数。 */
export function scriptFilterChoices(store: CrmStore, teamId: string, records: Array<Pick<OutboundCallRecord, "callScriptTemplateId">>) {
  const ids = new Set<string>();
  for (const template of store.callScriptTemplates) {
    if (template.teamId === teamId && template.enabled) ids.add(template.id);
  }
  for (const record of records) {
    const id = (record.callScriptTemplateId || "").trim();
    if (id) ids.add(id);
  }
  return [...ids].map((id) => {
    const template = findTeamTemplate(store, teamId, id);
    return {
      id,
      title: template?.title || "",
      scenario: template?.scenario || "",
      enabled: template ? template.enabled : false
    };
  }).sort((left, right) => (left.title || left.id).localeCompare(right.title || right.id, "zh") || left.id.localeCompare(right.id));
}

/**
 * 各话术当前被多少通本租户通话选用。
 * 只数 callScriptTemplateId 对得上的行，不另算比率，也不把审计行数当成次数。
 */
export function callScriptUsageCounts(store: CrmStore, teamId: string) {
  const counts = new Map<string, number>();
  for (const record of store.outboundCallRecords) {
    if (record.teamId !== teamId) continue;
    const id = (record.callScriptTemplateId || "").trim();
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return store.callScriptTemplates
    .filter((item) => item.teamId === teamId)
    .slice()
    .sort((left, right) => left.title.localeCompare(right.title, "zh") || left.id.localeCompare(right.id))
    .map((template) => ({
      ...presentChoice(template),
      scenarioLabel: scenarioLabelFor(store, teamId, template.scenario),
      enabled: template.enabled,
      usageCount: counts.get(template.id) || 0
    }));
}

function presentChoice(template: CallScriptTemplate) {
  return {
    id: template.id,
    title: template.title,
    scenario: template.scenario
  };
}

function findTeamTemplate(store: CrmStore, teamId: string, templateId: string) {
  return store.callScriptTemplates.find((item) => item.id === templateId && item.teamId === teamId) || null;
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

function validationMessage(reason: string) {
  if (reason === "disabled") return "已停用的话术不能选用";
  if (reason === "not_found") return "话术不存在";
  if (reason === "forbidden") return "没有操作这条通话记录的权限";
  return "一次只能为一条通话记录选择话术";
}

function clipId(value: string) {
  return value.slice(0, 64);
}

async function writeAudit(store: CrmStore, input: Omit<CallScriptUsageAudit, "id" | "at">) {
  const audit: CallScriptUsageAudit = {
    id: `csu_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.callScriptUsageAudits.unshift(audit);
  await store.persist();
  return audit;
}

async function rejectWithAudit(
  store: CrmStore,
  user: SessionUser,
  input: {
    callRecordId: string;
    action: CallScriptUsageAudit["action"];
    previousTemplateId: string;
    nextTemplateId: string;
    reason: string;
    message: string;
    status: number;
  }
) {
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    callRecordId: clipId(input.callRecordId),
    action: input.action,
    previousTemplateId: input.previousTemplateId,
    nextTemplateId: input.nextTemplateId,
    result: "rejected",
    reason: input.reason
  });
  return reject(input.reason, input.message, input.status);
}

function sameTeamRecord(store: CrmStore, teamId: string, callRecordId: string) {
  return store.outboundCallRecords.find((item) => item.id === callRecordId && item.teamId === teamId);
}

function presented(store: CrmStore, record: OutboundCallRecord, user: SessionUser, access: { timeZone: string; labels: Map<string, string> }) {
  return {
    ...presentOutboundCallRecord(record, access.timeZone, access.labels),
    ...callScriptUsageView(store, record)
  };
}

export async function saveCallScriptUsage(
  store: CrmStore,
  user: SessionUser | undefined,
  callRecordId: string,
  body: unknown
) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallScriptUsageRequest(body);
  if (!parsed.ok) return reject(parsed.reason, validationMessage(parsed.reason));
  const resolved = await resolveOutboundCallRecordAccess(store, user);
  const local = sameTeamRecord(store, user.teamId, callRecordId);
  const previousTemplateId = local?.callScriptTemplateId || "";
  const visible = resolved.ok && Boolean(local) && outboundCallRecordVisible(local!, user.teamId, resolved.access);
  if (!visible || !local || !resolved.ok) {
    return rejectWithAudit(store, user, {
      callRecordId,
      action: callScriptUsageAction(local ? previousTemplateId : "", parsed.templateId),
      previousTemplateId: local ? previousTemplateId : "",
      nextTemplateId: parsed.templateId,
      reason: "forbidden",
      message: validationMessage("forbidden"),
      status: 403
    });
  }
  if (previousTemplateId === parsed.templateId) {
    return {
      status: 200,
      body: {
        result: "unchanged" as const,
        message: "所用话术没有变化",
        callRecordId: local.id,
        templateId: parsed.templateId,
        record: presented(store, local, user, resolved.access)
      }
    };
  }
  if (parsed.templateId) {
    const template = findTeamTemplate(store, user.teamId, parsed.templateId);
    if (!template) {
      return rejectWithAudit(store, user, {
        callRecordId: local.id,
        action: callScriptUsageAction(previousTemplateId, parsed.templateId),
        previousTemplateId,
        nextTemplateId: parsed.templateId,
        reason: "not_found",
        message: validationMessage("not_found"),
        status: 404
      });
    }
    if (!template.enabled) return reject("disabled", validationMessage("disabled"));
  }
  const action = callScriptUsageAction(previousTemplateId, parsed.templateId);
  local.callScriptTemplateId = parsed.templateId;
  local.callScriptUpdatedAt = outboundInstant().toISOString();
  const audit = await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    callRecordId: local.id,
    action,
    previousTemplateId,
    nextTemplateId: parsed.templateId,
    result: "updated",
    reason: ""
  });
  const message = action === "clear" ? "已清除所用话术" : action === "set" ? "已记下所用话术" : "已更换所用话术";
  return {
    status: 200,
    body: {
      result: "updated" as const,
      message,
      callRecordId: local.id,
      action,
      templateId: parsed.templateId,
      auditId: audit.id,
      record: presented(store, local, user, resolved.access)
    }
  };
}

export async function listCallScriptUsage(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  if (Object.keys(query).length > 0) return reject("invalid_request", validationMessage("invalid_request"));
  if (!canManageCallScripts(user)) {
    return rejectWithAudit(store, user, {
      callRecordId: "",
      action: "read",
      previousTemplateId: "",
      nextTemplateId: "",
      reason: "forbidden",
      message: "只有管理员可以查看话术使用次数",
      status: 403
    });
  }
  return {
    status: 200,
    body: {
      templates: callScriptUsageCounts(store, user.teamId)
    }
  };
}
