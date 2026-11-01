import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import type { CallRecordTag, CallTag, OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call tag report test server");
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
    recordingUrl: "https://oss.example/do-not-leak-tag-report",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "有意向",
    callOutcomeNote: "",
    callNote: "纪要勿出现",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

function tag(partial: Partial<CallTag> & Pick<CallTag, "id" | "name">): CallTag {
  return {
    teamId: "europe",
    enabled: true,
    createdBy: "u_admin",
    updatedBy: "u_admin",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    disabledAt: "",
    ...partial
  };
}

function link(partial: Partial<CallRecordTag> & Pick<CallRecordTag, "id" | "callRecordId" | "tagId">): CallRecordTag {
  return {
    teamId: "europe",
    createdBy: "u_admin",
    createdAt: "",
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
    id: "u_tag_report_asia",
    name: "Asia Tag Report",
    email: "asia-tag-report@keduoduo.com",
    role: "admin",
    teamId: "asia",
    status: "active"
  });

  const activitiesBefore = store.customerActivities.length;
  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const tagAuditsBefore = store.callTagAudits.length;
  const viewAuditsBefore = store.callTagViewAudits.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  const updatedBefore = new Map(store.outboundCallRecords.map((item) => [item.id, item.updatedAt]));
  const tagsBefore = store.callTags.length;
  const linksBefore = store.callRecordTags.length;

  store.aliyunAgentMappings.push({
    id: "map_tr_shirley",
    teamId: "europe",
    crmUserId: shirleyUser.id,
    cccUserId: "agent@ccc-tr-a",
    loginName: "shirley",
    displayName: "Shirley坐席",
    extension: "8201",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  });
  store.callTags.push(
    tag({ id: "ctag_tr_eq", name: "=敏感" }),
    tag({ id: "ctag_tr_price", name: "价格敏感" }),
    tag({ id: "ctag_tr_old", name: "啊旧", enabled: false, disabledAt: "2026-04-02T00:00:00.000Z" }),
    tag({ id: "ctag_tr_unused", name: "未使用" }),
    tag({ id: "ctag_tr_asia", name: "亚洲标签勿出现", teamId: "asia" })
  );
  store.outboundCallRecords.push(
    record({ id: "ocr_tr_c1a", agentIds: "agent@ccc-tr-a", targetId: "c_tr_1" }),
    record({ id: "ocr_tr_c1b", agentIds: "agent@ccc-tr-a", targetId: "c_tr_1" }),
    record({ id: "ocr_tr_lead", agentIds: "agent@ccc-tr-a", targetType: "lead", targetId: "l_tr_1" }),
    record({ id: "ocr_tr_pro", agentIds: "agent@ccc-tr-a", targetType: "prospect", targetId: "p_tr_1" }),
    record({ id: "ocr_tr_empty", agentIds: "agent@ccc-tr-a", targetType: "customer", targetId: "" }),
    record({ id: "ocr_tr_b", agentIds: "agent@ccc-tr-b", targetId: "c_tr_b" }),
    record({ id: "ocr_tr_old", agentIds: "agent@ccc-tr-a", targetId: "c_tr_old", startTimeRaw: String(Date.parse("2026-04-03T15:00:00.000Z")) }),
    record({ id: "ocr_tr_blank", agentIds: "", targetId: "c_tr_blank" }),
    record({ id: "ocr_tr_bad", agentIds: "agent@ccc-tr-a", targetId: "c_tr_bad", startTimeRaw: "not-a-time" }),
    record({ id: "ocr_tr_dis", agentIds: "agent@ccc-tr-a", targetId: "c_tr_dis" }),
    record({ id: "ocr_tr_asia", teamId: "asia", agentIds: "agent@ccc-tr-asia", targetId: "c_tr_asia" })
  );
  store.callRecordTags.push(
    link({ id: "crt_tr_1", callRecordId: "ocr_tr_c1a", tagId: "ctag_tr_price" }),
    link({ id: "crt_tr_1s", callRecordId: "ocr_tr_c1a", tagId: "ctag_tr_eq" }),
    link({ id: "crt_tr_2", callRecordId: "ocr_tr_c1b", tagId: "ctag_tr_price" }),
    link({ id: "crt_tr_lead", callRecordId: "ocr_tr_lead", tagId: "ctag_tr_price" }),
    link({ id: "crt_tr_pro", callRecordId: "ocr_tr_pro", tagId: "ctag_tr_price" }),
    link({ id: "crt_tr_empty", callRecordId: "ocr_tr_empty", tagId: "ctag_tr_price" }),
    link({ id: "crt_tr_b", callRecordId: "ocr_tr_b", tagId: "ctag_tr_price" }),
    link({ id: "crt_tr_old", callRecordId: "ocr_tr_old", tagId: "ctag_tr_price" }),
    link({ id: "crt_tr_blank", callRecordId: "ocr_tr_blank", tagId: "ctag_tr_price" }),
    link({ id: "crt_tr_bad", callRecordId: "ocr_tr_bad", tagId: "ctag_tr_price" }),
    link({ id: "crt_tr_dis", callRecordId: "ocr_tr_dis", tagId: "ctag_tr_old" }),
    link({ id: "crt_tr_miss", callRecordId: "ocr_missing", tagId: "ctag_tr_price" }),
    link({ id: "crt_tr_unknown", callRecordId: "ocr_tr_c1a", tagId: "ctag_missing" }),
    link({ id: "crt_tr_asia", teamId: "asia", callRecordId: "ocr_tr_asia", tagId: "ctag_tr_asia" })
  );

  const admin = await login("admin@keduoduo.com");
  const shirley = await login("shirley@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const asia = await login("asia-tag-report@keduoduo.com");

  const auditsBefore = store.callTagReportAudits.length;
  const bad = await request("/api/call-tag-report?from=2026-04-06&to=2026-04-05", admin);
  assert.equal(bad.response.status, 400);
  assert.equal(bad.json.reason, "invalid_request");
  const extra = await request("/api/call-tag-report?plaintext=1", admin);
  assert.equal(extra.response.status, 400);
  const arrayQuery = await request("/api/call-tag-report?from=2026-04-04&from=2026-04-05", admin);
  assert.equal(arrayQuery.response.status, 400);
  assert.equal(store.callTagReportAudits.length, auditsBefore);

  const denied = await request("/api/call-tag-report", shirley);
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.reason, "forbidden");
  assert.equal("rows" in denied.json, false);
  assert.equal(JSON.stringify(denied.json).includes("价格敏感"), false);
  assert.equal(store.callTagReportAudits.some((item) => item.actorId === shirleyUser.id && item.action === "read" && item.result === "rejected" && item.reason === "forbidden" && item.rowCount === 0), true);
  const manager = await request("/api/call-tag-report/export", alex);
  assert.equal(manager.response.status, 403);
  assert.equal(manager.response.headers.get("content-type")?.includes("text/csv"), false);
  assert.equal(store.callTagReportAudits.some((item) => item.actorId === alexUser.id && item.action === "export" && item.result === "rejected"), true);

  const viewed = await request("/api/call-tag-report?from=2026-04-04&to=2026-04-04", admin);
  assert.equal(viewed.response.status, 200);
  assert.equal(viewed.json.metrics.applyCount, true);
  assert.equal(viewed.json.metrics.callCount, true);
  assert.equal(viewed.json.metrics.customerCount, true);
  assert.equal(viewed.json.metrics.leadCount, true);
  assert.equal("connectRate" in viewed.json.metrics, false);
  assert.equal("prospectCount" in viewed.json.metrics, false);
  const price = viewed.json.rows.find((item: { tagId: string }) => item.tagId === "ctag_tr_price");
  assert.equal(price.applyCount, 7);
  assert.equal(price.callCount, 7);
  assert.equal(price.customerCount, 3);
  assert.equal(price.leadCount, 1);
  const sample = viewed.json.rows.find((item: { tagId: string }) => item.tagId === "ctag_tr_eq");
  assert.equal(sample.applyCount, 1);
  assert.equal(sample.customerCount, 1);
  assert.equal(sample.leadCount, 0);
  const unused = viewed.json.rows.find((item: { tagId: string }) => item.tagId === "ctag_tr_unused");
  assert.equal(unused.applyCount, 0);
  assert.equal(unused.callCount, 0);
  const disabled = viewed.json.rows.find((item: { tagId: string }) => item.tagId === "ctag_tr_old");
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.applyCount, 1);
  assert.equal(disabled.customerCount, 1);
  assert.deepEqual(viewed.json.rows.map((item: { tagId: string }) => item.tagId).filter((id: string) => id.startsWith("ctag_tr_")), ["ctag_tr_eq", "ctag_tr_price", "ctag_tr_unused", "ctag_tr_old"]);
  assert.equal(viewed.json.rows.some((item: { tagId: string }) => item.tagId === "ctag_tr_asia"), false);
  assert.equal(JSON.stringify(viewed.json).includes("ctag_missing"), false);
  assert.equal(JSON.stringify(viewed.json).includes("ocr_missing"), false);
  assert.equal(JSON.stringify(viewed.json).includes("亚洲标签勿出现"), false);
  assert.equal(JSON.stringify(viewed.json).includes("do-not-leak-tag-report"), false);
  assert.equal(JSON.stringify(viewed.json).includes("*******2333"), false);
  assert.equal(JSON.stringify(viewed.json).includes("纪要勿出现"), false);
  assert.equal(viewed.json.agents.some((item: { id: string; label: string }) => item.id === "agent@ccc-tr-a" && item.label === "Shirley坐席"), true);
  const readAudit = store.callTagReportAudits.find((item) => item.actorId === adminUser.id && item.action === "read" && item.result === "read");
  assert.ok(readAudit);
  assert.match(readAudit.filters, /2026-04-04/);
  assert.equal(readAudit.filters.includes("2333"), false);
  assert.equal(readAudit.filters.includes("价格敏感"), false);
  assert.equal(readAudit.filters.includes("=敏感"), false);
  assert.equal(readAudit.rowCount, viewed.json.rows.length);

  const again = await request("/api/call-tag-report?from=2026-04-04&to=2026-04-04", admin);
  assert.equal(again.response.status, 200);
  assert.equal(store.callTagReportAudits.filter((item) => item.actorId === adminUser.id && item.action === "read" && item.result === "read").length, 2);

  const agent = await request("/api/call-tag-report?agentId=agent@ccc-tr-b", admin);
  assert.equal(agent.json.rows.find((item: { tagId: string }) => item.tagId === "ctag_tr_price").callCount, 1);
  assert.equal(agent.json.rows.find((item: { tagId: string }) => item.tagId === "ctag_tr_price").customerCount, 1);
  assert.equal(agent.json.rows.find((item: { tagId: string }) => item.tagId === "ctag_tr_price").leadCount, 0);
  assert.equal(agent.json.rows.find((item: { tagId: string }) => item.tagId === "ctag_tr_old").applyCount, 0);

  const exported = await request("/api/call-tag-report/export?from=2026-04-04&to=2026-04-04", admin);
  assert.equal(exported.response.status, 200);
  assert.match(exported.response.headers.get("content-type") || "", /text\/csv/);
  assert.equal(exported.response.headers.get("cache-control"), "no-store");
  assert.match(decodeURIComponent(exported.response.headers.get("content-disposition") || ""), /通话标签使用统计\.csv/);
  assert.deepEqual([exported.bytes[0], exported.bytes[1], exported.bytes[2]], [0xef, 0xbb, 0xbf]);
  assert.equal(exported.text.charCodeAt(0), 0xfeff);
  assert.match(exported.text, /标签,启用,被打上的次数,关联通话数,涉及客户数,涉及线索数/);
  assert.match(exported.text, /'=敏感,是,1,1,1,0/);
  assert.match(exported.text, /啊旧,否,1,1,1,0/);
  assert.match(exported.text, /未使用,是,0,0,0,0/);
  assert.equal(exported.text.includes("do-not-leak-tag-report"), false);
  assert.equal(exported.text.includes("*******2333"), false);
  assert.equal(exported.text.includes("13800138000"), false);
  assert.equal(exported.text.includes("亚洲标签勿出现"), false);
  assert.equal(exported.text.includes("纪要勿出现"), false);
  assert.equal(exported.text.includes("c_tr_1"), false);
  const exportAudit = store.callTagReportAudits.find((item) => item.actorId === adminUser.id && item.action === "export" && item.result === "exported");
  assert.ok(exportAudit);
  assert.equal(exportAudit.rowCount, viewed.json.rows.length);
  assert.equal(exportAudit.filters.includes("2333"), false);

  const salesExport = await request("/api/call-tag-report/export", shirley);
  assert.equal(salesExport.response.status, 403);
  assert.equal(salesExport.text.includes("标签,启用"), false);

  const asiaView = await request("/api/call-tag-report", asia);
  assert.equal(asiaView.response.status, 200);
  assert.equal(asiaView.json.rows.some((item: { tagId: string }) => item.tagId === "ctag_tr_price"), false);
  assert.equal(asiaView.json.rows.some((item: { tagId: string }) => item.tagId === "ctag_tr_asia"), true);
  assert.equal(JSON.stringify(asiaView.json).includes("价格敏感"), false);
  assert.equal(asiaView.json.rows.find((item: { tagId: string }) => item.tagId === "ctag_tr_asia").applyCount, 1);

  assert.equal(aliyunHits, 0);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.callTagAudits.length, tagAuditsBefore);
  assert.equal(store.callTagViewAudits.length, viewAuditsBefore);
  assert.equal(store.callTags.length, tagsBefore + 5);
  assert.equal(store.callRecordTags.length, linksBefore + 14);
  assert.equal(store.callTags.find((item) => item.id === "ctag_tr_old")?.enabled, false);
  for (const [id, at] of updatedBefore) {
    assert.equal(store.outboundCallRecords.find((item) => item.id === id)?.updatedAt, at);
  }
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_tr_c1a")?.updatedAt, "2026-04-04T00:00:00.000Z");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_tr_c1a")?.callOutcome, "有意向");
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  const auditText = JSON.stringify(store.callTagReportAudits);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("do-not-leak-tag-report"), false);
  assert.equal(auditText.includes("价格敏感"), false);
  assert.equal(auditText.includes("亚洲标签勿出现"), false);
  assert.equal(auditText.includes("*******2333"), false);

  console.log("call tag report http tests passed");
} finally {
  const store = getStore();
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_tr_"));
  store.callTags = store.callTags.filter((item) => !item.id.startsWith("ctag_tr_"));
  store.callRecordTags = store.callRecordTags.filter((item) => !item.id.startsWith("crt_tr_"));
  store.callTagReportAudits = store.callTagReportAudits.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => item.id !== "map_tr_shirley");
  store.users = store.users.filter((item) => item.id !== "u_tag_report_asia");
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
