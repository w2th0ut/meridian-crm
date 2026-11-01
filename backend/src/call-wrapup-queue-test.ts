import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCallWrapupQueue,
  callEndedAtMs,
  countPendingWrapupsByAgent,
  displayMaskedNumber,
  endedAgoSeconds,
  formatEndedAgo,
  hasSuccessfulCallWrapup
} from "./call-wrapup-queue.js";
import type { CallWrapupAudit, CallWrapupSkip, OutboundCallRecord } from "./types.js";

const now = Date.parse("2026-04-04T06:00:00.000Z");
const later = String(Date.parse("2026-04-04T05:30:00.000Z"));
const earlier = String(Date.parse("2026-04-04T04:00:00.000Z"));

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id">): OutboundCallRecord {
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
    releaseTimeRaw: earlier,
    startTimeRaw: earlier,
    agentIds: "agent-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/do-not-leak",
    recordingDurationRaw: "",
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

function audit(partial: Partial<CallWrapupAudit> & Pick<CallWrapupAudit, "callRecordId" | "result">): CallWrapupAudit {
  return {
    id: `cwu_${partial.callRecordId}`,
    teamId: "europe",
    actorId: "u1",
    at: "2026-04-04T05:00:00.000Z",
    action: "submit",
    parts: "{\"outcome\":\"updated\"}",
    addedTagIds: "[]",
    removedTagIds: "[]",
    reason: "",
    ...partial
  };
}

const names = new Map([
  ["customer:c1", "Nordic Tools AB"],
  ["lead:l1", "Example Lighting GmbH"],
  ["prospect:web1", "只属于 Mia"]
]);
const labels = new Map([["agent-a", "Shirley坐席"], ["agent-b", "Mia坐席"]]);

const queue = buildCallWrapupQueue({
  teamId: "europe",
  nowMs: now,
  records: [
    record({ id: "ocr_old", releaseTimeRaw: earlier, targetType: "lead", targetId: "l1" }),
    record({ id: "ocr_new", releaseTimeRaw: later }),
    record({ id: "ocr_tie", releaseTimeRaw: earlier, targetType: "prospect", targetId: "web1" }),
    record({ id: "ocr_note", callNote: "有纪要" }),
    record({ id: "ocr_tags", callNoteTags: "需求" }),
    record({ id: "ocr_blank_note", callNote: "   ", callNoteTags: "  " }),
    record({ id: "ocr_done" }),
    record({ id: "ocr_reject" }),
    record({ id: "ocr_open", releaseTimeRaw: "" }),
    record({ id: "ocr_bad", releaseTimeRaw: "12.5" }),
    record({ id: "ocr_asia", teamId: "asia" }),
    record({ id: "ocr_hidden", agentIds: "agent-b" }),
    record({ id: "ocr_skip" }),
    record({ id: "ocr_restored" }),
    record({ id: "ocr_plain", maskedNumber: "13800138000" })
  ],
  wrapupAudits: [
    audit({ callRecordId: "ocr_done", result: "updated" }),
    audit({ callRecordId: "ocr_reject", result: "rejected", reason: "forbidden" }),
    audit({ callRecordId: "ocr_new", teamId: "asia", result: "updated" })
  ],
  skips: [
    { id: "cws_1", teamId: "europe", actorId: "u1", at: "2026-04-04T05:00:00.000Z", callRecordId: "ocr_skip", reason: "missed", active: true },
    { id: "cws_2", teamId: "europe", actorId: "u1", at: "2026-04-04T05:00:00.000Z", callRecordId: "ocr_restored", reason: "other", active: false }
  ],
  names,
  visible: (item) => item.agentIds !== "agent-b",
  labels
});

assert.deepEqual(queue.items.map((item) => item.callRecordId), [
  "ocr_new",
  "ocr_tie",
  "ocr_restored",
  "ocr_reject",
  "ocr_plain",
  "ocr_old",
  "ocr_blank_note"
]);
assert.equal(queue.items[0].endedAgoLabel, "30分钟");
assert.equal(queue.items[0].targetLabel, "客户");
assert.equal(queue.items[0].name, "Nordic Tools AB");
assert.equal(queue.items[0].maskedNumber, "*******2333");
assert.equal(queue.items.find((item) => item.callRecordId === "ocr_old")?.targetLabel, "线索");
assert.equal(queue.items.find((item) => item.callRecordId === "ocr_old")?.name, "Example Lighting GmbH");
assert.equal(queue.items.find((item) => item.callRecordId === "ocr_old")?.endedAgoLabel, "2小时");
assert.equal(queue.items.find((item) => item.callRecordId === "ocr_tie")?.targetLabel, "搜客");
assert.equal(queue.items.find((item) => item.callRecordId === "ocr_plain")?.maskedNumber, "*******8000");
assert.equal(queue.items.some((item) => item.callRecordId === "ocr_note"), false);
assert.equal(queue.items.some((item) => item.callRecordId === "ocr_done"), false);
assert.equal(queue.items.some((item) => item.callRecordId === "ocr_open"), false);
assert.deepEqual(queue.skipped.map((item) => item.callRecordId), ["ocr_skip"]);
assert.equal(queue.skipped[0].reason, "missed");
assert.equal(queue.skipped[0].reasonLabel, "未接通");
assert.equal(JSON.stringify(queue).includes("do-not-leak"), false);
assert.equal(JSON.stringify(queue).includes("13800138000"), false);

