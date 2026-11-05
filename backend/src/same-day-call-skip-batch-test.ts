import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSameDayCallSkipBatch } from "./same-day-call-skip.js";
import { parseSameDayCallSkipSet } from "./same-day-call-skip.js";

const one = { targetType: "customer", targetId: "c_1" };
assert.equal(parseSameDayCallSkipBatch({ targets: [one], reason: "asked_later" }).ok, true);
assert.equal(parseSameDayCallSkipBatch({ targets: [one, { targetType: "lead", targetId: "l_1" }], reason: "other", note: "  改日  ", resumeOn: "2026-11-20" }).ok, true);
assert.equal(parseSameDayCallSkipBatch({ targets: [one], reason: "other", note: "字".repeat(200) }).ok, true);
assert.equal(parseSameDayCallSkipBatch({ targets: [one], reason: "other", resumeOn: "" }).ok, true);
assert.equal(parseSameDayCallSkipBatch({ targets: [one], reason: "other", resumeOn: "   " }).ok, true);
const blankResume = parseSameDayCallSkipBatch({ targets: [one], reason: "other", resumeOn: "   " });
assert.equal(blankResume.ok && blankResume.resumeOn, "");
assert.equal(parseSameDayCallSkipBatch({ targets: [], reason: "other" }).ok, false);
assert.equal(parseSameDayCallSkipBatch({ targets: [one], reason: "nope" }).ok, false);
assert.equal(parseSameDayCallSkipBatch({ targets: [one, one], reason: "other" }).ok, false);
assert.equal(parseSameDayCallSkipBatch({ targets: Array.from({ length: 101 }, (_, index) => ({ targetType: "customer", targetId: `c_${index}` })), reason: "other" }).reason, "too_many");
assert.equal(parseSameDayCallSkipBatch({ targets: [one], reason: "other", note: "字".repeat(201) }).reason, "note_too_long");
assert.equal(parseSameDayCallSkipBatch({ targets: [one], reason: "other", resumeOn: "2026-11-31" }).reason, "resume_invalid");
assert.equal(parseSameDayCallSkipBatch({ targets: [one], reason: "other", records: ["c_1"] }).ok, false);
assert.equal(parseSameDayCallSkipBatch({ targets: [one], reason: "other", callRecordIds: ["c_1"] }).ok, false);
assert.equal(parseSameDayCallSkipSet({ targetType: "customer", targetId: "c_1", reason: "other", targets: [one] }).ok, false);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS same_day_call_skips \(/g) || []).length, 1);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS same_day_call_skip_audits \(/g) || []).length, 1);
assert.match(schema, /batch_id VARCHAR\(64\) NULL/);
assert.match(schema, /ensureColumn\(pool, "same_day_call_skip_audits", "batch_id", "VARCHAR\(64\) NULL"\)/);
assert.equal(schema.includes("CREATE TABLE IF NOT EXISTS same_day_call_skip_batches"), false);
assert.equal(schema.includes("CREATE TABLE IF NOT EXISTS outbound_call_holds"), false);
assert.equal(schema.includes("DROP TABLE same_day_call_skips"), false);
assert.equal(schema.includes("DROP TABLE same_day_call_skip_audits"), false);
assert.equal(schema.includes("DROP COLUMN batch_id"), false);
assert.equal(schema.includes("DROP COLUMN resume_on"), false);

const feature = readFileSync(new URL("./same-day-call-skip.ts", import.meta.url), "utf8");
const dial = readFileSync(new URL("./outbound-call.ts", import.meta.url), "utf8");
assert.equal((dial.match(/reason = "skipped_today"/g) || []).length, 1);
assert.equal(feature.includes('reason = "skipped_today"'), false);
assert.equal(feature.includes("aliyuncs.com"), false);
assert.equal(feature.includes("MakeCall"), false);
assert.equal(feature.includes("convert_to_lead"), false);
assert.equal(feature.includes("approved_contactable"), false);
assert.match(feature, /setSameDayCallSkipBatch/);

console.log("same-day call skip batch unit tests passed");
