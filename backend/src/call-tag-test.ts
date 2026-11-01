import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CALL_TAG_NAME_MAX,
  callTagCsvCell,
  formatCallTagValue,
  guardCallTagName,
  parseCallRecordTagRequest,
  parseCallTagCreate,
  parseCallTagDisable,
  parseCallTagQuery,
  parseCallTagRename,
  recordsMatchingCallTag
} from "./call-tag.js";
import type { CallRecordTag } from "./types.js";

assert.equal(parseCallTagCreate({ name: " 价格敏感 " }).ok, true);
if (parseCallTagCreate({ name: " 价格敏感 " }).ok) {
  assert.equal((parseCallTagCreate({ name: " 价格敏感 " }) as { name: string }).name, "价格敏感");
}
assert.equal(parseCallTagCreate({ name: "" }).ok, false);
assert.equal(parseCallTagCreate({ name: "标".repeat(CALL_TAG_NAME_MAX) }).ok, true);
assert.equal(parseCallTagCreate({ name: "标".repeat(CALL_TAG_NAME_MAX + 1) }).ok, false);
assert.equal(parseCallTagCreate({ name: "价格\n敏感" }).ok, false);
assert.equal(parseCallTagCreate({ name: "价格敏感", tags: [] }).ok, false);
assert.equal(parseCallTagRename({ id: "ctag_a", name: "要样品" }).ok, true);
assert.equal(parseCallTagRename({ id: "不是 id", name: "要样品" }).ok, false);
assert.equal(parseCallTagRename({ id: "ctag_a", name: "" }).ok, false);
assert.equal(parseCallTagDisable({ id: "ctag_a" }).ok, true);
assert.equal(parseCallTagDisable({ id: "ctag_a", name: "要样品" }).ok, false);
assert.equal(parseCallTagDisable({ tagIds: ["ctag_a"] }).ok, false);
assert.equal(parseCallRecordTagRequest({ tagId: "ctag_a" }).ok, true);
assert.equal(parseCallRecordTagRequest({}).ok, false);
assert.equal(parseCallRecordTagRequest({ tagId: "ctag_a", records: ["ocr_1"] }).ok, false);
assert.equal(parseCallTagQuery({}).ok, true);
assert.equal(parseCallTagQuery({ includeDisabled: "1" }).ok, false);

const value = formatCallTagValue({ enabled: true, name: "价格敏感" });
assert.match(value, /^enabled=1\nname=价格敏感$/);
assert.equal(value.includes("13800138000"), false);
assert.equal(guardCallTagName("=敏感"), "'=敏感");
assert.equal(guardCallTagName("+样品"), "'+样品");
assert.equal(guardCallTagName("-折扣"), "'-折扣");
assert.equal(guardCallTagName("@报价"), "'@报价");
assert.equal(guardCallTagName("价格敏感"), "价格敏感");
assert.equal(callTagCsvCell([
  { id: "a", name: "=敏感", enabled: false },
  { id: "b", name: "价格敏感", enabled: true }
]), "'=敏感、价格敏感");

const links: CallRecordTag[] = [
  { id: "crt_1", teamId: "europe", callRecordId: "ocr_1", tagId: "ctag_a", createdBy: "u", createdAt: "2026-04-01T00:00:00.000Z" },
  { id: "crt_2", teamId: "asia", callRecordId: "ocr_1", tagId: "ctag_asia", createdBy: "u", createdAt: "2026-04-01T00:00:00.000Z" }
];
const records = [{ id: "ocr_1" }, { id: "ocr_2" }];
assert.deepEqual(recordsMatchingCallTag(records, null, links, "europe").map((item) => item.id), ["ocr_1", "ocr_2"]);
assert.deepEqual(recordsMatchingCallTag(records, "ctag_a", links, "europe").map((item) => item.id), ["ocr_1"]);
assert.deepEqual(recordsMatchingCallTag(records, "none", links, "europe").map((item) => item.id), ["ocr_2"]);
assert.deepEqual(recordsMatchingCallTag(records, "ctag_asia", links, "europe").map((item) => item.id), []);
assert.deepEqual(recordsMatchingCallTag(records, "none", links, "asia").map((item) => item.id), ["ocr_2"]);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_tags \(/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_record_tags \(/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_tag_audits \(/);
assert.match(schema, /uniq_call_tags_name/);
assert.match(schema, /uniq_call_record_tags/);
assert.equal(schema.includes("CREATE TABLE call_tags"), false);
assert.equal(schema.includes("DROP TABLE call_tags"), false);
assert.equal(schema.includes("DROP TABLE call_record_tags"), false);
assert.equal(schema.includes("DROP TABLE call_tag_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS call_tags"), false);
assert.equal(schema.includes("ALTER TABLE call_tags"), false);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS call_tags \(/g) || []).length, 1);

const source = readFileSync(new URL("./call-tag.ts", import.meta.url), "utf8");
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("requestOutboundCall"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("openai"), false);

console.log("call tag unit tests passed");
