import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { CallOutcomeAudit, OutboundCallRecord } from "./types.js";
import {
  buildNegativeOutcomeFollowupQueue,
  parseNegativeFollowupQuery,
  type NegativeFollowupObject
} from "./negative-outcome-followup.js";

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
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...partial
  };
}

function audit(partial: Partial<CallOutcomeAudit> & Pick<CallOutcomeAudit, "callRecordId" | "nextOutcome" | "at">): CallOutcomeAudit {
  return {
    id: `coa_${partial.callRecordId}`,
    teamId: "europe",
    actorId: "u1",
    previousOutcome: "",
    previousNote: "",
    nextNote: "",
    ...partial
  };
}

const objects: NegativeFollowupObject[] = [
  { targetType: "customer", targetId: "c-open", teamId: "europe", name: "Nordic <Tools>", nextFollowAt: "已逾期" },
  { targetType: "customer", targetId: "c-blank", teamId: "europe", name: "空白跟进", nextFollowAt: "   " },
  { targetType: "customer", targetId: "c-empty", teamId: "europe", name: "没有跟进", nextFollowAt: "" },
  { targetType: "customer", targetId: "c-disposition", teamId: "europe", name: "只有话单", nextFollowAt: "明天" },
  { targetType: "customer", targetId: "c-wrong", teamId: "europe", name: "号码错误", nextFollowAt: "明天", suppressed: true },
  { targetType: "customer", targetId: "c-other", teamId: "europe", name: "其他", nextFollowAt: "明天" },
  { targetType: "customer", targetId: "c-positive", teamId: "europe", name: "后来有意向", nextFollowAt: "明天" },
  { targetType: "customer", targetId: "c-undated", teamId: "europe", name: "没有标注时间", nextFollowAt: "明天" },
  { targetType: "lead", targetId: "l-deleted", teamId: "europe", name: "已删除", nextFollowAt: "明天", deleted: true },
  { targetType: "lead", targetId: "l-ok", teamId: "europe", name: "灯具", nextFollowAt: "2026-11-06 09:00" },
  { targetType: "prospect", targetId: "p-ok", teamId: "europe", name: "搜客", nextFollowAt: "2026-11-08 09:00" },
  { targetType: "customer", targetId: "c-asia", teamId: "asia", name: "别的租户", nextFollowAt: "明天" },
  { targetType: "customer", targetId: "c-no-agent", teamId: "europe", name: "没有坐席", nextFollowAt: "明天" }
];

const records = [
  record({ id: "older-positive", targetId: "c-open", callOutcome: "有意向", startTimeRaw: "1000", establishedTimeRaw: "" }),
  record({ id: "latest-negative", targetId: "c-open", callOutcome: "无意向", startTimeRaw: "3000", maskedNumber: "13800138000", agentIds: "agent-a, agent-b" }),
  record({ id: "blank-follow", targetId: "c-blank", callOutcome: "无意向", startTimeRaw: "2500" }),
  record({ id: "empty-follow", targetId: "c-empty", callOutcome: "无意向", startTimeRaw: "2500" }),
  record({ id: "wrong-number", targetId: "c-wrong", callOutcome: "号码错误", startTimeRaw: "2400", contactDisposition: "NoAnswer", establishedTimeRaw: "" }),
  record({ id: "other", targetId: "c-other", callOutcome: "其他", startTimeRaw: "2400" }),
  record({ id: "positive-old", targetId: "c-positive", callOutcome: "无意向", startTimeRaw: "1000" }),
  record({ id: "positive-new", targetId: "c-positive", callOutcome: "需回访", startTimeRaw: "4000" }),
  record({ id: "disposition-only", targetId: "c-disposition", callOutcome: "", contactDisposition: "Success", startTimeRaw: "5000" }),
  record({ id: "deleted", targetId: "l-deleted", targetType: "lead", callOutcome: "无意向", startTimeRaw: "2000" }),
  record({ id: "lead-ok", targetId: "l-ok", targetType: "lead", callOutcome: "无意向", startTimeRaw: "1800", agentIds: "agent-b", createdAt: "", updatedAt: "" }),
  record({ id: "prospect-ok", targetId: "p-ok", targetType: "prospect", callOutcome: "号码错误", startTimeRaw: "1700" }),
  record({ id: "asia", teamId: "asia", targetId: "c-asia", callOutcome: "无意向", startTimeRaw: "3000", maskedNumber: "不要出现" }),
  record({ id: "no-agent", targetId: "c-no-agent", callOutcome: "无意向", agentIds: "", startTimeRaw: "1600" }),
  record({ id: "undated", targetId: "c-undated", callOutcome: "无意向", startTimeRaw: "1500", createdAt: "", updatedAt: "" })
];

const labels = new Map([["agent-a", "Shirley坐席"], ["agent-b", "Mia坐席"]]);
const audits = [
  audit({ callRecordId: "latest-negative", nextOutcome: "无意向", at: "2026-11-04T01:00:00.000Z" }),
  audit({ callRecordId: "latest-negative", nextOutcome: "有意向", at: "2026-11-04T02:00:00.000Z" })
];

