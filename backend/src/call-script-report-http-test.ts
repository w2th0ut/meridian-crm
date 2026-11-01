import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import type { CallScriptTemplate, CallbackSchedule, OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call script report test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

async function request(path: string, token: string, method = "GET") {
  const response = await originalFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  });
  const type = response.headers.get("content-type") || "";
  if (type.includes("text/csv")) {
    const bytes = Buffer.from(await response.arrayBuffer());
    const text = bytes.toString("utf8");
    return { response, text, bytes, json: {} as Record<string, any> };
  }
  const text = await response.text();
  const json = type.includes("json") && text ? JSON.parse(text) as Record<string, any> : {};
  return { response, text, bytes: Buffer.alloc(0), json };
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
    outboundCallAuditId: "",
    targetType: "customer",
    targetId: "c1",
    maskedNumber: "*******2333",
    contactType: "OUTBOUND",
    contactDisposition: "NoAnswer",
    earlyMediaState: "",
    callDurationRaw: "10",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: String(Date.parse("2026-04-03T16:30:00.000Z")),
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/do-not-leak-script-report",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "有意向",
    callOutcomeNote: "",
    callNote: "",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

function template(partial: Partial<CallScriptTemplate> & Pick<CallScriptTemplate, "id">): CallScriptTemplate {
  return {
    teamId: "europe",
    title: "开场",
    scenario: "first_call",
    language: "zh",
    body: "报表正文勿出现",
    enabled: true,
    createdBy: "u_admin",
    updatedBy: "u_admin",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    disabledAt: "",
    ...partial
  };
}

