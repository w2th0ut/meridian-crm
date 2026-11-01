import assert from "node:assert/strict";
import { CALL_EXPORT_ROW_LIMIT } from "./call-export.js";
import { customerPhoneId, leadPhoneId, maskOutboundNumber } from "./outbound-call.js";
import { app } from "./server.js";
import { getStore } from "./store.js";
import type { OutboundCallRecord, ProspectContactChannel, WebsiteOpportunity } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call export test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

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

async function request(path: string, token: string) {
  const response = await originalFetch(`${baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
  const type = response.headers.get("content-type") || "";
  if (type.includes("text/csv")) {
    const bytes = Buffer.from(await response.arrayBuffer());
    const text = bytes.toString("utf8");
    return { response, text, bytes, json: {} as Record<string, any> };
  }
  const json = await response.json().catch(() => ({})) as Record<string, any>;
  return { response, text: JSON.stringify(json), bytes: Buffer.alloc(0), json };
}

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "agentIds">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    targetType: "customer",
    targetId: "c_export_extra",
    maskedNumber: "****",
    contactType: "OUTBOUND",
    contactDisposition: "NoAnswer",
    earlyMediaState: "",
    callDurationRaw: "15",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: String(Date.parse("2026-04-04T01:00:00.000Z")),
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/do-not-leak-export",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "",
    callOutcomeNote: "",
    callNote: "",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const customer = store.customers.find((item) => item.id === "c1");
  const lead = store.leads.find((item) => item.id === "l1");
  assert.ok(shirleyUser && miaUser && customer && lead);
  store.users.push({
    ...shirleyUser,
    id: "u_no_export_read",
    name: "No Export Read",
    email: "no-export-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_export_asia",
    name: "Asia Export",
    email: "asia-export@keduoduo.com",
    role: "admin",
    teamId: "asia",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_no_export_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };

  store.customers.push(
    { ...customer, id: "c_export_extra", company: "=导出公司", contact: "Eva", phone: "13800001111", ownerId: shirleyUser.id, teamId: "europe", poolStatus: "owned" },
    { ...customer, id: "c_export_main", company: "北欧工具", contact: "Nora", phone: "13700003333", ownerId: shirleyUser.id, teamId: "europe", poolStatus: "owned" },
    { ...customer, id: "c_export_guess", company: "不该猜", contact: "Gus", phone: "13700003333", ownerId: shirleyUser.id, teamId: "europe", poolStatus: "owned" },
    { ...customer, id: "c_export_mia", company: "Mia Co", contact: "Mia", phone: "13600004444", ownerId: miaUser.id, teamId: "europe", poolStatus: "owned" },
    { ...customer, id: "c_export_none", company: "@无坐席", contact: "None", phone: "13500005555", ownerId: shirleyUser.id, teamId: "europe", poolStatus: "owned" },
    { ...customer, id: "c_export_asia", company: "亚洲公司", contact: "Asia", phone: "85290000000", ownerId: "u_export_asia", teamId: "asia", poolStatus: "owned" }
  );
  store.leads.push({ ...lead, id: "l_export", company: "导出线索", phone: "+46800000000", ownerId: shirleyUser.id, teamId: "europe" });
  store.contactPhones.push({
    id: "cph_export_extra",
    teamId: "europe",
    targetType: "customer",
    targetId: "c_export_extra",
    phoneId: "cph_extra_export",
    label: "座机",
    phone: "021-8888-1234",
    phoneDigits: "02188881234",
    origin: "extra",
    updatedBy: "",
    updatedAt: "2026-04-04T00:00:00.000Z"
  }, {
    id: "cph_export_guess",
    teamId: "europe",
    targetType: "customer",
    targetId: "c_export_guess",
    phoneId: "cph_guess_export",
    label: "手机",
    phone: "13911112222",
    phoneDigits: "13911112222",
    origin: "extra",
    updatedBy: "",
    updatedAt: "2026-04-04T00:00:00.000Z"
  });
  store.outboundCallAudits.push({
    id: "oca_export_extra",
    teamId: "europe",
    actorId: shirleyUser.id,
    at: "2026-04-04T00:00:00.000Z",
    targetType: "customer",
    targetId: "c_export_extra",
    phoneId: "cph_extra_export",
    maskedNumber: maskOutboundNumber("02188881234"),
    result: "allowed",
    reason: "",
    jobId: ""
  }, {
    id: "oca_export_lead",
    teamId: "europe",
    actorId: shirleyUser.id,
    at: "2026-04-04T00:00:00.000Z",
    targetType: "lead",
    targetId: "l_export",
    phoneId: leadPhoneId("l_export"),
    maskedNumber: maskOutboundNumber("+46800000000"),
    result: "allowed",
    reason: "",
    jobId: ""
  }, {
    id: "oca_export_prospect",
    teamId: "europe",
    actorId: shirleyUser.id,
    at: "2026-04-04T00:00:00.000Z",
    targetType: "prospect",
    targetId: "cand-export",
    phoneId: "ch-export-b",
    maskedNumber: maskOutboundNumber("02177771234"),
    result: "allowed",
    reason: "",
    jobId: ""
  });
  store.callbackSchedules.push({
    id: "cbs_export",
    teamId: "europe",
    targetType: "customer",
    targetId: "c_export_extra",
    scheduledAt: "2026-04-06 09:00",
    note: "你好,世界",
    updatedBy: shirleyUser.id,
    updatedAt: "2026-04-04T00:00:00.000Z",
    sourceCallRecordId: "ocr_exp_extra"
  });
  const channelA: ProspectContactChannel = {
    id: "ch-export-a",
    teamId: "europe",
    ownerId: shirleyUser.id,
    prospectId: "tp-export",
    organizationId: "",
    contactId: "",
    channelType: "phone",
    value: "01066661234",
    normalizedValueHash: "",
    sourceEvidenceId: "",
    acquiredAt: "",
    idempotencyKeyHash: "",
    requestHash: "",
    recordHash: "",
    createdAt: "2026-04-04T00:00:00.000Z"
  };
  store.prospectContactChannels.push(channelA, { ...channelA, id: "ch-export-b", value: "02177771234" });
  store.websiteOpportunities.push({
    id: "cand-export",
    company: "导出候选",
    business: "",
    country: "瑞典",
    website: "",
    contact: "",
    contactInfo: "",
    description: "",
    ownerId: shirleyUser.id,
    teamId: "europe",
    status: "contactable",
    createdAt: "2026-04-04T00:00:00.000Z",
    tenantProspectId: "tp-export"
  } satisfies WebsiteOpportunity);
  store.aliyunAgentMappings.push(
    {
      id: "map_export_shirley",
      teamId: "europe",
      crmUserId: shirleyUser.id,
      cccUserId: "agent@ccc-export-a",
      loginName: "shirley",
      displayName: "Shirley坐席",
      extension: "8301",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_export_mia",
      teamId: "europe",
      crmUserId: miaUser.id,
      cccUserId: "agent@ccc-export-b",
      loginName: "mia",
      displayName: "Mia坐席",
      extension: "8302",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_export_asia",
      teamId: "asia",
      crmUserId: "u_export_asia",
      cccUserId: "agent@ccc-export-asia",
      loginName: "asia",
      displayName: "亚洲坐席",
      extension: "8303",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    }
  );
  store.outboundCallRecords.push(
    record({
      id: "ocr_exp_extra",
      agentIds: "agent@ccc-export-a",
      targetId: "c_export_extra",
      outboundCallAuditId: "oca_export_extra",
      maskedNumber: maskOutboundNumber("02188881234"),
      startTimeRaw: String(Date.parse("2026-04-05T01:00:00.000Z")),
      callOutcome: "有意向",
      callOutcomeNote: "要样品",
      callNote: "@纪要",
      callNoteTags: "需求,预算"
    }),
    record({
      id: "ocr_exp_main",
      agentIds: "agent@ccc-export-a",
      targetId: "c_export_main",
      maskedNumber: maskOutboundNumber("13700003333"),
      callOutcome: "无意向"
    }),
    record({
      id: "ocr_exp_guess",
      agentIds: "agent@ccc-export-a",
      targetId: "c_export_guess",
      maskedNumber: maskOutboundNumber("13911112222")
    }),
    record({
      id: "ocr_exp_miss",
      agentIds: "agent@ccc-export-a",
      targetId: "c_export_main",
      establishedTimeRaw: "",
      callDurationRaw: "9"
    }),
    record({
      id: "ocr_exp_bad_duration",
      agentIds: "agent@ccc-export-a",
      targetId: "c_export_main",
      callDurationRaw: "10.5",
      callOutcome: "其他"
    }),
    record({
      id: "ocr_exp_lead",
      agentIds: "agent@ccc-export-a",
      targetType: "lead",
      targetId: "l_export",
      outboundCallAuditId: "oca_export_lead",
      maskedNumber: maskOutboundNumber("+46800000000")
    }),
    record({
      id: "ocr_exp_prospect",
      agentIds: "agent@ccc-export-a",
      targetType: "prospect",
      targetId: "cand-export",
      maskedNumber: maskOutboundNumber("01066661234")
    }),
    record({
      id: "ocr_exp_prospect_picked",
      agentIds: "agent@ccc-export-a",
      targetType: "prospect",
      targetId: "cand-export",
      outboundCallAuditId: "oca_export_prospect",
      maskedNumber: maskOutboundNumber("02177771234")
    }),
    record({
      id: "ocr_exp_mia",
      agentIds: "agent@ccc-export-b",
      targetId: "c_export_mia",
      maskedNumber: maskOutboundNumber("13600004444")
    }),
    record({
      id: "ocr_exp_none",
      agentIds: "",
      targetId: "c_export_none",
      maskedNumber: maskOutboundNumber("13500005555")
    }),
    record({
      id: "ocr_exp_asia",
      teamId: "asia",
      agentIds: "agent@ccc-export-asia",
      targetId: "c_export_asia",
      maskedNumber: maskOutboundNumber("85290000000")
    })
  );

  const leadsBefore = store.leads.length;
  const phonesBefore = store.contactPhones.length;
  const preferredBefore = store.preferredPhones.length;
  const validityBefore = store.phoneValidities.length;
  const schedulesBefore = store.callbackSchedules.length;
  const notesBefore = store.outboundCallRecords.map((item) => `${item.id}:${item.callNote}`).join("|");
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  const keptAuditIds = new Set(store.callExportAudits.map((item) => item.id));

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const noRead = await login("no-export-read@keduoduo.com");

  const exported = await request("/api/outbound-call-records/export?from=2026-04-05&to=2026-04-05", shirley);
  assert.equal(exported.response.status, 200);
  assert.match(exported.response.headers.get("content-type") || "", /text\/csv/);
  assert.match(exported.response.headers.get("content-disposition") || "", /outbound-call-records\.csv/);
  assert.equal(exported.response.headers.get("cache-control"), "no-store");
  assert.deepEqual([exported.bytes[0], exported.bytes[1], exported.bytes[2]], [0xef, 0xbb, 0xbf]);
  assert.equal(exported.text.charCodeAt(0), 0xfeff);
  assert.match(exported.text, /时间,坐席,对象名,号码,接通与否,时长秒,人工结果标注,纪要,回拨预约/);
  assert.match(exported.text, /2026-04-05 09:00/);
  assert.match(exported.text, /Shirley坐席/);
  assert.match(exported.text, /'=导出公司/);
  assert.match(exported.text, /021\*\*\*\*1234/);
  assert.match(exported.text, /021\*\*\*\*1234,是,15,有意向 要样品,需求、预算 @纪要,"2026-04-06 09:00 你好,世界"/);
  assert.equal(exported.text.includes("021-8888-1234"), false);
  assert.equal(exported.text.includes("02188881234"), false);
  assert.equal(exported.text.includes("13800001111"), false);
  assert.equal(exported.text.includes("Mia Co"), false);
  assert.equal(exported.text.includes("@无坐席"), false);
  assert.equal(exported.text.includes("亚洲公司"), false);
  assert.equal(exported.text.includes("do-not-leak-export"), false);
  const dayAudit = store.callExportAudits.find((item) => item.actorId === shirleyUser.id && item.result === "exported" && item.filters.includes("2026-04-05"));
  assert.ok(dayAudit);
  assert.equal(dayAudit.rowCount, 1);
  assert.equal(dayAudit.plaintext, false);
  assert.equal(dayAudit.filters.includes("021"), false);

  const mine = await request("/api/outbound-call-records/export", shirley);
  assert.equal(mine.response.status, 200);
  assert.match(mine.text, /北欧工具/);
  assert.match(mine.text, /138\*\*\*\*1111|137\*\*\*\*3333/);
  assert.match(mine.text, /,否,/);
  assert.equal(mine.text.includes(",9,"), false);
  const badDurationLine = mine.text.split("\n").find((line) => line.includes("其他"));
  assert.ok(badDurationLine);
  assert.match(badDurationLine, /,是,,其他/);
  const missedLine = mine.text.split("\n").find((line) => line.includes(",否,"));
  assert.ok(missedLine);
  assert.match(missedLine, /,否,,/);
  assert.equal(mine.text.includes("13600004444"), false);
  assert.equal(mine.text.includes("Mia Co"), false);
  assert.equal(mine.text.includes("@无坐席"), false);
  assert.equal(mine.text.includes("85290000000"), false);
  assert.equal(mine.text.includes("13911112222"), false);
  assert.equal(mine.text.includes("01066661234"), false);
  assert.equal(mine.text.includes("02177771234"), false);

  const noteFilter = await request("/api/outbound-call-records/export?note=has", shirley);
  assert.equal(noteFilter.response.status, 200);
  assert.match(noteFilter.text, /@纪要/);
  assert.equal(noteFilter.text.includes("北欧工具"), false);
  const outcomeFilter = await request("/api/outbound-call-records/export?outcome=" + encodeURIComponent("无意向"), shirley);
  assert.equal(outcomeFilter.response.status, 200);
  assert.match(outcomeFilter.text, /无意向/);
  assert.equal(outcomeFilter.text.includes("@纪要"), false);

  const otherAgent = await request("/api/outbound-call-records/export?agentId=agent@ccc-export-b", shirley);
  assert.equal(otherAgent.response.status, 403);
  assert.equal(otherAgent.json.reason, "forbidden");
  assert.equal(otherAgent.text.includes("13600004444"), false);
  assert.equal(store.callExportAudits.some((item) => item.actorId === shirleyUser.id && item.reason === "forbidden" && item.rowCount === 0), true);

  const auditsBeforeInvalid = store.callExportAudits.length;
  const invalid = await request("/api/outbound-call-records/export?outcome=Success", shirley);
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.json.reason, "invalid_request");
  const invalidPlain = await request("/api/outbound-call-records/export?plaintext=yes", shirley);
  assert.equal(invalidPlain.response.status, 400);
  const invalidArray = await request("/api/outbound-call-records/export?plaintext=1&plaintext=0", shirley);
  assert.equal(invalidArray.response.status, 400);
  assert.equal(store.callExportAudits.length, auditsBeforeInvalid);

  const salesPlain = await request("/api/outbound-call-records/export?plaintext=1", shirley);
  assert.equal(salesPlain.response.status, 403);
  assert.equal(salesPlain.json.reason, "plaintext_forbidden");
  assert.equal(salesPlain.text.includes("021-8888-1234"), false);
  const managerPlain = await request("/api/outbound-call-records/export?plaintext=1", alex);
  assert.equal(managerPlain.response.status, 403);
  assert.equal(managerPlain.json.reason, "plaintext_forbidden");
  const manager = await request("/api/outbound-call-records/export", alex);
  assert.equal(manager.response.status, 200);
  assert.match(manager.text, /Shirley坐席/);
  assert.match(manager.text, /Mia坐席/);
  assert.equal(manager.text.includes("@无坐席"), false);
  assert.equal(manager.text.includes("021-8888-1234"), false);
  assert.equal(manager.text.includes("13600004444"), false);

  const adminMasked = await request("/api/outbound-call-records/export", admin);
  assert.equal(adminMasked.response.status, 200);
  assert.match(adminMasked.text, /'@无坐席/);
  assert.equal(adminMasked.text.includes("021-8888-1234"), false);
  assert.equal(adminMasked.text.includes("亚洲公司"), false);
  const adminPlain = await request("/api/outbound-call-records/export?plaintext=1", admin);
  assert.equal(adminPlain.response.status, 200);
  assert.match(adminPlain.text, /021-8888-1234/);
  assert.match(adminPlain.text, /'\+46800000000/);
  assert.match(adminPlain.text, /13600004444/);
  assert.match(adminPlain.text, /02177771234/);
  assert.equal(adminPlain.text.includes("13800001111"), false);
  assert.equal(adminPlain.text.includes("13911112222"), false);
  assert.equal(adminPlain.text.includes("01066661234"), false);
  assert.equal(adminPlain.text.includes("85290000000"), false);
  assert.equal(adminPlain.text.includes("do-not-leak-export"), false);
  const plainAudit = store.callExportAudits.find((item) => item.actorId === "u_admin" && item.plaintext && item.result === "exported");
  assert.ok(plainAudit);
  assert.equal(plainAudit.filters.includes("021-8888"), false);

  const denied = await request("/api/outbound-call-records/export", noRead);
  assert.equal(denied.response.status, 403);
  assert.equal(store.callExportAudits.some((item) => item.actorId === "u_no_export_read" && item.reason === "forbidden" && item.rowCount === 0), true);
  assert.equal(denied.text.includes("021-8888-1234"), false);

  const bulkStart = String(Date.parse("2020-01-02T02:00:00.000Z"));
  for (let index = 0; index < CALL_EXPORT_ROW_LIMIT; index += 1) {
    store.outboundCallRecords.push(record({
      id: `ocr_exp_bulk_${index}`,
      agentIds: "agent@ccc-export-a",
      targetId: "c_export_main",
      maskedNumber: "****",
      startTimeRaw: bulkStart,
      establishedTimeRaw: "",
      callDurationRaw: ""
    }));
  }
  const full = await request("/api/outbound-call-records/export?from=2020-01-02&to=2020-01-02", shirley);
  assert.equal(full.response.status, 200);
  const fullLines = full.text.split("\n").filter((line) => line.trim());
  assert.equal(fullLines.length, CALL_EXPORT_ROW_LIMIT + 1);
  assert.equal(store.callExportAudits.some((item) => item.reason === "" && item.rowCount === CALL_EXPORT_ROW_LIMIT && item.filters.includes("2020-01-02")), true);
  store.outboundCallRecords.push(record({
    id: "ocr_exp_bulk_over",
    agentIds: "agent@ccc-export-a",
    targetId: "c_export_main",
    maskedNumber: "****",
    startTimeRaw: bulkStart,
    callNote: "=超限"
  }));
  const over = await request("/api/outbound-call-records/export?from=2020-01-02&to=2020-01-02&plaintext=0", admin);
  assert.equal(over.response.status, 400);
  assert.equal(over.json.reason, "too_many_rows");
  assert.match(over.json.message, /10000/);
  assert.match(over.json.message, /缩小/);
  assert.equal(over.json.rowCount, CALL_EXPORT_ROW_LIMIT + 1);
  assert.equal(over.text.includes("=超限"), false);
  assert.equal(over.response.headers.get("content-type")?.includes("text/csv") || false, false);
  const overAudit = store.callExportAudits.find((item) => item.reason === "too_many_rows");
  assert.ok(overAudit);
  assert.equal(overAudit.rowCount, CALL_EXPORT_ROW_LIMIT + 1);
  assert.equal(overAudit.plaintext, false);
  assert.match(overAudit.filters, /2020-01-02/);

  assert.equal(aliyunHits, 0);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.contactPhones.length, phonesBefore);
  assert.equal(store.preferredPhones.length, preferredBefore);
  assert.equal(store.phoneValidities.length, validityBefore);
  assert.equal(store.callbackSchedules.length, schedulesBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  assert.equal(store.outboundCallRecords.filter((item) => item.id.startsWith("ocr_exp_") && !item.id.startsWith("ocr_exp_bulk_")).map((item) => `${item.id}:${item.callNote}`).join("|"), notesBefore.split("|").filter((item) => item.startsWith("ocr_exp_") && !item.startsWith("ocr_exp_bulk_")).join("|"));
  const auditText = JSON.stringify(store.callExportAudits.filter((item) => !keptAuditIds.has(item.id)));
  assert.equal(auditText.includes("021-8888-1234"), false);
  assert.equal(auditText.includes("13800001111"), false);
  assert.equal(auditText.includes("+46800000000"), false);
  assert.equal(auditText.includes("do-not-leak-export"), false);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(customerPhoneId("c_export_main"), "customer-phone:c_export_main");

  console.log("call export http tests passed");
} finally {
  const store = getStore();
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_exp_"));
  store.outboundCallAudits = store.outboundCallAudits.filter((item) => !item.id.startsWith("oca_export_"));
  store.callExportAudits = store.callExportAudits.filter((item) => item.actorId !== "u_sales_shirley" && item.actorId !== "u_sales_mia" && item.actorId !== "u_manager_alex" && item.actorId !== "u_admin" && item.actorId !== "u_no_export_read");
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_export_"));
  store.customers = store.customers.filter((item) => !item.id.startsWith("c_export_"));
  store.leads = store.leads.filter((item) => item.id !== "l_export");
  store.contactPhones = store.contactPhones.filter((item) => !item.id.startsWith("cph_export_"));
  store.callbackSchedules = store.callbackSchedules.filter((item) => item.id !== "cbs_export");
  store.prospectContactChannels = store.prospectContactChannels.filter((item) => !item.id.startsWith("ch-export-"));
  store.websiteOpportunities = store.websiteOpportunities.filter((item) => item.id !== "cand-export");
  store.users = store.users.filter((item) => item.id !== "u_no_export_read" && item.id !== "u_export_asia");
  globalThis.fetch = originalFetch;
  server.close();
}
