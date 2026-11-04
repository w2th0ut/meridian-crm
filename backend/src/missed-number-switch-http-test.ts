import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundDialerForTests } from "./outbound-call.js";
import type { MakeCallParams } from "./aliyun-ccc-make-call.js";
import type { ContactPhone, OutboundCallAudit, OutboundCallRecord, ProspectContactChannel, WebsiteOpportunity } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start missed number switch test server");
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
    return { jobId: "job-missed-switch", callType: "OUTBOUND" };
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
  const json = await response.json().catch(() => ({})) as Record<string, any>;
  return { response, json };
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
    maskedNumber: "2333",
    contactType: "OUTBOUND",
    contactDisposition: "NoAnswer",
    earlyMediaState: "",
    callDurationRaw: "",
    establishedTimeRaw: "",
    releaseTimeRaw: "",
    startTimeRaw: "2000",
    agentIds: "agent-other",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://secret.example/do-not-leak",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "无意向",
    callOutcomeNote: "备注不要出现",
    callNote: "纪要不要出现",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...partial
  };
}

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  assert.ok(shirleyUser && miaUser);
  store.users.push({
    ...shirleyUser,
    id: "u_switch_no_update",
    name: "No Switch Update",
    email: "no-switch-update@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_switch_asia",
    name: "Asia Switch",
    email: "asia-switch@keduoduo.com",
    role: "sales",
    teamId: "asia",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_switch_no_update") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["customer.update"];
    return { ...snapshot, permissions };
  };

  const seeded = store.customers.find((item) => item.id === "c1");
  assert.ok(seeded);
  const customer = {
    ...seeded,
    id: "c_switch",
    company: "Switch Co",
    phone: "+46111222333",
    poolStatus: "owned" as const,
    ownerId: shirleyUser.id,
    teamId: "europe",
    nextReminder: "keep-switch"
  };
  const pooled = {
    ...seeded,
    id: "c_switch_public",
    company: "Public Switch",
    phone: "+4680001111",
    poolStatus: "public" as const,
    ownerId: shirleyUser.id,
    teamId: "europe",
    nextReminder: "pool-switch"
  };
  store.customers.push(customer, pooled);
  const pooledPreferred = "";
  store.contactPhones.push({
    id: "cph_switch_extra",
    teamId: "europe",
    targetType: "customer",
    targetId: customer.id,
    phoneId: "contact-phone:switch-extra",
    label: "手机",
    phone: "+46700999888",
    phoneDigits: "46700999888",
    origin: "extra",
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-01T00:00:00.000Z"
  } satisfies ContactPhone);
  store.outboundCallAudits.push({
    id: "oca_switch_http",
    teamId: "europe",
    actorId: shirleyUser.id,
    at: "2026-11-01T00:00:00.000Z",
    targetType: "customer",
    targetId: customer.id,
    phoneId: "customer-phone:c_switch",
    maskedNumber: "2333",
    result: "allowed",
    reason: "",
    jobId: "job-switch-http"
  } satisfies OutboundCallAudit);
  store.outboundCallRecords.push(record({
    id: "ocr_switch_http",
    targetType: "customer",
    targetId: customer.id,
    outboundCallAuditId: "oca_switch_http",
    maskedNumber: "2333",
    establishedTimeRaw: "",
    contactDisposition: "Success"
  }));
  store.customers.push({
    ...customer,
    id: "c_switch_asia",
    company: "Asia Switch Co",
    teamId: "asia",
    ownerId: "u_switch_asia",
    phone: "+85291110000",
    poolStatus: "owned",
    nextReminder: "asia-reminder"
  });
  store.prospectContactChannels.push({
    id: "ch-switch-a",
    teamId: "europe",
    ownerId: shirleyUser.id,
    prospectId: "tp-switch",
    organizationId: "",
    contactId: "",
    channelType: "phone",
    value: "+46111222333",
    normalizedValueHash: "",
    sourceEvidenceId: "",
    acquiredAt: "",
    idempotencyKeyHash: "",
    requestHash: "",
    recordHash: "",
    createdAt: "2026-11-01T00:00:00.000Z"
  } satisfies ProspectContactChannel, {
    id: "ch-switch-b",
    teamId: "europe",
    ownerId: shirleyUser.id,
    prospectId: "tp-switch",
    organizationId: "",
    contactId: "",
    channelType: "phone",
    value: "+46700999888",
    normalizedValueHash: "",
    sourceEvidenceId: "",
    acquiredAt: "",
    idempotencyKeyHash: "",
    requestHash: "",
    recordHash: "",
    createdAt: "2026-11-01T00:00:00.000Z"
  } satisfies ProspectContactChannel);
  store.websiteOpportunities.push({
    id: "cand-switch",
    company: "Switch Buyer",
    business: "",
    country: "瑞典",
    website: "",
    contact: "",
    contactInfo: "",
    description: "",
    ownerId: shirleyUser.id,
    teamId: "europe",
    status: "preview",
    createdAt: "2026-11-01T00:00:00.000Z",
    tenantProspectId: "tp-switch"
  } satisfies WebsiteOpportunity);
  store.outboundCallAudits.push({
    id: "oca_switch_prospect",
    teamId: "europe",
    actorId: shirleyUser.id,
    at: "2026-11-01T00:00:00.000Z",
    targetType: "prospect",
    targetId: "cand-switch",
    phoneId: "ch-switch-a",
    maskedNumber: "2333",
    result: "allowed",
    reason: "",
    jobId: "job-switch-prospect"
  });
  store.outboundCallRecords.push(record({
    id: "ocr_switch_prospect",
    targetType: "prospect",
    targetId: "cand-switch",
    outboundCallAuditId: "oca_switch_prospect"
  }));

  store.sameDayCallSkips.push({
    id: "sdcs_switch_keep",
    teamId: "europe",
    targetType: "customer",
    targetId: customer.id,
    skipOn: "2026-11-04",
    resumeOn: "2026-11-20",
    reason: "asked_later",
    note: "保持恢复日",
    active: true,
    actorId: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z"
  });
  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions);
  const leadsBefore = store.leads.length;
  const skipsBefore = JSON.stringify(store.sameDayCallSkips.map((item) => ({
    id: item.id,
    targetId: item.targetId,
    skipOn: item.skipOn,
    resumeOn: item.resumeOn || "",
    active: item.active
  })));
  const callAuditsBefore = store.outboundCallAudits.length;
  const outcomeBefore = store.outboundCallRecords.find((item) => item.id === "ocr_switch_http")?.callOutcome;
  const establishedBefore = store.outboundCallRecords.find((item) => item.id === "ocr_switch_http")?.establishedTimeRaw;

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const noUpdate = await login("no-switch-update@keduoduo.com");
  const asia = await login("asia-switch@keduoduo.com");

  const anonymous = await request("/api/preferred-phones/switch-after-miss", "", "POST", {
    targetType: "customer",
    targetId: customer.id
  });
  assert.equal(anonymous.response.status, 401);

  const batch = await request("/api/preferred-phones/switch-after-miss", shirley, "POST", {
    targetType: "customer",
    targetId: customer.id,
    targets: [customer.id]
  });
  assert.equal(batch.response.status, 400);
  assert.equal(batch.json.reason, "invalid_request");
  assert.equal(store.preferredPhoneAudits.some((item) => item.reason === "invalid_request"), false);

  const switched = await request("/api/preferred-phones/switch-after-miss", shirley, "POST", {
    targetType: "customer",
    targetId: customer.id
  });
  assert.equal(switched.response.status, 200, JSON.stringify(switched.json));
  assert.equal(switched.json.result, "updated");
  assert.equal(switched.json.phoneId, "contact-phone:switch-extra");
  assert.equal(switched.json.callRecordId, "ocr_switch_http");
  assert.equal(JSON.stringify(switched.json).includes("+46111222333"), false);
  assert.equal(JSON.stringify(switched.json).includes("secret.example"), false);
  assert.equal(JSON.stringify(switched.json).includes("纪要不要出现"), false);
  const saved = store.preferredPhoneAudits.find((item) => item.reason === "missed_alternate" && item.targetId === customer.id);
  assert.ok(saved);
  assert.equal(saved.actorId, shirleyUser.id);
  assert.equal(saved.previousPhoneId, "");
  assert.equal(saved.nextPhoneId, "contact-phone:switch-extra");
  assert.equal(JSON.stringify(saved).includes("+46700999888"), false);

  const same = await request("/api/preferred-phones/switch-after-miss", shirley, "POST", {
    targetType: "customer",
    targetId: customer.id
  });
  assert.equal(same.response.status, 200);
  assert.equal(same.json.result, "unchanged");
  assert.equal(store.preferredPhoneAudits.filter((item) => item.reason === "missed_alternate" && item.targetId === customer.id).length, 1);

  const denied = await request("/api/preferred-phones/switch-after-miss", mia, "POST", {
    targetType: "customer",
    targetId: customer.id
  });
  assert.equal(denied.response.status, 403);
  assert.equal(store.preferredPhones.find((item) => item.targetId === customer.id)?.phoneId, "contact-phone:switch-extra");

  const noPerm = await request("/api/preferred-phones/switch-after-miss", noUpdate, "POST", {
    targetType: "customer",
    targetId: customer.id
  });
  assert.equal(noPerm.response.status, 403);

  const pooledResult = await request("/api/preferred-phones/switch-after-miss", shirley, "POST", {
    targetType: "customer",
    targetId: pooled.id
  });
  assert.equal(pooledResult.response.status, 409);
  assert.equal(pooledResult.json.reason, "public_pool");

  const foreign = await request("/api/preferred-phones/switch-after-miss", shirley, "POST", {
    targetType: "customer",
    targetId: "c_switch_asia"
  });
  assert.equal(foreign.response.status, 404);
  assert.equal(store.preferredPhones.some((item) => item.targetId === "c_switch_asia"), false);

  const asiaOwn = await request("/api/preferred-phones/switch-after-miss", asia, "POST", {
    targetType: "customer",
    targetId: "c_switch_asia"
  });
  assert.equal(asiaOwn.response.status, 400);
  assert.equal(asiaOwn.json.reason, "no_call");

  const prospect = await request("/api/preferred-phones/switch-after-miss", shirley, "POST", {
    targetType: "prospect",
    targetId: "cand-switch"
  });
  assert.equal(prospect.response.status, 200, JSON.stringify(prospect.json));
  assert.equal(prospect.json.phoneId, "ch-switch-b");
  const prospectRow = store.websiteOpportunities.find((item) => item.id === "cand-switch");
  assert.equal(prospectRow?.status, "preview");

  assert.equal(calls.length, 0);
  assert.equal(aliyunHits, 0);
  assert.equal(customer.phone, "+46111222333");
  assert.equal(customer.nextReminder, "keep-switch");
  assert.equal(store.preferredPhones.find((item) => item.targetId === pooled.id)?.phoneId || "", pooledPreferred);
  assert.equal(store.customers.find((item) => item.id === pooled.id)?.nextReminder, "pool-switch");
  assert.equal(store.customers.find((item) => item.id === pooled.id)?.poolStatus, "public");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_switch_http")?.callOutcome, outcomeBefore);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_switch_http")?.establishedTimeRaw, establishedBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(JSON.stringify(store.sameDayCallSkips.map((item) => ({
    id: item.id,
    targetId: item.targetId,
    skipOn: item.skipOn,
    resumeOn: item.resumeOn || "",
    active: item.active
  }))), skipsBefore);
  assert.equal(store.sameDayCallSkips.find((item) => item.id === "sdcs_switch_keep")?.resumeOn, "2026-11-20");
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(store.leads.length, leadsBefore);

  console.log("missed number switch http tests passed");
} finally {
  setOutboundDialerForTests(null);
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
