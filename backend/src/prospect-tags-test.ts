import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { IamActor } from "./auth.js";
import {
  PROSPECT_CANDIDATE_TAGS_MAX,
  PROSPECT_TAG_CAP,
  PROSPECT_TAG_DENIED,
  applyProspectTags,
  normalizeProspectTags,
  prospectTagBlock
} from "./prospect-tags.js";

const trimmed = normalizeProspectTags(["  重点  ", "重点", "", "  欧洲", "欧洲"]);
assert.equal(trimmed.ok, true);
if (trimmed.ok) assert.deepEqual(trimmed.tags, ["重点", "欧洲"]);

const blank = normalizeProspectTags(["  ", ""]);
assert.equal(blank.ok, false);
if (!blank.ok) assert.equal(blank.message, "请填写标签");

const tooLong = normalizeProspectTags(["重".repeat(41)]);
assert.equal(tooLong.ok, false);
if (!tooLong.ok) assert.equal(tooLong.message, "标签过长");

const tooMany = normalizeProspectTags(Array.from({ length: 21 }, (_, index) => `标签${index}`));
assert.equal(tooMany.ok, false);
if (!tooMany.ok) assert.match(tooMany.message, /20/);

const added = applyProspectTags(["重点"], "add", ["重点", "欧洲"]);
assert.equal(added.ok, true);
if (added.ok) {
  assert.equal(added.changed, true);
  assert.deepEqual(added.tags, ["重点", "欧洲"]);
  assert.deepEqual(added.applied, ["欧洲"]);
}

const same = applyProspectTags(["重点"], "add", ["重点"]);
assert.equal(same.ok, true);
if (same.ok) assert.equal(same.changed, false);

const removed = applyProspectTags(["重点", "欧洲"], "remove", ["欧洲", "没有"]);
assert.equal(removed.ok, true);
if (removed.ok) {
  assert.deepEqual(removed.tags, ["重点"]);
  assert.deepEqual(removed.applied, ["欧洲"]);
}

const untouched = applyProspectTags(["重点"], "remove", ["没有"]);
assert.equal(untouched.ok, true);
if (untouched.ok) assert.equal(untouched.changed, false);

const full = applyProspectTags(
  Array.from({ length: PROSPECT_CANDIDATE_TAGS_MAX }, (_, index) => `已有${index}`),
  "add",
  ["新标签"]
);
assert.equal(full.ok, false);
if (!full.ok) assert.equal(full.reason, PROSPECT_TAG_CAP);

const sales: IamActor = { id: "u_sales", teamId: "europe", role: "sales" };
const manager: IamActor = { id: "u_manager", teamId: "europe", role: "manager" };
const noExecute: IamActor = {
  id: "u_sales",
  teamId: "europe",
  role: "sales",
  iamPermissions: { "prospect.read": ["self"] }
};
assert.equal(prospectTagBlock(sales, undefined), PROSPECT_TAG_DENIED);
assert.equal(prospectTagBlock(noExecute, { ownerId: "u_sales", teamId: "europe" }), PROSPECT_TAG_DENIED);
assert.equal(prospectTagBlock(sales, { ownerId: "u_other", teamId: "europe" }), PROSPECT_TAG_DENIED);
assert.equal(prospectTagBlock(sales, { ownerId: "u_sales", teamId: "middle-east" }), PROSPECT_TAG_DENIED);
assert.equal(prospectTagBlock(manager, { ownerId: "u_sales", teamId: "middle-east" }), PROSPECT_TAG_DENIED);
assert.equal(prospectTagBlock(sales, { ownerId: "u_sales", teamId: "europe" }), null);
assert.equal(prospectTagBlock(manager, { ownerId: "u_sales", teamId: "europe" }), null);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS prospect_tag_audits \(/);
assert.equal(schema.includes("CREATE TABLE prospect_tag_audits"), false);
assert.match(schema, /ensureColumn\(pool, "website_opportunities", "tags_json", "JSON"\)/);

console.log("prospect tag tests passed");
