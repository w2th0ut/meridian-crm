import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import type { OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call tag test server");
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
    targetId: "c_tag_missing",
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
    recordingUrl: "https://oss.example/do-not-leak-tag",
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
    id: "u_no_call_tag_read",
    name: "No Call Tag Read",
    email: "no-call-tag-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...adminUser,
    id: "u_call_tag_asia",
    name: "Asia Call Tag",
    email: "asia-call-tag@keduoduo.com",
    role: "admin",
    teamId: "asia",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_no_call_tag_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };

  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);

  store.aliyunAgentMappings.push(
    {
      id: "map_tag_shirley",
      teamId: "europe",
      crmUserId: shirleyUser.id,
      cccUserId: "agent@ccc-tag-a",
      loginName: "shirley-tag",
      displayName: "Shirley标签",
      extension: "8301",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_tag_mia",
      teamId: "europe",
      crmUserId: miaUser.id,
      cccUserId: "agent@ccc-tag-b",
      loginName: "mia-tag",
      displayName: "Mia标签",
      extension: "8302",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_tag_asia",
      teamId: "asia",
      crmUserId: "u_call_tag_asia",
      cccUserId: "agent@ccc-tag-asia",
      loginName: "asia-tag",
      displayName: "亚洲标签坐席",
      extension: "8303",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    }
  );
  store.outboundCallRecords.push(
    record({ id: "ocr_tag_a1", agentIds: "agent@ccc-tag-a" }),
    record({ id: "ocr_tag_a2", agentIds: "agent@ccc-tag-a" }),
    record({ id: "ocr_tag_mia", agentIds: "agent@ccc-tag-b" }),
    record({ id: "ocr_tag_none", agentIds: "" }),
    record({ id: "ocr_tag_asia", teamId: "asia", agentIds: "agent@ccc-tag-asia", targetId: "c_asia" })
  );

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const noRead = await login("no-call-tag-read@keduoduo.com");
  const asia = await login("asia-call-tag@keduoduo.com");

  const auditsBeforeInvalid = store.callTagAudits.length;
  const bad = await request("/api/call-tags", admin, "POST", { name: "价格敏感", tags: [] });
  assert.equal(bad.response.status, 400);
  assert.equal(store.callTagAudits.length, auditsBeforeInvalid);
  const tooLong = await request("/api/call-tags", admin, "POST", { name: "标".repeat(41) });
  assert.equal(tooLong.response.status, 400);
  assert.equal(store.callTagAudits.length, auditsBeforeInvalid);
  const newline = await request("/api/call-tags", admin, "POST", { name: "价格\n敏感" });
  assert.equal(newline.response.status, 400);
  const badQuery = await request("/api/call-tags?includeDisabled=1", admin);
  assert.equal(badQuery.response.status, 400);
  assert.equal(store.callTagAudits.length, auditsBeforeInvalid);

  const deniedCreate = await request("/api/call-tags", shirley, "POST", { name: "价格敏感" });
  assert.equal(deniedCreate.response.status, 403);
  assert.equal(store.callTags.some((item) => item.name === "价格敏感"), false);
  assert.equal(store.callTagAudits.some((item) => item.actorId === shirleyUser.id && item.action === "create" && item.result === "rejected"), true);
  const deniedRead = await request("/api/call-tags", noRead);
  assert.equal(deniedRead.response.status, 403);
  assert.equal(deniedRead.json.tags, undefined);
  assert.equal(store.callTagAudits.some((item) => item.actorId === "u_no_call_tag_read" && item.action === "read" && item.result === "rejected"), true);

  const exact = "签".repeat(40);
  const createdExact = await request("/api/call-tags", admin, "POST", { name: exact });
  assert.equal(createdExact.response.status, 200);
  assert.equal(createdExact.json.result, "created");
  const price = await request("/api/call-tags", admin, "POST", { name: " 价格敏感 " });
  assert.equal(price.response.status, 200);
  assert.equal(price.json.tag.name, "价格敏感");
  assert.equal(price.json.tag.enabled, true);
  const priceId = String(price.json.tag.id);
  const createAudit = store.callTagAudits.find((item) => item.tagId === priceId && item.action === "create");
  assert.ok(createAudit);
  assert.equal(createAudit.previousValue, "");
  assert.match(createAudit.nextValue, /enabled=1/);
  assert.match(createAudit.nextValue, /name=价格敏感/);
  assert.equal(createAudit.callRecordId, "");
  const duplicate = await request("/api/call-tags", admin, "POST", { name: "价格敏感" });
  assert.equal(duplicate.response.status, 400);
  assert.equal(duplicate.json.reason, "duplicate_name");
  assert.equal(store.callTagAudits.filter((item) => item.action === "create" && item.tagId === priceId).length, 1);

  const sample = await request("/api/call-tags", admin, "POST", { name: "要样品" });
  assert.equal(sample.response.status, 200);
  const sampleId = String(sample.json.tag.id);
  const formula = await request("/api/call-tags", admin, "POST", { name: "=敏感" });
  assert.equal(formula.response.status, 200);
  const formulaId = String(formula.json.tag.id);

  const sameName = await request("/api/call-tags/rename", admin, "POST", { id: priceId, name: "价格敏感" });
  assert.equal(sameName.json.result, "unchanged");
  const renamed = await request("/api/call-tags/rename", admin, "POST", { id: priceId, name: "价格很敏感" });
  assert.equal(renamed.json.result, "renamed");
  assert.equal(renamed.json.tag.id, priceId);
  assert.equal(store.callTags.find((item) => item.id === priceId)?.name, "价格很敏感");
  const renameAudit = store.callTagAudits.find((item) => item.tagId === priceId && item.action === "rename" && item.result === "updated");
  assert.match(String(renameAudit?.previousValue), /name=价格敏感/);
  assert.match(String(renameAudit?.nextValue), /name=价格很敏感/);
  const salesRename = await request("/api/call-tags/rename", shirley, "POST", { id: priceId, name: "坐席改名" });
  assert.equal(salesRename.response.status, 403);
  assert.equal(store.callTags.find((item) => item.id === priceId)?.name, "价格很敏感");

  const linkedBeforeDisable = store.callRecordTags.length;
  const addedSample = await request(`/api/outbound-call-records/ocr_tag_a1/tags`, shirley, "POST", { tagId: sampleId });
  assert.equal(addedSample.response.status, 200);
  assert.equal(addedSample.json.result, "added");
  const disabled = await request("/api/call-tags/disable", admin, "POST", { id: sampleId });
  assert.equal(disabled.response.status, 200);
  assert.equal(disabled.json.tag.enabled, false);
  assert.equal(store.callTags.find((item) => item.id === sampleId)?.enabled, false);
  assert.equal(store.callRecordTags.some((item) => item.tagId === sampleId && item.callRecordId === "ocr_tag_a1"), true);
  assert.equal(store.callRecordTags.length, linkedBeforeDisable + 1);
  const disableAgain = await request("/api/call-tags/disable", admin, "POST", { id: sampleId });
  assert.equal(disableAgain.json.result, "unchanged");
  assert.equal(store.callTagAudits.filter((item) => item.tagId === sampleId && item.action === "disable" && item.result === "updated").length, 1);
  const duplicateDisabled = await request("/api/call-tags", admin, "POST", { name: "要样品" });
  assert.equal(duplicateDisabled.response.status, 400);
  assert.equal(duplicateDisabled.json.reason, "duplicate_name");

  const salesList = await request("/api/call-tags", shirley);
  assert.equal(salesList.response.status, 200);
  assert.equal(salesList.json.canManage, false);
  assert.equal(salesList.json.tags.some((item: { id: string }) => item.id === sampleId), false);
  assert.equal(salesList.json.tags.some((item: { id: string }) => item.id === priceId), true);
  assert.equal(store.callTagAudits.some((item) => item.action === "read" && item.result === "updated"), false);
  const adminList = await request("/api/call-tags", admin);
  assert.equal(adminList.json.canManage, true);
  assert.equal(adminList.json.tags.some((item: { id: string; enabled: boolean }) => item.id === sampleId && item.enabled === false), true);
  const managerList = await request("/api/call-tags", alex);
  assert.equal(managerList.json.canManage, false);

  const asiaTag = await request("/api/call-tags", asia, "POST", { name: "亚洲标签勿出现" });
  assert.equal(asiaTag.response.status, 200);
  const asiaTagId = String(asiaTag.json.tag.id);
  const foreignRename = await request("/api/call-tags/rename", admin, "POST", { id: asiaTagId, name: "改亚洲" });
  assert.equal(foreignRename.response.status, 404);
  assert.equal(store.callTags.find((item) => item.id === asiaTagId)?.name, "亚洲标签勿出现");
  assert.equal(JSON.stringify(store.callTagAudits.filter((item) => item.teamId === "europe")).includes("亚洲标签勿出现"), false);
  const reverse = await request("/api/call-tags/disable", asia, "POST", { id: priceId });
  assert.equal(reverse.response.status, 404);
  assert.equal(store.callTags.find((item) => item.id === priceId)?.enabled, true);

  const auditsBeforeAssign = store.callTagAudits.length;
  const badAssign = await request("/api/outbound-call-records/ocr_tag_a1/tags", shirley, "POST", { tagId: "bad id" });
  assert.equal(badAssign.response.status, 400);
  assert.equal(store.callTagAudits.length, auditsBeforeAssign);
  const batch = await request("/api/outbound-call-records/ocr_tag_a1/tags", shirley, "POST", { tagId: priceId, records: ["ocr_tag_a1"] });
  assert.equal(batch.response.status, 400);
  assert.equal(store.callTagAudits.length, auditsBeforeAssign);

  const addDisabled = await request("/api/outbound-call-records/ocr_tag_a2/tags", shirley, "POST", { tagId: sampleId });
  assert.equal(addDisabled.response.status, 400);
  assert.equal(addDisabled.json.reason, "disabled");
  assert.equal(store.callRecordTags.some((item) => item.callRecordId === "ocr_tag_a2" && item.tagId === sampleId), false);
  assert.equal(store.callTagAudits.filter((item) => item.callRecordId === "ocr_tag_a2").length, 0);
  const removeDisabled = await request("/api/outbound-call-records/ocr_tag_a1/tags/remove", shirley, "POST", { tagId: sampleId });
  assert.equal(removeDisabled.response.status, 400);
  assert.equal(removeDisabled.json.reason, "disabled");
  assert.equal(store.callRecordTags.some((item) => item.callRecordId === "ocr_tag_a1" && item.tagId === sampleId), true);

  const added = await request("/api/outbound-call-records/ocr_tag_a1/tags", shirley, "POST", { tagId: priceId });
  assert.equal(added.response.status, 200);
  assert.equal(added.json.result, "added");
  assert.equal(added.json.record.callTags.some((item: { id: string; name: string }) => item.id === priceId && item.name === "价格很敏感"), true);
  assert.equal(JSON.stringify(added.json).includes("do-not-leak-tag"), false);
  const saved = store.outboundCallRecords.find((item) => item.id === "ocr_tag_a1");
  assert.equal(saved?.updatedAt, "2026-04-04T00:00:00.000Z");
  assert.equal(saved?.callOutcome, "有意向");
  assert.equal(saved?.callNote, "原纪要");
  assert.equal(saved?.contactDisposition, "NoAnswer");
  const addAudit = store.callTagAudits.find((item) => item.callRecordId === "ocr_tag_a1" && item.tagId === priceId && item.action === "add");
  assert.equal(addAudit?.actorId, shirleyUser.id);
  assert.equal(addAudit?.previousValue, "");
  assert.match(String(addAudit?.nextValue), /name=价格很敏感/);
  const again = await request("/api/outbound-call-records/ocr_tag_a1/tags", shirley, "POST", { tagId: priceId });
  assert.equal(again.json.result, "unchanged");
  assert.equal(store.callTagAudits.filter((item) => item.callRecordId === "ocr_tag_a1" && item.tagId === priceId && item.action === "add").length, 1);
  const keepDisabled = await request("/api/outbound-call-records/ocr_tag_a1/tags", shirley, "POST", { tagId: sampleId });
  assert.equal(keepDisabled.json.result, "unchanged");

  await request("/api/outbound-call-records/ocr_tag_a1/tags", shirley, "POST", { tagId: formulaId });
  const removed = await request("/api/outbound-call-records/ocr_tag_a1/tags/remove", shirley, "POST", { tagId: formulaId });
  assert.equal(removed.json.result, "removed");
  assert.equal(store.callRecordTags.some((item) => item.callRecordId === "ocr_tag_a1" && item.tagId === formulaId), false);
  const removeAgain = await request("/api/outbound-call-records/ocr_tag_a1/tags/remove", shirley, "POST", { tagId: formulaId });
  assert.equal(removeAgain.json.result, "unchanged");
  await request("/api/outbound-call-records/ocr_tag_a1/tags", shirley, "POST", { tagId: formulaId });

  const hidden = await request("/api/outbound-call-records/ocr_tag_mia/tags", shirley, "POST", { tagId: priceId });
  assert.equal(hidden.response.status, 403);
  assert.equal(store.callRecordTags.some((item) => item.callRecordId === "ocr_tag_mia"), false);
  assert.equal(hidden.json.record, undefined);
  const manager = await request("/api/outbound-call-records/ocr_tag_mia/tags", alex, "POST", { tagId: priceId });
  assert.equal(manager.response.status, 200);
  assert.equal(manager.json.result, "added");
  const noPerm = await request("/api/outbound-call-records/ocr_tag_a2/tags", noRead, "POST", { tagId: priceId });
  assert.equal(noPerm.response.status, 403);
  assert.equal(store.callRecordTags.some((item) => item.callRecordId === "ocr_tag_a2"), false);
  const unmapped = await request("/api/outbound-call-records/ocr_tag_none/tags", shirley, "POST", { tagId: priceId });
  assert.equal(unmapped.response.status, 403);
  const adminSet = await request("/api/outbound-call-records/ocr_tag_none/tags", admin, "POST", { tagId: priceId });
  assert.equal(adminSet.response.status, 200);
  const foreignTag = await request("/api/outbound-call-records/ocr_tag_a2/tags", shirley, "POST", { tagId: asiaTagId });
  assert.equal(foreignTag.response.status, 404);
  assert.equal(foreignTag.json.reason, "not_found");
  assert.equal(JSON.stringify(store.callTagAudits.filter((item) => item.teamId === "europe")).includes("亚洲标签勿出现"), false);
  const foreignCall = await request("/api/outbound-call-records/ocr_tag_asia/tags", shirley, "POST", { tagId: priceId });
  assert.equal(foreignCall.response.status, 403);
  assert.equal(store.callRecordTags.some((item) => item.callRecordId === "ocr_tag_asia"), false);
  const ownAsia = await request(`/api/outbound-call-records/ocr_tag_asia/tags`, asia, "POST", { tagId: asiaTagId });
  assert.equal(ownAsia.response.status, 200);

  const baseline = await request("/api/outbound-call-records", shirley);
  assert.equal(baseline.response.status, 200);
  assert.equal(baseline.json.stats.totalCalls, 2);
  const tagged = baseline.json.records.find((item: { id: string }) => item.id === "ocr_tag_a1");
  assert.equal(tagged.callTags.some((item: { id: string; enabled: boolean }) => item.id === sampleId && item.enabled === false), true);
  assert.equal(tagged.callTags.some((item: { id: string }) => item.id === formulaId), true);
  const byTag = await request(`/api/outbound-call-records?tag=${encodeURIComponent(priceId)}`, shirley);
  assert.equal(byTag.response.status, 200);
  assert.equal(byTag.json.stats.totalCalls, 2);
  assert.deepEqual(byTag.json.records.map((item: { id: string }) => item.id).sort(), ["ocr_tag_a1"]);
  assert.equal(byTag.json.tags.some((item: { id: string; enabled: boolean }) => item.id === sampleId && item.enabled === false), true);
  const none = await request("/api/outbound-call-records?tag=none", shirley);
  assert.equal(none.json.records.length, 1);
  assert.equal(none.json.records[0].id, "ocr_tag_a2");
  assert.deepEqual(none.json.records[0].callTags, []);
  assert.equal(none.json.stats.totalCalls, 2);
  const badFilter = await request("/api/outbound-call-records?tag=价格", shirley);
  assert.equal(badFilter.response.status, 400);
  const miaList = await request(`/api/outbound-call-records?tag=${encodeURIComponent(priceId)}`, mia);
  assert.equal(miaList.json.records.some((item: { id: string }) => item.id === "ocr_tag_mia"), true);
  assert.equal(miaList.json.records.some((item: { id: string }) => item.id === "ocr_tag_a1"), false);

  const detail = await request("/api/outbound-call-records/ocr_tag_a1", shirley);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.json.record.callTags.some((item: { id: string; enabled: boolean }) => item.id === sampleId && item.enabled === false), true);
  assert.equal(detail.json.tagChoices.some((item: { id: string }) => item.id === priceId), true);
  assert.equal(detail.json.tagChoices.some((item: { id: string }) => item.id === sampleId), false);
  assert.equal(detail.json.tagChoices.some((item: { id: string }) => item.id === asiaTagId), false);
  assert.equal(JSON.stringify(detail.json).includes("do-not-leak-tag"), false);
  assert.equal(JSON.stringify(detail.json).includes("亚洲标签勿出现"), false);

  const exported = await request(`/api/outbound-call-records/export?tag=${encodeURIComponent(formulaId)}`, shirley);
  assert.equal(exported.response.status, 200);
  assert.match(exported.text, /通话标签/);
  assert.match(exported.text, /'=敏感/);
  assert.equal(exported.text.includes("do-not-leak-tag"), false);
  assert.equal(exported.text.includes("亚洲标签勿出现"), false);
  assert.equal(exported.text.includes("13812345678"), false);
  const exportAudit = store.callExportAudits.find((item) => item.actorId === shirleyUser.id && item.filters.includes(formulaId));
  assert.ok(exportAudit);
  assert.match(exportAudit.filters, /"tag":/);
  assert.equal(exportAudit.filters.includes("138"), false);
  const badExport = await request("/api/outbound-call-records/export?tag=不是", shirley);
  assert.equal(badExport.response.status, 400);

  assert.equal(aliyunHits, 0);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  const auditText = JSON.stringify(store.callTagAudits);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("aliyuncs"), false);
  assert.equal(auditText.includes("do-not-leak-tag"), false);

  console.log("call tag http tests passed");
} finally {
  const store = getStore();
  store.callTags = store.callTags.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.callRecordTags = store.callRecordTags.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.callTagAudits = store.callTagAudits.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_tag_"));
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_tag_"));
  store.users = store.users.filter((item) => !["u_no_call_tag_read", "u_call_tag_asia"].includes(item.id));
  globalThis.fetch = originalFetch;
  server.close();
}
