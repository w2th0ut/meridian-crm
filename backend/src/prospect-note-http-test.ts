import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import type { WebsiteOpportunity } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start prospect note test server");
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
    notes: "",
    nextFollowAt: "2026-11-02 23:59",
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

  const ownedA = cloneCandidate(seed, "web_note_a", shirleyUser.id, "europe");
  const ownedB = cloneCandidate(seed, "web_note_b", shirleyUser.id, "europe");
  const miaOwned = cloneCandidate(seed, "web_note_mia", miaUser.id, "europe");
  const foreign = cloneCandidate(seed, "web_note_foreign", "u_foreign_note_sales", "middle-east");
  ownedA.notes = "  已有备注  ";
  ownedA.description = "核验描述保持不变";
  ownedB.status = "synced";
  ownedB.leadId = "lead_note_b";
  ownedB.description = "已入线索的描述";
  store.websiteOpportunities.push(ownedA, ownedB, miaOwned, foreign);
  store.users.push({
    ...shirleyUser,
    id: "u_foreign_note_sales",
    name: "Foreign",
    email: "foreign-note-owner@example.com",
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
  const auditsBefore = store.prospectNoteAudits.length;
  const descriptionBefore = ownedA.description;
  const tagsBefore = [...(ownedA.tags || [])];
  const followBefore = ownedA.nextFollowAt;
  const ownerBefore = ownedA.ownerId;

  const empty = await request("/api/prospect-list/notes", alex, { ids: [], note: "已电话确认" });
  assert.equal(empty.response.status, 400);
  assert.match(String(empty.json.message || ""), /参数格式错误/);

  const overLimit = await request("/api/prospect-list/notes", alex, {
    ids: Array.from({ length: 101 }, (_, index) => `web_note_over_${index}`),
    note: "已电话确认"
  });
  assert.equal(overLimit.response.status, 400);
  assert.equal(store.prospectNoteAudits.length, auditsBefore);
  assert.equal(ownedA.notes, "  已有备注  ");

  const blank = await request("/api/prospect-list/notes", alex, { ids: [ownedA.id], note: "  \n " });
  assert.equal(blank.response.status, 400);
  assert.match(String(blank.json.message || ""), /请填写备注/);
  assert.equal(store.prospectNoteAudits.length, auditsBefore);
  assert.equal(ownedA.notes, "  已有备注  ");

  const tooLong = await request("/api/prospect-list/notes", alex, {
    ids: [ownedA.id],
    note: `  ${"备".repeat(1001)}  `
  });
  assert.equal(tooLong.response.status, 400);
  assert.match(String(tooLong.json.message || ""), /备注过长/);
  assert.equal(ownedA.notes, "  已有备注  ");

  const missingNote = await request("/api/prospect-list/notes", alex, { ids: [ownedA.id] });
  assert.equal(missingNote.response.status, 400);
  assert.match(String(missingNote.json.message || ""), /参数格式错误/);

  const salesDenied = await request("/api/prospect-list/notes", shirley, {
    ids: [miaOwned.id, foreign.id],
    note: "不该写上"
  });
  assert.equal(salesDenied.response.status, 403);
  assert.equal(salesDenied.json.results?.length, 2);
  assert.equal(salesDenied.json.results.every((item: { ok: boolean; reason?: string }) =>
    !item.ok && item.reason === "无权追加该候选的备注"
  ), true);
  assert.equal(miaOwned.notes, "");
  assert.equal(foreign.notes, "");
  assert.equal(store.prospectNoteAudits.length, auditsBefore);

  const managerDenied = await request("/api/prospect-list/notes", alex, {
    ids: [foreign.id],
    note: "不该写上"
  });
  assert.equal(managerDenied.response.status, 403);
  assert.equal(managerDenied.json.results?.[0]?.ok, false);
  assert.equal(foreign.notes, "");
  assert.equal(store.prospectNoteAudits.some((item) => item.objectId === foreign.id), false);

  const statusBefore = ownedB.status;
  const statusChangedBefore = ownedB.statusChangedAt;
  const leadBefore = ownedB.leadId;
  const partial = await request("/api/prospect-list/notes", alex, {
    ids: [ownedA.id, ownedA.id, foreign.id],
    note: "  已电话确认  "
  });
  assert.equal(partial.response.status, 200, partial.json.message);
  assert.equal(partial.json.results?.length, 2);
  const partialOk = partial.json.results?.find((item: { id: string }) => item.id === ownedA.id);
  const partialDenied = partial.json.results?.find((item: { id: string }) => item.id === foreign.id);
  assert.equal(partialOk?.ok, true);
  assert.equal(partialOk?.note, "已电话确认");
  assert.equal(partialOk?.notes, "  已有备注  \n已电话确认");
  assert.equal(partialDenied?.ok, false);
  assert.equal(partialDenied?.reason, "无权追加该候选的备注");
  assert.equal(ownedA.notes, "  已有备注  \n已电话确认");
  assert.equal(ownedA.description, descriptionBefore);
  assert.deepEqual(ownedA.tags, tagsBefore);
  assert.equal(ownedA.nextFollowAt, followBefore);
  assert.equal(ownedA.ownerId, ownerBefore);
  assert.equal(foreign.notes, "");
  assert.equal(foreign.teamId, "middle-east");
  const partialAudit = store.prospectNoteAudits.find((item) => item.objectId === ownedA.id);
  assert.ok(partialAudit);
  assert.equal(partialAudit.actorId, alexUser.id);
  assert.equal(partialAudit.action, "append_note");
  assert.equal(partialAudit.note, "已电话确认");
  assert.equal(partialAudit.objectType, "prospect_candidate");
  assert.equal(isIso(partialAudit.at), true);
  assert.equal(store.prospectNoteAudits.filter((item) => item.objectId === ownedA.id).length, 1);
  assert.equal(store.prospectNoteAudits.some((item) => item.objectId === foreign.id), false);

  const salesOwn = await request("/api/prospect-list/notes", shirley, {
    ids: [ownedB.id, miaOwned.id],
    note: "业务员自己的备注"
  });
  assert.equal(salesOwn.response.status, 200, salesOwn.json.message);
  const ownOk = salesOwn.json.results?.find((item: { id: string }) => item.id === ownedB.id);
  const ownDenied = salesOwn.json.results?.find((item: { id: string }) => item.id === miaOwned.id);
  assert.equal(ownOk?.ok, true);
  assert.equal(ownedB.notes, "业务员自己的备注");
  assert.equal(ownDenied?.ok, false);
  assert.equal(miaOwned.notes, "");
  assert.equal(ownedB.status, statusBefore);
  assert.equal(ownedB.statusChangedAt, statusChangedBefore);
  assert.equal(ownedB.leadId, leadBefore);
  assert.equal(ownedB.description, "已入线索的描述");
  assert.equal(ownedB.ownerId, shirleyUser.id);
  const auditB = store.prospectNoteAudits.find((item) => item.objectId === ownedB.id);
  assert.ok(auditB, "成功追加备注后必须有审计");
  assert.equal(auditB.actorId, shirleyUser.id);
  assert.equal(auditB.objectType, "prospect_candidate");
  assert.equal(auditB.action, "append_note");
  assert.equal(auditB.note, "业务员自己的备注");
  assert.equal(isIso(auditB.at), true);

  const repeat = await request("/api/prospect-list/notes", alex, {
    ids: [ownedA.id],
    note: "已电话确认"
  });
  assert.equal(repeat.response.status, 200, repeat.json.message);
  assert.equal(repeat.json.results?.[0]?.ok, true);
  assert.equal(ownedA.notes, "  已有备注  \n已电话确认\n已电话确认");
  assert.equal(store.prospectNoteAudits.filter((item) => item.objectId === ownedA.id).length, 2);
  assert.equal(ownedA.description, descriptionBefore);

  const exact = await request("/api/prospect-list/notes", alex, {
    ids: [miaOwned.id],
    note: ` ${"备".repeat(1000)} `
  });
  assert.equal(exact.response.status, 200, exact.json.message);
  assert.equal(miaOwned.notes, "备".repeat(1000));
  assert.equal(store.prospectNoteAudits.filter((item) => item.objectId === miaOwned.id).length, 1);

  assert.equal(store.outboundEmailLogs.length, emailsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outreachSequences.length, sequencesBefore);
  assert.equal(store.prospectOutreachBatches.length, batchesBefore);
  assert.equal(store.internalMessages.length, messagesBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.leadActivities.length, activitiesBefore);
  assert.equal(ownedB.status, "synced");

  console.log("prospect note http tests passed");
} finally {
  server.close();
}
