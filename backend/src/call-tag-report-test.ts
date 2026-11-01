import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCallTagReport,
  buildCallTagReportCsv,
  callTagReportFiltersText,
  parseCallTagReportQuery
} from "./call-tag-report.js";
import type { CallRecordTag, CallTag, CrmStore, OutboundCallRecord } from "./types.js";

assert.deepEqual(parseCallTagReportQuery({}), { from: null, to: null, agentId: null });
assert.deepEqual(parseCallTagReportQuery({ from: "2026-04-04", to: "2026-04-05", agentId: "agent@ccc-a" }), {
  from: "2026-04-04",
  to: "2026-04-05",
  agentId: "agent@ccc-a"
});
assert.equal(parseCallTagReportQuery({ from: "2026-04-06", to: "2026-04-05" }), null);
assert.equal(parseCallTagReportQuery({ from: "2026-02-31" }), null);
assert.equal(parseCallTagReportQuery({ agentId: "bad id" }), null);
assert.equal(parseCallTagReportQuery({ from: ["2026-04-04"] }), null);
assert.equal(parseCallTagReportQuery({ tag: "ctag_a" }), null);
assert.equal(callTagReportFiltersText({ from: "2026-04-04", to: null, agentId: null }).includes("13800138000"), false);

function tag(partial: Partial<CallTag> & Pick<CallTag, "id" | "name">): CallTag {
  return {
    teamId: "europe",
    enabled: true,
    createdBy: "u_admin",
    updatedBy: "u_admin",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    disabledAt: "",
    ...partial
  };
}

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    targetType: "customer",
    targetId: "c1",
    maskedNumber: "*******8000",
    contactType: "OUTBOUND",
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "10",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: String(Date.parse("2026-04-03T16:30:00.000Z")),
    agentIds: "agent@ccc-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/do-not-leak-tag-report",
    recordingDurationRaw: "99",
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

function link(partial: Partial<CallRecordTag> & Pick<CallRecordTag, "id" | "callRecordId" | "tagId">): CallRecordTag {
  return {
    teamId: "europe",
    createdBy: "u_admin",
    createdAt: "2026-04-04T01:00:00.000Z",
    ...partial
  };
}

const store = {
  callTags: [
    tag({ id: "ctag_price", name: "价格敏感" }),
    tag({ id: "ctag_eq", name: "=要样品" }),
    tag({ id: "ctag_old", name: "啊旧", enabled: false, disabledAt: "2026-04-02T00:00:00.000Z" }),
    tag({ id: "ctag_unused", name: "未使用" }),
    tag({ id: "ctag_asia", name: "亚洲标签", teamId: "asia" })
  ],
  outboundCallRecords: [
    record({ id: "ocr_c1a", targetId: "c1" }),
    record({ id: "ocr_c1b", targetId: "c1" }),
    record({ id: "ocr_lead", targetType: "lead", targetId: "l1" }),
    record({ id: "ocr_lead2", targetType: "lead", targetId: "l1", agentIds: "agent@ccc-a,agent@ccc-b" }),
    record({ id: "ocr_pro", targetType: "prospect", targetId: "p1" }),
    record({ id: "ocr_empty", targetType: "customer", targetId: "  " }),
    record({ id: "ocr_b", targetId: "c_b", agentIds: "agent@ccc-b" }),
    record({ id: "ocr_old", targetId: "c_old", startTimeRaw: String(Date.parse("2026-04-03T15:00:00.000Z")) }),
    record({ id: "ocr_blank", targetId: "c_blank", agentIds: "" }),
    record({ id: "ocr_bad", targetId: "c_bad", startTimeRaw: "not-a-time" }),
    record({ id: "ocr_dis", targetId: "c_dis" }),
    record({ id: "ocr_asia", teamId: "asia", targetId: "c_asia", agentIds: "agent@ccc-asia" })
  ],
  callRecordTags: [
    link({ id: "crt_1", callRecordId: "ocr_c1a", tagId: "ctag_price" }),
    link({ id: "crt_1b", callRecordId: "ocr_c1a", tagId: "ctag_price" }),
    link({ id: "crt_2", callRecordId: "ocr_c1b", tagId: "ctag_price" }),
    link({ id: "crt_2s", callRecordId: "ocr_c1b", tagId: "ctag_eq" }),
    link({ id: "crt_lead", callRecordId: "ocr_lead", tagId: "ctag_price" }),
    link({ id: "crt_lead2", callRecordId: "ocr_lead2", tagId: "ctag_price" }),
    link({ id: "crt_pro", callRecordId: "ocr_pro", tagId: "ctag_price" }),
    link({ id: "crt_empty", callRecordId: "ocr_empty", tagId: "ctag_price" }),
    link({ id: "crt_b", callRecordId: "ocr_b", tagId: "ctag_price" }),
    link({ id: "crt_old", callRecordId: "ocr_old", tagId: "ctag_price" }),
    link({ id: "crt_blank", callRecordId: "ocr_blank", tagId: "ctag_price" }),
    link({ id: "crt_bad", callRecordId: "ocr_bad", tagId: "ctag_price", createdAt: "" }),
    link({ id: "crt_dis", callRecordId: "ocr_dis", tagId: "ctag_old" }),
    link({ id: "crt_miss_call", callRecordId: "ocr_missing", tagId: "ctag_price" }),
    link({ id: "crt_miss_tag", callRecordId: "ocr_c1a", tagId: "ctag_missing" }),
    link({ id: "crt_asia", teamId: "asia", callRecordId: "ocr_asia", tagId: "ctag_asia" }),
    link({ id: "crt_cross", teamId: "asia", callRecordId: "ocr_c1a", tagId: "ctag_price" })
  ]
} as Pick<CrmStore, "callTags" | "callRecordTags" | "outboundCallRecords">;

