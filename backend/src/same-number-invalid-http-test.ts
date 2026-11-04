import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundDialerForTests } from "./outbound-call.js";
import type { MakeCallParams } from "./aliyun-ccc-make-call.js";
import type { ContactPhone, PreferredPhone } from "./types.js";

const phone = "+46701119991";
const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start same-number test server");
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
    return { jobId: "job-same-number", callType: "OUTBOUND" };
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
  const shirley = await login("shirley@keduoduo.com");
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const customer = store.customers.find((item) => item.id === "c1");
  assert.ok(shirleyUser && customer);
  const phoneBefore = customer.phone;
  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions);
  const leadsBefore = store.leads.length;
  const enabledBefore = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled;
  customer.phone = phone;
  const sibling = {
    ...customer,
    id: "c_same_number",
    company: "Sibling Same",
    phone: "46 70 111 9991",
    ownerId: customer.ownerId,
    poolStatus: "private" as const
  };
  const pooled = {
    ...customer,
    id: "c_same_pool",
    company: "Pool Twin",
    phone,
    ownerId: customer.ownerId,
    poolStatus: "public" as const
  };
  const abroad = {
    ...customer,
    id: "c_same_asia",
    company: "Asia Twin",
    phone,
    teamId: "asia",
    ownerId: "u_same_asia",
    poolStatus: "private" as const
  };
  store.customers.push(sibling, pooled, abroad);
  const extra: ContactPhone = {
    id: "cph_same_extra",
    teamId: customer.teamId,
    targetType: "customer",
    targetId: sibling.id,
    phoneId: "c_same_extra",
    label: "mobile",
    phone: "+46700007771",
    phoneDigits: "46700007771",
    origin: "extra",
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z"
  };
  store.contactPhones.push(extra);
  const preferred: PreferredPhone = {
    id: "pph_same_sibling",
    teamId: customer.teamId,
    targetType: "customer",
    targetId: sibling.id,
    phoneId: "customer-phone:c_same_number",
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z"
  };
  store.preferredPhones.push(preferred);

  const anonymous = await request("/api/phone-validity/same-number?targetType=customer&targetId=c1&phoneId=customer-phone:c1", "");
  assert.equal(anonymous.response.status, 401);
  const invalidBody = await request("/api/phone-validity/same-number", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId: "customer-phone:c1",
    targets: []
  });
  assert.equal(invalidBody.response.status, 400);
  assert.equal(store.phoneValidityAudits.some((item) => item.phoneId === "customer-phone:c_same_number"), false);

  const marked = await request("/api/phone-validity", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId: "customer-phone:c1",
    invalid: true
  });
  assert.equal(marked.response.status, 200);
  assert.equal(store.phoneValidities.some((item) => item.phoneId === "customer-phone:c_same_number"), false);
  assert.equal(store.phoneValidityAudits.filter((item) => item.phoneId === "customer-phone:c1").every((item) => !item.batchId), true);

  const params = new URLSearchParams({
    targetType: "customer",
    targetId: "c1",
    phoneId: "customer-phone:c1"
  });
  const preview = await request(`/api/phone-validity/same-number?${params.toString()}`, shirley);
  assert.equal(preview.response.status, 200);
  assert.equal(preview.json.count >= 1, true);
  const ids = (preview.json.targets || []).map((item: { targetId?: string }) => item.targetId);
  assert.equal(ids.includes("c_same_number"), true);
  assert.equal(ids.includes("c_same_pool"), false);
  assert.equal(ids.includes("c_same_asia"), false);
  assert.equal(JSON.stringify(preview.json).includes(phone), false);
  assert.equal(JSON.stringify(preview.json).includes("Asia Twin"), false);
  assert.equal(JSON.stringify(preview.json).includes("Pool Twin"), false);

  const linked = await request("/api/phone-validity/same-number", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId: "customer-phone:c1"
  });
  assert.equal(linked.response.status, 200);
  assert.equal(linked.json.result, "updated");
  assert.equal(String(linked.json.batchId).startsWith("pvb_"), true);
  assert.equal(store.phoneValidities.some((item) => item.teamId === customer.teamId && item.phoneId === "customer-phone:c_same_number"), true);
  assert.equal(store.phoneValidities.some((item) => item.phoneId === "customer-phone:c_same_pool"), false);
  assert.equal(store.phoneValidities.some((item) => item.phoneId === "customer-phone:c_same_asia"), false);
  const batchAudits = store.phoneValidityAudits.filter((item) => item.batchId === linked.json.batchId);
  assert.equal(batchAudits.length >= 1, true);
  assert.equal(batchAudits.every((item) => item.previousValue === "valid" && item.nextValue === "invalid"), true);
  assert.equal(JSON.stringify(batchAudits).includes(phone), false);
  assert.equal(JSON.stringify(linked.json).includes(phone), false);
  const switched = store.preferredPhoneAudits.find((item) => item.targetId === "c_same_number");
  assert.equal(switched?.reason, "wrong_number_alternate");
  assert.equal(switched?.nextPhoneId, "c_same_extra");
  assert.equal(store.preferredPhones.find((item) => item.targetId === "c_same_number")?.phoneId, "c_same_extra");
  assert.equal(calls.length, 0);

  const again = await request("/api/phone-validity/same-number", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId: "customer-phone:c1"
  });
  assert.equal(again.response.status, 200);
  assert.equal(again.json.result, "unchanged");
  assert.equal(again.json.batchId, "");
  assert.equal(store.phoneValidityAudits.filter((item) => item.batchId === linked.json.batchId).length, batchAudits.length);

  assert.equal(store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled, enabledBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(aliyunHits, 0);
  assert.equal(calls.length, 0);
  customer.phone = phoneBefore;
  console.log("same number invalid http tests passed");
} finally {
  setOutboundDialerForTests(undefined);
  globalThis.fetch = originalFetch;
  server.close();
}