function schedule(partial: Partial<CallbackSchedule> & Pick<CallbackSchedule, "id" | "sourceCallRecordId" | "targetId">): CallbackSchedule {
  return {
    teamId: "europe",
    targetType: "customer",
    scheduledAt: "2026-04-05 09:00",
    note: "",
    updatedBy: "u_admin",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const alexUser = store.users.find((item) => item.email === "alex@keduoduo.com");
  const adminUser = store.users.find((item) => item.email === "admin@keduoduo.com");
  assert.ok(shirleyUser && alexUser && adminUser);
  store.users.push({
    ...adminUser,
    id: "u_script_report_asia",
    name: "Asia Script Report",
    email: "asia-script-report@keduoduo.com",
    role: "admin",
    teamId: "asia",
    status: "active"
  });

  const activitiesBefore = store.customerActivities.length;
  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const scriptAuditsBefore = store.callScriptAudits.length;
  const favoriteBefore = store.callScriptFavorites.length;
  const usageAuditsBefore = store.callScriptUsageAudits.length;
  const callbackAuditsBefore = store.callbackScheduleAudits.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  const updatedBefore = new Map(store.outboundCallRecords.map((item) => [item.id, item.updatedAt]));

  store.aliyunAgentMappings.push({
    id: "map_sr_shirley",
    teamId: "europe",
    crmUserId: shirleyUser.id,
    cccUserId: "agent@ccc-sr-a",
    loginName: "shirley",
    displayName: "Shirley坐席",
    extension: "8201",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  });
  store.callScriptTemplates.push(
    template({ id: "cst_sr_a", title: "=开场" }),
    template({ id: "cst_sr_b", title: "回访", scenario: "follow_up" }),
    template({ id: "cst_sr_c", title: "旧话术", enabled: false, disabledAt: "2026-04-02T00:00:00.000Z", scenario: "objection" }),
    template({ id: "cst_sr_asia", title: "亚洲", teamId: "asia", body: "亚洲正文勿出现" })
  );
  store.outboundCallRecords.push(
    record({ id: "ocr_sr_a1", agentIds: "agent@ccc-sr-a", callScriptTemplateId: "cst_sr_a", callOutcome: "有意向", callDurationRaw: "10" }),
    record({ id: "ocr_sr_a2", agentIds: "agent@ccc-sr-a", callScriptTemplateId: "cst_sr_a", callOutcome: "需回访", establishedTimeRaw: "", callDurationRaw: "30", contactDisposition: "Success" }),
    record({ id: "ocr_sr_old", agentIds: "agent@ccc-sr-a", callScriptTemplateId: "cst_sr_a", startTimeRaw: String(Date.parse("2026-04-03T15:00:00.000Z")) }),
    record({ id: "ocr_sr_b", agentIds: "agent@ccc-sr-b", callScriptTemplateId: "cst_sr_b" }),
    record({ id: "ocr_sr_none", agentIds: "agent@ccc-sr-a", callScriptTemplateId: "" }),
    record({ id: "ocr_sr_missing", agentIds: "agent@ccc-sr-a", callScriptTemplateId: "cst_missing" }),
    record({ id: "ocr_sr_asia", teamId: "asia", agentIds: "agent@ccc-sr-asia", callScriptTemplateId: "cst_sr_asia" })
  );
  store.callbackSchedules.push(
    schedule({ id: "cb_sr_a", targetId: "c_sr_a", sourceCallRecordId: "ocr_sr_a1" }),
    schedule({ id: "cb_sr_none", targetId: "c_sr_none", sourceCallRecordId: "ocr_sr_none" }),
    schedule({ id: "cb_sr_empty", targetId: "c_sr_empty", sourceCallRecordId: "" })
  );
  store.callbackScheduleAudits.push({
    id: "cba_sr_noise",
    teamId: "europe",
    actorId: adminUser.id,
    at: "2026-04-04T00:00:00.000Z",
    action: "set",
    targetType: "customer",
    targetId: "c_sr_a",
    previousScheduledAt: "",
    nextScheduledAt: "2026-04-05 09:00",
    previousNote: "",
    nextNote: "",
    result: "updated",
    reason: "",
    sourceCallRecordId: "ocr_sr_a1"
  });

  const admin = await login("admin@keduoduo.com");
  const shirley = await login("shirley@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const asia = await login("asia-script-report@keduoduo.com");

  const bad = await request("/api/call-script-report?scenario=nope", admin);
  assert.equal(bad.response.status, 400);
  assert.equal(bad.json.reason, "invalid_request");
  const auditsBefore = store.callScriptReportAudits.length;
  const extra = await request("/api/call-script-report?plaintext=1", admin);
  assert.equal(extra.response.status, 400);
  assert.equal(store.callScriptReportAudits.length, auditsBefore);

  const denied = await request("/api/call-script-report", shirley);
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.reason, "forbidden");
  assert.equal("rows" in denied.json, false);
  assert.equal(JSON.stringify(denied.json).includes("报表正文勿出现"), false);
  assert.equal(store.callScriptReportAudits.some((item) => item.actorId === shirleyUser.id && item.action === "read" && item.result === "rejected" && item.reason === "forbidden" && item.rowCount === 0), true);
  const manager = await request("/api/call-script-report/export", alex);
  assert.equal(manager.response.status, 403);
  assert.equal(manager.response.headers.get("content-type")?.includes("text/csv"), false);
  assert.equal(store.callScriptReportAudits.some((item) => item.actorId === alexUser.id && item.action === "export" && item.result === "rejected"), true);

  const viewed = await request("/api/call-script-report?from=2026-04-04&to=2026-04-04", admin);
  assert.equal(viewed.response.status, 200);
  assert.equal(viewed.json.metrics.callCount, true);
  assert.equal(viewed.json.metrics.connectedCount, true);
  assert.equal(viewed.json.metrics.outcomes, true);
  assert.equal(viewed.json.metrics.averageConnectedDurationSeconds, true);
  assert.equal(viewed.json.metrics.callbackAppointmentCount, true);
  assert.equal("connectRate" in viewed.json.metrics, false);
  const opening = viewed.json.rows.find((item: { templateId: string }) => item.templateId === "cst_sr_a");
  assert.equal(opening.callCount, 2);
  assert.equal(opening.connectedCount, 1);
  assert.equal(opening.outcomes["有意向"], 1);
  assert.equal(opening.outcomes["需回访"], 1);
  assert.equal(opening.averageConnectedDurationSeconds, 10);
  assert.equal(opening.callbackAppointmentCount, 1);
  const unlinked = viewed.json.rows.find((item: { linked: boolean }) => item.linked === false);
  assert.equal(unlinked.title, "未选用");
  assert.equal(unlinked.callCount, 2);
  assert.equal(unlinked.callbackAppointmentCount, 1);
  assert.equal(viewed.json.rows.some((item: { templateId: string }) => item.templateId === "cst_sr_c"), true);
  assert.equal(viewed.json.rows.some((item: { templateId: string }) => item.templateId === "cst_sr_asia"), false);
  assert.equal(JSON.stringify(viewed.json).includes("cst_missing"), false);
  assert.equal(JSON.stringify(viewed.json).includes("报表正文勿出现"), false);
  assert.equal(JSON.stringify(viewed.json).includes("do-not-leak-script-report"), false);
  assert.equal(JSON.stringify(viewed.json).includes("*******2333"), false);
  assert.equal(viewed.json.agents.some((item: { id: string; label: string }) => item.id === "agent@ccc-sr-a" && item.label === "Shirley坐席"), true);
  const readAudit = store.callScriptReportAudits.find((item) => item.actorId === adminUser.id && item.action === "read" && item.result === "read");
  assert.ok(readAudit);
  assert.match(readAudit.filters, /2026-04-04/);
  assert.equal(readAudit.filters.includes("2333"), false);
  assert.equal(readAudit.filters.includes("报表正文勿出现"), false);
  assert.equal(readAudit.rowCount, viewed.json.rows.length);

  const again = await request("/api/call-script-report?from=2026-04-04&to=2026-04-04", admin);
  assert.equal(again.response.status, 200);
  assert.equal(store.callScriptReportAudits.filter((item) => item.actorId === adminUser.id && item.action === "read" && item.result === "read").length, 2);

  const scenario = await request("/api/call-script-report?scenario=follow_up", admin);
  assert.equal(scenario.response.status, 200);
  assert.deepEqual(scenario.json.rows.map((item: { templateId: string }) => item.templateId), ["cst_sr_b"]);
  const agent = await request("/api/call-script-report?agentId=agent@ccc-sr-b", admin);
  assert.equal(agent.json.rows.find((item: { templateId: string }) => item.templateId === "cst_sr_a").callCount, 0);
  assert.equal(agent.json.rows.find((item: { templateId: string }) => item.templateId === "cst_sr_b").callCount, 1);

  const exported = await request("/api/call-script-report/export?from=2026-04-04&to=2026-04-04", admin);
  assert.equal(exported.response.status, 200);
  assert.match(exported.response.headers.get("content-type") || "", /text\/csv/);
  assert.equal(exported.response.headers.get("cache-control"), "no-store");
  assert.deepEqual([exported.bytes[0], exported.bytes[1], exported.bytes[2]], [0xef, 0xbb, 0xbf]);
  assert.equal(exported.text.charCodeAt(0), 0xfeff);
  assert.match(exported.text, /话术,场景,启用/);
  assert.match(exported.text, /'=开场/);
  assert.match(exported.text, /未选用/);
  assert.equal(exported.text.includes("报表正文勿出现"), false);
  assert.equal(exported.text.includes("亚洲正文勿出现"), false);
  assert.equal(exported.text.includes("do-not-leak-script-report"), false);
  assert.equal(exported.text.includes("*******2333"), false);
  assert.equal(exported.text.includes("13800138000"), false);
  const exportAudit = store.callScriptReportAudits.find((item) => item.actorId === adminUser.id && item.action === "export" && item.result === "exported");
  assert.ok(exportAudit);
  assert.equal(exportAudit.filters.includes("2333"), false);

  const salesExport = await request("/api/call-script-report/export", shirley);
  assert.equal(salesExport.response.status, 403);
  assert.equal(salesExport.text.includes("话术,场景"), false);

  const asiaView = await request("/api/call-script-report", asia);
  assert.equal(asiaView.response.status, 200);
  assert.equal(asiaView.json.rows.some((item: { templateId: string }) => item.templateId === "cst_sr_a"), false);
  assert.equal(asiaView.json.rows.some((item: { templateId: string }) => item.templateId === "cst_sr_asia"), true);
  assert.equal(JSON.stringify(asiaView.json).includes("亚洲正文勿出现"), false);

  assert.equal(aliyunHits, 0);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.callScriptAudits.length, scriptAuditsBefore);
  assert.equal(store.callScriptFavorites.length, favoriteBefore);
  assert.equal(store.callScriptUsageAudits.length, usageAuditsBefore);
  assert.equal(store.callbackScheduleAudits.length, callbackAuditsBefore + 1);
  assert.equal(store.callbackSchedules.filter((item) => item.id.startsWith("cb_sr_")).length, 3);
  for (const [id, at] of updatedBefore) {
    assert.equal(store.outboundCallRecords.find((item) => item.id === id)?.updatedAt, at);
  }
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_sr_a1")?.callScriptTemplateId, "cst_sr_a");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_sr_a1")?.updatedAt, "2026-04-04T00:00:00.000Z");
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  const auditText = JSON.stringify(store.callScriptReportAudits);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("do-not-leak-script-report"), false);
  assert.equal(auditText.includes("报表正文勿出现"), false);
  assert.equal(auditText.includes("亚洲正文勿出现"), false);

  console.log("call script report http tests passed");
} finally {
  const store = getStore();
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_sr_"));
  store.callScriptTemplates = store.callScriptTemplates.filter((item) => !item.id.startsWith("cst_sr_"));
  store.callbackSchedules = store.callbackSchedules.filter((item) => !item.id.startsWith("cb_sr_"));
  store.callbackScheduleAudits = store.callbackScheduleAudits.filter((item) => item.id !== "cba_sr_noise");
  store.callScriptReportAudits = store.callScriptReportAudits.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => item.id !== "map_sr_shirley");
  store.users = store.users.filter((item) => item.id !== "u_script_report_asia");
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