assert.equal(callEndedAtMs(""), null);
assert.equal(callEndedAtMs("0"), null);
assert.equal(callEndedAtMs("1532458000000"), 1532458000000);
assert.equal(hasSuccessfulCallWrapup([audit({ callRecordId: "a", result: "rejected" })], "europe", "a"), false);
assert.equal(hasSuccessfulCallWrapup([
  audit({ callRecordId: "multi", result: "updated", addedTagIds: "[\"ctag_a\",\"ctag_b\"]", removedTagIds: "[\"ctag_off\"]" })
], "europe", "multi"), true);
assert.equal(hasSuccessfulCallWrapup([
  audit({ callRecordId: "multi", result: "rejected", addedTagIds: "[\"ctag_a\"]", removedTagIds: "[]" })
], "europe", "multi"), false);
assert.equal(formatEndedAgo(0), "0秒");
assert.equal(formatEndedAgo(59), "59秒");
assert.equal(formatEndedAgo(60), "1分钟");
assert.equal(formatEndedAgo(3599), "59分钟");
assert.equal(formatEndedAgo(3600), "1小时");
assert.equal(formatEndedAgo(86400), "1天");
assert.equal(formatEndedAgo(-1), "—");
assert.equal(endedAgoSeconds(now + 5000, now), 0);
assert.equal(displayMaskedNumber("****"), "****");

const counts = countPendingWrapupsByAgent({
  items: [
    { agentIds: ["agent-a"] },
    { agentIds: ["agent-a", "agent-b"] },
    { agentIds: [] }
  ],
  mappings: [
    { teamId: "europe", cccUserId: "agent-a" },
    { teamId: "europe", cccUserId: "agent-c" },
    { teamId: "asia", cccUserId: "agent-z" }
  ],
  teamId: "europe",
  allowed: new Set(["agent-a", "agent-c"]),
  tenantWide: false,
  labels
});
assert.equal(counts.at(-1)?.agentId, "");
assert.equal(counts.at(-1)?.pendingCount, 1);
assert.equal(counts.find((row) => row.agentId === "agent-a")?.pendingCount, 2);
assert.equal(counts.find((row) => row.agentId === "agent-b")?.pendingCount, 1);
assert.equal(counts.find((row) => row.agentId === "agent-c")?.pendingCount, 0);
assert.equal(counts.some((row) => row.agentId === "agent-z"), false);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_wrapup_skips \(/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_wrapup_skip_audits \(/);
assert.match(schema, /UNIQUE KEY uniq_call_wrapup_skip\(team_id, call_record_id\)/);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS call_wrapup_skips \(/g) || []).length, 1);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS call_wrapup_skip_audits \(/g) || []).length, 1);
assert.equal(schema.includes("DROP TABLE call_wrapup_skips"), false);
assert.equal(schema.includes("DROP TABLE call_wrapup_skip_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS call_wrapup_skips"), false);
assert.equal(schema.includes("ALTER TABLE call_wrapup_skips"), false);
assert.equal(schema.includes("ALTER TABLE call_wrapup_skip_audits"), false);
assert.equal(schema.includes("ALTER TABLE call_wrapup_audits"), false);
assert.equal(schema.includes("ALTER TABLE outbound_call_records"), false);

const source = readFileSync(new URL("./call-wrapup-queue.ts", import.meta.url), "utf8");
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("requestOutboundCall"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("openai"), false);

const skip: CallWrapupSkip = queue.skipped[0] && {
  id: "cws_1",
  teamId: "europe",
  actorId: "u1",
  at: "2026-04-04T05:00:00.000Z",
  callRecordId: "ocr_skip",
  reason: "missed",
  active: true
};
assert.equal(skip.active, true);

console.log("call wrapup queue unit tests passed");
