import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCallScriptReport,
  buildCallScriptReportCsv,
  callScriptReportFiltersText,
  formatCallScriptReportAverage,
  parseCallScriptReportQuery
} from "./call-script-report.js";
import type { CallScriptTemplate, CallbackSchedule, CrmStore, OutboundCallRecord } from "./types.js";

assert.deepEqual(parseCallScriptReportQuery({}), { from: null, to: null, agentId: null, scenario: null });
assert.deepEqual(parseCallScriptReportQuery({ from: "2026-04-04", to: "2026-04-05", agentId: "agent@ccc-a", scenario: "first_call" }), {
  from: "2026-04-04",
  to: "2026-04-05",
  agentId: "agent@ccc-a",
  scenario: "first_call"
});
assert.equal(parseCallScriptReportQuery({ from: "2026-04-06", to: "2026-04-05" }), null);
assert.equal(parseCallScriptReportQuery({ scenario: "nope" }), null);
assert.equal(parseCallScriptReportQuery({ agentId: "bad id" }), null);
assert.equal(parseCallScriptReportQuery({ from: ["2026-04-04"] }), null);
assert.equal(parseCallScriptReportQuery({ note: "has" }), null);
assert.equal(callScriptReportFiltersText({ from: "2026-04-04", to: null, agentId: null, scenario: "follow_up" }).includes("13800138000"), false);

function template(partial: Partial<CallScriptTemplate> & Pick<CallScriptTemplate, "id" | "title" | "scenario">): CallScriptTemplate {
  return {
    teamId: "europe",
    language: "zh",
    body: "报表正文勿出现",
    enabled: true,
    createdBy: "u_admin",
    updatedBy: "u_admin",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    disabledAt: "",
    ...partial
  };
}

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    targetType: "customer",
    targetId: "c1",
    maskedNumber: "*******8000",
    contactType: "OUTBOUND",
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "10",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: String(Date.parse("2026-04-03T16:30:00.000Z")),
    agentIds: "agent@ccc-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/do-not-leak-script-report",
    recordingDurationRaw: "99",
    followUpActivityId: "",
    callOutcome: "",
    callOutcomeNote: "",
    callNote: "",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

