import { randomUUID } from "node:crypto";
import { escapeCsvCell } from "./call-export.js";
import { CALL_SCRIPT_SCENARIOS, canManageCallScripts } from "./call-script.js";
import { callScriptScenarioChoices, knownScenarioCodes, scenarioLabelFor } from "./call-script-scenario.js";
import { outboundInstant, tenantTimeZoneFor } from "./outbound-call.js";
import {
  CALL_OUTCOMES,
  callLocalDate,
  countCallOutcomes,
  isCallOutcome,
  isEstablishedCall,
  parseCallDurationSeconds,
  recordInDateRange,
  splitAgentIds,
  type CallOutcome
} from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";
import type { AliyunAgentMapping, CallScriptReportAudit, CallScriptScenario, CallbackSchedule, OutboundCallRecord, SessionUser } from "./types.js";

/**
 * 话术效果对比。按 §73 记下的模板 ID 把通话分到 §72 的模板上。
 * 数字只用来仓库里已经有的字段：通话条数、EstablishedTime、人工通话结果、
 * 接通且为整数秒的 CallDuration，以及回拨预约的 sourceCallRecordId。
 * 不计算接通率或评分。不拨号，不发信，不调用外部接口。
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AGENT_PATTERN = /^[A-Za-z0-9_@.:-]{1,128}$/;
const UNLABELED_OUTCOME = "未标注";

export const CALL_SCRIPT_REPORT_OUTCOME_KEYS = [...CALL_OUTCOMES, UNLABELED_OUTCOME] as const;
export const CALL_SCRIPT_REPORT_HEADERS = [
  "话术",
  "场景",
  "启用",
  "通话数",
  "接通数",
  "有意向",
  "需回访",
  "无意向",
  "号码错误",
  "其他",
  "未标注",
  "平均通话时长秒",
  "回拨预约数"
] as const;

/**
 * 这五项字段都在仓库里，所以报表展示它们。
 * 接通率不在此列：没有单独的字段，这里不另造比率。
 */
export const CALL_SCRIPT_REPORT_METRICS = {
  callCount: true,
  connectedCount: true,
  outcomes: true,
  averageConnectedDurationSeconds: true,
  callbackAppointmentCount: true
} as const;

export interface CallScriptReportQuery {
  from: string | null;
  to: string | null;
  agentId: string | null;
  scenario: CallScriptScenario | null;
}

export interface CallScriptReportOutcomes extends Record<CallOutcome, number> {
  未标注: number;
}

export interface CallScriptReportRow {
  templateId: string;
  title: string;
  scenario: string;
  scenarioLabel: string;
  enabled: boolean | null;
  linked: boolean;
  callCount: number;
  connectedCount: number;
  outcomes: CallScriptReportOutcomes;
  averageConnectedDurationSeconds: number | null;
  callbackAppointmentCount: number;
}

export interface CallScriptReportAgentOption {
  id: string;
  label: string;
}

const SCENARIO_IDS = new Set(CALL_SCRIPT_SCENARIOS.map((item) => item.id));

function isScenario(value: string): value is CallScriptScenario {
  return SCENARIO_IDS.has(value as CallScriptScenario);
}

function oneQuery(value: unknown) {
  if (Array.isArray(value)) return null;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value.trim() : null;
}

function validDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseCallScriptReportQuery(query: Record<string, unknown>, scenarios?: ReadonlySet<string>): CallScriptReportQuery | null {
  const allowed = new Set(["from", "to", "agentId", "scenario"]);
  if (Object.keys(query).some((key) => !allowed.has(key))) return null;
  if (Object.values(query).some((value) => Array.isArray(value))) return null;
  const fromRaw = oneQuery(query.from);
  const toRaw = oneQuery(query.to);
  const agentRaw = oneQuery(query.agentId);
  const scenarioRaw = oneQuery(query.scenario);
  if (fromRaw === null || toRaw === null || agentRaw === null || scenarioRaw === null) return null;
  const from = fromRaw || null;
  const to = toRaw || null;
  const agentId = agentRaw || null;
  if (from && !validDate(from)) return null;
  if (to && !validDate(to)) return null;
  if (from && to && from > to) return null;
  if (agentId && !AGENT_PATTERN.test(agentId)) return null;
  let scenario: CallScriptScenario | null = null;
  if (scenarioRaw) {
    const known = scenarios ? scenarios.has(scenarioRaw) : isScenario(scenarioRaw);
    if (!known) return null;
    scenario = scenarioRaw;
  }
  return { from, to, agentId, scenario };
}

export function callScriptReportFiltersText(query: CallScriptReportQuery) {
  return JSON.stringify({
    agentId: query.agentId || "",
    from: query.from || "",
    to: query.to || "",
    scenario: query.scenario || ""
  });
}

