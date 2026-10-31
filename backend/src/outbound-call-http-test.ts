import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { encryptAliyunOutboundSecret } from "./credential-security.js";
import {
  customerPhoneId,
  setOutboundDialerForTests,
  type OutboundTargetType
} from "./outbound-call.js";
import { CCC_MAKE_CALL_DEVICE_ID, type MakeCallParams } from "./aliyun-ccc-make-call.js";
import type { ProspectContactChannel, WebsiteOpportunity } from "./types.js";

const secret = "SkSecretValue9999wxyz";
const accessKeyId = "LTAI12345678wxyz";
const phone = "+46111222333";
const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start outbound call test server");
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
    return { jobId: "job-mock-outbound-1", callType: "OUTBOUND" };
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

function dialBody(targetType: OutboundTargetType, targetId: string, phoneId: string) {
  return { targetType, targetId, phoneId };
}

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  assert.ok(shirleyUser);
  store.users.push({
    ...shirleyUser,
    id: "u_no_outbound",
    name: "No Outbound",
    email: "no-outbound@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_no_outbound") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.send"];
    return { ...snapshot, permissions };
  };
  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const noOutbound = await login("no-outbound@keduoduo.com");

  const customer = store.customers.find((item) => item.id === "c1");
  assert.ok(customer);
  assert.equal(customer.ownerId, shirleyUser.id);
  const phoneBefore = customer.phone;
  customer.phone = phone;

  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const leadsBefore = store.leads.length;
  const customerActivitiesBefore = store.customerActivities.length;
  const leadActivitiesBefore = store.leadActivities.length;
  const auditsBefore = store.outboundCallAudits.length;

  const putConfig = (enabled: boolean, instanceId: string) => {
    const next = {
      teamId: "europe",
      aliyunOutboundEnabled: enabled,
      instanceId,
      region: "cn-shanghai",
      callerNumber: "02100001111",
      accessKeyIdEncrypted: encryptAliyunOutboundSecret("europe", "accessKeyId", accessKeyId),
      accessKeySecretEncrypted: encryptAliyunOutboundSecret("europe", "accessKeySecret", secret),
      callbackPathTokenEncrypted: "",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    };
    const existing = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe");
    if (existing) Object.assign(existing, next);
    else store.aliyunOutboundConfigs.push(next);
  };

  const customerBody = dialBody("customer", "c1", customerPhoneId("c1"));

  putConfig(false, "ccc-demo");
  const disabled = await request("/api/outbound-calls", shirley, "POST", customerBody);
  assert.equal(disabled.response.status, 403);
  assert.equal(disabled.json.result, "rejected");
  assert.equal(disabled.json.reason, "disabled");
  assert.match(String(disabled.json.message), /未开启/);
  assert.equal(calls.length, 0);
  assert.equal(store.outboundCallAudits[0]?.reason, "disabled");
  assert.equal(store.outboundCallAudits[0]?.actorId, shirleyUser.id);
  assert.equal(store.outboundCallAudits[0]?.targetType, "customer");
  assert.equal(store.outboundCallAudits[0]?.targetId, "c1");
  assert.equal(store.outboundCallAudits[0]?.maskedNumber, "*******2333");
  assert.equal(store.outboundCallAudits[0]?.result, "rejected");
  assert.equal(JSON.stringify(disabled.json).includes(phone), false);
  assert.equal(JSON.stringify(store.outboundCallAudits[0]).includes(phone), false);

  putConfig(true, "");
  const incomplete = await request("/api/outbound-calls", shirley, "POST", customerBody);
  assert.equal(incomplete.response.status, 409);
  assert.equal(incomplete.json.reason, "config_incomplete");
  assert.equal(calls.length, 0);
  assert.equal(store.outboundCallAudits[0]?.reason, "config_incomplete");
  assert.equal(store.outboundCallAudits[0]?.result, "rejected");
  assert.equal(JSON.stringify(incomplete.json).includes(secret), false);
  assert.equal(JSON.stringify(store.outboundCallAudits[0]).includes(secret), false);
  assert.equal(JSON.stringify(store.outboundCallAudits[0]).includes(accessKeyId), false);

  putConfig(true, "ccc-demo");
  const forbidden = await request("/api/outbound-calls", noOutbound, "POST", customerBody);
  assert.equal(forbidden.response.status, 403);
  assert.equal(forbidden.json.reason, "forbidden");
  assert.match(String(forbidden.json.message), /没有外呼权限/);
  assert.equal(calls.length, 0);
  assert.equal(store.outboundCallAudits[0]?.reason, "forbidden");
  assert.equal(store.outboundCallAudits[0]?.result, "rejected");
  assert.equal(store.outboundCallAudits[0]?.maskedNumber, "");
  assert.equal(JSON.stringify(forbidden.json).includes(phone), false);

  const otherOwner = await request("/api/outbound-calls", mia, "POST", customerBody);
  assert.equal(otherOwner.response.status, 403);
  assert.equal(otherOwner.json.reason, "forbidden");
  assert.equal(calls.length, 0);
  assert.equal(store.outboundCallAudits[0]?.reason, "forbidden");
  assert.equal(store.outboundCallAudits[0]?.actorId, "u_sales_mia");
  assert.equal(store.outboundCallAudits[0]?.maskedNumber, "");

  const allowed = await request("/api/outbound-calls", shirley, "POST", customerBody);
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.json.result, "allowed");
  assert.equal(allowed.json.jobId, "job-mock-outbound-1");
  assert.equal(allowed.json.reason, "");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].InstanceId, "ccc-demo");
  assert.equal(calls[0].DeviceId, CCC_MAKE_CALL_DEVICE_ID);
  assert.equal(calls[0].Callee, phone);
  assert.equal(calls[0].Caller, "02100001111");
  assert.equal(calls[0].MaskedCallee, "*******2333");
  assert.equal(calls[0].UserId, undefined);
  assert.equal(JSON.stringify(allowed.json).includes(phone), false);
  assert.equal(JSON.stringify(allowed.json).includes(secret), false);
  assert.equal(store.outboundCallAudits[0]?.result, "allowed");
  assert.equal(store.outboundCallAudits[0]?.reason, "");
  assert.equal(store.outboundCallAudits[0]?.jobId, "job-mock-outbound-1");
  assert.equal(store.outboundCallAudits[0]?.actorId, shirleyUser.id);
  assert.equal(store.outboundCallAudits[0]?.maskedNumber, "*******2333");
  assert.equal(JSON.stringify(store.outboundCallAudits[0]).includes(phone), false);
  assert.equal(JSON.stringify(store.outboundCallAudits[0]).includes(secret), false);

  store.websiteOpportunities.push({
    id: "cand-outbound-suppressed",
    company: "Suppressed Buyer",
    business: "",
    country: "瑞典",
    website: "",
    contact: "",
    contactInfo: "",
    description: "",
    ownerId: shirleyUser.id,
    teamId: "europe",
    status: "excluded",
    createdAt: "2026-10-31T00:00:00.000Z",
    customerId: "c1",
    outreachState: "suppressed"
  });
  const suppressed = await request("/api/outbound-calls", shirley, "POST", customerBody);
  assert.equal(suppressed.response.status, 409);
  assert.equal(suppressed.json.reason, "suppressed");
  assert.equal(calls.length, 1);
  assert.equal(store.outboundCallAudits[0]?.reason, "suppressed");
  assert.equal(store.outboundCallAudits[0]?.result, "rejected");
  assert.equal(store.outboundCallAudits[0]?.maskedNumber, "*******2333");
  assert.equal(store.websiteOpportunities.find((item) => item.id === "cand-outbound-suppressed")?.outreachState, "suppressed");

  const channel: ProspectContactChannel = {
    id: "ch-outbound-phone",
    teamId: "europe",
    ownerId: shirleyUser.id,
    prospectId: "tp-outbound-1",
    organizationId: "",
    contactId: "",
    channelType: "phone",
    value: "+46555000111",
    normalizedValueHash: "",
    sourceEvidenceId: "",
    acquiredAt: "",
    idempotencyKeyHash: "",
    requestHash: "",
    recordHash: "",
    createdAt: "2026-10-31T00:00:00.000Z"
  };
  store.prospectContactChannels.push(channel);
  store.websiteOpportunities.push({
    id: "cand-outbound-open",
    company: "Open Buyer",
    business: "",
    country: "瑞典",
    website: "",
    contact: "",
    contactInfo: "",
    description: "",
    ownerId: shirleyUser.id,
    teamId: "europe",
    status: "contactable",
    createdAt: "2026-10-31T00:00:00.000Z",
    tenantProspectId: "tp-outbound-1"
  } satisfies WebsiteOpportunity);
  const notContactable = await request("/api/outbound-calls", shirley, "POST", dialBody("prospect", "cand-outbound-open", channel.id));
  assert.equal(notContactable.response.status, 409);
  assert.equal(notContactable.json.reason, "not_contactable");
  assert.equal(calls.length, 1);
  assert.equal(store.outboundCallAudits[0]?.reason, "not_contactable");
  assert.equal(store.outboundCallAudits[0]?.targetType, "prospect");
  assert.equal(store.outboundCallAudits[0]?.targetId, "cand-outbound-open");
  assert.equal(store.outboundCallAudits[0]?.result, "rejected");
  assert.equal(store.outboundCallAudits[0]?.maskedNumber, "*******0111");
  assert.equal(JSON.stringify(store.outboundCallAudits[0]).includes("+46555000111"), false);

  const batch = await request("/api/outbound-calls", shirley, "POST", [customerBody, customerBody]);
  assert.equal(batch.response.status, 400);
  assert.equal(batch.json.reason, "invalid_request");
  assert.equal(calls.length, 1);
  assert.equal(store.outboundCallAudits[0]?.reason, "invalid_request");

  const namedBatch = await request("/api/outbound-calls", shirley, "POST", { targets: [customerBody] });
  assert.equal(namedBatch.response.status, 400);
  assert.equal(namedBatch.json.reason, "invalid_request");
  assert.equal(calls.length, 1);

  const missingPhone = await request("/api/outbound-calls", shirley, "POST", dialBody("customer", "c1", "customer-phone:missing"));
  assert.equal(missingPhone.response.status, 404);
  assert.equal(missingPhone.json.reason, "not_found");
  assert.equal(calls.length, 1);
  assert.equal(store.outboundCallAudits[0]?.reason, "not_found");

  assert.equal(store.outboundCallAudits.length, auditsBefore + 10);
  assert.deepEqual(store.outboundCallAudits.slice(0, 10).map((item) => item.reason), [
    "not_found",
    "invalid_request",
    "invalid_request",
    "not_contactable",
    "suppressed",
    "",
    "forbidden",
    "forbidden",
    "config_incomplete",
    "disabled"
  ]);
  assert.equal(store.outboundCallAudits.slice(0, 10).every((item) => item.actorId), true);

  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.customerActivities.length, customerActivitiesBefore);
  assert.equal(store.leadActivities.length, leadActivitiesBefore);
  assert.equal(aliyunHits, 0);
  assert.equal(JSON.stringify(store.outboundCallAudits).includes(secret), false);
  assert.equal(JSON.stringify(store.outboundCallAudits).includes(accessKeyId), false);
  assert.equal(JSON.stringify(store.outboundCallAudits).includes(phone), false);

  customer.phone = phoneBefore;
  console.log("outbound call http tests passed");
} finally {
  setOutboundDialerForTests(undefined);
  globalThis.fetch = originalFetch;
  server.close();
}
