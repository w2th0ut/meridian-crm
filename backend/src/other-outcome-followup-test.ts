import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { CallOutcomeAudit, OutboundCallRecord } from "./types.js";
import {
  buildOtherOutcomeFollowupQueue,
  parseOtherFollowupQuery,
  type OtherFollowupObject
} from "./other-outcome-followup.js";

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    targetType: "customer",
    targetId: "c1",
    maskedNumber: "****8000",
    contactType: "OUTBOUND",
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: "2000",
    agentIds: "agent-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "",
    callOutcomeNote: "",
    callNote: "",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
    ...partial
  };
}

function object(partial: Partial<OtherFollowupObject> & Pick<OtherFollowupObject, "targetId">): OtherFollowupObject {
  return {
    targetType: "customer",
    teamId: "europe",
    name: partial.targetId,
    nextFollowAt: "",
    ...partial
  };
}

function audit(partial: Partial<CallOutcomeAudit> & Pick<CallOutcomeAudit, "callRecordId">): CallOutcomeAudit {
  return {
    id: `coa_${partial.callRecordId}`,
    teamId: "europe",
    actorId: "u1",
    at: "2026-11-03T00:00:00.000Z",
    previousOutcome: "",
    nextOutcome: "其他",
    previousNote: "",
    nextNote: "",
    ...partial
  };
}

const objects: OtherFollowupObject[] = [
  object({ targetId: "c-open", name: "已接通其他", nextFollowAt: "" }),
  object({ targetId: "c-blank", name: "空白跟进", nextFollowAt: "   " }),
  object({ targetId: "c-has", name: "已有跟进", nextFollowAt: "下周" }),
  object({ targetId: "c-miss", name: "未接通其他" }),
  object({ targetId: "c-space", name: "空白接通" }),
  object({ targetId: "c-positive", name: "后来有意向" }),
  object({ targetId: "c-negative", name: "无意向" }),
  object({ targetId: "c-disposition", name: "只有话单" }),
  object({ targetId: "c-trim", name: "不是其他" }),
  object({ targetId: "c-padded", name: "两侧空白" }),
  object({ targetId: "l-deleted", targetType: "lead", name: "已删除", nextFollowAt: "", deleted: true }),
  object({ targetId: "l-ok", targetType: "lead", name: "线索", nextFollowAt: "" }),
  object({ targetId: "p-ok", targetType: "prospect", name: "搜客", nextFollowAt: "" }),
  object({ targetId: "c-asia", teamId: "asia", name: "别的租户" }),
  object({ targetId: "c-no-agent", name: "没有坐席" }),
  object({ targetId: "c-undated", name: "没有标注时间" })
];

const records: OutboundCallRecord[] = [
  record({ id: "older-other", targetId: "c-open", callOutcome: "无意向", startTimeRaw: "1000", establishedTimeRaw: "" }),
  record({ id: "latest-other", targetId: "c-open", callOutcome: "其他", startTimeRaw: "3000", maskedNumber: "13800138000", agentIds: "agent-a, agent-b" }),
  record({ id: "blank-follow", targetId: "c-blank", callOutcome: "其他", startTimeRaw: "2500" }),
  record({ id: "has-follow", targetId: "c-has", callOutcome: "其他", startTimeRaw: "2500" }),
  record({ id: "missed", targetId: "c-miss", callOutcome: "其他", startTimeRaw: "2400", contactDisposition: "NoAnswer", establishedTimeRaw: "" }),
  record({ id: "space-established", targetId: "c-space", callOutcome: "其他", startTimeRaw: "2400", establishedTimeRaw: "   " }),
  record({ id: "positive-old", targetId: "c-positive", callOutcome: "其他", startTimeRaw: "1000" }),
  record({ id: "positive-new", targetId: "c-positive", callOutcome: "有意向", startTimeRaw: "4000" }),
  record({ id: "negative", targetId: "c-negative", callOutcome: "无意向", startTimeRaw: "2400" }),
  record({ id: "disposition-only", targetId: "c-disposition", callOutcome: "", contactDisposition: "Success", startTimeRaw: "5000" }),
  record({ id: "trimmed", targetId: "c-trim", callOutcome: "其他。", startTimeRaw: "2300" }),
  record({ id: "padded", targetId: "c-padded", callOutcome: " 其他 ", startTimeRaw: "2300" }),
  record({ id: "deleted", targetId: "l-deleted", targetType: "lead", callOutcome: "其他", startTimeRaw: "2000" }),
  record({ id: "lead-ok", targetId: "l-ok", targetType: "lead", callOutcome: "其他", startTimeRaw: "1800", agentIds: "agent-b", createdAt: "", updatedAt: "" }),
  record({ id: "prospect-ok", targetId: "p-ok", targetType: "prospect", callOutcome: "其他", startTimeRaw: "1700" }),
  record({ id: "asia", teamId: "asia", targetId: "c-asia", callOutcome: "其他", startTimeRaw: "3000", maskedNumber: "不要出现" }),
  record({ id: "no-agent", targetId: "c-no-agent", callOutcome: "其他", agentIds: "", startTimeRaw: "1600" }),
  record({ id: "undated", targetId: "c-undated", callOutcome: "其他", startTimeRaw: "1500", createdAt: "", updatedAt: "" })
];

