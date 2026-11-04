import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import { suggestedMissedFollowAt } from "./outbound-missed-follow-up.js";
import type { AliyunAgentMapping, OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start other outcome follow-up test server");
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

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "targetType" | "targetId">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    maskedNumber: "****8000",
    contactType: "OUTBOUND",
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: "2000",
    agentIds: "agent@ccc-oof-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://secret.example/rec",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "其他",
    callOutcomeNote: "",
    callNote: "",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
    ...partial
  };
}

try {
  const store = getStore();
  setOutboundNowForTests(new Date("2026-11-04T02:30:00.000Z"));
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const alexUser = store.users.find((item) => item.email === "alex@keduoduo.com");
  assert.ok(shirleyUser && miaUser && alexUser);
  store.users.push({
    ...shirleyUser,
    id: "u_oof_no_read",
    name: "No Read",
    email: "no-oof-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_oof_no_update",
    name: "No Update",
    email: "no-oof-update@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    if (actor.id !== "u_oof_no_read" && actor.id !== "u_oof_no_update") return snapshot;
    const permissions = { ...snapshot.permissions };
    if (actor.id === "u_oof_no_read") delete permissions["communication.read"];
    if (actor.id === "u_oof_no_update") delete permissions["customer.update"];
    return { ...snapshot, permissions };
  };
  const noRead = await login("no-oof-read@keduoduo.com");
  const noUpdate = await login("no-oof-update@keduoduo.com");
  const mapping = (partial: Partial<AliyunAgentMapping> & Pick<AliyunAgentMapping, "crmUserId" | "cccUserId">): AliyunAgentMapping => ({
    id: `map_${partial.cccUserId}`,
    teamId: "europe",
    loginName: "",
    displayName: partial.displayName || "",
    extension: "",
    workMode: "",
    updatedBy: "",
    updatedAt: "",
    ...partial
  });
  store.aliyunAgentMappings.push(
    mapping({ crmUserId: shirleyUser.id, cccUserId: "agent@ccc-oof-a", displayName: "Shirley坐席" }),
    mapping({ crmUserId: "u_oof_no_update", cccUserId: "agent@ccc-oof-noupdate", displayName: "No Update坐席" }),
    mapping({ crmUserId: miaUser.id, cccUserId: "agent@ccc-oof-b", displayName: "Mia坐席" })
  );
  const customerTemplate = store.customers.find((item) => item.id === "c1");
  const leadTemplate = store.leads.find((item) => item.id === "l1");
  const prospectTemplate = store.websiteOpportunities.find((item) => item.id === "web_seed_1");
  assert.ok(customerTemplate && leadTemplate && prospectTemplate);
  const customer = (id: string, extra: Partial<typeof customerTemplate>) => {
    store.customers.push({
      ...customerTemplate,
      company: id,
      teamId: "europe",
      nextReminder: "",
      poolStatus: "owned",
      ownerId: shirleyUser.id,
      ...extra,
      id
    });
  };
  customer("c_oof_open", { company: "Nordic <Tools>" });
  customer("c_oof_blank", { nextReminder: "   " });
  customer("c_oof_has", { nextReminder: "下周" });
  customer("c_oof_miss", {});
  customer("c_oof_pool", { poolStatus: "public", nextReminder: "" });
  customer("c_oof_old", {});
  customer("c_oof_space", {});
  customer("c_oof_disp", {});
  customer("c_oof_mia", { ownerId: alexUser.id });
  customer("c_oof_noupdate", { ownerId: "u_oof_no_update" });
  customer("c_oof_suggest", {});
  customer("c_oof_bad", {});
  store.leads.push({
    ...leadTemplate,
    id: "l_oof_ok",
    company: "其他线索",
    teamId: "europe",
    ownerId: shirleyUser.id,
    nextFollowAt: "",
    deletedAt: ""
  }, {
    ...leadTemplate,
    id: "l_oof_deleted",
    company: "已删除线索",
    teamId: "europe",
    ownerId: shirleyUser.id,
    nextFollowAt: "",
    deletedAt: "2026-11-01T00:00:00.000Z"
  }, {
    ...leadTemplate,
    id: "l_oof_sync",
    company: "同步线索",
    teamId: "europe",
    ownerId: shirleyUser.id,
    nextFollowAt: "",
    deletedAt: ""
  });
  store.websiteOpportunities.push({
    ...prospectTemplate,
    id: "p_oof_excluded",
    company: "已排除",
    teamId: "europe",
    ownerId: shirleyUser.id,
    status: "excluded",
    leadId: "",
    nextFollowAt: "",
    outreachState: "uncontacted"
  }, {
    ...prospectTemplate,
    id: "p_oof_suppressed",
    company: "已抑制",
    teamId: "europe",
    ownerId: shirleyUser.id,
    status: "contacted",
    leadId: "",
    nextFollowAt: "",
    outreachState: "suppressed"
  }, {
    ...prospectTemplate,
    id: "p_oof_sync",
    company: "已转入",
    teamId: "europe",
    ownerId: shirleyUser.id,
    status: "contacted",
    leadId: "l_oof_sync",
    nextFollowAt: "",
    outreachState: "uncontacted"
  });
  store.callOutcomeAudits.push({
    id: "coa_oof_open",
    teamId: "europe",
    actorId: shirleyUser.id,
    at: "2026-11-04T01:00:00.000Z",
    callRecordId: "ocr_oof_open",
    previousOutcome: "",
    nextOutcome: "其他",
    previousNote: "",
    nextNote: ""
  });
  store.outboundCallRecords.push(
    record({ id: "ocr_oof_open_old", targetType: "customer", targetId: "c_oof_open", callOutcome: "无意向", startTimeRaw: "1000", establishedTimeRaw: "", maskedNumber: "13800138000" }),
    record({ id: "ocr_oof_open", targetType: "customer", targetId: "c_oof_open", callOutcome: "其他", startTimeRaw: "3000", maskedNumber: "13800138000" }),
    record({ id: "ocr_oof_blank", targetType: "customer", targetId: "c_oof_blank", startTimeRaw: "2900", createdAt: "", updatedAt: "" }),
    record({ id: "ocr_oof_has", targetType: "customer", targetId: "c_oof_has", startTimeRaw: "2800" }),
    record({ id: "ocr_oof_miss", targetType: "customer", targetId: "c_oof_miss", startTimeRaw: "2700", contactDisposition: "NoAnswer", establishedTimeRaw: "" }),
    record({ id: "ocr_oof_pool", targetType: "customer", targetId: "c_oof_pool", startTimeRaw: "2600" }),
    record({ id: "ocr_oof_old_other", targetType: "customer", targetId: "c_oof_old", startTimeRaw: "1000" }),
    record({ id: "ocr_oof_old_new", targetType: "customer", targetId: "c_oof_old", callOutcome: "有意向", startTimeRaw: "4000" }),
    record({ id: "ocr_oof_space", targetType: "customer", targetId: "c_oof_space", establishedTimeRaw: "   ", startTimeRaw: "2500" }),
    record({ id: "ocr_oof_disp", targetType: "customer", targetId: "c_oof_disp", callOutcome: "", contactDisposition: "Success", startTimeRaw: "2500" }),
    record({ id: "ocr_oof_mia", targetType: "customer", targetId: "c_oof_mia", agentIds: "agent@ccc-oof-b", startTimeRaw: "2400" }),
    record({ id: "ocr_oof_noupdate", targetType: "customer", targetId: "c_oof_noupdate", agentIds: "agent@ccc-oof-noupdate", startTimeRaw: "2300" }),
    record({ id: "ocr_oof_suggest", targetType: "customer", targetId: "c_oof_suggest", startTimeRaw: "2200" }),
    record({ id: "ocr_oof_bad", targetType: "customer", targetId: "c_oof_bad", startTimeRaw: "2100" }),
    record({ id: "ocr_oof_lead", targetType: "lead", targetId: "l_oof_ok", startTimeRaw: "2000", createdAt: "", updatedAt: "" }),
    record({ id: "ocr_oof_deleted", targetType: "lead", targetId: "l_oof_deleted", startTimeRaw: "1900" }),
    record({ id: "ocr_oof_excluded", targetType: "prospect", targetId: "p_oof_excluded", startTimeRaw: "1800" }),
    record({ id: "ocr_oof_suppressed", targetType: "prospect", targetId: "p_oof_suppressed", startTimeRaw: "1700" }),
    record({ id: "ocr_oof_sync", targetType: "prospect", targetId: "p_oof_sync", startTimeRaw: "1600" }),
    record({ id: "ocr_oof_asia", teamId: "asia", targetType: "customer", targetId: "c_asia", startTimeRaw: "3000", maskedNumber: "不要出现" })
  );

  const activitiesBefore = store.customerActivities.length;
  const leadActivitiesBefore = store.leadActivities.length;
  const leadsBefore = store.leads.length;
  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions);
  const callAuditsBefore = store.outboundCallAudits.length;
  const outcomeBefore = store.outboundCallRecords.find((item) => item.id === "ocr_oof_open")?.callOutcome;
  const establishedBefore = store.outboundCallRecords.find((item) => item.id === "ocr_oof_open")?.establishedTimeRaw;

  const mine = await request("/api/other-outcome-followups?scope=mine", shirley);
  assert.equal(mine.response.status, 200);
  assert.equal(mine.json.scope, "mine");
  assert.equal(mine.json.empty, false);
  assert.equal("connectRate" in mine.json, false);
  const mineIds = mine.json.items.map((item: { targetId: string }) => item.targetId);
  for (const id of ["c_oof_open", "c_oof_blank", "c_oof_pool", "c_oof_suggest", "c_oof_bad", "l_oof_ok", "p_oof_excluded", "p_oof_suppressed", "p_oof_sync"]) {
    assert.equal(mineIds.includes(id), true, id);
  }
  for (const id of ["c_oof_has", "c_oof_miss", "c_oof_old", "c_oof_space", "c_oof_disp", "c_oof_mia", "c_oof_noupdate", "l_oof_deleted", "l_oof_sync"]) {
    assert.equal(mineIds.includes(id), false, id);
  }
  const open = mine.json.items.find((item: { targetId: string }) => item.targetId === "c_oof_open");
  assert.equal(open.outcome, "其他");
  assert.equal(open.labeledAt, "2026-11-04T01:00:00.000Z");
  assert.equal(open.nextFollowAt, "");
  assert.equal(open.name, "Nordic <Tools>");
  assert.equal(String(open.maskedNumber).includes("13800138000"), false);
  assert.equal(JSON.stringify(open).includes("secret.example"), false);
  const blank = mine.json.items.find((item: { targetId: string }) => item.targetId === "c_oof_blank");
  assert.equal(blank.labeledAt, "");
  const suppressed = mine.json.items.find((item: { targetId: string }) => item.targetId === "p_oof_suppressed");
  assert.match(suppressed.suppressionNotice, /不改变抑制状态/);
  assert.equal(store.otherOutcomeFollowupAudits.some((item) => item.actorId === shirleyUser.id && item.action === "read" && item.result === "read" && item.rowCount === mine.json.items.length), true);

  const again = await request("/api/other-outcome-followups?scope=mine", shirley);
  assert.equal(again.response.status, 200);
  assert.equal(store.otherOutcomeFollowupAudits.filter((item) => item.actorId === shirleyUser.id && item.action === "read" && item.result === "read").length, 2);

  const teamDenied = await request("/api/other-outcome-followups?scope=team", shirley);
  assert.equal(teamDenied.response.status, 403);
  assert.equal(store.otherOutcomeFollowupAudits.some((item) => item.actorId === shirleyUser.id && item.action === "read" && item.scope === "team" && item.result === "rejected" && item.reason === "forbidden"), true);
  const miaTeam = await request("/api/other-outcome-followups?scope=team", mia);
  assert.equal(miaTeam.response.status, 403);
  const alexTeam = await request("/api/other-outcome-followups?scope=team", alex);
  assert.equal(alexTeam.response.status, 200);
  assert.equal(alexTeam.json.items.some((item: { targetId: string }) => item.targetId === "c_oof_mia"), true);
  const adminTeam = await request("/api/other-outcome-followups?scope=team", admin);
  assert.equal(adminTeam.response.status, 200);
  assert.equal(adminTeam.json.items.some((item: { targetId: string }) => item.targetId === "c_oof_mia"), true);

  const auditsAfterOk = store.otherOutcomeFollowupAudits.length;
  assert.equal((await request("/api/other-outcome-followups?scope=all", shirley)).response.status, 400);
  assert.equal((await request("/api/other-outcome-followups?scope=mine&outcome=%E5%85%B6%E4%BB%96", shirley)).response.status, 400);
  assert.equal((await request("/api/other-outcome-followups?scope=mine", "")).response.status, 401);
  assert.equal((await request("/api/other-outcome-followups?scope=mine", noRead)).response.status, 403);
  assert.equal(store.otherOutcomeFollowupAudits.length, auditsAfterOk);

  const pooled = await request("/api/other-outcome-followups/schedule", shirley, "POST", { targetType: "customer", targetId: "c_oof_pool" });
  assert.equal(pooled.response.status, 409);
  assert.equal(pooled.json.reason, "public_pool");
  assert.equal(store.customers.find((item) => item.id === "c_oof_pool")?.nextReminder, "");
  assert.equal(store.otherOutcomeFollowupAudits.some((item) => item.action === "schedule" && item.targetId === "c_oof_pool" && item.result === "rejected" && item.reason === "public_pool" && item.nextFollowAt === ""), true);

  const excluded = await request("/api/other-outcome-followups/schedule", shirley, "POST", { targetType: "prospect", targetId: "p_oof_excluded", nextFollowAt: "2026-11-06 09:00" });
  assert.equal(excluded.response.status, 409);
  assert.equal(excluded.json.reason, "not_contactable");
  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_oof_excluded")?.nextFollowAt, "");

  const noUpdateSchedule = await request("/api/other-outcome-followups/schedule", noUpdate, "POST", { targetType: "customer", targetId: "c_oof_noupdate" });
  assert.equal(noUpdateSchedule.response.status, 403);
  assert.equal(store.customers.find((item) => item.id === "c_oof_noupdate")?.nextReminder, "");
  assert.equal(store.otherOutcomeFollowupAudits.some((item) => item.actorId === "u_oof_no_update" && item.action === "schedule" && item.result === "rejected" && item.reason === "forbidden" && item.nextFollowAt === ""), true);

  const badTime = await request("/api/other-outcome-followups/schedule", shirley, "POST", { targetType: "customer", targetId: "c_oof_bad", nextFollowAt: "明天" });
  assert.equal(badTime.response.status, 400);
  assert.equal(badTime.json.reason, "invalid_request");
  assert.equal(store.customers.find((item) => item.id === "c_oof_bad")?.nextReminder, "");
  assert.equal(store.otherOutcomeFollowupAudits.some((item) => item.action === "schedule" && item.targetId === "c_oof_bad" && item.result === "rejected" && item.reason === "invalid_request" && item.nextFollowAt === ""), true);

  const hidden = await request("/api/other-outcome-followups/schedule", shirley, "POST", { targetType: "customer", targetId: "c_oof_mia", nextFollowAt: "2026-11-06 09:00" });
  assert.equal(hidden.response.status, 400);
  assert.equal(hidden.json.reason, "not_pending");
  assert.equal(store.customers.find((item) => item.id === "c_oof_mia")?.nextReminder, "");
  const hiddenAudits = store.otherOutcomeFollowupAudits.filter((item) => item.action === "schedule" && item.targetId === "c_oof_mia").length;

  const adminSchedule = await request("/api/other-outcome-followups/schedule", admin, "POST", { targetType: "customer", targetId: "c_oof_mia", nextFollowAt: "2026-11-06 15:30" });
  assert.equal(adminSchedule.response.status, 200);
  assert.equal(adminSchedule.json.nextFollowAt, "2026-11-06 15:30");
  assert.equal(store.customers.find((item) => item.id === "c_oof_mia")?.nextReminder, "2026-11-06 15:30");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_oof_mia")?.callOutcome, "其他");
  const afterAdmin = await request("/api/other-outcome-followups?scope=team", alex);
  assert.equal(afterAdmin.json.items.some((item: { targetId: string }) => item.targetId === "c_oof_mia"), false);

  const suggested = await suggestedMissedFollowAt(store, "europe", new Date("2026-11-04T02:30:00.000Z"));
  const suggestedResult = await request("/api/other-outcome-followups/schedule", shirley, "POST", { targetType: "customer", targetId: "c_oof_suggest" });
  assert.equal(suggestedResult.response.status, 200);
  assert.equal(suggestedResult.json.nextFollowAt, suggested);
  assert.equal(store.customers.find((item) => item.id === "c_oof_suggest")?.nextReminder, suggested);
  assert.equal(suggestedResult.json.message, "已记下下次跟进");

  const saved = await request("/api/other-outcome-followups/schedule", shirley, "POST", { targetType: "customer", targetId: "c_oof_open", nextFollowAt: "2026-11-06 09:00" });
  assert.equal(saved.response.status, 200);
  assert.equal(store.customers.find((item) => item.id === "c_oof_open")?.nextReminder, "2026-11-06 09:00");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_oof_open")?.callOutcome, outcomeBefore);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_oof_open")?.establishedTimeRaw, establishedBefore);
  const duplicate = await request("/api/other-outcome-followups/schedule", shirley, "POST", { targetType: "customer", targetId: "c_oof_open", nextFollowAt: "2026-11-07 09:00" });
  assert.equal(duplicate.response.status, 400);
  assert.equal(duplicate.json.reason, "not_pending");
  assert.equal(store.customers.find((item) => item.id === "c_oof_open")?.nextReminder, "2026-11-06 09:00");
  assert.equal(store.otherOutcomeFollowupAudits.filter((item) => item.action === "schedule" && item.targetId === "c_oof_open" && item.result === "updated").length, 1);
  assert.equal(store.otherOutcomeFollowupAudits.filter((item) => item.action === "schedule" && item.targetId === "c_oof_mia").length, hiddenAudits + 1);

  const leadSaved = await request("/api/other-outcome-followups/schedule", shirley, "POST", { targetType: "lead", targetId: "l_oof_ok", nextFollowAt: "2026-11-08 10:00" });
  assert.equal(leadSaved.response.status, 200);
  assert.equal(store.leads.find((item) => item.id === "l_oof_ok")?.nextFollowAt, "2026-11-08 10:00");

  const held = await request("/api/other-outcome-followups/schedule", shirley, "POST", { targetType: "prospect", targetId: "p_oof_suppressed", nextFollowAt: "2026-11-09 11:00" });
  assert.equal(held.response.status, 200);
  assert.match(held.json.suppressionNotice, /不改变抑制状态/);
  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_oof_suppressed")?.nextFollowAt, "2026-11-09 11:00");
  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_oof_suppressed")?.outreachState, "suppressed");

  const synced = await request("/api/other-outcome-followups/schedule", shirley, "POST", { targetType: "prospect", targetId: "p_oof_sync", nextFollowAt: "2026-11-10 12:00" });
  assert.equal(synced.response.status, 200);
  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_oof_sync")?.nextFollowAt, "2026-11-10 12:00");
  assert.equal(store.leads.find((item) => item.id === "l_oof_sync")?.nextFollowAt, "2026-11-10 12:00");

  const beforeBatch = store.otherOutcomeFollowupAudits.length;
  const batch = await request("/api/other-outcome-followups/schedule", shirley, "POST", { targetType: "customer", targetId: "c_oof_blank", targets: ["c_oof_blank"] });
  assert.equal(batch.response.status, 400);
  assert.equal((await request("/api/other-outcome-followups/schedule", shirley, "POST", { targetType: "customer", targetId: "c_oof_blank", note: "x" })).response.status, 400);
  assert.equal((await request("/api/other-outcome-followups/schedule", "", "POST", { targetType: "customer", targetId: "c_oof_blank" })).response.status, 401);
  assert.equal((await request("/api/other-outcome-followups/schedule", noRead, "POST", { targetType: "customer", targetId: "c_oof_blank" })).response.status, 403);
  assert.equal(store.otherOutcomeFollowupAudits.length, beforeBatch);
  assert.equal(store.customers.find((item) => item.id === "c_oof_blank")?.nextReminder, "   ");

  assert.equal(store.leads.length, leadsBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.leadActivities.length, leadActivitiesBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), false);
  assert.equal(aliyunHits, 0);
  const auditText = JSON.stringify(store.otherOutcomeFollowupAudits);
  assert.equal(auditText.includes("13800138000"), false);
  assert.equal(auditText.includes("不要出现"), false);
  assert.equal(auditText.includes("secret.example"), false);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("明天"), false);
  console.log("other outcome follow-up http tests passed");
} finally {
  setOutboundNowForTests(undefined);
  const store = getStore();
  setTenantTimezoneOverride(store, "europe", undefined);
  globalThis.fetch = originalFetch;
  server.close();
}
