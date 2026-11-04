import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { OutboundCallRecord } from "./types.js";
import {
  UNANSWERED_PENDING_WEEK_SECONDS,
  buildUnansweredPendingQueue,
  formatUnansweredAge,
  formatUnansweredAt,
  matchesUnansweredAge,
  parseUnansweredPendingQueueQuery,
  unansweredAgeSeconds,
  type UnansweredPendingObject
} from "./unanswered-pending-queue.js";

const now = new Date("2026-11-04T02:30:00.000Z");
const at = (secondsAgo: number) => String(now.getTime() - secondsAgo * 1000);

assert.equal(unansweredAgeSeconds(at(30 * 60), now), 30 * 60);
assert.equal(formatUnansweredAge(30 * 60), "30分钟");
assert.equal(unansweredAgeSeconds(at(-60), now), 0);
assert.equal(formatUnansweredAge(0), "0秒");
assert.equal(formatUnansweredAge(60), "1分钟");
assert.equal(formatUnansweredAge(3600), "1小时");
assert.equal(formatUnansweredAge(86400), "1天");
assert.equal(unansweredAgeSeconds("not-a-time", now), null);
assert.equal(unansweredAgeSeconds("  ", now), null);
assert.equal(formatUnansweredAge(null), "—");
assert.equal(formatUnansweredAt(at(30 * 60), "Asia/Shanghai"), "2026-11-04 10:00");
assert.equal(formatUnansweredAt(at(30 * 60), "America/New_York"), "2026-11-03 21:00");
assert.equal(formatUnansweredAt("not-a-time", "Asia/Shanghai"), "");
assert.equal(matchesUnansweredAge(UNANSWERED_PENDING_WEEK_SECONDS, "within7"), true);
assert.equal(matchesUnansweredAge(UNANSWERED_PENDING_WEEK_SECONDS, "over7"), false);
assert.equal(matchesUnansweredAge(UNANSWERED_PENDING_WEEK_SECONDS + 1, "over7"), true);
assert.equal(matchesUnansweredAge(null, "within7"), false);
assert.equal(matchesUnansweredAge(null, ""), true);

assert.deepEqual(parseUnansweredPendingQueueQuery({ scope: "mine" }), { scope: "mine", age: "" });
assert.deepEqual(parseUnansweredPendingQueueQuery({ scope: "team", age: "over7" }), { scope: "team", age: "over7" });
assert.equal(parseUnansweredPendingQueueQuery({ scope: "all" }), null);
assert.equal(parseUnansweredPendingQueueQuery({ scope: "mine", age: "7" }), null);
assert.equal(parseUnansweredPendingQueueQuery({ scope: "mine", extra: "1" }), null);
assert.equal(parseUnansweredPendingQueueQuery({ scope: ["mine"] }), null);
assert.equal(parseUnansweredPendingQueueQuery({ scope: "mine", age: ["over7"] }), null);

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
    startTimeRaw: at(3600),
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

const objects: UnansweredPendingObject[] = [
  { targetType: "customer", targetId: "c-open", teamId: "europe", name: "已有跟进", nextFollowAt: "已逾期" },
  { targetType: "customer", targetId: "c-blank-follow", teamId: "europe", name: "空白跟进", nextFollowAt: "   " },
  { targetType: "customer", targetId: "c-scheduled", teamId: "europe", name: "已预约", nextFollowAt: "" },
  { targetType: "customer", targetId: "c-last", teamId: "europe", name: "Nordic <Tools>", nextFollowAt: "" },
  { targetType: "lead", targetId: "l-deleted", teamId: "europe", name: "已删除", nextFollowAt: "", deleted: true },
  { targetType: "lead", targetId: "l-open", teamId: "europe", name: "线索跟进", nextFollowAt: "明天" },
  { targetType: "lead", targetId: "l-ok", teamId: "europe", name: "灯具", nextFollowAt: "" },
  { targetType: "prospect", targetId: "p-ok", teamId: "europe", name: "搜客", nextFollowAt: "" },
  { targetType: "customer", targetId: "c-asia", teamId: "asia", name: "别的租户", nextFollowAt: "" },
  { targetType: "customer", targetId: "c-undated", teamId: "europe", name: "没有开始时间", nextFollowAt: "" },
  { targetType: "customer", targetId: "c-no-agent", teamId: "europe", name: "没有坐席", nextFollowAt: "" }
];

