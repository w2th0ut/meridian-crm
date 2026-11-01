import assert from "node:assert/strict";
import {
  outboundOwnerListMeta,
  outboundOwnerMatchesList,
  parseOutboundOwnerListFilter
} from "./outbound-owner.js";
import type { AliyunAgentMapping, OutboundOwner } from "./types.js";

assert.deepEqual(parseOutboundOwnerListFilter(undefined), { kind: "all" });
assert.deepEqual(parseOutboundOwnerListFilter(""), { kind: "all" });
assert.deepEqual(parseOutboundOwnerListFilter("mine"), { kind: "mine" });
assert.deepEqual(parseOutboundOwnerListFilter("unassigned"), { kind: "unassigned" });
assert.deepEqual(parseOutboundOwnerListFilter("agent@ccc-a"), { kind: "agent", agentId: "agent@ccc-a" });
assert.deepEqual(parseOutboundOwnerListFilter("all"), { kind: "agent", agentId: "all" });
assert.equal(parseOutboundOwnerListFilter("bad id"), null);
assert.equal(parseOutboundOwnerListFilter("*"), null);
assert.equal(parseOutboundOwnerListFilter(["mine"]), null);

const mappings = [
  { id: "m1", teamId: "europe", crmUserId: "u_sales_shirley", cccUserId: "agent@ccc-a", displayName: "Shirley坐席" },
  { id: "m2", teamId: "europe", crmUserId: "u_sales_mia", cccUserId: "agent@ccc-b", displayName: "Mia坐席" },
  { id: "m3", teamId: "asia", crmUserId: "u_asia", cccUserId: "agent@ccc-asia", displayName: "亚洲坐席" }
] as AliyunAgentMapping[];
const owners = [
  { id: "o1", teamId: "europe", targetType: "customer", targetId: "c1", agentId: "agent@ccc-a" },
  { id: "o2", teamId: "europe", targetType: "lead", targetId: "l1", agentId: "agent@ccc-b" }
] as OutboundOwner[];
const store = { aliyunAgentMappings: mappings, outboundOwners: owners };
const shirley = { id: "u_sales_shirley", teamId: "europe", role: "sales" };
const admin = { id: "u_admin", teamId: "europe", role: "admin" };

assert.equal(outboundOwnerMatchesList(store, shirley, "customer", "c1", { kind: "mine" }), true);
assert.equal(outboundOwnerMatchesList(store, shirley, "customer", "c2", { kind: "mine" }), false);
assert.equal(outboundOwnerMatchesList(store, shirley, "customer", "c2", { kind: "unassigned" }), true);
assert.equal(outboundOwnerMatchesList(store, shirley, "customer", "c1", { kind: "unassigned" }), false);
assert.equal(outboundOwnerMatchesList(store, shirley, "lead", "l1", { kind: "agent", agentId: "agent@ccc-b" }), true);
assert.equal(outboundOwnerMatchesList(store, shirley, "customer", "c1", { kind: "agent", agentId: "agent@ccc-b" }), false);
assert.equal(outboundOwnerMatchesList(store, admin, "customer", "c1", { kind: "mine" }), false);

const meta = outboundOwnerListMeta(store, admin);
assert.equal(meta.canManage, true);
assert.deepEqual(meta.myAgentIds, []);
assert.equal(meta.agents.some((item) => item.agentId === "agent@ccc-a"), true);
assert.equal(meta.agents.some((item) => item.agentId === "agent@ccc-asia"), false);
const sales = outboundOwnerListMeta(store, shirley);
assert.equal(sales.canManage, false);
assert.deepEqual(sales.myAgentIds, ["agent@ccc-a"]);

console.log("outbound owner list tests passed");
