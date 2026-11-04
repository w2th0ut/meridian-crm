import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundDialerForTests } from "./outbound-call.js";
import type { MakeCallParams } from "./aliyun-ccc-make-call.js";
import type {
  AliyunAgentMapping,
  ContactPhone,
  OutboundCallAudit,
  OutboundCallRecord,
  PhoneValidity,
  PreferredPhone,
  ProspectContactChannel,
  WebsiteOpportunity
} from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start wrong-number invalid test server");
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
    return { jobId: "job-wn", callType: "OUTBOUND" };
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
    maskedNumber: "0222",
    contactType: "OUTBOUND",
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "8",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: "2000",
    agentIds: "agent@ccc-wn-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://secret.example/do-not-leak",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "",
    callOutcomeNote: "",
    callNote: "",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...partial
  };
}

const store = getStore();
let originalSnapshot: typeof store.getIamCapabilitySnapshot;

try {
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  assert.ok(shirleyUser);
  store.users.push({
    ...shirleyUser,
    id: "u_wn_no_update",
    name: "No Update",
    email: "no-wn-update@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_wn_no_update") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["customer.update"];
    return { ...snapshot, permissions };
  };
  const mapping = (partial: Partial<AliyunAgentMapping> & Pick<AliyunAgentMapping, "crmUserId" | "cccUserId">): AliyunAgentMapping => ({
    id: `map_wn_${partial.cccUserId}`,
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
    mapping({ crmUserId: shirleyUser.id, cccUserId: "agent@ccc-wn-a", displayName: "Shirley坐席" }),
    mapping({ crmUserId: "u_wn_no_update", cccUserId: "agent@ccc-wn-noupdate", displayName: "No Update坐席" })
  );

  const customerTemplate = store.customers.find((item) => item.id === "c1");
  const leadTemplate = store.leads.find((item) => item.id === "l1");
  assert.ok(customerTemplate && leadTemplate);
  const customer = {
    ...customerTemplate,
    id: "c_wn_main",
    company: "Wrong <Number>",
    phone: "+46111000222",
    poolStatus: "owned" as const,
    ownerId: shirleyUser.id,
    teamId: "europe",
    nextReminder: "保持跟进"
  };
  const single = {
    ...customer,
    id: "c_wn_one",
    company: "Only One",
    phone: "+46111000444",
    nextReminder: "只有一个"
  };
  const pooled = {
    ...customer,
    id: "c_wn_pool",
    company: "公池",
    phone: "+46111000555",
    poolStatus: "public" as const,
    nextReminder: "公池跟进"
  };
  const forbidden = {
    ...customer,
    id: "c_wn_forbid",
    company: "无权",
    phone: "+46111000666",
    ownerId: "u_wn_no_update",
    nextReminder: "无权跟进"
  };
  store.customers.push(customer, single, pooled, forbidden);
  store.contactPhones.push({
    id: "cph_wn_bad",
    teamId: "europe",
    targetType: "customer",
    targetId: customer.id,
    phoneId: "contact-phone:wn-bad",
    label: "空号",
    phone: "+46800000333",
    phoneDigits: "46800000333",
    origin: "extra",
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-01T00:00:00.000Z"
  } satisfies ContactPhone, {
    id: "cph_wn_good",
    teamId: "europe",
    targetType: "customer",
    targetId: customer.id,
    phoneId: "contact-phone:wn-good",
    label: "手机",
    phone: "+46700000111",
    phoneDigits: "46700000111",
    origin: "extra",
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-01T00:00:00.000Z"
  } satisfies ContactPhone, {
    id: "cph_wn_lead",
    teamId: "europe",
    targetType: "lead",
    targetId: "l_wn",
    phoneId: "contact-phone:wn-lead",
    label: "手机",
    phone: "+46700000888",
    phoneDigits: "46700000888",
    origin: "extra",
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-01T00:00:00.000Z"
  } satisfies ContactPhone);
  store.phoneValidities.push({
    id: "phv_wn_bad",
    teamId: "europe",
    targetType: "customer",
    targetId: customer.id,
    phoneId: "contact-phone:wn-bad",
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-01T00:00:00.000Z"
  } satisfies PhoneValidity);
  const preferred = (partial: PreferredPhone): PreferredPhone => partial;
  store.preferredPhones.push(
    preferred({
      id: "pph_wn_main",
      teamId: "europe",
      targetType: "customer",
      targetId: customer.id,
      phoneId: "customer-phone:c_wn_main",
      updatedBy: shirleyUser.id,
      updatedAt: "2026-11-01T00:00:00.000Z"
    }),
    preferred({
      id: "pph_wn_one",
      teamId: "europe",
      targetType: "customer",
      targetId: single.id,
      phoneId: "customer-phone:c_wn_one",
      updatedBy: shirleyUser.id,
      updatedAt: "2026-11-01T00:00:00.000Z"
    }),
    preferred({
      id: "pph_wn_lead",
      teamId: "europe",
      targetType: "lead",
      targetId: "l_wn",
      phoneId: "lead-phone:l_wn",
      updatedBy: shirleyUser.id,
      updatedAt: "2026-11-01T00:00:00.000Z"
    }),
    preferred({
      id: "pph_wn_prospect",
      teamId: "europe",
      targetType: "prospect",
      targetId: "cand_wn",
      phoneId: "ch_wn_a",
      updatedBy: shirleyUser.id,
      updatedAt: "2026-11-01T00:00:00.000Z"
    })
  );
  store.leads.push({
    ...leadTemplate,
    id: "l_wn",
    company: "Lead Co",
    phone: "+46111000777",
    ownerId: shirleyUser.id,
    teamId: "europe",
    nextFollowAt: "线索跟进",
    deletedAt: ""
  });
  store.prospectContactChannels.push({
    id: "ch_wn_a",
    teamId: "europe",
    ownerId: shirleyUser.id,
    prospectId: "tp_wn",
    organizationId: "",
    contactId: "",
    channelType: "phone",
    value: "+46111000999",
    normalizedValueHash: "",
    sourceEvidenceId: "",
    acquiredAt: "",
    idempotencyKeyHash: "",
    requestHash: "",
    recordHash: "",
    createdAt: "2026-11-01T00:00:00.000Z"
  } satisfies ProspectContactChannel, {
    id: "ch_wn_b",
    teamId: "europe",
    ownerId: shirleyUser.id,
    prospectId: "tp_wn",
    organizationId: "",
    contactId: "",
    channelType: "phone",
    value: "+46700000000",
    normalizedValueHash: "",
    sourceEvidenceId: "",
    acquiredAt: "",
    idempotencyKeyHash: "",
    requestHash: "",
    recordHash: "",
    createdAt: "2026-11-01T00:00:00.000Z"
  } satisfies ProspectContactChannel);
  store.websiteOpportunities.push({
    id: "cand_wn",
    company: "Buyer",
    business: "",
    country: "瑞典",
    website: "",
    contact: "",
    contactInfo: "",
    description: "",
    ownerId: shirleyUser.id,
    teamId: "europe",
    status: "preview",
    createdAt: "2026-11-01T00:00:00.000Z",
    tenantProspectId: "tp_wn"
  } satisfies WebsiteOpportunity);

  const audit = (partial: OutboundCallAudit): OutboundCallAudit => partial;
  store.outboundCallAudits.push(
    audit({
      id: "oca_wn_main",
      teamId: "europe",
      actorId: shirleyUser.id,
      at: "2026-11-01T00:00:00.000Z",
      targetType: "customer",
      targetId: customer.id,
      phoneId: "customer-phone:c_wn_main",
      maskedNumber: "0222",
      result: "allowed",
      reason: "",
      jobId: "job-wn-main"
    }),
    audit({
      id: "oca_wn_lead",
      teamId: "europe",
      actorId: shirleyUser.id,
      at: "2026-11-01T00:00:00.000Z",
      targetType: "lead",
      targetId: "l_wn",
      phoneId: "lead-phone:l_wn",
      maskedNumber: "0777",
      result: "allowed",
      reason: "",
      jobId: "job-wn-lead"
    }),
    audit({
      id: "oca_wn_prospect",
      teamId: "europe",
      actorId: shirleyUser.id,
      at: "2026-11-01T00:00:00.000Z",
      targetType: "prospect",
      targetId: "cand_wn",
      phoneId: "ch_wn_a",
      maskedNumber: "0999",
      result: "allowed",
      reason: "",
      jobId: "job-wn-prospect"
    })
  );
  store.outboundCallRecords.push(
    record({ id: "ocr_wn_main", targetType: "customer", targetId: customer.id, outboundCallAuditId: "oca_wn_main", maskedNumber: "0222" }),
    record({ id: "ocr_wn_one", targetType: "customer", targetId: single.id, maskedNumber: "0444" }),
    record({ id: "ocr_wn_pool", targetType: "customer", targetId: pooled.id, maskedNumber: "0555" }),
    record({
      id: "ocr_wn_forbid",
      targetType: "customer",
      targetId: forbidden.id,
      maskedNumber: "0666",
      agentIds: "agent@ccc-wn-noupdate"
    }),
    record({ id: "ocr_wn_miss", targetType: "customer", targetId: customer.id, outboundCallAuditId: "oca_wn_main", maskedNumber: "9999" }),
    record({ id: "ocr_wn_lead", targetType: "lead", targetId: "l_wn", outboundCallAuditId: "oca_wn_lead", maskedNumber: "0777" }),
    record({ id: "ocr_wn_prospect", targetType: "prospect", targetId: "cand_wn", outboundCallAuditId: "oca_wn_prospect", maskedNumber: "0999" })
  );
  store.sameDayCallSkips.push({
    id: "sdcs_wn_keep",
    teamId: "europe",
    targetType: "customer",
    targetId: customer.id,
    skipOn: "2026-11-04",
    resumeOn: "2026-11-20",
    reason: "asked_later",
    note: "保持恢复日",
    active: true,
    actorId: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z"
  });

  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const leadsBefore = store.leads.length;
  const activitiesBefore = store.customerActivities.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  const callAuditsBefore = store.outboundCallAudits.length;
  const skipBefore = JSON.stringify(store.sameDayCallSkips.find((item) => item.id === "sdcs_wn_keep"));

  const shirley = await login("shirley@keduoduo.com");
  const noUpdate = await login("no-wn-update@keduoduo.com");

  const saved = await request("/api/outbound-call-records/ocr_wn_main/outcome", shirley, "POST", {
    outcome: "号码错误",
    note: "空号",
    markNumberInvalid: true
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.json.result, "updated");
  assert.equal(saved.json.phoneInvalidResult, "updated");
  assert.equal(saved.json.preferredSwitchResult, "updated");
  assert.equal(saved.json.phoneId, "customer-phone:c_wn_main");
  assert.equal(saved.json.nextFollowResult, "skipped");
  assert.equal(saved.text.includes("+46111000222"), false);
  assert.equal(saved.text.includes("do-not-leak"), false);
  assert.equal(saved.text.includes("纪要不要出现"), false);
  assert.equal(JSON.stringify(saved.json.record || {}).includes("+46111000222"), false);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wn_main")?.callOutcome, "号码错误");
  assert.equal(store.customers.find((item) => item.id === "c_wn_main")?.nextReminder, "保持跟进");
  assert.equal(store.phoneValidities.some((item) => item.phoneId === "customer-phone:c_wn_main"), true);
  assert.equal(store.phoneValidities.some((item) => item.phoneId === "contact-phone:wn-bad"), true);
  assert.equal(store.preferredPhones.find((item) => item.targetId === "c_wn_main")?.phoneId, "contact-phone:wn-good");
  const validityAudit = store.phoneValidityAudits.find((item) => item.phoneId === "customer-phone:c_wn_main" && item.result !== "rejected");
  assert.equal(validityAudit?.previousValue, "valid");
  assert.equal(validityAudit?.nextValue, "invalid");
  assert.equal(validityAudit?.sourceCallRecordId, "ocr_wn_main");
  assert.equal(validityAudit?.actorId, shirleyUser.id);
  const switchAudit = store.preferredPhoneAudits.find((item) => item.targetId === "c_wn_main" && item.reason === "wrong_number_alternate");
  assert.equal(switchAudit?.action, "update");
  assert.equal(switchAudit?.result, "updated");
  assert.equal(switchAudit?.previousPhoneId, "customer-phone:c_wn_main");
  assert.equal(switchAudit?.nextPhoneId, "contact-phone:wn-good");
  assert.equal(store.preferredPhoneAudits.some((item) => item.targetId === "c_wn_main" && item.reason === "marked_invalid"), false);
  assert.equal(store.preferredPhoneAudits.some((item) => item.reason === "missed_alternate" && item.targetId === "c_wn_main"), false);

  const validityCount = store.phoneValidityAudits.filter((item) => item.phoneId === "customer-phone:c_wn_main").length;
  const preferredCount = store.preferredPhoneAudits.filter((item) => item.targetId === "c_wn_main").length;
  const again = await request("/api/outbound-call-records/ocr_wn_main/outcome", shirley, "POST", {
    outcome: "号码错误",
    note: "空号",
    markNumberInvalid: true
  });
  assert.equal(again.response.status, 200);
  assert.equal(again.json.result, "unchanged");
  assert.equal(again.json.phoneInvalidResult, "unchanged");
  assert.equal(again.json.preferredSwitchResult, "unchanged");
  assert.equal(store.phoneValidityAudits.filter((item) => item.phoneId === "customer-phone:c_wn_main").length, validityCount);
  assert.equal(store.preferredPhoneAudits.filter((item) => item.targetId === "c_wn_main").length, preferredCount);

  const unchecked = await request("/api/outbound-call-records/ocr_wn_one/outcome", shirley, "POST", {
    outcome: "号码错误",
    markNumberInvalid: false
  });
  assert.equal(unchecked.response.status, 200);
  assert.equal(unchecked.json.phoneInvalidResult, "skipped");
  assert.equal(unchecked.json.preferredSwitchResult, "skipped");
  assert.equal(store.phoneValidities.some((item) => item.phoneId === "customer-phone:c_wn_one"), false);
  assert.equal(store.preferredPhones.find((item) => item.targetId === "c_wn_one")?.phoneId, "customer-phone:c_wn_one");

  const only = await request("/api/outbound-call-records/ocr_wn_one/outcome", shirley, "POST", {
    outcome: "号码错误",
    markNumberInvalid: true
  });
  assert.equal(only.response.status, 200);
  assert.equal(only.json.phoneInvalidResult, "updated");
  assert.equal(only.json.preferredSwitchResult, "cleared");
  assert.equal(store.phoneValidities.some((item) => item.phoneId === "customer-phone:c_wn_one"), true);
  assert.equal(store.preferredPhones.some((item) => item.targetId === "c_wn_one"), false);
  assert.equal(store.preferredPhoneAudits.find((item) => item.targetId === "c_wn_one")?.reason, "marked_invalid");
  assert.equal(store.preferredPhoneAudits.find((item) => item.targetId === "c_wn_one")?.action, "clear");

  const leadSaved = await request("/api/outbound-call-records/ocr_wn_lead/outcome", shirley, "POST", {
    outcome: "号码错误",
    markNumberInvalid: true
  });
  assert.equal(leadSaved.response.status, 200);
  assert.equal(leadSaved.json.preferredSwitchResult, "updated");
  assert.equal(store.preferredPhones.find((item) => item.targetId === "l_wn")?.phoneId, "contact-phone:wn-lead");
  assert.equal(store.phoneValidities.some((item) => item.phoneId === "lead-phone:l_wn"), true);
  assert.equal(store.leads.find((item) => item.id === "l_wn")?.nextFollowAt, "线索跟进");

  const prospectSaved = await request("/api/outbound-call-records/ocr_wn_prospect/outcome", shirley, "POST", {
    outcome: "号码错误",
    markNumberInvalid: true
  });
  assert.equal(prospectSaved.response.status, 200);
  assert.equal(prospectSaved.json.preferredSwitchResult, "updated");
  assert.equal(store.preferredPhones.find((item) => item.targetId === "cand_wn")?.phoneId, "ch_wn_b");
  assert.equal(store.phoneValidities.some((item) => item.phoneId === "ch_wn_a"), true);

  const pooledResult = await request("/api/outbound-call-records/ocr_wn_pool/outcome", shirley, "POST", {
    outcome: "号码错误",
    markNumberInvalid: true
  });
  assert.equal(pooledResult.response.status, 409);
  assert.equal(pooledResult.json.reason, "public_pool");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wn_pool")?.callOutcome, "");
  assert.equal(store.phoneValidities.some((item) => item.phoneId === "customer-phone:c_wn_pool"), false);
  const poolAudit = store.phoneValidityAudits.find((item) => item.sourceCallRecordId === "ocr_wn_pool");
  assert.equal(poolAudit?.result, "rejected");
  assert.equal(poolAudit?.reason, "public_pool");
  assert.equal(poolAudit?.previousValue, "valid");
  assert.equal(poolAudit?.nextValue, "valid");

  const denied = await request("/api/outbound-call-records/ocr_wn_forbid/outcome", noUpdate, "POST", {
    outcome: "号码错误",
    markNumberInvalid: true
  });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.reason, "forbidden");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wn_forbid")?.callOutcome, "");
  assert.equal(store.phoneValidities.some((item) => item.phoneId === "customer-phone:c_wn_forbid"), false);
  const deniedAudit = store.phoneValidityAudits.find((item) => item.sourceCallRecordId === "ocr_wn_forbid");
  assert.equal(deniedAudit?.result, "rejected");
  assert.equal(deniedAudit?.reason, "forbidden");
  assert.equal(JSON.stringify(deniedAudit).includes("+46111000666"), false);

  const missed = await request("/api/outbound-call-records/ocr_wn_miss/outcome", shirley, "POST", {
    outcome: "号码错误",
    markNumberInvalid: true
  });
  assert.equal(missed.response.status, 400);
  assert.equal(missed.json.reason, "number_changed");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wn_miss")?.callOutcome, "");
  assert.equal(store.phoneValidityAudits.some((item) => item.sourceCallRecordId === "ocr_wn_miss"), false);
  assert.equal(store.preferredPhones.find((item) => item.targetId === "c_wn_main")?.phoneId, "contact-phone:wn-good");

  const otherOutcome = await request("/api/outbound-call-records/ocr_wn_pool/outcome", shirley, "POST", {
    outcome: "有意向",
    markNumberInvalid: true
  });
  assert.equal(otherOutcome.response.status, 400);
  assert.equal(otherOutcome.json.reason, "invalid_mark");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wn_pool")?.callOutcome, "");

  const anonymous = await request("/api/outbound-call-records/ocr_wn_pool/outcome", "", "POST", {
    outcome: "号码错误",
    markNumberInvalid: true
  });
  assert.equal(anonymous.response.status, 401);
  assert.equal(store.phoneValidityAudits.some((item) => item.sourceCallRecordId === "ocr_wn_pool" && item.reason !== "public_pool"), false);

  const batch = await request("/api/unlabeled-connected-calls/label", shirley, "POST", {
    callRecordIds: ["ocr_wn_pool"],
    outcome: "号码错误",
    markNumberInvalid: true
  });
  assert.equal(batch.response.status, 400);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wn_pool")?.callOutcome, "");

  assert.equal(store.customers.find((item) => item.id === "c_wn_main")?.nextReminder, "保持跟进");
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(JSON.stringify(store.sameDayCallSkips.find((item) => item.id === "sdcs_wn_keep")), skipBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  assert.equal(calls.length, 0);
  assert.equal(aliyunHits, 0);
  assert.equal(JSON.stringify(store.phoneValidityAudits.filter((item) => item.sourceCallRecordId.startsWith("ocr_wn_"))).includes("+4611"), false);
  assert.equal(JSON.stringify(store.preferredPhoneAudits.filter((item) => item.targetId.startsWith("c_wn_") || item.targetId === "l_wn" || item.targetId === "cand_wn")).includes("+4611"), false);
  console.log("call outcome wrong number http tests passed");
} finally {
  if (originalSnapshot) store.getIamCapabilitySnapshot = originalSnapshot;
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_wn_"));
  store.outboundCallAudits = store.outboundCallAudits.filter((item) => !item.id.startsWith("oca_wn_"));
  store.callOutcomeAudits = store.callOutcomeAudits.filter((item) => !item.callRecordId.startsWith("ocr_wn_"));
  store.phoneValidities = store.phoneValidities.filter((item) => !item.id.startsWith("phv_wn_") && !item.phoneId.includes("wn"));
  store.phoneValidityAudits = store.phoneValidityAudits.filter((item) => !item.sourceCallRecordId.startsWith("ocr_wn_") && !item.phoneId.includes("wn"));
  store.preferredPhones = store.preferredPhones.filter((item) => !item.id.startsWith("pph_wn_"));
  store.preferredPhoneAudits = store.preferredPhoneAudits.filter((item) => !item.targetId.startsWith("c_wn_") && item.targetId !== "l_wn" && item.targetId !== "cand_wn");
  store.contactPhones = store.contactPhones.filter((item) => !item.id.startsWith("cph_wn_"));
  store.customers = store.customers.filter((item) => !item.id.startsWith("c_wn_"));
  store.leads = store.leads.filter((item) => item.id !== "l_wn");
  store.websiteOpportunities = store.websiteOpportunities.filter((item) => item.id !== "cand_wn");
  store.prospectContactChannels = store.prospectContactChannels.filter((item) => !item.id.startsWith("ch_wn_"));
  store.sameDayCallSkips = store.sameDayCallSkips.filter((item) => item.id !== "sdcs_wn_keep");
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_wn_"));
  store.users = store.users.filter((item) => item.id !== "u_wn_no_update");
  globalThis.fetch = originalFetch;
  server.close();
}
