import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import type { OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call tag view test server");
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

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "agentIds" | "targetType" | "targetId">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    maskedNumber: "*******2333",
    contactType: "OUTBOUND",
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "12",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: String(Date.parse("2026-04-04T04:00:00.000Z")),
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/do-not-leak-view",
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

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const adminUser = store.users.find((item) => item.email === "admin@keduoduo.com");
  assert.ok(shirleyUser && miaUser && adminUser);
  store.users.push({
    ...shirleyUser,
    id: "u_no_call_tag_view",
    name: "No Call Tag View",
    email: "no-call-tag-view@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...adminUser,
    id: "u_call_tag_view_asia",
    name: "Asia Call Tag View",
    email: "asia-call-tag-view@keduoduo.com",
    role: "admin",
    teamId: "asia",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_no_call_tag_view") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };
  const publicCustomer = store.customers.find((item) => item.id === "c3");
  assert.ok(publicCustomer);
  const previousPool = publicCustomer.poolStatus;
  publicCustomer.poolStatus = "public";

  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);

  store.aliyunAgentMappings.push(
    {
      id: "map_view_shirley",
      teamId: "europe",
      crmUserId: shirleyUser.id,
      cccUserId: "agent@ccc-view-a",
      loginName: "shirley-view",
      displayName: "Shirley查看",
      extension: "8401",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_view_mia",
      teamId: "europe",
      crmUserId: miaUser.id,
      cccUserId: "agent@ccc-view-b",
      loginName: "mia-view",
      displayName: "Mia查看",
      extension: "8402",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    }
  );
  store.outboundCallRecords.push(
    record({ id: "ocr_view_c1a", agentIds: "agent@ccc-view-a", targetType: "customer", targetId: "c1" }),
    record({ id: "ocr_view_c1b", agentIds: "agent@ccc-view-a", targetType: "customer", targetId: "c1" }),
    record({ id: "ocr_view_mia", agentIds: "agent@ccc-view-b", targetType: "customer", targetId: "c1" }),
    record({ id: "ocr_view_c2", agentIds: "agent@ccc-view-a", targetType: "customer", targetId: "c2" }),
    record({ id: "ocr_view_c3", agentIds: "agent@ccc-view-a", targetType: "customer", targetId: "c3" }),
    record({ id: "ocr_view_l1", agentIds: "agent@ccc-view-a", targetType: "lead", targetId: "l1" }),
    record({ id: "ocr_view_prospect", agentIds: "agent@ccc-view-a", targetType: "prospect", targetId: "p_view" }),
    record({ id: "ocr_view_asia", teamId: "asia", agentIds: "agent@ccc-view-asia", targetType: "customer", targetId: "c_asia" })
  );

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const noRead = await login("no-call-tag-view@keduoduo.com");
  const asia = await login("asia-call-tag-view@keduoduo.com");

  const price = await request("/api/call-tags", admin, "POST", { name: "价格敏感" });
  const sample = await request("/api/call-tags", admin, "POST", { name: "要样品" });
  const miaTag = await request("/api/call-tags", admin, "POST", { name: "另一坐席" });
  const publicTag = await request("/api/call-tags", admin, "POST", { name: "公池标签" });
  assert.equal(price.response.status, 200);
  const priceId = String(price.json.tag.id);
  const sampleId = String(sample.json.tag.id);
  const miaTagId = String(miaTag.json.tag.id);
  const publicTagId = String(publicTag.json.tag.id);
  store.callRecordTags.push(
    { id: "crt_view_1", teamId: "europe", callRecordId: "ocr_view_c1a", tagId: priceId, createdBy: shirleyUser.id, createdAt: "2026-04-01T00:00:00.000Z" },
    { id: "crt_view_2", teamId: "europe", callRecordId: "ocr_view_c1b", tagId: priceId, createdBy: shirleyUser.id, createdAt: "2026-04-03T00:00:00.000Z" },
    { id: "crt_view_3", teamId: "europe", callRecordId: "ocr_view_c1a", tagId: sampleId, createdBy: shirleyUser.id, createdAt: "2026-04-02T00:00:00.000Z" },
    { id: "crt_view_4", teamId: "europe", callRecordId: "ocr_view_mia", tagId: miaTagId, createdBy: miaUser.id, createdAt: "2026-04-04T00:00:00.000Z" },
    { id: "crt_view_5", teamId: "europe", callRecordId: "ocr_view_c3", tagId: publicTagId, createdBy: shirleyUser.id, createdAt: "2026-04-05T00:00:00.000Z" },
    { id: "crt_view_6", teamId: "europe", callRecordId: "ocr_view_l1", tagId: priceId, createdBy: shirleyUser.id, createdAt: "2026-04-06T00:00:00.000Z" },
    { id: "crt_view_7", teamId: "europe", callRecordId: "ocr_view_prospect", tagId: priceId, createdBy: shirleyUser.id, createdAt: "2026-04-07T00:00:00.000Z" }
  );
  await request("/api/call-tags/disable", admin, "POST", { id: sampleId });
  const updatedBefore = store.outboundCallRecords.find((item) => item.id === "ocr_view_c1a")?.updatedAt;
  const viewAuditsBefore = store.callTagViewAudits.length;

  const plainList = await request("/api/customers", shirley);
  assert.equal(plainList.response.status, 200);
  assert.equal(store.callTagViewAudits.length, viewAuditsBefore);
  const plainRow = plainList.json.customers.find((item: { id: string; callTagIds?: string[] }) => item.id === "c1");
  assert.equal(plainRow.callTagIds.includes(priceId), true);
  assert.equal(plainRow.callTagIds.includes(sampleId), true);
  assert.equal(plainRow.callTagIds.includes(miaTagId), false);
  assert.equal(plainList.json.callTagFilters.some((item: { id: string; enabled: boolean }) => item.id === sampleId && item.enabled === false), true);
  assert.equal(plainList.text.includes("亚洲标签勿出现"), false);
  assert.equal(plainList.text.includes("do-not-leak-view"), false);

  const badFilter = await request("/api/customers?callTag=不是标签", shirley);
  assert.equal(badFilter.response.status, 400);
  assert.equal(store.callTagViewAudits.length, viewAuditsBefore);
  const arrayFilter = await request("/api/customers?callTag=a&callTag=b", shirley);
  assert.equal(arrayFilter.response.status, 400);

  const filtered = await request(`/api/customers?callTag=${encodeURIComponent(priceId)}`, shirley);
  assert.equal(filtered.response.status, 200);
  const filteredIds = filtered.json.customers.map((item: { id: string }) => item.id);
  assert.equal(filteredIds.includes("c1"), true);
  assert.equal(filteredIds.includes("c2"), false);
  assert.equal(filteredIds.includes("c3"), false);
  const filterAudit = store.callTagViewAudits.find((item) => item.action === "filter" && item.tagId === priceId && item.actorId === shirleyUser.id);
  assert.ok(filterAudit);
  assert.equal(filterAudit.targetType, "customer");
  assert.equal(filterAudit.result, "filtered");
  assert.equal(filterAudit.rowCount, filteredIds.length);

  const disabledFilter = await request(`/api/customers?callTag=${encodeURIComponent(sampleId)}`, shirley);
  assert.equal(disabledFilter.json.customers.some((item: { id: string }) => item.id === "c1"), true);

  const view = await request("/api/customers/c1/call-tags", shirley);
  assert.equal(view.response.status, 200);
  const priceRow = view.json.tags.find((item: { id: string }) => item.id === priceId);
  const sampleRow = view.json.tags.find((item: { id: string }) => item.id === sampleId);
  assert.equal(priceRow.count, 2);
  assert.equal(priceRow.latestAt, "2026-04-03T00:00:00.000Z");
  assert.equal(priceRow.enabled, true);
  assert.equal(sampleRow.count, 1);
  assert.equal(sampleRow.enabled, false);
  assert.equal(sampleRow.latestAt, "2026-04-02T00:00:00.000Z");
  assert.equal(view.json.tags.some((item: { id: string }) => item.id === miaTagId), false);
  assert.equal(view.text.includes("do-not-leak-view"), false);
  const readAudit = store.callTagViewAudits.find((item) => item.action === "read" && item.targetId === "c1" && item.actorId === shirleyUser.id && item.result === "read");
  assert.ok(readAudit);
  assert.equal(readAudit.rowCount, view.json.tags.length);
  const again = await request("/api/customers/c1/call-tags", shirley);
  assert.equal(again.response.status, 200);
  assert.equal(store.callTagViewAudits.filter((item) => item.action === "read" && item.targetId === "c1" && item.actorId === shirleyUser.id && item.result === "read").length, 2);

  const queryRejected = await request("/api/customers/c1/call-tags?extra=1", shirley);
  assert.equal(queryRejected.response.status, 400);
  assert.equal(store.callTagViewAudits.filter((item) => item.actorId === shirleyUser.id && item.action === "read" && item.result === "read").length, 2);

  const managerView = await request("/api/customers/c1/call-tags", alex);
  assert.equal(managerView.response.status, 200);
  assert.equal(managerView.json.tags.some((item: { id: string }) => item.id === miaTagId), true);

  const hiddenCustomer = await request("/api/customers/c4/call-tags", shirley);
  assert.equal(hiddenCustomer.response.status, 403);
  assert.equal(hiddenCustomer.json.tags, undefined);
  const hiddenAudit = store.callTagViewAudits.find((item) => item.actorId === shirleyUser.id && item.targetId === "c4" && item.result === "rejected");
  assert.ok(hiddenAudit);
  assert.equal(hiddenAudit.reason, "forbidden");

  const publicView = await request("/api/customers/c3/call-tags", shirley);
  assert.equal(publicView.response.status, 200);
  assert.equal(publicView.json.tags.some((item: { id: string; count: number }) => item.id === publicTagId && item.count === 1), true);

  const noReadView = await request("/api/customers/c1/call-tags", noRead);
  assert.equal(noReadView.response.status, 403);
  assert.equal(noReadView.json.tags, undefined);
  const noReadFilter = await request(`/api/customers?callTag=${encodeURIComponent(priceId)}`, noRead);
  assert.equal(noReadFilter.response.status, 403);
  assert.equal(noReadFilter.json.customers, undefined);

  const foreign = await request("/api/customers/c1/call-tags", asia);
  assert.equal(foreign.response.status, 403);
  assert.equal(foreign.text.includes("价格敏感"), false);
  assert.equal(foreign.text.includes("Nordic"), false);

  const leadView = await request("/api/leads/l1/call-tags", shirley);
  assert.equal(leadView.response.status, 200);
  assert.equal(leadView.json.tags.find((item: { id: string }) => item.id === priceId).count, 1);
  assert.equal(leadView.json.tags.find((item: { id: string }) => item.id === priceId).latestAt, "2026-04-06T00:00:00.000Z");
  const leadHidden = await request("/api/leads/l3/call-tags", shirley);
  assert.equal(leadHidden.response.status, 403);
  const leadFilter = await request(`/api/leads?callTag=${encodeURIComponent(priceId)}`, shirley);
  assert.equal(leadFilter.json.leads.some((item: { id: string }) => item.id === "l1"), true);
  assert.equal(leadFilter.json.leads.some((item: { id: string }) => item.id === "l3"), false);
  const leadPlain = store.callTagViewAudits.filter((item) => item.action === "filter" && item.targetType === "lead").length;
  const leadAgain = await request("/api/leads", shirley);
  assert.equal(leadAgain.response.status, 200);
  assert.equal(store.callTagViewAudits.filter((item) => item.action === "filter" && item.targetType === "lead").length, leadPlain);

  const openStats = await request("/api/outbound-call-records", shirley);
  const scoped = await request(`/api/outbound-call-records?tag=${encodeURIComponent(priceId)}&targetType=customer&targetId=c1`, shirley);
  assert.equal(scoped.response.status, 200);
  const scopedIds = scoped.json.records.map((item: { id: string }) => item.id);
  assert.deepEqual(scopedIds.sort(), ["ocr_view_c1a", "ocr_view_c1b"]);
  assert.equal(scoped.json.stats.totalCalls, openStats.json.stats.totalCalls);
  assert.equal(scoped.json.stats.connectedCalls, openStats.json.stats.connectedCalls);
  assert.equal(scoped.text.includes("do-not-leak-view"), false);
  const jumpAudit = store.callTagViewAudits.find((item) => item.action === "read" && item.targetId === "c1" && item.tagId === priceId && item.result === "read");
  assert.ok(jumpAudit);
  assert.equal(jumpAudit.rowCount, 2);

  const hiddenJump = await request(`/api/outbound-call-records?tag=${encodeURIComponent(priceId)}&targetType=customer&targetId=c4`, shirley);
  assert.equal(hiddenJump.response.status, 403);
  assert.equal(hiddenJump.json.records, undefined);
  const badTarget = await request("/api/outbound-call-records?targetType=prospect&targetId=p1", shirley);
  assert.equal(badTarget.response.status, 400);
  const halfTarget = await request("/api/outbound-call-records?targetType=customer", shirley);
  assert.equal(halfTarget.response.status, 400);

  const exported = await request(`/api/outbound-call-records/export?tag=${encodeURIComponent(priceId)}&targetType=customer&targetId=c1`, shirley);
  assert.equal(exported.response.status, 200);
  assert.equal(exported.text.includes("ocr_view_mia"), false);
  assert.equal(exported.text.includes("do-not-leak-view"), false);
  const exportAudit = store.callExportAudits.find((item) => item.actorId === shirleyUser.id && item.filters.includes(priceId) && item.filters.includes("c1"));
  assert.ok(exportAudit);
  assert.match(exportAudit.filters, /"targetType":"customer"/);
  const hiddenExport = await request("/api/outbound-call-records/export?targetType=customer&targetId=c4", shirley);
  assert.equal(hiddenExport.response.status, 403);

  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_view_c1a")?.updatedAt, updatedBefore);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_view_c1a")?.callOutcome, "有意向");
  assert.equal(store.callTags.find((item) => item.id === sampleId)?.enabled, false);
  assert.equal(aliyunHits, 0);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  const auditText = JSON.stringify(store.callTagViewAudits);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("aliyuncs"), false);
  assert.equal(auditText.includes("do-not-leak-view"), false);
  assert.equal(auditText.includes("价格敏感"), false);

  console.log("call tag view http tests passed");
} finally {
  const store = getStore();
  const publicCustomer = store.customers.find((item) => item.id === "c3");
  if (publicCustomer) delete publicCustomer.poolStatus;
  store.callTags = store.callTags.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.callRecordTags = store.callRecordTags.filter((item) => !item.id.startsWith("crt_view_"));
  store.callTagViewAudits = store.callTagViewAudits.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_view_"));
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_view_"));
  store.users = store.users.filter((item) => !["u_no_call_tag_view", "u_call_tag_view_asia"].includes(item.id));
  globalThis.fetch = originalFetch;
  server.close();
}
