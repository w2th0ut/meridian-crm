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

const phone = "+4682223333";
const extraPhone = "+4682224444";
const secret = "HoldSecretValue9999wxyz";
const accessKeyId = "LTAIhold123456wxyz";
const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start outbound call hold test server");
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
    return { jobId: "job-mock-och", callType: "OUTBOUND" };
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
    id: "u_och_no_send",
    name: "No Hold Send",
    email: "no-och-send@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_och_no_read",
    name: "No Hold Read",
    email: "no-och-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    if (actor.id !== "u_och_no_send" && actor.id !== "u_och_no_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    if (actor.id === "u_och_no_send") delete permissions["communication.send"];
    if (actor.id === "u_och_no_read") delete permissions["communication.read"];
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
    { ...base, id: "c_och", company: "Hold Buyer", phone, poolStatus: "owned", ownerId: shirleyUser.id, teamId: "europe" },
    { ...base, id: "c_och_public", company: "Public Hold", phone: "+4682225555", poolStatus: "public", ownerId: shirleyUser.id, teamId: "europe" },
    { ...base, id: "c_och_asia", company: "Asia Hold", phone: "+4682226666", poolStatus: "owned", ownerId: shirleyUser.id, teamId: "asia" },
    { ...base, id: "c_och_tz", company: "Timezone Hold", phone: "+4682227777", poolStatus: "owned", ownerId: shirleyUser.id, teamId: "europe" },
    { ...base, id: "c_och_far", company: "Far Hold", phone: "+4682228888", poolStatus: "owned", ownerId: shirleyUser.id, teamId: "europe" },
    { ...base, id: "c_och_exp", company: "Expiry Hold", phone: "+4682229999", poolStatus: "owned", ownerId: shirleyUser.id, teamId: "europe" }
  );
  store.leads.push({ ...lead, id: "l_och_deleted", company: "Deleted Hold", deletedAt: "2026-11-01T00:00:00.000Z" });
  store.websiteOpportunities.push({
    id: "p_och",
    company: "Prospect Hold",
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
    id: "cp_och_extra",
    teamId: "europe",
    targetType: "customer",
    targetId: "c_och",
    phoneId: "extra-och",
    label: "附加",
    phone: extraPhone,
    phoneDigits: "4682224444",
    origin: "extra",
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z"
  });

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const noSend = await login("no-och-send@keduoduo.com");
  const noRead = await login("no-och-read@keduoduo.com");

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

  const holdBody = { targetType: "customer", targetId: "c_och", untilOn: "2026-11-06", reason: "asked_later", note: "下周再联系" };
  const beforeSet = store.outboundCallHoldAudits.length;
  const saved = await request("/api/outbound-call-holds", shirley, "POST", holdBody);
  assert.equal(saved.response.status, 200);
  assert.equal(saved.json.result, "updated");
  assert.equal(saved.json.untilOn, "2026-11-06");
  assert.equal(saved.json.reasonLabel, "约了以后再联系");
  assert.equal(saved.text.includes(phone), false);
  assert.equal(store.outboundCallHolds.filter((item) => item.targetId === "c_och" && item.active).length, 1);
  assert.equal(store.outboundCallHoldAudits[0]?.action, "set");
  assert.equal(store.outboundCallHoldAudits[0]?.result, "updated");
  assert.equal(store.outboundCallHoldAudits[0]?.note, "下周再联系");
  assert.equal(JSON.stringify(store.outboundCallHoldAudits[0]).includes(phone), false);
  assert.equal(JSON.stringify(store.outboundCallHoldAudits[0]).includes(secret), false);

  const same = await request("/api/outbound-call-holds", shirley, "POST", holdBody);
  assert.equal(same.response.status, 200);
  assert.equal(same.json.result, "unchanged");
  assert.equal(store.outboundCallHoldAudits.length, beforeSet + 1);

  const changed = await request("/api/outbound-call-holds", shirley, "POST", { ...holdBody, reason: "colleague", note: "字".repeat(200) });
  assert.equal(changed.response.status, 200);
  assert.equal(changed.json.result, "updated");
  assert.equal(store.outboundCallHolds.find((item) => item.targetId === "c_och")?.reason, "colleague");
  assert.equal(store.outboundCallHolds.find((item) => item.targetId === "c_och")?.note.length, 200);

  const tooLong = await request("/api/outbound-call-holds", shirley, "POST", { ...holdBody, note: "字".repeat(201) });
  assert.equal(tooLong.response.status, 400);
  assert.equal(tooLong.json.reason, "invalid_request");
  assert.equal(store.outboundCallHolds.find((item) => item.targetId === "c_och")?.note.length, 200);
  const afterLong = store.outboundCallHoldAudits.length;
  const today = await request("/api/outbound-call-holds", shirley, "POST", { ...holdBody, untilOn: "2026-11-04" });
  assert.equal(today.response.status, 400);
  assert.match(String(today.json.message), /晚于租户当地今天/);
  assert.equal(store.outboundCallHoldAudits.length, afterLong);
  const tooFar = await request("/api/outbound-call-holds", shirley, "POST", { ...holdBody, untilOn: "2026-12-05" });
  assert.equal(tooFar.response.status, 400);
  assert.match(String(tooFar.json.message), /30 天/);
  assert.equal(store.outboundCallHoldAudits.length, afterLong);
  const badDate = await request("/api/outbound-call-holds", shirley, "POST", { ...holdBody, untilOn: "2026-11-31" });
  assert.equal(badDate.response.status, 400);
  assert.equal(store.outboundCallHoldAudits.length, afterLong);
  const edge = await request("/api/outbound-call-holds", shirley, "POST", { targetType: "customer", targetId: "c_och_far", untilOn: "2026-12-04", reason: "other" });
  assert.equal(edge.response.status, 200);
  assert.equal(edge.json.untilOn, "2026-12-04");
  const extraField = await request("/api/outbound-call-holds", shirley, "POST", { ...holdBody, phone });
  assert.equal(extraField.response.status, 400);
  const batch = await request("/api/outbound-call-holds", shirley, "POST", { targets: [holdBody] });
  assert.equal(batch.response.status, 400);
  assert.equal((await request("/api/outbound-call-holds", "", "POST", holdBody)).response.status, 401);
  assert.equal(store.outboundCallHoldAudits.length, afterLong + 1);

  const miaTry = await request("/api/outbound-call-holds", mia, "POST", { ...holdBody, note: "SECRETNOTE" });
  assert.equal(miaTry.response.status, 403);
  assert.equal(miaTry.json.reason, "forbidden");
  assert.equal(store.outboundCallHoldAudits[0]?.actorId, miaUser.id);
  assert.equal(store.outboundCallHoldAudits[0]?.result, "rejected");
  assert.equal(store.outboundCallHoldAudits[0]?.note, "");
  assert.equal(JSON.stringify(store.outboundCallHoldAudits[0]).includes("SECRETNOTE"), false);
  assert.equal(store.outboundCallHolds.filter((item) => item.targetId === "c_och").length, 1);

  const noSendTry = await request("/api/outbound-call-holds", noSend, "POST", holdBody);
  assert.equal(noSendTry.response.status, 403);
  assert.equal(store.outboundCallHoldAudits[0]?.reason, "forbidden");
  assert.equal(store.outboundCallHoldAudits[0]?.note, "");

  const missing = await request("/api/outbound-call-holds", shirley, "POST", { targetType: "customer", targetId: "c_missing_och", untilOn: "2026-11-06", reason: "other" });
  assert.equal(missing.response.status, 404);
  assert.equal(missing.json.reason, "not_found");
  assert.equal(store.outboundCallHoldAudits[0]?.targetId, "");
  const otherTeam = await request("/api/outbound-call-holds", shirley, "POST", { targetType: "customer", targetId: "c_och_asia", untilOn: "2026-11-06", reason: "other" });
  assert.equal(otherTeam.response.status, 404);
  assert.equal(store.outboundCallHolds.some((item) => item.targetId === "c_och_asia"), false);
  assert.equal(store.outboundCallHoldAudits[0]?.targetId, "");
  const deleted = await request("/api/outbound-call-holds", shirley, "POST", { targetType: "lead", targetId: "l_och_deleted", untilOn: "2026-11-06", reason: "other" });
  assert.equal(deleted.response.status, 404);
  assert.equal(store.leads.find((item) => item.id === "l_och_deleted")?.deletedAt, "2026-11-01T00:00:00.000Z");
  const pooled = await request("/api/outbound-call-holds", shirley, "POST", { targetType: "customer", targetId: "c_och_public", untilOn: "2026-11-06", reason: "other" });
  assert.equal(pooled.response.status, 403);
  assert.equal(pooled.json.reason, "forbidden");
  assert.equal(store.customers.find((item) => item.id === "c_och_public")?.poolStatus, "public");
  assert.equal(store.outboundCallHolds.some((item) => item.targetId === "c_och_public"), false);

  const leadSaved = await request("/api/outbound-call-holds", shirley, "POST", { targetType: "lead", targetId: "l1", untilOn: "2026-11-10", reason: "other_channel" });
  assert.equal(leadSaved.response.status, 200);
  assert.equal(lead.nextFollowAt, leadFollowBefore);
  const prospectSaved = await request("/api/outbound-call-holds", shirley, "POST", { targetType: "prospect", targetId: "p_och", untilOn: "2026-11-08", reason: "other" });
  assert.equal(prospectSaved.response.status, 200);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.leads.length, leadsBefore + 1);

  const dial = (targetId: string, phoneId = customerPhoneId(targetId)) => request("/api/outbound-calls", shirley, "POST", {
    targetType: "customer",
    targetId,
    phoneId
  });
  const disabled = await dial("c_och");
  assert.equal(disabled.response.status, 403);
  assert.equal(disabled.json.reason, "disabled");
  assert.equal(calls.length, 0);

  putConfig(true);
  const unmapped = await dial("c_och");
  assert.equal(unmapped.response.status, 403);
  assert.equal(unmapped.json.reason, "unmapped");
  assert.equal(calls.length, 0);
  store.aliyunAgentMappings.push({
    id: "aam-och",
    teamId: "europe",
    crmUserId: shirleyUser.id,
    cccUserId: "agent@ccc-och",
    loginName: "agent",
    displayName: "坐席",
    extension: "8002",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  });
  putConfig(true, "09:00", "09:30");
  const outside = await dial("c_och");
  assert.equal(outside.response.status, 400);
  assert.equal(outside.json.reason, "outside_window");
  assert.equal(calls.length, 0);
  putConfig(true, "00:00", "23:59");
  store.phoneValidities.push({
    id: "pv-och",
    teamId: "europe",
    targetType: "customer",
    targetId: "c_och",
    phoneId: customerPhoneId("c_och"),
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z"
  });
  const invalid = await dial("c_och");
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.json.reason, "invalid_number");
  assert.equal(calls.length, 0);
  store.phoneValidities = store.phoneValidities.filter((item) => item.id !== "pv-och");

  store.websiteOpportunities.push({
    id: "cand-och-suppressed",
    company: "Suppressed Hold",
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
    customerId: "c_och",
    outreachState: "suppressed"
  });
  const suppressed = await dial("c_och");
  assert.equal(suppressed.response.status, 409);
  assert.equal(suppressed.json.reason, "suppressed");
  assert.equal(calls.length, 0);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  store.websiteOpportunities = store.websiteOpportunities.filter((item) => item.id !== "cand-och-suppressed");

  const blocked = await dial("c_och");
  assert.equal(blocked.response.status, 400);
  assert.equal(blocked.json.reason, "held_until");
  assert.equal(blocked.json.message, "这个对象已暂停外呼，要到 2026-11-06 才可再拨");
  assert.equal(blocked.text.includes(phone), false);
  assert.equal(calls.length, 0);
  assert.equal(store.outboundCallAudits[0]?.reason, "held_until");
  assert.equal(store.outboundCallAudits[0]?.result, "rejected");
  assert.equal(JSON.stringify(store.outboundCallAudits[0]).includes(phone), false);
  const extraBlocked = await dial("c_och", "extra-och");
  assert.equal(extraBlocked.response.status, 400);
  assert.equal(extraBlocked.json.reason, "held_until");
  assert.equal(calls.length, 0);
  assert.equal(extraBlocked.text.includes(extraPhone), false);

  const preview = await request("/api/aliyun-outbound/workbench/before-dial", shirley, "POST", { callee: phone });
  assert.equal(preview.response.status, 400);
  assert.equal(preview.json.reason, "held_until");
  assert.match(String(preview.json.message), /2026-11-06/);
  assert.equal(preview.text.includes(phone), false);
  assert.equal(calls.length, 0);

  store.customers.push({ ...base, id: "c_och_same", company: "Same Digits Hold", phone, poolStatus: "owned", ownerId: shirleyUser.id, teamId: "europe" });
  const otherObject = await dial("c_och_same");
  assert.equal(otherObject.response.status, 200);
  assert.equal(otherObject.json.result, "allowed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.Callee, phone);

  const skipped = await request("/api/same-day-call-skips", shirley, "POST", { targetType: "customer", targetId: "c_och", reason: "reached" });
  assert.equal(skipped.response.status, 200);
  const skipFirst = await dial("c_och");
  assert.equal(skipFirst.response.status, 400);
  assert.equal(skipFirst.json.reason, "skipped_today");
  assert.equal(calls.length, 1);
  const skipCleared = await request("/api/same-day-call-skips/clear", shirley, "POST", { targetType: "customer", targetId: "c_och" });
  assert.equal(skipCleared.response.status, 200);
  const stillHeld = await dial("c_och");
  assert.equal(stillHeld.response.status, 400);
  assert.equal(stillHeld.json.reason, "held_until");
  assert.equal(calls.length, 1);

  const cleared = await request("/api/outbound-call-holds/clear", shirley, "POST", { targetType: "customer", targetId: "c_och" });
  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.json.result, "updated");
  assert.equal(store.outboundCallHolds.find((item) => item.targetId === "c_och")?.active, false);
  assert.equal(store.outboundCallHoldAudits[0]?.action, "clear");
  const clearAgain = await request("/api/outbound-call-holds/clear", shirley, "POST", { targetType: "customer", targetId: "c_och" });
  assert.equal(clearAgain.response.status, 200);
  assert.equal(clearAgain.json.result, "unchanged");
  assert.equal(store.outboundCallHoldAudits[0]?.action, "clear");
  const allowed = await dial("c_och");
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.json.result, "allowed");
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.UserId, "agent@ccc-och");

  setTenantTimezoneOverride(store, "europe", "America/New_York");
  const zoned = await request("/api/outbound-call-holds", shirley, "POST", { targetType: "customer", targetId: "c_och_tz", untilOn: "2026-11-04", reason: "asked_later" });
  assert.equal(zoned.response.status, 200);
  assert.equal(zoned.json.untilOn, "2026-11-04");
  const zonedDial = await dial("c_och_tz");
  assert.equal(zonedDial.response.status, 400);
  assert.equal(zonedDial.json.reason, "held_until");
  assert.equal(calls.length, 2);
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  const resumed = await dial("c_och_tz");
  assert.equal(resumed.response.status, 200);
  assert.equal(resumed.json.result, "allowed");
  assert.equal(calls.length, 3);

  const expiry = await request("/api/outbound-call-holds", shirley, "POST", { targetType: "customer", targetId: "c_och_exp", untilOn: "2026-11-06", reason: "other" });
  assert.equal(expiry.response.status, 200);
  setOutboundNowForTests(new Date("2026-11-06T04:00:00.000Z"));
  const expiredDial = await dial("c_och_exp");
  assert.equal(expiredDial.response.status, 200);
  assert.equal(expiredDial.json.result, "allowed");
  assert.equal(calls.length, 4);
  const stillThere = store.outboundCallHolds.find((item) => item.targetId === "c_och_exp");
  assert.equal(stillThere?.active, true);
  assert.equal(stillThere?.untilOn, "2026-11-06");
  setOutboundNowForTests(new Date("2026-11-04T04:00:00.000Z"));

  const mine = await request("/api/outbound-call-holds?scope=mine", shirley);
  assert.equal(mine.response.status, 200);
  assert.equal(mine.json.items.some((item: { targetId?: string }) => item.targetId === "l1"), true);
  assert.equal(mine.json.items.some((item: { targetId?: string }) => item.targetId === "p_och"), true);
  assert.equal(mine.json.items.some((item: { targetId?: string }) => item.targetId === "c_och"), false);
  assert.equal(mine.json.items.some((item: { targetId?: string; untilOn?: string }) => item.targetId === "c_och_exp" && item.untilOn === "2026-11-06"), true);
  assert.equal(mine.text.includes(phone), false);
  assert.equal(mine.text.includes(secret), false);
  assert.equal(store.outboundCallHoldAudits[0]?.action, "read");
  assert.equal(store.outboundCallHoldAudits[0]?.rowCount, mine.json.items.length);
  const again = await request("/api/outbound-call-holds?scope=mine", shirley);
  assert.equal(again.response.status, 200);
  assert.equal(store.outboundCallHoldAudits.filter((item) => item.actorId === shirleyUser.id && item.action === "read" && item.result === "read").length >= 2, true);
  const emptyTeamMember = await request("/api/outbound-call-holds?scope=mine", mia);
  assert.equal(emptyTeamMember.response.status, 200);
  assert.equal(emptyTeamMember.json.empty, true);
  assert.equal(emptyTeamMember.json.items.length, 0);
  const salesTeam = await request("/api/outbound-call-holds?scope=team", shirley);
  assert.equal(salesTeam.response.status, 403);
  assert.equal(salesTeam.json.reason, "forbidden");
  assert.equal(store.outboundCallHoldAudits[0]?.action, "read");
  assert.equal(store.outboundCallHoldAudits[0]?.result, "rejected");
  assert.equal(store.outboundCallHoldAudits[0]?.scope, "team");
  const badQuery = await request("/api/outbound-call-holds?scope=mine&outcome=other", shirley);
  assert.equal(badQuery.response.status, 400);
  const beforeNoRead = store.outboundCallHoldAudits.length;
  const noReadList = await request("/api/outbound-call-holds?scope=mine", noRead);
  assert.equal(noReadList.response.status, 403);
  assert.equal(store.outboundCallHoldAudits.length, beforeNoRead);
  const team = await request("/api/outbound-call-holds?scope=team", alex);
  assert.equal(team.response.status, 200);
  assert.equal(team.json.items.some((item: { targetId?: string }) => item.targetId === "l1"), true);
  assert.equal(team.text.includes(phone), false);
  const adminTeam = await request("/api/outbound-call-holds?scope=team", admin);
  assert.equal(adminTeam.response.status, 200);
  assert.equal(adminTeam.json.items.some((item: { targetId?: string }) => item.targetId === "p_och"), true);
  const order = mine.json.items.map((item: { untilOn?: string }) => item.untilOn);
  const sorted = [...order].sort();
  assert.deepEqual(order, sorted);

  putConfig(false);
  assert.equal(store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled, false);
  assert.equal(base.nextReminder, reminderBefore);
  assert.equal(lead.nextFollowAt, leadFollowBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.leads.length, leadsBefore + 1);
  assert.equal(aliyunHits, 0);
  assert.equal(calls.length, 4);
  assert.equal(JSON.stringify(store.outboundCallHoldAudits).includes(phone), false);
  assert.equal(JSON.stringify(store.outboundCallHoldAudits).includes(extraPhone), false);
  assert.equal(JSON.stringify(store.outboundCallHoldAudits).includes(secret), false);
  assert.equal(JSON.stringify(store.outboundCallHoldAudits).includes(accessKeyId), false);
  console.log("outbound call hold http tests passed");
} finally {
  setOutboundDialerForTests(undefined);
  setOutboundNowForTests(undefined);
  setTenantTimezoneOverride(store, "europe", undefined);
  server.close();
}
