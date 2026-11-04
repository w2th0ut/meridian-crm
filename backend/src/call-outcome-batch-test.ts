import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CALL_OUTCOME_BATCH_MAX,
  buildUnlabeledConnectedCalls,
  isPendingUnlabeledCall,
  parseCallOutcomeBatchRequest,
  parseUnlabeledConnectedCallQuery
} from "./call-outcome-batch.js";
import type { OutboundCallRecord } from "./types.js";

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
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "10",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: "1000",
    agentIds: "agent-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/secret",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "",
    callOutcomeNote: "",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

const labels = new Map([["agent-a", "Shirley坐席"], ["agent-b", "Mia坐席"]]);
const names = (item: OutboundCallRecord) => ({
  targetType: item.targetType === "customer" || item.targetType === "lead" || item.targetType === "prospect" ? item.targetType : "" as const,
  targetId: item.targetId,
  targetLabel: item.targetType === "lead" ? "线索" : "客户",
  name: item.targetId === "c-script" ? "Nordic <Tools>" : "北欧工具"
});

const records = [
  record({ id: "older", startTimeRaw: "1000", callOutcome: "", agentIds: "agent-a" }),
  record({ id: "newer-labeled", startTimeRaw: "3000", callOutcome: "有意向", targetId: "c1", agentIds: "agent-a" }),
  record({ id: "success-text", startTimeRaw: "2500", callOutcome: "Success", agentIds: "agent-a", maskedNumber: "13800138000" }),
  record({ id: "blank-outcome", startTimeRaw: "2400", callOutcome: "   ", agentIds: "agent-a" }),
  record({ id: "padded-other", startTimeRaw: "2300", callOutcome: " 其他 ", agentIds: "agent-a" }),
  record({ id: "missed", startTimeRaw: "2200", establishedTimeRaw: "", callOutcome: "", agentIds: "agent-a" }),
  record({ id: "blank-established", startTimeRaw: "2100", establishedTimeRaw: "   ", callOutcome: "", agentIds: "agent-a" }),
  record({ id: "mia", startTimeRaw: "2000", callOutcome: "", agentIds: "agent-b", targetType: "lead", targetId: "l1" }),
  record({ id: "no-agent", startTimeRaw: "1900", callOutcome: "", agentIds: "" }),
  record({ id: "asia", teamId: "asia", startTimeRaw: "4000", callOutcome: "" }),
  record({ id: "unparsed-start", startTimeRaw: "not-a-time", callOutcome: "", agentIds: "agent-a" }),
  record({ id: "script-name", startTimeRaw: "1800", callOutcome: "", agentIds: "agent-a", targetId: "c-script" })
];

assert.equal(isPendingUnlabeledCall(records[0]), true);
assert.equal(isPendingUnlabeledCall(records[1]), false);
assert.equal(isPendingUnlabeledCall(records[2]), true);
assert.equal(isPendingUnlabeledCall(records[4]), false);
assert.equal(isPendingUnlabeledCall(records[5]), false);

const visible = buildUnlabeledConnectedCalls({
  teamId: "europe",
  records,
  visible: (item) => item.agentIds !== "",
  labels,
  names,
  ownAgentIds: null
});
const ids = visible.map((item) => item.callRecordId);
assert.deepEqual(ids, ["unparsed-start", "success-text", "blank-outcome", "mia", "script-name", "older"]);
assert.equal(visible.every((item) => item.outcome === "未标注"), true);
assert.equal(visible.some((item) => item.maskedNumber === "13800138000"), false);
assert.match(visible.find((item) => item.callRecordId === "success-text")?.maskedNumber || "", /\*/);
assert.equal(visible.find((item) => item.callRecordId === "unparsed-start")?.startedAt, "");
assert.equal(visible.find((item) => item.callRecordId === "script-name")?.name, "Nordic <Tools>");
assert.equal(JSON.stringify(visible).includes("secret"), false);
assert.equal(JSON.stringify(visible).includes("Success"), false);
assert.equal(JSON.stringify(visible).includes("ContactDisposition"), false);

