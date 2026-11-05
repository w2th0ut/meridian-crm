import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseBackupNumberBatch, selectNextBackup } from "./backup-number-batch.js";

assert.equal(parseBackupNumberBatch(null).ok, false);
assert.equal(parseBackupNumberBatch({ targets: [] }).ok, false);
assert.equal(parseBackupNumberBatch({
  targets: Array.from({ length: 101 }, (_, index) => ({ targetType: "customer", targetId: `c${index}` }))
}).ok, false);
assert.equal(parseBackupNumberBatch({
  targets: [{ targetType: "customer", targetId: "c1" }, { targetType: "customer", targetId: "c1" }]
}).ok, false);
assert.equal(parseBackupNumberBatch({ targets: [{ targetType: "customer", targetId: "c1" }], phones: ["1"] }).ok, false);
assert.deepEqual(parseBackupNumberBatch({
  targets: [{ targetType: " lead ", targetId: " l1 " }, { targetType: "prospect", targetId: "p1" }]
}), {
  ok: true,
  targets: [{ targetType: "lead", targetId: "l1" }, { targetType: "prospect", targetId: "p1" }]
});

const phones = [
  { phoneId: "main", phone: "+461" },
  { phoneId: "bad", phone: "+462" },
  { phoneId: "next", phone: "+463" }
];
const invalid = (phoneId: string) => phoneId === "bad";
assert.deepEqual(selectNextBackup(phones, "main", invalid), { currentPhoneId: "main", nextPhoneId: "next" });
assert.deepEqual(selectNextBackup(phones, "next", invalid), { currentPhoneId: "next", nextPhoneId: "" });
assert.deepEqual(selectNextBackup(phones, "bad", invalid), { currentPhoneId: "main", nextPhoneId: "next" });
assert.deepEqual(selectNextBackup([{ phoneId: "only", phone: "+464" }], "only", () => false), {
  currentPhoneId: "only",
  nextPhoneId: ""
});
assert.deepEqual(selectNextBackup([], "", () => false), { currentPhoneId: "", nextPhoneId: "" });

const source = readFileSync(new URL("./backup-number-batch.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.equal(source.includes("CREATE TABLE"), false);
assert.equal(source.includes("ensureColumn"), false);
assert.equal(source.includes("aliyuncs.com"), false);
assert.match(source, /next_backup/);
assert.equal(source.includes("missed_alternate"), false);
assert.equal(source.includes("wrong_number_alternate"), false);
assert.equal(schema.includes("CREATE TABLE preferred_phone_batches"), false);
assert.equal(schema.includes("CREATE TABLE backup_number"), false);
assert.equal(schema.includes("DROP TABLE preferred_phone"), false);
assert.match(schema, /CREATE TABLE IF NOT EXISTS preferred_phone_audits \([\s\S]*?batch_id VARCHAR\(64\) NULL,\n    INDEX idx_preferred_phone_audits_team/);
assert.match(schema, /ensureColumn\(pool, "preferred_phone_audits", "batch_id", "VARCHAR\(64\) NULL"\)/);

console.log("backup number batch tests passed");
