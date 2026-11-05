import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { sameDaySkipActive, setOutboundDialerForTests, setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { AliyunAgentMapping, OutboundCallRecord } from "./types.js";

const phone = "+46819990001";
const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start same-day skip batch test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

const calls: number[] = [];
setOutboundDialerForTests({
  async makeCall() {
    calls.push(1);
    throw new Error("batch skip must not dial");
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
    agentIds: "agent@ccc-sds-a",
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

const store = getStore();
setOutboundNowForTests(new Date("2026-11-04T04:00:00.000Z"));
setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");

try {
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  assert.ok(shirleyUser && miaUser);
  store.users.push({
    ...shirleyUser,
    id: "u_sds_no_send",
    name: "No Send",
    email: "no-sds-send@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_sds_no_read",
    name: "No Read",
    email: "no-sds-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    if (actor.id !== "u_sds_no_send" && actor.id !== "u_sds_no_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    if (actor.id === "u_sds_no_send") delete permissions["communication.send"];
    if (actor.id === "u_sds_no_read") delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };
  const shirley = await login("shirley@keduoduo.com");
  const noSend = await login("no-sds-send@keduoduo.com");
  const noRead = await login("no-sds-read@keduoduo.com");
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
    mapping({ crmUserId: shirleyUser.id, cccUserId: "agent@ccc-sds-a", displayName: "Shirley坐席" }),
    mapping({ crmUserId: miaUser.id, cccUserId: "agent@ccc-sds-b", displayName: "Mia坐席" })
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
      phone,
      ...extra,
      id
    });
  };
  customer("c_sds_today", { company: "Today <Buyer>", nextReminder: "2026-11-04 10:00" });
  customer("c_sds_miss", { company: "Miss Buyer", nextReminder: "" });
  customer("c_sds_other", { company: "Other Buyer", nextReminder: "" });
  customer("c_sds_intent", { company: "Intent Buyer", nextReminder: "" });
  customer("c_sds_open", { company: "Open Buyer", nextReminder: "" });
  customer("c_sds_neg", { company: "Neg Buyer", nextReminder: "下周" });
  customer("c_sds_plain", { company: "Plain Buyer", nextReminder: "", phone: "" });
  customer("c_sds_pool", { company: "Pool Buyer", poolStatus: "public", nextReminder: "下周" });
  customer("c_sds_mia", { company: "Mia Buyer", ownerId: miaUser.id, nextReminder: "" });
  customer("c_sds_nosend", { company: "No Send Buyer", ownerId: "u_sds_no_send", nextReminder: "2026-11-04 11:00" });
  store.leads.push({
    ...leadTemplate,
    id: "l_sds_ok",
    company: "批量线索",
    teamId: "europe",
    ownerId: shirleyUser.id,
    nextFollowAt: "",
    status: "new",
    deletedAt: ""
  });
  store.websiteOpportunities.push({
    ...prospectTemplate,
    id: "p_sds_ok",
    company: "批量搜客",
    teamId: "europe",
    ownerId: shirleyUser.id,
    status: "contacted",
    leadId: "",
    nextFollowAt: "",
    outreachState: "uncontacted"
  }, {
    ...prospectTemplate,
    id: "p_sds_sup",
    company: "已抑制搜客",
    teamId: "europe",
    ownerId: shirleyUser.id,
    status: "contacted",
    leadId: "",
    nextFollowAt: "",
    outreachState: "suppressed"
  });
  store.outboundCallRecords.push(
    record({ id: "ocr_sds_miss", targetType: "customer", targetId: "c_sds_miss", callOutcome: "", establishedTimeRaw: "", startTimeRaw: "3000" }),
    record({ id: "ocr_sds_other", targetType: "customer", targetId: "c_sds_other", callOutcome: "其他", startTimeRaw: "2900" }),
    record({ id: "ocr_sds_intent", targetType: "customer", targetId: "c_sds_intent", callOutcome: "有意向", startTimeRaw: "2800" }),
    record({ id: "ocr_sds_open", targetType: "customer", targetId: "c_sds_open", callOutcome: "", startTimeRaw: "2700" }),
    record({ id: "ocr_sds_neg", targetType: "customer", targetId: "c_sds_neg", callOutcome: "无意向", startTimeRaw: "2600" }),
    record({ id: "ocr_sds_pool", targetType: "customer", targetId: "c_sds_pool", callOutcome: "无意向", startTimeRaw: "2500" }),
    record({ id: "ocr_sds_mia", targetType: "customer", targetId: "c_sds_mia", agentIds: "agent@ccc-sds-b", callOutcome: "其他", startTimeRaw: "2400" }),
    record({ id: "ocr_sds_lead", targetType: "lead", targetId: "l_sds_ok", callOutcome: "其他", startTimeRaw: "2300" }),
    record({ id: "ocr_sds_prospect", targetType: "prospect", targetId: "p_sds_ok", callOutcome: "其他", startTimeRaw: "2200" }),
    record({ id: "ocr_sds_sup", targetType: "prospect", targetId: "p_sds_sup", callOutcome: "其他", startTimeRaw: "2100" })
  );

  const path = "/api/same-day-call-skips/batch";
  const one = (targetType: string, targetId: string) => ({ targetType, targetId });
  const chosen = [
    one("customer", "c_sds_today"),
    one("customer", "c_sds_miss"),
    one("customer", "c_sds_other"),
    one("customer", "c_sds_intent"),
    one("customer", "c_sds_open"),
    one("customer", "c_sds_neg"),
    one("lead", "l_sds_ok"),
    one("prospect", "p_sds_ok"),
    one("prospect", "p_sds_sup")
  ];
  const auditsAt = () => store.sameDayCallSkipAudits.length;
  const skipOf = (targetId: string) => store.sameDayCallSkips.find((item) => item.teamId === "europe" && item.targetId === targetId && item.active);
  const enabledBefore = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled;
  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents || []);
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const leadsBefore = store.leads.length;
  const activitiesBefore = store.customerActivities.length;
  const outcomeBefore = store.outboundCallRecords.find((item) => item.id === "ocr_sds_other")?.callOutcome;
  const establishedBefore = store.outboundCallRecords.find((item) => item.id === "ocr_sds_miss")?.establishedTimeRaw;

  const empty = await request(path, shirley, "POST", { targets: [], reason: "other" });
  assert.equal(empty.response.status, 400);
  assert.equal(empty.json.reason, "invalid_request");
  const tooMany = await request(path, shirley, "POST", {
    targets: Array.from({ length: 101 }, (_, index) => one("customer", `c_sds_${index}`)),
    reason: "other"
  });
  assert.equal(tooMany.response.status, 400);
  assert.equal(tooMany.json.reason, "too_many");
  const duplicate = await request(path, shirley, "POST", { targets: [one("customer", "c_sds_other"), one("customer", "c_sds_other")], reason: "other" });
  assert.equal(duplicate.response.status, 400);
  const extra = await request(path, shirley, "POST", { targets: [one("customer", "c_sds_other")], reason: "other", records: ["ocr_sds_other"] });
  assert.equal(extra.response.status, 400);
  const longNote = await request(path, shirley, "POST", { targets: [one("customer", "c_sds_other")], reason: "other", note: "字".repeat(201) });
  assert.equal(longNote.response.status, 400);
  assert.equal(longNote.json.reason, "note_too_long");
  const badDate = await request(path, shirley, "POST", { targets: [one("customer", "c_sds_other")], reason: "other", resumeOn: "2026-11-31" });
  assert.equal(badDate.response.status, 400);
  const todayDate = await request(path, shirley, "POST", { targets: [one("customer", "c_sds_other")], reason: "other", resumeOn: "2026-11-04" });
  assert.equal(todayDate.response.status, 400);
  const farDate = await request(path, shirley, "POST", { targets: [one("customer", "c_sds_other")], reason: "other", resumeOn: "2026-12-05" });
  assert.equal(farDate.response.status, 400);
  assert.equal(skipOf("c_sds_other"), undefined);

  const beforeHidden = auditsAt();
  const hidden = await request(path, shirley, "POST", {
    targets: [one("customer", "c_sds_other"), one("customer", "c_sds_mia")],
    reason: "asked_later"
  });
  assert.equal(hidden.response.status, 404, hidden.text);
  assert.equal(hidden.json.reason, "not_found");
  assert.equal(skipOf("c_sds_other"), undefined);
  assert.equal(auditsAt(), beforeHidden);

  const beforePending = auditsAt();
  const pending = await request(path, shirley, "POST", {
    targets: [one("customer", "c_sds_other"), one("customer", "c_sds_plain")],
    reason: "asked_later"
  });
  assert.equal(pending.response.status, 400, pending.text);
  assert.equal(pending.json.reason, "not_pending");
  assert.equal(skipOf("c_sds_other"), undefined);
  assert.equal(auditsAt(), beforePending);

  const beforePool = auditsAt();
  const pooled = await request(path, shirley, "POST", {
    targets: [one("customer", "c_sds_other"), one("customer", "c_sds_pool")],
    reason: "asked_later",
    note: "不要写进审计"
  });
  assert.equal(pooled.response.status, 403, pooled.text);
  assert.equal(pooled.json.reason, "forbidden");
  assert.equal(skipOf("c_sds_other"), undefined);
  assert.equal(skipOf("c_sds_pool"), undefined);
  const poolAudit = store.sameDayCallSkipAudits.find((item) => item.targetId === "c_sds_pool");
  assert.equal(poolAudit?.action, "batch");
  assert.equal(poolAudit?.result, "rejected");
  assert.equal(poolAudit?.reason, "forbidden");
  assert.equal(poolAudit?.note, "");
  assert.equal(Boolean(poolAudit?.batchId), true);
  assert.equal(store.sameDayCallSkipAudits.some((item) => item.targetId === "c_sds_other"), false);
  assert.equal(auditsAt(), beforePool + 1);

  const beforeDenied = auditsAt();
  const denied = await request(path, noSend, "POST", {
    targets: [one("customer", "c_sds_nosend")],
    reason: "wrong_time",
    note: "也不写"
  });
  assert.equal(denied.response.status, 403, denied.text);
  assert.equal(denied.json.reason, "forbidden");
  assert.equal(skipOf("c_sds_nosend"), undefined);
  const deniedAudit = store.sameDayCallSkipAudits.find((item) => item.targetId === "c_sds_nosend");
  assert.equal(deniedAudit?.action, "batch");
  assert.equal(deniedAudit?.result, "rejected");
  assert.equal(deniedAudit?.note, "");
  assert.equal(auditsAt(), beforeDenied + 1);

  const beforeRead = auditsAt();
  const unread = await request(path, noRead, "POST", { targets: [one("customer", "c_sds_other")], reason: "other" });
  assert.equal(unread.response.status, 403);
  assert.equal(auditsAt(), beforeRead);
  const anon = await request(path, "", "POST", { targets: [one("customer", "c_sds_other")], reason: "other" });
  assert.equal(anon.response.status, 401);
  assert.equal(auditsAt(), beforeRead);

  const single = await request("/api/same-day-call-skips", shirley, "POST", {
    targetType: "customer",
    targetId: "c_sds_other",
    reason: "other",
    targets: [one("customer", "c_sds_other")]
  });
  assert.equal(single.response.status, 400);
  assert.equal(skipOf("c_sds_other"), undefined);

  const saved = await request(path, shirley, "POST", {
    targets: chosen,
    reason: "asked_later",
    note: "改日再联系",
    resumeOn: "2026-11-20"
  });
  assert.equal(saved.response.status, 200, saved.text);
  assert.equal(saved.json.result, "updated");
  assert.equal(saved.json.count, chosen.length);
  assert.equal(saved.json.resumeOn, "2026-11-20");
  assert.equal(saved.text.includes(phone), false);
  assert.equal(saved.text.includes("secret.example"), false);
  assert.equal(saved.text.includes("Success"), false);
  const batchId = String(saved.json.batchId || "");
  assert.equal(batchId.startsWith("sdsb_"), true);
  for (const target of chosen) {
    const row = skipOf(target.targetId);
    assert.equal(row?.reason, "asked_later");
    assert.equal(row?.note, "改日再联系");
    assert.equal(row?.resumeOn, "2026-11-20");
    assert.equal(row?.skipOn, "2026-11-04");
    assert.equal(sameDaySkipActive(store, "europe", target.targetType, target.targetId, "2026-11-04"), true);
    const audit = store.sameDayCallSkipAudits.find((item) => item.targetId === target.targetId && item.result === "updated");
    assert.equal(audit?.action, "batch");
    assert.equal(audit?.batchId, batchId);
    assert.equal(audit?.skipReason, "asked_later");
  }
  assert.equal(store.sameDayCallSkipAudits.filter((item) => item.batchId === batchId && item.action === "set").length, 0);

  const staying = chosen.filter((item) => item.targetId !== "c_sds_today");
  const beforeSame = auditsAt();
  const again = await request(path, shirley, "POST", {
    targets: staying,
    reason: "asked_later",
    note: "改日再联系",
    resumeOn: "2026-11-20"
  });
  assert.equal(again.response.status, 200, again.text);
  assert.equal(again.json.result, "unchanged");
  assert.equal(auditsAt(), beforeSame);

  const beforeLeft = auditsAt();
  const left = await request(path, shirley, "POST", {
    targets: [one("customer", "c_sds_today"), one("customer", "c_sds_other")],
    reason: "other"
  });
  assert.equal(left.response.status, 400, left.text);
  assert.equal(left.json.reason, "not_pending");
  assert.equal(skipOf("c_sds_other")?.reason, "asked_later");
  assert.equal(auditsAt(), beforeLeft);

  const noted = await request(path, shirley, "POST", {
    targets: [one("customer", "c_sds_other")],
    reason: "asked_later",
    note: "字".repeat(200),
    resumeOn: "2026-12-04"
  });
  assert.equal(noted.response.status, 200, noted.text);
  assert.equal(noted.json.count, 1);
  assert.equal(skipOf("c_sds_other")?.note, "字".repeat(200));
  assert.equal(skipOf("c_sds_other")?.resumeOn, "2026-12-04");
  assert.notEqual(noted.json.batchId, batchId);

  const tomorrow = await request(path, shirley, "POST", {
    targets: [one("customer", "c_sds_miss")],
    reason: "wrong_time",
    resumeOn: "2026-11-05"
  });
  assert.equal(tomorrow.response.status, 200, tomorrow.text);
  assert.match(String(tomorrow.json.message || ""), /今天不会再拨/);
  assert.equal(skipOf("c_sds_miss")?.resumeOn, "2026-11-05");
  assert.equal(sameDaySkipActive(store, "europe", "customer", "c_sds_miss", "2026-11-04"), true);

  const alone = await request("/api/same-day-call-skips", shirley, "POST", {
    targetType: "customer",
    targetId: "c_sds_plain",
    reason: "reached"
  });
  assert.equal(alone.response.status, 200, alone.text);
  const aloneAudit = store.sameDayCallSkipAudits.find((item) => item.targetId === "c_sds_plain" && item.result === "updated");
  assert.equal(aloneAudit?.action, "set");
  assert.equal(aloneAudit?.batchId || "", "");

  assert.equal(store.customers.find((item) => item.id === "c_sds_today")?.nextReminder, "2026-11-04 10:00");
  assert.equal(store.customers.find((item) => item.id === "c_sds_neg")?.nextReminder, "下周");
  assert.equal(store.customers.find((item) => item.id === "c_sds_other")?.nextReminder, "");
  assert.equal(store.customers.find((item) => item.id === "c_sds_pool")?.poolStatus, "public");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_sds_other")?.callOutcome, outcomeBefore);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_sds_miss")?.establishedTimeRaw, establishedBefore);
  assert.equal(store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled, enabledBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents || []), suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(aliyunHits, 0);
  assert.equal(calls.length, 0);
  assert.equal(JSON.stringify(store.sameDayCallSkipAudits).includes(phone), false);
  assert.equal(JSON.stringify(store.sameDayCallSkipAudits).includes("secret.example"), false);
  console.log("same-day call skip batch http tests passed");
} finally {
  setOutboundDialerForTests(undefined);
  setOutboundNowForTests(undefined);
  setTenantTimezoneOverride(store, "europe", undefined);
  server.close();
}
