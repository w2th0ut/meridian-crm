import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { AliyunAgentMapping, OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start missing next follow-up batch test server");
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
    agentIds: "agent@ccc-mnb-a",
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
  const admin = await login("admin@keduoduo.com");
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  assert.ok(shirleyUser && miaUser);
  store.users.push({
    ...shirleyUser,
    id: "u_mnb_no_read",
    name: "No Read",
    email: "no-mnb-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_mnb_no_update",
    name: "No Update",
    email: "no-mnb-update@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    if (actor.id !== "u_mnb_no_read" && actor.id !== "u_mnb_no_update") return snapshot;
    const permissions = { ...snapshot.permissions };
    if (actor.id === "u_mnb_no_read") delete permissions["communication.read"];
    if (actor.id === "u_mnb_no_update") delete permissions["customer.update"];
    return { ...snapshot, permissions };
  };
  const noRead = await login("no-mnb-read@keduoduo.com");
  const noUpdate = await login("no-mnb-update@keduoduo.com");
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
    mapping({ crmUserId: shirleyUser.id, cccUserId: "agent@ccc-mnb-a", displayName: "Shirley坐席" }),
    mapping({ crmUserId: "u_mnb_no_update", cccUserId: "agent@ccc-mnb-noupdate", displayName: "No Update坐席" }),
    mapping({ crmUserId: miaUser.id, cccUserId: "agent@ccc-mnb-b", displayName: "Mia坐席" })
  );
  const customerTemplate = store.customers.find((item) => item.id === "c1");
  const leadTemplate = store.leads.find((item) => item.id === "l1");
  const prospectTemplate = store.websiteOpportunities.find((item) => item.id === "web_seed_1");
  assert.ok(customerTemplate && leadTemplate && prospectTemplate);
  const customer = (id: string, extra: Partial<typeof customerTemplate> = {}) => {
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
  customer("c_mnb_other", { company: "Nordic <Tools>" });
  customer("c_mnb_intent");
  customer("c_mnb_miss");
  customer("c_mnb_unlabeled");
  customer("c_mnb_has", { nextReminder: "下周" });
  customer("c_mnb_pool", { poolStatus: "public" });
  customer("c_mnb_plain");
  customer("c_mnb_mia", { ownerId: miaUser.id });
  customer("c_mnb_noupdate", { ownerId: "u_mnb_no_update" });
  store.leads.push({
    ...leadTemplate,
    id: "l_mnb_ok",
    company: "批量线索",
    teamId: "europe",
    ownerId: shirleyUser.id,
    nextFollowAt: "",
    status: "new",
    deletedAt: ""
  }, {
    ...leadTemplate,
    id: "l_mnb_sync",
    company: "同步线索",
    teamId: "europe",
    ownerId: shirleyUser.id,
    nextFollowAt: "",
    status: "new",
    deletedAt: ""
  });
  store.websiteOpportunities.push({
    ...prospectTemplate,
    id: "p_mnb_ok",
    company: "可联系搜客",
    teamId: "europe",
    ownerId: shirleyUser.id,
    status: "contacted",
    leadId: "l_mnb_sync",
    nextFollowAt: "",
    outreachState: "uncontacted"
  }, {
    ...prospectTemplate,
    id: "p_mnb_excluded",
    company: "已排除",
    teamId: "europe",
    ownerId: shirleyUser.id,
    status: "excluded",
    leadId: "",
    nextFollowAt: "",
    outreachState: "uncontacted"
  }, {
    ...prospectTemplate,
    id: "p_mnb_suppressed",
    company: "已抑制",
    teamId: "europe",
    ownerId: shirleyUser.id,
    status: "contacted",
    leadId: "",
    nextFollowAt: "",
    outreachState: "suppressed"
  });
  store.outboundCallRecords.push(
    record({ id: "ocr_mnb_other", targetType: "customer", targetId: "c_mnb_other", maskedNumber: "13800138000" }),
    record({ id: "ocr_mnb_intent", targetType: "customer", targetId: "c_mnb_intent", callOutcome: "有意向", startTimeRaw: "3100" }),
    record({ id: "ocr_mnb_miss", targetType: "customer", targetId: "c_mnb_miss", callOutcome: "", establishedTimeRaw: "", startTimeRaw: "3000" }),
    record({ id: "ocr_mnb_unlabeled", targetType: "customer", targetId: "c_mnb_unlabeled", callOutcome: "", startTimeRaw: "2900" }),
    record({ id: "ocr_mnb_has", targetType: "customer", targetId: "c_mnb_has", startTimeRaw: "2800" }),
    record({ id: "ocr_mnb_pool", targetType: "customer", targetId: "c_mnb_pool", startTimeRaw: "2700" }),
    record({ id: "ocr_mnb_plain", targetType: "customer", targetId: "c_mnb_plain", startTimeRaw: "2600" }),
    record({ id: "ocr_mnb_mia", targetType: "customer", targetId: "c_mnb_mia", agentIds: "agent@ccc-mnb-b", startTimeRaw: "2500" }),
    record({ id: "ocr_mnb_noupdate", targetType: "customer", targetId: "c_mnb_noupdate", agentIds: "agent@ccc-mnb-noupdate", startTimeRaw: "2400" }),
    record({ id: "ocr_mnb_lead", targetType: "lead", targetId: "l_mnb_ok", startTimeRaw: "2300" }),
    record({ id: "ocr_mnb_prospect", targetType: "prospect", targetId: "p_mnb_ok", startTimeRaw: "2200" }),
    record({ id: "ocr_mnb_excluded", targetType: "prospect", targetId: "p_mnb_excluded", startTimeRaw: "2100" }),
    record({ id: "ocr_mnb_suppressed", targetType: "prospect", targetId: "p_mnb_suppressed", startTimeRaw: "2000" })
  );

  const when = "2026-11-06 09:00";
  const note = "改日再联系";
  const batchPath = "/api/missing-next-followups/schedule";
  const one = (targetType: string, targetId: string) => ({ targetType, targetId });
  const activitiesBefore = store.customerActivities.length;
  const leadActivitiesBefore = store.leadActivities.length;
  const leadsBefore = store.leads.length;
  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents || []);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions || []);
  const enabledBefore = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled;
  const outcomeBefore = store.outboundCallRecords.find((item) => item.id === "ocr_mnb_other")?.callOutcome;
  const establishedBefore = store.outboundCallRecords.find((item) => item.id === "ocr_mnb_other")?.establishedTimeRaw;

  const auditsAt = () => store.nextFollowUpAudits.length;
  const unchanged = (id: string) => store.customers.find((item) => item.id === id)?.nextReminder || "";

  const invalid = await request(batchPath, shirley, "POST", { targets: [], nextFollowAt: when });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.json.reason, "invalid_request");
  const tooMany = await request(batchPath, shirley, "POST", {
    targets: Array.from({ length: 101 }, (_, index) => one("customer", `c_mnb_${index}`)),
    nextFollowAt: when
  });
  assert.equal(tooMany.response.status, 400);
  assert.equal(tooMany.json.reason, "too_many");
  const duplicate = await request(batchPath, shirley, "POST", {
    targets: [one("customer", "c_mnb_other"), one("customer", "c_mnb_other")],
    nextFollowAt: when
  });
  assert.equal(duplicate.response.status, 400);
  const badTime = await request(batchPath, shirley, "POST", {
    targets: [one("customer", "c_mnb_other")],
    nextFollowAt: "明天"
  });
  assert.equal(badTime.response.status, 400);
  const longNote = await request(batchPath, shirley, "POST", {
    targets: [one("customer", "c_mnb_other")],
    nextFollowAt: when,
    note: "字".repeat(201)
  });
  assert.equal(longNote.response.status, 400);
  assert.equal(longNote.json.reason, "note_too_long");
  const extra = await request(batchPath, shirley, "POST", {
    targets: [one("customer", "c_mnb_other")],
    nextFollowAt: when,
    records: ["ocr_mnb_other"]
  });
  assert.equal(extra.response.status, 400);
  assert.equal(unchanged("c_mnb_other"), "");

  const beforeHidden = auditsAt();
  const hidden = await request(batchPath, shirley, "POST", {
    targets: [one("customer", "c_mnb_other"), one("customer", "c_mnb_mia")],
    nextFollowAt: when,
    note
  });
  assert.equal(hidden.response.status, 404);
  assert.equal(hidden.json.reason, "not_found");
  assert.equal(unchanged("c_mnb_other"), "");
  assert.equal(unchanged("c_mnb_mia"), "");
  assert.equal(auditsAt(), beforeHidden);

  const beforePending = auditsAt();
  const notPending = await request(batchPath, shirley, "POST", {
    targets: [one("customer", "c_mnb_other"), one("customer", "c_mnb_has")],
    nextFollowAt: when,
    note
  });
  assert.equal(notPending.response.status, 400);
  assert.equal(notPending.json.reason, "not_pending");
  assert.equal(unchanged("c_mnb_other"), "");
  assert.equal(store.customers.find((item) => item.id === "c_mnb_has")?.nextReminder, "下周");
  assert.equal(auditsAt(), beforePending);

  const beforePool = auditsAt();
  const pooled = await request(batchPath, shirley, "POST", {
    targets: [one("customer", "c_mnb_other"), one("customer", "c_mnb_pool")],
    nextFollowAt: when,
    note
  });
  assert.equal(pooled.response.status, 409);
  assert.equal(pooled.json.reason, "public_pool");
  assert.equal(unchanged("c_mnb_other"), "");
  assert.equal(unchanged("c_mnb_pool"), "");
  const poolAudit = store.nextFollowUpAudits.find((item) => item.objectId === "c_mnb_pool");
  assert.equal(poolAudit?.action, "batch_reject_public_pool");
  assert.equal(poolAudit?.oldValue, "");
  assert.equal(poolAudit?.newValue, "");
  assert.equal(Boolean(poolAudit?.batchId), true);
  assert.equal(store.nextFollowUpAudits.some((item) => item.objectId === "c_mnb_other" && item.action === "batch_set_next_follow_up"), false);
  assert.equal(auditsAt(), beforePool + 1);

  const beforeExcluded = auditsAt();
  const excluded = await request(batchPath, shirley, "POST", {
    targets: [one("prospect", "p_mnb_ok"), one("prospect", "p_mnb_excluded")],
    nextFollowAt: when,
    note
  });
  assert.equal(excluded.response.status, 409);
  assert.equal(excluded.json.reason, "not_contactable");
  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_mnb_ok")?.nextFollowAt, "");
  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_mnb_excluded")?.nextFollowAt, "");
  assert.equal(store.nextFollowUpAudits.some((item) => item.objectId === "p_mnb_excluded" && item.action === "batch_reject_not_contactable"), true);
  assert.equal(auditsAt(), beforeExcluded + 1);

  const beforeDenied = auditsAt();
  const denied = await request(batchPath, noUpdate, "POST", {
    targets: [one("customer", "c_mnb_noupdate")],
    nextFollowAt: when,
    note
  });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.reason, "forbidden");
  assert.equal(unchanged("c_mnb_noupdate"), "");
  assert.equal(store.nextFollowUpAudits.some((item) => item.objectId === "c_mnb_noupdate" && item.action === "batch_reject_forbidden" && item.newValue === ""), true);
  assert.equal(auditsAt(), beforeDenied + 1);

  const beforeRead = auditsAt();
  const unread = await request(batchPath, noRead, "POST", {
    targets: [one("customer", "c_mnb_other")],
    nextFollowAt: when
  });
  assert.equal(unread.response.status, 403);
  assert.equal(auditsAt(), beforeRead);
  const anon = await request(batchPath, "", "POST", {
    targets: [one("customer", "c_mnb_other")],
    nextFollowAt: when
  });
  assert.equal(anon.response.status, 401);

  const single = await request("/api/other-outcome-followups/schedule", shirley, "POST", {
    targetType: "customer",
    targetId: "c_mnb_other",
    targets: [one("customer", "c_mnb_other")],
    note
  });
  assert.equal(single.response.status, 400);
  assert.equal(unchanged("c_mnb_other"), "");

  const saved = await request(batchPath, shirley, "POST", {
    targets: [
      one("customer", "c_mnb_other"),
      one("customer", "c_mnb_intent"),
      one("customer", "c_mnb_miss"),
      one("customer", "c_mnb_unlabeled"),
      one("lead", "l_mnb_ok"),
      one("prospect", "p_mnb_ok"),
      one("prospect", "p_mnb_suppressed")
    ],
    nextFollowAt: when,
    note
  });
  assert.equal(saved.response.status, 200, saved.text);
  assert.equal(saved.json.result, "updated");
  assert.equal(saved.json.count, 7);
  assert.equal(saved.json.nextFollowAt, when);
  assert.equal(saved.json.note, note);
  assert.equal(saved.text.includes("13800138000"), false);
  assert.equal(saved.text.includes("secret.example"), false);
  assert.match(saved.json.items.find((item: { targetId: string }) => item.targetId === "p_mnb_suppressed").suppressionNotice, /不改变抑制状态/);
  for (const id of ["c_mnb_other", "c_mnb_intent", "c_mnb_miss", "c_mnb_unlabeled"]) {
    assert.equal(unchanged(id), when, id);
  }
  assert.equal(store.leads.find((item) => item.id === "l_mnb_ok")?.nextFollowAt, when);
  assert.equal(store.leads.find((item) => item.id === "l_mnb_ok")?.status, "new");
  assert.equal(store.leads.find((item) => item.id === "l_mnb_sync")?.nextFollowAt, when);
  assert.equal(store.leads.find((item) => item.id === "l_mnb_sync")?.status, "new");
  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_mnb_ok")?.nextFollowAt, when);
  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_mnb_suppressed")?.nextFollowAt, when);
  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_mnb_suppressed")?.outreachState, "suppressed");
  const successAudits = store.nextFollowUpAudits.filter((item) => item.batchId === saved.json.batchId && item.action === "batch_set_next_follow_up");
  assert.equal(successAudits.length, 7);
  assert.equal(new Set(successAudits.map((item) => item.batchId)).size, 1);
  assert.equal(successAudits.find((item) => item.objectId === "c_mnb_other")?.objectType, "customer");
  assert.equal(successAudits.find((item) => item.objectId === "l_mnb_ok")?.objectType, "lead");
  assert.equal(successAudits.find((item) => item.objectId === "p_mnb_ok")?.objectType, "prospect_candidate");
  assert.equal(successAudits.every((item) => item.newValue === when && item.actorId === shirleyUser.id), true);
  assert.equal(store.customerActivities.length, activitiesBefore + 4);
  assert.equal(store.customerActivities.filter((item) => item.content === note && item.type === "note" && item.nextReminder === when).length, 4);
  assert.equal(store.leadActivities.length, leadActivitiesBefore + 3);
  assert.equal(store.leadActivities.filter((item) => item.content === note && item.type === "note").length, 3);

  const again = await request(batchPath, shirley, "POST", {
    targets: [one("customer", "c_mnb_other")],
    nextFollowAt: "2026-11-07 09:00",
    note: "再记一次"
  });
  assert.equal(again.response.status, 400);
  assert.equal(again.json.reason, "not_pending");
  assert.equal(unchanged("c_mnb_other"), when);
  assert.equal(store.nextFollowUpAudits.filter((item) => item.objectId === "c_mnb_other" && item.action === "batch_set_next_follow_up").length, 1);

  const quietActivities = store.customerActivities.length;
  const quiet = await request(batchPath, shirley, "POST", {
    targets: [one("customer", "c_mnb_plain")],
    nextFollowAt: "2026-11-08 10:00",
    note: "   "
  });
  assert.equal(quiet.response.status, 200, quiet.text);
  assert.equal(unchanged("c_mnb_plain"), "2026-11-08 10:00");
  assert.equal(store.customerActivities.length, quietActivities);

  const team = await request(batchPath, admin, "POST", {
    targets: [one("customer", "c_mnb_mia")],
    nextFollowAt: "2026-11-09 11:00"
  });
  assert.equal(team.response.status, 200, team.text);
  assert.equal(unchanged("c_mnb_mia"), "2026-11-09 11:00");
  assert.equal(mia.length > 0, true);

  assert.equal(store.leads.length, leadsBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents || []), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions || []), decisionsBefore);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_mnb_other")?.callOutcome, outcomeBefore);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_mnb_other")?.establishedTimeRaw, establishedBefore);
  assert.equal(store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled, enabledBefore);
  assert.equal(aliyunHits, 0);
  console.log("missing next follow-up batch http tests passed");
} finally {
  setOutboundNowForTests(null);
  setTenantTimezoneOverride(getStore(), "europe", null);
  server.close();
}
