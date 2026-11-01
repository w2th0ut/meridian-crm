import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { encryptAliyunOutboundSecret } from "./credential-security.js";
import { customerPhoneId, setOutboundDialerForTests } from "./outbound-call.js";
import type { MakeCallParams } from "./aliyun-ccc-make-call.js";
import type { OutboundCallRecord, ProspectContactChannel, WebsiteOpportunity } from "./types.js";

const phone = "+46111222333";
const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start phone validity test server");
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
    return { jobId: "job-phone-validity", callType: "OUTBOUND" };
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

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "agentIds">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: partial.outboundCallAuditId || "",
    targetType: "customer",
    targetId: "c1",
    maskedNumber: "*******2333",
    contactType: "OUTBOUND",
    contactDisposition: "NoAnswer",
    earlyMediaState: "",
    callDurationRaw: "10",
    establishedTimeRaw: "",
    releaseTimeRaw: "",
    startTimeRaw: String(Date.parse("2026-04-04T04:00:00.000Z")),
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "号码错误",
    callOutcomeNote: "",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  assert.ok(shirleyUser && miaUser);
  store.users.push({
    ...shirleyUser,
    id: "u_phone_no_read",
    name: "No Phone Read",
    email: "no-phone-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_phone_no_update",
    name: "No Phone Update",
    email: "no-phone-update@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_phone_asia",
    name: "Asia Phone",
    email: "asia-phone@keduoduo.com",
    role: "sales",
    teamId: "asia",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_phone_no_read" && actor.id !== "u_phone_no_update") return snapshot;
    const permissions = { ...snapshot.permissions };
    if (actor.id === "u_phone_no_read") delete permissions["communication.read"];
    if (actor.id === "u_phone_no_update") delete permissions["customer.update"];
    return { ...snapshot, permissions };
  };

  const customer = store.customers.find((item) => item.id === "c1");
  const pooled = store.customers.find((item) => item.id === "c2");
  assert.ok(customer && pooled);
  const phoneBefore = customer.phone;
  const poolBefore = pooled.poolStatus;
  const poolPhoneBefore = pooled.phone;
  customer.phone = phone;
  pooled.phone = "+46111000022";
  store.customers.push({
    ...customer,
    id: "c_phone_asia",
    company: "Asia Phone Co",
    teamId: "asia",
    ownerId: "u_phone_asia",
    phone: "+85291110000"
  });

  const channel: ProspectContactChannel = {
    id: "ch-phone-validity",
    teamId: "europe",
    ownerId: shirleyUser.id,
    prospectId: "tp-phone-validity",
    organizationId: "",
    contactId: "",
    channelType: "phone",
    value: "+46555000999",
    normalizedValueHash: "",
    sourceEvidenceId: "",
    acquiredAt: "",
    idempotencyKeyHash: "",
    requestHash: "",
    recordHash: "",
    createdAt: "2026-11-01T00:00:00.000Z"
  };
  store.prospectContactChannels.push(channel);
  store.websiteOpportunities.push({
    id: "cand-phone-validity",
    company: "Validity Buyer",
    business: "",
    country: "瑞典",
    website: "",
    contact: "",
    contactInfo: "",
    description: "",
    ownerId: shirleyUser.id,
    teamId: "europe",
    status: "contactable",
    createdAt: "2026-11-01T00:00:00.000Z",
    tenantProspectId: "tp-phone-validity"
  } satisfies WebsiteOpportunity);

  store.aliyunAgentMappings.push(
    {
      id: "map_phone_shirley",
      teamId: "europe",
      crmUserId: shirleyUser.id,
      cccUserId: "agent@ccc-phone-a",
      loginName: "shirley",
      displayName: "Shirley坐席",
      extension: "8201",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-11-01T00:00:00.000Z"
    },
    {
      id: "map_phone_mia",
      teamId: "europe",
      crmUserId: miaUser.id,
      cccUserId: "agent@ccc-phone-b",
      loginName: "mia",
      displayName: "Mia坐席",
      extension: "8202",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-11-01T00:00:00.000Z"
    },
    {
      id: "map_phone_noupd",
      teamId: "europe",
      crmUserId: "u_phone_no_update",
      cccUserId: "agent@ccc-phone-c",
      loginName: "noupd",
      displayName: "无维护",
      extension: "8203",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-11-01T00:00:00.000Z"
    },
    {
      id: "map_phone_asia",
      teamId: "asia",
      crmUserId: "u_phone_asia",
      cccUserId: "agent@ccc-phone-asia",
      loginName: "asia",
      displayName: "亚洲坐席",
      extension: "8204",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-11-01T00:00:00.000Z"
    }
  );
  store.outboundCallAudits.push({
    id: "oca_phone_validity",
    teamId: "europe",
    actorId: shirleyUser.id,
    at: "2026-11-01T00:00:00.000Z",
    targetType: "customer",
    targetId: "c1",
    phoneId: customerPhoneId("c1"),
    maskedNumber: "*******2333",
    result: "allowed",
    reason: "",
    jobId: "job-existing",
    numberKey: ""
  });
  store.outboundCallRecords.push(
    record({ id: "ocr_pv_c1", agentIds: "agent@ccc-phone-a", outboundCallAuditId: "oca_phone_validity" }),
    record({ id: "ocr_pv_intent", agentIds: "agent@ccc-phone-a", callOutcome: "有意向" }),
    record({ id: "ocr_pv_changed", agentIds: "agent@ccc-phone-a", maskedNumber: "*******9999" }),
    record({ id: "ocr_pv_mia", agentIds: "agent@ccc-phone-b" }),
    record({ id: "ocr_pv_noupd", agentIds: "agent@ccc-phone-c" }),
    record({
      id: "ocr_pv_asia",
      teamId: "asia",
      agentIds: "agent@ccc-phone-asia",
      targetId: "c_phone_asia",
      maskedNumber: "*******0000"
    })
  );

  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions);
  const leadsBefore = store.leads.length;
  const sequencesBefore = JSON.stringify(store.outreachSequences);
  const followBefore = store.followUpAudits.length;
  const activitiesBefore = store.customerActivities.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  assert.equal(enabledBefore, false);

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const noRead = await login("no-phone-read@keduoduo.com");
  const noUpdate = await login("no-phone-update@keduoduo.com");
  const asia = await login("asia-phone@keduoduo.com");

  const denied = await request("/api/outbound-call-records/ocr_pv_c1/phone-validity", noRead, "POST", {});
  assert.equal(denied.response.status, 403);
  assert.equal(store.phoneValidityAudits.length, 0);
  assert.equal(store.phoneValidities.length, 0);

  const wrongOutcome = await request("/api/outbound-call-records/ocr_pv_intent/phone-validity", shirley, "POST", {});
  assert.equal(wrongOutcome.response.status, 400);
  assert.equal(wrongOutcome.json.reason, "not_wrong_number");
  assert.equal(store.phoneValidityAudits.length, 0);

  const changedNumber = await request("/api/outbound-call-records/ocr_pv_changed/phone-validity", shirley, "POST", {});
  assert.equal(changedNumber.response.status, 400);
  assert.equal(changedNumber.json.reason, "number_changed");
  assert.equal(store.phoneValidityAudits.length, 0);
  assert.equal(customer.phone, phone);

  const batch = await request("/api/outbound-call-records/ocr_pv_c1/phone-validity", shirley, "POST", { invalid: true, phoneIds: ["a"] });
  assert.equal(batch.response.status, 400);
  assert.equal(batch.json.reason, "invalid_request");
  const batchList = await request("/api/phone-validity", shirley, "POST", [{ targetType: "customer", targetId: "c1", phoneId: customerPhoneId("c1"), invalid: true }]);
  assert.equal(batchList.response.status, 400);
  assert.equal(store.phoneValidityAudits.length, 0);

  const hidden = await request("/api/outbound-call-records/ocr_pv_mia/phone-validity", shirley, "POST", {});
  assert.equal(hidden.response.status, 404);
  assert.equal(store.phoneValidityAudits.length, 0);

  const foreign = await request("/api/outbound-call-records/ocr_pv_asia/phone-validity", shirley, "POST", {});
  assert.equal(foreign.response.status, 404);
  const reverse = await request("/api/phone-validity", asia, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId: customerPhoneId("c1"),
    invalid: true
  });
  assert.equal(reverse.response.status, 404);
  assert.equal(store.phoneValidities.length, 0);

  const noWrite = await request("/api/outbound-call-records/ocr_pv_noupd/phone-validity", noUpdate, "POST", {});
  assert.equal(noWrite.response.status, 403);
  assert.equal(noWrite.json.reason, "forbidden");
  assert.equal(store.phoneValidityAudits.length, 0);
  assert.equal(customer.phone, phone);

  pooled.poolStatus = "public";
  const publicPool = await request("/api/phone-validity", shirley, "POST", {
    targetType: "customer",
    targetId: "c2",
    phoneId: customerPhoneId("c2"),
    invalid: true
  });
  assert.equal(publicPool.response.status, 409);
  assert.equal(publicPool.json.reason, "public_pool");
  assert.equal(store.phoneValidityAudits.length, 0);
  pooled.poolStatus = poolBefore;
  pooled.phone = poolPhoneBefore;

  const marked = await request("/api/outbound-call-records/ocr_pv_c1/phone-validity", shirley, "POST", {});
  assert.equal(marked.response.status, 200);
  assert.equal(marked.json.result, "updated");
  assert.equal(marked.json.invalid, true);
  assert.equal(marked.json.previousValue, "valid");
  assert.equal(marked.json.nextValue, "invalid");
  assert.equal(marked.json.sourceCallRecordId, "ocr_pv_c1");
  assert.equal(JSON.stringify(marked.json).includes(phone), false);
  const firstAudit = store.phoneValidityAudits.find((item) => item.sourceCallRecordId === "ocr_pv_c1");
  assert.ok(firstAudit);
  assert.equal(firstAudit.actorId, shirleyUser.id);
  assert.equal(firstAudit.teamId, "europe");
  assert.equal(firstAudit.previousValue, "valid");
  assert.equal(firstAudit.nextValue, "invalid");
  assert.equal(firstAudit.phoneId, customerPhoneId("c1"));
  assert.equal(JSON.stringify(firstAudit).includes(phone), false);
  assert.equal(store.phoneValidities.some((item) => item.phoneId === customerPhoneId("c1") && item.teamId === "europe"), true);

  const again = await request("/api/outbound-call-records/ocr_pv_c1/phone-validity", shirley, "POST", { invalid: true });
  assert.equal(again.response.status, 200);
  assert.equal(again.json.result, "unchanged");
  assert.equal(store.phoneValidityAudits.filter((item) => item.phoneId === customerPhoneId("c1")).length, 1);

  const manager = await request("/api/outbound-call-records/ocr_pv_mia/phone-validity", alex, "POST", {});
  assert.equal(manager.response.status, 200);
  assert.equal(manager.json.result, "unchanged");
  assert.equal(store.phoneValidityAudits.filter((item) => item.phoneId === customerPhoneId("c1")).length, 1);

  const cleared = await request("/api/phone-validity", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId: customerPhoneId("c1"),
    invalid: false
  });
  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.json.result, "updated");
  assert.equal(cleared.json.previousValue, "invalid");
  assert.equal(cleared.json.nextValue, "valid");
  assert.equal(cleared.json.sourceCallRecordId, "");
  assert.equal(store.phoneValidities.some((item) => item.phoneId === customerPhoneId("c1")), false);
  const clearAudit = store.phoneValidityAudits.find((item) => item.phoneId === customerPhoneId("c1") && item.nextValue === "valid");
  assert.ok(clearAudit);
  assert.equal(clearAudit.actorId, shirleyUser.id);
  assert.equal(clearAudit.previousValue, "invalid");
  assert.equal(clearAudit.sourceCallRecordId, "");

  const leadMarked = await request("/api/phone-validity", shirley, "POST", {
    targetType: "lead",
    targetId: "l1",
    phoneId: "lead-phone:l1",
    invalid: true
  });
  assert.equal(leadMarked.response.status, 200);
  assert.equal(leadMarked.json.result, "updated");
  assert.equal(leadMarked.json.sourceCallRecordId, "");
  const leadAudit = store.phoneValidityAudits.find((item) => item.phoneId === "lead-phone:l1");
  assert.ok(leadAudit);
  assert.equal(leadAudit.previousValue, "valid");
  assert.equal(leadAudit.nextValue, "invalid");
  assert.equal(leadAudit.actorId, shirleyUser.id);
  const leadCleared = await request("/api/phone-validity", shirley, "POST", {
    targetType: "lead",
    targetId: "l1",
    phoneId: "lead-phone:l1",
    invalid: false
  });
  assert.equal(leadCleared.response.status, 200);
  assert.equal(leadCleared.json.nextValue, "valid");
  assert.equal(store.phoneValidities.some((item) => item.phoneId === "lead-phone:l1"), false);

  const miaLead = await request("/api/phone-validity", mia, "POST", {
    targetType: "lead",
    targetId: "l1",
    phoneId: "lead-phone:l1",
    invalid: true
  });
  assert.equal(miaLead.response.status, 404);
  assert.equal(store.phoneValidities.some((item) => item.phoneId === "lead-phone:l1"), false);

  const prospectMarked = await request("/api/phone-validity", shirley, "POST", {
    targetType: "prospect",
    targetId: "cand-phone-validity",
    phoneId: channel.id,
    invalid: true
  });
  assert.equal(prospectMarked.response.status, 200);
  assert.equal(prospectMarked.json.invalid, true);
  const prospectAudit = store.phoneValidityAudits.find((item) => item.phoneId === channel.id && item.nextValue === "invalid");
  assert.ok(prospectAudit);
  assert.equal(prospectAudit.sourceCallRecordId, "");
  assert.equal(prospectAudit.actorId, shirleyUser.id);
  const prospectRead = await request("/api/phone-validity?targetType=prospect&targetId=cand-phone-validity", shirley);
  assert.equal(prospectRead.response.status, 200);
  assert.equal(prospectRead.json.canWrite, true);
  assert.equal(prospectRead.json.phones.some((item: { phoneId: string; invalid: boolean }) => item.phoneId === channel.id && item.invalid), true);
  assert.equal(JSON.stringify(prospectRead.json).includes("+46555000999"), false);
  const prospectCleared = await request("/api/phone-validity", shirley, "POST", {
    targetType: "prospect",
    targetId: "cand-phone-validity",
    phoneId: channel.id,
    invalid: false
  });
  assert.equal(prospectCleared.response.status, 200);
  assert.equal(prospectCleared.json.nextValue, "valid");

  const ownAsia = await request("/api/phone-validity", asia, "POST", {
    targetType: "customer",
    targetId: "c_phone_asia",
    phoneId: customerPhoneId("c_phone_asia"),
    invalid: true
  });
  assert.equal(ownAsia.response.status, 200);
  assert.equal(ownAsia.json.invalid, true);
  const asiaAudit = store.phoneValidityAudits.find((item) => item.phoneId === customerPhoneId("c_phone_asia"));
  assert.ok(asiaAudit);
  assert.equal(asiaAudit.teamId, "asia");
  assert.equal(asiaAudit.actorId, "u_phone_asia");
  assert.equal(store.phoneValidities.some((item) => item.teamId === "europe" && item.phoneId === customerPhoneId("c_phone_asia")), false);

  assert.equal(customer.phone, phone);
  assert.equal(channel.value, "+46555000999");
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(JSON.stringify(store.outreachSequences), sequencesBefore);
  assert.equal(store.followUpAudits.length, followBefore);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), false);
  assert.equal(JSON.stringify(store.phoneValidityAudits).includes(phone), false);
  assert.equal(JSON.stringify(store.phoneValidityAudits).includes("AccessKey"), false);

  const remarked = await request("/api/phone-validity", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId: customerPhoneId("c1"),
    invalid: true
  });
  assert.equal(remarked.response.status, 200);
  assert.equal(remarked.json.nextValue, "invalid");

  const putConfig = (enabled: boolean) => {
    const next = {
      teamId: "europe",
      aliyunOutboundEnabled: enabled,
      instanceId: "ccc-phone-validity",
      region: "cn-shanghai",
      callerNumber: "02100001111",
      callWindowStart: "00:00",
      callWindowEnd: "23:59",
      maxCallsPerNumberPerDay: 20,
      minIntervalMinutes: 0,
      accessKeyIdEncrypted: encryptAliyunOutboundSecret("europe", "accessKeyId", "LTAI12345678wxyz"),
      accessKeySecretEncrypted: encryptAliyunOutboundSecret("europe", "accessKeySecret", "SkSecretValue9999wxyz"),
      callbackPathTokenEncrypted: "",
      updatedBy: "u_admin",
      updatedAt: "2026-11-01T00:00:00.000Z"
    };
    const existing = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe");
    if (existing) Object.assign(existing, next);
    else store.aliyunOutboundConfigs.push(next);
  };
  const dialBody = { targetType: "customer", targetId: "c1", phoneId: customerPhoneId("c1") };
  putConfig(false);
  const disabled = await request("/api/outbound-calls", shirley, "POST", dialBody);
  assert.equal(disabled.response.status, 403);
  assert.equal(disabled.json.reason, "disabled");
  assert.equal(calls.length, 0);

  putConfig(true);
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => item.id !== "map_phone_shirley");
  const unmapped = await request("/api/outbound-calls", shirley, "POST", dialBody);
  assert.equal(unmapped.response.status, 403);
  assert.equal(unmapped.json.reason, "unmapped");
  assert.equal(calls.length, 0);
  store.aliyunAgentMappings.push({
    id: "map_phone_shirley",
    teamId: "europe",
    crmUserId: shirleyUser.id,
    cccUserId: "agent@ccc-phone-a",
    loginName: "shirley",
    displayName: "Shirley坐席",
    extension: "8201",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-11-01T00:00:00.000Z"
  });

  store.websiteOpportunities.push({
    id: "cand-phone-suppressed",
    company: "Suppressed Validity",
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
    customerId: "c1",
    outreachState: "suppressed"
  });
  const suppressed = await request("/api/outbound-calls", shirley, "POST", dialBody);
  assert.equal(suppressed.response.status, 409);
  assert.equal(suppressed.json.reason, "suppressed");
  assert.equal(calls.length, 0);
  store.websiteOpportunities = store.websiteOpportunities.filter((item) => item.id !== "cand-phone-suppressed");

  const invalidDial = await request("/api/outbound-calls", shirley, "POST", dialBody);
  assert.equal(invalidDial.response.status, 400);
  assert.equal(invalidDial.json.reason, "invalid_number");
  assert.match(String(invalidDial.json.message), /无效/);
  assert.equal(calls.length, 0);
  assert.equal(store.outboundCallAudits[0]?.reason, "invalid_number");
  assert.equal(store.outboundCallAudits[0]?.result, "rejected");
  assert.equal(store.outboundCallAudits[0]?.actorId, shirleyUser.id);
  assert.equal(store.outboundCallAudits[0]?.phoneId, customerPhoneId("c1"));
  assert.equal(JSON.stringify(invalidDial.json).includes(phone), false);
  assert.equal(JSON.stringify(store.outboundCallAudits[0]).includes(phone), false);

  const opened = await request("/api/phone-validity", shirley, "POST", {
    targetType: "customer",
    targetId: "c1",
    phoneId: customerPhoneId("c1"),
    invalid: false
  });
  assert.equal(opened.response.status, 200);
  const allowed = await request("/api/outbound-calls", shirley, "POST", dialBody);
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.json.result, "allowed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].Callee, phone);

  putConfig(false);
  assert.equal(store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled, false);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(JSON.stringify(store.outreachSequences), sequencesBefore);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(aliyunHits, 0);
  assert.equal(customer.phone, phone);

  customer.phone = phoneBefore;
  console.log("phone validity http tests passed");
} finally {
  setOutboundDialerForTests(undefined);
  globalThis.fetch = originalFetch;
  server.close();
}