export function selectCallScriptReportRecords(input: {
  records: OutboundCallRecord[];
  teamId: string;
  agentId: string | null;
  from: string | null;
  to: string | null;
  timeZone: string;
}) {
  return input.records.filter((record) => {
    if (record.teamId !== input.teamId) return false;
    if (input.agentId && !splitAgentIds(record.agentIds).includes(input.agentId)) return false;
    return recordInDateRange(callLocalDate(record.startTimeRaw, input.timeZone), input.from, input.to);
  });
}

function emptyOutcomes(): CallScriptReportOutcomes {
  return {
    "有意向": 0,
    "需回访": 0,
    "无意向": 0,
    "号码错误": 0,
    "其他": 0,
    "未标注": 0
  };
}

function summarizeGroup(records: OutboundCallRecord[], schedules: CallbackSchedule[], teamId: string): Pick<
  CallScriptReportRow,
  "callCount" | "connectedCount" | "outcomes" | "averageConnectedDurationSeconds" | "callbackAppointmentCount"
> {
  const outcomes = emptyOutcomes();
  const labeled = countCallOutcomes(records);
  for (const key of CALL_OUTCOMES) outcomes[key] = labeled[key];
  let connectedCount = 0;
  let durationCount = 0;
  let durationSum = 0;
  const ids = new Set<string>();
  for (const record of records) {
    ids.add(record.id);
    if (!isCallOutcome(record.callOutcome || "")) outcomes["未标注"] += 1;
    if (!isEstablishedCall(record.establishedTimeRaw)) continue;
    connectedCount += 1;
    const seconds = parseCallDurationSeconds(record.callDurationRaw);
    if (seconds === null) continue;
    durationCount += 1;
    durationSum += seconds;
  }
  let callbackAppointmentCount = 0;
  for (const schedule of schedules) {
    if (schedule.teamId !== teamId) continue;
    const source = (schedule.sourceCallRecordId || "").trim();
    if (!source || !ids.has(source)) continue;
    callbackAppointmentCount += 1;
  }
  return {
    callCount: records.length,
    connectedCount,
    outcomes,
    averageConnectedDurationSeconds: durationCount === 0 ? null : durationSum / durationCount,
    callbackAppointmentCount
  };
}

function agentLabel(mapping: AliyunAgentMapping | undefined, id: string) {
  return mapping?.displayName || mapping?.loginName || id;
}

export function callScriptReportAgents(store: Pick<CrmStore, "aliyunAgentMappings" | "outboundCallRecords">, teamId: string): CallScriptReportAgentOption[] {
  const mappings = store.aliyunAgentMappings.filter((item) => item.teamId === teamId);
  const labels = new Map(mappings.map((item) => [item.cccUserId, agentLabel(item, item.cccUserId)]));
  const ids = new Set(mappings.map((item) => item.cccUserId));
  for (const record of store.outboundCallRecords) {
    if (record.teamId !== teamId) continue;
    for (const id of splitAgentIds(record.agentIds)) ids.add(id);
  }
  return [...ids]
    .map((id) => ({ id, label: labels.get(id) || id }))
    .sort((left, right) => left.label.localeCompare(right.label, "zh") || left.id.localeCompare(right.id));
}

export function buildCallScriptReport(input: {
  store: Pick<CrmStore, "callScriptTemplates" | "outboundCallRecords" | "callbackSchedules"> & { callScriptScenarios?: CrmStore["callScriptScenarios"] };
  teamId: string;
  query: CallScriptReportQuery;
  timeZone: string;
}): CallScriptReportRow[] {
  const selected = selectCallScriptReportRecords({
    records: input.store.outboundCallRecords,
    teamId: input.teamId,
    agentId: input.query.agentId,
    from: input.query.from,
    to: input.query.to,
    timeZone: input.timeZone
  });
  const templates = input.store.callScriptTemplates
    .filter((item) => item.teamId === input.teamId && (!input.query.scenario || item.scenario === input.query.scenario))
    .slice()
    .sort((left, right) => left.title.localeCompare(right.title, "zh") || left.id.localeCompare(right.id));
  const buckets = new Map<string, OutboundCallRecord[]>(templates.map((item) => [item.id, []]));
  const unlinked: OutboundCallRecord[] = [];
  for (const record of selected) {
    const templateId = (record.callScriptTemplateId || "").trim();
    const bucket = templateId ? buckets.get(templateId) : undefined;
    if (bucket) bucket.push(record);
    else if (!input.query.scenario) unlinked.push(record);
  }
  const schedules = input.store.callbackSchedules;
  const rows: CallScriptReportRow[] = templates.map((template) => ({
    templateId: template.id,
    title: template.title,
    scenario: template.scenario,
    scenarioLabel: scenarioLabelFor(input.store, input.teamId, template.scenario),
    enabled: template.enabled,
    linked: true,
    ...summarizeGroup(buckets.get(template.id) || [], schedules, input.teamId)
  }));
  if (!input.query.scenario) {
    rows.push({
      templateId: "",
      title: "未选用",
      scenario: "",
      scenarioLabel: "",
      enabled: null,
      linked: false,
      ...summarizeGroup(unlinked, schedules, input.teamId)
    });
  }
  return rows;
}

