import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { encryptAliyunOutboundSecret } from "./credential-security.js";
import {
  customerPhoneId,
  setOutboundDialerForTests,
  setOutboundNowForTests,
  setTenantTimezoneOverride
} from "./outbound-call.js";
import type { MakeCallParams } from "./aliyun-ccc-make-call.js";

const phone = "+4683334444";
const extraPhone = "+4683335555";
const secret = "ResumeSecretValue9999xyz";
const accessKeyId = "LTAIresume12345xyz";
const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start resume skip test server");
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
    return { jobId: "job-mock-resume", callType: "OUTBOUND" };
  }
});

async function request(path: string, token: string, method = "GET", body?: unknown) {
  const response = await originalFetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
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

const store = getStore();
setOutboundNowForTests(new Date("2026-11-04T04:00:00.000Z"));
setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");

try {
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  assert.ok(shirleyUser && miaUser);
  const base = store.customers.find((item) => item.id === "c1");
  const lead = store.leads.find((item) => item.id === "l1");
  assert.ok(base && lead);
  const reminderBefore = base.nextReminder;
  const leadFollowBefore = lead.nextFollowAt;
  const leadsBefore = store.leads.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  store.customers.push(
    { ...base, id: "c_rs", company: "Resume Buyer", phone, poolStatus: "owned", ownerId: shirleyUser.id, teamId: "europe" },
    { ...base, id: "c_rs_far", company: "Far Resume", phone: "+4683336666", poolStatus: "owned", ownerId: shirleyUser.id, teamId: "europe" },
    { ...base, id: "c_rs_tmw", company: "Tomorrow Resume", phone: "+4683337777", poolStatus: "owned", ownerId: shirleyUser.id, teamId: "europe" },
    { ...base, id: "c_rs_tz", company: "Timezone Resume", phone: "+4683338888", poolStatus: "owned", ownerId: shirleyUser.id, teamId: "europe" },
    { ...base, id: "c_rs_exp", company: "Expiry Resume", phone: "+4683339999", poolStatus: "owned", ownerId: shirleyUser.id, teamId: "europe" }
  );
  store.contactPhones.push({
    id: "cp_rs_extra",
    teamId: "europe",
    targetType: "customer",
    targetId: "c_rs",
    phoneId: "extra-rs",
    label: "附加",
    phone: extraPhone,
    phoneDigits: "4683335555",
    origin: "extra",
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z"
  });
  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const putConfig = (enabled: boolean, start = "00:00", end = "23:59") => {
    const next = {
      teamId: "europe",
      aliyunOutboundEnabled: enabled,
      instanceId: "ccc-demo",
      region: "cn-shanghai",
      callerNumber: "02100001111",
      callWindowStart: start,
      callWindowEnd: end,
      maxCallsPerNumberPerDay: 20,
      minIntervalMinutes: 0,
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
  putConfig(false);
  const body = { targetType: "customer", targetId: "c_rs", reason: "asked_later", note: "下周再联系", resumeOn: "2026-11-06" };
  const before = store.sameDayCallSkipAudits.length;
  const saved = await request("/api/same-day-call-skips", shirley, "POST", body);
  assert.equal(saved.response.status, 200);
  assert.equal(saved.json.result, "updated");
  assert.equal(saved.json.resumeOn, "2026-11-06");
  assert.equal(saved.json.skipOn, "2026-11-04");
  assert.match(String(saved.json.message), /2026-11-06/);
  assert.equal(store.sameDayCallSkips.filter((item) => item.targetId === "c_rs").length, 1);
  assert.equal(store.sameDayCallSkips.find((item) => item.targetId === "c_rs")?.resumeOn, "2026-11-06");
  assert.equal(store.sameDayCallSkipAudits[0]?.action, "set");
  assert.equal(store.sameDayCallSkipAudits[0]?.resumeOn, "2026-11-06");
  assert.equal(JSON.stringify(store.sameDayCallSkipAudits[0]).includes(phone), false);
  const same = await request("/api/same-day-call-skips", shirley, "POST", body);
  assert.equal(same.response.status, 200);
  assert.equal(same.json.result, "unchanged");
  assert.equal(store.sameDayCallSkipAudits.length, before + 1);
  const after = store.sameDayCallSkipAudits.length;
  assert.equal((await request("/api/same-day-call-skips", shirley, "POST", { ...body, resumeOn: "2026-11-04" })).response.status, 400);
  assert.equal((await request("/api/same-day-call-skips", shirley, "POST", { ...body, resumeOn: "2026-12-05" })).response.status, 400);
  assert.equal((await request("/api/same-day-call-skips", shirley, "POST", { ...body, resumeOn: "2026-11-31" })).response.status, 400);
  assert.equal(store.sameDayCallSkipAudits.length, after);
  const edge = await request("/api/same-day-call-skips", shirley, "POST", { targetType: "customer", targetId: "c_rs_far", reason: "other", resumeOn: "2026-12-04" });
  assert.equal(edge.response.status, 200);
  assert.equal(edge.json.resumeOn, "2026-12-04");
  const tomorrow = await request("/api/same-day-call-skips", shirley, "POST", { targetType: "customer", targetId: "c_rs_tmw", reason: "wrong_time", resumeOn: "2026-11-05" });
  assert.equal(tomorrow.response.status, 200);
  assert.match(String(tomorrow.json.message), /今天不会再拨/);
  const omitted = await request("/api/same-day-call-skips", shirley, "POST", { targetType: "lead", targetId: "l1", reason: "reached" });
  assert.equal(omitted.response.status, 200);
  assert.equal(omitted.json.resumeOn, "");
  assert.equal(lead.nextFollowAt, leadFollowBefore);

  const dial = (targetId: string, phoneId = customerPhoneId(targetId)) => request("/api/outbound-calls", shirley, "POST", {
    targetType: "customer",
    targetId,
    phoneId
  });
  putConfig(false);
  assert.equal((await dial("c_rs")).json.reason, "disabled");
  putConfig(true);
  assert.equal((await dial("c_rs")).json.reason, "unmapped");
  store.aliyunAgentMappings.push({
    id: "aam-rs",
    teamId: "europe",
    crmUserId: shirleyUser.id,
    cccUserId: "agent@ccc-rs",
    loginName: "agent",
    displayName: "坐席",
    extension: "8003",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  });
  putConfig(true, "09:00", "09:30");
  assert.equal((await dial("c_rs")).json.reason, "outside_window");
  putConfig(true, "00:00", "23:59");
  store.phoneValidities.push({
    id: "pv-rs",
    teamId: "europe",
    targetType: "customer",
    targetId: "c_rs",
    phoneId: customerPhoneId("c_rs"),
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z"
  });
  assert.equal((await dial("c_rs")).json.reason, "invalid_number");
  store.phoneValidities = store.phoneValidities.filter((item) => item.id !== "pv-rs");
  store.websiteOpportunities.push({
    id: "cand-rs-suppressed",
    company: "Suppressed Resume",
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
    customerId: "c_rs",
    outreachState: "suppressed"
  });
  const suppressed = await dial("c_rs");
  assert.equal(suppressed.json.reason, "suppressed");
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  store.websiteOpportunities = store.websiteOpportunities.filter((item) => item.id !== "cand-rs-suppressed");
  assert.equal(calls.length, 0);

  const blocked = await dial("c_rs");
  assert.equal(blocked.response.status, 400);
  assert.equal(blocked.json.reason, "skipped_today");
  assert.equal(blocked.json.message, "这个对象已暂停外呼，要到 2026-11-06 才可再拨");
  assert.equal(calls.length, 0);
  const extra = await dial("c_rs", "extra-rs");
  assert.equal(extra.json.reason, "skipped_today");
  assert.equal(calls.length, 0);
  const preview = await request("/api/aliyun-outbound/workbench/before-dial", shirley, "POST", { callee: phone });
  assert.equal(preview.json.reason, "skipped_today");
  assert.match(String(preview.json.message), /2026-11-06/);
  assert.equal(calls.length, 0);
  const todayOnly = await dial("c_rs_tmw");
  assert.equal(todayOnly.json.reason, "skipped_today");
  assert.equal(todayOnly.json.message, "这个对象今天已标记不再拨打");
  assert.equal(calls.length, 0);

  store.customers.push({ ...base, id: "c_rs_same", company: "Same Digits Resume", phone, poolStatus: "owned", ownerId: shirleyUser.id, teamId: "europe" });
  const other = await dial("c_rs_same");
  assert.equal(other.response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.Callee, phone);

  const cleared = await request("/api/same-day-call-skips/clear", shirley, "POST", { targetType: "customer", targetId: "c_rs" });
  assert.equal(cleared.json.result, "updated");
  assert.equal(store.sameDayCallSkips.find((item) => item.targetId === "c_rs")?.active, false);
  assert.equal(store.sameDayCallSkipAudits[0]?.resumeOn, "2026-11-06");
  const again = await request("/api/same-day-call-skips/clear", shirley, "POST", { targetType: "customer", targetId: "c_rs" });
  assert.equal(again.json.result, "unchanged");
  const allowed = await dial("c_rs");
  assert.equal(allowed.response.status, 200);
  assert.equal(calls.length, 2);

  setTenantTimezoneOverride(store, "europe", "America/New_York");
  const zoned = await request("/api/same-day-call-skips", shirley, "POST", { targetType: "customer", targetId: "c_rs_tz", reason: "reached", resumeOn: "2026-11-04" });
  assert.equal(zoned.response.status, 200);
  assert.match(String(zoned.json.message), /今天不会再拨/);
  const zonedDial = await dial("c_rs_tz");
  assert.equal(zonedDial.json.reason, "skipped_today");
  assert.equal(zonedDial.json.message, "这个对象今天已标记不再拨打");
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  const resumed = await dial("c_rs_tz");
  assert.equal(resumed.response.status, 200);
  assert.equal(calls.length, 3);

  const expiry = await request("/api/same-day-call-skips", shirley, "POST", { targetType: "customer", targetId: "c_rs_exp", reason: "other", resumeOn: "2026-11-06" });
  assert.equal(expiry.response.status, 200);
  setOutboundNowForTests(new Date("2026-11-06T04:00:00.000Z"));
  const expired = await dial("c_rs_exp");
  assert.equal(expired.response.status, 200);
  assert.equal(calls.length, 4);
  assert.equal(store.sameDayCallSkips.find((item) => item.targetId === "c_rs_exp")?.active, true);
  setOutboundNowForTests(new Date("2026-11-04T04:00:00.000Z"));

  const miaTry = await request("/api/same-day-call-skips", mia, "POST", { ...body, note: "SECRETNOTE" });
  assert.equal(miaTry.response.status, 403);
  assert.equal(store.sameDayCallSkipAudits[0]?.note, "");
  assert.equal(store.sameDayCallSkipAudits[0]?.resumeOn, "");
  assert.equal(JSON.stringify(store.sameDayCallSkipAudits[0]).includes("SECRETNOTE"), false);

  const mine = await request("/api/same-day-call-skips?scope=mine", shirley);
  assert.equal(mine.response.status, 200);
  assert.equal(mine.json.items.some((item: { targetId?: string; resumeOn?: string }) => item.targetId === "c_rs_exp" && item.resumeOn === "2026-11-06"), true);
  assert.equal(mine.json.items.some((item: { targetId?: string }) => item.targetId === "c_rs"), false);
  assert.equal(mine.json.items.some((item: { targetId?: string; resumeOn?: string }) => item.targetId === "l1" && item.resumeOn === ""), true);
  assert.equal(mine.text.includes(phone), false);

  putConfig(false);
  assert.equal(base.nextReminder, reminderBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(aliyunHits, 0);
  assert.equal(calls.length, 4);
  const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
  assert.equal(schema.includes("CREATE TABLE IF NOT EXISTS outbound_call_holds"), false);
  assert.equal(schema.includes("CREATE TABLE IF NOT EXISTS outbound_call_hold_audits"), false);
  console.log("same-day call skip resume http tests passed");
} finally {
  setOutboundDialerForTests(undefined);
  setOutboundNowForTests(undefined);
  setTenantTimezoneOverride(store, "europe", undefined);
  server.close();
}
