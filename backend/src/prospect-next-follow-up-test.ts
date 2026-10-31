import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { IamActor } from "./auth.js";
import {
  PROSPECT_NEXT_FOLLOW_UP_CLOCK,
  PROSPECT_NEXT_FOLLOW_UP_DENIED,
  earliestProspectNextFollowDate,
  normalizeProspectNextFollowDate,
  prospectNextFollowUpBlock
} from "./prospect-next-follow-up.js";

const now = new Date(2026, 9, 31, 15, 0, 0);
assert.equal(earliestProspectNextFollowDate(now), "2026-10-30");

const yesterday = normalizeProspectNextFollowDate("2026-10-30", now);
assert.equal(yesterday.ok, true);
if (yesterday.ok) {
  assert.equal(yesterday.date, "2026-10-30");
  assert.equal(yesterday.nextFollowAt, `2026-10-30 ${PROSPECT_NEXT_FOLLOW_UP_CLOCK}`);
}

const today = normalizeProspectNextFollowDate(" 2026-10-31 ", now);
assert.equal(today.ok, true);
if (today.ok) assert.equal(today.nextFollowAt, `2026-10-31 ${PROSPECT_NEXT_FOLLOW_UP_CLOCK}`);

const future = normalizeProspectNextFollowDate("2027-01-02", now);
assert.equal(future.ok, true);

const tooEarly = normalizeProspectNextFollowDate("2026-10-29", now);
assert.equal(tooEarly.ok, false);
if (!tooEarly.ok) assert.equal(tooEarly.message, "下次跟进日期不能早于昨天");

const blank = normalizeProspectNextFollowDate("  ", now);
assert.equal(blank.ok, false);
if (!blank.ok) assert.equal(blank.message, "请填写下次跟进日期");

for (const value of ["2026-02-31", "2026-13-01", "2026/10/31", "明天", "2026-10-31 09:00", "2026-10-31T09:00"]) {
  const invalid = normalizeProspectNextFollowDate(value, now);
  assert.equal(invalid.ok, false, value);
  if (!invalid.ok) assert.equal(invalid.message, "下次跟进日期不正确");
}

const sales: IamActor = { id: "u_sales", teamId: "europe", role: "sales" };
const manager: IamActor = { id: "u_manager", teamId: "europe", role: "manager" };
const noExecute: IamActor = {
  id: "u_sales",
  teamId: "europe",
  role: "sales",
  iamPermissions: { "prospect.read": ["self"] }
};
assert.equal(prospectNextFollowUpBlock(sales, undefined), PROSPECT_NEXT_FOLLOW_UP_DENIED);
assert.equal(prospectNextFollowUpBlock(noExecute, { ownerId: "u_sales", teamId: "europe" }), PROSPECT_NEXT_FOLLOW_UP_DENIED);
assert.equal(prospectNextFollowUpBlock(sales, { ownerId: "u_other", teamId: "europe" }), PROSPECT_NEXT_FOLLOW_UP_DENIED);
assert.equal(prospectNextFollowUpBlock(sales, { ownerId: "u_sales", teamId: "middle-east" }), PROSPECT_NEXT_FOLLOW_UP_DENIED);
assert.equal(prospectNextFollowUpBlock(manager, { ownerId: "u_sales", teamId: "middle-east" }), PROSPECT_NEXT_FOLLOW_UP_DENIED);
assert.equal(prospectNextFollowUpBlock(sales, { ownerId: "u_sales", teamId: "europe" }), null);
assert.equal(prospectNextFollowUpBlock(manager, { ownerId: "u_sales", teamId: "europe" }), null);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS next_follow_up_audits \(/);
assert.equal(schema.includes("CREATE TABLE next_follow_up_audits"), false);
assert.match(schema, /old_value TEXT/);
assert.match(schema, /new_value TEXT/);

console.log("prospect next follow up tests passed");
