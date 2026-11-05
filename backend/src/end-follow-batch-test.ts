import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEndFollowBatch } from "./end-follow-batch.js";

const ok = parseEndFollowBatch({
  targets: [
    { targetType: "customer", targetId: "c1" },
    { targetType: " lead ", targetId: " l_1 " },
    { targetType: "prospect", targetId: "p_1" }
  ],
  reason: "  不再跟进  "
});
assert.equal(ok.ok, true);
if (ok.ok) {
  assert.equal(ok.targets[1].targetType, "lead");
  assert.equal(ok.targets[1].targetId, "l_1");
  assert.equal(ok.reason, "不再跟进");
}
assert.equal(parseEndFollowBatch({ targets: [{ targetType: "customer", targetId: "c1" }] }).ok, true);

assert.equal(parseEndFollowBatch({ targets: [] }).ok, false);
assert.equal(parseEndFollowBatch({
  targets: [{ targetType: "customer", targetId: "c1" }, { targetType: "customer", targetId: "c1" }]
}).ok, false);
assert.equal(parseEndFollowBatch({
  targets: Array.from({ length: 101 }, (_, index) => ({ targetType: "customer", targetId: `c${index}` }))
}).ok, false);
assert.equal(parseEndFollowBatch({
  targets: [{ targetType: "customer", targetId: "c1" }],
  reason: "字".repeat(201)
}).ok, false);
assert.equal(parseEndFollowBatch({
  targets: [{ targetType: "customer", targetId: "c1" }],
  reason: 1
}).ok, false);
assert.equal(parseEndFollowBatch({
  targets: [{ targetType: "customer", targetId: "c1" }],
  records: ["c1"]
}).ok, false);
assert.equal(parseEndFollowBatch({
  targets: [{ targetType: "customer", targetId: "c1", callRecordId: "ocr" }]
}).ok, false);
assert.equal(parseEndFollowBatch({
  targets: [{ targetType: "customer", targetId: "c1" }],
  reason: "字".repeat(200)
}).ok, true);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
const tableStart = schema.indexOf("CREATE TABLE IF NOT EXISTS next_follow_up_audits");
const tableEnd = schema.indexOf("CREATE TABLE IF NOT EXISTS prospect_note_audits", tableStart);
assert.ok(tableStart > 0 && tableEnd > tableStart);
const table = schema.slice(tableStart, tableEnd);
assert.match(table, /batch_id VARCHAR\(64\) NULL/);
assert.match(table, /reason VARCHAR\(200\) NULL/);
assert.match(schema, /ensureColumn\(pool, "next_follow_up_audits", "reason", "VARCHAR\(200\) NULL"\)/);
assert.equal(schema.includes("CREATE TABLE end_follow"), false);
assert.equal(schema.includes("CREATE TABLE next_follow_up_batches"), false);
assert.equal(schema.includes("DROP TABLE next_follow_up_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS next_follow_up_audits"), false);
assert.equal(schema.includes("DROP COLUMN reason"), false);

const source = readFileSync(new URL("./end-follow-batch.ts", import.meta.url), "utf8");
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("makeCall"), false);
assert.equal(source.includes("aliyuncs.com"), false);

console.log("end follow batch tests passed");
