import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { ContactPhone, PhoneValidity, PreferredPhone, SameDayCallSkip } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start today follow advance test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

async function request(path: string, token = "") {
  const response = await originalFetch(`${baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
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

try {
  setOutboundNowForTests(new Date("2026-11-04T04:00:00.000Z"));
  const store = getStore();
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  const shirley = await login("shirley@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  assert.ok(shirleyUser && miaUser);
  const customerTemplate = store.customers.find((item) => item.id === "c1" && item.teamId === "europe");
  const leadTemplate = store.leads.find((item) => item.id === "l1" && item.teamId === "europe");
  assert.ok(customerTemplate && leadTemplate);
  store.users.push({
    ...shirleyUser,
    id: "u_tfa_no_comm",
    name: "No Comm",
    email: "no-tfa-comm@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    if (actor.id !== "u_tfa_no_comm") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };
  const noComm = await login("no-tfa-comm@keduoduo.com");
  const savedReminders = store.customers.map((item) => [item.id, item.nextReminder] as const);
  const savedLeadFollows = store.leads.map((item) => [item.id, item.nextFollowAt] as const);
  const savedProspectFollows = store.websiteOpportunities.map((item) => [item.id, item.nextFollowAt] as const);
  for (const item of store.customers) item.nextReminder = "";
  for (const item of store.leads) item.nextFollowAt = "";
  for (const item of store.websiteOpportunities) item.nextFollowAt = "";
  store.customers.push({
    ...customerTemplate,
    id: "c_tfa_early",
    company: "Early <Co>",
    ownerId: shirleyUser.id,
    teamId: "europe",
    poolStatus: "owned",
    phone: "+8613800138000",
    nextReminder: "2026-11-04 09:00"
  }, {
    ...customerTemplate,
    id: "c_tfa_late",
    company: "Late",
    ownerId: shirleyUser.id,
    teamId: "europe",
    poolStatus: "owned",
    phone: "+8613800138111",
    nextReminder: "2026-11-04 16:00"
  }, {
    ...customerTemplate,
    id: "c_tfa_paused",
    company: "Paused",
    ownerId: shirleyUser.id,
    teamId: "europe",
    poolStatus: "owned",
    phone: "+8613800138222",
    nextReminder: "2026-11-04 08:00"
  }, {
    ...customerTemplate,
    id: "c_tfa_invalid",
    company: "Invalid",
    ownerId: shirleyUser.id,
    teamId: "europe",
    poolStatus: "owned",
    phone: "+8613800138333",
    nextReminder: "2026-11-04 08:30"
  }, {
    ...customerTemplate,
    id: "c_tfa_other",
    company: "Other Owner",
    ownerId: miaUser.id,
    teamId: "europe",
    poolStatus: "owned",
    phone: "+8613800138444",
    nextReminder: "2026-11-04 07:00"
  });
  store.leads.push({
    ...leadTemplate,
    id: "l_tfa_today",
    company: "Lead Today",
    ownerId: shirleyUser.id,
    teamId: "europe",
    phone: "+8613700001111",
    nextFollowAt: "2026-11-04 12:00",
    deletedAt: undefined
  });
  const extra: ContactPhone = {
    id: "cp_tfa_late",
    teamId: "europe",
    targetType: "customer",
    targetId: "c_tfa_late",
    phoneId: "extra-tfa-late",
    label: "",
    phone: "+8613900002222",
    phoneDigits: "8613900002222",
    origin: "extra",
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z"
  };
  store.contactPhones.push(extra);
  const preferred: PreferredPhone = {
    id: "pp_tfa_late",
    teamId: "europe",
    targetType: "customer",
    targetId: "c_tfa_late",
    phoneId: "extra-tfa-late",
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z"
  };
  store.preferredPhones.push(preferred);
  const invalid: PhoneValidity = {
    id: "pv_tfa",
    teamId: "europe",
    targetType: "customer",
    targetId: "c_tfa_invalid",
    phoneId: "customer-phone:c_tfa_invalid",
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z"
  };
  store.phoneValidities.push(invalid);
  const skip: SameDayCallSkip = {
    id: "skip_tfa",
    teamId: "europe",
    targetType: "customer",
    targetId: "c_tfa_paused",
    skipOn: "2026-11-04",
    resumeOn: "2026-11-20",
    reason: "asked_later",
    note: "暂停备注不要出现",
    active: true,
    actorId: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z"
  };
  store.sameDayCallSkips.push(skip);

  const callsBefore = store.outboundCallAudits.length;
  const recordsBefore = store.outboundCallRecords.length;
  const outcomesBefore = store.callOutcomeAudits.length;
  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions);
  const leadsBefore = store.leads.length;
  const customersBefore = store.customers.length;

  const anon = await request("/api/today-follow-next?scope=mine");
  assert.equal(anon.response.status, 401);

  const bad = await request("/api/today-follow-next?scope=mine&note=x", shirley);
  assert.equal(bad.response.status, 400);

  const denied = await request("/api/today-follow-next?scope=mine", noComm);
  assert.equal(denied.response.status, 403);

  const teamDenied = await request("/api/today-follow-next?scope=team", shirley);
  assert.equal(teamDenied.response.status, 403);
  assert.equal(teamDenied.json.reason, "forbidden");
  assert.equal(store.callOutcomeAudits.length, outcomesBefore);

  const first = await request("/api/today-follow-next?scope=mine", shirley);
  assert.equal(first.response.status, 200);
  assert.equal(first.json.date, "2026-11-04");
  assert.equal(first.json.next?.targetId, "c_tfa_early");
  assert.equal(first.json.next?.name, "Early <Co>");
  assert.match(String(first.json.next?.maskedNumber), /8000$/);
  assert.equal(JSON.stringify(first.json).includes("13800138000"), false);
  assert.equal(JSON.stringify(first.json).includes("暂停备注不要出现"), false);

  const second = await request("/api/today-follow-next?scope=mine&afterType=customer&afterId=c_tfa_early", shirley);
  assert.equal(second.json.next?.targetId, "l_tfa_today");
  const third = await request("/api/today-follow-next?scope=mine&afterType=lead&afterId=l_tfa_today", shirley);
  assert.equal(third.json.next?.targetId, "c_tfa_late");
  assert.equal(third.json.next?.preferred, true);
  assert.equal(third.json.next?.phoneId, "extra-tfa-late");
  assert.match(String(third.json.next?.maskedNumber), /2222$/);
  assert.equal(JSON.stringify(third.json).includes("13900002222"), false);
  const body = JSON.stringify([first.json, second.json, third.json]);
  for (const skipped of ["c_tfa_paused", "c_tfa_invalid", "c_tfa_other"]) {
    assert.equal(body.includes(skipped), false);
  }
  const again = await request("/api/today-follow-next?scope=mine&afterType=customer&afterId=c_tfa_early", shirley);
  assert.equal(again.json.next?.targetId, "l_tfa_today");
  assert.equal(store.callOutcomeAudits.length, outcomesBefore);

  const team = await request("/api/today-follow-next?scope=team", admin);
  assert.equal(team.response.status, 200);
  assert.equal(team.json.scope, "team");
  const teamIds = [team.json.next?.targetId];
  let cursor = team.json.next;
  for (let i = 0; i < 6 && cursor?.targetId; i += 1) {
    const step = await request(`/api/today-follow-next?scope=team&afterType=${cursor.targetType}&afterId=${encodeURIComponent(cursor.targetId)}`, admin);
    cursor = step.json.next;
    if (cursor?.targetId) teamIds.push(cursor.targetId);
  }
  assert.equal(teamIds.includes("c_tfa_early"), true);
  assert.equal(teamIds.includes("c_tfa_other"), true);
  assert.equal(teamIds.includes("c_tfa_paused"), false);
  assert.equal(teamIds.includes("c_tfa_invalid"), false);

  setTenantTimezoneOverride(store, "europe", "America/New_York");
  const ny = await request("/api/today-follow-next?scope=mine&afterType=customer&afterId=c_tfa_early", shirley);
  assert.equal(ny.json.date, "2026-11-03");
  assert.equal(ny.json.next?.targetId === "c_tfa_late", false);
  assert.equal(ny.json.next?.targetId === "l_tfa_today", false);

  assert.equal(store.customers.find((item) => item.id === "c_tfa_early")?.nextReminder, "2026-11-04 09:00");
  assert.equal(store.leads.find((item) => item.id === "l_tfa_today")?.nextFollowAt, "2026-11-04 12:00");
  assert.equal(store.sameDayCallSkips.find((item) => item.id === "skip_tfa")?.resumeOn, "2026-11-20");
  assert.equal(store.preferredPhones.find((item) => item.id === "pp_tfa_late")?.phoneId, "extra-tfa-late");
  assert.equal(store.phoneValidities.some((item) => item.phoneId === "customer-phone:c_tfa_invalid"), true);
  assert.equal(store.outboundCallAudits.length, callsBefore);
  assert.equal(store.outboundCallRecords.length, recordsBefore);
  assert.equal(store.callOutcomeAudits.length, outcomesBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.customers.length, customersBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), false);
  assert.equal(aliyunHits, 0);
  console.log("today follow advance http tests passed");
} finally {
  setOutboundNowForTests(undefined);
  globalThis.fetch = originalFetch;
  server.close();
}
