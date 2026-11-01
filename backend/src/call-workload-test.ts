import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CALL_WORKLOAD_TIME_ZONE,
  UNASSIGNED_AGENT_ID,
  buildCallWorkload,
  canViewTeamCallWorkload,
  isHumanClickedCallRecord,
  parseCallWorkloadQuery
} from "./call-workload.js";
import { zonedDateKey } from "./outbound-call.js";
import type { CallWrapupAudit, CallWrapupEditAudit, CallWrapupSkip, OutboundCallAudit, OutboundCallRecord } from "./types.js";

const now = new Date("2026-04-03T16:30:00.000Z");
const today = zonedDateKey(now, CALL_WORKLOAD_TIME_ZONE);
assert.equal(today, "2026-04-04");
const todayMs = String(Date.parse("2026-04-03T16:00:00.000Z"));
const yesterdayMs = String(Date.parse("2026-04-03T15:59:59.000Z"));

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "agentIds">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: partial.id === "no-click" ? "" : "oca_ok",
    targetType: "customer",
    targetId: "c1",
    maskedNumber: "13800138000",
    contactType: "OUTBOUND",
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "",
    establishedTimeRaw: "",
    releaseTimeRaw: todayMs,
    startTimeRaw: todayMs,
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/secret-recording",
    recordingDurationRaw: "999",
    followUpActivityId: "",
    callOutcome: "",
    callOutcomeNote: "",
    callNote: "",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-04-03T16:00:00.000Z",
    updatedAt: "2026-04-03T16:00:00.000Z",
    ...partial
  };
}

const audits: OutboundCallAudit[] = [
  {
    id: "oca_ok",
    teamId: "europe",
    actorId: "u1",
    at: "2026-04-03T16:00:00.000Z",
    targetType: "customer",
    targetId: "c1",
    phoneId: "p1",
    maskedNumber: "138****8000",
    result: "allowed",
    reason: "",
    jobId: "job1"
  },
  {
    id: "oca_rejected",
    teamId: "europe",
    actorId: "u1",
    at: "2026-04-03T16:00:00.000Z",
    targetType: "customer",
    targetId: "c1",
    phoneId: "p1",
    maskedNumber: "138****8000",
    result: "rejected",
    reason: "suppressed",
    jobId: ""
  }
];

assert.equal(isHumanClickedCallRecord(record({ id: "clicked", agentIds: "agent-a" }), audits), true);
assert.equal(isHumanClickedCallRecord(record({ id: "no-click", agentIds: "agent-a", outboundCallAuditId: "" }), audits), false);
assert.equal(isHumanClickedCallRecord(record({ id: "rejected", agentIds: "agent-a", outboundCallAuditId: "oca_rejected" }), audits), false);

const records = [
  record({ id: "done", agentIds: "agent-a", establishedTimeRaw: "1", callDurationRaw: "10" }),
  record({ id: "pending", agentIds: "agent-a", establishedTimeRaw: "1", callDurationRaw: "nope" }),
  record({ id: "skipped", agentIds: "agent-a", callDurationRaw: "3" }),
  record({ id: "open", agentIds: "agent-a", establishedTimeRaw: "1", callDurationRaw: "5", releaseTimeRaw: "" }),
  record({ id: "zero", agentIds: "agent-a", establishedTimeRaw: "1", callDurationRaw: "0" }),
  record({ id: "fraction", agentIds: "agent-a", establishedTimeRaw: "1", callDurationRaw: "1.5" }),
  record({ id: "success-only", agentIds: "agent-a", contactDisposition: "Success", callDurationRaw: "8" }),
  record({ id: "multi", agentIds: "agent-a, agent-b", establishedTimeRaw: "1", callDurationRaw: "4" }),
  record({ id: "no-click", agentIds: "agent-a", outboundCallAuditId: "", establishedTimeRaw: "1", callDurationRaw: "100" }),
  record({ id: "rejected", agentIds: "agent-a", outboundCallAuditId: "oca_rejected", establishedTimeRaw: "1", callDurationRaw: "100" }),
  record({ id: "yesterday", agentIds: "agent-a", startTimeRaw: yesterdayMs, establishedTimeRaw: "1", callDurationRaw: "50" }),
  record({ id: "undated", agentIds: "agent-a", startTimeRaw: "", establishedTimeRaw: "1", callDurationRaw: "7" }),
  record({ id: "blank", agentIds: "", establishedTimeRaw: "1", callDurationRaw: "" }),
  record({ id: "other", teamId: "asia", agentIds: "agent-a", establishedTimeRaw: "1", callDurationRaw: "9" })
];

const wrapups: CallWrapupAudit[] = [
  { id: "w_done", teamId: "europe", actorId: "u1", at: "2026-04-03T16:10:00.000Z", callRecordId: "done", action: "submit", parts: "", addedTagIds: "[]", removedTagIds: "[]", result: "updated", reason: "" },
  { id: "w_rejected", teamId: "europe", actorId: "u1", at: "2026-04-03T16:10:00.000Z", callRecordId: "pending", action: "submit", parts: "", addedTagIds: "[]", removedTagIds: "[]", result: "rejected", reason: "forbidden" },
  { id: "w_old", teamId: "europe", actorId: "u1", at: "2026-04-03T16:10:00.000Z", callRecordId: "yesterday", action: "submit", parts: "", addedTagIds: "[]", removedTagIds: "[]", result: "updated", reason: "" }
];
const skips: CallWrapupSkip[] = [
  { id: "s1", teamId: "europe", actorId: "u1", at: "2026-04-03T16:10:00.000Z", callRecordId: "skipped", reason: "missed", active: true },
  { id: "s2", teamId: "europe", actorId: "u1", at: "2026-04-03T16:10:00.000Z", callRecordId: "fraction", reason: "other", active: false }
];
const edits: CallWrapupEditAudit[] = [
  { id: "e_today", teamId: "europe", actorId: "u1", at: "2026-04-03T16:30:00.000Z", callRecordId: "yesterday", beforeJson: "{}", afterJson: "{}", result: "updated", reason: "" },
  { id: "e_rejected", teamId: "europe", actorId: "u1", at: "2026-04-03T16:40:00.000Z", callRecordId: "done", beforeJson: "{}", afterJson: "{}", result: "rejected", reason: "window_closed" },
  { id: "e_old", teamId: "europe", actorId: "u1", at: "2026-04-03T15:00:00.000Z", callRecordId: "done", beforeJson: "{}", afterJson: "{}", result: "updated", reason: "" },
  { id: "e_blank", teamId: "europe", actorId: "u1", at: "2026-04-03T16:45:00.000Z", callRecordId: "blank", beforeJson: "{}", afterJson: "{}", result: "updated", reason: "" }
];