const day = buildCallTagReport({
  store,
  teamId: "europe",
  query: { from: "2026-04-04", to: "2026-04-04", agentId: null },
  timeZone: "Asia/Shanghai"
});
assert.deepEqual(day.map((item) => item.tagId), ["ctag_eq", "ctag_price", "ctag_unused", "ctag_old"]);
const price = day.find((item) => item.tagId === "ctag_price");
assert.ok(price);
assert.equal(price.applyCount, 9);
assert.equal(price.callCount, 8);
assert.equal(price.customerCount, 3);
assert.equal(price.leadCount, 1);
assert.equal(price.enabled, true);
const sample = day.find((item) => item.tagId === "ctag_eq");
assert.ok(sample);
assert.equal(sample.applyCount, 1);
assert.equal(sample.callCount, 1);
assert.equal(sample.customerCount, 1);
assert.equal(sample.leadCount, 0);
const unused = day.find((item) => item.tagId === "ctag_unused");
assert.ok(unused);
assert.equal(unused.applyCount, 0);
assert.equal(unused.callCount, 0);
assert.equal(unused.customerCount, 0);
assert.equal(unused.leadCount, 0);
const old = day.find((item) => item.tagId === "ctag_old");
assert.ok(old);
assert.equal(old.enabled, false);
assert.equal(old.applyCount, 1);
assert.equal(old.callCount, 1);
assert.equal(old.customerCount, 1);
assert.equal(old.leadCount, 0);
assert.equal(day.some((item) => item.tagId === "ctag_asia" || item.name === "亚洲标签"), false);
assert.equal(day.some((item) => item.tagId === "ctag_missing"), false);

const agent = buildCallTagReport({
  store,
  teamId: "europe",
  query: { from: "2026-04-04", to: "2026-04-04", agentId: "agent@ccc-b" },
  timeZone: "Asia/Shanghai"
});
const agentPrice = agent.find((item) => item.tagId === "ctag_price");
assert.ok(agentPrice);
assert.equal(agentPrice.applyCount, 2);
assert.equal(agentPrice.callCount, 2);
assert.equal(agentPrice.customerCount, 1);
assert.equal(agentPrice.leadCount, 1);
assert.equal(agent.find((item) => item.tagId === "ctag_old")?.applyCount, 0);

const open = buildCallTagReport({
  store,
  teamId: "europe",
  query: { from: null, to: null, agentId: null },
  timeZone: "Asia/Shanghai"
});
const openPrice = open.find((item) => item.tagId === "ctag_price");
assert.ok(openPrice);
assert.equal(openPrice.callCount, 10);

const asia = buildCallTagReport({
  store,
  teamId: "asia",
  query: { from: null, to: null, agentId: null },
  timeZone: "Asia/Shanghai"
});
assert.deepEqual(asia.map((item) => item.tagId), ["ctag_asia"]);
assert.equal(asia[0]?.applyCount, 1);
assert.equal(asia[0]?.customerCount, 1);
assert.equal(asia[0]?.name.includes("价格敏感"), false);

const csv = buildCallTagReportCsv(day);
assert.equal(csv.charCodeAt(0), 0xfeff);
assert.match(csv, /标签,启用,被打上的次数,关联通话数,涉及客户数,涉及线索数/);
assert.match(csv, /'=要样品,是,1,1,1,0/);
assert.match(csv, /啊旧,否,1,1,1,0/);
assert.equal(csv.includes("do-not-leak-tag-report"), false);
assert.equal(csv.includes("*******8000"), false);
assert.equal(csv.includes("13800138000"), false);
assert.equal(csv.includes("c1"), false);
assert.equal(csv.includes("亚洲标签"), false);
assert.match(csv, /\r\n/);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_tag_report_audits \(/);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS call_tag_report_audits \(/g) || []).length, 1);
assert.equal(schema.includes("DROP TABLE call_tag_report_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS call_tag_report_audits"), false);
assert.equal(schema.includes("ALTER TABLE call_tag_report_audits"), false);
assert.equal(schema.includes("ALTER TABLE call_tags"), false);
assert.equal(schema.includes("ALTER TABLE call_record_tags"), false);
assert.equal(schema.includes("ALTER TABLE call_tag_audits"), false);
assert.equal(schema.includes("ALTER TABLE call_tag_view_audits"), false);
assert.equal(schema.includes("DROP TABLE call_tags"), false);
assert.equal(schema.includes("DROP TABLE call_record_tags"), false);

const source = readFileSync(new URL("./call-tag-report.ts", import.meta.url), "utf8");
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("requestOutboundCall"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("openai"), false);
assert.equal(source.includes("connectRate"), false);

console.log("call tag report unit tests passed");
