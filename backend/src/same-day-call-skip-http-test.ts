import assert from "node:assert/strict";
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

const phone = "+4681112222";
const extraPhone = "+4681113333";
const secret = "SkSecretValue9999wxyz";
const accessKeyId = "LTAI12345678wxyz";
const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start same-day call skip test server");
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
    return { jobId: "job-mock-sdcs", callType: "OUTBOUND" };
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

const store = getStore();
setOutboundNowForTests(new Date("2026-11-04T04:00:00.000Z"));
setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");

try {
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  assert.ok(shirleyUser && miaUser);
  store.users.push({
    ...shirleyUser,
    id: "u_sdcs_no_send",
    name: "No Send",
    email: "no-sdcs-send@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_sdcs_no_read",
    name: "No Read",
    email: "no-sdcs-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    if (actor.id !== "u_sdcs_no_send" && actor.id !== "u_sdcs_no_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    if (actor.id === "u_sdcs_no_send") delete permissions["communication.send"];
    if (actor.id === "u_sdcs_no_read") delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };

  const base = store.customers.find((item) => item.id === "c1");
  const lead = store.leads.find((item) => item.id === "l1");
  assert.ok(base && lead);
  const reminderBefore = base.nextReminder;
  const leadFollowBefore = lead.nextFollowAt;
  const leadsBefore = store.leads.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const activitiesBefore = store.customerActivities.length;

  store.customers.push(
    { ...base, id: "c_sdcs", company: "Skip Buyer", phone, poolStatus: "owned", ownerId: shirleyUser.id, teamId: "europe" },
    { ...base, id: "c_sdcs_public", company: "Public Skip", phone: "+4681114444", poolStatus: "public", ownerId: shirleyUser.id, teamId: "europe" },
    { ...base, id: "c_sdcs_asia", company: "Asia Skip", phone: "+4681115555", poolStatus: "owned", ownerId: shirleyUser.id, teamId: "asia" },
    { ...base, id: "c_sdcs_tz", company: "Timezone Skip", phone: "+4681116666", poolStatus: "owned", ownerId: shirleyUser.id, teamId: "europe" }
  );
  store.leads.push({ ...lead, id: "l_sdcs_deleted", company: "Deleted Skip", deletedAt: "2026-11-01T00:00:00.000Z" });
  store.websiteOpportunities.push({
    id: "p_sdcs",
    company: "Prospect Skip",
    business: "",
    country: "瑞典",
    website: "",
    contact: "",
    contactInfo: "",
    description: "",
    ownerId: shirleyUser.id,
    teamId: "europe",
    status: "shortlisted",
    createdAt: "2026-11-01T00:00:00.000Z"
  });
  store.contactPhones.push({
    id: "cp_sdcs_extra",
    teamId: "europe",
    targetType: "customer",
    targetId: "c_sdcs",
    phoneId: "extra-sdcs",
    label: "附加",
    phone: extraPhone,
    phoneDigits: "4681113333",
    origin: "extra",
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z"
  });

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const noSend = await login("no-sdcs-send@keduoduo.com");
  const noRead = await login("no-sdcs-read@keduoduo.com");

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

  const skipBody = { targetType: "customer", targetId: "c_sdcs", reason: "reached", note: "今天已经联系上" };
  const audits = () => store.sameDayCallSkipAudits.filter((item) => item.actorId === shirleyUser.id || item.teamId === "europe");
  const beforeSet = store.sameDayCallSkipAudits.length;
  const saved = await request("/api/same-day-call-skips", shirley, "POST", skipBody);
  assert.equal(saved.response.status, 200);
  assert.equal(saved.json.result, "updated");
  assert.equal(saved.json.skipOn, "2026-11-04");
  assert.equal(saved.json.reasonLabel, "今天已经联系上");
  assert.equal(saved.text.includes(phone), false);
  assert.equal(store.sameDayCallSkips.some((item) => item.targetId === "c_sdcs" && item.active && item.skipOn === "2026-11-04" && item.reason === "reached"), true);
  assert.equal(store.sameDayCallSkipAudits[0]?.action, "set");
  assert.equal(store.sameDayCallSkipAudits[0]?.result, "updated");
  assert.equal(store.sameDayCallSkipAudits[0]?.note, "今天已经联系上");
  assert.equal(JSON.stringify(store.sameDayCallSkipAudits[0]).includes(phone), false);
  assert.equal(JSON.stringify(store.sameDayCallSkipAudits[0]).includes(secret), false);

  const same = await request("/api/same-day-call-skips", shirley, "POST", skipBody);
  assert.equal(same.response.status, 200);
  assert.equal(same.json.result, "unchanged");
  assert.equal(store.sameDayCallSkipAudits.length, beforeSet + 1);

  const changed = await request("/api/same-day-call-skips", shirley, "POST", { ...skipBody, reason: "asked_later", note: "字".repeat(200) });
  assert.equal(changed.response.status, 200);
  assert.equal(changed.json.result, "updated");
  assert.equal(store.sameDayCallSkips.find((item) => item.targetId === "c_sdcs")?.reason, "asked_later");
  assert.equal(store.sameDayCallSkips.find((item) => item.targetId === "c_sdcs")?.note.length, 200);

  const tooLong = await request("/api/same-day-call-skips", shirley, "POST", { ...skipBody, note: "字".repeat(201) });
  assert.equal(tooLong.response.status, 400);
  assert.equal(store.sameDayCallSkips.find((item) => item.targetId === "c_sdcs")?.note.length, 200);
  const afterLong = store.sameDayCallSkipAudits.length;
  const extraField = await request("/api/same-day-call-skips", shirley, "POST", { ...skipBody, phone });
  assert.equal(extraField.response.status, 400);
  assert.equal(store.sameDayCallSkipAudits.length, afterLong);
  const batch = await request("/api/same-day-call-skips", shirley, "POST", { targets: [skipBody] });
  assert.equal(batch.response.status, 400);
  assert.equal(store.sameDayCallSkipAudits.length, afterLong);
  assert.equal((await request("/api/same-day-call-skips", "", "POST", skipBody)).response.status, 401);
  assert.equal(store.sameDayCallSkipAudits.length, afterLong);

  const miaTry = await request("/api/same-day-call-skips", mia, "POST", { ...skipBody, note: "SECRETNOTE" });
  assert.equal(miaTry.response.status, 403);
  assert.equal(miaTry.json.reason, "forbidden");
  assert.equal(store.sameDayCallSkipAudits[0]?.actorId, miaUser.id);
  assert.equal(store.sameDayCallSkipAudits[0]?.result, "rejected");
  assert.equal(store.sameDayCallSkipAudits[0]?.note, "");
  assert.equal(JSON.stringify(store.sameDayCallSkipAudits[0]).includes("SECRETNOTE"), false);
  assert.equal(store.sameDayCallSkips.filter((item) => item.targetId === "c_sdcs").length, 1);

  const noSendTry = await request("/api/same-day-call-skips", noSend, "POST", skipBody);
  assert.equal(noSendTry.response.status, 403);
  assert.equal(noSendTry.json.reason, "forbidden");
  assert.equal(store.sameDayCallSkipAudits[0]?.reason, "forbidden");
  assert.equal(store.sameDayCallSkipAudits[0]?.note, "");

  const missing = await request("/api/same-day-call-skips", shirley, "POST", { targetType: "customer", targetId: "c_missing_sdcs", reason: "other" });
  assert.equal(missing.response.status, 404);
  assert.equal(missing.json.reason, "not_found");
  assert.equal(store.sameDayCallSkipAudits[0]?.targetId, "");
  const otherTeam = await request("/api/same-day-call-skips", shirley, "POST", { targetType: "customer", targetId: "c_sdcs_asia", reason: "other" });
  assert.equal(otherTeam.response.status, 404);
  assert.equal(store.sameDayCallSkips.some((item) => item.targetId === "c_sdcs_asia"), false);
  assert.equal(store.sameDayCallSkipAudits[0]?.targetId, "");
  const deleted = await request("/api/same-day-call-skips", shirley, "POST", { targetType: "lead", targetId: "l_sdcs_deleted", reason: "other" });
  assert.equal(deleted.response.status, 404);
  assert.equal(store.leads.find((item) => item.id === "l_sdcs_deleted")?.deletedAt, "2026-11-01T00:00:00.000Z");
  const pooled = await request("/api/same-day-call-skips", shirley, "POST", { targetType: "customer", targetId: "c_sdcs_public", reason: "other" });
  assert.equal(pooled.response.status, 403);
  assert.equal(pooled.json.reason, "forbidden");
  assert.equal(store.customers.find((item) => item.id === "c_sdcs_public")?.poolStatus, "public");
  assert.equal(store.sameDayCallSkips.some((item) => item.targetId === "c_sdcs_public"), false);

  const leadSaved = await request("/api/same-day-call-skips", shirley, "POST", { targetType: "lead", targetId: "l1", reason: "wrong_time" });
  assert.equal(leadSaved.response.status, 200);
  assert.equal(lead.nextFollowAt, leadFollowBefore);
  const prospectSaved = await request("/api/same-day-call-skips", shirley, "POST", { targetType: "prospect", targetId: "p_sdcs", reason: "other" });
  assert.equal(prospectSaved.response.status, 200);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.leads.length, leadsBefore + 1);

  const dial = (targetId: string, phoneId = customerPhoneId(targetId)) => request("/api/outbound-calls", shirley, "POST", {
    targetType: "customer",
    targetId,
    phoneId
  });
  const disabled = await dial("c_sdcs");
  assert.equal(disabled.response.status, 403);
  assert.equal(disabled.json.reason, "disabled");
  assert.equal(calls.length, 0);

  putConfig(true);
  const unmapped = await dial("c_sdcs");
  assert.equal(unmapped.response.status, 403);
  assert.equal(unmapped.json.reason, "unmapped");
  assert.equal(calls.length, 0);
  store.aliyunAgentMappings.push({
    id: "aam-sdcs",
    teamId: "europe",
    crmUserId: shirleyUser.id,
    cccUserId: "agent@ccc-sdcs",
    loginName: "agent",
    displayName: "坐席",
    extension: "8001",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  });
  putConfig(true, "09:00", "09:30");
  const outside = await dial("c_sdcs");
  assert.equal(outside.response.status, 400);
  assert.equal(outside.json.reason, "outside_window");
  assert.equal(calls.length, 0);
  putConfig(true, "00:00", "23:59");
  store.phoneValidities.push({
    id: "pv-sdcs",
    teamId: "europe",
    targetType: "customer",
    targetId: "c_sdcs",
    phoneId: customerPhoneId("c_sdcs"),
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z"
  });
  const invalid = await dial("c_sdcs");
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.json.reason, "invalid_number");
  assert.equal(calls.length, 0);
  store.phoneValidities = store.phoneValidities.filter((item) => item.id !== "pv-sdcs");

  store.websiteOpportunities.push({
    id: "cand-sdcs-suppressed",
    company: "Suppressed Skip",
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
    customerId: "c_sdcs",
    outreachState: "suppressed"
  });
  const suppressed = await dial("c_sdcs");
  assert.equal(suppressed.response.status, 409);
  assert.equal(suppressed.json.reason, "suppressed");
  assert.equal(calls.length, 0);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  store.websiteOpportunities = store.websiteOpportunities.filter((item) => item.id !== "cand-sdcs-suppressed");

  const blocked = await dial("c_sdcs");
  assert.equal(blocked.response.status, 400);
  assert.equal(blocked.json.reason, "skipped_today");
  assert.match(String(blocked.json.message), /今天已标记不再拨打/);
  assert.equal(blocked.text.includes(phone), false);
  assert.equal(calls.length, 0);
  assert.equal(store.outboundCallAudits[0]?.reason, "skipped_today");
  assert.equal(store.outboundCallAudits[0]?.result, "rejected");
  assert.equal(JSON.stringify(store.outboundCallAudits[0]).includes(phone), false);
  const extraBlocked = await dial("c_sdcs", "extra-sdcs");
  assert.equal(extraBlocked.response.status, 400);
  assert.equal(extraBlocked.json.reason, "skipped_today");
  assert.equal(calls.length, 0);
  assert.equal(extraBlocked.text.includes(extraPhone), false);

  const preview = await request("/api/aliyun-outbound/workbench/before-dial", shirley, "POST", { callee: phone });
  assert.equal(preview.response.status, 400);
  assert.equal(preview.json.reason, "skipped_today");
  assert.equal(preview.text.includes(phone), false);
  assert.equal(calls.length, 0);

  store.customers.push({ ...base, id: "c_sdcs_same", company: "Same Digits", phone, poolStatus: "owned", ownerId: shirleyUser.id, teamId: "europe" });
  const otherObject = await dial("c_sdcs_same");
  assert.equal(otherObject.response.status, 200);
  assert.equal(otherObject.json.result, "allowed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.Callee, phone);

  const cleared = await request("/api/same-day-call-skips/clear", shirley, "POST", { targetType: "customer", targetId: "c_sdcs" });
  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.json.result, "updated");
  assert.equal(store.sameDayCallSkips.find((item) => item.targetId === "c_sdcs")?.active, false);
  assert.equal(store.sameDayCallSkipAudits[0]?.action, "clear");
  const clearAgain = await request("/api/same-day-call-skips/clear", shirley, "POST", { targetType: "customer", targetId: "c_sdcs" });
  assert.equal(clearAgain.response.status, 200);
  assert.equal(clearAgain.json.result, "unchanged");
  assert.equal(store.sameDayCallSkipAudits[0]?.action, "clear");
  const allowed = await dial("c_sdcs");
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.json.result, "allowed");
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.UserId, "agent@ccc-sdcs");

  setTenantTimezoneOverride(store, "europe", "America/New_York");
  const zoned = await request("/api/same-day-call-skips", shirley, "POST", { targetType: "customer", targetId: "c_sdcs_tz", reason: "reached" });
  assert.equal(zoned.response.status, 200);
  assert.equal(zoned.json.skipOn, "2026-11-03");
  const zonedDial = await dial("c_sdcs_tz");
  assert.equal(zonedDial.response.status, 400);
  assert.equal(zonedDial.json.reason, "skipped_today");
  assert.equal(calls.length, 2);
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  const nextDay = await dial("c_sdcs_tz");
  assert.equal(nextDay.response.status, 200);
  assert.equal(nextDay.json.result, "allowed");
  assert.equal(calls.length, 3);

  const mine = await request("/api/same-day-call-skips?scope=mine", shirley);
  assert.equal(mine.response.status, 200);
  assert.equal(mine.json.items.some((item: { targetId?: string }) => item.targetId === "l1"), true);
  assert.equal(mine.json.items.some((item: { targetId?: string }) => item.targetId === "p_sdcs"), true);
  assert.equal(mine.json.items.some((item: { targetId?: string }) => item.targetId === "c_sdcs"), false);
  assert.equal(mine.text.includes(phone), false);
  assert.equal(mine.text.includes(secret), false);
  assert.equal(store.sameDayCallSkipAudits[0]?.action, "read");
  assert.equal(store.sameDayCallSkipAudits[0]?.rowCount, mine.json.items.length);
  const again = await request("/api/same-day-call-skips?scope=mine", shirley);
  assert.equal(again.response.status, 200);
  assert.equal(store.sameDayCallSkipAudits.filter((item) => item.actorId === shirleyUser.id && item.action === "read" && item.result === "read").length >= 2, true);
  const emptyTeamMember = await request("/api/same-day-call-skips?scope=mine", mia);
  assert.equal(emptyTeamMember.response.status, 200);
  assert.equal(emptyTeamMember.json.empty, true);
  assert.equal(emptyTeamMember.json.items.length, 0);
  assert.equal(emptyTeamMember.text.includes(">0<"), false);
  const salesTeam = await request("/api/same-day-call-skips?scope=team", shirley);
  assert.equal(salesTeam.response.status, 403);
  assert.equal(salesTeam.json.reason, "forbidden");
  assert.equal(store.sameDayCallSkipAudits[0]?.action, "read");
  assert.equal(store.sameDayCallSkipAudits[0]?.result, "rejected");
  assert.equal(store.sameDayCallSkipAudits[0]?.scope, "team");
  const badQuery = await request("/api/same-day-call-skips?scope=mine&outcome=reached", shirley);
  assert.equal(badQuery.response.status, 400);
  const beforeNoRead = store.sameDayCallSkipAudits.length;
  const noReadList = await request("/api/same-day-call-skips?scope=mine", noRead);
  assert.equal(noReadList.response.status, 403);
  assert.equal(store.sameDayCallSkipAudits.length, beforeNoRead);
  assert.equal(noReadList.text.includes("今天已经联系上"), false);
  const team = await request("/api/same-day-call-skips?scope=team", alex);
  assert.equal(team.response.status, 200);
  assert.equal(team.json.items.some((item: { targetId?: string; name?: string }) => item.targetId === "l1"), true);
  assert.equal(team.text.includes(phone), false);
  const adminTeam = await request("/api/same-day-call-skips?scope=team", admin);
  assert.equal(adminTeam.response.status, 200);
  assert.equal(adminTeam.json.items.some((item: { targetId?: string }) => item.targetId === "p_sdcs"), true);

  putConfig(false);
  assert.equal(store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled, false);
  assert.equal(base.nextReminder, reminderBefore);
  assert.equal(lead.nextFollowAt, leadFollowBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.leads.length, leadsBefore + 1);
  assert.equal(aliyunHits, 0);
  assert.equal(calls.length, 3);
  assert.equal(JSON.stringify(store.sameDayCallSkipAudits).includes(phone), false);
  assert.equal(JSON.stringify(store.sameDayCallSkipAudits).includes(extraPhone), false);
  assert.equal(JSON.stringify(store.sameDayCallSkipAudits).includes(secret), false);
  assert.equal(JSON.stringify(store.sameDayCallSkipAudits).includes(accessKeyId), false);
  console.log("same-day call skip http tests passed");
} finally {
  setOutboundDialerForTests(undefined);
  setOutboundNowForTests(undefined);
  setTenantTimezoneOverride(store, "europe", undefined);
  server.close();
}
