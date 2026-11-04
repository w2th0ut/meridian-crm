import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMissingNextFollowupBatch } from "./missing-next-followup-batch.js";

const ok = parseMissingNextFollowupBatch({
  targets: [
    { targetType: "customer", targetId: "c1" },
    { targetType: "lead", targetId: "l1" },
    { targetType: " prospect ", targetId: " p_1 " }
  ],
  nextFollowAt: " 2026-11-06 09:00 ",
  note: "  改日再联系  "
});
assert.equal(ok.ok, true);
if (ok.ok) {
  assert.equal(ok.targets[2].targetType, "prospect");
  assert.equal(ok.targets[2].targetId, "p_1");
  assert.equal(ok.note, "改日再联系");
}

assert.equal(parseMissingNextFollowupBatch({ targets: [], nextFollowAt: "2026-11-06 09:00" }).ok, false);
assert.equal(parseMissingNextFollowupBatch({
  targets: [{ targetType: "customer", targetId: "c1" }, { targetType: "customer", targetId: "c1" }],
  nextFollowAt: "2026-11-06 09:00"
}).ok, false);
assert.equal(parseMissingNextFollowupBatch({
  targets: Array.from({ length: 101 }, (_, index) => ({ targetType: "customer", targetId: `c${index}` })),
  nextFollowAt: "2026-11-06 09:00"
}).ok, false);
assert.equal(parseMissingNextFollowupBatch({
  targets: [{ targetType: "customer", targetId: "c1" }],
  nextFollowAt: "2026-11-06 09:00",
  note: "字".repeat(201)
}).ok, false);
assert.equal(parseMissingNextFollowupBatch({
  targets: [{ targetType: "customer", targetId: "c1" }],
  nextFollowAt: "2026-11-06 09:00",
  records: ["c1"]
}).ok, false);
assert.equal(parseMissingNextFollowupBatch({
  targets: [{ targetType: "customer", targetId: "c1", callRecordId: "ocr" }],
  nextFollowAt: "2026-11-06 09:00"
}).ok, false);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
const tableStart = schema.indexOf("CREATE TABLE IF NOT EXISTS next_follow_up_audits");
const tableEnd = schema.indexOf("CREATE TABLE IF NOT EXISTS prospect_note_audits", tableStart);
assert.ok(tableStart > 0 && tableEnd > tableStart);
const table = schema.slice(tableStart, tableEnd);
assert.match(table, /batch_id VARCHAR\(64\) NULL/);
assert.match(schema, /ensureColumn\(pool, "next_follow_up_audits", "batch_id", "VARCHAR\(64\) NULL"\)/);
assert.equal(schema.includes("CREATE TABLE missing_next_followup"), false);
assert.equal(schema.includes("DROP TABLE next_follow_up_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS next_follow_up_audits"), false);

console.log("missing next follow-up batch tests passed");
