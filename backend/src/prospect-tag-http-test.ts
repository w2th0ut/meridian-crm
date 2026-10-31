import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { PROSPECT_CANDIDATE_TAGS_MAX } from "./prospect-tags.js";
import type { WebsiteOpportunity } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start prospect tag test server");
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
    tags: [],
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

  const ownedA = cloneCandidate(seed, "web_tag_a", shirleyUser.id, "europe");
  const ownedB = cloneCandidate(seed, "web_tag_b", shirleyUser.id, "europe");
  const miaOwned = cloneCandidate(seed, "web_tag_mia", miaUser.id, "europe");
  const foreign = cloneCandidate(seed, "web_tag_foreign", "u_foreign_sales", "middle-east");
  ownedB.status = "synced";
  ownedB.leadId = "lead_tag_b";
  store.websiteOpportunities.push(ownedA, ownedB, miaOwned, foreign);
  store.users.push({
    ...shirleyUser,
    id: "u_foreign_sales",
    name: "Foreign",
    email: "foreign-tag-owner@example.com",
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
  const auditsBefore = store.prospectTagAudits.length;

  const empty = await request("/api/prospect-list/tags", alex, { ids: [], action: "add", tags: ["重点"] });
  assert.equal(empty.response.status, 400);
  assert.match(String(empty.json.message || ""), /参数格式错误/);

  const overLimit = await request("/api/prospect-list/tags", alex, {
    ids: Array.from({ length: 101 }, (_, index) => `web_over_${index}`),
    action: "add",
    tags: ["重点"]
  });
  assert.equal(overLimit.response.status, 400);
  assert.equal(store.prospectTagAudits.length, auditsBefore);
  assert.deepEqual(ownedA.tags, []);

  const blank = await request("/api/prospect-list/tags", alex, { ids: [ownedA.id], action: "add", tags: ["  ", ""] });
  assert.equal(blank.response.status, 400);
  assert.match(String(blank.json.message || ""), /请填写标签/);
  assert.equal(store.prospectTagAudits.length, auditsBefore);

  const tooLong = await request("/api/prospect-list/tags", alex, {
    ids: [ownedA.id],
    action: "add",
    tags: ["重".repeat(41)]
  });
  assert.equal(tooLong.response.status, 400);
  assert.match(String(tooLong.json.message || ""), /标签过长/);
  assert.deepEqual(ownedA.tags, []);

  const tooMany = await request("/api/prospect-list/tags", alex, {
    ids: [ownedA.id],
    action: "add",
    tags: Array.from({ length: 21 }, (_, index) => `标签${index}`)
  });
  assert.equal(tooMany.response.status, 400);
  assert.match(String(tooMany.json.message || ""), /20/);
  assert.equal(store.prospectTagAudits.length, auditsBefore);

  const badAction = await request("/api/prospect-list/tags", alex, {
    ids: [ownedA.id],
    action: "replace",
    tags: ["重点"]
  });
  assert.equal(badAction.response.status, 400);
  assert.match(String(badAction.json.message || ""), /参数格式错误/);

  const salesDenied = await request("/api/prospect-list/tags", shirley, {
    ids: [miaOwned.id, foreign.id],
    action: "add",
    tags: ["重点"]
  });
  assert.equal(salesDenied.response.status, 403);
  assert.equal(salesDenied.json.results?.length, 2);
  assert.equal(salesDenied.json.results.every((item: { ok: boolean; reason?: string }) =>
    !item.ok && item.reason === "无权修改该候选的标签"
  ), true);
  assert.deepEqual(miaOwned.tags, []);
  assert.deepEqual(foreign.tags, []);
  assert.equal(store.prospectTagAudits.length, auditsBefore);

  const managerDenied = await request("/api/prospect-list/tags", alex, {
    ids: [foreign.id],
    action: "add",
    tags: ["重点"]
  });
  assert.equal(managerDenied.response.status, 403);
  assert.equal(managerDenied.json.results?.[0]?.ok, false);
  assert.deepEqual(foreign.tags, []);
  assert.equal(store.prospectTagAudits.some((item) => item.objectId === foreign.id), false);

  const statusBefore = ownedB.status;
  const statusChangedBefore = ownedB.statusChangedAt;
  const leadBefore = ownedB.leadId;
  const partial = await request("/api/prospect-list/tags", alex, {
    ids: [ownedA.id, ownedA.id, foreign.id],
    action: "add",
    tags: ["  重点  ", "重点", "欧洲"]
  });
  assert.equal(partial.response.status, 200, partial.json.message);
  assert.equal(partial.json.results?.length, 2);
  const partialOk = partial.json.results?.find((item: { id: string }) => item.id === ownedA.id);
  const partialDenied = partial.json.results?.find((item: { id: string }) => item.id === foreign.id);
  assert.equal(partialOk?.ok, true);
  assert.deepEqual(partialOk?.tags, ["重点", "欧洲"]);
  assert.deepEqual(partialOk?.applied, ["重点", "欧洲"]);
  assert.equal(partialDenied?.ok, false);
  assert.equal(partialDenied?.reason, "无权修改该候选的标签");
  assert.deepEqual(ownedA.tags, ["重点", "欧洲"]);
  assert.deepEqual(foreign.tags, []);
  assert.equal(foreign.teamId, "middle-east");
  const partialAudit = store.prospectTagAudits.find((item) => item.objectId === ownedA.id);
  assert.ok(partialAudit);
  assert.equal(partialAudit.actorId, alexUser.id);
  assert.equal(partialAudit.action, "add_tags");
  assert.deepEqual(partialAudit.tags, ["重点", "欧洲"]);
  assert.equal(store.prospectTagAudits.filter((item) => item.objectId === ownedA.id).length, 1);
  assert.equal(store.prospectTagAudits.some((item) => item.objectId === foreign.id), false);

  const auditsAfterPartial = store.prospectTagAudits.length;
  const repeat = await request("/api/prospect-list/tags", alex, {
    ids: [ownedA.id],
    action: "add",
    tags: ["重点"]
  });
  assert.equal(repeat.response.status, 200);
  assert.equal(repeat.json.results?.[0]?.ok, true);
  assert.deepEqual(repeat.json.results?.[0]?.applied, []);
  assert.equal(store.prospectTagAudits.length, auditsAfterPartial);
  assert.deepEqual(ownedA.tags, ["重点", "欧洲"]);

  const salesOwn = await request("/api/prospect-list/tags", shirley, {
    ids: [ownedB.id, miaOwned.id],
    action: "add",
    tags: ["跟进"]
  });
  assert.equal(salesOwn.response.status, 200, salesOwn.json.message);
  const ownOk = salesOwn.json.results?.find((item: { id: string }) => item.id === ownedB.id);
  const ownDenied = salesOwn.json.results?.find((item: { id: string }) => item.id === miaOwned.id);
  assert.equal(ownOk?.ok, true);
  assert.deepEqual(ownedB.tags, ["跟进"]);
  assert.equal(ownDenied?.ok, false);
  assert.deepEqual(miaOwned.tags, []);
  assert.equal(ownedB.status, statusBefore);
  assert.equal(ownedB.statusChangedAt, statusChangedBefore);
  assert.equal(ownedB.leadId, leadBefore);
  assert.equal(ownedB.ownerId, shirleyUser.id);
  assert.equal(ownedA.ownerId, shirleyUser.id);
  assert.equal(ownedA.teamId, "europe");
  const auditB = store.prospectTagAudits.find((item) => item.objectId === ownedB.id);
  assert.ok(auditB, "成功打标签后必须有审计");
  assert.equal(auditB.actorId, shirleyUser.id);
  assert.equal(auditB.objectType, "prospect_candidate");
  assert.equal(auditB.action, "add_tags");
  assert.deepEqual(auditB.tags, ["跟进"]);
  assert.equal(isIso(auditB.at), true);

  const removed = await request("/api/prospect-list/tags", alex, {
    ids: [ownedA.id],
    action: "remove",
    tags: ["欧洲", "没有"]
  });
  assert.equal(removed.response.status, 200, removed.json.message);
  assert.deepEqual(ownedA.tags, ["重点"]);
  const removeAudit = store.prospectTagAudits.find((item) => item.objectId === ownedA.id && item.action === "remove_tags");
  assert.ok(removeAudit);
  assert.equal(removeAudit.actorId, alexUser.id);
  assert.deepEqual(removeAudit.tags, ["欧洲"]);

  const missing = await request("/api/prospect-list/tags", alex, {
    ids: [ownedA.id],
    action: "remove",
    tags: ["没有"]
  });
  assert.equal(missing.response.status, 200);
  assert.deepEqual(missing.json.results?.[0]?.applied, []);
  assert.equal(store.prospectTagAudits.filter((item) => item.objectId === ownedA.id && item.action === "remove_tags").length, 1);

  ownedA.tags = Array.from({ length: PROSPECT_CANDIDATE_TAGS_MAX }, (_, index) => `已有${index}`);
  const capped = await request("/api/prospect-list/tags", alex, {
    ids: [ownedA.id, miaOwned.id],
    action: "add",
    tags: ["新标签"]
  });
  assert.equal(capped.response.status, 200, capped.json.message);
  const cappedRow = capped.json.results?.find((item: { id: string }) => item.id === ownedA.id);
  const cappedOk = capped.json.results?.find((item: { id: string }) => item.id === miaOwned.id);
  assert.equal(cappedRow?.ok, false);
  assert.equal(cappedRow?.reason, "标签数量超过上限");
  assert.equal(ownedA.tags.length, PROSPECT_CANDIDATE_TAGS_MAX);
  assert.equal(ownedA.tags.includes("新标签"), false);
  assert.equal(cappedOk?.ok, true);
  assert.deepEqual(miaOwned.tags, ["新标签"]);
  assert.equal(store.prospectTagAudits.some((item) => item.objectId === ownedA.id && item.tags.includes("新标签")), false);
  const capAudit = store.prospectTagAudits.find((item) => item.objectId === miaOwned.id && item.action === "add_tags");
  assert.ok(capAudit);
  assert.deepEqual(capAudit.tags, ["新标签"]);

  assert.equal(store.outboundEmailLogs.length, emailsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outreachSequences.length, sequencesBefore);
  assert.equal(store.prospectOutreachBatches.length, batchesBefore);
  assert.equal(store.internalMessages.length, messagesBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(ownedB.status, "synced");

  console.log("prospect tag http tests passed");
} finally {
  server.close();
}
