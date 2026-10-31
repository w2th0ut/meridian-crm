import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { IamActor } from "./auth.js";
import {
  PROSPECT_INDUSTRY_DENIED,
  PROSPECT_INDUSTRY_TEXT_MAX,
  applyProspectIndustry,
  normalizeProspectIndustry,
  prospectIndustryBlock,
  readProspectIndustry
} from "./prospect-industry.js";

assert.equal(readProspectIndustry(undefined), null);
assert.equal(readProspectIndustry(null), null);
assert.equal(readProspectIndustry(""), null);
assert.equal(readProspectIndustry("   "), null);
assert.equal(readProspectIndustry("  工业照明  "), "工业照明");
assert.equal(readProspectIndustry("灯".repeat(PROSPECT_INDUSTRY_TEXT_MAX + 1)), null);

const trimmed = normalizeProspectIndustry("  工业照明  ");
assert.equal(trimmed.ok, true);
if (trimmed.ok) assert.equal(trimmed.industry, "工业照明");

const maxed = normalizeProspectIndustry(`  ${"灯".repeat(PROSPECT_INDUSTRY_TEXT_MAX)}  `);
assert.equal(maxed.ok, true);
if (maxed.ok) assert.equal(maxed.industry.length, PROSPECT_INDUSTRY_TEXT_MAX);

for (const value of ["", "  ", "\n", null, undefined]) {
  const invalid = normalizeProspectIndustry(value);
  assert.equal(invalid.ok, false, String(value));
  if (!invalid.ok) assert.equal(invalid.message, "请填写行业");
}

const tooLong = normalizeProspectIndustry("灯".repeat(PROSPECT_INDUSTRY_TEXT_MAX + 1));
assert.equal(tooLong.ok, false);
if (!tooLong.ok) assert.equal(tooLong.message, "行业过长");

const setIndustry = applyProspectIndustry(null, "工业照明");
assert.equal(setIndustry.changed, true);
assert.equal(setIndustry.industry, "工业照明");

const same = applyProspectIndustry("  工业照明  ", "工业照明");
assert.equal(same.changed, false);
assert.equal(same.industry, "工业照明");

const replaced = applyProspectIndustry("工业照明", "水处理");
assert.equal(replaced.changed, true);
assert.equal(replaced.industry, "水处理");

const cleared = applyProspectIndustry("工业照明", null);
assert.equal(cleared.changed, true);
assert.equal(cleared.industry, null);

const clearAgain = applyProspectIndustry(null, null);
assert.equal(clearAgain.changed, false);
assert.equal(clearAgain.industry, null);

const junk = applyProspectIndustry("灯".repeat(PROSPECT_INDUSTRY_TEXT_MAX + 1), null);
assert.equal(junk.changed, false);
assert.equal(junk.industry, null);

const sales: IamActor = { id: "u_sales", teamId: "europe", role: "sales" };
const manager: IamActor = { id: "u_manager", teamId: "europe", role: "manager" };
const noExecute: IamActor = {
  id: "u_sales",
  teamId: "europe",
  role: "sales",
  iamPermissions: { "prospect.read": ["self"] }
};
assert.equal(prospectIndustryBlock(sales, undefined), PROSPECT_INDUSTRY_DENIED);
assert.equal(prospectIndustryBlock(noExecute, { ownerId: "u_sales", teamId: "europe" }), PROSPECT_INDUSTRY_DENIED);
assert.equal(prospectIndustryBlock(sales, { ownerId: "u_other", teamId: "europe" }), PROSPECT_INDUSTRY_DENIED);
assert.equal(prospectIndustryBlock(sales, { ownerId: "u_sales", teamId: "middle-east" }), PROSPECT_INDUSTRY_DENIED);
assert.equal(prospectIndustryBlock(manager, { ownerId: "u_sales", teamId: "middle-east" }), PROSPECT_INDUSTRY_DENIED);
assert.equal(prospectIndustryBlock(sales, { ownerId: "u_sales", teamId: "europe" }), null);
assert.equal(prospectIndustryBlock(manager, { ownerId: "u_sales", teamId: "europe" }), null);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS prospect_industry_audits \(/);
assert.equal(schema.includes("CREATE TABLE prospect_industry_audits"), false);
assert.match(schema, /old_value TEXT/);
assert.match(schema, /new_value TEXT/);
assert.match(schema, /ensureColumn\(pool, "website_opportunities", "industry", "VARCHAR\(120\) NULL"\)/);

console.log("prospect industry tests passed");
