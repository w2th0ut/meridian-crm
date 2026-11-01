import assert from "node:assert/strict";
import {
  callLocalDate,
  isEstablishedCall,
  parseCallDurationSeconds,
  parseOutboundCallRecordQuery,
  recordInDateRange,
  selectOutboundCallRecords,
  splitAgentIds,
  summarizeOutboundCallRecords
} from "./outbound-call-records.js";
import type { OutboundCallRecord } from "./types.js";

assert.equal(isEstablishedCall(""), false);
assert.equal(isEstablishedCall("   "), false);
assert.equal(isEstablishedCall("1710000000000"), true);
assert.equal(parseCallDurationSeconds(""), null);
assert.equal(parseCallDurationSeconds("1.5"), null);
assert.equal(parseCallDurationSeconds("-3"), null);
assert.equal(parseCallDurationSeconds("10"), 10);
assert.equal(parseCallDurationSeconds(" 0 "), 0);
assert.deepEqual(splitAgentIds(" agent@ccc-a, agent@ccc-b ,"), ["agent@ccc-a", "agent@ccc-b"]);

const boundary = String(Date.parse("2026-10-31T16:30:00.000Z"));
assert.equal(callLocalDate(boundary, "Asia/Shanghai"), "2026-11-01");
assert.equal(callLocalDate(boundary, "America/New_York"), "2026-10-31");
assert.equal(callLocalDate("", "Asia/Shanghai"), null);
assert.equal(callLocalDate("not-a-time", "Asia/Shanghai"), null);
assert.equal(recordInDateRange(null, "2026-11-01", "2026-11-01"), false);
assert.equal(recordInDateRange(null, null, null), true);
assert.equal(recordInDateRange("2026-11-01", "2026-11-01", "2026-11-01"), true);
assert.equal(recordInDateRange("2026-10-31", "2026-11-01", "2026-11-01"), false);

assert.deepEqual(parseOutboundCallRecordQuery({}), { agentId: null, from: null, to: null, outcome: null, note: null, script: null, tag: null, targetType: null, targetId: null });
const parsed = parseOutboundCallRecordQuery({ agentId: " agent@ccc-a ", from: "2026-11-01", to: "2026-11-02" });
assert.deepEqual(parsed, { agentId: "agent@ccc-a", from: "2026-11-01", to: "2026-11-02", outcome: null, note: null, script: null, tag: null, targetType: null, targetId: null });
assert.equal(parseOutboundCallRecordQuery({ targetType: "customer", targetId: "c1" })?.targetId, "c1");
assert.equal(parseOutboundCallRecordQuery({ targetType: "customer" }), null);
assert.equal(parseOutboundCallRecordQuery({ targetType: "prospect", targetId: "p1" }), null);
assert.equal(parseOutboundCallRecordQuery({ tag: "none" })?.tag, "none");
assert.equal(parseOutboundCallRecordQuery({ tag: " ctag_a " })?.tag, "ctag_a");
assert.equal(parseOutboundCallRecordQuery({ tag: "价格" }), null);
assert.equal(parseOutboundCallRecordQuery({ tag: ["ctag_a"] }), null);
assert.equal(parseOutboundCallRecordQuery({ from: "2026-13-01" }), null);
assert.equal(parseOutboundCallRecordQuery({ from: "2026-11-02", to: "2026-11-01" }), null);
assert.equal(parseOutboundCallRecordQuery({ agentId: ["agent@ccc-a"] }), null);

