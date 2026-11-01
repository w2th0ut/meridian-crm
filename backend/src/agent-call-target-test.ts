import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AGENT_CALL_TARGET_MAX,
  AGENT_CALL_TARGET_TIME_ZONE,
  formatAgentCallTargetValue,
  parseAgentCallTargetClear,
  parseAgentCallTargetQuery,
  parseAgentCallTargetWrite,
  sameAgentCallTarget,
  todayCallProgress
} from "./agent-call-target.js";
import type { OutboundCallRecord } from "./types.js";

function row(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "agentIds" | "startTimeRaw">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    targetType: "customer",
    targetId: "c1",
    maskedNumber: "*******2333",
    contactType: "OUTBOUND",
    contactDisposition: "NoAnswer",
    earlyMediaState: "",
    callDurationRaw: "10",
    establishedTimeRaw: "",
    releaseTimeRaw: "",
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
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

const now = new Date("2026-04-04T12:00:00.000Z");
const records = [
  row({ id: "intent", agentIds: "agent@ccc-a", establishedTimeRaw: "1", callOutcome: "有意向", startTimeRaw: String(Date.parse("2026-04-04T02:00:00.000Z")) }),
  row({ id: "connected", agentIds: "agent@ccc-a", establishedTimeRaw: "2", startTimeRaw: String(Date.parse("2026-04-04T03:00:00.000Z")) }),
  row({ id: "success-only", agentIds: "agent@ccc-a", establishedTimeRaw: "", contactDisposition: "Success", callOutcome: "需回访", startTimeRaw: String(Date.parse("2026-04-04T04:00:00.000Z")) }),
  row({ id: "blank", agentIds: "agent@ccc-a", establishedTimeRaw: "  ", startTimeRaw: String(Date.parse("2026-04-04T05:00:00.000Z")) }),
  row({ id: "yesterday", agentIds: "agent@ccc-a", establishedTimeRaw: "9", callOutcome: "有意向", startTimeRaw: String(Date.parse("2026-04-03T15:30:00.000Z")) }),
  row({ id: "boundary", agentIds: "agent@ccc-a", establishedTimeRaw: "8", startTimeRaw: String(Date.parse("2026-04-03T16:00:00.000Z")) }),
  row({ id: "shared", agentIds: "agent@ccc-a, agent@ccc-b", establishedTimeRaw: "3", startTimeRaw: String(Date.parse("2026-04-04T06:00:00.000Z")) }),
  row({ id: "no-agent", agentIds: "", establishedTimeRaw: "4", callOutcome: "有意向", startTimeRaw: String(Date.parse("2026-04-04T06:00:00.000Z")) }),
  row({ id: "other-team", teamId: "asia", agentIds: "agent@ccc-a", establishedTimeRaw: "5", callOutcome: "有意向", startTimeRaw: String(Date.parse("2026-04-04T06:00:00.000Z")) }),
  row({ id: "undated", agentIds: "agent@ccc-a", establishedTimeRaw: "6", startTimeRaw: "" })
];

const shirley = todayCallProgress(records, "europe", "agent@ccc-a", now);
assert.equal(shirley.today, "2026-04-04");
assert.equal(shirley.dialed, 6);
assert.equal(shirley.connected, 4);
assert.equal(shirley.intent, 1);

const mia = todayCallProgress(records, "europe", "agent@ccc-b", now);
assert.equal(mia.dialed, 1);
assert.equal(mia.connected, 1);
assert.equal(mia.intent, 0);

const nobody = todayCallProgress(records, "europe", "agent@ccc-z", now);
assert.equal(nobody.dialed, 0);
assert.equal(nobody.connected, 0);
assert.equal(nobody.intent, 0);

assert.equal(formatAgentCallTargetValue(null), "");
assert.equal(formatAgentCallTargetValue({ dialTarget: 20, connectedTarget: 8, intentTarget: 3 }), "20|8|3");
assert.equal(formatAgentCallTargetValue({ dialTarget: 20, connectedTarget: 8, intentTarget: null }), "20|8|");
assert.equal(formatAgentCallTargetValue({ dialTarget: 0, connectedTarget: 0, intentTarget: 0 }), "0|0|0");
assert.equal(sameAgentCallTarget(
  { dialTarget: 20, connectedTarget: 8, intentTarget: null },
  { dialTarget: 20, connectedTarget: 8, intentTarget: null }
), true);
assert.equal(sameAgentCallTarget(
  { dialTarget: 20, connectedTarget: 8, intentTarget: null },
  { dialTarget: 20, connectedTarget: 8, intentTarget: 1 }
), false);

const set = parseAgentCallTargetWrite({ agentId: "agent@ccc-a", dialTarget: 20, connectedTarget: 8 });
assert.equal(set.ok && set.intentTarget, null);
const withIntent = parseAgentCallTargetWrite({ agentId: "agent@ccc-a", dialTarget: 0, connectedTarget: AGENT_CALL_TARGET_MAX, intentTarget: 0 });
assert.equal(withIntent.ok && withIntent.intentTarget, 0);
assert.equal(parseAgentCallTargetWrite({ agentId: "agent@ccc-a", dialTarget: 20, connectedTarget: 8, intentTarget: null }).ok, true);
for (const body of [
  { agentId: "agent@ccc-a", dialTarget: 10001, connectedTarget: 1 },
  { agentId: "agent@ccc-a", dialTarget: -1, connectedTarget: 1 },
  { agentId: "agent@ccc-a", dialTarget: 1.5, connectedTarget: 1 },
  { agentId: "agent@ccc-a", dialTarget: "20", connectedTarget: 1 },
  { agentId: "agent@ccc-a", dialTarget: 20, connectedTarget: 1, intentTarget: "" },
  { agentId: "agent@ccc-a", connectedTarget: 1 },
  [{ agentId: "agent@ccc-a", dialTarget: 1, connectedTarget: 1 }],
  { agentId: "agent@ccc-a", dialTarget: 1, connectedTarget: 1, targets: [] },
  { agentId: "agent@ccc-a", dialTarget: 1, connectedTarget: 1, agentIds: ["a"] },
  { agentId: "", dialTarget: 1, connectedTarget: 1 }
]) {
  const parsed = parseAgentCallTargetWrite(body);
  assert.equal(parsed.ok, false);
}
assert.equal(parseAgentCallTargetClear({ agentId: "agent@ccc-a" }).ok, true);
assert.equal(parseAgentCallTargetClear({ agentId: "agent@ccc-a", dialTarget: 1 }).ok, false);
assert.equal(parseAgentCallTargetClear({ targets: [] }).ok, false);
assert.deepEqual(parseAgentCallTargetQuery({}), { ok: true, agentId: null });
assert.equal(parseAgentCallTargetQuery({ agentId: ["agent@ccc-a"] }).ok, false);
assert.equal(parseAgentCallTargetQuery({ agentId: "bad id" }).ok, false);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS agent_call_targets \(/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS agent_call_target_audits \(/);
assert.equal(schema.includes("CREATE TABLE agent_call_targets"), false);
assert.equal(schema.includes("CREATE TABLE agent_call_target_audits"), false);
assert.equal(schema.includes("DROP TABLE agent_call_targets"), false);
assert.equal(schema.includes("DROP TABLE agent_call_target_audits"), false);
assert.match(schema, /uniq_agent_call_targets_agent/);

const source = readFileSync(new URL("./agent-call-target.ts", import.meta.url), "utf8");
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("requestOutboundCall"), false);
assert.equal(source.includes("MakeCall"), false);
assert.match(source, /establishedTimeRaw|selectOutboundCallRecords|summarizeOutboundCallRecords/);
assert.match(source, /有意向/);
assert.equal(AGENT_CALL_TARGET_TIME_ZONE, "Asia/Shanghai");
assert.match(source, /AGENT_CALL_TARGET_TIME_ZONE/);

console.log("agent call target unit tests passed");
