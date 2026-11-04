import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCallOutcomeBatchRequest } from "./call-outcome-batch.js";
import { parseCallOutcomeRequest } from "./call-outcome.js";
import { parseCallOutcomeTransfer, planCallOutcomeTransfer } from "./call-outcome-transfer.js";
import type { CrmStore } from "./store.js";
import type { SessionUser, WebsiteOpportunity } from "./types.js";

assert.deepEqual(parseCallOutcomeTransfer(undefined), { ok: true, transferTo: "" });
assert.deepEqual(parseCallOutcomeTransfer(null), { ok: true, transferTo: "" });
assert.deepEqual(parseCallOutcomeTransfer("  "), { ok: true, transferTo: "" });
assert.deepEqual(parseCallOutcomeTransfer(" u_sales_mia "), { ok: true, transferTo: "u_sales_mia" });
assert.equal(parseCallOutcomeTransfer(1).ok, false);
assert.equal(parseCallOutcomeTransfer(["u_sales_mia"]).ok, false);
assert.equal(parseCallOutcomeTransfer("x".repeat(65)).ok, false);

assert.equal(parseCallOutcomeRequest({ outcome: "有意向", transferTo: "u_sales_mia" }).ok, true);
const parsed = parseCallOutcomeRequest({ outcome: "有意向", transferTo: " u_sales_mia " });
assert.equal(parsed.ok, true);
if (parsed.ok) assert.equal(parsed.transferTo, "u_sales_mia");
assert.equal(parseCallOutcomeRequest({ outcome: "有意向" }).ok, true);
const omitted = parseCallOutcomeRequest({ outcome: "有意向" });
if (omitted.ok) assert.equal(omitted.transferTo, "");
assert.equal(parseCallOutcomeRequest({ outcome: "有意向", transferTo: ["u_sales_mia"] }).ok, false);
assert.equal(parseCallOutcomeRequest({ outcome: "有意向", ownerIds: ["u_sales_mia"] }).ok, false);
assert.equal(parseCallOutcomeRequest({ outcome: "有意向", assignees: ["u_sales_mia"] }).ok, false);
assert.equal(parseCallOutcomeBatchRequest({
  callRecordIds: ["ocr_1"],
  outcome: "有意向",
  transferTo: "u_sales_mia"
}).ok, false);

const manager = { id: "u_mgr", teamId: "europe", role: "manager", name: "M", email: "m@example.com" } as SessionUser;
const sales = { id: "u_sales", teamId: "europe", role: "sales", name: "S", email: "s@example.com" } as SessionUser;
const store = {
  users: [
    { id: "u_mgr", teamId: "europe", status: "active", role: "manager" },
    { id: "u_sales", teamId: "europe", status: "active", role: "sales" },
    { id: "u_mia", teamId: "europe", status: "active", role: "sales" },
    { id: "u_off", teamId: "europe", status: "disabled", role: "sales" },
    { id: "u_foreign", teamId: "asia", status: "active", role: "sales" }
  ],
  customers: [
    { id: "c_ok", teamId: "europe", ownerId: "u_sales", poolStatus: "owned" },
    { id: "c_pool", teamId: "europe", ownerId: "", poolStatus: "public" }
  ],
  leads: [
    { id: "l_ok", teamId: "europe", ownerId: "u_sales", deletedAt: "" }
  ],
  websiteOpportunities: [
    { id: "p_ok", teamId: "europe", ownerId: "u_sales", status: "preview" },
    { id: "p_synced", teamId: "europe", ownerId: "u_sales", status: "synced" }
  ] as WebsiteOpportunity[]
} as unknown as CrmStore;

const skipped = planCallOutcomeTransfer(store, sales, { targetType: "customer", targetId: "c_ok" }, "");
assert.equal(skipped.ok && skipped.kind === "skip", true);

const denied = planCallOutcomeTransfer(store, sales, { targetType: "customer", targetId: "c_ok" }, "u_mia");
assert.equal(denied.ok, false);
if (!denied.ok) {
  assert.equal(denied.status, 403);
  assert.equal(denied.reason, "forbidden");
  assert.equal(denied.audit?.action, "reject_forbidden");
}
assert.equal(store.customers[0].ownerId, "u_sales");

