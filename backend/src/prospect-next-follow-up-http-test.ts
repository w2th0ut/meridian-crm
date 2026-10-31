import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { PROSPECT_NEXT_FOLLOW_UP_CLOCK } from "./prospect-next-follow-up.js";
import type { Lead, WebsiteOpportunity } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start next follow up test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

async function request(path: string, token: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
  const json = await response.json().catch(() => ({})) as Record<string, any>;
  return { response, json };
}

async function login(email: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "keduoduo123" })
  });
  const json = await response.json() as { token?: string };
  assert.equal(response.status, 200, `登录失败：${email}`);
  return String(json.token);
}

function isIso(value: unknown) {
  return typeof value === "string" && value.includes("T") && !Number.isNaN(Date.parse(value));
}

function localIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDays(days: number) {
  const now = new Date();
  return localIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
}

function cloneCandidate(source: WebsiteOpportunity, id: string, ownerId: string, teamId: string): WebsiteOpportunity {
  return {
    ...structuredClone(source),
    id,
    company: id,
    ownerId,
    teamId,
    status: "preview",
    leadId: "",
    tags: ["原标签"],
    nextFollowAt: "",
    statusChangedAt: "2026-06-01T00:00:00.000Z"
  };
}

try {
  const store = getStore();
  const alex = await login("alex@keduoduo.com");
  const shirley = await login("shirley@keduoduo.com");
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const alexUser = store.users.find((item) => item.email === "alex@keduoduo.com");
  assert.ok(shirleyUser && miaUser && alexUser);
  const seed = store.websiteOpportunities.find((item) => item.id === "web_seed_1");
  const seedLead = store.leads[0];
  assert.ok(seed && seedLead);

  const ownedA = cloneCandidate(seed, "web_nfu_a", shirleyUser.id, "europe");
  const ownedB = cloneCandidate(seed, "web_nfu_b", shirleyUser.id, "europe");
  const miaOwned = cloneCandidate(seed, "web_nfu_mia", miaUser.id, "europe");
  const foreign = cloneCandidate(seed, "web_nfu_foreign", "u_foreign_nfu", "middle-east");
  ownedA.nextFollowAt = "2026-01-01 08:00";
  ownedB.status = "synced";
  ownedB.leadId = "lead_nfu_b";
  const linkedLead: Lead = {
    ...structuredClone(seedLead),
    id: "lead_nfu_b",
    company: "web_nfu_b",
    ownerId: shirleyUser.id,
    teamId: "europe",
    nextFollowAt: "旧时间",
    status: "new",
    deletedAt: undefined
  };
  store.websiteOpportunities.push(ownedA, ownedB, miaOwned, foreign);
  store.leads.push(linkedLead);
  store.users.push({
    ...shirleyUser,
    id: "u_foreign_nfu",
    name: "Foreign",
    email: "foreign-nfu-owner@example.com",
    teamId: "middle-east",
    status: "active"
  });

  const today = shiftDays(0);
  const yesterday = shiftDays(-1);
  const tooOld = shiftDays(-2);
  const storedToday = `${today} ${PROSPECT_NEXT_FOLLOW_UP_CLOCK}`;
  const storedYesterday = `${yesterday} ${PROSPECT_NEXT_FOLLOW_UP_CLOCK}`;

  const emailsBefore = store.outboundEmailLogs.length;
  const suppressBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const sequencesBefore = store.outreachSequences.length;
  const batchesBefore = store.prospectOutreachBatches.length;
  const messagesBefore = store.internalMessages.length;
  const leadsBefore = store.leads.length;
  const activitiesBefore = store.leadActivities.length;
  const todosBefore = store.todos.length;
  const remindersBefore = store.reminders.length;
  const auditsBefore = store.nextFollowUpAudits.length;

  const empty = await request("/api/prospect-list/next-follow-up", alex, { ids: [], action: "set", date: today });
  assert.equal(empty.response.status, 400);
  assert.match(String(empty.json.message || ""), /参数格式错误/);

  const overLimit = await request("/api/prospect-list/next-follow-up", alex, {
    ids: Array.from({ length: 101 }, (_, index) => `web_over_${index}`),
    action: "set",
    date: today
  });
  assert.equal(overLimit.response.status, 400);
  assert.equal(store.nextFollowUpAudits.length, auditsBefore);
  assert.equal(ownedA.nextFollowAt, "2026-01-01 08:00");

  const missingDate = await request("/api/prospect-list/next-follow-up", alex, { ids: [ownedA.id], action: "set" });
  assert.equal(missingDate.response.status, 400);
  assert.match(String(missingDate.json.message || ""), /请填写下次跟进日期/);
  assert.equal(store.nextFollowUpAudits.length, auditsBefore);

  const badDate = await request("/api/prospect-list/next-follow-up", alex, {
    ids: [ownedA.id],
    action: "set",
    date: "2026-02-31"
  });
  assert.equal(badDate.response.status, 400);
  assert.match(String(badDate.json.message || ""), /下次跟进日期不正确/);
  assert.equal(ownedA.nextFollowAt, "2026-01-01 08:00");

  const withTime = await request("/api/prospect-list/next-follow-up", alex, {
    ids: [ownedA.id],
    action: "set",
    date: `${today} 09:00`
  });
  assert.equal(withTime.response.status, 400);
  assert.match(String(withTime.json.message || ""), /下次跟进日期不正确/);

  const tooEarly = await request("/api/prospect-list/next-follow-up", alex, {
    ids: [ownedA.id],
    action: "set",
    date: tooOld
  });
  assert.equal(tooEarly.response.status, 400);
  assert.match(String(tooEarly.json.message || ""), /不能早于昨天/);
  assert.equal(ownedA.nextFollowAt, "2026-01-01 08:00");
  assert.equal(store.nextFollowUpAudits.length, auditsBefore);

  const badAction = await request("/api/prospect-list/next-follow-up", alex, {
    ids: [ownedA.id],
    action: "replace",
    date: today
  });
  assert.equal(badAction.response.status, 400);
  assert.match(String(badAction.json.message || ""), /参数格式错误/);

  const salesDenied = await request("/api/prospect-list/next-follow-up", shirley, {
    ids: [miaOwned.id, foreign.id],
    action: "set",
    date: today
  });
  assert.equal(salesDenied.response.status, 403);
  assert.equal(salesDenied.json.results?.length, 2);
  assert.equal(salesDenied.json.results.every((item: { ok: boolean; reason?: string }) =>
    !item.ok && item.reason === "无权修改该候选的下次跟进"
  ), true);
  assert.equal(miaOwned.nextFollowAt, "");
  assert.equal(foreign.nextFollowAt, "");
  assert.equal(store.nextFollowUpAudits.length, auditsBefore);

  const managerDenied = await request("/api/prospect-list/next-follow-up", alex, {
    ids: [foreign.id],
    action: "set",
    date: today
  });
  assert.equal(managerDenied.response.status, 403);
  assert.equal(managerDenied.json.results?.[0]?.ok, false);
  assert.equal(foreign.nextFollowAt, "");
  assert.equal(store.nextFollowUpAudits.some((item) => item.objectId === foreign.id), false);

  const statusBefore = ownedB.status;
  const statusChangedBefore = ownedB.statusChangedAt;
  const leadBefore = ownedB.leadId;
  const ownerBefore = ownedA.ownerId;
  const tagsBefore = [...(ownedA.tags || [])];
  const leadStatusBefore = linkedLead.status;
  const partial = await request("/api/prospect-list/next-follow-up", alex, {
    ids: [ownedA.id, ownedA.id, foreign.id],
    action: "set",
    date: ` ${yesterday} `
  });
  assert.equal(partial.response.status, 200, partial.json.message);
  assert.equal(partial.json.results?.length, 2);
  const partialOk = partial.json.results?.find((item: { id: string }) => item.id === ownedA.id);
  const partialDenied = partial.json.results?.find((item: { id: string }) => item.id === foreign.id);
  assert.equal(partialOk?.ok, true);
  assert.equal(partialOk?.nextFollowAt, storedYesterday);
  assert.equal(partialDenied?.ok, false);
  assert.equal(partialDenied?.reason, "无权修改该候选的下次跟进");
  assert.equal(ownedA.nextFollowAt, storedYesterday);
  assert.equal(foreign.nextFollowAt, "");
  assert.equal(foreign.teamId, "middle-east");
  const partialAudit = store.nextFollowUpAudits.find((item) => item.objectId === ownedA.id);
  assert.ok(partialAudit);
  assert.equal(partialAudit.actorId, alexUser.id);
  assert.equal(partialAudit.action, "set_next_follow_up");
  assert.equal(partialAudit.oldValue, "2026-01-01 08:00");
  assert.equal(partialAudit.newValue, storedYesterday);
  assert.equal(store.nextFollowUpAudits.filter((item) => item.objectId === ownedA.id).length, 1);
  assert.equal(store.nextFollowUpAudits.some((item) => item.objectId === foreign.id), false);
  assert.deepEqual(ownedA.tags, tagsBefore);
  assert.equal(ownedA.ownerId, ownerBefore);

  const auditsAfterPartial = store.nextFollowUpAudits.length;
  const repeat = await request("/api/prospect-list/next-follow-up", alex, {
    ids: [ownedA.id],
    action: "set",
    date: yesterday
  });
  assert.equal(repeat.response.status, 200);
  assert.equal(repeat.json.results?.[0]?.ok, true);
  assert.equal(repeat.json.results?.[0]?.nextFollowAt, storedYesterday);
  assert.equal(store.nextFollowUpAudits.length, auditsAfterPartial);

  const salesOwn = await request("/api/prospect-list/next-follow-up", shirley, {
    ids: [ownedB.id, miaOwned.id],
    action: "set",
    date: today
  });
  assert.equal(salesOwn.response.status, 200, salesOwn.json.message);
  const ownOk = salesOwn.json.results?.find((item: { id: string }) => item.id === ownedB.id);
  const ownDenied = salesOwn.json.results?.find((item: { id: string }) => item.id === miaOwned.id);
  assert.equal(ownOk?.ok, true);
  assert.equal(ownedB.nextFollowAt, storedToday);
  assert.equal(linkedLead.nextFollowAt, storedToday);
  assert.equal(ownDenied?.ok, false);
  assert.equal(miaOwned.nextFollowAt, "");
  assert.equal(ownedB.status, statusBefore);
  assert.equal(ownedB.statusChangedAt, statusChangedBefore);
  assert.equal(ownedB.leadId, leadBefore);
  assert.equal(ownedB.ownerId, shirleyUser.id);
  assert.equal(linkedLead.status, leadStatusBefore);
  assert.equal(ownedA.teamId, "europe");
  const auditB = store.nextFollowUpAudits.find((item) => item.objectId === ownedB.id);
  assert.ok(auditB, "成功设置下次跟进后必须有审计");
  assert.equal(auditB.actorId, shirleyUser.id);
  assert.equal(auditB.objectType, "prospect_candidate");
  assert.equal(auditB.action, "set_next_follow_up");
  assert.equal(auditB.oldValue, "");
  assert.equal(auditB.newValue, storedToday);
  assert.equal(isIso(auditB.at), true);

  const cleared = await request("/api/prospect-list/next-follow-up", alex, {
    ids: [ownedA.id],
    action: "clear"
  });
  assert.equal(cleared.response.status, 200, cleared.json.message);
  assert.equal(ownedA.nextFollowAt, "");
  assert.equal(cleared.json.results?.[0]?.nextFollowAt, "");
  const clearAudit = store.nextFollowUpAudits.find((item) => item.objectId === ownedA.id && item.action === "clear_next_follow_up");
  assert.ok(clearAudit);
  assert.equal(clearAudit.actorId, alexUser.id);
  assert.equal(clearAudit.oldValue, storedYesterday);
  assert.equal(clearAudit.newValue, "");

  const clearAgain = await request("/api/prospect-list/next-follow-up", alex, {
    ids: [ownedA.id],
    action: "clear"
  });
  assert.equal(clearAgain.response.status, 200);
  assert.equal(clearAgain.json.results?.[0]?.ok, true);
  assert.equal(store.nextFollowUpAudits.filter((item) => item.objectId === ownedA.id && item.action === "clear_next_follow_up").length, 1);

  assert.equal(store.outboundEmailLogs.length, emailsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outreachSequences.length, sequencesBefore);
  assert.equal(store.prospectOutreachBatches.length, batchesBefore);
  assert.equal(store.internalMessages.length, messagesBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.leadActivities.length, activitiesBefore);
  assert.equal(store.todos.length, todosBefore);
  assert.equal(store.reminders.length, remindersBefore);
  assert.equal(ownedB.status, "synced");
  assert.equal(linkedLead.nextFollowAt, storedToday);

  console.log("prospect next follow up http tests passed");
} finally {
  server.close();
}
