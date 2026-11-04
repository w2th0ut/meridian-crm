import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { outboundInstant, setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { AliyunAgentMapping, CallbackSchedule, OutboundOwner } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start callback due queue test server");
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
  const type = response.headers.get("content-type") || "";
  if (type.includes("text/csv")) {
    const bytes = Buffer.from(await response.arrayBuffer());
    return { response, text: bytes.toString("utf8"), json: {} as Record<string, any> };
  }
  const text = await response.text();
  const json = type.includes("json") && text ? JSON.parse(text) as Record<string, any> : {};
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

function schedule(partial: Partial<CallbackSchedule> & Pick<CallbackSchedule, "id" | "targetType" | "targetId" | "scheduledAt">): CallbackSchedule {
  return {
    teamId: "europe",
    note: "",
    updatedBy: "u_sales_shirley",
    updatedAt: "2026-11-04T00:00:00.000Z",
    sourceCallRecordId: "",
    ...partial
  };
}

try {
  const store = getStore();
  const instant = new Date("2026-11-04T02:30:00.000Z");
  setOutboundNowForTests(instant);
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  assert.ok(shirleyUser);
  const mapping = (partial: Partial<AliyunAgentMapping> & Pick<AliyunAgentMapping, "crmUserId" | "cccUserId">): AliyunAgentMapping => ({
    id: `map_${partial.cccUserId}`,
    teamId: "europe",
    loginName: "",
    displayName: partial.displayName || "",
    extension: "",
    workMode: "",
    updatedBy: "",
    updatedAt: "",
    ...partial
  });
  const owner = (partial: Partial<OutboundOwner> & Pick<OutboundOwner, "targetType" | "targetId" | "agentId">): OutboundOwner => ({
    id: `own_${partial.targetType}_${partial.targetId}`,
    teamId: "europe",
    updatedBy: "",
    updatedAt: "",
    ...partial
  });
  store.aliyunAgentMappings.push(
    mapping({ crmUserId: shirleyUser.id, cccUserId: "agent@ccc-due-a", displayName: "Shirley坐席" }),
    mapping({ crmUserId: "u_sales_mia", cccUserId: "agent@ccc-due-b", displayName: "Mia坐席" })
  );
  store.outboundOwners.push(
    owner({ targetType: "customer", targetId: "c1", agentId: "agent@ccc-due-a" }),
    owner({ targetType: "lead", targetId: "l2", agentId: "agent@ccc-due-a" }),
    owner({ targetType: "prospect", targetId: "web_seed_1", agentId: "agent@ccc-due-a" })
  );
  store.callbackSchedules.push(
    schedule({ id: "cbs_due_c1", targetType: "customer", targetId: "c1", scheduledAt: "2026-11-03 10:00", note: "=改期" }),
    schedule({ id: "cbs_due_c5", targetType: "customer", targetId: "c5", scheduledAt: "2026-11-04 10:00", note: "未指派今日" }),
    schedule({ id: "cbs_due_l2", targetType: "lead", targetId: "l2", scheduledAt: "2026-11-04 18:00", note: "稍后" }),
    schedule({ id: "cbs_due_l1", targetType: "lead", targetId: "l1", scheduledAt: "2026-11-05 09:00", note: "未到" }),
    schedule({ id: "cbs_due_web", targetType: "prospect", targetId: "web_seed_1", scheduledAt: "2026-11-02 09:00", note: "搜客" }),
    schedule({ id: "cbs_due_asia", teamId: "asia", targetType: "customer", targetId: "c_asia", scheduledAt: "2026-11-03 10:00", note: "别的租户" })
  );
  const customer = store.customers.find((item) => item.id === "c1");
  const pooled = store.customers.find((item) => item.id === "c2");
  const lead = store.leads.find((item) => item.id === "l1");
  assert.ok(customer && pooled && lead);
  const reminderBefore = customer.nextReminder;
  const leadFollowBefore = lead.nextFollowAt;
  const leadsBefore = store.leads.length;
  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions);
  const mine = await request("/api/callback-due-queue?scope=mine", shirley);
  assert.equal(mine.response.status, 200);
  assert.equal(mine.json.today, "2026-11-04");
  assert.equal(mine.json.timeZone, "Asia/Shanghai");
  const mineIds = mine.json.items.map((item: { targetId: string }) => item.targetId);
  assert.deepEqual(mineIds, ["web_seed_1", "c1", "l2"]);
  const overdueRow = mine.json.items.find((item: { targetId: string }) => item.targetId === "c1");
  assert.equal(overdueRow.due, "overdue");
  assert.equal(overdueRow.name, "Nordic Tools AB");
  assert.equal(overdueRow.targetLabel, "客户");
  assert.equal(overdueRow.note, "=改期");
  assert.equal(overdueRow.ownerAgentLabel, "Shirley坐席");
  assert.equal(overdueRow.ageLabel, "1天");
  const laterToday = mine.json.items.find((item: { targetId: string }) => item.targetId === "l2");
  assert.equal(laterToday.due, "today");
  assert.equal(laterToday.ageLabel, "0秒");
  assert.equal(mine.json.items.some((item: { targetId: string }) => item.targetId === "c5" || item.targetId === "l1" || item.targetId === "c_asia"), false);
  assert.equal(JSON.stringify(mine.json).includes("+33"), false);
  assert.equal(JSON.stringify(mine.json).includes("sales@supplier.example"), false);
  assert.equal(JSON.stringify(mine.json).includes("overdueRate"), false);
  assert.equal(store.callbackDueQueueAudits.filter((item) => item.actorId === shirleyUser.id && item.action === "read" && item.result === "read").length, 1);

  const overdueOnly = await request("/api/callback-due-queue?scope=mine&overdue=1", shirley);
  assert.equal(overdueOnly.response.status, 200);
  assert.deepEqual(overdueOnly.json.items.map((item: { targetId: string }) => item.targetId), ["web_seed_1", "c1"]);
  assert.equal(store.callbackDueQueueAudits.filter((item) => item.action === "read" && item.scope === "mine" && item.overdueOnly).length, 1);

  const miaMine = await request("/api/callback-due-queue?scope=mine", mia);
  assert.equal(miaMine.response.status, 200);
  assert.equal(miaMine.json.empty, true);
  assert.equal(miaMine.json.items.length, 0);
  assert.equal(JSON.stringify(miaMine.json).includes(">0<"), false);

  const miaTeam = await request("/api/callback-due-queue?scope=team", mia);
  assert.equal(miaTeam.response.status, 403);
  assert.equal(miaTeam.json.reason, "forbidden");
  assert.equal(miaTeam.json.items, undefined);
  assert.equal(store.callbackDueQueueAudits.some((item) => item.action === "read" && item.scope === "team" && item.result === "rejected"), true);

  const team = await request("/api/callback-due-queue?scope=team", alex);
  assert.equal(team.response.status, 200);
  const teamIds = team.json.items.map((item: { targetId: string }) => item.targetId);
  assert.equal(teamIds.includes("c5"), true);
  assert.equal(teamIds.includes("c1"), true);
  assert.equal(teamIds[0], "web_seed_1");
  const unassigned = team.json.items.find((item: { targetId: string }) => item.targetId === "c5");
  assert.equal(unassigned.ownerAgentId, "");
  assert.equal(unassigned.ageLabel, "30分钟");
  assert.equal(teamIds.includes("l1"), false);
  assert.equal(teamIds.includes("c_asia"), false);

  setTenantTimezoneOverride(store, "europe", "America/New_York");
  const ny = await request("/api/callback-due-queue?scope=team", alex);
  assert.equal(ny.json.today, "2026-11-03");
  const nyIds = ny.json.items.map((item: { targetId: string; due: string }) => `${item.targetId}:${item.due}`);
  assert.equal(nyIds.includes("c1:today"), true);
  assert.equal(nyIds.includes("web_seed_1:overdue"), true);
  assert.equal(nyIds.includes("c5:today"), false);
  assert.equal(nyIds.includes("l2:today"), false);
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");

  const bad = await request("/api/callback-due-queue?scope=all", shirley);
  assert.equal(bad.response.status, 400);
  const auditsAfterBad = store.callbackDueQueueAudits.length;
  const extra = await request("/api/callback-due-queue?scope=mine&owner=mine", shirley);
  assert.equal(extra.response.status, 400);
  assert.equal(store.callbackDueQueueAudits.length, auditsAfterBad);
  const anon = await request("/api/callback-due-queue?scope=mine", "");
  assert.equal(anon.response.status, 401);
  assert.equal(store.callbackDueQueueAudits.length, auditsAfterBad);

  const exported = await request("/api/callback-due-queue/export?scope=mine&overdue=1", shirley);
  assert.equal(exported.response.status, 200);
  assert.match(exported.response.headers.get("content-type") || "", /text\/csv/);
  assert.equal(exported.text.charCodeAt(0), 0xfeff);
  assert.match(exported.text, /'=改期/);
  assert.equal(exported.text.includes("+33"), false);
  assert.equal(exported.text.includes("sales@supplier.example"), false);
  assert.equal(exported.text.includes("未到"), false);
  const exportAudit = store.callbackDueQueueAudits.find((item) => item.action === "export" && item.result === "exported");
  assert.ok(exportAudit);
  assert.equal(exportAudit.rowCount, 2);
  assert.equal(exportAudit.reason, "");
  const miaExport = await request("/api/callback-due-queue/export?scope=team", mia);
  assert.equal(miaExport.response.status, 403);
  assert.equal(miaExport.text.includes("对象类型"), false);

  const denied = await request("/api/callback-due-queue/complete", mia, "POST", {
    targetType: "customer",
    targetId: "c1",
    reason: "reached"
  });
  assert.equal(denied.response.status, 403);
  assert.equal(store.callbackSchedules.some((item) => item.id === "cbs_due_c1"), true);
  assert.equal(store.callbackScheduleAudits.some((item) => item.targetId === "c1" && item.result === "rejected"), true);

  const pooledBefore = pooled.poolStatus;
  pooled.poolStatus = "public";
  store.callbackSchedules.push(schedule({ id: "cbs_due_pool", targetType: "customer", targetId: "c2", scheduledAt: "2026-11-03 09:00", note: "公池" }));
  const poolDenied = await request("/api/callback-due-queue/complete", shirley, "POST", {
    targetType: "customer",
    targetId: "c2",
    reason: "other"
  });
  assert.equal(poolDenied.response.status, 409);
  assert.equal(poolDenied.json.reason, "public_pool");
  assert.equal(store.callbackSchedules.some((item) => item.id === "cbs_due_pool"), true);
  pooled.poolStatus = pooledBefore;

  const notDue = await request("/api/callback-due-queue/complete", shirley, "POST", {
    targetType: "lead",
    targetId: "l1",
    reason: "no_need"
  });
  assert.equal(notDue.response.status, 400);
  assert.equal(notDue.json.reason, "not_due");
  assert.equal(store.callbackSchedules.find((item) => item.id === "cbs_due_l1")?.scheduledAt, "2026-11-05 09:00");
  assert.equal(store.callbackScheduleAudits.some((item) => item.targetId === "l1" && item.action === "cancel" && item.result === "updated"), false);

  const invalid = await request("/api/callback-due-queue/complete", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    reason: "reached",
    ids: ["c1"]
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(store.callbackSchedules.some((item) => item.id === "cbs_due_c1"), true);

  const done = await request("/api/callback-due-queue/complete", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    reason: "reached"
  });
  assert.equal(done.response.status, 200);
  assert.equal(done.json.action, "cancel");
  assert.equal(store.callbackSchedules.some((item) => item.id === "cbs_due_c1"), false);
  const doneAudit = store.callbackScheduleAudits.find((item) => item.targetId === "c1" && item.action === "cancel" && item.result === "updated");
  assert.ok(doneAudit);
  assert.equal(doneAudit.reason, "reached");
  assert.equal(doneAudit.previousNote, "=改期");
  assert.equal(doneAudit.nextScheduledAt, "");
  const doneAgain = await request("/api/callback-due-queue/complete", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    reason: "reached"
  });
  assert.equal(doneAgain.response.status, 400);
  assert.equal(doneAgain.json.reason, "not_due");
  assert.equal(store.callbackScheduleAudits.filter((item) => item.targetId === "c1" && item.action === "cancel" && item.result === "updated").length, 1);
  assert.equal(store.callbackDueQueueAudits.some((item) => item.action !== "read" && item.action !== "export"), false);

  const plainCancel = await request("/api/callback-schedules/cancel", shirley, "POST", {
    targetType: "prospect",
    targetId: "web_seed_1"
  });
  assert.equal(plainCancel.response.status, 200);
  assert.equal(store.callbackScheduleAudits.find((item) => item.targetId === "web_seed_1" && item.action === "cancel" && item.result === "updated")?.reason, "");

  const moved = await request("/api/callback-schedules", shirley, "POST", {
    targetType: "customer",
    targetId: "c5",
    scheduledAt: "2026-11-06 09:00",
    note: "改到以后"
  });
  assert.equal(moved.response.status, 200);
  assert.equal(moved.json.action, "update");
  const afterMove = await request("/api/callback-due-queue?scope=team", alex);
  assert.equal(afterMove.json.items.some((item: { targetId: string }) => item.targetId === "c5"), false);

  const renamed = await request("/api/callback-schedules", shirley, "POST", {
    targetType: "lead",
    targetId: "l2",
    scheduledAt: "2026-11-04 18:00",
    note: "改过"
  });
  assert.equal(renamed.response.status, 200);
  const afterRename = await request("/api/callback-due-queue?scope=mine", shirley);
  const renamedRow = afterRename.json.items.find((item: { targetId: string }) => item.targetId === "l2");
  assert.equal(renamedRow.note, "改过");
  assert.equal(renamedRow.scheduledAt, "2026-11-04 18:00");

  assert.equal(customer.nextReminder, reminderBefore);
  assert.equal(lead.nextFollowAt, leadFollowBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), false);
  assert.equal(aliyunHits, 0);
  assert.equal(JSON.stringify(store.callbackDueQueueAudits).includes("AccessKey"), false);
  assert.equal(JSON.stringify(store.callbackDueQueueAudits).includes("=改期"), false);
  assert.equal(store.callbackSchedules.some((item) => item.id === "cbs_due_c1"), false);
  assert.equal(outboundInstant().toISOString(), instant.toISOString());
  console.log("callback due queue http tests passed");
} finally {
  setOutboundNowForTests(undefined);
  const store = getStore();
  setTenantTimezoneOverride(store, "europe", undefined);
  globalThis.fetch = originalFetch;
  server.close();
}