assert.deepEqual(parseNegativeFollowupQuery({ scope: "mine" }), { scope: "mine", outcome: "" });
assert.deepEqual(parseNegativeFollowupQuery({ scope: "team", outcome: "号码错误" }), { scope: "team", outcome: "号码错误" });
assert.equal(parseNegativeFollowupQuery({ scope: "all" }), null);
assert.equal(parseNegativeFollowupQuery({ scope: "mine", outcome: "有意向" }), null);
assert.equal(parseNegativeFollowupQuery({ scope: "mine", outcome: "其他" }), null);
assert.equal(parseNegativeFollowupQuery({ scope: "mine", extra: "1" }), null);
assert.equal(parseNegativeFollowupQuery({ scope: ["mine"] }), null);
assert.equal(parseNegativeFollowupQuery({ scope: "mine", outcome: ["无意向"] }), null);

const listed = buildNegativeOutcomeFollowupQueue({
  teamId: "europe",
  records,
  objects,
  audits,
  visible: () => true,
  labels,
  ownAgentIds: null,
  outcome: ""
});
const ids = listed.map((item) => item.targetId);
assert.deepEqual(ids.filter((id) => id === "c-open").length, 1);
assert.equal(ids.includes("c-blank"), false);
assert.equal(ids.includes("c-wrong"), true);
assert.equal(ids.includes("l-ok"), true);
assert.equal(ids.includes("p-ok"), true);
assert.equal(ids.includes("c-no-agent"), true);
assert.equal(ids.includes("c-undated"), true);
assert.equal(ids.includes("c-empty"), false);
assert.equal(ids.includes("c-disposition"), false);
assert.equal(ids.includes("c-other"), false);
assert.equal(ids.includes("c-positive"), false);
assert.equal(ids.includes("l-deleted"), false);
assert.equal(ids.includes("c-asia"), false);
const open = listed.find((item) => item.targetId === "c-open");
assert.ok(open);
assert.equal(open.callRecordId, "latest-negative");
assert.equal(open.outcome, "无意向");
assert.equal(open.labeledAt, "2026-11-04T01:00:00.000Z");
assert.equal(open.maskedNumber.includes("13800138000"), false);
assert.equal(open.agentLabel.includes("Shirley坐席"), true);
assert.equal(open.name, "Nordic <Tools>");
const wrong = listed.find((item) => item.targetId === "c-wrong");
assert.ok(wrong);
assert.match(wrong.suppressionNotice, /不改变抑制状态/);
const undated = listed.find((item) => item.targetId === "c-undated");
assert.equal(undated?.labeledAt, "");
assert.equal(listed.some((item) => item.callRecordId === "disposition-only"), false);
assert.equal("connectRate" in { items: listed }, false);

const filtered = buildNegativeOutcomeFollowupQueue({
  teamId: "europe",
  records,
  objects,
  audits,
  visible: () => true,
  labels,
  ownAgentIds: null,
  outcome: "号码错误"
});
assert.deepEqual(filtered.map((item) => item.targetId).sort(), ["c-wrong", "p-ok"]);

const mine = buildNegativeOutcomeFollowupQueue({
  teamId: "europe",
  records,
  objects,
  audits,
  visible: () => true,
  labels,
  ownAgentIds: ["agent-b"],
  outcome: ""
});
assert.equal(mine.some((item) => item.targetId === "c-open"), true);
assert.equal(mine.some((item) => item.targetId === "l-ok"), true);
assert.equal(mine.some((item) => item.targetId === "c-blank"), false);
assert.deepEqual(buildNegativeOutcomeFollowupQueue({
  teamId: "europe",
  records,
  objects,
  audits,
  visible: () => true,
  labels,
  ownAgentIds: [],
  outcome: ""
}), []);
assert.deepEqual(buildNegativeOutcomeFollowupQueue({
  teamId: "europe",
  records,
  objects,
  audits,
  visible: () => false,
  labels,
  ownAgentIds: null,
  outcome: ""
}), []);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS negative_outcome_followup_audits \(/);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS negative_outcome_followup_audits \(/g) || []).length, 1);
assert.match(schema, /INSERT INTO negative_outcome_followup_audits/);
assert.match(schema, /WHERE NOT EXISTS/);
assert.match(schema, /team_id = ''/);
assert.equal(schema.includes("DROP TABLE negative_outcome_followup_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS negative_outcome_followup_audits"), false);
assert.equal(schema.includes("ALTER TABLE outbound_call_records"), false);
assert.equal(schema.includes("ALTER TABLE callback_schedules"), false);
assert.equal(schema.includes("CREATE TABLE negative_outcome_followups"), false);
assert.equal(schema.includes("CREATE TABLE negative_outcome_calls"), false);

const source = readFileSync(new URL("./negative-outcome-followup.ts", import.meta.url), "utf8");
assert.match(source, /hasOpenNextFollowUp/);
assert.match(source, /isMoreRecentCall/);
assert.match(source, /setProspectNextFollowAt/);
assert.equal(source.includes("CREATE TABLE"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("connectRate"), false);

console.log("negative outcome follow-up tests passed");
