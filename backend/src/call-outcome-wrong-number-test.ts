import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCallOutcomeBatchRequest } from "./call-outcome-batch.js";
import { parseCallOutcomeRequest } from "./call-outcome.js";
import { parseMarkNumberInvalid } from "./call-outcome-wrong-number.js";

assert.deepEqual(parseMarkNumberInvalid("号码错误", undefined), { ok: true, mark: false });
assert.deepEqual(parseMarkNumberInvalid("号码错误", null), { ok: true, mark: false });
assert.deepEqual(parseMarkNumberInvalid("号码错误", false), { ok: true, mark: false });
assert.deepEqual(parseMarkNumberInvalid("有意向", false), { ok: true, mark: false });
assert.deepEqual(parseMarkNumberInvalid("号码错误", true), { ok: true, mark: true });
assert.deepEqual(parseMarkNumberInvalid("有意向", true), { ok: false, reason: "invalid_mark" });
assert.deepEqual(parseMarkNumberInvalid("号码错误", "true"), { ok: false, reason: "invalid_request" });
assert.deepEqual(parseMarkNumberInvalid("号码错误", [true]), { ok: false, reason: "invalid_request" });

assert.deepEqual(parseCallOutcomeRequest({ outcome: "号码错误", markNumberInvalid: true }), {
  ok: true,
  outcome: "号码错误",
  note: "",
  nextFollowChoice: "none",
  markNumberInvalid: true,
  transferTo: ""
});
assert.equal(parseCallOutcomeRequest({ outcome: "有意向", markNumberInvalid: true }).ok, false);
const markedElsewhere = parseCallOutcomeRequest({ outcome: "无意向", markNumberInvalid: true });
assert.equal(markedElsewhere.ok, false);
if (!markedElsewhere.ok) assert.equal(markedElsewhere.reason, "invalid_mark");
assert.equal(parseCallOutcomeRequest({ outcome: "号码错误", markNumberInvalid: "true" }).ok, false);
assert.equal(parseCallOutcomeRequest({ outcome: "号码错误", phoneIds: ["a"] }).ok, false);

assert.equal(parseCallOutcomeBatchRequest({
  callRecordIds: ["ocr_1"],
  outcome: "号码错误",
  markNumberInvalid: true
}).ok, false);

const source = readFileSync(new URL("./call-outcome-wrong-number.ts", import.meta.url), "utf8");
assert.match(source, /wrong_number_alternate/);
assert.match(source, /pickAlternatePhoneId/);
assert.match(source, /applyPhoneInvalidChange/);
assert.doesNotMatch(source, /makeCall|MakeCall|aliyuncs|convert_to_lead|approved_contactable|CREATE TABLE/i);
assert.equal(source.includes("outbound_call_holds"), false);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /ensureColumn\(pool, "phone_validity_audits", "result_code", "VARCHAR\(32\) NULL"\)/);
assert.match(schema, /ensureColumn\(pool, "phone_validity_audits", "reason_code", "VARCHAR\(64\) NULL"\)/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS phone_validity_audits \(/);
assert.equal(schema.includes("CREATE TABLE phone_validity_audits"), false);
assert.equal(schema.includes("CREATE TABLE wrong_number"), false);
assert.equal(schema.includes("DROP TABLE phone_validity"), false);

console.log("call outcome wrong number tests passed");
