import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildIntentFollowupQueue,
  hasOpenNextFollowUp,
  isIntentFollowupOutcome,
  isMoreRecentCall,
  type IntentFollowupObjectSnapshot
} from "./intent-followup-queue.js";
import type { CallOutcomeAudit, OutboundCallRecord } from "./types.js";

assert.equal(isIntentFollowupOutcome("有意向"), true);
assert.equal(isIntentFollowupOutcome("需回访"), true);
assert.equal(isIntentFollowupOutcome("无意向"), false);
assert.equal(isIntentFollowupOutcome("Success"), false);
assert.equal(hasOpenNextFollowUp(""), false);
assert.equal(hasOpenNextFollowUp("   "), false);
assert.equal(hasOpenNextFollowUp("已逾期"), true);
assert.equal(hasOpenNextFollowUp("2026-11-02 09:00"), true);

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "targetType" | "targetId" | "callOutcome" | "startTimeRaw">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    agentIds: "agent-a",
    maskedNumber: "*******2333",
    contactType: "OUTBOUND",
    contactDisposition: "NoAnswer",
    earlyMediaState: "",
    callDurationRaw: "",
    establishedTimeRaw: "",
    releaseTimeRaw: "",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://secret.example/do-not-leak",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcomeNote: "",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...partial
  };
}

const objects: IntentFollowupObjectSnapshot[] = [
  { targetType: "customer", targetId: "c-intent", teamId: "europe", name: "有意向客户", nextFollowAt: "" },
  { targetType: "customer", targetId: "c-cold", teamId: "europe", name: "后来无意向", nextFollowAt: "" },
  { targetType: "customer", targetId: "c-open", teamId: "europe", name: "已有跟进", nextFollowAt: "已逾期" },
  { targetType: "customer", targetId: "c-blank", teamId: "europe", name: "未标注", nextFollowAt: "" },
  { targetType: "lead", targetId: "l-deleted", teamId: "europe", name: "已删除", nextFollowAt: "", deleted: true },
  { targetType: "lead", targetId: "l-open", teamId: "europe", name: "线索", nextFollowAt: "" },
  { targetType: "prospect", targetId: "p-back", teamId: "europe", name: "需回访", nextFollowAt: "", suppressed: true },
  { targetType: "customer", targetId: "c-asia", teamId: "asia", name: "别的租户", nextFollowAt: "" }
];

const records = [
  record({ id: "old-intent", targetType: "customer", targetId: "c-intent", callOutcome: "无意向", startTimeRaw: "1000", agentIds: "agent-a" }),
  record({ id: "new-intent", targetType: "customer", targetId: "c-intent", callOutcome: "有意向", startTimeRaw: "2000", agentIds: "agent-a", updatedAt: "2026-10-20T00:00:00.000Z" }),
  record({ id: "old-warm", targetType: "customer", targetId: "c-cold", callOutcome: "有意向", startTimeRaw: "1000" }),
  record({ id: "new-cold", targetType: "customer", targetId: "c-cold", callOutcome: "无意向", startTimeRaw: "3000" }),
  record({ id: "open-call", targetType: "customer", targetId: "c-open", callOutcome: "需回访", startTimeRaw: "2000" }),
  record({ id: "blank-call", targetType: "customer", targetId: "c-blank", callOutcome: "", startTimeRaw: "2000" }),
  record({ id: "deleted-call", targetType: "lead", targetId: "l-deleted", callOutcome: "有意向", startTimeRaw: "2000" }),
  record({ id: "lead-call", targetType: "lead", targetId: "l-open", callOutcome: "有意向", startTimeRaw: "1500", agentIds: "agent-b" }),
  record({ id: "back-old", targetType: "prospect", targetId: "p-back", callOutcome: "无意向", startTimeRaw: "1000" }),
  record({ id: "back-new", targetType: "prospect", targetId: "p-back", callOutcome: "需回访", startTimeRaw: "2500", agentIds: "agent-a" }),
  record({ id: "asia-call", teamId: "asia", targetType: "customer", targetId: "c-asia", callOutcome: "有意向", startTimeRaw: "9000" }),
  record({
    id: "tie-low",
    targetType: "customer",
    targetId: "c-intent",
    callOutcome: "号码错误",
    startTimeRaw: "2000",
    updatedAt: "2026-10-19T00:00:00.000Z"
  })
];

