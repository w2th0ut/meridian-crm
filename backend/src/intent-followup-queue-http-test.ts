import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { Customer, Lead, OutboundCallRecord, WebsiteOpportunity } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start intent follow-up queue test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

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
    agentIds: "agent@ccc-ifq-a",
    maskedNumber: "*******2333",
    contactType: "OUTBOUND",
    contactDisposition: "NoAnswer",
    earlyMediaState: "",
    callDurationRaw: "10",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: String(Date.parse("2026-10-20T02:00:00.000Z")),
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://secret.example/do-not-leak-ifq",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "有意向",
    callOutcomeNote: "",
    createdAt: "2026-10-20T02:00:00.000Z",
    updatedAt: "2026-10-20T02:00:00.000Z",
    ...partial
  };
}

function candidate(partial: Partial<WebsiteOpportunity> & Pick<WebsiteOpportunity, "id" | "status">): WebsiteOpportunity {
  return {
    company: partial.id,
    business: "",
    country: "",
    website: "",
    contact: "",
    contactInfo: "",
    description: "",
    ownerId: "u_sales_shirley",
    teamId: "europe",
    createdAt: "2026-10-20T00:00:00.000Z",
    nextFollowAt: "",
    ...partial
  };
}

const ids = (rows: Array<{ targetId?: string }> | undefined) => (rows || []).map((item) => item.targetId).sort();

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const customer = store.customers.find((item) => item.id === "c1");
  const leadSeed = store.leads.find((item) => item.id === "l2");
  assert.ok(shirleyUser && miaUser && customer && leadSeed);
  const activitiesBefore = store.customerActivities.length;
  const leadActivitiesBefore = store.leadActivities.length;
  const followAuditsBefore = store.followUpAudits.length;
  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const sequencesBefore = store.outreachSequences.length;
  const plansBefore = store.prospectOutreachPlans.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);

  store.users.push({
    ...shirleyUser,
    id: "u_ifq_noread",
    name: "No Queue Read",
    email: "no-ifq-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_ifq_noupdate",
    name: "No Customer Update",
    email: "no-ifq-update@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_ifq_asia",
    name: "Asia Queue",
    email: "asia-ifq@keduoduo.com",
    role: "sales",
    teamId: "asia",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    const permissions = { ...snapshot.permissions };
    if (actor.id === "u_ifq_noread") delete permissions["communication.read"];
    if (actor.id === "u_ifq_noupdate") delete permissions["customer.update"];
    return { ...snapshot, permissions };
  };

  const owned = (partial: Partial<Customer> & Pick<Customer, "id" | "ownerId" | "nextReminder">): Customer => ({
    ...customer,
    company: partial.id,
    teamId: "europe",
    poolStatus: "owned",
    ...partial
  });
  const freshLead = (partial: Partial<Lead> & Pick<Lead, "id">): Lead => ({
    ...leadSeed,
    company: partial.id,
    ownerId: shirleyUser.id,
    teamId: "europe",
    status: "new",
    nextFollowAt: "",
    deletedAt: undefined,
    ...partial
  });
  store.customers.push(
    owned({ id: "ifq_intent", ownerId: shirleyUser.id, nextReminder: "" }),
    owned({ id: "ifq_callback", ownerId: shirleyUser.id, nextReminder: "" }),
    owned({ id: "ifq_open", ownerId: shirleyUser.id, nextReminder: "不要改" }),
    owned({ id: "ifq_cold", ownerId: shirleyUser.id, nextReminder: "" }),
    owned({ id: "ifq_public", ownerId: shirleyUser.id, nextReminder: "", poolStatus: "public" }),
    owned({ id: "ifq_mia", ownerId: miaUser.id, nextReminder: "" }),
    owned({ id: "ifq_noupdate", ownerId: "u_ifq_noupdate", nextReminder: "" }),
    owned({ id: "ifq_unmapped", ownerId: shirleyUser.id, nextReminder: "" }),
    owned({ id: "ifq_dismiss", ownerId: shirleyUser.id, nextReminder: "" }),
    owned({ id: "ifq_asia", ownerId: "u_ifq_asia", teamId: "asia", nextReminder: "" })
  );
  store.leads.push(
    freshLead({ id: "ifq_lead" }),
    freshLead({ id: "ifq_deleted", deletedAt: "2026-10-01T00:00:00.000Z" })
  );
  store.websiteOpportunities.push(
    candidate({ id: "ifq_prospect", status: "contactable", outreachState: "suppressed" }),
    candidate({ id: "ifq_preview", status: "preview" })
  );
  store.aliyunAgentMappings.push({
    id: "map_ifq_shirley",
    teamId: "europe",
    crmUserId: shirleyUser.id,
    cccUserId: "agent@ccc-ifq-a",
    loginName: "shirley",
    displayName: "Shirley坐席",
    extension: "8201",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  }, {
    id: "map_ifq_mia",
    teamId: "europe",
    crmUserId: miaUser.id,
    cccUserId: "agent@ccc-ifq-b",
    loginName: "mia",
    displayName: "Mia坐席",
    extension: "8202",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  }, {
    id: "map_ifq_noupdate",
    teamId: "europe",
    crmUserId: "u_ifq_noupdate",
    cccUserId: "agent@ccc-ifq-noupdate",
    loginName: "noupdate",
    displayName: "无权维护",
    extension: "8203",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  }, {
    id: "map_ifq_asia",
    teamId: "asia",
    crmUserId: "u_ifq_asia",
    cccUserId: "agent@ccc-ifq-asia",
    loginName: "asia",
    displayName: "亚洲坐席",
    extension: "8204",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  });
  const older = String(Date.parse("2026-10-01T02:00:00.000Z"));
  const newer = String(Date.parse("2026-10-20T02:00:00.000Z"));
  store.outboundCallRecords.push(
    record({ id: "ocr_ifq_intent_old", targetType: "customer", targetId: "ifq_intent", callOutcome: "无意向", startTimeRaw: older }),
    record({ id: "ocr_ifq_intent", targetType: "customer", targetId: "ifq_intent", callOutcome: "有意向", startTimeRaw: newer }),
    record({ id: "ocr_ifq_callback", targetType: "customer", targetId: "ifq_callback", callOutcome: "需回访", startTimeRaw: newer }),
    record({ id: "ocr_ifq_open", targetType: "customer", targetId: "ifq_open", callOutcome: "有意向", startTimeRaw: newer }),
    record({ id: "ocr_ifq_cold_old", targetType: "customer", targetId: "ifq_cold", callOutcome: "有意向", startTimeRaw: older }),
    record({ id: "ocr_ifq_cold", targetType: "customer", targetId: "ifq_cold", callOutcome: "无意向", startTimeRaw: newer }),
    record({ id: "ocr_ifq_public", targetType: "customer", targetId: "ifq_public", callOutcome: "有意向", startTimeRaw: newer }),
    record({ id: "ocr_ifq_mia", targetType: "customer", targetId: "ifq_mia", callOutcome: "需回访", startTimeRaw: newer, agentIds: "agent@ccc-ifq-b" }),
    record({ id: "ocr_ifq_noupdate", targetType: "customer", targetId: "ifq_noupdate", callOutcome: "有意向", startTimeRaw: newer, agentIds: "agent@ccc-ifq-noupdate" }),
    record({ id: "ocr_ifq_unmapped", targetType: "customer", targetId: "ifq_unmapped", callOutcome: "有意向", startTimeRaw: newer, agentIds: "" }),
    record({ id: "ocr_ifq_lead", targetType: "lead", targetId: "ifq_lead", callOutcome: "有意向", startTimeRaw: newer }),
    record({ id: "ocr_ifq_deleted", targetType: "lead", targetId: "ifq_deleted", callOutcome: "有意向", startTimeRaw: newer }),
    record({ id: "ocr_ifq_prospect", targetType: "prospect", targetId: "ifq_prospect", callOutcome: "需回访", startTimeRaw: newer }),
    record({ id: "ocr_ifq_preview", targetType: "prospect", targetId: "ifq_preview", callOutcome: "有意向", startTimeRaw: newer }),
    record({ id: "ocr_ifq_dismiss", targetType: "customer", targetId: "ifq_dismiss", callOutcome: "有意向", startTimeRaw: newer }),
    record({ id: "ocr_ifq_asia", teamId: "asia", targetType: "customer", targetId: "ifq_asia", callOutcome: "有意向", startTimeRaw: newer, agentIds: "agent@ccc-ifq-asia" })
  );
  store.callOutcomeAudits.push({
    id: "coa_ifq_intent",
    teamId: "europe",
    actorId: shirleyUser.id,
    at: "2026-10-21T08:30:00.000Z",
    callRecordId: "ocr_ifq_intent",
    previousOutcome: "",
    nextOutcome: "有意向",
    previousNote: "",
    nextNote: ""
  });

  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  setOutboundNowForTests(new Date("2026-10-30T03:00:00.000Z"));

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const noRead = await login("no-ifq-read@keduoduo.com");
  const noUpdate = await login("no-ifq-update@keduoduo.com");
  const asia = await login("asia-ifq@keduoduo.com");

  const denied = await request("/api/intent-followup-queue", noRead);
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.permissionCode, "communication.read");
  assert.equal(store.intentFollowupQueueAudits.length, 0);
  const deniedWrite = await request("/api/intent-followup-queue/schedule", noRead, "POST", { targetType: "customer", targetId: "ifq_intent" });
  assert.equal(deniedWrite.response.status, 403);
  assert.equal(store.intentFollowupQueueAudits.length, 0);
  assert.equal(store.intentFollowupArrangements.length, 0);
  const deniedIgnore = await request("/api/intent-followup-queue/ignore", noRead, "POST", { targetType: "customer", targetId: "ifq_dismiss" });
  assert.equal(deniedIgnore.response.status, 403);
  assert.equal(store.intentFollowupQueueAudits.length, 0);
  const deniedRestore = await request("/api/intent-followup-queue/restore", noRead, "POST", { targetType: "customer", targetId: "ifq_dismiss" });
  assert.equal(deniedRestore.response.status, 403);
  assert.equal(store.intentFollowupIgnores.length, 0);
  assert.equal(store.intentFollowupQueueAudits.length, 0);
  const anonymous = await request("/api/intent-followup-queue/schedule", "", "POST", { targetType: "customer", targetId: "ifq_intent" });
  assert.equal(anonymous.response.status, 401);
  assert.equal(store.intentFollowupQueueAudits.length, 0);

  const listed = await request("/api/intent-followup-queue", shirley);
  assert.equal(listed.response.status, 200);
  assert.equal(listed.json.empty, false);
  assert.equal(listed.json.scope, "self");
  assert.equal(listed.json.suggestedNextFollowAt, "2026-11-02 09:00");
  assert.equal(listed.json.timeZone, "Asia/Shanghai");
  const shirleyIds = ids(listed.json.items);
  assert.ok(shirleyIds.includes("ifq_intent"));
  assert.ok(shirleyIds.includes("ifq_callback"));
  assert.ok(shirleyIds.includes("ifq_lead"));
  assert.ok(shirleyIds.includes("ifq_prospect"));
  assert.ok(shirleyIds.includes("ifq_preview"));
  assert.ok(shirleyIds.includes("ifq_public"));
  assert.ok(shirleyIds.includes("ifq_dismiss"));
  assert.equal(listed.json.items.find((item: { targetId: string }) => item.targetId === "ifq_dismiss").ignored, false);
  assert.equal(shirleyIds.includes("ifq_open"), false);
  assert.equal(shirleyIds.includes("ifq_cold"), false);
  assert.equal(shirleyIds.includes("ifq_deleted"), false);
  assert.equal(shirleyIds.includes("ifq_mia"), false);
  assert.equal(shirleyIds.includes("ifq_asia"), false);
  assert.equal(shirleyIds.includes("ifq_unmapped"), false);
  assert.equal(shirleyIds.includes("ifq_noupdate"), false);
  const intentRow = listed.json.items.find((item: { targetId: string }) => item.targetId === "ifq_intent");
  assert.equal(intentRow.outcome, "有意向");
  assert.equal(intentRow.labeledAt, "2026-10-21T08:30:00.000Z");
  assert.equal(intentRow.agentLabel, "Shirley坐席");
  assert.equal(intentRow.callRecordId, "ocr_ifq_intent");
  assert.equal(JSON.stringify(listed.json).includes("do-not-leak-ifq"), false);
  const suppressedRow = listed.json.items.find((item: { targetId: string }) => item.targetId === "ifq_prospect");
  assert.match(suppressedRow.suppressionNotice, /抑制/);
  assert.match(suppressedRow.suppressionNotice, /不改变抑制状态/);

  const manager = await request("/api/intent-followup-queue", alex);
  assert.equal(manager.response.status, 200);
  assert.equal(manager.json.scope, "team");
  assert.equal(ids(manager.json.items).includes("ifq_intent"), true);
  assert.equal(ids(manager.json.items).includes("ifq_mia"), true);
  assert.equal(ids(manager.json.items).includes("ifq_asia"), false);
  assert.equal(ids(manager.json.items).includes("ifq_unmapped"), false);

  const adminList = await request("/api/intent-followup-queue", admin);
  assert.equal(ids(adminList.json.items).includes("ifq_unmapped"), true);

  const intentOnly = await request(`/api/intent-followup-queue?outcome=${encodeURIComponent("有意向")}`, shirley);
  assert.equal(intentOnly.response.status, 200);
  assert.equal(intentOnly.json.items.every((item: { outcome: string }) => item.outcome === "有意向"), true);
  assert.equal(ids(intentOnly.json.items).includes("ifq_intent"), true);
  assert.equal(ids(intentOnly.json.items).includes("ifq_dismiss"), true);
  assert.equal(ids(intentOnly.json.items).includes("ifq_callback"), false);
  assert.equal(ids(intentOnly.json.items).includes("ifq_asia"), false);
  const callbackOnly = await request(`/api/intent-followup-queue?outcome=${encodeURIComponent("需回访")}`, shirley);
  assert.equal(callbackOnly.response.status, 200);
  assert.equal(ids(callbackOnly.json.items).includes("ifq_callback"), true);
  assert.equal(ids(callbackOnly.json.items).includes("ifq_prospect"), true);
  assert.equal(ids(callbackOnly.json.items).includes("ifq_intent"), false);
  const badOutcome = await request(`/api/intent-followup-queue?outcome=${encodeURIComponent("无意向")}`, shirley);
  assert.equal(badOutcome.response.status, 400);
  assert.equal(badOutcome.json.reason, "invalid_request");
  const badSuccess = await request("/api/intent-followup-queue?outcome=Success", shirley);
  assert.equal(badSuccess.response.status, 400);
  const badFlag = await request("/api/intent-followup-queue?includeIgnored=maybe", shirley);
  assert.equal(badFlag.response.status, 400);
  const badAgent = await request("/api/intent-followup-queue?agentId=bad%20id", shirley);
  assert.equal(badAgent.response.status, 400);
  const repeated = await request("/api/intent-followup-queue?agentId=a&agentId=b", shirley);
  assert.equal(repeated.response.status, 400);
  const otherSeat = await request(`/api/intent-followup-queue?agentId=${encodeURIComponent("agent@ccc-ifq-b")}`, shirley);
  assert.equal(otherSeat.response.status, 403);
  assert.equal(otherSeat.json.reason, "forbidden");
  const ownSeat = await request(`/api/intent-followup-queue?agentId=${encodeURIComponent("agent@ccc-ifq-a")}`, shirley);
  assert.equal(ownSeat.response.status, 200);
  assert.equal(ids(ownSeat.json.items).includes("ifq_dismiss"), true);
  assert.equal(ids(ownSeat.json.items).includes("ifq_mia"), false);
  const managerSeat = await request(`/api/intent-followup-queue?agentId=${encodeURIComponent("agent@ccc-ifq-b")}`, alex);
  assert.equal(managerSeat.response.status, 200);
  assert.equal(managerSeat.json.scope, "team");
  assert.deepEqual(ids(managerSeat.json.items), ["ifq_mia"]);
  const adminForeign = await request(`/api/intent-followup-queue?agentId=${encodeURIComponent("agent@ccc-ifq-asia")}`, admin);
  assert.equal(adminForeign.response.status, 200);
  assert.deepEqual(ids(adminForeign.json.items), []);
  const showAll = await request("/api/intent-followup-queue?includeIgnored=1", shirley);
  assert.equal(showAll.response.status, 200);
  assert.equal(showAll.json.filters.includeIgnored, true);
  assert.equal(showAll.json.items.every((item: { ignored?: boolean }) => item.ignored === false), true);
  store.users.push({
    ...shirleyUser,
    id: "u_ifq_empty",
    name: "Empty Queue",
    email: "empty-ifq@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const emptyUser = await login("empty-ifq@keduoduo.com");
  const emptyList = await request("/api/intent-followup-queue", emptyUser);
  assert.equal(emptyList.response.status, 200);
  assert.equal(emptyList.json.empty, true);
  assert.deepEqual(emptyList.json.items, []);
  assert.equal(JSON.stringify(emptyList.json).includes("\"totalCalls\""), false);

  const asiaList = await request("/api/intent-followup-queue", asia);
  assert.deepEqual(ids(asiaList.json.items), ["ifq_asia"]);
  assert.equal(ids(asiaList.json.items).includes("ifq_intent"), false);
  const cross = await request("/api/intent-followup-queue/schedule", shirley, "POST", { targetType: "customer", targetId: "ifq_asia" });
  assert.equal(cross.response.status, 404);
  assert.equal(store.customers.find((item) => item.id === "ifq_asia")?.nextReminder, "");
  assert.equal(store.intentFollowupQueueAudits.find((item) => item.targetId === "ifq_asia" && item.actorId === shirleyUser.id)?.result, "rejected");
  const reverse = await request("/api/intent-followup-queue/schedule", asia, "POST", { targetType: "customer", targetId: "ifq_intent" });
  assert.equal(reverse.response.status, 404);
  assert.equal(store.customers.find((item) => item.id === "ifq_intent")?.nextReminder, "");
  const crossIgnore = await request("/api/intent-followup-queue/ignore", shirley, "POST", { targetType: "customer", targetId: "ifq_asia" });
  assert.equal(crossIgnore.response.status, 404);
  assert.equal(store.intentFollowupIgnores.some((item) => item.targetId === "ifq_asia"), false);
  assert.equal(store.intentFollowupQueueAudits.find((item) => item.action === "ignore" && item.targetId === "ifq_asia" && item.actorId === shirleyUser.id)?.result, "rejected");
  const reverseIgnore = await request("/api/intent-followup-queue/ignore", asia, "POST", { targetType: "customer", targetId: "ifq_dismiss" });
  assert.equal(reverseIgnore.response.status, 404);
  assert.equal(store.intentFollowupIgnores.some((item) => item.targetId === "ifq_dismiss"), false);
  assert.equal(store.customers.find((item) => item.id === "ifq_dismiss")?.nextReminder, "");
  const asiaOwn = await request("/api/intent-followup-queue/ignore", asia, "POST", { targetType: "customer", targetId: "ifq_asia" });
  assert.equal(asiaOwn.response.status, 201);
  assert.equal(asiaOwn.json.action, "ignore");
  const shirleyAfterAsia = await request("/api/intent-followup-queue?includeIgnored=1", shirley);
  assert.equal(ids(shirleyAfterAsia.json.items).includes("ifq_asia"), false);
  const asiaHidden = await request("/api/intent-followup-queue", asia);
  assert.equal(ids(asiaHidden.json.items).includes("ifq_asia"), false);
  const asiaShown = await request("/api/intent-followup-queue?includeIgnored=1", asia);
  assert.equal(asiaShown.json.items.find((item: { targetId: string }) => item.targetId === "ifq_asia")?.ignored, true);
  const asiaRestore = await request("/api/intent-followup-queue/restore", asia, "POST", { targetType: "customer", targetId: "ifq_asia" });
  assert.equal(asiaRestore.response.status, 200);
  assert.equal(asiaRestore.json.action, "restore");
  assert.equal(store.intentFollowupIgnores.find((item) => item.targetId === "ifq_asia")?.active, false);
  const asiaBack = await request("/api/intent-followup-queue", asia);
  assert.deepEqual(ids(asiaBack.json.items), ["ifq_asia"]);

  const hiddenSeat = await request("/api/intent-followup-queue/schedule", shirley, "POST", {
    targetType: "customer",
    targetId: "ifq_mia",
    nextFollowAt: "2026-11-03 15:00"
  });
  assert.equal(hiddenSeat.response.status, 404);
  assert.equal(store.customers.find((item) => item.id === "ifq_mia")?.nextReminder, "");
  const hiddenIgnore = await request("/api/intent-followup-queue/ignore", shirley, "POST", { targetType: "customer", targetId: "ifq_mia" });
  assert.equal(hiddenIgnore.response.status, 404);
  assert.equal(store.intentFollowupIgnores.some((item) => item.targetId === "ifq_mia"), false);
  assert.equal(store.customers.find((item) => item.id === "ifq_mia")?.nextReminder, "");

  const already = await request("/api/intent-followup-queue/schedule", shirley, "POST", {
    targetType: "customer",
    targetId: "ifq_open",
    nextFollowAt: "2026-11-03 15:00"
  });
  assert.equal(already.response.status, 409);
  assert.equal(already.json.reason, "already_has_follow_up");
  assert.equal(store.customers.find((item) => item.id === "ifq_open")?.nextReminder, "不要改");
  assert.equal(store.intentFollowupArrangements.some((item) => item.targetId === "ifq_open"), false);

  const badTime = await request("/api/intent-followup-queue/schedule", shirley, "POST", {
    targetType: "customer",
    targetId: "ifq_intent",
    nextFollowAt: "明天"
  });
  assert.equal(badTime.response.status, 400);
  assert.equal(badTime.json.reason, "invalid_request");
  assert.equal(store.customers.find((item) => item.id === "ifq_intent")?.nextReminder, "");
  assert.equal(store.customerActivities.length, activitiesBefore);

  const batch = await request("/api/intent-followup-queue/schedule", shirley, "POST", {
    targetType: "customer",
    targetId: "ifq_intent",
    records: ["ifq_intent"]
  });
  assert.equal(batch.response.status, 400);
  assert.equal(batch.json.reason, "invalid_request");
  const batchList = await request("/api/intent-followup-queue/schedule", shirley, "POST", ["ifq_intent"]);
  assert.equal(batchList.response.status, 400);
  assert.equal(store.intentFollowupArrangements.length, 0);

  const created = await request("/api/intent-followup-queue/schedule", shirley, "POST", {
    targetType: "customer",
    targetId: "ifq_intent",
    nextFollowAt: "2026-11-03 21:30"
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.json.result, "created");
  assert.equal(created.json.nextFollowAt, "2026-11-03 21:30");
  assert.equal(created.json.replayed, false);
  assert.equal(store.customers.find((item) => item.id === "ifq_intent")?.nextReminder, "2026-11-03 21:30");
  const activity = store.customerActivities.find((item) => item.id === created.json.activityId);
  assert.equal(activity?.type, "call");
  assert.equal(activity?.nextReminder, "2026-11-03 21:30");
  assert.match(activity?.content || "", /通话结果为有意向/);
  assert.match(activity?.content || "", /号码 \*\*\*\*\*\*\*2333/);
  assert.equal((activity?.content || "").includes("do-not-leak-ifq"), false);
  assert.equal(store.followUpAudits.some((item) => item.activityId === created.json.activityId && item.objectType === "customer"), true);
  const createdAudit = store.intentFollowupQueueAudits.find((item) => item.targetId === "ifq_intent" && item.result === "created");
  assert.equal(createdAudit?.actorId, shirleyUser.id);
  assert.equal(createdAudit?.teamId, "europe");
  assert.equal(createdAudit?.action, "schedule");
  assert.equal(createdAudit?.at, "2026-10-30T03:00:00.000Z");
  assert.equal(createdAudit?.activityId, created.json.activityId);
  assert.equal(createdAudit?.nextFollowAt, "2026-11-03 21:30");
  assert.equal(createdAudit?.callRecordId, "ocr_ifq_intent");

  const activitiesAfter = store.customerActivities.length;
  const again = await request("/api/intent-followup-queue/schedule", shirley, "POST", {
    targetType: "customer",
    targetId: "ifq_intent",
    nextFollowAt: "2026-12-01 09:00"
  });
  assert.equal(again.response.status, 200);
  assert.equal(again.json.result, "duplicate");
  assert.equal(again.json.replayed, true);
  assert.equal(again.json.activityId, created.json.activityId);
  assert.equal(again.json.nextFollowAt, "2026-11-03 21:30");
  assert.equal(store.customers.find((item) => item.id === "ifq_intent")?.nextReminder, "2026-11-03 21:30");
  assert.equal(store.customerActivities.length, activitiesAfter);
  assert.equal(store.intentFollowupArrangements.filter((item) => item.targetId === "ifq_intent").length, 1);
  assert.equal(store.intentFollowupQueueAudits.find((item) => item.targetId === "ifq_intent" && item.result === "duplicate")?.actorId, shirleyUser.id);
  const afterSchedule = await request("/api/intent-followup-queue", shirley);
  assert.equal(ids(afterSchedule.json.items).includes("ifq_intent"), false);

  const pooled = await request("/api/intent-followup-queue/schedule", shirley, "POST", { targetType: "customer", targetId: "ifq_public", nextFollowAt: "2026-11-03 10:00" });
  assert.equal(pooled.response.status, 409);
  assert.equal(pooled.json.reason, "public_pool");
  assert.equal(store.customers.find((item) => item.id === "ifq_public")?.nextReminder, "");

  const noWrite = await request("/api/intent-followup-queue/schedule", noUpdate, "POST", { targetType: "customer", targetId: "ifq_noupdate", nextFollowAt: "2026-11-03 10:00" });
  assert.equal(noWrite.response.status, 403);
  assert.equal(noWrite.json.reason, "forbidden");
  assert.equal(store.customers.find((item) => item.id === "ifq_noupdate")?.nextReminder, "");
  assert.equal(store.intentFollowupArrangements.some((item) => item.targetId === "ifq_noupdate"), false);

  const preview = await request("/api/intent-followup-queue/schedule", shirley, "POST", { targetType: "prospect", targetId: "ifq_preview", nextFollowAt: "2026-11-03 10:00" });
  assert.equal(preview.response.status, 409);
  assert.equal(preview.json.reason, "not_contactable");
  assert.equal(store.websiteOpportunities.find((item) => item.id === "ifq_preview")?.nextFollowAt || "", "");
  assert.equal(store.leads.length, leadsBefore + 2);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);

  setTenantTimezoneOverride(store, "europe", "America/New_York");
  const newYork = await request("/api/intent-followup-queue/schedule", shirley, "POST", { targetType: "lead", targetId: "ifq_lead" });
  assert.equal(newYork.response.status, 201);
  assert.equal(newYork.json.nextFollowAt, "2026-10-30 09:00");
  assert.equal(store.leads.find((item) => item.id === "ifq_lead")?.nextFollowAt, "2026-10-30 09:00");
  assert.equal(store.leads.find((item) => item.id === "ifq_lead")?.status, "following");
  const leadActivity = store.leadActivities.find((item) => item.id === newYork.json.activityId);
  assert.equal(leadActivity?.type, "call");
  assert.equal(leadActivity?.nextFollowAt, "2026-10-30 09:00");
  assert.equal(store.followUpAudits.some((item) => item.activityId === newYork.json.activityId), false);
  const leadAgain = await request("/api/intent-followup-queue/schedule", shirley, "POST", { targetType: "lead", targetId: "ifq_lead", nextFollowAt: "2026-12-02 09:00" });
  assert.equal(leadAgain.json.result, "duplicate");
  assert.equal(store.leads.find((item) => item.id === "ifq_lead")?.nextFollowAt, "2026-10-30 09:00");
  assert.equal(store.leadActivities.filter((item) => item.leadId === "ifq_lead").length, 1);

  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  store.aliyunOutboundConfigs.push({
    teamId: "europe",
    aliyunOutboundEnabled: false,
    instanceId: "",
    region: "",
    callerNumber: "",
    callWindowStart: "10:30",
    callWindowEnd: "18:00",
    maxCallsPerNumberPerDay: 3,
    minIntervalMinutes: 30,
    accessKeyIdEncrypted: "",
    accessKeySecretEncrypted: "",
    callbackPathTokenEncrypted: "",
    updatedBy: "ifq-test",
    updatedAt: ""
  });
  setOutboundNowForTests(new Date("2026-10-31T03:00:00.000Z"));
  const saturday = await request("/api/intent-followup-queue/schedule", shirley, "POST", { targetType: "prospect", targetId: "ifq_prospect" });
  assert.equal(saturday.response.status, 201);
  assert.equal(saturday.json.nextFollowAt, "2026-11-02 10:30");
  assert.match(saturday.json.suppressionNotice, /不改变抑制状态/);
  assert.equal(store.websiteOpportunities.find((item) => item.id === "ifq_prospect")?.nextFollowAt, "2026-11-02 10:30");
  assert.equal(store.websiteOpportunities.find((item) => item.id === "ifq_prospect")?.outreachState, "suppressed");
  assert.equal(store.followUpAudits.some((item) => item.activityId === saturday.json.activityId && item.objectType === "prospect_candidate"), true);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled, false);
  const prospectAgain = await request("/api/intent-followup-queue/schedule", shirley, "POST", { targetType: "prospect", targetId: "ifq_prospect" });
  assert.equal(prospectAgain.json.result, "duplicate");
  assert.equal(prospectAgain.json.nextFollowAt, "2026-11-02 10:30");

  const managerProspect = await request("/api/intent-followup-queue/schedule", alex, "POST", { targetType: "prospect", targetId: "ifq_preview", nextFollowAt: "2026-11-04 10:00" });
  assert.equal(managerProspect.response.status, 403);
  assert.equal(store.websiteOpportunities.find((item) => item.id === "ifq_preview")?.nextFollowAt || "", "");

  const leadsAtIgnore = store.leads.length;
  const activitiesAtIgnore = store.customerActivities.length;
  const decisionsAtIgnore = store.prospectContactabilityDecisions.length;
  const suppressionAtIgnore = store.prospectSuppressionEvents.length;
  const notIgnored = await request("/api/intent-followup-queue/restore", shirley, "POST", { targetType: "customer", targetId: "ifq_dismiss" });
  assert.equal(notIgnored.response.status, 409);
  assert.equal(notIgnored.json.reason, "not_ignored");
  assert.equal(store.intentFollowupQueueAudits.find((item) => item.action === "restore" && item.targetId === "ifq_dismiss")?.result, "rejected");
  const batchIgnore = await request("/api/intent-followup-queue/ignore", shirley, "POST", {
    targetType: "customer",
    targetId: "ifq_dismiss",
    records: ["ifq_dismiss"]
  });
  assert.equal(batchIgnore.response.status, 400);
  assert.equal(batchIgnore.json.reason, "invalid_request");
  assert.equal(store.intentFollowupIgnores.some((item) => item.targetId === "ifq_dismiss"), false);
  const batchRestore = await request("/api/intent-followup-queue/restore", shirley, "POST", ["ifq_dismiss"]);
  assert.equal(batchRestore.response.status, 400);

  const ignored = await request("/api/intent-followup-queue/ignore", shirley, "POST", { targetType: "customer", targetId: "ifq_dismiss" });
  assert.equal(ignored.response.status, 201);
  assert.equal(ignored.json.result, "created");
  assert.equal(ignored.json.action, "ignore");
  assert.equal(ignored.json.callRecordId, "ocr_ifq_dismiss");
  assert.equal(store.customers.find((item) => item.id === "ifq_dismiss")?.nextReminder, "");
  assert.equal(store.intentFollowupArrangements.some((item) => item.targetId === "ifq_dismiss"), false);
  const ignoreRow = store.intentFollowupIgnores.find((item) => item.targetId === "ifq_dismiss");
  assert.equal(ignoreRow?.active, true);
  assert.equal(ignoreRow?.callRecordId, "ocr_ifq_dismiss");
  assert.equal(ignoreRow?.teamId, "europe");
  assert.equal(ignoreRow?.actorId, shirleyUser.id);
  const ignoreAudit = store.intentFollowupQueueAudits.find((item) => item.action === "ignore" && item.targetId === "ifq_dismiss" && item.result === "created");
  assert.equal(ignoreAudit?.actorId, shirleyUser.id);
  assert.equal(ignoreAudit?.teamId, "europe");
  assert.equal(ignoreAudit?.at, "2026-10-31T03:00:00.000Z");
  assert.equal(ignoreAudit?.callRecordId, "ocr_ifq_dismiss");
  assert.equal(JSON.stringify(ignoreAudit || {}).includes("do-not-leak-ifq"), false);
  const afterIgnore = await request("/api/intent-followup-queue", shirley);
  assert.equal(ids(afterIgnore.json.items).includes("ifq_dismiss"), false);
  const withIgnored = await request("/api/intent-followup-queue?includeIgnored=1", shirley);
  assert.equal(withIgnored.json.items.find((item: { targetId: string }) => item.targetId === "ifq_dismiss")?.ignored, true);
  assert.equal(ids(withIgnored.json.items).includes("ifq_asia"), false);
  const duplicateIgnore = await request("/api/intent-followup-queue/ignore", shirley, "POST", { targetType: "customer", targetId: "ifq_dismiss" });
  assert.equal(duplicateIgnore.response.status, 200);
  assert.equal(duplicateIgnore.json.result, "duplicate");
  assert.equal(duplicateIgnore.json.action, "ignore");
  assert.equal(store.intentFollowupIgnores.filter((item) => item.targetId === "ifq_dismiss").length, 1);
  assert.equal(store.intentFollowupQueueAudits.find((item) => item.action === "ignore" && item.targetId === "ifq_dismiss" && item.result === "duplicate")?.actorId, shirleyUser.id);

  const dismissCall = store.outboundCallRecords.find((item) => item.id === "ocr_ifq_dismiss");
  assert.ok(dismissCall);
  dismissCall.callOutcome = "需回访";
  const relabeled = await request(`/api/intent-followup-queue?includeIgnored=1&outcome=${encodeURIComponent("需回访")}`, shirley);
  const relabeledRow = relabeled.json.items.find((item: { targetId: string }) => item.targetId === "ifq_dismiss");
  assert.equal(relabeledRow?.ignored, true);
  assert.equal(relabeledRow?.callRecordId, "ocr_ifq_dismiss");
  const hiddenRelabel = await request("/api/intent-followup-queue", shirley);
  assert.equal(ids(hiddenRelabel.json.items).includes("ifq_dismiss"), false);
  dismissCall.callOutcome = "有意向";

  const restored = await request("/api/intent-followup-queue/restore", shirley, "POST", { targetType: "customer", targetId: "ifq_dismiss" });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.json.result, "created");
  assert.equal(restored.json.action, "restore");
  assert.equal(store.intentFollowupIgnores.find((item) => item.targetId === "ifq_dismiss")?.active, false);
  const restoreAudit = store.intentFollowupQueueAudits.find((item) => item.action === "restore" && item.targetId === "ifq_dismiss" && item.result === "created");
  assert.equal(restoreAudit?.actorId, shirleyUser.id);
  assert.equal(restoreAudit?.teamId, "europe");
  assert.equal(restoreAudit?.callRecordId, "ocr_ifq_dismiss");
  assert.ok(restoreAudit?.at);
  const back = await request("/api/intent-followup-queue", shirley);
  assert.equal(ids(back.json.items).includes("ifq_dismiss"), true);
  assert.equal(back.json.items.find((item: { targetId: string }) => item.targetId === "ifq_dismiss")?.ignored, false);

  const ignoredAgain = await request("/api/intent-followup-queue/ignore", shirley, "POST", { targetType: "customer", targetId: "ifq_dismiss" });
  assert.equal(ignoredAgain.response.status, 201);
  store.outboundCallRecords.push(record({
    id: "ocr_ifq_dismiss_cold",
    targetType: "customer",
    targetId: "ifq_dismiss",
    callOutcome: "无意向",
    startTimeRaw: String(Date.parse("2026-10-22T02:00:00.000Z"))
  }));
  const stillIgnored = await request("/api/intent-followup-queue?includeIgnored=1", shirley);
  assert.equal(ids(stillIgnored.json.items).includes("ifq_dismiss"), false);
  store.outboundCallRecords.push(record({
    id: "ocr_ifq_dismiss_next",
    targetType: "customer",
    targetId: "ifq_dismiss",
    callOutcome: "有意向",
    startTimeRaw: String(Date.parse("2026-10-25T02:00:00.000Z")),
    updatedAt: "2026-10-25T02:00:00.000Z"
  }));
  const requeued = await request("/api/intent-followup-queue", shirley);
  const requeuedRow = requeued.json.items.find((item: { targetId: string }) => item.targetId === "ifq_dismiss");
  assert.equal(requeuedRow?.callRecordId, "ocr_ifq_dismiss_next");
  assert.equal(requeuedRow?.outcome, "有意向");
  assert.equal(requeuedRow?.ignored, false);
  assert.equal(store.intentFollowupIgnores.find((item) => item.targetId === "ifq_dismiss")?.active, true);
  assert.equal(store.intentFollowupIgnores.find((item) => item.targetId === "ifq_dismiss")?.callRecordId, "ocr_ifq_dismiss");

  const managerIgnore = await request("/api/intent-followup-queue/ignore", alex, "POST", { targetType: "customer", targetId: "ifq_mia" });
  assert.equal(managerIgnore.response.status, 201);
  assert.equal(managerIgnore.json.action, "ignore");
  const managerAfter = await request("/api/intent-followup-queue", alex);
  assert.equal(ids(managerAfter.json.items).includes("ifq_mia"), false);
  const managerShown = await request("/api/intent-followup-queue?includeIgnored=1", alex);
  assert.equal(managerShown.json.items.find((item: { targetId: string }) => item.targetId === "ifq_mia")?.ignored, true);
  const shirleyMissesMia = await request("/api/intent-followup-queue?includeIgnored=1", shirley);
  assert.equal(ids(shirleyMissesMia.json.items).includes("ifq_mia"), false);
  const managerUndo = await request("/api/intent-followup-queue/restore", alex, "POST", { targetType: "customer", targetId: "ifq_mia" });
  assert.equal(managerUndo.response.status, 200);
  assert.equal(store.intentFollowupQueueAudits.find((item) => item.action === "restore" && item.targetId === "ifq_mia" && item.result === "created")?.actorId, store.users.find((item) => item.email === "alex@keduoduo.com")?.id);
  const miaBack = await request("/api/intent-followup-queue", alex);
  assert.equal(ids(miaBack.json.items).includes("ifq_mia"), true);

  const noWriteIgnore = await request("/api/intent-followup-queue/ignore", noUpdate, "POST", { targetType: "customer", targetId: "ifq_noupdate" });
  assert.equal(noWriteIgnore.response.status, 201);
  assert.equal(store.customers.find((item) => item.id === "ifq_noupdate")?.nextReminder, "");
  assert.equal(store.intentFollowupArrangements.some((item) => item.targetId === "ifq_noupdate"), false);
  const publicIgnore = await request("/api/intent-followup-queue/ignore", shirley, "POST", { targetType: "customer", targetId: "ifq_public" });
  assert.equal(publicIgnore.response.status, 201);
  assert.equal(store.customers.find((item) => item.id === "ifq_public")?.nextReminder, "");
  assert.equal(store.customers.find((item) => item.id === "ifq_public")?.poolStatus, "public");
  const previewIgnore = await request("/api/intent-followup-queue/ignore", shirley, "POST", { targetType: "prospect", targetId: "ifq_preview" });
  assert.equal(previewIgnore.response.status, 201);
  assert.equal(store.websiteOpportunities.find((item) => item.id === "ifq_preview")?.nextFollowAt || "", "");
  assert.equal(store.leads.length, leadsAtIgnore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsAtIgnore);
  const openIgnore = await request("/api/intent-followup-queue/ignore", shirley, "POST", { targetType: "customer", targetId: "ifq_open" });
  assert.equal(openIgnore.response.status, 409);
  assert.equal(openIgnore.json.reason, "already_has_follow_up");
  assert.equal(store.customers.find((item) => item.id === "ifq_open")?.nextReminder, "不要改");
  const coldIgnore = await request("/api/intent-followup-queue/ignore", shirley, "POST", { targetType: "customer", targetId: "ifq_cold" });
  assert.equal(coldIgnore.response.status, 409);
  assert.equal(coldIgnore.json.reason, "not_eligible");
  assert.equal(store.customerActivities.length, activitiesAtIgnore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionAtIgnore);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_ifq_intent")?.callOutcome, "有意向");

  assert.equal(aliyunHits, 0);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.outreachSequences.length, sequencesBefore);
  assert.equal(store.prospectOutreachPlans.length, plansBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  assert.equal(store.customers.find((item) => item.id === "c1")?.nextReminder, "已逾期");
  assert.equal(JSON.stringify(store.intentFollowupQueueAudits).includes("do-not-leak-ifq"), false);
  assert.equal(JSON.stringify(store.intentFollowupQueueAudits).includes("AccessKey"), false);
  assert.equal(JSON.stringify(store.intentFollowupQueueAudits).includes("aliyuncs"), false);
  assert.ok(store.customerActivities.length > activitiesBefore);
  assert.ok(store.leadActivities.length > leadActivitiesBefore);
  assert.ok(store.followUpAudits.length > followAuditsBefore);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_ifq_intent")?.callOutcome, "有意向");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_ifq_intent")?.recordingUrl.includes("do-not-leak-ifq"), true);

  console.log("intent follow-up queue http tests passed");
} finally {
  const store = getStore();
  setOutboundNowForTests(undefined);
  setTenantTimezoneOverride(store, "europe", undefined);
  store.customers = store.customers.filter((item) => !item.id.startsWith("ifq_"));
  store.leads = store.leads.filter((item) => !item.id.startsWith("ifq_"));
  store.users = store.users.filter((item) => !item.id.startsWith("u_ifq_"));
  store.websiteOpportunities = store.websiteOpportunities.filter((item) => !item.id.startsWith("ifq_"));
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_ifq_"));
  store.callOutcomeAudits = store.callOutcomeAudits.filter((item) => !item.id.startsWith("coa_ifq_"));
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_ifq_"));
  store.aliyunOutboundConfigs = store.aliyunOutboundConfigs.filter((item) => item.updatedBy !== "ifq-test");
  store.intentFollowupArrangements = store.intentFollowupArrangements.filter((item) => !item.targetId.startsWith("ifq_"));
  store.intentFollowupIgnores = store.intentFollowupIgnores.filter((item) => !item.targetId.startsWith("ifq_"));
  store.intentFollowupQueueAudits = store.intentFollowupQueueAudits.filter((item) => !item.targetId.startsWith("ifq_") && item.reason !== "invalid_request");
  store.customerActivities = store.customerActivities.filter((item) => !item.content.startsWith("通话结果为"));
  store.leadActivities = store.leadActivities.filter((item) => !item.content.startsWith("通话结果为"));
  store.followUpAudits = store.followUpAudits.filter((item) => !item.objectId.startsWith("ifq_"));
  globalThis.fetch = originalFetch;
  server.close();
}
