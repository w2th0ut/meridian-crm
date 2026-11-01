import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start outbound owner list test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

async function request(path: string, token: string, method = "GET", body?: unknown) {
  const response = await originalFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) as Record<string, any> : {};
  return { response, json, text };
}

async function login(email: string) {
  const response = await originalFetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "keduoduo123" })
  });
  const json = await response.json() as { token?: string };
  assert.equal(response.status, 200, `登录失败：${email}`);
  return String(json.token);
}

function idsOf(items: Array<{ id?: string }> | undefined) {
  return (items || []).map((item) => item.id);
}

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const alexUser = store.users.find((item) => item.email === "alex@keduoduo.com");
  const adminUser = store.users.find((item) => item.email === "admin@keduoduo.com");
  const baseCustomer = store.customers.find((item) => item.id === "c1");
  const baseLead = store.leads.find((item) => item.id === "l1");
  const baseProspect = store.websiteOpportunities.find((item) => item.id === "web_seed_1");
  assert.ok(shirleyUser && miaUser && alexUser && adminUser && baseCustomer && baseLead && baseProspect);
  store.users.push({
    ...adminUser,
    id: "u_list_asia_admin",
    name: "Asia List Admin",
    email: "asia-list-admin@keduoduo.com",
    role: "admin",
    teamId: "asia",
    status: "active"
  });
  store.customers.push(
    { ...baseCustomer, id: "c_list_s", company: "列表甲", ownerId: shirleyUser.id, phone: "" },
    { ...baseCustomer, id: "c_list_open", company: "列表未指派", ownerId: shirleyUser.id, phone: "" },
    { ...baseCustomer, id: "c_list_m", company: "列表乙", ownerId: miaUser.id, phone: "" },
    { ...baseCustomer, id: "c_list_cross", company: "列表越权", ownerId: miaUser.id, phone: "13800001111" },
    { ...baseCustomer, id: "c_list_asia", company: "列表亚洲", ownerId: "u_list_asia_admin", teamId: "asia", phone: "13900002222" }
  );
  store.leads.push(
    { ...baseLead, id: "l_list_s", company: "线索甲", ownerId: shirleyUser.id, phone: "" },
    { ...baseLead, id: "l_list_open", company: "线索未指派", ownerId: miaUser.id, phone: "" },
    { ...baseLead, id: "l_list_deleted", company: "线索已删", ownerId: shirleyUser.id, deletedAt: "2026-04-01T00:00:00.000Z", phone: "" }
  );
  store.websiteOpportunities.push(
    { ...baseProspect, id: "web_list_s", company: "清单甲", ownerId: shirleyUser.id, shortlistedAt: "2026-07-01T00:00:00.000Z" },
    { ...baseProspect, id: "web_list_open", company: "清单未指派", ownerId: shirleyUser.id, shortlistedAt: "2026-07-02T00:00:00.000Z" },
    { ...baseProspect, id: "web_list_cross", company: "清单越权", ownerId: miaUser.id, shortlistedAt: "2026-07-03T00:00:00.000Z" },
    { ...baseProspect, id: "web_list_pool", company: "尚未加入清单", ownerId: shirleyUser.id }
  );
  store.aliyunAgentMappings.push(
    {
      id: "map_list_shirley",
      teamId: "europe",
      crmUserId: shirleyUser.id,
      cccUserId: "agent@ccc-list-a",
      loginName: "shirley-list",
      displayName: "Shirley坐席",
      extension: "8501",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_list_mia",
      teamId: "europe",
      crmUserId: miaUser.id,
      cccUserId: "agent@ccc-list-b",
      loginName: "mia-list",
      displayName: "Mia坐席",
      extension: "8502",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_list_asia",
      teamId: "asia",
      crmUserId: "u_list_asia_admin",
      cccUserId: "agent@ccc-list-asia",
      loginName: "asia-list",
      displayName: "亚洲坐席",
      extension: "8503",
      workMode: "ON_SITE",
      updatedBy: "u_list_asia_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    }
  );
  store.outboundOwners.push(
    { id: "owo_list_s", teamId: "europe", targetType: "customer", targetId: "c_list_s", agentId: "agent@ccc-list-a", updatedBy: "u_admin", updatedAt: "2026-10-31T00:00:00.000Z" },
    { id: "owo_list_m", teamId: "europe", targetType: "customer", targetId: "c_list_m", agentId: "agent@ccc-list-b", updatedBy: "u_admin", updatedAt: "2026-10-31T00:00:00.000Z" },
    { id: "owo_list_cross", teamId: "europe", targetType: "customer", targetId: "c_list_cross", agentId: "agent@ccc-list-a", updatedBy: "u_admin", updatedAt: "2026-10-31T00:00:00.000Z" },
    { id: "owo_list_ls", teamId: "europe", targetType: "lead", targetId: "l_list_s", agentId: "agent@ccc-list-a", updatedBy: "u_admin", updatedAt: "2026-10-31T00:00:00.000Z" },
    { id: "owo_list_ps", teamId: "europe", targetType: "prospect", targetId: "web_list_s", agentId: "agent@ccc-list-a", updatedBy: "u_admin", updatedAt: "2026-10-31T00:00:00.000Z" },
    { id: "owo_list_pc", teamId: "europe", targetType: "prospect", targetId: "web_list_cross", agentId: "agent@ccc-list-a", updatedBy: "u_admin", updatedAt: "2026-10-31T00:00:00.000Z" },
    { id: "owo_list_pool", teamId: "europe", targetType: "prospect", targetId: "web_list_pool", agentId: "agent@ccc-list-a", updatedBy: "u_admin", updatedAt: "2026-10-31T00:00:00.000Z" },
    { id: "owo_list_asia", teamId: "asia", targetType: "customer", targetId: "c_list_asia", agentId: "agent@ccc-list-asia", updatedBy: "u_list_asia_admin", updatedAt: "2026-10-31T00:00:00.000Z" }
  );

  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  const followBefore = store.customers.find((item) => item.id === "c1")?.nextReminder;

  const shirley = await login("shirley@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const audits = () => store.outboundOwnerAudits.filter((item) => item.teamId === "europe" || item.teamId === "asia");

  const beforeBad = audits().length;
  for (const path of [
    "/api/customers?outboundOwner=*",
    "/api/customers?outboundOwner=mine&outboundOwner=unassigned",
    "/api/leads?outboundOwner=bad%20id",
    "/api/tools/website-opportunities?outboundOwner=nope!"
  ]) {
    const rejected = await request(path, admin);
    assert.equal(rejected.response.status, 400, `${path} ${JSON.stringify(rejected.json)}`);
  }
  assert.equal(audits().length, beforeBad);

  const salesCustomers = await request("/api/customers", shirley);
  assert.equal(salesCustomers.response.status, 200, JSON.stringify(salesCustomers.json));
  const salesIds = idsOf(salesCustomers.json.customers);
  assert.equal(salesIds.includes("c_list_s"), true);
  assert.equal(salesIds.includes("c_list_open"), true);
  assert.equal(salesIds.includes("c_list_cross"), false);
  assert.equal(salesIds.includes("c_list_asia"), false);
  const rowS = salesCustomers.json.customers.find((item: { id: string }) => item.id === "c_list_s");
  const rowOpen = salesCustomers.json.customers.find((item: { id: string }) => item.id === "c_list_open");
  assert.equal(rowS.ownerAgentId, "agent@ccc-list-a");
  assert.equal(rowS.ownerAgentLabel, "Shirley坐席");
  assert.equal(rowS.ownerName !== "Shirley坐席" || rowS.ownerId === shirleyUser.id, true);
  assert.equal(rowOpen.ownerAgentId, "");
  assert.equal(rowOpen.ownerAgentLabel, "");
  assert.equal(salesCustomers.json.outboundOwnerList.canManage, false);
  assert.deepEqual(salesCustomers.json.outboundOwnerList.myAgentIds, ["agent@ccc-list-a"]);
  assert.equal(salesCustomers.json.outboundOwnerList.agents.some((item: { agentId: string }) => item.agentId === "agent@ccc-list-asia"), false);
  assert.equal(salesCustomers.text.includes("13800001111"), false);

  const mine = await request("/api/customers?outboundOwner=mine", shirley);
  assert.equal(mine.response.status, 200);
  const mineIds = idsOf(mine.json.customers);
  assert.equal(mineIds.includes("c_list_s"), true);
  assert.equal(mineIds.includes("c_list_open"), false);
  assert.equal(mineIds.includes("c_list_cross"), false);
  assert.equal(mine.json.customers.length > 0, true);

  const unassigned = await request("/api/customers?outboundOwner=unassigned", shirley);
  assert.equal(idsOf(unassigned.json.customers).includes("c_list_open"), true);
  assert.equal(idsOf(unassigned.json.customers).includes("c_list_s"), false);

  const byAgent = await request("/api/customers?outboundOwner=agent@ccc-list-a", shirley);
  assert.equal(idsOf(byAgent.json.customers).includes("c_list_s"), true);
  assert.equal(idsOf(byAgent.json.customers).includes("c_list_cross"), false);
  assert.equal(idsOf(byAgent.json.customers).includes("c_list_m"), false);

  const adminByAgent = await request("/api/customers?outboundOwner=agent@ccc-list-a", admin);
  assert.equal(idsOf(adminByAgent.json.customers).includes("c_list_s"), true);
  assert.equal(idsOf(adminByAgent.json.customers).includes("c_list_cross"), true);
  assert.equal(idsOf(adminByAgent.json.customers).includes("c_list_asia"), false);
  assert.equal(adminByAgent.json.outboundOwnerList.canManage, true);
  assert.deepEqual(adminByAgent.json.outboundOwnerList.myAgentIds, []);
  const adminMine = await request("/api/customers?outboundOwner=mine", admin);
  assert.deepEqual(adminMine.json.customers, []);

  const manager = await request("/api/customers?outboundOwner=agent@ccc-list-b", alex);
  assert.equal(manager.response.status, 200);
  assert.equal(idsOf(manager.json.customers).includes("c_list_m"), true);
  assert.equal(manager.json.outboundOwnerList.canManage, false);

  const salesLeads = await request("/api/leads?outboundOwner=mine", shirley);
  assert.equal(idsOf(salesLeads.json.leads).includes("l_list_s"), true);
  assert.equal(idsOf(salesLeads.json.leads).includes("l_list_open"), false);
  const leadRow = salesLeads.json.leads.find((item: { id: string }) => item.id === "l_list_s");
  assert.equal(leadRow.ownerAgentLabel, "Shirley坐席");
  const leadOpen = await request("/api/leads?outboundOwner=unassigned", alex);
  assert.equal(idsOf(leadOpen.json.leads).includes("l_list_open"), true);
  assert.equal(idsOf(leadOpen.json.leads).includes("l_list_s"), false);
  const trash = await request("/api/leads?trash=true", shirley);
  const deleted = trash.json.leads.find((item: { id: string }) => item.id === "l_list_deleted");
  assert.ok(deleted);
  assert.equal(deleted.ownerAgentId, "");
  const activeDeleted = await request("/api/leads", shirley);
  assert.equal(idsOf(activeDeleted.json.leads).includes("l_list_deleted"), false);

  const prospects = await request("/api/tools/website-opportunities?outboundOwner=mine", shirley);
  assert.equal(prospects.response.status, 200, JSON.stringify(prospects.json));
  const prospectIds = idsOf(prospects.json.opportunities);
  assert.equal(prospectIds.includes("web_list_s"), true);
  assert.equal(prospectIds.includes("web_list_pool"), true);
  assert.equal(prospectIds.includes("web_list_open"), false);
  assert.equal(prospectIds.includes("web_list_cross"), false);
  const prospectRow = prospects.json.opportunities.find((item: { id: string }) => item.id === "web_list_s");
  assert.equal(prospectRow.ownerAgentLabel, "Shirley坐席");
  assert.equal(prospectRow.shortlistedAt, "2026-07-01T00:00:00.000Z");
  const prospectOpen = await request("/api/tools/website-opportunities?outboundOwner=unassigned", shirley);
  assert.equal(idsOf(prospectOpen.json.opportunities).includes("web_list_open"), true);
  assert.equal(idsOf(prospectOpen.json.opportunities).includes("web_list_s"), false);
  const adminProspects = await request("/api/tools/website-opportunities?outboundOwner=agent@ccc-list-a", admin);
  assert.equal(idsOf(adminProspects.json.opportunities).includes("web_list_cross"), true);
  assert.equal(adminProspects.text.includes("agent@ccc-list-asia"), false);

  const auditBefore = audits().length;
  const assigned = await request("/api/outbound-owners", admin, "POST", {
    targetType: "customer",
    targetId: "c_list_open",
    agentId: "agent@ccc-list-b"
  });
  assert.equal(assigned.response.status, 200, JSON.stringify(assigned.json));
  assert.equal(assigned.json.result, "updated");
  assert.equal(assigned.json.ownerAgentId, "agent@ccc-list-b");
  const assignAudit = audits().find((item) => item.targetId === "c_list_open" && item.action === "assign" && item.result === "updated");
  assert.ok(assignAudit);
  assert.equal(assignAudit.actorId, adminUser.id);
  assert.equal(assignAudit.previousAgentId, "");
  assert.equal(assignAudit.nextAgentId, "agent@ccc-list-b");
  const afterAssign = await request("/api/customers?outboundOwner=agent@ccc-list-b", admin);
  assert.equal(idsOf(afterAssign.json.customers).includes("c_list_open"), true);
  const same = await request("/api/outbound-owners", admin, "POST", {
    targetType: "customer",
    targetId: "c_list_open",
    agentId: "agent@ccc-list-b"
  });
  assert.equal(same.json.result, "unchanged");
  assert.equal(audits().filter((item) => item.targetId === "c_list_open" && item.result === "updated").length, 1);

  const moved = await request("/api/outbound-owners", admin, "POST", {
    targetType: "lead",
    targetId: "l_list_s",
    agentId: "agent@ccc-list-b"
  });
  assert.equal(moved.response.status, 200);
  const moveAudit = audits().find((item) => item.targetId === "l_list_s" && item.action === "reassign");
  assert.ok(moveAudit);
  assert.equal(moveAudit.previousAgentId, "agent@ccc-list-a");
  assert.equal(moveAudit.nextAgentId, "agent@ccc-list-b");

  const cleared = await request("/api/outbound-owners/clear", admin, "POST", {
    targetType: "prospect",
    targetId: "web_list_s"
  });
  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.json.result, "cleared");
  const clearAudit = audits().find((item) => item.targetId === "web_list_s" && item.action === "clear" && item.result === "updated");
  assert.ok(clearAudit);
  assert.equal(clearAudit.nextAgentId, "");
  const afterClear = await request("/api/tools/website-opportunities?outboundOwner=unassigned", shirley);
  assert.equal(idsOf(afterClear.json.opportunities).includes("web_list_s"), true);

  const denied = await request("/api/outbound-owners", shirley, "POST", {
    targetType: "customer",
    targetId: "c_list_s",
    agentId: "agent@ccc-list-b"
  });
  assert.equal(denied.response.status, 403);
  assert.equal(store.outboundOwners.find((item) => item.targetId === "c_list_s")?.agentId, "agent@ccc-list-a");
  assert.equal(audits()[0]?.actorId, shirleyUser.id);
  assert.equal(audits()[0]?.result, "rejected");
  assert.equal(audits()[0]?.reason, "forbidden");
  const managerDenied = await request("/api/outbound-owners/clear", alex, "POST", {
    targetType: "customer",
    targetId: "c_list_s"
  });
  assert.equal(managerDenied.response.status, 403);
  assert.equal(store.outboundOwners.find((item) => item.targetId === "c_list_s")?.agentId, "agent@ccc-list-a");
  assert.equal(audits()[0]?.reason, "forbidden");

  const batch = await request("/api/outbound-owners", admin, "POST", {
    targetType: "customer",
    targetId: "c_list_s",
    agentId: "agent@ccc-list-a",
    targetIds: ["c_list_open"]
  });
  assert.equal(batch.response.status, 400);
  assert.equal(audits().length >= auditBefore, true);

  const auditText = JSON.stringify(store.outboundOwnerAudits);
  assert.equal(auditText.includes("13800001111"), false);
  assert.equal(auditText.includes("13900002222"), false);
  assert.equal(auditText.includes("aliyuncs"), false);
  assert.equal(aliyunHits, 0);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  assert.equal(store.customers.find((item) => item.id === "c1")?.nextReminder, followBefore);

  console.log("outbound owner list http tests passed");
} finally {
  const store = getStore();
  const extraCustomers = new Set(["c_list_s", "c_list_open", "c_list_m", "c_list_cross", "c_list_asia"]);
  store.customers = store.customers.filter((item) => !extraCustomers.has(item.id));
  store.leads = store.leads.filter((item) => !item.id.startsWith("l_list_"));
  store.websiteOpportunities = store.websiteOpportunities.filter((item) => !item.id.startsWith("web_list_"));
  store.users = store.users.filter((item) => item.id !== "u_list_asia_admin");
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_list_"));
  store.outboundOwners = store.outboundOwners.filter((item) => !item.id.startsWith("owo_list_"));
  store.outboundOwnerAudits = store.outboundOwnerAudits.filter((item) => !["c_list_open", "c_list_s", "l_list_s", "web_list_s"].includes(item.targetId));
  globalThis.fetch = originalFetch;
  server.close();
}
