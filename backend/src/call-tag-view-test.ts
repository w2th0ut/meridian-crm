import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  callTagIdsByTarget,
  parseCallTagListFilter,
  parseCallTagViewQuery,
  summarizeCallTagsOnCalls
} from "./call-tag-view.js";
import type { CallRecordTag, CallTag, OutboundCallRecord } from "./types.js";

const tags: CallTag[] = [
  { id: "ctag_price", teamId: "europe", name: "价格敏感", enabled: true, createdBy: "u", updatedBy: "u", createdAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-04-01T00:00:00.000Z", disabledAt: "" },
  { id: "ctag_sample", teamId: "europe", name: "要样品", enabled: false, createdBy: "u", updatedBy: "u", createdAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-04-02T00:00:00.000Z", disabledAt: "2026-04-02T00:00:00.000Z" },
  { id: "ctag_blank", teamId: "europe", name: "无时间", enabled: true, createdBy: "u", updatedBy: "u", createdAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-04-01T00:00:00.000Z", disabledAt: "" },
  { id: "ctag_asia", teamId: "asia", name: "亚洲标签勿出现", enabled: true, createdBy: "u", updatedBy: "u", createdAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-04-01T00:00:00.000Z", disabledAt: "" },
  { id: "ctag_unused", teamId: "europe", name: "没打过", enabled: true, createdBy: "u", updatedBy: "u", createdAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-04-01T00:00:00.000Z", disabledAt: "" }
];

function link(partial: Partial<CallRecordTag> & Pick<CallRecordTag, "id" | "callRecordId" | "tagId" | "createdAt">): CallRecordTag {
  return { teamId: "europe", createdBy: "u", ...partial };
}

const links: CallRecordTag[] = [
  link({ id: "crt_1", callRecordId: "ocr_1", tagId: "ctag_price", createdAt: "2026-04-01T00:00:00.000Z" }),
  link({ id: "crt_2", callRecordId: "ocr_2", tagId: "ctag_price", createdAt: "2026-04-03T00:00:00.000Z" }),
  link({ id: "crt_dup", callRecordId: "ocr_2", tagId: "ctag_price", createdAt: "2026-04-04T00:00:00.000Z" }),
  link({ id: "crt_3", callRecordId: "ocr_1", tagId: "ctag_sample", createdAt: "2026-04-02T00:00:00.000Z" }),
  link({ id: "crt_4", callRecordId: "ocr_3", tagId: "ctag_blank", createdAt: "" }),
  link({ id: "crt_5", callRecordId: "ocr_hidden", tagId: "ctag_price", createdAt: "2026-05-01T00:00:00.000Z" }),
  link({ id: "crt_6", callRecordId: "ocr_prospect", tagId: "ctag_price", createdAt: "2026-06-01T00:00:00.000Z" }),
  link({ id: "crt_asia", teamId: "asia", callRecordId: "ocr_asia", tagId: "ctag_asia", createdAt: "2026-04-01T00:00:00.000Z" })
];

const records = [
  { id: "ocr_1", teamId: "europe", targetType: "customer", targetId: "c1" },
  { id: "ocr_2", teamId: "europe", targetType: "customer", targetId: "c1" },
  { id: "ocr_3", teamId: "europe", targetType: "customer", targetId: "c1" },
  { id: "ocr_hidden", teamId: "europe", targetType: "customer", targetId: "c1" },
  { id: "ocr_prospect", teamId: "europe", targetType: "prospect", targetId: "c1" },
  { id: "ocr_lead", teamId: "europe", targetType: "lead", targetId: "l1" },
  { id: "ocr_asia", teamId: "asia", targetType: "customer", targetId: "c_asia" }
] as OutboundCallRecord[];

const visible = new Set(["ocr_1", "ocr_2", "ocr_3", "ocr_prospect", "ocr_lead"]);
const summary = summarizeCallTagsOnCalls({ callTags: tags, callRecordTags: links, outboundCallRecords: records }, "europe", "customer", "c1", visible);
assert.deepEqual(summary.map((item) => item.name), ["价格敏感", "无时间", "要样品"].sort((left, right) => left.localeCompare(right, "zh")));
const price = summary.find((item) => item.id === "ctag_price");
assert.equal(price?.count, 2);
assert.equal(price?.latestAt, "2026-04-04T00:00:00.000Z");
const sample = summary.find((item) => item.id === "ctag_sample");
assert.equal(sample?.enabled, false);
assert.equal(sample?.count, 1);
assert.equal(sample?.latestAt, "2026-04-02T00:00:00.000Z");
const blank = summary.find((item) => item.id === "ctag_blank");
assert.equal(blank?.count, 1);
assert.equal(blank?.latestAt, "");
assert.equal(summary.some((item) => item.id === "ctag_unused" || item.id === "ctag_asia"), false);
assert.equal(summarizeCallTagsOnCalls({ callTags: tags, callRecordTags: links, outboundCallRecords: records }, "europe", "lead", "l1", visible).length, 0);

const ids = callTagIdsByTarget(
  { callTags: tags, callRecordTags: links, outboundCallRecords: records },
  "europe",
  "customer",
  visible,
  new Set(["c1", "c2"])
);
assert.equal(ids.get("c1")?.has("ctag_price"), true);
assert.equal(ids.get("c1")?.has("ctag_asia"), false);
assert.equal(ids.has("c2"), false);

assert.deepEqual(parseCallTagListFilter(undefined), { ok: true, tagId: null });
assert.deepEqual(parseCallTagListFilter("  "), { ok: true, tagId: null });
assert.deepEqual(parseCallTagListFilter(" ctag_price "), { ok: true, tagId: "ctag_price" });
assert.equal(parseCallTagListFilter("none").ok, false);
assert.equal(parseCallTagListFilter(["ctag_price"]).ok, false);
assert.equal(parseCallTagListFilter("价格").ok, false);
assert.equal(parseCallTagViewQuery({}), true);
assert.equal(parseCallTagViewQuery({ extra: "1" }), false);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.equal(schema.includes("CREATE TABLE IF NOT EXISTS call_tag_view_audits"), true);
assert.equal(schema.includes("DROP TABLE call_tag_view_audits"), false);
assert.equal(schema.includes("DROP TABLE call_tags"), false);
assert.equal(schema.includes("ALTER TABLE call_tags"), false);
assert.equal(schema.includes("ALTER TABLE call_record_tags"), false);
assert.equal(schema.includes("ALTER TABLE outbound_call_records"), false);

const source = readFileSync(new URL("./call-tag-view.ts", import.meta.url), "utf8");
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);

console.log("call tag view tests passed");