/** 没有可计入的整数秒时留空，不写成 0。有值时保留一位小数，整数不带小数。 */
export function formatCallScriptReportAverage(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function callScriptReportCsvRow(row: CallScriptReportRow) {
  return [
    row.title,
    row.scenarioLabel,
    row.linked ? (row.enabled ? "是" : "否") : "",
    String(row.callCount),
    String(row.connectedCount),
    String(row.outcomes["有意向"]),
    String(row.outcomes["需回访"]),
    String(row.outcomes["无意向"]),
    String(row.outcomes["号码错误"]),
    String(row.outcomes["其他"]),
    String(row.outcomes["未标注"]),
    formatCallScriptReportAverage(row.averageConnectedDurationSeconds),
    String(row.callbackAppointmentCount)
  ];
}

export function buildCallScriptReportCsv(rows: CallScriptReportRow[]) {
  const lines = [CALL_SCRIPT_REPORT_HEADERS as unknown as string[], ...rows.map(callScriptReportCsvRow)]
    .map((line) => line.map((cell) => escapeCsvCell(cell)).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function reject(reason: string, message: string, status = 400) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

async function writeAudit(store: CrmStore, input: Omit<CallScriptReportAudit, "id" | "at">) {
  const audit: CallScriptReportAudit = {
    id: `csrp_${randomUUID()}`,
    at: outboundInstant().toISOString(),
    ...input
  };
  store.callScriptReportAudits.unshift(audit);
  await store.persist();
  return audit;
}

async function rejectForbidden(store: CrmStore, user: SessionUser, action: CallScriptReportAudit["action"], filters: string, message: string) {
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action,
    filters,
    rowCount: 0,
    result: "rejected",
    reason: "forbidden"
  });
  return reject("forbidden", message, 403);
}

function reportBody(store: CrmStore, teamId: string, query: CallScriptReportQuery, timeZone: string) {
  const rows = buildCallScriptReport({ store, teamId, query, timeZone });
  return {
    filters: {
      from: query.from || "",
      to: query.to || "",
      agentId: query.agentId || "",
      scenario: query.scenario || ""
    },
    agents: callScriptReportAgents(store, teamId),
    scenarios: callScriptScenarioChoices(store, teamId),
    metrics: CALL_SCRIPT_REPORT_METRICS,
    rows
  };
}

export async function listCallScriptReport(store: CrmStore, user: SessionUser | undefined, query: Record<string, unknown>) {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallScriptReportQuery(query, knownScenarioCodes(store, user.teamId));
  if (!parsed) return reject("invalid_request", "参数格式错误");
  const filters = callScriptReportFiltersText(parsed);
  if (!canManageCallScripts(user)) {
    return rejectForbidden(store, user, "read", filters, "只有管理员可以查看话术效果对比");
  }
  const timeZone = await tenantTimeZoneFor(store, user.teamId);
  const body = reportBody(store, user.teamId, parsed, timeZone);
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "read",
    filters,
    rowCount: body.rows.length,
    result: "read",
    reason: ""
  });
  return { status: 200, body };
}

export type CallScriptReportExportResponse =
  | { status: 200; csv: string; filename: string }
  | { status: number; body: Record<string, unknown> };

export async function exportCallScriptReport(
  store: CrmStore,
  user: SessionUser | undefined,
  query: Record<string, unknown>
): Promise<CallScriptReportExportResponse> {
  if (!user?.id || !user.teamId) return { status: 401, body: { message: "未登录" } };
  const parsed = parseCallScriptReportQuery(query, knownScenarioCodes(store, user.teamId));
  if (!parsed) return reject("invalid_request", "参数格式错误");
  const filters = callScriptReportFiltersText(parsed);
  if (!canManageCallScripts(user)) {
    return rejectForbidden(store, user, "export", filters, "只有管理员可以导出话术效果对比");
  }
  const timeZone = await tenantTimeZoneFor(store, user.teamId);
  const rows = buildCallScriptReport({ store, teamId: user.teamId, query: parsed, timeZone });
  await writeAudit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "export",
    filters,
    rowCount: rows.length,
    result: "exported",
    reason: ""
  });
  return { status: 200, csv: buildCallScriptReportCsv(rows), filename: "话术效果对比.csv" };
}