function row(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "agentIds" | "establishedTimeRaw" | "callDurationRaw" | "startTimeRaw">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    targetType: "customer",
    targetId: "c1",
    maskedNumber: "*******2333",
    contactType: "OUTBOUND",
    contactDisposition: partial.contactDisposition || "",
    earlyMediaState: "",
    releaseTimeRaw: "",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/do-not-leak",
    recordingDurationRaw: "999",
    followUpActivityId: "",
    callOutcome: "",
    callOutcomeNote: "",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

const april = String(Date.parse("2026-04-04T04:00:00.000Z"));
const simple = [
  row({ id: "ten", agentIds: "agent@ccc-a", establishedTimeRaw: "1", callDurationRaw: "10", startTimeRaw: april }),
  row({ id: "twenty", agentIds: "agent@ccc-a", establishedTimeRaw: "2", callDurationRaw: "20", startTimeRaw: april }),
  row({ id: "missed", agentIds: "agent@ccc-a", establishedTimeRaw: "", callDurationRaw: "100", startTimeRaw: april }),
  row({ id: "success-only", agentIds: "agent@ccc-a", establishedTimeRaw: "", callDurationRaw: "8", contactDisposition: "Success", startTimeRaw: april })
];
const simpleStats = summarizeOutboundCallRecords(simple);
assert.equal(simpleStats.empty, false);
assert.equal(simpleStats.totalCalls, 4);
assert.equal(simpleStats.connectedCalls, 2);
assert.equal(simpleStats.connectRate, 2 / 4);
assert.equal(simpleStats.averageConnectedDurationSeconds, 15);

const withFractional = [
  ...simple,
  row({ id: "fraction", agentIds: "agent@ccc-a", establishedTimeRaw: "3", callDurationRaw: "1.5", startTimeRaw: april })
];
const fractionalStats = summarizeOutboundCallRecords(withFractional);
assert.equal(fractionalStats.totalCalls, 5);
assert.equal(fractionalStats.connectedCalls, 3);
assert.equal(fractionalStats.connectRate, 3 / 5);
assert.equal(fractionalStats.averageConnectedDurationSeconds, 15);

const noneConnected = summarizeOutboundCallRecords([
  row({ id: "no", agentIds: "agent@ccc-a", establishedTimeRaw: "", callDurationRaw: "50", contactDisposition: "Success", startTimeRaw: april })
]);
assert.equal(noneConnected.empty, false);
assert.equal(noneConnected.connectedCalls, 0);
assert.equal(noneConnected.connectRate, 0);
assert.equal(noneConnected.averageConnectedDurationSeconds, null);

const empty = summarizeOutboundCallRecords([]);
assert.equal(empty.empty, true);
assert.equal(empty.connectRate, null);
assert.equal(empty.averageConnectedDurationSeconds, null);
assert.equal(empty.totalCalls, 0);

const selected = selectOutboundCallRecords({
  records: [
    ...simple,
    row({ id: "other-team", teamId: "other", agentIds: "agent@ccc-a", establishedTimeRaw: "1", callDurationRaw: "1", startTimeRaw: april }),
    row({ id: "shared", agentIds: "agent@ccc-b, agent@ccc-a", establishedTimeRaw: "9", callDurationRaw: "4", startTimeRaw: april }),
    row({ id: "undated", agentIds: "agent@ccc-a", establishedTimeRaw: "9", callDurationRaw: "4", startTimeRaw: "" })
  ],
  teamId: "europe",
  teamWide: false,
  agentIds: new Set(["agent@ccc-a"]),
  agentId: null,
  from: "2026-04-04",
  to: "2026-04-04",
  timeZone: "Asia/Shanghai"
});
assert.deepEqual(selected.map((item) => item.id).sort(), ["shared", "ten", "twenty", "missed", "success-only"].sort());

const shanghaiDay = selectOutboundCallRecords({
  records: [row({ id: "boundary", agentIds: "agent@ccc-a", establishedTimeRaw: "1", callDurationRaw: "10", startTimeRaw: boundary })],
  teamId: "europe",
  teamWide: false,
  agentIds: new Set(["agent@ccc-a"]),
  agentId: "agent@ccc-a",
  from: "2026-11-01",
  to: "2026-11-01",
  timeZone: "Asia/Shanghai"
});
assert.equal(shanghaiDay.length, 1);
const newYorkDay = selectOutboundCallRecords({
  records: [row({ id: "boundary", agentIds: "agent@ccc-a", establishedTimeRaw: "1", callDurationRaw: "10", startTimeRaw: boundary })],
  teamId: "europe",
  teamWide: false,
  agentIds: new Set(["agent@ccc-a"]),
  agentId: "agent@ccc-a",
  from: "2026-11-01",
  to: "2026-11-01",
  timeZone: "America/New_York"
});
assert.equal(newYorkDay.length, 0);

console.log("outbound call record stats tests passed");