const records = [
  record({ id: "answered", targetId: "c-last", establishedTimeRaw: "1", startTimeRaw: at(60), contactDisposition: "Success" }),
  record({ id: "older", targetId: "c-last", startTimeRaw: at(20 * 86400), maskedNumber: "13800138000" }),
  record({ id: "latest-unanswered", targetId: "c-last", startTimeRaw: at(8 * 86400), agentIds: "agent-a, agent-b", maskedNumber: "13800138000", contactDisposition: "Success" }),
  record({ id: "whitespace", targetId: "c-blank-follow", establishedTimeRaw: "   ", startTimeRaw: at(UNANSWERED_PENDING_WEEK_SECONDS) }),
  record({ id: "scheduled", targetId: "c-scheduled", startTimeRaw: at(86400) }),
  record({ id: "follow", targetId: "c-open", startTimeRaw: at(86400) }),
  record({ id: "lead-follow", targetId: "l-open", targetType: "lead", startTimeRaw: at(86400) }),
  record({ id: "deleted", targetId: "l-deleted", targetType: "lead", startTimeRaw: at(86400) }),
  record({ id: "lead-ok", targetId: "l-ok", targetType: "lead", startTimeRaw: at(30 * 60), agentIds: "agent-b" }),
  record({ id: "prospect-ok", targetId: "p-ok", targetType: "prospect", startTimeRaw: at(UNANSWERED_PENDING_WEEK_SECONDS), establishedTimeRaw: "", contactDisposition: "Success" }),
  record({ id: "asia", teamId: "asia", targetId: "c-asia", startTimeRaw: at(86400), maskedNumber: "不要出现" }),
  record({ id: "undated", targetId: "c-undated", startTimeRaw: "not-a-time", createdAt: "2026-11-04T00:00:00.000Z" }),
  record({ id: "blank-agent", targetId: "c-no-agent", agentIds: "", startTimeRaw: at(10) })
];

const labels = new Map([["agent-a", "Shirley坐席"], ["agent-b", "Mia坐席"]]);
const listed = buildUnansweredPendingQueue({
  teamId: "europe",
  records,
  objects,
  schedules: [{ teamId: "europe", targetType: "customer", targetId: "c-scheduled" }],
  visible: () => true,
  labels,
  ownAgentIds: null,
  age: "",
  timeZone: "Asia/Shanghai",
  now
});
assert.deepEqual(listed.map((item) => item.targetId), ["c-last", "c-blank-follow", "p-ok", "l-ok", "c-no-agent", "c-undated"]);
const last = listed[0];
assert.equal(last.callRecordId, "latest-unanswered");
assert.equal(last.name, "Nordic <Tools>");
assert.equal(last.unansweredAt, "2026-10-27 10:30");
assert.equal(last.ageLabel, "8天");
assert.equal(last.agentLabel, "Shirley坐席、Mia坐席");
assert.equal(last.maskedNumber.includes("13800138000"), false);
assert.equal(last.maskedNumber.endsWith("8000"), true);
assert.equal(listed.find((item) => item.targetId === "c-blank-follow")?.callRecordId, "whitespace");
assert.equal(listed.find((item) => item.targetId === "c-no-agent")?.agentLabel, "");
assert.equal(listed.find((item) => item.targetId === "c-undated")?.ageLabel, "—");
assert.equal(listed.find((item) => item.targetId === "c-undated")?.unansweredAt, "");
assert.equal(listed.some((item) => item.targetId === "c-asia"), false);

const mine = buildUnansweredPendingQueue({
  teamId: "europe",
  records,
  objects,
  schedules: [{ teamId: "europe", targetType: "customer", targetId: "c-scheduled" }],
  visible: (item) => item.agentIds.includes("agent-a") || item.id === "latest-unanswered",
  labels,
  ownAgentIds: ["agent-a"],
  age: "over7",
  timeZone: "Asia/Shanghai",
  now
});
assert.deepEqual(mine.map((item) => item.callRecordId), ["latest-unanswered"]);

const within = buildUnansweredPendingQueue({
  teamId: "europe",
  records,
  objects,
  schedules: [],
  visible: () => true,
  labels,
  ownAgentIds: null,
  age: "within7",
  timeZone: "Asia/Shanghai",
  now
});
assert.equal(within.some((item) => item.targetId === "c-last"), false);
assert.equal(within.some((item) => item.targetId === "c-undated"), false);
assert.equal(within.some((item) => item.targetId === "p-ok"), true);
assert.equal(within.some((item) => item.callRecordId === "scheduled"), true);

const nobody = buildUnansweredPendingQueue({
  teamId: "europe",
  records,
  objects,
  schedules: [],
  visible: () => true,
  labels,
  ownAgentIds: [],
  age: "",
  timeZone: "Asia/Shanghai",
  now
});
assert.deepEqual(nobody, []);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS unanswered_pending_queue_audits \(/);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS unanswered_pending_queue_audits \(/g) || []).length, 1);
assert.match(schema, /INSERT INTO unanswered_pending_queue_audits/);
assert.match(schema, /WHERE NOT EXISTS/);
assert.match(schema, /team_id = ''/);
assert.equal(schema.includes("DROP TABLE unanswered_pending_queue_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS unanswered_pending_queue_audits"), false);
assert.equal(schema.includes("ALTER TABLE callback_schedules"), false);
assert.equal(schema.includes("ALTER TABLE outbound_call_records"), false);
assert.equal(schema.includes("CREATE TABLE unanswered_pending_calls"), false);
assert.equal(schema.includes("CREATE TABLE unanswered_pending_schedules"), false);

const source = readFileSync(new URL("./unanswered-pending-queue.ts", import.meta.url), "utf8");
assert.match(source, /isEstablishedCall/);
assert.match(source, /hasOpenNextFollowUp/);
assert.match(source, /callbackSchedules/);
assert.equal(source.includes("CREATE TABLE"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("connectRate"), false);

console.log("unanswered pending queue tests passed");
