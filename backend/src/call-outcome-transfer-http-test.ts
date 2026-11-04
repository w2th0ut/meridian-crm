import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundDialerForTests } from "./outbound-call.js";
import type { MakeCallParams } from "./aliyun-ccc-make-call.js";
import type { AliyunAgentMapping, OutboundCallRecord, WebsiteOpportunity } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call outcome transfer test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

const calls: MakeCallParams[] = [];
setOutboundDialerForTests({
  async makeCall(params) {
    calls.push({ ...params });
    return { jobId: "job-xfer", callType: "OUTBOUND" };
  }
});

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
    maskedNumber: "0222",
    contactType: "OUTBOUND",
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "8",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: "2000",
    agentIds: "agent@ccc-xfer-shirley,agent@ccc-xfer-alex",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://secret.example/do-not-leak",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "",
    callOutcomeNote: "",
    callNote: "",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...partial
  };
}

const store = getStore();
let originalSnapshot: typeof store.getIamCapabilitySnapshot;

try {
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const alexUser = store.users.find((item) => item.email === "alex@keduoduo.com");
  const customerTemplate = store.customers.find((item) => item.id === "c1");
  const leadTemplate = store.leads.find((item) => item.id === "l1");
  const seed = store.websiteOpportunities.find((item) => item.id === "web_seed_1");
  assert.ok(shirleyUser && miaUser && alexUser && customerTemplate && leadTemplate && seed);

  store.users.push({
    ...shirleyUser,
    id: "u_xfer_off",
    name: "Off",
    email: "xfer-off@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "disabled"
  }, {
    ...shirleyUser,
    id: "u_xfer_foreign",
    name: "Foreign",
    email: "xfer-foreign@keduoduo.com",
    role: "sales",
    teamId: "asia",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_xfer_noread",
    name: "No Read",
    email: "xfer-noread@keduoduo.com",
    role: "manager",
    teamId: "europe",
    status: "active"
  });
  originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_xfer_noread") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };

  store.customers.push({
    ...customerTemplate,
    id: "c_xfer",
    company: "Xfer Co",
    ownerId: shirleyUser.id,
    teamId: "europe",
    poolStatus: "owned",
    nextReminder: "保持提醒"
  }, {
    ...customerTemplate,
    id: "c_xfer_pool",
    company: "Xfer Pool",
    ownerId: "",
    teamId: "europe",
    poolStatus: "public",
    nextReminder: "公池提醒"
  }, {
    ...customerTemplate,
    id: "c_xfer_plain",
    company: "Xfer Plain",
    ownerId: shirleyUser.id,
    teamId: "europe",
    poolStatus: "owned",
    nextReminder: "不转交"
  });
  store.leads.push({
    ...leadTemplate,
    id: "l_xfer",
    company: "Xfer Lead",
    ownerId: shirleyUser.id,
    teamId: "europe",
    deletedAt: "",
    nextFollowAt: "线索跟进"
  });
  const prospect = {
    ...structuredClone(seed),
    id: "web_xfer",
    company: "Xfer Prospect",
    ownerId: shirleyUser.id,
    teamId: "europe",
    status: "preview",
    leadId: ""
  } as WebsiteOpportunity;
  const synced = {
    ...structuredClone(seed),
    id: "web_xfer_synced",
    company: "Xfer Synced",
    ownerId: shirleyUser.id,
    teamId: "europe",
    status: "synced"
  } as WebsiteOpportunity;
  store.websiteOpportunities.push(prospect, synced);

  const mapping = (partial: AliyunAgentMapping): AliyunAgentMapping => partial;
  store.aliyunAgentMappings.push(
    mapping({
      id: "map_xfer_shirley",
      teamId: "europe",
      crmUserId: shirleyUser.id,
      cccUserId: "agent@ccc-xfer-shirley",
      loginName: "shirley-xfer",
      displayName: "Shirley",
      extension: "8201",
      workMode: "ON_SITE",
      updatedBy: alexUser.id,
      updatedAt: "2026-11-01T00:00:00.000Z"
    }),
    mapping({
      id: "map_xfer_alex",
      teamId: "europe",
      crmUserId: alexUser.id,
      cccUserId: "agent@ccc-xfer-alex",
      loginName: "alex-xfer",
      displayName: "Alex",
      extension: "8202",
      workMode: "ON_SITE",
      updatedBy: alexUser.id,
      updatedAt: "2026-11-01T00:00:00.000Z"
    })
  );
  store.outboundCallRecords.push(
    record({ id: "ocr_xfer_customer", targetType: "customer", targetId: "c_xfer" }),
    record({ id: "ocr_xfer_plain", targetType: "customer", targetId: "c_xfer_plain" }),
    record({ id: "ocr_xfer_pool", targetType: "customer", targetId: "c_xfer_pool" }),
    record({ id: "ocr_xfer_lead", targetType: "lead", targetId: "l_xfer" }),
    record({ id: "ocr_xfer_prospect", targetType: "prospect", targetId: "web_xfer" }),
    record({ id: "ocr_xfer_synced", targetType: "prospect", targetId: "web_xfer_synced" })
  );

  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  const auditsBefore = store.ownerReassignAudits.length;

  const shirley = await login("shirley@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const noread = await login("xfer-noread@keduoduo.com");

  const salesList = await request("/api/prospect-list/assignees", shirley);
  assert.equal(salesList.response.status, 200);
  assert.equal(salesList.json.assignees.length, 0);

  const denied = await request("/api/outbound-call-records/ocr_xfer_customer/outcome", shirley, "POST", {
    outcome: "有意向",
    note: "想要样品",
    transferTo: miaUser.id
  });
  assert.equal(denied.response.status, 403, denied.json.message);
  assert.equal(denied.json.reason, "forbidden");
  assert.equal(store.customers.find((item) => item.id === "c_xfer")?.ownerId, shirleyUser.id);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_xfer_customer")?.callOutcome || "", "");
  const deniedAudit = store.ownerReassignAudits.find((item) => item.objectId === "c_xfer" && item.action === "reject_forbidden");
  assert.ok(deniedAudit);
  assert.equal(deniedAudit.callRecordId, "ocr_xfer_customer");
  assert.equal(deniedAudit.previousOwnerId, shirleyUser.id);
  assert.equal(deniedAudit.nextOwnerId, miaUser.id);
  assert.equal(denied.json.text?.includes?.("https://secret"), undefined);
  assert.equal(JSON.stringify(denied.json).includes("secret.example"), false);

  const saved = await request("/api/outbound-call-records/ocr_xfer_customer/outcome", alex, "POST", {
    outcome: "有意向",
    note: "想要样品",
    transferTo: miaUser.id
  });
  assert.equal(saved.response.status, 200, saved.json.message);
  assert.equal(saved.json.result, "updated");
  assert.equal(saved.json.ownerResult, "updated");
  assert.equal(saved.json.ownerId, miaUser.id);
  assert.equal(saved.json.previousOwnerId, shirleyUser.id);
  assert.match(String(saved.json.message), /已转交负责人/);
  assert.equal(store.customers.find((item) => item.id === "c_xfer")?.ownerId, miaUser.id);
  assert.equal(store.customers.find((item) => item.id === "c_xfer")?.nextReminder, "保持提醒");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_xfer_customer")?.callOutcome, "有意向");
  const successAudit = store.ownerReassignAudits.find((item) => item.objectId === "c_xfer" && item.action === "reassign_owner");
  assert.ok(successAudit);
  assert.equal(successAudit.actorId, alexUser.id);
  assert.equal(successAudit.objectType, "customer");
  assert.equal(successAudit.previousOwnerId, shirleyUser.id);
  assert.equal(successAudit.nextOwnerId, miaUser.id);
  assert.equal(successAudit.callRecordId, "ocr_xfer_customer");
  assert.equal(JSON.stringify(successAudit).includes("secret.example"), false);

  const again = await request("/api/outbound-call-records/ocr_xfer_customer/outcome", alex, "POST", {
    outcome: "有意向",
    note: "想要样品",
    transferTo: miaUser.id
  });
  assert.equal(again.response.status, 200, again.json.message);
  assert.equal(again.json.result, "unchanged");
  assert.equal(again.json.ownerResult, "unchanged");
  assert.equal(store.ownerReassignAudits.filter((item) => item.objectId === "c_xfer" && item.action === "reassign_owner").length, 1);

  const plain = await request("/api/outbound-call-records/ocr_xfer_plain/outcome", alex, "POST", {
    outcome: "需回访"
  });
  assert.equal(plain.response.status, 200, plain.json.message);
  assert.equal(plain.json.ownerResult, "skipped");
  assert.equal(store.customers.find((item) => item.id === "c_xfer_plain")?.ownerId, shirleyUser.id);
  assert.equal(store.ownerReassignAudits.some((item) => item.objectId === "c_xfer_plain"), false);

  const leadSaved = await request("/api/outbound-call-records/ocr_xfer_lead/outcome", alex, "POST", {
    outcome: "其他",
    transferTo: miaUser.id
  });
  assert.equal(leadSaved.response.status, 200, leadSaved.json.message);
  assert.equal(store.leads.find((item) => item.id === "l_xfer")?.ownerId, miaUser.id);
  assert.equal(store.leads.find((item) => item.id === "l_xfer")?.nextFollowAt, "线索跟进");
  const leadAudit = store.ownerReassignAudits.find((item) => item.objectId === "l_xfer" && item.action === "reassign_owner");
  assert.equal(leadAudit?.objectType, "lead");
  assert.equal(leadAudit?.callRecordId, "ocr_xfer_lead");

  const prospectSaved = await request("/api/outbound-call-records/ocr_xfer_prospect/outcome", alex, "POST", {
    outcome: "需回访",
    transferTo: miaUser.id
  });
  assert.equal(prospectSaved.response.status, 200, prospectSaved.json.message);
  assert.equal(prospect.ownerId, miaUser.id);
  assert.equal(prospect.status, "preview");
  const prospectAudit = store.ownerReassignAudits.find((item) => item.objectId === "web_xfer" && item.action === "reassign_owner");
  assert.equal(prospectAudit?.objectType, "prospect_candidate");
  assert.equal(prospectAudit?.callRecordId, "ocr_xfer_prospect");

  const syncedResult = await request("/api/outbound-call-records/ocr_xfer_synced/outcome", alex, "POST", {
    outcome: "有意向",
    transferTo: miaUser.id
  });
  assert.equal(syncedResult.response.status, 400, syncedResult.json.message);
  assert.equal(syncedResult.json.reason, "synced");
  assert.equal(synced.ownerId, shirleyUser.id);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_xfer_synced")?.callOutcome || "", "");
  assert.equal(store.ownerReassignAudits.some((item) => item.objectId === "web_xfer_synced"), false);

  const pooled = await request("/api/outbound-call-records/ocr_xfer_pool/outcome", alex, "POST", {
    outcome: "有意向",
    transferTo: miaUser.id
  });
  assert.equal(pooled.response.status, 409, pooled.json.message);
  assert.equal(pooled.json.reason, "public_pool");
  assert.equal(store.customers.find((item) => item.id === "c_xfer_pool")?.ownerId, "");
  assert.equal(store.customers.find((item) => item.id === "c_xfer_pool")?.poolStatus, "public");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_xfer_pool")?.callOutcome || "", "");
  assert.equal(store.ownerReassignAudits.find((item) => item.objectId === "c_xfer_pool")?.action, "reject_public_pool");

  const foreign = await request("/api/outbound-call-records/ocr_xfer_plain/outcome", alex, "POST", {
    outcome: "其他",
    transferTo: "u_xfer_foreign"
  });
  assert.equal(foreign.response.status, 400, foreign.json.message);
  assert.equal(foreign.json.reason, "invalid_assignee");
  assert.equal(store.customers.find((item) => item.id === "c_xfer_plain")?.ownerId, shirleyUser.id);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_xfer_plain")?.callOutcome, "需回访");

  const disabled = await request("/api/outbound-call-records/ocr_xfer_plain/outcome", alex, "POST", {
    outcome: "其他",
    transferTo: "u_xfer_off"
  });
  assert.equal(disabled.response.status, 400);
  assert.equal(disabled.json.reason, "invalid_assignee");

  const arrayBody = await request("/api/outbound-call-records/ocr_xfer_plain/outcome", alex, "POST", {
    outcome: "其他",
    transferTo: [miaUser.id]
  });
  assert.equal(arrayBody.response.status, 400);
  assert.equal(store.ownerReassignAudits.filter((item) => item.callRecordId === "ocr_xfer_plain").length, 0);

  const batch = await request("/api/unlabeled-connected-calls/label", alex, "POST", {
    callRecordIds: ["ocr_xfer_plain"],
    outcome: "其他",
    transferTo: miaUser.id
  });
  assert.equal(batch.response.status, 400);
  assert.equal(store.customers.find((item) => item.id === "c_xfer_plain")?.ownerId, shirleyUser.id);

  const hidden = await request("/api/outbound-call-records/ocr_xfer_customer/outcome", noread, "POST", {
    outcome: "无意向",
    transferTo: shirleyUser.id
  });
  assert.equal(hidden.response.status, 403);
  assert.equal(store.customers.find((item) => item.id === "c_xfer")?.ownerId, miaUser.id);
  assert.equal(store.ownerReassignAudits.filter((item) => item.actorId === "u_xfer_noread").length, 0);

  const anonymous = await request("/api/outbound-call-records/ocr_xfer_customer/outcome", "", "POST", {
    outcome: "无意向",
    transferTo: shirleyUser.id
  });
  assert.equal(anonymous.response.status, 401);
  assert.equal(store.ownerReassignAudits.length > auditsBefore, true);
  assert.equal(store.ownerReassignAudits.some((item) => item.actorId === ""), false);

  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  assert.equal(aliyunHits, 0);
  assert.equal(calls.length, 0);
  assert.equal(JSON.stringify(store.ownerReassignAudits.filter((item) => String(item.callRecordId || "").startsWith("ocr_xfer_"))).includes("secret.example"), false);

  console.log("call outcome transfer http tests passed");
} finally {
  if (originalSnapshot) store.getIamCapabilitySnapshot = originalSnapshot;
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_xfer_"));
  store.callOutcomeAudits = store.callOutcomeAudits.filter((item) => !item.callRecordId.startsWith("ocr_xfer_"));
  store.ownerReassignAudits = store.ownerReassignAudits.filter((item) => !String(item.callRecordId || "").startsWith("ocr_xfer_") && !["c_xfer", "c_xfer_pool", "c_xfer_plain", "l_xfer", "web_xfer", "web_xfer_synced"].includes(item.objectId));
  store.customers = store.customers.filter((item) => !item.id.startsWith("c_xfer"));
  store.leads = store.leads.filter((item) => item.id !== "l_xfer");
  store.websiteOpportunities = store.websiteOpportunities.filter((item) => item.id !== "web_xfer" && item.id !== "web_xfer_synced");
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_xfer_"));
  store.users = store.users.filter((item) => !item.id.startsWith("u_xfer_"));
  globalThis.fetch = originalFetch;
  server.close();
}
