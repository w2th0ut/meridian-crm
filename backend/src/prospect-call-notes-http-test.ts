import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import type { AliyunAgentMapping, OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start prospect call note test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

async function request(path: string, token: string) {
  const response = await originalFetch(`${baseUrl}${path}`, {
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  });
  const text = await response.text();
  const type = response.headers.get("content-type") || "";
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

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "targetType" | "targetId">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    maskedNumber: "****8000",
    contactType: "OUTBOUND",
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: "2000",
    agentIds: "agent@ccc-pcn-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://secret.example/do-not-leak",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "有意向",
    callOutcomeNote: "结果备注不要出现",
    callNote: "",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
    ...partial
  };
}

try {
  const store = getStore();
  const shirley = await login("shirley@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const alexUser = store.users.find((item) => item.email === "alex@keduoduo.com");
  assert.ok(shirleyUser && miaUser && alexUser);
  store.users.push({
    ...shirleyUser,
    id: "u_pcn_no_read",
    name: "No Read",
    email: "no-pcn-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    if (actor.id !== "u_pcn_no_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };
  const noRead = await login("no-pcn-read@keduoduo.com");
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
  store.aliyunAgentMappings.push(
    mapping({ crmUserId: shirleyUser.id, cccUserId: "agent@ccc-pcn-a", displayName: "Shirley坐席" }),
    mapping({ crmUserId: miaUser.id, cccUserId: "agent@ccc-pcn-b", displayName: "Mia坐席" })
  );
  const prospectTemplate = store.websiteOpportunities.find((item) => item.id === "web_seed_1");
  assert.ok(prospectTemplate);
  store.websiteOpportunities.push({
    ...prospectTemplate,
    id: "p_pcn_shirley",
    company: "Nordic <Tools>",
    teamId: "europe",
    ownerId: shirleyUser.id,
    status: "contacted",
    leadId: "",
    nextFollowAt: "2026-11-12 09:00",
    outreachState: "uncontacted"
  }, {
    ...prospectTemplate,
    id: "p_pcn_empty",
    company: "没有纪要",
    teamId: "europe",
    ownerId: shirleyUser.id,
    status: "contacted",
    leadId: "",
    nextFollowAt: "",
    outreachState: "uncontacted"
  }, {
    ...prospectTemplate,
    id: "p_pcn_alex",
    company: "Alex 的候选",
    teamId: "europe",
    ownerId: alexUser.id,
    status: "contacted",
    leadId: "",
    nextFollowAt: "",
    outreachState: "uncontacted"
  }, {
    ...prospectTemplate,
    id: "p_pcn_asia",
    company: "亚洲候选",
    teamId: "asia",
    ownerId: "someone",
    status: "contacted",
    leadId: "",
    nextFollowAt: "",
    outreachState: "uncontacted"
  });
  store.outboundCallRecords.push(
    record({
      id: "ocr_pcn_old",
      targetType: "prospect",
      targetId: "p_pcn_shirley",
      callNote: "  要样品<script>  ",
      callNoteTags: "预算,需求",
      callNoteUpdatedAt: "2026-11-01T01:00:00.000Z",
      maskedNumber: "13800138000"
    }),
    record({
      id: "ocr_pcn_new",
      targetType: "prospect",
      targetId: "p_pcn_shirley",
      callNote: "",
      callNoteTags: "异议",
      callNoteUpdatedAt: "2026-11-03T01:00:00.000Z"
    }),
    record({
      id: "ocr_pcn_blank",
      targetType: "prospect",
      targetId: "p_pcn_shirley",
      callNote: "   ",
      callNoteTags: ""
    }),
    record({
      id: "ocr_pcn_mia",
      targetType: "prospect",
      targetId: "p_pcn_shirley",
      agentIds: "agent@ccc-pcn-b",
      callNote: "Mia 的纪要不要给 Shirley",
      callNoteUpdatedAt: "2026-11-04T01:00:00.000Z"
    }),
    record({
      id: "ocr_pcn_customer",
      targetType: "customer",
      targetId: "p_pcn_shirley",
      callNote: "客户纪要不要混进来"
    }),
    record({
      id: "ocr_pcn_other",
      targetType: "prospect",
      targetId: "p_pcn_empty",
      callNote: ""
    }),
    record({
      id: "ocr_pcn_alex",
      targetType: "prospect",
      targetId: "p_pcn_alex",
      agentIds: "agent@ccc-pcn-b",
      callNote: "机密纪要不要进拒绝响应",
      callNoteUpdatedAt: "2026-11-02T01:00:00.000Z"
    }),
    record({
      id: "ocr_pcn_asia",
      teamId: "asia",
      targetType: "prospect",
      targetId: "p_pcn_asia",
      callNote: "别的租户纪要"
    })
  );

  const followBefore = store.websiteOpportunities.find((item) => item.id === "p_pcn_shirley")?.nextFollowAt;
  const noteBefore = store.outboundCallRecords.find((item) => item.id === "ocr_pcn_old")?.callNote;
  const outcomeBefore = store.outboundCallRecords.find((item) => item.id === "ocr_pcn_old")?.callOutcome;
  const activitiesBefore = store.customerActivities.length;
  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions);
  const leadsBefore = store.leads.length;

  const mine = await request("/api/prospect-call-notes?candidateId=p_pcn_shirley", shirley);
  assert.equal(mine.response.status, 200);
  assert.equal(mine.json.candidateId, "p_pcn_shirley");
  assert.equal(mine.json.empty, false);
  assert.equal("rowCount" in mine.json, false);
  assert.equal("connectRate" in mine.json, false);
  assert.deepEqual(mine.json.items.map((item: { callRecordId: string }) => item.callRecordId), ["ocr_pcn_new", "ocr_pcn_old"]);
  const older = mine.json.items.find((item: { callRecordId: string }) => item.callRecordId === "ocr_pcn_old");
  assert.equal(older.note, "要样品<script>");
  assert.deepEqual(older.tags, ["需求", "预算"]);
  assert.equal(older.at, "2026-11-01T01:00:00.000Z");
  assert.equal(String(older.maskedNumber).includes("13800138000"), false);
  const newer = mine.json.items.find((item: { callRecordId: string }) => item.callRecordId === "ocr_pcn_new");
  assert.equal(newer.note, "");
  assert.deepEqual(newer.tags, ["异议"]);
  assert.equal(JSON.stringify(mine.json).includes("secret.example"), false);
  assert.equal(JSON.stringify(mine.json).includes("有意向"), false);
  assert.equal(JSON.stringify(mine.json).includes("结果备注不要出现"), false);
  assert.equal(JSON.stringify(mine.json).includes("Mia 的纪要"), false);
  assert.equal(JSON.stringify(mine.json).includes("客户纪要"), false);
  assert.equal(store.prospectCallNoteViewAudits.some((item) => item.actorId === shirleyUser.id && item.action === "read" && item.candidateId === "p_pcn_shirley" && item.result === "read" && item.rowCount === 2), true);

  const again = await request("/api/prospect-call-notes?candidateId=p_pcn_shirley", shirley);
  assert.equal(again.response.status, 200);
  assert.equal(store.prospectCallNoteViewAudits.filter((item) => item.actorId === shirleyUser.id && item.action === "read" && item.result === "read" && item.candidateId === "p_pcn_shirley").length, 2);

  const empty = await request("/api/prospect-call-notes?candidateId=p_pcn_empty", shirley);
  assert.equal(empty.response.status, 200);
  assert.equal(empty.json.empty, true);
  assert.deepEqual(empty.json.items, []);
  assert.equal(store.prospectCallNoteViewAudits.some((item) => item.candidateId === "p_pcn_empty" && item.result === "read" && item.rowCount === 0), true);

  const alexView = await request("/api/prospect-call-notes?candidateId=p_pcn_shirley", alex);
  assert.equal(alexView.response.status, 200);
  const alexIds = alexView.json.items.map((item: { callRecordId: string }) => item.callRecordId);
  assert.equal(alexIds.includes("ocr_pcn_old"), true);
  assert.equal(alexIds.includes("ocr_pcn_mia"), true);
  const adminView = await request("/api/prospect-call-notes?candidateId=p_pcn_shirley", admin);
  assert.equal(adminView.response.status, 200);
  assert.equal(adminView.json.items.some((item: { callRecordId: string }) => item.callRecordId === "ocr_pcn_mia"), true);

  const auditsAfterOk = store.prospectCallNoteViewAudits.length;
  assert.equal((await request("/api/prospect-call-notes", shirley)).response.status, 400);
  assert.equal((await request("/api/prospect-call-notes?candidateId=", shirley)).response.status, 400);
  assert.equal((await request("/api/prospect-call-notes?candidateId=p_pcn_shirley&outcome=%E5%85%B6%E4%BB%96", shirley)).response.status, 400);
  assert.equal((await request("/api/prospect-call-notes?candidateId=p_pcn_shirley", "")).response.status, 401);
  assert.equal(store.prospectCallNoteViewAudits.length, auditsAfterOk);

  const deniedRead = await request("/api/prospect-call-notes?candidateId=p_pcn_shirley", noRead);
  assert.equal(deniedRead.response.status, 403);
  assert.equal(deniedRead.json.reason, "forbidden");
  assert.equal(JSON.stringify(deniedRead.json).includes("要样品"), false);
  assert.equal(store.prospectCallNoteViewAudits.some((item) => item.actorId === "u_pcn_no_read" && item.result === "rejected" && item.reason === "forbidden" && item.rowCount === 0), true);

  const hidden = await request("/api/prospect-call-notes?candidateId=p_pcn_alex", shirley);
  assert.equal(hidden.response.status, 403);
  assert.equal(JSON.stringify(hidden.json).includes("机密纪要"), false);
  const otherTeam = await request("/api/prospect-call-notes?candidateId=p_pcn_asia", shirley);
  assert.equal(otherTeam.response.status, 403);
  assert.equal(JSON.stringify(otherTeam.json).includes("别的租户纪要"), false);
  const auditText = JSON.stringify(store.prospectCallNoteViewAudits);
  assert.equal(auditText.includes("机密纪要"), false);
  assert.equal(auditText.includes("别的租户纪要"), false);
  assert.equal(auditText.includes("要样品"), false);
  assert.equal(auditText.includes("13800138000"), false);
  assert.equal(auditText.includes("secret.example"), false);
  assert.equal(auditText.includes("AccessKey"), false);

  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_pcn_shirley")?.nextFollowAt, followBefore);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_pcn_old")?.callNote, noteBefore);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_pcn_old")?.callOutcome, outcomeBefore);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), false);
  assert.equal(aliyunHits, 0);
  console.log("prospect call note http tests passed");
} finally {
  globalThis.fetch = originalFetch;
  server.close();
}
