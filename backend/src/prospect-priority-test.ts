import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { IamActor } from "./auth.js";
import {
  PROSPECT_PRIORITY_DENIED,
  applyProspectPriority,
  normalizeProspectPriority,
  prospectPriorityBlock,
  readProspectPriority
} from "./prospect-priority.js";

assert.equal(readProspectPriority(undefined), null);
assert.equal(readProspectPriority(null), null);
assert.equal(readProspectPriority(""), null);
assert.equal(readProspectPriority("medium"), null);
assert.equal(readProspectPriority("high"), "high");

const high = normalizeProspectPriority(" high ");
assert.equal(high.ok, true);
if (high.ok) assert.equal(high.priority, "high");

const normal = normalizeProspectPriority("normal");
assert.equal(normal.ok, true);
if (normal.ok) assert.equal(normal.priority, "normal");

const low = normalizeProspectPriority("low");
assert.equal(low.ok, true);
if (low.ok) assert.equal(low.priority, "low");

for (const value of ["", "  ", "HIGH", "medium", "urgent", "高", null, undefined]) {
  const invalid = normalizeProspectPriority(value);
  assert.equal(invalid.ok, false, String(value));
  if (!invalid.ok) {
    assert.equal(invalid.message, value == null || !String(value).trim() ? "请填写优先级" : "优先级不正确");
  }
}

const setHigh = applyProspectPriority(null, "high");
assert.equal(setHigh.changed, true);
assert.equal(setHigh.priority, "high");

const same = applyProspectPriority("high", "high");
assert.equal(same.changed, false);
assert.equal(same.priority, "high");

const cleared = applyProspectPriority("low", null);
assert.equal(cleared.changed, true);
assert.equal(cleared.priority, null);

const clearAgain = applyProspectPriority(null, null);
assert.equal(clearAgain.changed, false);
assert.equal(clearAgain.priority, null);

const junk = applyProspectPriority("medium", null);
assert.equal(junk.changed, false);
assert.equal(junk.priority, null);

const sales: IamActor = { id: "u_sales", teamId: "europe", role: "sales" };
const manager: IamActor = { id: "u_manager", teamId: "europe", role: "manager" };
const noExecute: IamActor = {
  id: "u_sales",
  teamId: "europe",
  role: "sales",
  iamPermissions: { "prospect.read": ["self"] }
};
assert.equal(prospectPriorityBlock(sales, undefined), PROSPECT_PRIORITY_DENIED);
assert.equal(prospectPriorityBlock(noExecute, { ownerId: "u_sales", teamId: "europe" }), PROSPECT_PRIORITY_DENIED);
assert.equal(prospectPriorityBlock(sales, { ownerId: "u_other", teamId: "europe" }), PROSPECT_PRIORITY_DENIED);
assert.equal(prospectPriorityBlock(sales, { ownerId: "u_sales", teamId: "middle-east" }), PROSPECT_PRIORITY_DENIED);
assert.equal(prospectPriorityBlock(manager, { ownerId: "u_sales", teamId: "middle-east" }), PROSPECT_PRIORITY_DENIED);
assert.equal(prospectPriorityBlock(sales, { ownerId: "u_sales", teamId: "europe" }), null);
assert.equal(prospectPriorityBlock(manager, { ownerId: "u_sales", teamId: "europe" }), null);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS prospect_priority_audits \(/);
assert.equal(schema.includes("CREATE TABLE prospect_priority_audits"), false);
assert.match(schema, /old_value TEXT/);
assert.match(schema, /new_value TEXT/);
assert.match(schema, /ensureColumn\(pool, "website_opportunities", "priority", "VARCHAR\(20\) NULL"\)/);

console.log("prospect priority tests passed");
