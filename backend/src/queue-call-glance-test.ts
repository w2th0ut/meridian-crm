import assert from "node:assert/strict";
import { isMoreRecentCall } from "./intent-followup-queue.js";
import { callLocalDate } from "./outbound-call-records.js";
import { zonedDateKey } from "./outbound-call.js";
import {
  isMoreRecentQueueCall,
  queueCallOutcomeLabel,
  summarizeQueueCallGlance
} from "./queue-call-glance.js";
import type { OutboundCallRecord } from "./types.js";

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
    contactDisposition: "NoAnswer",
    earlyMediaState: "",
    callDurationRaw: "",
    establishedTimeRaw: "",
    releaseTimeRaw: "",
    startTimeRaw: "",
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

const now = new Date("2026-11-04T02:30:00.000Z");
const shanghaiToday = zonedDateKey(now, "Asia/Shanghai");
const nyToday = zonedDateKey(now, "America/New_York");
assert.equal(shanghaiToday, "2026-11-04");
assert.equal(nyToday, "2026-11-03");

const early = "2026-11-04T01:00:00.000Z";
const late = "2026-11-04T08:00:00.000Z";
assert.equal(callLocalDate(String(Date.parse(early)), "Asia/Shanghai"), "2026-11-04");
assert.equal(callLocalDate(String(Date.parse(early)), "America/New_York"), "2026-11-03");
assert.equal(callLocalDate(String(Date.parse(late)), "Asia/Shanghai"), "2026-11-04");
assert.equal(callLocalDate(String(Date.parse(late)), "America/New_York"), "2026-11-04");

const left = record({ id: "a", startTimeRaw: "10", updatedAt: "2026-11-01T00:00:00.000Z" });
const right = record({ id: "b", startTimeRaw: "10", updatedAt: "2026-11-02T00:00:00.000Z" });
assert.equal(isMoreRecentQueueCall(right, left), isMoreRecentCall(right, left));
assert.equal(isMoreRecentQueueCall(left, right), isMoreRecentCall(left, right));
assert.equal(queueCallOutcomeLabel(" 需回访 "), "需回访");
assert.equal(queueCallOutcomeLabel("Success"), "未标注");
assert.equal(queueCallOutcomeLabel(""), "未标注");
assert.equal(queueCallOutcomeLabel(" 其他 "), "其他");

const records = [
  record({
    id: "old",
    startTimeRaw: String(Date.parse("2026-11-02T02:00:00.000Z")),
    callOutcome: "无意向",
    establishedTimeRaw: ""
  }),
  record({
    id: "early",
    startTimeRaw: String(Date.parse(early)),
    callOutcome: "有意向",
    establishedTimeRaw: "1",
    contactDisposition: "Success"
  }),
  record({
    id: "late",
    startTimeRaw: String(Date.parse(late)),
    callOutcome: " 需回访 ",
    establishedTimeRaw: "1",
    contactDisposition: "Success"
  }),
  record({
    id: "hidden",
    startTimeRaw: String(Date.parse("2026-11-04T01:30:00.000Z")),
    callOutcome: "号码错误",
    agentIds: "agent-b"
  }),
  record({
    id: "other-object",
    targetId: "c2",
    startTimeRaw: String(Date.parse(early)),
    callOutcome: "其他"
  }),
  record({
    id: "other-team",
    teamId: "asia",
    startTimeRaw: String(Date.parse(early)),
    callOutcome: "有意向"
  }),
  record({
    id: "bad-start",
    startTimeRaw: "not-a-time",
    callOutcome: "Success",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z"
  })
];

const visible = (item: OutboundCallRecord) => item.agentIds !== "agent-b" && item.teamId === "europe";
const shanghai = summarizeQueueCallGlance({
  teamId: "europe",
  targetType: "customer",
  targetId: "c1",
  records,
  visible,
  timeZone: "Asia/Shanghai",
  today: shanghaiToday
});
assert.equal(shanghai.todayCallCount, 2);
assert.equal(shanghai.lastCallOutcome, "需回访");

const ny = summarizeQueueCallGlance({
  teamId: "europe",
  targetType: "customer",
  targetId: "c1",
  records,
  visible,
  timeZone: "America/New_York",
  today: nyToday
});
assert.equal(ny.todayCallCount, 1);
assert.equal(ny.lastCallOutcome, "需回访");

const withHidden = summarizeQueueCallGlance({
  teamId: "europe",
  targetType: "customer",
  targetId: "c1",
  records,
  visible: (item) => item.teamId === "europe",
  timeZone: "Asia/Shanghai",
  today: shanghaiToday
});
assert.equal(withHidden.todayCallCount, 3);
assert.equal(withHidden.lastCallOutcome, "需回访");

const none = summarizeQueueCallGlance({
  teamId: "europe",
  targetType: "customer",
  targetId: "missing",
  records,
  visible,
  timeZone: "Asia/Shanghai",
  today: shanghaiToday
});
assert.equal(none.todayCallCount, 0);
assert.equal(none.lastCallOutcome, "未标注");

const unlabeledLatest = summarizeQueueCallGlance({
  teamId: "europe",
  targetType: "customer",
  targetId: "c1",
  records: [record({ id: "only", startTimeRaw: String(Date.parse(early)), callOutcome: "Success", contactDisposition: "Success" })],
  visible: () => true,
  timeZone: "Asia/Shanghai",
  today: shanghaiToday
});
assert.equal(unlabeledLatest.todayCallCount, 1);
assert.equal(unlabeledLatest.lastCallOutcome, "未标注");

console.log("queue call glance tests passed");
