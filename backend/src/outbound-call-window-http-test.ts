import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { encryptAliyunOutboundSecret } from "./credential-security.js";
import {
  customerPhoneId,
  leadPhoneId,
  outboundNumberKey,
  setOutboundDialerForTests,
  setOutboundNowForTests,
  setTenantTimezoneOverride
} from "./outbound-call.js";
import type { MakeCallParams } from "./aliyun-ccc-make-call.js";

const secret = "SkSecretValue9999wxyz";
const accessKeyId = "LTAI12345678wxyz";
const customerPhone = "+46111222333";
const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start outbound window test server");
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
    return { jobId: `job-window-${calls.length}`, callType: "OUTBOUND" };
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
  assert.ok(shirleyUser);
  store.users.push({
    ...shirleyUser,
    id: "u_no_outbound_window",
    name: "No Outbound Window",
    email: "no-outbound-window@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_no_outbound_window") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.send"];
    return { ...snapshot, permissions };
  };
  const shirley = await login("shirley@keduoduo.com");
  const noOutbound = await login("no-outbound-window@keduoduo.com");

  const customer = store.customers.find((item) => item.id === "c1");
  const otherCustomer = store.customers.find((item) => item.id === "c2");
  const dayCustomer = store.customers.find((item) => item.id === "c5");
  const lead = store.leads.find((item) => item.id === "l1");
  const otherLead = store.leads.find((item) => item.id === "l2");
  assert.ok(customer && otherCustomer && dayCustomer && lead && otherLead);
  const phoneBefore = customer.phone;
  const otherPhoneBefore = otherCustomer.phone;
  const dayPhoneBefore = dayCustomer.phone;
  const leadPhoneBefore = lead.phone;
  const otherLeadPhoneBefore = otherLead.phone;
  customer.phone = customerPhone;
  otherCustomer.phone = "+12065550100";
  dayCustomer.phone = "+12065550188";
  lead.phone = "+33111100000";
  otherLead.phone = "+33111100099";

  const putConfig = (policy: {
    callWindowStart?: string;
    callWindowEnd?: string;
    maxCallsPerNumberPerDay?: number;
    minIntervalMinutes?: number;
  }) => {
    const next = {
      teamId: "europe",
      aliyunOutboundEnabled: true,
      instanceId: "ccc-window",
      region: "cn-shanghai",
      callerNumber: "02100001111",
      callWindowStart: policy.callWindowStart ?? "09:00",
      callWindowEnd: policy.callWindowEnd ?? "20:00",
      maxCallsPerNumberPerDay: policy.maxCallsPerNumberPerDay ?? 5,
      minIntervalMinutes: policy.minIntervalMinutes ?? 0,
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

  const dial = (targetType: "customer" | "lead", targetId: string) => request("/api/outbound-calls", shirley, "POST", {
    targetType,
    targetId,
    phoneId: targetType === "customer" ? customerPhoneId(targetId) : leadPhoneId(targetId)
  });

  putConfig({});
  setTenantTimezoneOverride(store, "europe", "America/New_York");
  setOutboundNowForTests(new Date("2026-10-31T01:00:00.000Z"));

  const unmapped = await dial("customer", "c1");
  assert.equal(unmapped.response.status, 403);
  assert.equal(unmapped.json.reason, "unmapped");
  assert.equal(calls.length, 0);
  assert.equal(store.outboundCallAudits[0]?.reason, "unmapped");
  assert.equal(store.outboundCallAudits[0]?.result, "rejected");

  const forbidden = await request("/api/outbound-calls", noOutbound, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId: customerPhoneId("c1")
  });
  assert.equal(forbidden.response.status, 403);
  assert.equal(forbidden.json.reason, "forbidden");
  assert.equal(calls.length, 0);

  store.aliyunAgentMappings.push({
    id: "aam-window",
    teamId: "europe",
    crmUserId: shirleyUser.id,
    cccUserId: "agent@ccc-window",
    loginName: "agent",
    displayName: "坐席",
    extension: "8001",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  });

  const newYork = await dial("customer", "c1");
  assert.equal(newYork.response.status, 400);
  assert.equal(newYork.json.reason, "outside_window");
  assert.match(String(newYork.json.message), /不在允许拨打时段/);
  assert.equal(calls.length, 0);
  assert.equal(store.outboundCallAudits[0]?.reason, "outside_window");
  assert.equal(store.outboundCallAudits[0]?.result, "rejected");
  assert.equal(store.outboundCallAudits[0]?.actorId, shirleyUser.id);
  assert.equal(store.outboundCallAudits[0]?.targetType, "customer");
  assert.equal(store.outboundCallAudits[0]?.targetId, "c1");
  assert.equal(store.outboundCallAudits[0]?.maskedNumber, "*******2333");
  assert.equal(JSON.stringify(newYork.json).includes(customerPhone), false);
  assert.equal(JSON.stringify(store.outboundCallAudits[0]).includes(customerPhone), false);
  assert.equal(JSON.stringify(store.outboundCallAudits[0]).includes(secret), false);
  assert.match(store.outboundCallAudits[0]?.numberKey || "", /^[a-f0-9]{64}$/);
  assert.equal(store.outboundCallAudits[0]?.numberKey, outboundNumberKey(customerPhone));

  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  const open = await dial("customer", "c1");
  assert.equal(open.response.status, 200);
  assert.equal(open.json.result, "allowed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].Callee, customerPhone);
  assert.equal(store.outboundCallAudits[0]?.result, "allowed");
  assert.equal(store.outboundCallAudits[0]?.numberKey, outboundNumberKey(customerPhone));

  setOutboundNowForTests(new Date("2026-10-31T00:59:00.000Z"));
  const beforeOpen = await dial("customer", "c1");
  assert.equal(beforeOpen.response.status, 400);
  assert.equal(beforeOpen.json.reason, "outside_window");
  assert.equal(calls.length, 1);
  assert.equal(store.outboundCallAudits[0]?.reason, "outside_window");
  assert.equal(store.outboundCallAudits[0]?.result, "rejected");

  setOutboundNowForTests(new Date("2026-10-31T12:00:00.000Z"));
  const atClose = await dial("customer", "c1");
  assert.equal(atClose.response.status, 200);
  assert.equal(atClose.json.result, "allowed");
  assert.equal(calls.length, 2);

  setOutboundNowForTests(new Date("2026-10-31T12:01:00.000Z"));
  const afterClose = await dial("customer", "c1");
  assert.equal(afterClose.response.status, 400);
  assert.equal(afterClose.json.reason, "outside_window");
  assert.equal(calls.length, 2);
  assert.equal(store.outboundCallAudits[0]?.reason, "outside_window");
  assert.equal(JSON.stringify(store.outboundCallAudits[0]).includes(customerPhone), false);

  putConfig({ callWindowStart: "00:00", callWindowEnd: "23:59", maxCallsPerNumberPerDay: 2, minIntervalMinutes: 0 });
  setOutboundNowForTests(new Date("2026-10-31T03:00:00.000Z"));
  const first = await dial("customer", "c2");
  const second = await dial("customer", "c2");
  const third = await dial("customer", "c2");
  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  assert.equal(third.response.status, 400);
  assert.equal(third.json.reason, "daily_limit");
  assert.match(String(third.json.message), /今日拨打次数已达上限/);
  assert.equal(calls.length, 4);
  assert.equal(store.outboundCallAudits[0]?.reason, "daily_limit");
  assert.equal(store.outboundCallAudits[0]?.result, "rejected");
  assert.equal(store.outboundCallAudits[0]?.actorId, shirleyUser.id);
  assert.equal(JSON.stringify(third.json).includes(otherCustomer.phone), false);
  assert.equal(JSON.stringify(store.outboundCallAudits[0]).includes(otherCustomer.phone), false);

  const otherNumber = await dial("lead", "l2");
  assert.equal(otherNumber.response.status, 200);
  assert.equal(calls.length, 5);

  lead.phone = "+1 206-555-0100";
  const sameDigits = await dial("lead", "l1");
  assert.equal(sameDigits.response.status, 400);
  assert.equal(sameDigits.json.reason, "daily_limit");
  assert.equal(calls.length, 5);
  assert.equal(store.outboundCallAudits[0]?.reason, "daily_limit");
  assert.equal(store.outboundCallAudits[0]?.numberKey, outboundNumberKey(otherCustomer.phone));

  lead.phone = "+33111100011";
  putConfig({ callWindowStart: "00:00", callWindowEnd: "23:59", maxCallsPerNumberPerDay: 5, minIntervalMinutes: 30 });
  const intervalStart = new Date("2026-10-31T04:00:00.000Z");
  setOutboundNowForTests(intervalStart);
  const spacedFirst = await dial("lead", "l1");
  assert.equal(spacedFirst.response.status, 200);
  setOutboundNowForTests(new Date(intervalStart.getTime() + 29 * 60_000));
  const tooSoon = await dial("lead", "l1");
  assert.equal(tooSoon.response.status, 400);
  assert.equal(tooSoon.json.reason, "min_interval");
  assert.match(String(tooSoon.json.message), /最小间隔/);
  assert.equal(calls.length, 6);
  assert.equal(store.outboundCallAudits[0]?.reason, "min_interval");
  assert.equal(store.outboundCallAudits[0]?.result, "rejected");
  assert.equal(store.outboundCallAudits[0]?.actorId, shirleyUser.id);
  assert.equal(JSON.stringify(tooSoon.json).includes(lead.phone), false);
  assert.equal(JSON.stringify(store.outboundCallAudits[0]).includes(lead.phone), false);
  const duringWait = await dial("lead", "l2");
  assert.equal(duringWait.response.status, 200);
  assert.equal(calls.length, 7);
  setOutboundNowForTests(new Date(intervalStart.getTime() + 30 * 60_000));
  const spacedSecond = await dial("lead", "l1");
  assert.equal(spacedSecond.response.status, 200);
  assert.equal(calls.length, 8);

  putConfig({ callWindowStart: "00:00", callWindowEnd: "23:59", maxCallsPerNumberPerDay: 1, minIntervalMinutes: 0 });
  setOutboundNowForTests(new Date("2026-10-31T15:30:00.000Z"));
  const late = await dial("customer", "c5");
  const lateAgain = await dial("customer", "c5");
  assert.equal(late.response.status, 200);
  assert.equal(lateAgain.response.status, 400);
  assert.equal(lateAgain.json.reason, "daily_limit");
  setOutboundNowForTests(new Date("2026-10-31T16:10:00.000Z"));
  const nextDay = await dial("customer", "c5");
  assert.equal(nextDay.response.status, 200);
  assert.equal(calls.length, 10);

  putConfig({ callWindowStart: "09:00", callWindowEnd: "20:00", maxCallsPerNumberPerDay: 5, minIntervalMinutes: 0 });
  setOutboundNowForTests(new Date("2026-10-31T00:59:00.000Z"));
  store.websiteOpportunities.push({
    id: "cand-window-suppressed",
    company: "Window Suppressed",
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
  const suppressed = await dial("customer", "c1");
  assert.equal(suppressed.response.status, 409);
  assert.equal(suppressed.json.reason, "suppressed");
  assert.equal(calls.length, 10);
  assert.equal(store.outboundCallAudits[0]?.reason, "suppressed");
  store.websiteOpportunities.splice(store.websiteOpportunities.findIndex((item) => item.id === "cand-window-suppressed"), 1);
  const afterSuppression = await dial("customer", "c1");
  assert.equal(afterSuppression.response.status, 400);
  assert.equal(afterSuppression.json.reason, "outside_window");
  assert.equal(calls.length, 10);

  assert.equal(aliyunHits, 0);
  assert.equal(JSON.stringify(store.outboundCallAudits).includes(secret), false);
  assert.equal(JSON.stringify(store.outboundCallAudits).includes(accessKeyId), false);
  assert.equal(JSON.stringify(store.outboundCallAudits).includes(customerPhone), false);

  customer.phone = phoneBefore;
  otherCustomer.phone = otherPhoneBefore;
  dayCustomer.phone = dayPhoneBefore;
  lead.phone = leadPhoneBefore;
  otherLead.phone = otherLeadPhoneBefore;
  console.log("outbound call window http tests passed");
} finally {
  setOutboundNowForTests(undefined);
  setOutboundDialerForTests(undefined);
  globalThis.fetch = originalFetch;
  server.close();
}