function schedule(partial: Partial<CallbackSchedule> & Pick<CallbackSchedule, "id" | "sourceCallRecordId">): CallbackSchedule {
  return {
    teamId: "europe",
    targetType: "customer",
    targetId: partial.id,
    scheduledAt: "2026-04-05 09:00",
    note: "",
    updatedBy: "u_admin",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

const store = {
  callScriptTemplates: [
    template({ id: "cst_b", title: "回访", scenario: "follow_up" }),
    template({ id: "cst_a", title: "=开场", scenario: "first_call" }),
    template({ id: "cst_c", title: "旧话术", scenario: "objection", enabled: false, disabledAt: "2026-04-02T00:00:00.000Z" }),
    template({ id: "cst_d", title: "未用", scenario: "missed_callback" }),
    template({ id: "cst_asia", title: "亚洲", scenario: "first_call", teamId: "asia", body: "亚洲正文勿出现" })
  ],
  outboundCallRecords: [
    record({ id: "ocr_a1", callScriptTemplateId: "cst_a", callOutcome: "有意向", callDurationRaw: "10", agentIds: "agent@ccc-a,agent@ccc-b" }),
    record({ id: "ocr_a2", callScriptTemplateId: "cst_a", callOutcome: "需回访", callDurationRaw: "20", establishedTimeRaw: "1" }),
    record({ id: "ocr_a3", callScriptTemplateId: "cst_a", callOutcome: "无意向", establishedTimeRaw: "", callDurationRaw: "99", contactDisposition: "Success" }),
    record({ id: "ocr_a4", callScriptTemplateId: "cst_a", callOutcome: "号码错误", callDurationRaw: "10.5" }),
    record({ id: "ocr_a5", callScriptTemplateId: "cst_a", callOutcome: "其他" }),
    record({ id: "ocr_a6", callScriptTemplateId: "cst_a", callOutcome: "不在五项里" }),
    record({ id: "ocr_old", callScriptTemplateId: "cst_a", startTimeRaw: String(Date.parse("2026-04-03T15:00:00.000Z")) }),
    record({ id: "ocr_b", callScriptTemplateId: "cst_b", callOutcome: "有意向", agentIds: "agent@ccc-b" }),
    record({ id: "ocr_c", callScriptTemplateId: "cst_c", callOutcome: "有意向", callDurationRaw: "8" }),
    record({ id: "ocr_none", callScriptTemplateId: "" }),
    record({ id: "ocr_missing", callScriptTemplateId: "cst_missing" }),
    record({ id: "ocr_blank_agent", callScriptTemplateId: "cst_a", agentIds: "" }),
    record({ id: "ocr_asia", teamId: "asia", callScriptTemplateId: "cst_asia", agentIds: "agent@ccc-asia" })
  ],
  callbackSchedules: [
    schedule({ id: "cb_a", targetId: "c_a", sourceCallRecordId: "ocr_a1" }),
    schedule({ id: "cb_none", targetId: "c_none", sourceCallRecordId: "ocr_none" }),
    schedule({ id: "cb_old", targetId: "c_old", sourceCallRecordId: "ocr_old" }),
    schedule({ id: "cb_empty", targetId: "c_empty", sourceCallRecordId: "" }),
    schedule({ id: "cb_asia", teamId: "asia", targetId: "c_asia", sourceCallRecordId: "ocr_a1" })
  ]
} as Pick<CrmStore, "callScriptTemplates" | "outboundCallRecords" | "callbackSchedules">;

const rows = buildCallScriptReport({
  store,
  teamId: "europe",
  query: { from: "2026-04-04", to: "2026-04-04", agentId: null, scenario: null },
  timeZone: "Asia/Shanghai"
});
assert.deepEqual(rows.map((item) => item.templateId), ["cst_a", "cst_b", "cst_c", "cst_d", ""]);
const opening = rows.find((item) => item.templateId === "cst_a");
assert.ok(opening);
assert.equal(opening.callCount, 7);
assert.equal(opening.connectedCount, 6);
assert.equal(opening.outcomes["有意向"], 1);
assert.equal(opening.outcomes["需回访"], 1);
assert.equal(opening.outcomes["无意向"], 1);
assert.equal(opening.outcomes["号码错误"], 1);
assert.equal(opening.outcomes["其他"], 1);
assert.equal(opening.outcomes["未标注"], 2);
assert.equal(opening.averageConnectedDurationSeconds, 12);
assert.equal(opening.callbackAppointmentCount, 1);
assert.equal(rows.find((item) => item.templateId === "cst_d")?.callCount, 0);
assert.equal(rows.find((item) => item.templateId === "cst_d")?.averageConnectedDurationSeconds, null);
assert.equal(rows.find((item) => item.templateId === "cst_c")?.enabled, false);
assert.equal(rows.find((item) => item.templateId === "cst_c")?.callCount, 1);
const unlinked = rows.find((item) => item.linked === false);
assert.ok(unlinked);
assert.equal(unlinked.title, "未选用");
assert.equal(unlinked.templateId, "");
assert.equal(unlinked.callCount, 2);
assert.equal(unlinked.callbackAppointmentCount, 1);
assert.equal(JSON.stringify(rows).includes("cst_missing"), false);
assert.equal(JSON.stringify(rows).includes("cst_asia"), false);
assert.equal(JSON.stringify(rows).includes("报表正文勿出现"), false);
assert.equal(JSON.stringify(rows).includes("do-not-leak-script-report"), false);
assert.equal(JSON.stringify(rows).includes("connectRate"), false);
assert.equal(JSON.stringify(rows).includes("*******8000"), false);

const byAgent = buildCallScriptReport({
  store,
  teamId: "europe",
  query: { from: null, to: null, agentId: "agent@ccc-b", scenario: null },
  timeZone: "Asia/Shanghai"
});
assert.equal(byAgent.find((item) => item.templateId === "cst_a")?.callCount, 1);
assert.equal(byAgent.find((item) => item.templateId === "cst_b")?.callCount, 1);
assert.equal(byAgent.find((item) => item.linked === false)?.callCount, 0);

const byScenario = buildCallScriptReport({
  store,
  teamId: "europe",
  query: { from: null, to: null, agentId: null, scenario: "first_call" },
  timeZone: "Asia/Shanghai"
});
assert.deepEqual(byScenario.map((item) => item.templateId), ["cst_a"]);
assert.equal(byScenario.some((item) => item.linked === false), false);

assert.equal(formatCallScriptReportAverage(null), "");
assert.equal(formatCallScriptReportAverage(15), "15");
assert.equal(formatCallScriptReportAverage(10.5), "10.5");

const csv = buildCallScriptReportCsv(rows);
assert.equal(csv.startsWith("\uFEFF"), true);
assert.match(csv, /\r\n/);
assert.match(csv, /话术,场景,启用,通话数,接通数,有意向,需回访,无意向,号码错误,其他,未标注,平均通话时长秒,回拨预约数/);
assert.match(csv, /'=开场/);
assert.equal(csv.includes("报表正文勿出现"), false);
assert.equal(csv.includes("do-not-leak-script-report"), false);
assert.equal(csv.includes("*******8000"), false);
assert.equal(csv.includes("接通率"), false);
const unused = csv.split("\r\n").find((line) => line.startsWith("未用,"));
assert.ok(unused);
assert.equal(unused.endsWith(",,"), false);
assert.match(unused, /,0,0,0,0,0,0,0,0,,0$/);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_script_report_audits \(/);
assert.match(schema, /idx_call_script_report_audits_team/);
assert.equal(schema.includes("CREATE TABLE call_script_report_audits"), false);
assert.equal(schema.includes("DROP TABLE call_script_report_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS call_script_templates"), false);
assert.equal(schema.includes("DROP TABLE call_script_templates"), false);
assert.equal(schema.includes("ALTER TABLE call_script_templates"), false);
assert.equal(schema.includes("ALTER TABLE outbound_call_records"), false);
assert.equal(schema.includes("ALTER TABLE callback_schedules"), false);

const source = readFileSync(new URL("./call-script-report.ts", import.meta.url), "utf8");
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("requestOutboundCall"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("fetch("), false);
assert.equal(source.includes("connectRate"), false);

console.log("call script report unit tests passed");
