import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import type { WebsiteOpportunity } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start prospect priority test server");
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
    tags: ["原标签"],
    notes: "原备注",
    nextFollowAt: "2026-11-02 23:59",
    priority: null,
    description: "核验描述保持不变",
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

  const ownedA = cloneCandidate(seed, "web_pri_a", shirleyUser.id, "europe");
  const ownedB = cloneCandidate(seed, "web_pri_b", shirleyUser.id, "europe");
  const miaOwned = cloneCandidate(seed, "web_pri_mia", miaUser.id, "europe");
  const foreign = cloneCandidate(seed, "web_pri_foreign", "u_foreign_pri", "middle-east");
  ownedA.priority = "low";
  ownedB.status = "synced";
  ownedB.leadId = "lead_pri_b";
  ownedB.description = "已入线索的描述";
  store.websiteOpportunities.push(ownedA, ownedB, miaOwned, foreign);
  store.users.push({
    ...shirleyUser,
    id: "u_foreign_pri",
    name: "Foreign",
    email: "foreign-pri-owner@example.com",
    teamId: "middle-east",
    status: "active"
  });

  const emailsBefore = store.outboundEmailLogs.length;
  const suppressBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const sequencesBefore = store.outreachSequences.length;
  const batchesBefore = store.prospectOutreachBatches.length;
  const messagesBefore = store.internalMessages.length;
  const leadsBefore = store.leads.length;
  const activitiesBefore = store.leadActivities.length;
  const auditsBefore = store.prospectPriorityAudits.length;
  const notesBefore = store.prospectNoteAudits.length;
  const descriptionBefore = ownedA.description;
  const tagsBefore = [...(ownedA.tags || [])];
  const notesTextBefore = ownedA.notes;
  const followBefore = ownedA.nextFollowAt;
  const ownerBefore = ownedA.ownerId;

  const empty = await request("/api/prospect-list/priority", alex, { ids: [], action: "set", priority: "high" });
  assert.equal(empty.response.status, 400);
  assert.match(String(empty.json.message || ""), /参数格式错误/);

  const overLimit = await request("/api/prospect-list/priority", alex, {
    ids: Array.from({ length: 101 }, (_, index) => `web_pri_over_${index}`),
    action: "set",
    priority: "high"
  });
  assert.equal(overLimit.response.status, 400);
  assert.equal(store.prospectPriorityAudits.length, auditsBefore);
  assert.equal(ownedA.priority, "low");

  const missing = await request("/api/prospect-list/priority", alex, { ids: [ownedA.id], action: "set" });
  assert.equal(missing.response.status, 400);
  assert.match(String(missing.json.message || ""), /请填写优先级/);
  assert.equal(store.prospectPriorityAudits.length, auditsBefore);
  assert.equal(ownedA.priority, "low");

  const blank = await request("/api/prospect-list/priority", alex, { ids: [ownedA.id], action: "set", priority: "  " });
  assert.equal(blank.response.status, 400);
  assert.match(String(blank.json.message || ""), /请填写优先级/);
  assert.equal(ownedA.priority, "low");

  for (const priority of ["medium", "HIGH", "urgent", "高"]) {
    const invalid = await request("/api/prospect-list/priority", alex, {
      ids: [ownedA.id],
      action: "set",
      priority
    });
    assert.equal(invalid.response.status, 400, priority);
    assert.match(String(invalid.json.message || ""), /优先级不正确/);
  }
  assert.equal(ownedA.priority, "low");
  assert.equal(store.prospectPriorityAudits.length, auditsBefore);

  const badAction = await request("/api/prospect-list/priority", alex, {
    ids: [ownedA.id],
    action: "replace",
    priority: "high"
  });
  assert.equal(badAction.response.status, 400);
  assert.match(String(badAction.json.message || ""), /参数格式错误/);

  const salesDenied = await request("/api/prospect-list/priority", shirley, {
    ids: [miaOwned.id, foreign.id],
    action: "set",
    priority: "high"
  });
  assert.equal(salesDenied.response.status, 403);
  assert.equal(salesDenied.json.results?.length, 2);
  assert.equal(salesDenied.json.results.every((item: { ok: boolean; reason?: string }) =>
    !item.ok && item.reason === "无权修改该候选的优先级"
  ), true);
  assert.equal(miaOwned.priority ?? null, null);
  assert.equal(foreign.priority ?? null, null);
  assert.equal(store.prospectPriorityAudits.length, auditsBefore);

  const managerDenied = await request("/api/prospect-list/priority", alex, {
    ids: [foreign.id],
    action: "set",
    priority: "high"
  });
  assert.equal(managerDenied.response.status, 403);
  assert.equal(managerDenied.json.results?.[0]?.ok, false);
  assert.equal(foreign.priority ?? null, null);
  assert.equal(store.prospectPriorityAudits.some((item) => item.objectId === foreign.id), false);

  const statusBefore = ownedB.status;
  const statusChangedBefore = ownedB.statusChangedAt;
  const leadBefore = ownedB.leadId;
  const partial = await request("/api/prospect-list/priority", alex, {
    ids: [ownedA.id, ownedA.id, foreign.id],
    action: "set",
    priority: " high "
  });
  assert.equal(partial.response.status, 200, partial.json.message);
  assert.equal(partial.json.results?.length, 2);
  const partialOk = partial.json.results?.find((item: { id: string }) => item.id === ownedA.id);
  const partialDenied = partial.json.results?.find((item: { id: string }) => item.id === foreign.id);
  assert.equal(partialOk?.ok, true);
  assert.equal(partialOk?.action, "set");
  assert.equal(partialOk?.priority, "high");
  assert.equal(partialDenied?.ok, false);
  assert.equal(partialDenied?.reason, "无权修改该候选的优先级");
  assert.equal(ownedA.priority, "high");
  assert.equal(foreign.priority ?? null, null);
  assert.equal(foreign.teamId, "middle-east");
  assert.equal(ownedA.description, descriptionBefore);
  assert.deepEqual(ownedA.tags, tagsBefore);
  assert.equal(ownedA.notes, notesTextBefore);
  assert.equal(ownedA.nextFollowAt, followBefore);
  assert.equal(ownedA.ownerId, ownerBefore);
  const partialAudit = store.prospectPriorityAudits.find((item) => item.objectId === ownedA.id);
  assert.ok(partialAudit);
  assert.equal(partialAudit.actorId, alexUser.id);
  assert.equal(partialAudit.action, "set_priority");
  assert.equal(partialAudit.oldValue, "low");
  assert.equal(partialAudit.newValue, "high");
  assert.equal(partialAudit.objectType, "prospect_candidate");
  assert.equal(isIso(partialAudit.at), true);
  assert.equal(store.prospectPriorityAudits.filter((item) => item.objectId === ownedA.id).length, 1);
  assert.equal(store.prospectPriorityAudits.some((item) => item.objectId === foreign.id), false);

  const auditsAfterPartial = store.prospectPriorityAudits.length;
  const repeat = await request("/api/prospect-list/priority", alex, {
    ids: [ownedA.id],
    action: "set",
    priority: "high"
  });
  assert.equal(repeat.response.status, 200);
  assert.equal(repeat.json.results?.[0]?.ok, true);
  assert.equal(repeat.json.results?.[0]?.priority, "high");
  assert.equal(store.prospectPriorityAudits.length, auditsAfterPartial);

  const salesOwn = await request("/api/prospect-list/priority", shirley, {
    ids: [ownedB.id, miaOwned.id],
    action: "set",
    priority: "normal"
  });
  assert.equal(salesOwn.response.status, 200, salesOwn.json.message);
  const ownOk = salesOwn.json.results?.find((item: { id: string }) => item.id === ownedB.id);
  const ownDenied = salesOwn.json.results?.find((item: { id: string }) => item.id === miaOwned.id);
  assert.equal(ownOk?.ok, true);
  assert.equal(ownedB.priority, "normal");
  assert.equal(ownDenied?.ok, false);
  assert.equal(miaOwned.priority ?? null, null);
  assert.equal(ownedB.status, statusBefore);
  assert.equal(ownedB.statusChangedAt, statusChangedBefore);
  assert.equal(ownedB.leadId, leadBefore);
  assert.equal(ownedB.description, "已入线索的描述");
  assert.equal(ownedB.notes, "原备注");
  assert.equal(ownedB.ownerId, shirleyUser.id);
  const auditB = store.prospectPriorityAudits.find((item) => item.objectId === ownedB.id);
  assert.ok(auditB, "成功设置优先级后必须有审计");
  assert.equal(auditB.actorId, shirleyUser.id);
  assert.equal(auditB.objectType, "prospect_candidate");
  assert.equal(auditB.action, "set_priority");
  assert.equal(auditB.oldValue, null);
  assert.equal(auditB.newValue, "normal");
  assert.equal(isIso(auditB.at), true);

  const cleared = await request("/api/prospect-list/priority", alex, {
    ids: [ownedA.id],
    action: "clear"
  });
  assert.equal(cleared.response.status, 200, cleared.json.message);
  assert.equal(ownedA.priority, null);
  assert.equal(cleared.json.results?.[0]?.priority, null);
  assert.equal(cleared.json.results?.[0]?.action, "clear");
  const clearAudit = store.prospectPriorityAudits.find((item) => item.objectId === ownedA.id && item.action === "clear_priority");
  assert.ok(clearAudit);
  assert.equal(clearAudit.actorId, alexUser.id);
  assert.equal(clearAudit.oldValue, "high");
  assert.equal(clearAudit.newValue, null);

  const clearAgain = await request("/api/prospect-list/priority", alex, {
    ids: [ownedA.id],
    action: "clear"
  });
  assert.equal(clearAgain.response.status, 200);
  assert.equal(clearAgain.json.results?.[0]?.ok, true);
  assert.equal(clearAgain.json.results?.[0]?.priority, null);
  assert.equal(store.prospectPriorityAudits.filter((item) => item.objectId === ownedA.id && item.action === "clear_priority").length, 1);

  assert.equal(store.outboundEmailLogs.length, emailsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outreachSequences.length, sequencesBefore);
  assert.equal(store.prospectOutreachBatches.length, batchesBefore);
  assert.equal(store.internalMessages.length, messagesBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.leadActivities.length, activitiesBefore);
  assert.equal(store.prospectNoteAudits.length, notesBefore);
  assert.equal(ownedB.status, "synced");
  assert.equal(ownedA.notes, notesTextBefore);
  assert.equal(ownedA.nextFollowAt, followBefore);
  assert.deepEqual(ownedA.tags, tagsBefore);

  console.log("prospect priority http tests passed");
} finally {
  server.close();
}
