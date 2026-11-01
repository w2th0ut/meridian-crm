import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import type { OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start outbound owner test server");
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

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "agentIds" | "targetId">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    targetType: "customer",
    maskedNumber: "*******2333",
    contactType: "OUTBOUND",
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "10",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: String(Date.now()),
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/do-not-leak-owner",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "有意向",
    callOutcomeNote: "",
    callNote: "",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

function shanghaiDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function ids(items: Array<{ targetId?: string }> | undefined) {
  return (items || []).map((item) => item.targetId);
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
    id: "u_owner_asia_admin",
    name: "Asia Owner Admin",
    email: "asia-owner-admin@keduoduo.com",
    role: "admin",
    teamId: "asia",
    status: "active"
  });
  store.customers.push(
    { ...baseCustomer, id: "c_own_a", company: "负责坐席甲", ownerId: shirleyUser.id, nextReminder: "", phone: "" },
    { ...baseCustomer, id: "c_own_b", company: "负责坐席乙", ownerId: shirleyUser.id, nextReminder: "", phone: "" },
    { ...baseCustomer, id: "c_own_orphan", company: "负责坐席旧映射", ownerId: shirleyUser.id, nextReminder: "今天", phone: "" },
    { ...baseCustomer, id: "c_own_asia", company: "亚洲客户", ownerId: "u_owner_asia_admin", teamId: "asia", nextReminder: "", phone: "13800000000" }
  );
  store.leads.push({ ...baseLead, id: "l_own_deleted", company: "已删除线索", deletedAt: "2026-04-01T00:00:00.000Z" });
  store.aliyunAgentMappings.push(
    {
      id: "map_own_shirley",
      teamId: "europe",
      crmUserId: shirleyUser.id,
      cccUserId: "agent@ccc-own-a",
      loginName: "shirley",
      displayName: "Shirley坐席",
      extension: "8401",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_own_mia",
      teamId: "europe",
      crmUserId: miaUser.id,
      cccUserId: "agent@ccc-own-b",
      loginName: "mia",
      displayName: "Mia坐席",
      extension: "8402",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_own_alex",
      teamId: "europe",
      crmUserId: alexUser.id,
      cccUserId: "agent@ccc-own-alex",
      loginName: "alex",
      displayName: "Alex坐席",
      extension: "8403",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_own_temp",
      teamId: "europe",
      crmUserId: adminUser.id,
      cccUserId: "agent@ccc-own-temp",
      loginName: "temp",
      displayName: "临时坐席",
      extension: "8404",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_own_asia",
      teamId: "asia",
      crmUserId: "u_owner_asia_admin",
      cccUserId: "agent@ccc-own-asia",
      loginName: "asia",
      displayName: "亚洲坐席",
      extension: "8405",
      workMode: "ON_SITE",
      updatedBy: "u_owner_asia_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    }
  );
  const today = shanghaiDay();
  store.callbackSchedules.push(
    {
      id: "cbs_own_c1",
      teamId: "europe",
      targetType: "customer",
      targetId: "c1",
      scheduledAt: `${today} 09:00`,
      note: "",
      updatedBy: "u_admin",
      updatedAt: "2026-04-04T00:00:00.000Z",
      sourceCallRecordId: ""
    },
    {
      id: "cbs_own_c3",
      teamId: "europe",
      targetType: "customer",
      targetId: "c3",
      scheduledAt: `${today} 10:00`,
      note: "",
      updatedBy: "u_admin",
      updatedAt: "2026-04-04T00:00:00.000Z",
      sourceCallRecordId: ""
    }
  );
  store.outboundCallRecords.push(
    record({ id: "ocr_own_a", agentIds: "agent@ccc-own-a", targetId: "c_own_a" }),
    record({ id: "ocr_own_b", agentIds: "agent@ccc-own-a", targetId: "c_own_b" })
  );

  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const recordsBefore = store.outboundCallRecords.map((item) => JSON.stringify(item));
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  const followBefore = store.customers.find((item) => item.id === "c1")?.nextReminder;

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const asia = await login("asia-owner-admin@keduoduo.com");

  const audits = () => store.outboundOwnerAudits.filter((item) => item.teamId === "europe" || item.teamId === "asia");
  const beforeBad = audits().length;
  for (const body of [
    { targetType: "customer", targetId: "c1" },
    { targetType: "customer", targetId: "c1", agentId: "bad id" },
    [{ targetType: "customer", targetId: "c1", agentId: "agent@ccc-own-a" }],
    { targetType: "customer", targetId: "c1", agentId: "agent@ccc-own-a", targets: [] },
    { targetType: "vendor", targetId: "c1", agentId: "agent@ccc-own-a" }
  ]) {
    const rejected = await request("/api/outbound-owners", admin, "POST", body);
    assert.equal(rejected.response.status, 400, JSON.stringify(rejected.json));
  }
  assert.equal(audits().length, beforeBad);

  const assigned = await request("/api/outbound-owners", admin, "POST", { targetType: "customer", targetId: "c1", agentId: "agent@ccc-own-a" });
  assert.equal(assigned.response.status, 200, JSON.stringify(assigned.json));
  assert.equal(assigned.json.result, "updated");
  assert.equal(assigned.json.ownerAgentId, "agent@ccc-own-a");
  assert.equal(assigned.json.ownerAgentLabel, "Shirley坐席");
  assert.equal(assigned.json.canManage, true);
  const assignAudit = audits().find((item) => item.targetId === "c1" && item.action === "assign" && item.result === "updated");
  assert.ok(assignAudit);
  assert.equal(assignAudit.actorId, adminUser.id);
  assert.equal(assignAudit.previousAgentId, "");
  assert.equal(assignAudit.nextAgentId, "agent@ccc-own-a");
  assert.ok(assignAudit.at);

  const again = await request("/api/outbound-owners", admin, "POST", { targetType: "customer", targetId: "c1", agentId: "agent@ccc-own-a" });
  assert.equal(again.response.status, 200);
  assert.equal(again.json.result, "unchanged");
  assert.equal(audits().filter((item) => item.targetId === "c1" && item.result === "updated").length, 1);

  const leadAssigned = await request("/api/outbound-owners", admin, "POST", { targetType: "lead", targetId: "l1", agentId: "agent@ccc-own-b" });
  assert.equal(leadAssigned.response.status, 200, JSON.stringify(leadAssigned.json));
  assert.equal(leadAssigned.json.ownerAgentLabel, "Mia坐席");
  assert.equal(leadAssigned.text.includes("+49"), false);
  const prospectAssigned = await request("/api/outbound-owners", admin, "POST", { targetType: "prospect", targetId: "web_seed_1", agentId: "agent@ccc-own-a" });
  assert.equal(prospectAssigned.response.status, 200, JSON.stringify(prospectAssigned.json));
  assert.equal(prospectAssigned.json.ownerAgentId, "agent@ccc-own-a");

  const moved = await request("/api/outbound-owners", admin, "POST", { targetType: "customer", targetId: "c1", agentId: "agent@ccc-own-b" });
  assert.equal(moved.response.status, 200);
  assert.equal(moved.json.result, "updated");
  assert.equal(moved.json.ownerAgentId, "agent@ccc-own-b");
  const moveAudit = audits().find((item) => item.targetId === "c1" && item.action === "reassign");
  assert.ok(moveAudit);
  assert.equal(moveAudit.previousAgentId, "agent@ccc-own-a");
  assert.equal(moveAudit.nextAgentId, "agent@ccc-own-b");

  const cleared = await request("/api/outbound-owners/clear", admin, "POST", { targetType: "customer", targetId: "c1" });
  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.json.result, "cleared");
  assert.equal(cleared.json.ownerAgentId, "");
  assert.equal(store.outboundOwners.some((item) => item.targetId === "c1"), false);
  const clearAudit = audits().find((item) => item.targetId === "c1" && item.action === "clear" && item.result === "updated");
  assert.ok(clearAudit);
  assert.equal(clearAudit.previousAgentId, "agent@ccc-own-b");
  assert.equal(clearAudit.nextAgentId, "");
  const clearAgain = await request("/api/outbound-owners/clear", admin, "POST", { targetType: "customer", targetId: "c1" });
  assert.equal(clearAgain.json.result, "unchanged");
  assert.equal(audits().filter((item) => item.targetId === "c1" && item.action === "clear" && item.result === "updated").length, 1);

  await request("/api/outbound-owners", admin, "POST", { targetType: "customer", targetId: "c1", agentId: "agent@ccc-own-a" });
  await request("/api/outbound-owners", admin, "POST", { targetType: "customer", targetId: "c3", agentId: "agent@ccc-own-b" });
  await request("/api/outbound-owners", admin, "POST", { targetType: "customer", targetId: "c_own_a", agentId: "agent@ccc-own-a" });
  await request("/api/outbound-owners", admin, "POST", { targetType: "customer", targetId: "c_own_b", agentId: "agent@ccc-own-b" });

  const missingAgentBefore = audits().length;
  const missingAgent = await request("/api/outbound-owners", admin, "POST", { targetType: "customer", targetId: "c1", agentId: "agent@ccc-own-missing" });
  assert.equal(missingAgent.response.status, 404);
  assert.equal(store.outboundOwners.find((item) => item.targetId === "c1")?.agentId, "agent@ccc-own-a");
  assert.equal(audits().length, missingAgentBefore + 1);
  assert.equal(audits()[0]?.reason, "not_found");

  const salesBefore = store.outboundOwners.find((item) => item.targetId === "c1")?.agentId;
  const salesDenied = await request("/api/outbound-owners", shirley, "POST", { targetType: "customer", targetId: "c1", agentId: "agent@ccc-own-b" });
  assert.equal(salesDenied.response.status, 403);
  assert.equal(store.outboundOwners.find((item) => item.targetId === "c1")?.agentId, salesBefore);
  assert.equal(audits()[0]?.actorId, shirleyUser.id);
  assert.equal(audits()[0]?.result, "rejected");
  assert.equal(audits()[0]?.reason, "forbidden");
  const managerDenied = await request("/api/outbound-owners/clear", alex, "POST", { targetType: "customer", targetId: "c1" });
  assert.equal(managerDenied.response.status, 403);
  assert.equal(store.outboundOwners.find((item) => item.targetId === "c1")?.agentId, salesBefore);
  assert.equal(audits()[0]?.reason, "forbidden");

  const foreign = await request("/api/outbound-owners", admin, "POST", { targetType: "customer", targetId: "c_own_asia", agentId: "agent@ccc-own-a" });
  assert.equal(foreign.response.status, 404);
  assert.equal(store.outboundOwners.some((item) => item.targetId === "c_own_asia"), false);
  const asiaSet = await request("/api/outbound-owners", asia, "POST", { targetType: "customer", targetId: "c_own_asia", agentId: "agent@ccc-own-asia" });
  assert.equal(asiaSet.response.status, 200, JSON.stringify(asiaSet.json));
  assert.equal(asiaSet.json.ownerAgentId, "agent@ccc-own-asia");
  const europeCannot = await request("/api/outbound-owners/clear", admin, "POST", { targetType: "customer", targetId: "c_own_asia" });
  assert.equal(europeCannot.response.status, 404);
  assert.equal(store.outboundOwners.find((item) => item.targetId === "c_own_asia")?.agentId, "agent@ccc-own-asia");

  const deleted = await request("/api/outbound-owners", admin, "POST", { targetType: "lead", targetId: "l_own_deleted", agentId: "agent@ccc-own-a" });
  assert.equal(deleted.response.status, 404);
  assert.equal(audits()[0]?.reason, "not_found");

  const tempAssigned = await request("/api/outbound-owners", admin, "POST", { targetType: "customer", targetId: "c_own_orphan", agentId: "agent@ccc-own-temp" });
  assert.equal(tempAssigned.response.status, 200);
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => item.id !== "map_own_temp");
  const sameOrphan = await request("/api/outbound-owners", admin, "POST", { targetType: "customer", targetId: "c_own_orphan", agentId: "agent@ccc-own-temp" });
  assert.equal(sameOrphan.json.result, "unchanged");
  const orphanClear = await request("/api/outbound-owners/clear", admin, "POST", { targetType: "customer", targetId: "c_own_orphan" });
  assert.equal(orphanClear.response.status, 200);
  assert.equal(orphanClear.json.result, "cleared");
  assert.equal(store.outboundOwners.some((item) => item.targetId === "c_own_orphan"), false);

  const readSales = await request("/api/outbound-owners?targetType=customer&targetId=c1", shirley);
  assert.equal(readSales.response.status, 200, JSON.stringify(readSales.json));
  assert.equal(readSales.json.ownerAgentLabel, "Shirley坐席");
  assert.equal(readSales.json.canManage, false);
  assert.deepEqual(readSales.json.agents, []);
  assert.equal(readSales.text.includes("保存负责坐席"), false);
  const hidden = await request("/api/outbound-owners?targetType=customer&targetId=c3", shirley);
  assert.equal(hidden.response.status, 403);
  assert.equal(hidden.text.includes("agent@ccc-own-b"), false);
  assert.equal(audits()[0]?.reason, "forbidden");
  const adminRead = await request("/api/outbound-owners?targetType=customer&targetId=c3", admin);
  assert.equal(adminRead.response.status, 200);
  assert.equal(adminRead.json.canManage, true);
  assert.equal(adminRead.json.agents.some((item: { agentId: string }) => item.agentId === "agent@ccc-own-a"), true);
  assert.equal(adminRead.json.agents.some((item: { agentId: string }) => item.agentId === "agent@ccc-own-asia"), false);

  const queue = await request("/api/intent-followup-queue", shirley);
  assert.equal(queue.response.status, 200, JSON.stringify(queue.json));
  const queueIds = ids(queue.json.items);
  assert.equal(queueIds.includes("c_own_a"), true);
  assert.equal(queueIds.includes("c_own_b"), true);
  const rowA = queue.json.items.find((item: { targetId: string }) => item.targetId === "c_own_a");
  const rowB = queue.json.items.find((item: { targetId: string }) => item.targetId === "c_own_b");
  assert.equal(rowA.ownerAgentLabel, "Shirley坐席");
  assert.equal(rowB.ownerAgentLabel, "Mia坐席");
  const mineQueue = await request("/api/intent-followup-queue?owner=mine", shirley);
  assert.equal(mineQueue.response.status, 200);
  assert.deepEqual(ids(mineQueue.json.items), ["c_own_a"]);
  const badOwner = await request("/api/intent-followup-queue?owner=all", shirley);
  assert.equal(badOwner.response.status, 400);
  const miaQueue = await request("/api/intent-followup-queue?owner=mine", mia);
  assert.equal(ids(miaQueue.json.items).includes("c_own_a"), false);
  assert.equal(ids(miaQueue.json.items).includes("c_own_b"), false);

  const callbacks = await request(`/api/callback-schedules?due=today`, shirley);
  assert.equal(callbacks.response.status, 200, JSON.stringify(callbacks.json));
  assert.equal(ids(callbacks.json.items).includes("c1"), true);
  assert.equal(ids(callbacks.json.items).includes("c3"), false);
  const callbackRow = callbacks.json.items.find((item: { targetId: string }) => item.targetId === "c1");
  assert.equal(callbackRow.ownerAgentLabel, "Shirley坐席");
  const mineCallbacks = await request("/api/callback-schedules?due=today&owner=mine", shirley);
  assert.deepEqual(ids(mineCallbacks.json.items), ["c1"]);
  await request("/api/outbound-owners", admin, "POST", { targetType: "customer", targetId: "c1", agentId: "agent@ccc-own-b" });
  const afterMove = await request("/api/callback-schedules?due=today", shirley);
  assert.equal(ids(afterMove.json.items).includes("c1"), true);
  assert.equal(afterMove.json.items.find((item: { targetId: string }) => item.targetId === "c1").ownerAgentLabel, "Mia坐席");
  const mineAfter = await request("/api/callback-schedules?due=today&owner=mine", shirley);
  assert.equal(ids(mineAfter.json.items).includes("c1"), false);
  const miaMine = await request("/api/callback-schedules?due=today&owner=mine", mia);
  assert.equal(ids(miaMine.json.items).includes("c3"), true);
  assert.equal(ids(miaMine.json.items).includes("c1"), false);
  const alexMine = await request("/api/callback-schedules?due=due&owner=mine", alex);
  assert.equal(alexMine.response.status, 200);
  assert.equal(ids(alexMine.json.items).includes("c1"), false);
  assert.equal(ids(alexMine.json.items).includes("c3"), false);
  const badCallback = await request("/api/callback-schedules?owner=team", alex);
  assert.equal(badCallback.response.status, 400);
  const unmappedMine = await request("/api/callback-schedules?due=today&owner=mine", admin);
  assert.equal(unmappedMine.response.status, 200);
  assert.deepEqual(unmappedMine.json.items, []);
  const adminDue = await request("/api/callback-schedules?due=today", admin);
  assert.equal(ids(adminDue.json.items).includes("c1"), true);
  assert.equal(ids(adminDue.json.items).includes("c3"), true);

  const auditText = JSON.stringify(store.outboundOwnerAudits);
  assert.equal(auditText.includes("13800000000"), false);
  assert.equal(auditText.includes("+49"), false);
  assert.equal(auditText.includes("do-not-leak-owner"), false);
  assert.equal(auditText.includes("aliyuncs"), false);
  assert.equal(aliyunHits, 0);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.deepEqual(store.outboundCallRecords.map((item) => JSON.stringify(item)), recordsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  assert.equal(store.customers.find((item) => item.id === "c1")?.nextReminder, followBefore);

  console.log("outbound owner http tests passed");
} finally {
  const store = getStore();
  const extraCustomers = new Set(["c_own_a", "c_own_b", "c_own_orphan", "c_own_asia"]);
  store.customers = store.customers.filter((item) => !extraCustomers.has(item.id));
  store.leads = store.leads.filter((item) => item.id !== "l_own_deleted");
  store.users = store.users.filter((item) => item.id !== "u_owner_asia_admin");
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_own_"));
  store.outboundOwners = store.outboundOwners.filter((item) => !["c1", "c3", "l1", "web_seed_1", "c_own_a", "c_own_b", "c_own_orphan", "c_own_asia"].includes(item.targetId));
  store.outboundOwnerAudits = [];
  store.callbackSchedules = store.callbackSchedules.filter((item) => !item.id.startsWith("cbs_own_"));
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_own_"));
  globalThis.fetch = originalFetch;
  server.close();
}
