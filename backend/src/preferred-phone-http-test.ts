import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { customerPhoneId, setOutboundDialerForTests } from "./outbound-call.js";
import type { MakeCallParams } from "./aliyun-ccc-make-call.js";
import type { ProspectContactChannel, WebsiteOpportunity } from "./types.js";

const phone = "+46111222333";
const phoneA = "+46555000111";
const phoneB = "+46555000222";
const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start preferred phone test server");
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
    return { jobId: "job-preferred-phone", callType: "OUTBOUND" };
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

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  assert.ok(shirleyUser && miaUser);
  store.users.push({
    ...shirleyUser,
    id: "u_pref_no_update",
    name: "No Preferred Update",
    email: "no-preferred-update@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_pref_asia",
    name: "Asia Preferred",
    email: "asia-preferred@keduoduo.com",
    role: "sales",
    teamId: "asia",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_pref_no_update") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["customer.update"];
    return { ...snapshot, permissions };
  };

  const customer = store.customers.find((item) => item.id === "c1");
  const pooled = store.customers.find((item) => item.id === "c2");
  const lead = store.leads.find((item) => item.id === "l1");
  assert.ok(customer && pooled && lead);
  const phoneBefore = customer.phone;
  const poolBefore = pooled.poolStatus;
  customer.phone = phone;
  pooled.phone = "+46111000022";
  store.customers.push({
    ...customer,
    id: "c_pref_asia",
    company: "Asia Preferred Co",
    teamId: "asia",
    ownerId: "u_pref_asia",
    phone: "+85291110000",
    poolStatus: "owned"
  });

  const channelA: ProspectContactChannel = {
    id: "ch-pref-a",
    teamId: "europe",
    ownerId: shirleyUser.id,
    prospectId: "tp-preferred",
    organizationId: "",
    contactId: "",
    channelType: "phone",
    value: phoneA,
    normalizedValueHash: "",
    sourceEvidenceId: "",
    acquiredAt: "",
    idempotencyKeyHash: "",
    requestHash: "",
    recordHash: "",
    createdAt: "2026-11-01T00:00:00.000Z"
  };
  const channelB: ProspectContactChannel = { ...channelA, id: "ch-pref-b", value: phoneB };
  store.prospectContactChannels.push(channelA, channelB);
  store.websiteOpportunities.push({
    id: "cand-preferred",
    company: "Preferred Buyer",
    business: "",
    country: "瑞典",
    website: "",
    contact: "",
    contactInfo: "",
    description: "",
    ownerId: shirleyUser.id,
    teamId: "europe",
    status: "contactable",
    createdAt: "2026-11-01T00:00:00.000Z",
    tenantProspectId: "tp-preferred"
  } satisfies WebsiteOpportunity);

  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions);
  const leadsBefore = store.leads.length;
  const activitiesBefore = store.customerActivities.length;
  const auditsBefore = store.outboundCallAudits.length;
  const enabledBefore = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled === true;

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const noUpdate = await login("no-preferred-update@keduoduo.com");
  const asia = await login("asia-preferred@keduoduo.com");

  const batch = await request("/api/preferred-phones", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId: customerPhoneId("c1"),
    phoneIds: [customerPhoneId("c1")]
  });
  assert.equal(batch.response.status, 400);
  assert.equal(store.preferredPhoneAudits.length, 0);
  assert.equal(store.preferredPhones.length, 0);

  const missing = await request("/api/preferred-phones", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId: "customer-phone:missing"
  });
  assert.equal(missing.response.status, 400);
  assert.equal(missing.json.reason, "unknown_phone");
  assert.equal(store.preferredPhones.length, 0);
  assert.equal(store.preferredPhoneAudits[0]?.result, "rejected");
  assert.equal(store.preferredPhoneAudits[0]?.reason, "unknown_phone");
  assert.equal(JSON.stringify(missing.json).includes(phone), false);

  const set = await request("/api/preferred-phones", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId: customerPhoneId("c1")
  });
  assert.equal(set.response.status, 200);
  assert.equal(set.json.result, "updated");
  assert.equal(set.json.action, "set");
  assert.equal(set.json.previousPhoneId, "");
  assert.equal(set.json.phoneId, customerPhoneId("c1"));
  assert.equal(JSON.stringify(set.json).includes(phone), false);
  const created = store.preferredPhoneAudits.find((item) => item.targetId === "c1" && item.result === "updated");
  assert.ok(created);
  assert.equal(created.actorId, shirleyUser.id);
  assert.equal(created.teamId, "europe");
  assert.equal(created.reason, "set");
  assert.equal(created.previousPhoneId, "");
  assert.equal(created.nextPhoneId, customerPhoneId("c1"));
  assert.equal(JSON.stringify(created).includes(phone), false);
  assert.equal(store.preferredPhones.filter((item) => item.targetId === "c1").length, 1);

  const same = await request("/api/preferred-phones", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId: customerPhoneId("c1")
  });
  assert.equal(same.response.status, 200);
  assert.equal(same.json.result, "unchanged");
  assert.equal(store.preferredPhoneAudits.filter((item) => item.targetId === "c1" && item.result === "updated").length, 1);

  const denied = await request("/api/preferred-phones", mia, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId: customerPhoneId("c1")
  });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.reason, "forbidden");
  assert.equal(store.preferredPhones.find((item) => item.targetId === "c1")?.phoneId, customerPhoneId("c1"));
  const deniedAudit = store.preferredPhoneAudits.find((item) => item.actorId === miaUser.id && item.targetId === "c1");
  assert.ok(deniedAudit);
  assert.equal(deniedAudit.result, "rejected");
  assert.equal(deniedAudit.reason, "forbidden");
  assert.equal(deniedAudit.previousPhoneId, customerPhoneId("c1"));

  const noPerm = await request("/api/preferred-phones", noUpdate, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId: customerPhoneId("c1")
  });
  assert.equal(noPerm.response.status, 403);
  assert.equal(store.preferredPhoneAudits.some((item) => item.actorId === "u_pref_no_update" && item.reason === "forbidden"), true);
  assert.equal(store.preferredPhones.find((item) => item.targetId === "c1")?.updatedBy, shirleyUser.id);

  pooled.poolStatus = "public";
  const pooledSet = await request("/api/preferred-phones", shirley, "POST", {
    targetType: "customer",
    targetId: "c2",
    phoneId: customerPhoneId("c2")
  });
  assert.equal(pooledSet.response.status, 409);
  assert.equal(pooledSet.json.reason, "public_pool");
  assert.equal(store.preferredPhones.some((item) => item.targetId === "c2"), false);
  assert.equal(store.preferredPhoneAudits.some((item) => item.targetId === "c2" && item.reason === "public_pool"), true);
  pooled.poolStatus = poolBefore;

  const foreign = await request("/api/preferred-phones", shirley, "POST", {
    targetType: "customer",
    targetId: "c_pref_asia",
    phoneId: customerPhoneId("c_pref_asia")
  });
  assert.equal(foreign.response.status, 404);
  assert.equal(store.preferredPhones.some((item) => item.targetId === "c_pref_asia"), false);
  assert.equal(store.preferredPhoneAudits.some((item) => item.actorId === shirleyUser.id && item.targetId === "c_pref_asia" && item.reason === "not_found"), true);
  const asiaSet = await request("/api/preferred-phones", asia, "POST", {
    targetType: "customer",
    targetId: "c_pref_asia",
    phoneId: customerPhoneId("c_pref_asia")
  });
  assert.equal(asiaSet.response.status, 200);
  assert.equal(store.preferredPhones.find((item) => item.targetId === "c_pref_asia")?.teamId, "asia");
  assert.equal(store.preferredPhones.find((item) => item.targetId === "c1")?.teamId, "europe");

  const leadSet = await request("/api/preferred-phones", shirley, "POST", {
    targetType: "lead",
    targetId: "l1",
    phoneId: "lead-phone:l1"
  });
  assert.equal(leadSet.response.status, 200);
  assert.equal(leadSet.json.action, "set");
  const leadClear = await request("/api/preferred-phones/clear", shirley, "POST", {
    targetType: "lead",
    targetId: "l1"
  });
  assert.equal(leadClear.response.status, 200);
  assert.equal(leadClear.json.action, "clear");
  assert.equal(leadClear.json.phoneId, "");
  assert.equal(store.preferredPhones.some((item) => item.targetId === "l1"), false);
  const leadClearAudit = store.preferredPhoneAudits.find((item) => item.targetId === "l1" && item.action === "clear" && item.result === "updated");
  assert.ok(leadClearAudit);
  assert.equal(leadClearAudit.previousPhoneId, "lead-phone:l1");
  assert.equal(leadClearAudit.nextPhoneId, "");
  assert.equal(leadClearAudit.reason, "clear");
  const leadClearAgain = await request("/api/preferred-phones/clear", shirley, "POST", {
    targetType: "lead",
    targetId: "l1"
  });
  assert.equal(leadClearAgain.response.status, 200);
  assert.equal(leadClearAgain.json.result, "unchanged");
  assert.equal(store.preferredPhoneAudits.filter((item) => item.targetId === "l1" && item.action === "clear" && item.result === "updated").length, 1);

  const prospectSet = await request("/api/preferred-phones", shirley, "POST", {
    targetType: "prospect",
    targetId: "cand-preferred",
    phoneId: "ch-pref-a"
  });
  assert.equal(prospectSet.response.status, 200);
  assert.equal(prospectSet.json.action, "set");
  const prospectSame = await request("/api/preferred-phones", shirley, "POST", {
    targetType: "prospect",
    targetId: "cand-preferred",
    phoneId: "ch-pref-a"
  });
  assert.equal(prospectSame.json.result, "unchanged");
  const prospectChange = await request("/api/preferred-phones", shirley, "POST", {
    targetType: "prospect",
    targetId: "cand-preferred",
    phoneId: "ch-pref-b"
  });
  assert.equal(prospectChange.response.status, 200);
  assert.equal(prospectChange.json.action, "update");
  assert.equal(prospectChange.json.previousPhoneId, "ch-pref-a");
  assert.equal(prospectChange.json.phoneId, "ch-pref-b");
  assert.equal(store.preferredPhones.filter((item) => item.targetId === "cand-preferred").length, 1);
  const miaProspect = await request("/api/preferred-phones", mia, "POST", {
    targetType: "prospect",
    targetId: "cand-preferred",
    phoneId: "ch-pref-a"
  });
  assert.equal(miaProspect.response.status, 403);
  assert.equal(store.preferredPhones.find((item) => item.targetId === "cand-preferred")?.phoneId, "ch-pref-b");

  const view = await request("/api/preferred-phones?targetType=prospect&targetId=cand-preferred", shirley);
  assert.equal(view.response.status, 200);
  assert.equal(view.json.phoneId, "ch-pref-b");
  assert.equal(view.json.phones.find((item: { phoneId: string }) => item.phoneId === "ch-pref-b")?.preferred, true);
  assert.equal(JSON.stringify(view.json).includes(phoneA), false);
  assert.equal(JSON.stringify(view.json).includes(phoneB), false);
  const list = await request("/api/preferred-phones", shirley);
  assert.equal(list.json.items.some((item: { targetId: string; phoneId: string }) => item.targetId === "cand-preferred" && item.phoneId === "ch-pref-b"), true);
  assert.equal(JSON.stringify(list.json).includes(phoneB), false);
  const miaList = await request("/api/preferred-phones", mia);
  assert.equal(miaList.json.items.some((item: { targetId: string }) => item.targetId === "c1" || item.targetId === "cand-preferred"), false);

  const marked = await request("/api/phone-validity", shirley, "POST", {
    targetType: "prospect",
    targetId: "cand-preferred",
    phoneId: "ch-pref-a",
    invalid: true
  });
  assert.equal(marked.response.status, 200);
  const rejected = await request("/api/preferred-phones", shirley, "POST", {
    targetType: "prospect",
    targetId: "cand-preferred",
    phoneId: "ch-pref-a"
  });
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.json.reason, "invalid_number");
  assert.equal(store.preferredPhones.find((item) => item.targetId === "cand-preferred")?.phoneId, "ch-pref-b");
  assert.equal(store.preferredPhoneAudits.some((item) => item.phoneId === "ch-pref-a" || item.nextPhoneId === "ch-pref-a" && item.reason === "invalid_number"), true);

  const invalidate = await request("/api/phone-validity", shirley, "POST", {
    targetType: "prospect",
    targetId: "cand-preferred",
    phoneId: "ch-pref-b",
    invalid: true
  });
  assert.equal(invalidate.response.status, 200);
  assert.equal(store.preferredPhones.some((item) => item.targetId === "cand-preferred"), false);
  const auto = store.preferredPhoneAudits.find((item) => item.targetId === "cand-preferred" && item.reason === "marked_invalid");
  assert.ok(auto);
  assert.equal(auto.action, "clear");
  assert.equal(auto.previousPhoneId, "ch-pref-b");
  assert.equal(auto.nextPhoneId, "");
  assert.equal(auto.actorId, shirleyUser.id);
  assert.equal(JSON.stringify(auto).includes(phoneB), false);

  const restored = await request("/api/phone-validity", shirley, "POST", {
    targetType: "prospect",
    targetId: "cand-preferred",
    phoneId: "ch-pref-b",
    invalid: false
  });
  assert.equal(restored.response.status, 200);
  assert.equal(store.preferredPhones.some((item) => item.targetId === "cand-preferred"), false);

  const prospectClear = await request("/api/preferred-phones/clear", shirley, "POST", {
    targetType: "prospect",
    targetId: "cand-preferred"
  });
  assert.equal(prospectClear.json.result, "unchanged");

  assert.equal(calls.length, 0);
  assert.equal(store.outboundCallAudits.length, auditsBefore);
  assert.equal(aliyunHits, 0);
  assert.equal(store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled === true, enabledBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(customer.phone, phone);

  customer.phone = phoneBefore;
  pooled.poolStatus = poolBefore;
  console.log("preferred phone http tests passed");
} finally {
  setOutboundDialerForTests(undefined);
  globalThis.fetch = originalFetch;
  server.close();
}
