import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseQueueOwnerReassign } from "./queue-owner-reassign.js";

const parsed = parseQueueOwnerReassign({
  targets: [{ targetType: " customer ", targetId: "c_1" }, { targetType: "lead", targetId: "l_1" }],
  transferTo: " u_mia "
});
assert.equal(parsed.ok, true);
if (parsed.ok) {
  assert.equal(parsed.transferTo, "u_mia");
  assert.deepEqual(parsed.targets, [
    { targetType: "customer", targetId: "c_1" },
    { targetType: "lead", targetId: "l_1" }
  ]);
}
assert.equal(parseQueueOwnerReassign({ targets: [], transferTo: "u_mia" }).ok, false);
assert.equal(parseQueueOwnerReassign({
  targets: Array.from({ length: 101 }, (_, index) => ({ targetType: "customer", targetId: `c_${index}` })),
  transferTo: "u_mia"
}).ok, false);
if (!parseQueueOwnerReassign({
  targets: Array.from({ length: 101 }, (_, index) => ({ targetType: "customer", targetId: `c_${index}` })),
  transferTo: "u_mia"
}).ok) {
  assert.equal(parseQueueOwnerReassign({
    targets: Array.from({ length: 101 }, (_, index) => ({ targetType: "customer", targetId: `c_${index}` })),
    transferTo: "u_mia"
  }).ok, false);
}
const tooMany = parseQueueOwnerReassign({
  targets: Array.from({ length: 101 }, (_, index) => ({ targetType: "customer", targetId: `c_${index}` })),
  transferTo: "u_mia"
});
assert.equal(tooMany.ok, false);
if (!tooMany.ok) assert.equal(tooMany.reason, "too_many");
const duplicate = parseQueueOwnerReassign({
  targets: [{ targetType: "customer", targetId: "c_1" }, { targetType: "customer", targetId: "c_1" }],
  transferTo: "u_mia"
});
assert.equal(duplicate.ok, false);
const extra = parseQueueOwnerReassign({
  targets: [{ targetType: "customer", targetId: "c_1" }],
  transferTo: "u_mia",
  ownerIds: ["u_mia"]
});
assert.equal(extra.ok, false);
assert.equal(parseQueueOwnerReassign({ targets: [{ targetType: "customer", targetId: "c_1" }], transferTo: "   " }).ok, false);
assert.equal(parseQueueOwnerReassign({ targets: [{ targetType: "customer", targetId: "c_1" }], transferTo: "x".repeat(65) }).ok, false);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
const tableStart = schema.indexOf("CREATE TABLE IF NOT EXISTS owner_reassign_audits");
const tableEnd = schema.indexOf("CREATE TABLE IF NOT EXISTS prospect_tag_audits", tableStart);
assert.ok(tableStart > 0 && tableEnd > tableStart);
const table = schema.slice(tableStart, tableEnd);
assert.match(table, /batch_id VARCHAR\(64\) NULL/);
assert.match(schema, /ensureColumn\(pool, "owner_reassign_audits", "batch_id", "VARCHAR\(64\) NULL"\)/);
assert.equal(schema.includes("CREATE TABLE queue_owner_reassign"), false);
assert.equal(schema.includes("DROP TABLE owner_reassign_audits"), false);
assert.equal(schema.includes("DROP COLUMN batch_id"), false);

const source = readFileSync(new URL("./queue-owner-reassign.ts", import.meta.url), "utf8");
assert.match(source, /planCallOutcomeTransfer/);
assert.match(source, /collectNegativeOutcomeFollowupRows/);
assert.match(source, /collectTodayFollowRows/);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("CREATE TABLE"), false);

console.log("queue owner reassign tests passed");