const mine = buildUnlabeledConnectedCalls({
  teamId: "europe",
  records,
  visible: () => true,
  labels,
  names,
  ownAgentIds: ["agent-a"]
});
assert.equal(mine.some((item) => item.callRecordId === "mia"), false);
assert.equal(mine.some((item) => item.callRecordId === "no-agent"), false);
assert.equal(mine.some((item) => item.callRecordId === "older"), true);
assert.deepEqual(buildUnlabeledConnectedCalls({
  teamId: "europe",
  records,
  visible: () => true,
  labels,
  names,
  ownAgentIds: []
}), []);

assert.deepEqual(parseUnlabeledConnectedCallQuery({ scope: "mine" }), { scope: "mine" });
assert.equal(parseUnlabeledConnectedCallQuery({ scope: "team", outcome: "有意向" }), null);
assert.equal(parseUnlabeledConnectedCallQuery({ scope: ["mine"] }), null);

const parsed = parseCallOutcomeBatchRequest({ callRecordIds: ["a", "b"], outcome: " 需回访 ", note: "  下午  " });
assert.equal(parsed.ok, true);
if (parsed.ok) {
  assert.deepEqual(parsed.callRecordIds, ["a", "b"]);
  assert.equal(parsed.outcome, "需回访");
  assert.equal(parsed.note, "下午");
}
assert.equal(parseCallOutcomeBatchRequest({ callRecordIds: ["a"], outcome: "Success" }).ok, false);
assert.equal(parseCallOutcomeBatchRequest({ callRecordIds: [], outcome: "有意向" }).ok, false);
assert.equal(parseCallOutcomeBatchRequest({ callRecordIds: ["a", "a"], outcome: "有意向" }).ok, false);
assert.equal(parseCallOutcomeBatchRequest({ callRecordIds: ["a"], outcome: "有意向", records: ["a"] }).ok, false);
assert.equal(parseCallOutcomeBatchRequest(["a"]).ok, false);
const tooMany = parseCallOutcomeBatchRequest({
  callRecordIds: Array.from({ length: CALL_OUTCOME_BATCH_MAX + 1 }, (_, index) => `c${index}`),
  outcome: "其他"
});
assert.equal(tooMany.ok, false);
if (!tooMany.ok) assert.equal(tooMany.reason, "too_many");
const longNote = parseCallOutcomeBatchRequest({ callRecordIds: ["a"], outcome: "其他", note: "字".repeat(201) });
assert.equal(longNote.ok, false);
if (!longNote.ok) assert.equal(longNote.reason, "note_too_long");
assert.equal(parseCallOutcomeBatchRequest({ callRecordIds: ["a"], outcome: "其他", note: "字".repeat(200) }).ok, true);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /ensureColumn\(pool, "call_outcome_audits", "batch_id", "VARCHAR\(64\) NULL"\)/);
assert.match(schema, /ensureColumn\(pool, "call_outcome_audits", "action_code", "VARCHAR\(16\) NOT NULL DEFAULT ''"\)/);
assert.match(schema, /ensureColumn\(pool, "call_outcome_audits", "scope_code", "VARCHAR\(16\) NOT NULL DEFAULT ''"\)/);
assert.match(schema, /ensureColumn\(pool, "call_outcome_audits", "row_count", "INT NOT NULL DEFAULT 0"\)/);
assert.match(schema, /ensureColumn\(pool, "call_outcome_audits", "result_code", "VARCHAR\(16\) NOT NULL DEFAULT ''"\)/);
assert.match(schema, /ensureColumn\(pool, "call_outcome_audits", "reason_code", "VARCHAR\(64\) NOT NULL DEFAULT ''"\)/);
assert.match(schema, /batch_id VARCHAR\(64\) NULL/);
assert.equal(schema.includes("DROP TABLE call_outcome_audits"), false);
assert.equal(schema.includes("DROP COLUMN batch_id"), false);
assert.equal(schema.includes("CREATE TABLE call_outcome_batches"), false);
assert.equal(schema.includes("CREATE TABLE unlabeled_connected_calls"), false);
assert.equal(schema.includes("ALTER TABLE outbound_call_records"), false);

const source = readFileSync(new URL("./call-outcome-batch.ts", import.meta.url), "utf8");
assert.match(source, /call_outcome_audits/);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("MakeCall"), false);

console.log("call outcome batch tests passed");
