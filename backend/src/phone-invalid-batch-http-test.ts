import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundDialerForTests, setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { AliyunAgentMapping, ContactPhone, OutboundCallRecord, PreferredPhone, ProspectContactChannel } from "./types.js";

const phone = "+46819990021";
const alternate = "+46819990022";
const onlyPhone = "+46819990023";
const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start phone invalid batch test server");
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
    throw new Error("batch invalid must not dial");
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
    agentIds: "agent@ccc-piv-a",
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
    id: "u_piv_no_write",
    name: "No Write",
    email: "no-piv-write@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_piv_no_read",
    name: "No Read",
    email: "no-piv-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    if (actor.id !== "u_piv_no_write" && actor.id !== "u_piv_no_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    if (actor.id === "u_piv_no_write") {
      delete permissions["customer.update"];
      delete permissions["lead.update"];
      delete permissions["prospect.execute"];
    }
    if (actor.id === "u_piv_no_read") delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };
  const shirley = await login("shirley@keduoduo.com");
  const noWrite = await login("no-piv-write@keduoduo.com");
  const noRead = await login("no-piv-read@keduoduo.com");
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
    mapping({ crmUserId: shirleyUser.id, cccUserId: "agent@ccc-piv-a", displayName: "Shirley坐席" }),
    mapping({ crmUserId: miaUser.id, cccUserId: "agent@ccc-piv-b", displayName: "Mia坐席" }),
    mapping({ crmUserId: "u_piv_no_write", cccUserId: "agent@ccc-piv-c", displayName: "NoWrite坐席" })
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
      phone: onlyPhone,
      ...extra,
      id
    });
  };
  customer("c_piv_today", { company: "Today <Buyer>", nextReminder: "2026-11-04 10:00", phone: "+46819990024" });
  customer("c_piv_miss", { company: "Miss Buyer", phone: "+46819990025" });
  customer("c_piv_other", { company: "Other Buyer", phone });
  customer("c_piv_twin", { company: "Twin Buyer", phone });
  customer("c_piv_only", { company: "Only Buyer", phone: onlyPhone });
  customer("c_piv_intent", { company: "Intent Buyer", phone: "+46819990026" });
  customer("c_piv_open", { company: "Open Buyer", phone: "+46819990027" });
  customer("c_piv_neg", { company: "Neg Buyer", nextReminder: "下周", phone: "+46819990028" });
  customer("c_piv_plain", { company: "Plain Buyer", phone: "" });
  customer("c_piv_empty", { company: "Empty Buyer", phone: "" });
  customer("c_piv_pool", { company: "Pool Buyer", poolStatus: "public", nextReminder: "下周", phone: "+46819990029" });
  customer("c_piv_mia", { company: "Mia Buyer", ownerId: miaUser.id, phone: "+46819990030" });
  customer("c_piv_scope", { company: "Scope Buyer", phone: "+46819990032" });
  customer("c_piv_stop", { company: "Stop Buyer", phone: "+46819990033" });
  customer("c_piv_wrong", { company: "Wrong Buyer", phone: "+46819990034" });
  customer("c_piv_nowrite", { company: "No Write Buyer", ownerId: "u_piv_no_write", phone: "+46819990035" });
  customer("c_piv_single", { company: "Single Buyer", phone: "+46819990036" });
  store.contactPhones.push({
    id: "cph_piv_extra",
    teamId: "europe",
    targetType: "customer",
    targetId: "c_piv_other",
    phoneId: "contact-phone:piv-good",
    label: "手机",
    phone: alternate,
    phoneDigits: "46819990022",
    origin: "extra",
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z"
  } satisfies ContactPhone);
  store.preferredPhones.push({
    id: "pph_piv_other",
    teamId: "europe",
    targetType: "customer",
    targetId: "c_piv_other",
    phoneId: "customer-phone:c_piv_other",
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z"
  } satisfies PreferredPhone, {
    id: "pph_piv_only",
    teamId: "europe",
    targetType: "customer",
    targetId: "c_piv_only",
    phoneId: "customer-phone:c_piv_only",
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z"
  } satisfies PreferredPhone);
  store.leads.push({
    ...leadTemplate,
    id: "l_piv_ok",
    company: "批量线索",
    teamId: "europe",
    ownerId: shirleyUser.id,
    phone: "+46819990041",
    nextFollowAt: "",
    status: "new",
    deletedAt: ""
  });
  const channel = (id: string, prospectId: string, value: string, ownerId = shirleyUser.id): ProspectContactChannel => ({
    id,
    teamId: "europe",
    ownerId,
    prospectId,
    organizationId: "",
    contactId: "",
    channelType: "phone",
    value,
    normalizedValueHash: "",
    sourceEvidenceId: "",
    acquiredAt: "",
    idempotencyKeyHash: "",
    requestHash: "",
    recordHash: "",
    createdAt: "2026-11-01T00:00:00.000Z"
  });
  store.prospectContactChannels.push(
    channel("ch_piv_ok", "tp_piv_ok", "+46819990051"),
    channel("ch_piv_sup", "tp_piv_sup", "+46819990052")
  );
  store.websiteOpportunities.push({
    ...prospectTemplate,
    id: "p_piv_ok",
    company: "批量搜客",
    teamId: "europe",
    ownerId: shirleyUser.id,
    status: "contacted",
    leadId: "",
    nextFollowAt: "",
    outreachState: "uncontacted",
    tenantProspectId: "tp_piv_ok"
  }, {
    ...prospectTemplate,
    id: "p_piv_sup",
    company: "已抑制搜客",
    teamId: "europe",
    ownerId: shirleyUser.id,
    status: "contacted",
    leadId: "",
    nextFollowAt: "",
    outreachState: "suppressed",
    tenantProspectId: "tp_piv_sup"
  });
  store.outboundCallRecords.push(
    record({ id: "ocr_piv_miss", targetType: "customer", targetId: "c_piv_miss", callOutcome: "", establishedTimeRaw: "", startTimeRaw: "3000" }),
    record({ id: "ocr_piv_other", targetType: "customer", targetId: "c_piv_other", callOutcome: "其他", startTimeRaw: "2900" }),
    record({ id: "ocr_piv_only", targetType: "customer", targetId: "c_piv_only", callOutcome: "其他", startTimeRaw: "2850" }),
    record({ id: "ocr_piv_intent", targetType: "customer", targetId: "c_piv_intent", callOutcome: "有意向", startTimeRaw: "2800" }),
    record({ id: "ocr_piv_open", targetType: "customer", targetId: "c_piv_open", callOutcome: "", startTimeRaw: "2700" }),
    record({ id: "ocr_piv_neg", targetType: "customer", targetId: "c_piv_neg", callOutcome: "无意向", startTimeRaw: "2600" }),
    record({ id: "ocr_piv_empty", targetType: "customer", targetId: "c_piv_empty", callOutcome: "其他", startTimeRaw: "2550" }),
    record({ id: "ocr_piv_pool", targetType: "customer", targetId: "c_piv_pool", callOutcome: "无意向", startTimeRaw: "2500" }),
    record({ id: "ocr_piv_mia", targetType: "customer", targetId: "c_piv_mia", agentIds: "agent@ccc-piv-b", callOutcome: "其他", startTimeRaw: "2400" }),
    record({ id: "ocr_piv_scope", targetType: "customer", targetId: "c_piv_scope", callOutcome: "其他", startTimeRaw: "2350" }),
    record({ id: "ocr_piv_stop", targetType: "customer", targetId: "c_piv_stop", callOutcome: "其他", startTimeRaw: "2320" }),
    record({ id: "ocr_piv_wrong", targetType: "customer", targetId: "c_piv_wrong", callOutcome: "其他", startTimeRaw: "2310" }),
    record({ id: "ocr_piv_nowrite", targetType: "customer", targetId: "c_piv_nowrite", agentIds: "agent@ccc-piv-c", callOutcome: "其他", startTimeRaw: "2305" }),
    record({ id: "ocr_piv_lead", targetType: "lead", targetId: "l_piv_ok", callOutcome: "其他", startTimeRaw: "2300" }),
    record({ id: "ocr_piv_prospect", targetType: "prospect", targetId: "p_piv_ok", callOutcome: "其他", startTimeRaw: "2200" }),
    record({ id: "ocr_piv_sup", targetType: "prospect", targetId: "p_piv_sup", callOutcome: "其他", startTimeRaw: "2100" }),
    record({ id: "ocr_piv_single", targetType: "customer", targetId: "c_piv_single", callOutcome: "其他", startTimeRaw: "2050" })
  );

  const path = "/api/phone-validity/batch";
  const one = (targetType: string, targetId: string) => ({ targetType, targetId });
  const chosen = [
    one("customer", "c_piv_today"),
    one("customer", "c_piv_miss"),
    one("customer", "c_piv_other"),
    one("customer", "c_piv_only"),
    one("customer", "c_piv_intent"),
    one("customer", "c_piv_open"),
    one("customer", "c_piv_neg"),
    one("lead", "l_piv_ok"),
    one("prospect", "p_piv_ok"),
    one("prospect", "p_piv_sup")
  ];
  const auditsAt = () => store.phoneValidityAudits.length;
  const invalid = (phoneId: string) => store.phoneValidities.some((item) => item.teamId === "europe" && item.phoneId === phoneId);
  const enabledBefore = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled;
  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents || []);
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const leadsBefore = store.leads.length;
  const outcomeBefore = store.outboundCallRecords.find((item) => item.id === "ocr_piv_other")?.callOutcome;
  const reminderBefore = store.customers.find((item) => item.id === "c_piv_neg")?.nextReminder;

  const empty = await request(path, shirley, "POST", { targets: [], reason: "bad_number" });
  assert.equal(empty.response.status, 400);
  assert.equal(empty.json.reason, "invalid_request");
  const tooMany = await request(path, shirley, "POST", {
    targets: Array.from({ length: 101 }, (_, index) => one("customer", `c_piv_${index}`)),
    reason: "bad_number"
  });
  assert.equal(tooMany.response.status, 400);
  assert.equal(tooMany.json.reason, "too_many");
  const duplicate = await request(path, shirley, "POST", { targets: [one("customer", "c_piv_other"), one("customer", "c_piv_other")], reason: "bad_number" });
  assert.equal(duplicate.response.status, 400);
  const extra = await request(path, shirley, "POST", { targets: [one("customer", "c_piv_other")], reason: "bad_number", phones: [phone] });
  assert.equal(extra.response.status, 400);
  const badReason = await request(path, shirley, "POST", { targets: [one("customer", "c_piv_other")], reason: "empty_number" });
  assert.equal(badReason.response.status, 400);
  assert.equal(invalid("customer-phone:c_piv_other"), false);

  const beforeHidden = auditsAt();
  const hidden = await request(path, shirley, "POST", {
    targets: [one("customer", "c_piv_other"), one("customer", "c_piv_mia")],
    reason: "bad_number"
  });
  assert.equal(hidden.response.status, 404, hidden.text);
  assert.equal(hidden.json.reason, "not_found");
  assert.equal(invalid("customer-phone:c_piv_other"), false);
  assert.equal(auditsAt(), beforeHidden);

  const beforePending = auditsAt();
  const pending = await request(path, shirley, "POST", {
    targets: [one("customer", "c_piv_other"), one("customer", "c_piv_plain")],
    reason: "out_of_service"
  });
  assert.equal(pending.response.status, 400, pending.text);
  assert.equal(pending.json.reason, "not_pending");
  assert.equal(invalid("customer-phone:c_piv_other"), false);
  assert.equal(auditsAt(), beforePending);

  const beforeEmpty = auditsAt();
  const missing = await request(path, shirley, "POST", {
    targets: [one("customer", "c_piv_other"), one("customer", "c_piv_empty")],
    reason: "wrong_number"
  });
  assert.equal(missing.response.status, 400, missing.text);
  assert.equal(missing.json.reason, "number_unavailable");
  assert.equal(invalid("customer-phone:c_piv_other"), false);
  assert.equal(auditsAt(), beforeEmpty);

  const beforePool = auditsAt();
  const pooled = await request(path, shirley, "POST", {
    targets: [one("customer", "c_piv_other"), one("customer", "c_piv_pool")],
    reason: "bad_number"
  });
  assert.equal(pooled.response.status, 409, pooled.text);
  assert.equal(pooled.json.reason, "public_pool");
  assert.equal(invalid("customer-phone:c_piv_other"), false);
  assert.equal(invalid("customer-phone:c_piv_pool"), false);
  const poolAudit = store.phoneValidityAudits.find((item) => item.targetId === "c_piv_pool");
  assert.equal(poolAudit?.result, "rejected");
  assert.equal(poolAudit?.reason, "public_pool");
  assert.equal(poolAudit?.previousValue, "valid");
  assert.equal(poolAudit?.nextValue, "valid");
  assert.equal(Boolean(poolAudit?.batchId), true);
  assert.equal(store.phoneValidityAudits.some((item) => item.targetId === "c_piv_other" && item.batchId === poolAudit?.batchId), false);
  assert.equal(auditsAt(), beforePool + 1);
  assert.equal(store.customers.find((item) => item.id === "c_piv_pool")?.poolStatus, "public");

  const beforeDenied = auditsAt();
  const denied = await request(path, noWrite, "POST", {
    targets: [one("customer", "c_piv_nowrite")],
    reason: "out_of_service"
  });
  assert.equal(denied.response.status, 403, denied.text);
  assert.equal(denied.json.reason, "forbidden");
  assert.equal(invalid("customer-phone:c_piv_nowrite"), false);
  const deniedAudit = store.phoneValidityAudits.find((item) => item.targetId === "c_piv_nowrite");
  assert.equal(deniedAudit?.result, "rejected");
  assert.equal(deniedAudit?.reason, "forbidden");
  assert.equal(auditsAt(), beforeDenied + 1);

  const originalScope = store.resolveIamDataScope?.bind(store);
  store.resolveIamDataScope = async (actor, permission) => {
    if (actor.id === shirleyUser.id && permission === "customer.update") return { tenantWide: false, ownerIds: [] };
    if (originalScope) return originalScope(actor, permission);
    return { tenantWide: false, ownerIds: actor.id ? [actor.id] : [] };
  };
  const beforeScope = auditsAt();
  const scoped = await request(path, shirley, "POST", {
    targets: [one("customer", "c_piv_scope")],
    reason: "bad_number"
  });
  store.resolveIamDataScope = originalScope;
  assert.equal(scoped.response.status, 404, scoped.text);
  assert.equal(scoped.json.reason, "not_found");
  assert.equal(invalid("customer-phone:c_piv_scope"), false);
  const scopeAudit = store.phoneValidityAudits.find((item) => item.targetId === "c_piv_scope");
  assert.equal(scopeAudit?.result, "rejected");
  assert.equal(scopeAudit?.reason, "not_found");
  assert.equal(auditsAt(), beforeScope + 1);

  const beforeRead = auditsAt();
  const unread = await request(path, noRead, "POST", { targets: [one("customer", "c_piv_other")], reason: "bad_number" });
  assert.equal(unread.response.status, 403);
  assert.equal(auditsAt(), beforeRead);
  const anon = await request(path, "", "POST", { targets: [one("customer", "c_piv_other")], reason: "bad_number" });
  assert.equal(anon.response.status, 401);
  assert.equal(auditsAt(), beforeRead);

  const single = await request("/api/phone-validity", shirley, "POST", {
    targetType: "customer",
    targetId: "c_piv_single",
    phoneId: "customer-phone:c_piv_single",
    invalid: true,
    targets: [one("customer", "c_piv_single")]
  });
  assert.equal(single.response.status, 400);
  assert.equal(invalid("customer-phone:c_piv_single"), false);
  const alone = await request("/api/phone-validity", shirley, "POST", {
    targetType: "customer",
    targetId: "c_piv_single",
    phoneId: "customer-phone:c_piv_single",
    invalid: true
  });
  assert.equal(alone.response.status, 200, alone.text);
  const aloneAudit = store.phoneValidityAudits.find((item) => item.phoneId === "customer-phone:c_piv_single" && item.nextValue === "invalid");
  assert.equal(aloneAudit?.batchId || "", "");
  assert.equal(aloneAudit?.reason || "", "");
  assert.equal(aloneAudit?.result || "", "");

  const saved = await request(path, shirley, "POST", { targets: chosen, reason: "bad_number" });
  assert.equal(saved.response.status, 200, saved.text);
  assert.equal(saved.json.result, "updated");
  assert.equal(saved.json.count, chosen.length);
  assert.equal(saved.json.reason, "bad_number");
  assert.equal(saved.json.reasonLabel, "空号");
  assert.equal(saved.text.includes(phone), false);
  assert.equal(saved.text.includes(alternate), false);
  assert.equal(saved.text.includes("secret.example"), false);
  assert.equal(saved.text.includes("Success"), false);
  const batchId = String(saved.json.batchId || "");
  assert.equal(batchId.startsWith("pib_"), true);
  assert.equal(invalid("customer-phone:c_piv_other"), true);
  assert.equal(invalid("contact-phone:piv-good"), false);
  assert.equal(invalid("customer-phone:c_piv_twin"), false);
  assert.equal(invalid("customer-phone:c_piv_only"), true);
  assert.equal(invalid("lead-phone:l_piv_ok"), true);
  assert.equal(invalid("ch_piv_ok"), true);
  assert.equal(invalid("ch_piv_sup"), true);
  const otherAudit = store.phoneValidityAudits.find((item) => item.phoneId === "customer-phone:c_piv_other" && item.batchId === batchId);
  assert.equal(otherAudit?.previousValue, "valid");
  assert.equal(otherAudit?.nextValue, "invalid");
  assert.equal(otherAudit?.reason, "bad_number");
  assert.equal(otherAudit?.result || "", "");
  assert.equal(otherAudit?.sourceCallRecordId || "", "");
  assert.equal(store.preferredPhones.find((item) => item.targetId === "c_piv_other")?.phoneId, "contact-phone:piv-good");
  assert.equal(store.preferredPhoneAudits.find((item) => item.targetId === "c_piv_other")?.reason, "wrong_number_alternate");
  assert.equal(store.preferredPhoneAudits.some((item) => item.targetId === "c_piv_other" && item.reason === "marked_invalid"), false);
  assert.equal(store.preferredPhoneAudits.some((item) => item.targetId === "c_piv_other" && item.reason === "missed_alternate"), false);
  assert.equal(store.preferredPhones.some((item) => item.targetId === "c_piv_only"), false);
  assert.equal(store.preferredPhoneAudits.find((item) => item.targetId === "c_piv_only")?.reason, "marked_invalid");
  assert.equal(store.phoneValidityAudits.filter((item) => item.batchId === batchId).length, chosen.length);
  assert.equal(JSON.stringify(store.phoneValidityAudits).includes(phone), false);

  const linked = await request("/api/phone-validity/same-number", shirley, "POST", {
    targetType: "customer",
    targetId: "c_piv_other",
    phoneId: "customer-phone:c_piv_other"
  });
  assert.equal(linked.response.status, 200, linked.text);
  assert.equal(linked.json.result, "updated");
  assert.equal(invalid("customer-phone:c_piv_twin"), true);
  assert.equal(String(linked.json.batchId).startsWith("pvb_"), true);
  assert.notEqual(linked.json.batchId, batchId);

  const beforeAgain = auditsAt();
  const again = await request(path, shirley, "POST", {
    targets: [one("customer", "c_piv_only")],
    reason: "bad_number"
  });
  assert.equal(again.response.status, 400, again.text);
  assert.equal(again.json.reason, "number_unavailable");
  assert.equal(auditsAt(), beforeAgain);

  const stopped = await request(path, shirley, "POST", {
    targets: [one("customer", "c_piv_stop")],
    reason: "out_of_service"
  });
  assert.equal(stopped.response.status, 200, stopped.text);
  assert.equal(stopped.json.reasonLabel, "停机");
  assert.equal(store.phoneValidityAudits.find((item) => item.phoneId === "customer-phone:c_piv_stop")?.reason, "out_of_service");
  const wrong = await request(path, shirley, "POST", {
    targets: [one("customer", "c_piv_wrong")],
    reason: "wrong_number"
  });
  assert.equal(wrong.response.status, 200, wrong.text);
  assert.equal(wrong.json.reasonLabel, "号码错误");
  assert.equal(store.phoneValidityAudits.find((item) => item.phoneId === "customer-phone:c_piv_wrong")?.reason, "wrong_number");

  assert.equal(store.customers.find((item) => item.id === "c_piv_neg")?.nextReminder, reminderBefore);
  assert.equal(store.customers.find((item) => item.id === "c_piv_today")?.nextReminder, "2026-11-04 10:00");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_piv_other")?.callOutcome, outcomeBefore);
  assert.equal(store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled, enabledBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents || []), suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(aliyunHits, 0);
  assert.equal(calls.length, 0);
  console.log("phone invalid batch http tests passed");
} finally {
  setOutboundDialerForTests(undefined);
  setOutboundNowForTests(undefined);
  setTenantTimezoneOverride(store, "europe", undefined);
  globalThis.fetch = originalFetch;
  server.close();
}
