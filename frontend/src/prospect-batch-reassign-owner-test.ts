import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildProspectReassignOwnerBody,
  PROSPECT_OWNER_REASSIGN_LIMIT,
  showProspectReassignOwnerEntry,
  summarizeProspectOwnerReassign
} from "./prospect-batch-reassign-owner.js";

assert.equal(showProspectReassignOwnerEntry(false), false);
assert.equal(showProspectReassignOwnerEntry(true), true);

const empty = buildProspectReassignOwnerBody([], "u_sales_mia");
assert.equal(empty.ok, false);
if (!empty.ok) assert.equal(empty.message, "请先选择候选");

const missingOwner = buildProspectReassignOwnerBody(["web_seed_1"], "  ");
assert.equal(missingOwner.ok, false);
if (!missingOwner.ok) assert.equal(missingOwner.message, "请选择新负责人");

const tooMany = buildProspectReassignOwnerBody(
  Array.from({ length: PROSPECT_OWNER_REASSIGN_LIMIT + 1 }, (_, index) => `web_${index}`),
  "u_sales_mia"
);
assert.equal(tooMany.ok, false);
if (!tooMany.ok) assert.match(tooMany.message, /100/);

const built = buildProspectReassignOwnerBody([" web_a ", "web_a", "web_b"], " u_sales_mia ");
assert.equal(built.ok, true);
if (built.ok) {
  assert.deepEqual(built.body, { ids: ["web_a", "web_b"], ownerId: "u_sales_mia" });
}

assert.equal(summarizeProspectOwnerReassign([
  { ok: true },
  { ok: true }
]), "已改 2 条负责人");
assert.equal(summarizeProspectOwnerReassign([
  { ok: true },
  { ok: false, reason: "无权修改该候选的负责人" }
]), "已改 1 条。未改 1 条：无权修改该候选的负责人");

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /id="prospectReassignOwnerButton"[^>]*hidden/);
assert.match(html, /批量改负责人/);
const apiLayer = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(apiLayer, /\/api\/prospect-list\/reassign-owners/);
assert.match(apiLayer, /showProspectReassignOwnerEntry/);
assert.match(apiLayer, /confirmProspectReassignOwnerButton/);

console.log("prospect batch reassign owner frontend tests passed");