const audits = [
  audit({ callRecordId: "latest-other", nextOutcome: "其他", at: "2026-11-04T01:00:00.000Z" }),
  audit({ callRecordId: "latest-other", nextOutcome: "有意向", at: "2026-11-04T02:00:00.000Z" })
];

const labels = new Map([["agent-a", "甲坐席"], ["agent-b", "乙坐席"]]);

assert.deepEqual(parseOtherFollowupQuery({ scope: "mine" }), { scope: "mine" });
assert.deepEqual(parseOtherFollowupQuery({ scope: "team" }), { scope: "team" });
assert.equal(parseOtherFollowupQuery({ scope: "all" }), null);
assert.equal(parseOtherFollowupQuery({ scope: "mine", outcome: "其他" }), null);
assert.equal(parseOtherFollowupQuery({ scope: ["mine"] }), null);
assert.equal(parseOtherFollowupQuery({}), null);

const rows = buildOtherOutcomeFollowupQueue({
  teamId: "europe",
  records,
  objects,
  audits,
  visible: () => true,
  labels,
  ownAgentIds: null
});
const ids = rows.map((item) => item.targetId);
for (const id of ["c-open", "c-blank", "c-padded", "l-ok", "p-ok", "c-no-agent", "c-undated"]) {
  assert.equal(ids.includes(id), true, id);
}
for (const id of ["c-has", "c-miss", "c-space", "c-positive", "c-negative", "c-disposition", "c-trim", "l-deleted", "c-asia"]) {
  assert.equal(ids.includes(id), false, id);
}
const open = rows.find((item) => item.targetId === "c-open");
assert.ok(open);
assert.equal(open.outcome, "其他");
assert.equal(open.labeledAt, "2026-11-04T01:00:00.000Z");
assert.equal(open.nextFollowAt, "");
assert.equal(open.agentLabel, "甲坐席、乙坐席");
assert.equal(open.maskedNumber.includes("13800138000"), false);
assert.equal(open.callRecordId, "latest-other");
const undated = rows.find((item) => item.targetId === "c-undated");
assert.equal(undated?.labeledAt, "");
const lead = rows.find((item) => item.targetId === "l-ok");
assert.equal(lead?.labeledAt, "");

const mine = buildOtherOutcomeFollowupQueue({
  teamId: "europe",
  records,
  objects,
  audits,
  visible: () => true,
  labels,
  ownAgentIds: ["agent-b"]
});
assert.equal(mine.some((item) => item.targetId === "c-open"), true);
assert.equal(mine.some((item) => item.targetId === "l-ok"), true);
assert.equal(mine.some((item) => item.targetId === "c-blank"), false);
assert.deepEqual(buildOtherOutcomeFollowupQueue({
  teamId: "europe",
  records,
  objects,
  audits,
  visible: () => true,
  labels,
  ownAgentIds: []
}), []);
assert.deepEqual(buildOtherOutcomeFollowupQueue({
  teamId: "europe",
  records,
  objects,
  audits,
  visible: () => false,
  labels,
  ownAgentIds: null
}), []);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS other_outcome_followup_audits \(/);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS other_outcome_followup_audits \(/g) || []).length, 1);
assert.match(schema, /INSERT INTO other_outcome_followup_audits/);
assert.match(schema, /WHERE NOT EXISTS/);
assert.match(schema, /team_id = ''/);
assert.equal(schema.includes("DROP TABLE other_outcome_followup_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS other_outcome_followup_audits"), false);
assert.equal(schema.includes("ALTER TABLE outbound_call_records"), false);
assert.equal(schema.includes("ALTER TABLE callback_schedules"), false);
assert.equal(schema.includes("CREATE TABLE other_outcome_followups"), false);
assert.equal(schema.includes("CREATE TABLE other_outcome_calls"), false);

const source = readFileSync(new URL("./other-outcome-followup.ts", import.meta.url), "utf8");
assert.match(source, /hasOpenNextFollowUp/);
assert.match(source, /isMoreRecentCall/);
assert.match(source, /isEstablishedCall/);
assert.match(source, /setProspectNextFollowAt/);
assert.match(source, /suggestedMissedFollowAt/);
assert.equal(source.includes("CREATE TABLE"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("connectRate"), false);

console.log("other outcome follow-up tests passed");