const audits: CallOutcomeAudit[] = [
  {
    id: "coa-old",
    teamId: "europe",
    actorId: "u1",
    at: "2026-10-18T00:00:00.000Z",
    callRecordId: "new-intent",
    previousOutcome: "",
    nextOutcome: "无意向",
    previousNote: "",
    nextNote: ""
  },
  {
    id: "coa-new",
    teamId: "europe",
    actorId: "u1",
    at: "2026-10-21T08:30:00.000Z",
    callRecordId: "new-intent",
    previousOutcome: "无意向",
    nextOutcome: "有意向",
    previousNote: "",
    nextNote: "想要样品"
  }
];

assert.equal(isMoreRecentCall(records[1], records[0]), true);
assert.equal(isMoreRecentCall(records[11], records[1]), false);

const built = buildIntentFollowupQueue({
  teamId: "europe",
  records,
  audits,
  objects,
  arrangements: [],
  visible: () => true,
  labels: new Map([["agent-a", "甲坐席"], ["agent-b", "乙坐席"]])
});
assert.deepEqual(built.map((item) => item.targetId), ["c-intent", "p-back", "l-open"]);
const intent = built.find((item) => item.targetId === "c-intent");
assert.equal(intent?.outcome, "有意向");
assert.equal(intent?.callRecordId, "new-intent");
assert.equal(intent?.labeledAt, "2026-10-21T08:30:00.000Z");
assert.equal(intent?.agentLabel, "甲坐席");
assert.equal(JSON.stringify(built).includes("do-not-leak"), false);
const back = built.find((item) => item.targetId === "p-back");
assert.equal(back?.outcome, "需回访");
assert.match(back?.suppressionNotice || "", /抑制/);

const arranged = buildIntentFollowupQueue({
  teamId: "europe",
  records,
  audits,
  objects,
  arrangements: [{ teamId: "europe", targetType: "customer", targetId: "c-intent" }],
  visible: () => true,
  labels: new Map()
});
assert.equal(arranged.some((item) => item.targetId === "c-intent"), false);
assert.equal(arranged.some((item) => item.targetId === "p-back"), true);

const hidden = buildIntentFollowupQueue({
  teamId: "europe",
  records,
  audits,
  objects,
  arrangements: [],
  visible: (record) => record.agentIds.includes("agent-b"),
  labels: new Map()
});
assert.deepEqual(hidden.map((item) => item.targetId), ["l-open"]);

const empty = buildIntentFollowupQueue({
  teamId: "europe",
  records: [],
  audits: [],
  objects,
  arrangements: [],
  visible: () => true,
  labels: new Map()
});
assert.deepEqual(empty, []);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS intent_followup_queue_audits \(/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS intent_followup_arrangements \(/);
assert.equal(schema.includes("CREATE TABLE intent_followup_queue_audits"), false);
assert.equal(schema.includes("CREATE TABLE intent_followup_arrangements"), false);
assert.equal(schema.includes("intent_followup_ignores"), false);
assert.match(schema, /UNIQUE KEY uniq_intent_followup_arr_target\(team_id, target_type, target_id\)/);

const source = readFileSync(new URL("./intent-followup-queue.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /makeCall|MakeCall|aliyuncs|convert_to_lead|convertProspect|approved_contactable|unsuppress|send-development-email/i);
assert.match(source, /intentFollowupQueueAudits/);
assert.match(source, /suggestedMissedFollowAt/);

console.log("intent follow-up queue tests passed");
