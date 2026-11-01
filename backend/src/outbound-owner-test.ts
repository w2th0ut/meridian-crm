import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseOutboundOwnerClear,
  parseOutboundOwnerQuery,
  parseOutboundOwnerWrite,
  parseOwnerMineFilter,
  userOwnsOutboundTarget
} from "./outbound-owner.js";
import type { AliyunAgentMapping, OutboundOwner } from "./types.js";

const set = parseOutboundOwnerWrite({ targetType: "customer", targetId: "c1", agentId: "agent@ccc-a" });
assert.equal(set.ok && set.agentId, "agent@ccc-a");
assert.equal(parseOutboundOwnerWrite({ targetType: "lead", targetId: "l1", agentId: "agent@ccc-a" }).ok, true);
assert.equal(parseOutboundOwnerWrite({ targetType: "prospect", targetId: "web_seed_1", agentId: "agent@ccc-a" }).ok, true);
for (const body of [
  { targetType: "customer", targetId: "c1" },
  { targetType: "customer", targetId: "c1", agentId: "" },
  { targetType: "customer", targetId: "c1", agentId: "bad id" },
  { targetType: "vendor", targetId: "c1", agentId: "agent@ccc-a" },
  { targetType: "customer", targetId: "", agentId: "agent@ccc-a" },
  [{ targetType: "customer", targetId: "c1", agentId: "agent@ccc-a" }],
  { targetType: "customer", targetId: "c1", agentId: "agent@ccc-a", targets: [] },
  { targetType: "customer", targetId: "c1", agentId: "agent@ccc-a", agentIds: ["a"] }
]) {
  assert.equal(parseOutboundOwnerWrite(body).ok, false);
}
assert.equal(parseOutboundOwnerClear({ targetType: "customer", targetId: "c1" }).ok, true);
assert.equal(parseOutboundOwnerClear({ targetType: "customer", targetId: "c1", agentId: "agent@ccc-a" }).ok, false);
assert.equal(parseOutboundOwnerClear({ targets: [] }).ok, false);
assert.equal(parseOutboundOwnerQuery({}).ok, false);
assert.equal(parseOutboundOwnerQuery({ targetType: "customer" }).ok, false);
assert.deepEqual(parseOutboundOwnerQuery({ targetType: "lead", targetId: "l1" }), { ok: true, targetType: "lead", targetId: "l1" });
assert.equal(parseOutboundOwnerQuery({ targetType: ["customer"], targetId: "c1" }).ok, false);
assert.equal(parseOwnerMineFilter(undefined), "");
assert.equal(parseOwnerMineFilter(""), "");
assert.equal(parseOwnerMineFilter("mine"), "mine");
assert.equal(parseOwnerMineFilter("all"), null);
assert.equal(parseOwnerMineFilter(["mine"]), null);

const mapping = (partial: Partial<AliyunAgentMapping> & Pick<AliyunAgentMapping, "crmUserId" | "cccUserId">): AliyunAgentMapping => ({
  id: partial.cccUserId,
  teamId: "europe",
  loginName: "",
  displayName: partial.displayName || "",
  extension: "",
  workMode: "",
  updatedBy: "",
  updatedAt: "",
  ...partial
});
const owner = (partial: Partial<OutboundOwner> & Pick<OutboundOwner, "targetId" | "agentId">): OutboundOwner => ({
  id: partial.targetId,
  teamId: "europe",
  targetType: "customer",
  updatedBy: "",
  updatedAt: "",
  ...partial
});
const store = {
  aliyunAgentMappings: [
    mapping({ crmUserId: "u_sales_shirley", cccUserId: "agent@ccc-a", displayName: "Shirley坐席" }),
    mapping({ crmUserId: "u_sales_mia", cccUserId: "agent@ccc-b", displayName: "Mia坐席" })
  ],
  outboundOwners: [
    owner({ targetId: "c1", agentId: "agent@ccc-a" }),
    owner({ targetId: "c3", agentId: "agent@ccc-b" })
  ]
};
assert.equal(userOwnsOutboundTarget(store, { id: "u_sales_shirley", teamId: "europe" }, "customer", "c1"), true);
assert.equal(userOwnsOutboundTarget(store, { id: "u_sales_shirley", teamId: "europe" }, "customer", "c3"), false);
assert.equal(userOwnsOutboundTarget(store, { id: "u_sales_mia", teamId: "europe" }, "customer", "c3"), true);
assert.equal(userOwnsOutboundTarget(store, { id: "u_admin", teamId: "europe" }, "customer", "c1"), false);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS outbound_owners \(/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS outbound_owner_audits \(/);
assert.match(schema, /previous_agent_id/);
assert.match(schema, /next_agent_id/);
assert.match(schema, /uniq_outbound_owners_target/);
assert.equal(schema.includes("CREATE TABLE outbound_owners"), false);
assert.equal(schema.includes("CREATE TABLE outbound_owner_audits"), false);
assert.equal(schema.includes("DROP TABLE outbound_owners"), false);
assert.equal(schema.includes("DROP TABLE outbound_owner_audits"), false);
assert.equal(schema.includes("ALTER TABLE outbound_owners"), false);

const source = readFileSync(new URL("./outbound-owner.ts", import.meta.url), "utf8");
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("requestOutboundCall"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);

const dial = readFileSync(new URL("./outbound-call.ts", import.meta.url), "utf8");
assert.equal(dial.includes("outbound-owner"), false);

console.log("outbound owner unit tests passed");
