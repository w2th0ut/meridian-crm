import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import type { WebsiteOpportunity } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start owner reassign test server");
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

function cloneCandidate(source: WebsiteOpportunity, id: string, ownerId: string, teamId: string): WebsiteOpportunity {
  return {
    ...structuredClone(source),
    id,
    company: id,
    ownerId,
    teamId,
    status: "preview",
    leadId: "",
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
  assert.ok(seed);

  const ownedA = cloneCandidate(seed, "web_reassign_a", shirleyUser.id, "europe");
  const ownedB = cloneCandidate(seed, "web_reassign_b", shirleyUser.id, "europe");
  const foreign = cloneCandidate(seed, "web_reassign_foreign", "u_foreign_sales", "middle-east");
  store.websiteOpportunities.push(ownedA, ownedB, foreign);
  store.users.push({
    ...shirleyUser,
    id: "u_foreign_sales",
    name: "Foreign",
    email: "foreign-owner@example.com",
    teamId: "middle-east",
    status: "active"
  });
  store.users.push({
    ...shirleyUser,
    id: "u_disabled_owner",
    name: "Disabled",
    email: "disabled-owner@example.com",
    teamId: "europe",
    status: "disabled"
  });

  const emailsBefore = store.outboundEmailLogs.length;
  const suppressBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const sequencesBefore = store.outreachSequences.length;
  const batchesBefore = store.prospectOutreachBatches.length;
  const messagesBefore = store.internalMessages.length;
  const auditsBefore = store.ownerReassignAudits.length;

  const empty = await request("/api/prospect-list/reassign-owners", alex, { ids: [], ownerId: miaUser.id });
  assert.equal(empty.response.status, 400);
  assert.match(String(empty.json.message || ""), /参数格式错误/);

  const overLimit = await request("/api/prospect-list/reassign-owners", alex, {
    ids: Array.from({ length: 101 }, (_, index) => `web_over_${index}`),
    ownerId: miaUser.id
  });
  assert.equal(overLimit.response.status, 400);
  assert.equal(store.ownerReassignAudits.length, auditsBefore);
  assert.equal(ownedA.ownerId, shirleyUser.id);

  const crossTenant = await request("/api/prospect-list/reassign-owners", alex, {
    ids: [ownedA.id],
    ownerId: "u_foreign_sales"
  });
  assert.equal(crossTenant.response.status, 400, crossTenant.json.message);
  assert.match(String(crossTenant.json.message || ""), /不在当前租户/);
  assert.equal(ownedA.ownerId, shirleyUser.id);
  assert.equal(store.ownerReassignAudits.length, auditsBefore);

  const disabled = await request("/api/prospect-list/reassign-owners", alex, {
    ids: [ownedA.id],
    ownerId: "u_disabled_owner"
  });
  assert.equal(disabled.response.status, 400);
  assert.equal(ownedA.ownerId, shirleyUser.id);

  const salesDenied = await request("/api/prospect-list/reassign-owners", shirley, {
    ids: [ownedA.id, ownedB.id],
    ownerId: miaUser.id
  });
  assert.equal(salesDenied.response.status, 403);
  assert.equal(salesDenied.json.results?.length, 2);
  assert.equal(salesDenied.json.results.every((item: { ok: boolean; reason?: string }) =>
    !item.ok && item.reason === "无权修改该候选的负责人"
  ), true);
  assert.equal(ownedA.ownerId, shirleyUser.id);
  assert.equal(ownedB.ownerId, shirleyUser.id);
  assert.equal(store.ownerReassignAudits.length, auditsBefore);

  const managerDenied = await request("/api/prospect-list/reassign-owners", alex, {
    ids: [foreign.id],
    ownerId: miaUser.id
  });
  assert.equal(managerDenied.response.status, 403);
  assert.equal(managerDenied.json.results?.[0]?.ok, false);
  assert.equal(foreign.ownerId, "u_foreign_sales");
  assert.equal(store.ownerReassignAudits.some((item) => item.objectId === foreign.id), false);

  const partial = await request("/api/prospect-list/reassign-owners", alex, {
    ids: [ownedA.id, foreign.id],
    ownerId: miaUser.id
  });
  assert.equal(partial.response.status, 200, partial.json.message);
  const partialOk = partial.json.results?.find((item: { id: string }) => item.id === ownedA.id);
  const partialDenied = partial.json.results?.find((item: { id: string }) => item.id === foreign.id);
  assert.equal(partialOk?.ok, true);
  assert.equal(partialOk?.previousOwnerId, shirleyUser.id);
  assert.equal(partialOk?.ownerId, miaUser.id);
  assert.equal(partialDenied?.ok, false);
  assert.equal(partialDenied?.reason, "无权修改该候选的负责人");
  assert.equal(ownedA.ownerId, miaUser.id);
  assert.equal(foreign.ownerId, "u_foreign_sales");
  assert.equal(foreign.teamId, "middle-east");
  const partialAudit = store.ownerReassignAudits.find((item) => item.objectId === ownedA.id);
  assert.ok(partialAudit);
  assert.equal(partialAudit.actorId, alexUser.id);
  assert.equal(partialAudit.action, "reassign_owner");
  assert.equal(partialAudit.previousOwnerId, shirleyUser.id);
  assert.equal(partialAudit.nextOwnerId, miaUser.id);
  assert.equal(store.ownerReassignAudits.some((item) => item.objectId === foreign.id), false);

  const statusBefore = ownedB.status;
  const statusChangedBefore = ownedB.statusChangedAt;
  const saved = await request("/api/prospect-list/reassign-owners", alex, {
    ids: [ownedA.id, ownedB.id],
    ownerId: alexUser.id
  });
  assert.equal(saved.response.status, 200, saved.json.message);
  assert.equal(saved.json.results?.every((item: { ok: boolean }) => item.ok), true);
  assert.equal(ownedA.ownerId, alexUser.id);
  assert.equal(ownedB.ownerId, alexUser.id);
  assert.equal(ownedB.status, statusBefore);
  assert.equal(ownedB.statusChangedAt, statusChangedBefore);
  assert.equal(ownedA.teamId, "europe");
  assert.equal(ownedB.teamId, "europe");
  const auditB = store.ownerReassignAudits.find((item) => item.objectId === ownedB.id && item.nextOwnerId === alexUser.id);
  assert.ok(auditB, "成功改负责人后必须有审计");
  assert.equal(auditB.actorId, alexUser.id);
  assert.equal(auditB.objectType, "prospect_candidate");
  assert.equal(auditB.action, "reassign_owner");
  assert.equal(auditB.previousOwnerId, shirleyUser.id);
  assert.equal(auditB.nextOwnerId, alexUser.id);
  assert.equal(isIso(auditB.at), true);
  const secondA = store.ownerReassignAudits.find((item) =>
    item.objectId === ownedA.id && item.previousOwnerId === miaUser.id && item.nextOwnerId === alexUser.id
  );
  assert.ok(secondA);

  assert.equal(store.outboundEmailLogs.length, emailsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outreachSequences.length, sequencesBefore);
  assert.equal(store.prospectOutreachBatches.length, batchesBefore);
  assert.equal(store.internalMessages.length, messagesBefore);

  console.log("prospect owner reassign http tests passed");
} finally {
  server.close();
}