const moved = planCallOutcomeTransfer(store, manager, { targetType: "customer", targetId: "c_ok" }, "u_mia");
assert.equal(moved.ok && moved.kind === "write", true);
if (moved.ok && moved.kind === "write") {
  assert.equal(moved.previous, "u_sales");
  assert.equal(moved.next, "u_mia");
  assert.equal(moved.objectType, "customer");
  moved.apply();
}
assert.equal(store.customers[0].ownerId, "u_mia");

const same = planCallOutcomeTransfer(store, manager, { targetType: "customer", targetId: "c_ok" }, "u_mia");
assert.equal(same.ok && same.kind === "write" && same.previous === same.next, true);

const pooled = planCallOutcomeTransfer(store, manager, { targetType: "customer", targetId: "c_pool" }, "u_mia");
assert.equal(pooled.ok, false);
if (!pooled.ok) assert.equal(pooled.reason, "public_pool");
assert.equal(store.customers[1].ownerId, "");

const lead = planCallOutcomeTransfer(store, manager, { targetType: "lead", targetId: "l_ok" }, "u_mia");
assert.equal(lead.ok && lead.kind === "write" && lead.objectType === "lead", true);
const prospect = planCallOutcomeTransfer(store, manager, { targetType: "prospect", targetId: "p_ok" }, "u_mia");
assert.equal(prospect.ok && prospect.kind === "write" && prospect.objectType === "prospect_candidate", true);
const synced = planCallOutcomeTransfer(store, manager, { targetType: "prospect", targetId: "p_synced" }, "u_mia");
assert.equal(synced.ok, false);
if (!synced.ok) {
  assert.equal(synced.status, 400);
  assert.equal(synced.reason, "synced");
  assert.equal(synced.audit, null);
}
assert.equal(store.websiteOpportunities[1].ownerId, "u_sales");
const foreign = planCallOutcomeTransfer(store, manager, { targetType: "customer", targetId: "c_ok" }, "u_foreign");
assert.equal(foreign.ok, false);
if (!foreign.ok) {
  assert.equal(foreign.reason, "invalid_assignee");
  assert.equal(foreign.audit, null);
}
const disabled = planCallOutcomeTransfer(store, manager, { targetType: "lead", targetId: "l_ok" }, "u_off");
assert.equal(disabled.ok, false);
if (!disabled.ok) assert.equal(disabled.reason, "invalid_assignee");
const missing = planCallOutcomeTransfer(store, manager, { targetType: "", targetId: "" }, "u_mia");
assert.equal(missing.ok, false);
if (!missing.ok) assert.equal(missing.audit, null);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
const tableStart = schema.indexOf("CREATE TABLE IF NOT EXISTS owner_reassign_audits");
const tableEnd = schema.indexOf("CREATE TABLE IF NOT EXISTS prospect_tag_audits", tableStart);
assert.ok(tableStart > 0 && tableEnd > tableStart);
const table = schema.slice(tableStart, tableEnd);
assert.match(table, /call_record_id VARCHAR\(64\) NULL/);
assert.match(schema, /ensureColumn\(pool, "owner_reassign_audits", "call_record_id", "VARCHAR\(64\) NULL"\)/);
assert.equal(schema.includes("CREATE TABLE call_outcome_transfer"), false);
assert.equal(schema.includes("DROP TABLE owner_reassign_audits"), false);
assert.equal(schema.includes("DROP COLUMN call_record_id"), false);

const source = readFileSync(new URL("./call-outcome-transfer.ts", import.meta.url), "utf8");
const outcome = readFileSync(new URL("./call-outcome.ts", import.meta.url), "utf8");
for (const text of [source, outcome]) {
  assert.equal(text.includes("convert_to_lead"), false);
  assert.equal(text.includes("approved_contactable"), false);
  assert.equal(text.includes("aliyuncs.com"), false);
  assert.equal(text.includes("MakeCall"), false);
  assert.equal(text.includes("makeCall"), false);
  assert.equal(text.includes("CREATE TABLE"), false);
}
assert.match(source, /prospectOwnerReassignBlock/);
assert.match(source, /customer\.assign/);
assert.match(source, /lead\.assign/);

console.log("call outcome transfer tests passed");
