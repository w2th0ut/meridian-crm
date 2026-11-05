import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PHONE_INVALID_BATCH_REASON_LABEL,
  PHONE_INVALID_BATCH_REASONS,
  parsePhoneInvalidBatch
} from "./phone-invalid-batch.js";

const source = readFileSync(new URL("./phone-invalid-batch.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
const validity = readFileSync(new URL("./phone-validity.ts", import.meta.url), "utf8");

assert.deepEqual([...PHONE_INVALID_BATCH_REASONS], ["bad_number", "out_of_service", "wrong_number"]);
assert.equal(PHONE_INVALID_BATCH_REASON_LABEL.bad_number, "空号");
assert.equal(PHONE_INVALID_BATCH_REASON_LABEL.out_of_service, "停机");
assert.equal(PHONE_INVALID_BATCH_REASON_LABEL.wrong_number, "号码错误");

assert.equal(parsePhoneInvalidBatch(null).ok, false);
assert.equal(parsePhoneInvalidBatch({ targets: [], reason: "bad_number" }).ok, false);
assert.equal(parsePhoneInvalidBatch({
  targets: Array.from({ length: 101 }, (_, index) => ({ targetType: "customer", targetId: `c${index}` })),
  reason: "bad_number"
}).ok, false);
assert.equal(parsePhoneInvalidBatch({
  targets: [{ targetType: "customer", targetId: "c1" }, { targetType: "customer", targetId: "c1" }],
  reason: "bad_number"
}).ok, false);
assert.equal(parsePhoneInvalidBatch({ targets: [{ targetType: "customer", targetId: "c1" }], reason: "empty" }).ok, false);
assert.equal(parsePhoneInvalidBatch({
  targets: [{ targetType: "customer", targetId: "c1" }],
  reason: "bad_number",
  phones: ["1"]
}).ok, false);
assert.deepEqual(parsePhoneInvalidBatch({
  targets: [{ targetType: " lead ", targetId: " l1 " }, { targetType: "prospect", targetId: "p1" }],
  reason: " wrong_number "
}), {
  ok: true,
  targets: [{ targetType: "lead", targetId: "l1" }, { targetType: "prospect", targetId: "p1" }],
  reason: "wrong_number"
});

assert.equal(source.includes("CREATE TABLE"), false);
assert.equal(source.includes("ensureColumn"), false);
assert.equal(source.includes("ensureSchema"), false);
assert.equal(source.includes("aliyuncs.com"), false);
assert.match(source, /wrong_number_alternate/);
assert.match(source, /marked_invalid|releasePreferredPhonesMarkedInvalid|applyPhoneInvalidChange/);
assert.equal(schema.includes("CREATE TABLE phone_invalid"), false);
assert.equal(schema.includes("DROP TABLE phone_validity"), false);
assert.match(schema, /ensureColumn\(pool, "phone_validity_audits", "batch_id", "VARCHAR\(64\) NULL"\)/);
assert.match(schema, /ensureColumn\(pool, "phone_validity_audits", "reason_code", "VARCHAR\(64\) NULL"\)/);
assert.match(validity, /if \(input\.reason\) audit\.reason = input\.reason/);

console.log("phone invalid batch tests passed");
