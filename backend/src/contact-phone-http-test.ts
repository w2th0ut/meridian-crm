import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { encryptAliyunOutboundSecret } from "./credential-security.js";
import { applyLegacyContactPhoneMigration } from "./contact-phone.js";
import { customerPhoneId, setOutboundDialerForTests } from "./outbound-call.js";
import type { MakeCallParams } from "./aliyun-ccc-make-call.js";

const secret = "SkSecretValue9999wxyz";
const accessKeyId = "LTAI12345678wxyz";
const phone = "+46111222333";
const extraPhone = "+46700001111";
const extraNext = "+46700002222";
const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start contact phone test server");
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
    return { jobId: "job-contact-phone", callType: "OUTBOUND" };
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
    id: "u_phone_no_update",
    name: "No Phone Update",
    email: "no-phone-update@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_phone_asia",
    name: "Asia Phone",
    email: "asia-phone@keduoduo.com",
    role: "sales",
    teamId: "asia",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_phone_no_update") return snapshot;
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
  store.customers.push({
    ...customer,
    id: "c_phone_asia",
    company: "Asia Phone Co",
    teamId: "asia",
    ownerId: "u_phone_asia",
    phone: "+85291110000",
    poolStatus: "owned"
  });

  const inserted = applyLegacyContactPhoneMigration(store);
  assert.ok(inserted > 0);
  assert.equal(customer.phone, phone);
  const legacy = store.contactPhones.filter((item) => item.teamId === "europe" && item.targetType === "customer" && item.targetId === "c1");
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0]?.phone, phone);
  assert.equal(legacy[0]?.phoneId, customerPhoneId("c1"));
  assert.equal(legacy[0]?.origin, "legacy");
  const afterFirst = store.contactPhones.length;
  assert.equal(applyLegacyContactPhoneMigration(store), 0);
  assert.equal(store.contactPhones.length, afterFirst);
  assert.equal(customer.phone, phone);

  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions);
  const leadsBefore = store.leads.length;
  const enabledBefore = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled === true;
  const configBefore = JSON.stringify(store.aliyunOutboundConfigs);

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const noUpdate = await login("no-phone-update@keduoduo.com");
  const asia = await login("asia-phone@keduoduo.com");

  const listed = await request("/api/contact-phones?targetType=customer&targetId=c1", shirley);
  assert.equal(listed.response.status, 200);
  const primary = (listed.json.phones || []).filter((item: { phoneId?: string }) => item.phoneId === customerPhoneId("c1"));
  assert.equal(primary.length, 1);
  assert.equal(primary[0]?.phone, phone);
  assert.equal(primary[0]?.label, "主号");
  assert.equal(primary[0]?.editable, false);
  assert.equal(store.contactPhones.length, afterFirst);

  const batch = await request("/api/contact-phones", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    label: "手机",
    phone: extraPhone,
    phones: [extraPhone]
  });
  assert.equal(batch.response.status, 400);
  assert.equal(store.contactPhoneAudits.length, 0);

  const badPhone = await request("/api/contact-phones", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    label: "手机",
    phone: "123"
  });
  assert.equal(badPhone.response.status, 400);
  assert.equal(badPhone.json.reason, "invalid_phone");
  assert.equal(store.contactPhoneAudits.length, 0);

  const duplicate = await request("/api/contact-phones", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    label: "座机",
    phone: "+46 111 222 333"
  });
  assert.equal(duplicate.response.status, 400);
  assert.equal(duplicate.json.reason, "duplicate_phone");
  assert.equal(store.contactPhoneAudits.length, 0);
  assert.equal(JSON.stringify(duplicate.json).includes(phone), false);

  const created = await request("/api/contact-phones", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    label: "手机",
    phone: extraPhone
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.json.result, "updated");
  assert.equal(created.json.action, "create");
  assert.equal(created.json.previousValue, "");
  assert.match(String(created.json.nextValue), /^手机\|/);
  assert.equal(JSON.stringify(created.json).includes(extraPhone), false);
  const phoneId = String(created.json.phoneId || "");
  assert.match(phoneId, /^contact-phone:/);
  const audit = store.contactPhoneAudits.find((item) => item.phoneId === phoneId && item.action === "create");
  assert.ok(audit);
  assert.equal(audit.actorId, shirleyUser.id);
  assert.equal(audit.teamId, "europe");
  assert.equal(audit.previousValue, "");
  assert.equal(JSON.stringify(audit).includes(extraPhone), false);
  assert.equal(customer.phone, phone);

  const same = await request("/api/contact-phones/update", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId,
    label: "手机",
    phone: extraPhone
  });
  assert.equal(same.response.status, 200);
  assert.equal(same.json.result, "unchanged");
  assert.equal(store.contactPhoneAudits.filter((item) => item.phoneId === phoneId && item.result === "updated").length, 1);

  const edited = await request("/api/contact-phones/update", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId,
    label: "座机",
    phone: extraNext
  });
  assert.equal(edited.response.status, 200);
  assert.equal(edited.json.action, "update");
  assert.match(String(edited.json.previousValue), /^手机\|/);
  assert.match(String(edited.json.nextValue), /^座机\|/);
  assert.equal(JSON.stringify(edited.json).includes(extraNext), false);
  assert.equal(store.contactPhones.find((item) => item.phoneId === phoneId)?.phone, extraNext);
  assert.equal(customer.phone, phone);

  const forbidden = await request("/api/contact-phones", noUpdate, "POST", {
    targetType: "customer",
    targetId: "c1",
    label: "总机",
    phone: "+46700003333"
  });
  assert.equal(forbidden.response.status, 403);
  assert.equal(forbidden.json.reason, "forbidden");
  assert.equal(store.contactPhoneAudits.some((item) => item.actorId === "u_phone_no_update" && item.reason === "forbidden"), true);
  assert.equal(store.contactPhones.some((item) => item.phone === "+46700003333"), false);

  const otherOwner = await request("/api/contact-phones/update", mia, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId,
    label: "总机",
    phone: "+46700004444"
  });
  assert.equal(otherOwner.response.status, 403);
  assert.equal(store.contactPhones.find((item) => item.phoneId === phoneId)?.phone, extraNext);

  pooled.poolStatus = "public";
  const pooledDenied = await request("/api/contact-phones", shirley, "POST", {
    targetType: "customer",
    targetId: "c2",
    label: "手机",
    phone: "+46700005555"
  });
  assert.equal(pooledDenied.response.status, 409);
  assert.equal(pooledDenied.json.reason, "public_pool");
  assert.equal(store.contactPhoneAudits.some((item) => item.targetId === "c2" && item.reason === "public_pool"), true);
  pooled.poolStatus = poolBefore;

  const otherTenant = await request("/api/contact-phones", shirley, "POST", {
    targetType: "customer",
    targetId: "c_phone_asia",
    label: "手机",
    phone: "+46700006666"
  });
  assert.equal(otherTenant.response.status, 404);
  assert.equal(store.customers.find((item) => item.id === "c_phone_asia")?.phone, "+85291110000");
  const asiaAdd = await request("/api/contact-phones", asia, "POST", {
    targetType: "customer",
    targetId: "c_phone_asia",
    label: "总机",
    phone: "+85290001111"
  });
  assert.equal(asiaAdd.response.status, 200);

  const primaryEdit = await request("/api/contact-phones/update", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId: customerPhoneId("c1"),
    label: "手机",
    phone: "+46700007777"
  });
  assert.equal(primaryEdit.response.status, 400);
  assert.equal(primaryEdit.json.reason, "primary_phone");
  assert.equal(customer.phone, phone);
  assert.equal(store.contactPhoneAudits.some((item) => item.phoneId === customerPhoneId("c1") && item.reason === "primary_phone"), true);

  const preferred = await request("/api/preferred-phones", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId
  });
  assert.equal(preferred.response.status, 200);
  assert.equal(preferred.json.phoneId, phoneId);

  const putConfig = (enabled: boolean) => {
    const next = {
      teamId: "europe",
      aliyunOutboundEnabled: enabled,
      instanceId: "ccc-demo",
      region: "cn-shanghai",
      callerNumber: "02100001111",
      callWindowStart: "00:00",
      callWindowEnd: "23:59",
      maxCallsPerNumberPerDay: 20,
      minIntervalMinutes: 0,
      accessKeyIdEncrypted: encryptAliyunOutboundSecret("europe", "accessKeyId", accessKeyId),
      accessKeySecretEncrypted: encryptAliyunOutboundSecret("europe", "accessKeySecret", secret),
      callbackPathTokenEncrypted: "",
      updatedBy: "u_admin",
      updatedAt: "2026-11-01T00:00:00.000Z"
    };
    const existing = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe");
    if (existing) Object.assign(existing, next);
    else store.aliyunOutboundConfigs.push(next);
  };
  putConfig(false);
  const disabled = await request("/api/outbound-calls", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId
  });
  assert.equal(disabled.response.status, 403);
  assert.equal(disabled.json.reason, "disabled");
  assert.equal(calls.length, 0);

  putConfig(true);
  store.aliyunAgentMappings.push({
    id: "aam-contact-phone",
    teamId: "europe",
    crmUserId: shirleyUser.id,
    cccUserId: "agent@ccc-demo",
    loginName: "agent",
    displayName: "坐席",
    extension: "8001",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-11-01T00:00:00.000Z"
  });
  const allowed = await request("/api/outbound-calls", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId
  });
  assert.equal(allowed.response.status, 200, JSON.stringify(allowed.json));
  assert.equal(allowed.json.result, "allowed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.Callee, extraNext);
  assert.equal(JSON.stringify(allowed.json).includes(extraNext), false);

  const marked = await request("/api/phone-validity", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId,
    invalid: true
  });
  assert.equal(marked.response.status, 200);
  assert.equal(store.preferredPhoneAudits.some((item) => item.targetId === "c1" && item.reason === "marked_invalid"), true);
  const preferInvalid = await request("/api/preferred-phones", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId
  });
  assert.equal(preferInvalid.response.status, 400);
  assert.equal(preferInvalid.json.reason, "invalid_number");
  const blocked = await request("/api/outbound-calls", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId
  });
  assert.equal(blocked.response.status, 400);
  assert.equal(blocked.json.reason, "invalid_number");
  assert.equal(calls.length, 1);

  const restored = await request("/api/phone-validity", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId,
    invalid: false
  });
  assert.equal(restored.response.status, 200);
  const preferAgain = await request("/api/preferred-phones", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId
  });
  assert.equal(preferAgain.response.status, 200);

  store.websiteOpportunities.push({
    id: "cand-contact-phone-suppressed",
    company: "Suppressed Extra",
    business: "",
    country: "瑞典",
    website: "",
    contact: "",
    contactInfo: "",
    description: "",
    ownerId: shirleyUser.id,
    teamId: "europe",
    status: "excluded",
    createdAt: "2026-11-01T00:00:00.000Z",
    customerId: "c1",
    outreachState: "suppressed"
  });
  const suppressed = await request("/api/outbound-calls", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId
  });
  assert.equal(suppressed.response.status, 409);
  assert.equal(suppressed.json.reason, "suppressed");
  assert.equal(calls.length, 1);
  const suppressedIndex = store.websiteOpportunities.findIndex((item) => item.id === "cand-contact-phone-suppressed");
  if (suppressedIndex >= 0) store.websiteOpportunities.splice(suppressedIndex, 1);

  const leadPhoneBefore = lead.phone;
  const leadAdd = await request("/api/contact-phones", shirley, "POST", {
    targetType: "lead",
    targetId: "l1",
    label: "总机",
    phone: "+46555001234"
  });
  assert.equal(leadAdd.response.status, 200);
  assert.equal(lead.phone, leadPhoneBefore);
  const removed = await request("/api/contact-phones/delete", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId
  });
  assert.equal(removed.response.status, 200);
  assert.equal(removed.json.action, "delete");
  assert.equal(removed.json.nextValue, "");
  assert.equal(JSON.stringify(removed.json).includes(extraNext), false);
  assert.equal(store.contactPhones.some((item) => item.phoneId === phoneId), false);
  assert.equal(customer.phone, phone);
  const gone = await request("/api/preferred-phones?targetType=customer&targetId=c1", shirley);
  assert.equal(gone.json.phoneId || "", "");
  const missingDial = await request("/api/outbound-calls", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId
  });
  assert.equal(missingDial.json.reason, "not_found");
  assert.equal(calls.length, 1);

  const batchDial = await request("/api/outbound-calls", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId: customerPhoneId("c1"),
    phoneIds: [phoneId]
  });
  assert.equal(batchDial.response.status, 400);
  assert.equal(calls.length, 1);

  assert.equal(aliyunHits, 0);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(customer.phone, phone);
  customer.phone = phoneBefore;
  pooled.poolStatus = poolBefore;
  store.aliyunOutboundConfigs.splice(0, store.aliyunOutboundConfigs.length, ...JSON.parse(configBefore));
  assert.equal(store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled === true, enabledBefore);
  console.log("contact phone http tests passed");
} finally {
  setOutboundDialerForTests(undefined);
  globalThis.fetch = originalFetch;
  server.close();
}