const roster = new Map([["agent-a", "甲坐席"], ["agent-b", "乙坐席"], ["agent-c", "丙坐席"]]);
const built = buildCallWorkload({
  teamId: "europe",
  today,
  timeZone: CALL_WORKLOAD_TIME_ZONE,
  scope: "team",
  agentId: null,
  ownAgentIds: ["agent-a"],
  roster,
  allowed: new Set(["agent-a", "agent-b", "agent-c"]),
  tenantWide: true,
  records,
  callAudits: audits,
  wrapups,
  skips,
  edits,
  visible: (item) => item.teamId === "europe"
});
const rowA = built.rows.find((item) => item.agentId === "agent-a");
const rowB = built.rows.find((item) => item.agentId === "agent-b");
const rowC = built.rows.find((item) => item.agentId === "agent-c");
const blank = built.rows.find((item) => item.agentId === UNASSIGNED_AGENT_ID);
assert.ok(rowA && rowB && rowC && blank);
assert.equal(rowA.callsMade, 8);
assert.equal(rowA.wrapupCompleted, 1);
assert.equal(rowA.wrapupSkipped, 1);
assert.equal(rowA.wrapupPending, 5);
assert.equal(rowA.correctionsMade, 1);
assert.equal(rowA.talkTimeSeconds, 10 + 5 + 0 + 4);
assert.equal(rowB.callsMade, 1);
assert.equal(rowB.wrapupPending, 1);
assert.equal(rowB.talkTimeSeconds, 4);
assert.equal(rowB.correctionsMade, 0);
assert.equal(rowC.callsMade, 0);
assert.equal(rowC.talkTimeSeconds, null);
assert.equal(blank.callsMade, 1);
assert.equal(blank.wrapupPending, 1);
assert.equal(blank.correctionsMade, 1);
assert.equal(blank.talkTimeSeconds, null);
assert.equal(JSON.stringify(built).includes("13800138000"), false);
assert.equal(JSON.stringify(built).includes("secret-recording"), false);
assert.equal(JSON.stringify(built).includes("接通率"), false);

const self = buildCallWorkload({
  teamId: "europe",
  today,
  timeZone: CALL_WORKLOAD_TIME_ZONE,
  scope: "self",
  agentId: null,
  ownAgentIds: ["agent-a"],
  roster: new Map([["agent-a", "甲坐席"]]),
  allowed: new Set(["agent-a"]),
  tenantWide: false,
  records,
  callAudits: audits,
  wrapups,
  skips,
  edits,
  visible: (item) => item.teamId === "europe" && item.agentIds.includes("agent-a")
});
assert.equal(self.rows.length, 1);
assert.equal(self.rows[0]?.agentId, "agent-a");
assert.equal(self.rows.some((item) => item.agentId === "agent-b"), false);

assert.equal(parseCallWorkloadQuery({ scope: "self" })?.scope, "self");
assert.equal(parseCallWorkloadQuery({ scope: "team", agentId: "none" })?.agentId, "none");
assert.equal(parseCallWorkloadQuery({ scope: "self", agentId: "agent-a" }), null);
assert.equal(parseCallWorkloadQuery({ scope: "team", agentId: ["agent-a"] }), null);
assert.equal(parseCallWorkloadQuery({ scope: "all" }), null);
assert.equal(parseCallWorkloadQuery({ scope: "team", plaintext: "1" }), null);
assert.equal(canViewTeamCallWorkload({ role: "sales" }), false);
assert.equal(canViewTeamCallWorkload({ role: "manager" }), true);
assert.equal(canViewTeamCallWorkload({ role: "admin" }), true);
assert.equal(canViewTeamCallWorkload({ role: "super_admin" }), true);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_workload_view_audits \(/);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS call_workload_view_audits \(/g) || []).length, 1);
assert.match(schema, /INSERT INTO call_workload_view_audits/);
assert.match(schema, /WHERE NOT EXISTS/);
assert.match(schema, /team_id = ''/);
assert.equal(schema.includes("DROP TABLE call_workload_view_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS call_workload_view_audits"), false);
assert.equal(schema.includes("ALTER TABLE call_workload_view_audits"), false);
assert.equal(schema.includes("DROP TABLE call_wrapup_audits"), false);
assert.equal(schema.includes("DROP TABLE call_wrapup_skips"), false);
assert.equal(schema.includes("DROP TABLE call_wrapup_edit_audits"), false);
assert.equal(schema.includes("DROP TABLE outbound_call_records"), false);

const source = readFileSync(new URL("./call-workload.ts", import.meta.url), "utf8");
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.match(source, /isHumanClickedCallRecord/);
assert.match(source, /call_wrapup/);
assert.match(source, /talkTimeSeconds === null|talkSamples === 0/);

console.log("call workload unit tests passed");
