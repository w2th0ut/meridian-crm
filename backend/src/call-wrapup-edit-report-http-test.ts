import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import type { CallWrapupEditAudit, OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call wrapup edit report test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

async function request(path: string, token: string) {
  const response = await originalFetch(`${baseUrl}${path}`, {
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
    recordingUrl: "https://oss.example/do-not-leak-edit-report",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "有意向",
    callOutcomeNote: "",
    callNote: "话单纪要不要出现",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

function snapshot(note: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ note, outcome: "", outcomeNote: "", tagIds: [], nextFollowAt: "", ...extra });
}

function audit(partial: Partial<CallWrapupEditAudit> & Pick<CallWrapupEditAudit, "id" | "callRecordId">): CallWrapupEditAudit {
  return {
    teamId: "europe",
    actorId: "u_sales_shirley",
    at: "2026-04-03T16:30:00.000Z",
    beforeJson: snapshot("改正前正文"),
    afterJson: snapshot("改正后正文"),
    result: "updated",
    reason: "",
    ...partial
  };
}

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const alexUser = store.users.find((item) => item.email === "alex@keduoduo.com");
  const adminUser = store.users.find((item) => item.email === "admin@keduoduo.com");
  assert.ok(shirleyUser && alexUser && adminUser);
  assert.equal(shirleyUser.role, "sales");
  assert.equal(alexUser.role, "manager");
  store.users.push({
    ...adminUser,
    id: "u_edit_report_asia",
    name: "Asia Edit Report",
    email: "asia-edit-report@keduoduo.com",
    role: "admin",
    teamId: "asia",
    status: "active"
  });

  const activitiesBefore = store.customerActivities.length;
  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const wrapupAuditsBefore = store.callWrapupAudits.length;
  const editAuditsBefore = store.callWrapupEditAudits.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  const updatedBefore = new Map(store.outboundCallRecords.map((item) => [item.id, item.updatedAt]));

  store.aliyunAgentMappings.push({
    id: "map_wr_shirley",
    teamId: "europe",
    crmUserId: shirleyUser.id,
    cccUserId: "agent@ccc-wr-a",
    loginName: "shirley",
    displayName: "Shirley坐席",
    extension: "8201",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  });
  store.outboundCallRecords.push(
    record({ id: "ocr_wr_a", agentIds: "agent@ccc-wr-a" }),
    record({ id: "ocr_wr_b", agentIds: "agent@ccc-wr-b" }),
    record({ id: "ocr_wr_multi", agentIds: "agent@ccc-wr-a,agent@ccc-wr-b" }),
    record({ id: "ocr_wr_blank", agentIds: "" }),
    record({ id: "ocr_wr_asia", teamId: "asia", agentIds: "agent@ccc-wr-asia" })
  );
  store.callWrapupEditAudits.push(
    audit({ id: "cwe_wr_a", callRecordId: "ocr_wr_a", beforeJson: snapshot("改正前正文", { tagIds: ["t_old"] }), afterJson: snapshot("=改正后", { outcome: "有意向", tagIds: ["t_old", "t_new"] }) }),
    audit({ id: "cwe_wr_b", callRecordId: "ocr_wr_b", actorId: alexUser.id }),
    audit({ id: "cwe_wr_multi", callRecordId: "ocr_wr_multi", beforeJson: snapshot("改正前正文", { outcomeNote: "旧备注" }), afterJson: snapshot("改正前正文", { outcomeNote: "新备注" }) }),
    audit({ id: "cwe_wr_blank", callRecordId: "ocr_wr_blank" }),
    audit({ id: "cwe_wr_old", callRecordId: "ocr_wr_a", at: "2026-04-03T15:00:00.000Z" }),
    audit({ id: "cwe_wr_rejected", callRecordId: "ocr_wr_a", result: "rejected", reason: "window_closed", beforeJson: snapshot("拒绝前"), afterJson: snapshot("拒绝后") }),
    audit({ id: "cwe_wr_asia", teamId: "asia", actorId: "u_edit_report_asia", callRecordId: "ocr_wr_asia", beforeJson: snapshot("亚洲纪要不要出现"), afterJson: snapshot("亚洲后值") })
  );

  const admin = await login("admin@keduoduo.com");
  const shirley = await login("shirley@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const asia = await login("asia-edit-report@keduoduo.com");

  const anonymous = await request("/api/call-wrapup-edit-report", "");
  assert.equal(anonymous.response.status, 401);
  assert.equal(store.callWrapupEditReportAudits.length, 0);

  const auditsBefore = store.callWrapupEditReportAudits.length;
  const bad = await request("/api/call-wrapup-edit-report?from=2026-04-06&to=2026-04-05", alex);
  assert.equal(bad.response.status, 400);
  assert.equal(bad.json.reason, "invalid_request");
  const extra = await request("/api/call-wrapup-edit-report?plaintext=1", alex);
  assert.equal(extra.response.status, 400);
  const arrayQuery = await request("/api/call-wrapup-edit-report?field=note&field=outcome", alex);
  assert.equal(arrayQuery.response.status, 400);
  assert.equal(store.callWrapupEditReportAudits.length, auditsBefore);

  const denied = await request("/api/call-wrapup-edit-report", shirley);
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.reason, "forbidden");
  assert.equal("rows" in denied.json, false);
  assert.equal("counts" in denied.json, false);
  assert.equal(JSON.stringify(denied.json).includes("改正前正文"), false);
  assert.equal(store.callWrapupEditReportAudits.some((item) => item.actorId === shirleyUser.id && item.action === "read" && item.result === "rejected" && item.reason === "forbidden" && item.rowCount === 0), true);
  const salesExport = await request("/api/call-wrapup-edit-report/export", shirley);
  assert.equal(salesExport.response.status, 403);
  assert.equal(salesExport.response.headers.get("content-type")?.includes("text/csv"), false);
  assert.equal(salesExport.text.includes("改正前纪要"), false);
  assert.equal(store.callWrapupEditReportAudits.some((item) => item.actorId === shirleyUser.id && item.action === "export" && item.result === "rejected"), true);

  const viewed = await request("/api/call-wrapup-edit-report?from=2026-04-04&to=2026-04-04", alex);
  assert.equal(viewed.response.status, 200);
  assert.equal(viewed.json.metrics.correctionCount, true);
  assert.equal("connectRate" in viewed.json.metrics, false);
  assert.equal(viewed.json.rowCount, 4);
  assert.deepEqual(viewed.json.rows.map((item: { id: string }) => item.id), ["cwe_wr_multi", "cwe_wr_blank", "cwe_wr_b", "cwe_wr_a"]);
  assert.equal(viewed.json.counts.find((item: { agentId: string }) => item.agentId === "agent@ccc-wr-a").correctionCount, 2);
  assert.equal(viewed.json.counts.find((item: { agentId: string }) => item.agentId === "agent@ccc-wr-b").correctionCount, 2);
  assert.equal(viewed.json.counts.find((item: { agentId: string }) => item.agentId === "none").correctionCount, 1);
  assert.equal(viewed.json.counts.reduce((sum: number, item: { correctionCount: number }) => sum + item.correctionCount, 0), 5);
  const sample = viewed.json.rows.find((item: { id: string }) => item.id === "cwe_wr_a");
  assert.deepEqual(sample.changedFields, ["note", "outcome", "tagIds"]);
  assert.equal(sample.before.note, "改正前正文");
  assert.equal(sample.after.note, "=改正后");
  assert.equal(sample.after.outcome, "有意向");
  assert.deepEqual(sample.after.tagIds, ["t_old", "t_new"]);
  assert.equal(sample.actorLabel, "Shirley");
  assert.equal(viewed.json.rows.some((item: { id: string }) => item.id === "cwe_wr_rejected" || item.id === "cwe_wr_old" || item.id === "cwe_wr_asia"), false);
  assert.equal(JSON.stringify(viewed.json).includes("拒绝后"), false);
  assert.equal(JSON.stringify(viewed.json).includes("亚洲纪要不要出现"), false);
  assert.equal(JSON.stringify(viewed.json).includes("do-not-leak-edit-report"), false);
  assert.equal(JSON.stringify(viewed.json).includes("*******2333"), false);
  assert.equal(JSON.stringify(viewed.json).includes("话单纪要不要出现"), false);
  assert.equal(viewed.json.agents.some((item: { id: string; label: string }) => item.id === "agent@ccc-wr-a" && item.label === "Shirley坐席"), true);
  const readAudit = store.callWrapupEditReportAudits.find((item) => item.actorId === alexUser.id && item.action === "read" && item.result === "read");
  assert.ok(readAudit);
  assert.match(readAudit.filters, /2026-04-04/);
  assert.equal(readAudit.filters.includes("改正前正文"), false);
  assert.equal(readAudit.filters.includes("2333"), false);
  assert.equal(readAudit.rowCount, viewed.json.rowCount);

  const again = await request("/api/call-wrapup-edit-report?from=2026-04-04&to=2026-04-04", alex);
  assert.equal(again.response.status, 200);
  assert.equal(store.callWrapupEditReportAudits.filter((item) => item.actorId === alexUser.id && item.action === "read" && item.result === "read").length, 2);

  const notes = await request("/api/call-wrapup-edit-report?from=2026-04-04&to=2026-04-04&field=note", admin);
  assert.equal(notes.response.status, 200);
  assert.deepEqual(notes.json.rows.map((item: { id: string }) => item.id).sort(), ["cwe_wr_a", "cwe_wr_b", "cwe_wr_blank"].sort());
  assert.equal(notes.json.rows.some((item: { id: string }) => item.id === "cwe_wr_multi"), false);

  const agent = await request("/api/call-wrapup-edit-report?agentId=agent@ccc-wr-b", alex);
  assert.deepEqual(agent.json.rows.map((item: { id: string }) => item.id), ["cwe_wr_multi", "cwe_wr_b"]);
  assert.deepEqual(agent.json.counts.map((item: { agentId: string }) => item.agentId), ["agent@ccc-wr-b"]);
  assert.equal(agent.json.counts[0].correctionCount, 2);

  const exported = await request("/api/call-wrapup-edit-report/export?from=2026-04-04&to=2026-04-04", alex);
  assert.equal(exported.response.status, 200);
  assert.match(exported.response.headers.get("content-type") || "", /text\/csv/);
  assert.equal(exported.response.headers.get("cache-control"), "no-store");
  assert.match(decodeURIComponent(exported.response.headers.get("content-disposition") || ""), /通话小结改正\.csv/);
  assert.deepEqual([exported.bytes[0], exported.bytes[1], exported.bytes[2]], [0xef, 0xbb, 0xbf]);
  assert.equal(exported.text.charCodeAt(0), 0xfeff);
  assert.match(exported.text, /时间,坐席,操作人,通话记录,变更字段,改正前纪要,改正后纪要/);
  assert.match(exported.text, /'=改正后/);
  assert.match(exported.text, /改正前正文/);
  assert.equal(exported.text.includes("do-not-leak-edit-report"), false);
  assert.equal(exported.text.includes("*******2333"), false);
  assert.equal(exported.text.includes("13800138000"), false);
  assert.equal(exported.text.includes("亚洲纪要不要出现"), false);
  assert.equal(exported.text.includes("话单纪要不要出现"), false);
  assert.equal(exported.text.includes("拒绝后"), false);
  const exportAudit = store.callWrapupEditReportAudits.find((item) => item.actorId === alexUser.id && item.action === "export" && item.result === "exported");
  assert.ok(exportAudit);
  assert.equal(exportAudit.rowCount, viewed.json.rowCount);
  assert.equal(exportAudit.filters.includes("改正前正文"), false);

  const asiaView = await request("/api/call-wrapup-edit-report", asia);
  assert.equal(asiaView.response.status, 200);
  assert.deepEqual(asiaView.json.rows.map((item: { id: string }) => item.id), ["cwe_wr_asia"]);
  assert.equal(JSON.stringify(asiaView.json).includes("改正前正文"), false);
  assert.equal(asiaView.json.rows[0].before.note, "亚洲纪要不要出现");

  assert.equal(aliyunHits, 0);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.callWrapupAudits.length, wrapupAuditsBefore);
  assert.equal(store.callWrapupEditAudits.length, editAuditsBefore + 7);
  for (const [id, at] of updatedBefore) {
    assert.equal(store.outboundCallRecords.find((item) => item.id === id)?.updatedAt, at);
  }
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wr_a")?.updatedAt, "2026-04-04T00:00:00.000Z");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wr_a")?.callOutcome, "有意向");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wr_a")?.callNote, "话单纪要不要出现");
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  const auditText = JSON.stringify(store.callWrapupEditReportAudits);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("do-not-leak-edit-report"), false);
  assert.equal(auditText.includes("改正前正文"), false);
  assert.equal(auditText.includes("亚洲纪要不要出现"), false);
  assert.equal(auditText.includes("*******2333"), false);

  console.log("call wrapup edit report http tests passed");
} finally {
  const store = getStore();
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_wr_"));
  store.callWrapupEditAudits = store.callWrapupEditAudits.filter((item) => !item.id.startsWith("cwe_wr_"));
  store.callWrapupEditReportAudits = store.callWrapupEditReportAudits.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => item.id !== "map_wr_shirley");
  store.users = store.users.filter((item) => item.id !== "u_edit_report_asia");
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
