import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import type { CallScriptTemplate, OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call script usage test server");
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
  const json = (response.headers.get("content-type") || "").includes("json") && text
    ? JSON.parse(text) as Record<string, any>
    : {};
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
    startTimeRaw: String(Date.parse("2026-04-04T04:00:00.000Z")),
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/do-not-leak-script",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "有意向",
    callOutcomeNote: "原标注",
    callNote: "原纪要",
    callNoteTags: "需求",
    callNoteUpdatedAt: "2026-04-04T01:00:00.000Z",
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
    body: "正文勿导出",
    enabled: true,
    createdBy: "u_admin",
    updatedBy: "u_admin",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    disabledAt: "",
    ...partial
  };
}

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const adminUser = store.users.find((item) => item.email === "admin@keduoduo.com");
  assert.ok(shirleyUser && miaUser && adminUser);
  store.users.push({
    ...shirleyUser,
    id: "u_no_script_usage_read",
    name: "No Script Usage Read",
    email: "no-script-usage-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...adminUser,
    id: "u_script_usage_asia",
    name: "Asia Script Usage",
    email: "asia-script-usage@keduoduo.com",
    role: "admin",
    teamId: "asia",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_no_script_usage_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };

  const activitiesBefore = store.customerActivities.length;
  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const scriptAuditsBefore = store.callScriptAudits.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);

  store.aliyunAgentMappings.push(
    {
      id: "map_su_shirley",
      teamId: "europe",
      crmUserId: shirleyUser.id,
      cccUserId: "agent@ccc-su-a",
      loginName: "shirley",
      displayName: "Shirley坐席",
      extension: "8201",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_su_mia",
      teamId: "europe",
      crmUserId: miaUser.id,
      cccUserId: "agent@ccc-su-b",
      loginName: "mia",
      displayName: "Mia坐席",
      extension: "8202",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_su_asia",
      teamId: "asia",
      crmUserId: "u_script_usage_asia",
      cccUserId: "agent@ccc-su-asia",
      loginName: "asia",
      displayName: "亚洲坐席",
      extension: "8203",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    }
  );
  store.callScriptTemplates.push(
    template({ id: "cst_su_a", title: "=开场" }),
    template({ id: "cst_su_b", title: "回访", scenario: "follow_up" }),
    template({ id: "cst_su_c", title: "旧话术", enabled: false, disabledAt: "2026-04-02T00:00:00.000Z" }),
    template({ id: "cst_su_d", title: "未用", scenario: "objection" }),
    template({ id: "cst_su_asia", teamId: "asia", title: "亚洲话术", body: "亚洲正文勿出现" })
  );
  store.outboundCallRecords.push(
    record({ id: "ocr_su_a1", agentIds: "agent@ccc-su-a" }),
    record({ id: "ocr_su_a2", agentIds: "agent@ccc-su-a", callScriptTemplateId: "cst_su_a" }),
    record({ id: "ocr_su_a3", agentIds: "agent@ccc-su-a", callScriptTemplateId: "cst_su_a", establishedTimeRaw: "" }),
    record({ id: "ocr_su_b", agentIds: "agent@ccc-su-a", callScriptTemplateId: "cst_su_b" }),
    record({ id: "ocr_su_c", agentIds: "agent@ccc-su-a", callScriptTemplateId: "cst_su_c" }),
    record({ id: "ocr_su_mia", agentIds: "agent@ccc-su-b", callScriptTemplateId: "cst_su_a", targetId: "c2" }),
    record({ id: "ocr_su_none", agentIds: "" }),
    record({ id: "ocr_su_asia", teamId: "asia", agentIds: "agent@ccc-su-asia", callScriptTemplateId: "cst_su_a", targetId: "c_asia" })
  );

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const noRead = await login("no-script-usage-read@keduoduo.com");
  const asia = await login("asia-script-usage@keduoduo.com");

  const before = await request("/api/call-script-usage", admin);
  assert.equal(before.response.status, 200);
  assert.equal(store.callScriptUsageAudits.length, 0);
  const countOf = (id: string) => before.json.templates.find((item: { id: string; usageCount: number }) => item.id === id)?.usageCount;
  assert.equal(countOf("cst_su_a"), 3);
  assert.equal(countOf("cst_su_b"), 1);
  assert.equal(countOf("cst_su_c"), 1);
  assert.equal(countOf("cst_su_d"), 0);
  assert.equal(before.json.templates.some((item: { id: string }) => item.id === "cst_su_asia"), false);
  assert.equal(JSON.stringify(before.json).includes("usageRate"), false);
  assert.equal(JSON.stringify(before.json).includes("正文勿导出"), false);

  const salesStats = await request("/api/call-script-usage", shirley);
  assert.equal(salesStats.response.status, 403);
  assert.equal(salesStats.json.reason, "forbidden");
  assert.equal(store.callScriptUsageAudits.some((item) => item.actorId === shirleyUser.id && item.action === "read" && item.result === "rejected"), true);
  const managerStats = await request("/api/call-script-usage", alex);
  assert.equal(managerStats.response.status, 403);
  assert.equal(managerStats.json.templates, undefined);
  const badQuery = await request("/api/call-script-usage?templates=1", admin);
  assert.equal(badQuery.response.status, 400);
  assert.equal(store.callScriptUsageAudits.filter((item) => item.action === "read" && item.result === "updated").length, 0);

  const invalid = await request("/api/outbound-call-records/ocr_su_a1/script", shirley, "POST", { templateId: "bad id" });
  assert.equal(invalid.response.status, 400);
  assert.equal(store.callScriptUsageAudits.filter((item) => item.action !== "read").length, 0);
  const batch = await request("/api/outbound-call-records/ocr_su_a1/script", shirley, "POST", { templateId: "cst_su_a", records: ["ocr_su_a1"] });
  assert.equal(batch.response.status, 400);
  const missingKey = await request("/api/outbound-call-records/ocr_su_a1/script", shirley, "POST", {});
  assert.equal(missingKey.response.status, 400);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_su_a1")?.callScriptTemplateId, "");

  const disabled = await request("/api/outbound-call-records/ocr_su_a1/script", shirley, "POST", { templateId: "cst_su_c" });
  assert.equal(disabled.response.status, 400);
  assert.equal(disabled.json.reason, "disabled");
  assert.equal(store.callScriptUsageAudits.filter((item) => item.callRecordId === "ocr_su_a1").length, 0);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_su_a1")?.callScriptTemplateId, "");

  const created = await request("/api/outbound-call-records/ocr_su_a1/script", shirley, "POST", { templateId: "cst_su_a" });
  assert.equal(created.response.status, 200);
  assert.equal(created.json.action, "set");
  assert.equal(created.json.record.callScriptTitle, "=开场");
  assert.equal(created.json.record.callScriptTemplateId, "cst_su_a");
  assert.equal(JSON.stringify(created.json).includes("do-not-leak-script"), false);
  assert.equal(JSON.stringify(created.json).includes("正文勿导出"), false);
  const saved = store.outboundCallRecords.find((item) => item.id === "ocr_su_a1");
  assert.equal(saved?.callScriptTemplateId, "cst_su_a");
  assert.equal(saved?.updatedAt, "2026-04-04T00:00:00.000Z");
  assert.equal(saved?.callOutcome, "有意向");
  assert.equal(saved?.callNote, "原纪要");
  assert.equal(saved?.contactDisposition, "NoAnswer");
  const first = store.callScriptUsageAudits.find((item) => item.callRecordId === "ocr_su_a1" && item.result === "updated");
  assert.equal(first?.actorId, shirleyUser.id);
  assert.equal(first?.action, "set");
  assert.equal(first?.previousTemplateId, "");
  assert.equal(first?.nextTemplateId, "cst_su_a");
  assert.ok(first?.at);

  const same = await request("/api/outbound-call-records/ocr_su_a1/script", shirley, "POST", { templateId: "cst_su_a" });
  assert.equal(same.json.result, "unchanged");
  assert.equal(store.callScriptUsageAudits.filter((item) => item.callRecordId === "ocr_su_a1" && item.result === "updated").length, 1);

  const edited = await request("/api/outbound-call-records/ocr_su_a1/script", shirley, "POST", { templateId: "cst_su_b" });
  assert.equal(edited.json.action, "update");
  assert.equal(store.callScriptUsageAudits.find((item) => item.callRecordId === "ocr_su_a1" && item.action === "update")?.previousTemplateId, "cst_su_a");
  const cleared = await request("/api/outbound-call-records/ocr_su_a1/script", shirley, "POST", { templateId: null });
  assert.equal(cleared.json.action, "clear");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_su_a1")?.callScriptTemplateId, "");
  const clearAgain = await request("/api/outbound-call-records/ocr_su_a1/script", shirley, "POST", { templateId: "" });
  assert.equal(clearAgain.json.result, "unchanged");
  assert.equal(store.callScriptUsageAudits.filter((item) => item.callRecordId === "ocr_su_a1" && item.action === "clear").length, 1);

  const keepDisabled = await request("/api/outbound-call-records/ocr_su_c/script", shirley, "POST", { templateId: "cst_su_c" });
  assert.equal(keepDisabled.json.result, "unchanged");
  assert.equal(store.callScriptUsageAudits.filter((item) => item.callRecordId === "ocr_su_c").length, 0);

  const deniedRead = await request("/api/outbound-call-records/ocr_su_a2/script", noRead, "POST", { templateId: "cst_su_b" });
  assert.equal(deniedRead.response.status, 403);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_su_a2")?.callScriptTemplateId, "cst_su_a");
  const hidden = await request("/api/outbound-call-records/ocr_su_mia/script", shirley, "POST", { templateId: "cst_su_b" });
  assert.equal(hidden.response.status, 403);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_su_mia")?.callScriptTemplateId, "cst_su_a");
  assert.equal(hidden.json.record, undefined);
  const manager = await request("/api/outbound-call-records/ocr_su_mia/script", alex, "POST", { templateId: "cst_su_b" });
  assert.equal(manager.response.status, 200);
  assert.equal(manager.json.action, "update");
  const unmapped = await request("/api/outbound-call-records/ocr_su_none/script", shirley, "POST", { templateId: "cst_su_a" });
  assert.equal(unmapped.response.status, 403);
  const adminSet = await request("/api/outbound-call-records/ocr_su_none/script", admin, "POST", { templateId: "cst_su_d" });
  assert.equal(adminSet.response.status, 200);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_su_none")?.callScriptTemplateId, "cst_su_d");

  const foreignTemplate = await request("/api/outbound-call-records/ocr_su_a2/script", shirley, "POST", { templateId: "cst_su_asia" });
  assert.equal(foreignTemplate.response.status, 404);
  assert.equal(foreignTemplate.json.reason, "not_found");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_su_a2")?.callScriptTemplateId, "cst_su_a");
  assert.equal(JSON.stringify(store.callScriptUsageAudits).includes("亚洲正文勿出现"), false);
  const foreignCall = await request("/api/outbound-call-records/ocr_su_asia/script", shirley, "POST", { templateId: "cst_su_b" });
  assert.equal(foreignCall.response.status, 403);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_su_asia")?.callScriptTemplateId, "cst_su_a");
  const reverse = await request("/api/outbound-call-records/ocr_su_a2/script", asia, "POST", { templateId: "cst_su_asia" });
  assert.equal(reverse.response.status, 403);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_su_a2")?.callScriptTemplateId, "cst_su_a");
  const ownAsia = await request("/api/outbound-call-records/ocr_su_asia/script", asia, "POST", { templateId: "cst_su_asia" });
  assert.equal(ownAsia.response.status, 200);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_su_asia")?.callScriptTemplateId, "cst_su_asia");

  const missing = await request("/api/outbound-call-records/ocr_su_missing/script", shirley, "POST", { templateId: "cst_su_a" });
  assert.equal(missing.response.status, 403);

  const baseline = await request("/api/outbound-call-records", shirley);
  assert.equal(baseline.response.status, 200);
  assert.equal(baseline.json.stats.totalCalls, 5);
  const byScript = await request("/api/outbound-call-records?script=cst_su_a", shirley);
  assert.equal(byScript.response.status, 200);
  assert.equal(byScript.json.stats.totalCalls, 5);
  assert.deepEqual(byScript.json.records.map((item: { id: string }) => item.id).sort(), ["ocr_su_a2", "ocr_su_a3"]);
  assert.equal(byScript.json.records.every((item: { callScriptTitle: string }) => item.callScriptTitle === "=开场"), true);
  assert.equal(JSON.stringify(byScript.json).includes("正文勿导出"), false);
  const none = await request("/api/outbound-call-records?script=none", shirley);
  assert.equal(none.json.records.length, 1);
  assert.equal(none.json.records[0].id, "ocr_su_a1");
  assert.equal(none.json.records[0].callScriptTitle, "");
  assert.equal(none.json.stats.totalCalls, 5);
  const badFilter = await request("/api/outbound-call-records?script=不是", shirley);
  assert.equal(badFilter.response.status, 400);
  const miaList = await request("/api/outbound-call-records?script=cst_su_b", mia);
  assert.equal(miaList.json.records.some((item: { id: string }) => item.id === "ocr_su_mia"), true);
  assert.equal(miaList.json.records.some((item: { id: string }) => item.id.startsWith("ocr_su_a")), false);

  const detail = await request("/api/outbound-call-records/ocr_su_a2", shirley);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.json.record.callScriptTitle, "=开场");
  assert.equal(detail.json.scriptChoices.some((item: { id: string }) => item.id === "cst_su_a"), true);
  assert.equal(detail.json.scriptChoices.some((item: { id: string }) => item.id === "cst_su_c"), false);
  assert.equal(detail.json.scriptChoices.some((item: { id: string }) => item.id === "cst_su_asia"), false);
  assert.equal(JSON.stringify(detail.json).includes("do-not-leak-script"), false);

  const exported = await request("/api/outbound-call-records/export?script=cst_su_a", shirley);
  assert.equal(exported.response.status, 200);
  assert.match(exported.response.headers.get("content-type") || "", /text\/csv/);
  assert.match(exported.text, /所用话术/);
  assert.match(exported.text, /'=开场/);
  assert.match(exported.text, /\*\*\*\*\*\*\*2333/);
  assert.equal(exported.text.includes("正文勿导出"), false);
  assert.equal(exported.text.includes("do-not-leak-script"), false);
  assert.equal(exported.text.includes("ocr_su_mia"), false);
  const exportAudit = store.callExportAudits.find((item) => item.actorId === shirleyUser.id && item.result === "exported");
  assert.match(exportAudit?.filters || "", /cst_su_a/);
  assert.equal((exportAudit?.filters || "").includes("2333"), false);

  const after = await request("/api/call-script-usage", admin);
  assert.equal(after.json.templates.find((item: { id: string; usageCount: number }) => item.id === "cst_su_a")?.usageCount, 2);
  assert.equal(after.json.templates.find((item: { id: string; usageCount: number }) => item.id === "cst_su_b")?.usageCount, 2);
  assert.equal(after.json.templates.find((item: { id: string; usageCount: number }) => item.id === "cst_su_d")?.usageCount, 1);
  const asiaStats = await request("/api/call-script-usage", asia);
  assert.equal(asiaStats.json.templates.find((item: { id: string }) => item.id === "cst_su_a"), undefined);
  assert.equal(asiaStats.json.templates.find((item: { id: string; usageCount: number }) => item.id === "cst_su_asia")?.usageCount, 1);

  assert.equal(aliyunHits, 0);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.callScriptAudits.length, scriptAuditsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  const auditText = JSON.stringify(store.callScriptUsageAudits);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("do-not-leak-script"), false);
  assert.equal(auditText.includes("正文勿导出"), false);
  assert.equal(auditText.includes("亚洲正文勿出现"), false);

  console.log("call script usage http tests passed");
} finally {
  const store = getStore();
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_su_"));
  store.callScriptTemplates = store.callScriptTemplates.filter((item) => !item.id.startsWith("cst_su_"));
  store.callScriptUsageAudits = store.callScriptUsageAudits.filter((item) => !item.callRecordId.startsWith("ocr_su_") && item.action !== "read");
  store.callExportAudits = store.callExportAudits.filter((item) => !(item.filters || "").includes("cst_su_"));
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_su_"));
  store.users = store.users.filter((item) => item.id !== "u_no_script_usage_read" && item.id !== "u_script_usage_asia");
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
