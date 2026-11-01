import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { formatCallScriptValue } from "./call-script.js";
import type { OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call script version test server");
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
  const json = text ? JSON.parse(text) as Record<string, any> : {};
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

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    targetType: "customer",
    targetId: "c1",
    maskedNumber: "*******2333",
    contactType: "OUTBOUND",
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "10",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: String(Date.parse("2026-04-04T04:00:00.000Z")),
    agentIds: "agent@ccc-ver",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/do-not-leak-version",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "有意向",
    callOutcomeNote: "原标注",
    callNote: "原纪要",
    callNoteTags: "需求",
    callNoteUpdatedAt: "2026-04-04T01:00:00.000Z",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "2026-04-04T02:00:00.000Z",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

const marker = "版本甲<script>alert(1)</script>";
const secondBody = "版本乙";
const thirdBody = "版本丙";
const otherOld = "另一条旧正文";
const asiaBody = "亚洲版本勿出现";

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const adminUser = store.users.find((item) => item.email === "admin@keduoduo.com");
  assert.ok(shirleyUser && adminUser);
  store.users.push({
    ...shirleyUser,
    id: "u_no_script_version_read",
    name: "No Script Version Read",
    email: "no-script-version-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...adminUser,
    id: "u_script_version_asia",
    name: "Asia Script Version",
    email: "asia-script-version@keduoduo.com",
    role: "admin",
    teamId: "asia",
    status: "active"
  }, {
    ...adminUser,
    id: "u_script_version_super",
    name: "Europe Script Version Super",
    email: "europe-script-version-super@keduoduo.com",
    role: "super_admin",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_no_script_version_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };

  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const sequencesBefore = store.outreachSequences.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const usageAuditsBefore = store.callScriptUsageAudits.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);

  const admin = await login("admin@keduoduo.com");
  const shirley = await login("shirley@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const noRead = await login("no-script-version-read@keduoduo.com");
  const asia = await login("asia-script-version@keduoduo.com");
  const superAdmin = await login("europe-script-version-super@keduoduo.com");

  const auditsBeforeInvalid = store.callScriptAudits.length;
  const versionsBefore = store.callScriptVersions.length;
  for (const body of [
    [{ templateId: "cst_demo", versionId: "csver_demo" }],
    { templateId: "cst_demo", versionId: "csver_demo", versions: [] },
    { templateId: "cst_demo", versionId: "csver_demo", versionIds: ["csver_demo"] },
    { templateId: "bad id", versionId: "csver_demo" },
    { templateId: "cst_demo" },
    {}
  ]) {
    const rejected = await request("/api/call-script-templates/restore", admin, "POST", body);
    assert.equal(rejected.response.status, 400);
  }
  assert.equal(store.callScriptAudits.length, auditsBeforeInvalid);
  assert.equal(store.callScriptVersions.length, versionsBefore);

  const created = await request("/api/call-script-templates", admin, "POST", {
    title: "开场",
    scenario: "first_call",
    body: marker,
    language: "zh"
  });
  assert.equal(created.response.status, 200);
  const templateId = String(created.json.template.id);
  assert.equal(store.callScriptVersions.some((item) => item.templateId === templateId), false);

  const call = record({ id: "ocr_ver_1", callScriptTemplateId: templateId });
  store.outboundCallRecords.push(call);
  const callBefore = JSON.stringify(store.outboundCallRecords.find((item) => item.id === "ocr_ver_1"));

  const empty = await request(`/api/call-script-templates/${templateId}/versions`, admin);
  assert.equal(empty.response.status, 200);
  assert.deepEqual(empty.json.versions, []);
  assert.equal(store.callScriptAudits.some((item) => item.action === "versions" && item.result === "updated"), false);
  const badQuery = await request(`/api/call-script-templates/${templateId}/versions?includeDisabled=1`, admin);
  assert.equal(badQuery.response.status, 400);
  assert.equal(store.callScriptAudits.length, store.callScriptAudits.filter((item) => item.templateId !== templateId || item.action !== "versions").length);

  const auditsBeforeSame = store.callScriptAudits.length;
  const same = await request("/api/call-script-templates/update", admin, "POST", {
    id: templateId,
    title: "开场",
    scenario: "first_call",
    body: marker,
    language: "zh"
  });
  assert.equal(same.json.result, "unchanged");
  assert.equal(store.callScriptAudits.length, auditsBeforeSame);
  assert.equal(store.callScriptVersions.filter((item) => item.templateId === templateId).length, 0);

  const edited = await request("/api/call-script-templates/update", admin, "POST", {
    id: templateId,
    title: "开场二",
    scenario: "follow_up",
    body: secondBody,
    language: "zh-CN"
  });
  assert.equal(edited.response.status, 200);
  assert.equal(edited.json.template.id, templateId);
  const firstList = await request(`/api/call-script-templates/${templateId}/versions`, superAdmin);
  assert.equal(firstList.response.status, 200);
  assert.equal(firstList.json.versions.length, 1);
  assert.equal(firstList.json.versions[0].versionNo, 1);
  assert.equal(firstList.json.versions[0].source, "edit");
  assert.equal("body" in firstList.json.versions[0], false);
  assert.equal(firstList.text.includes(marker), false);
  const firstId = String(firstList.json.versions[0].id);
  const firstDetail = await request(`/api/call-script-templates/${templateId}/versions/${firstId}`, admin);
  assert.equal(firstDetail.response.status, 200);
  assert.equal(firstDetail.json.version.body, marker);
  assert.equal(firstDetail.json.version.title, "开场");
  assert.equal(store.callScriptAudits.filter((item) => item.templateId === templateId && item.action === "versions").length, 0);
  const savedFirst = store.callScriptVersions.find((item) => item.id === firstId);
  assert.equal(savedFirst?.savedBy, adminUser.id);
  assert.equal(savedFirst?.enabled, true);
  assert.equal(savedFirst?.templateId, templateId);

  const editedAgain = await request("/api/call-script-templates/update", admin, "POST", {
    id: templateId,
    title: "开场三",
    scenario: "objection",
    body: thirdBody,
    language: ""
  });
  assert.equal(editedAgain.response.status, 200);
  const secondList = await request(`/api/call-script-templates/${templateId}/versions`, admin);
  assert.deepEqual(secondList.json.versions.map((item: { versionNo: number }) => item.versionNo), [2, 1]);
  const secondId = String(secondList.json.versions[0].id);
  const secondDetail = await request(`/api/call-script-templates/${templateId}/versions/${secondId}`, admin);
  assert.equal(secondDetail.json.version.body, secondBody);
  assert.equal(secondDetail.json.version.scenario, "follow_up");

  const auditsBeforeRestore = store.callScriptAudits.length;
  const versionsBeforeRestore = store.callScriptVersions.filter((item) => item.templateId === templateId).length;
  const restored = await request("/api/call-script-templates/restore", admin, "POST", { templateId, versionId: firstId });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.json.result, "restored");
  assert.equal(restored.json.template.id, templateId);
  assert.equal(restored.json.template.body, marker);
  assert.equal(restored.json.version.source, "restore");
  const afterRestore = store.callScriptVersions.filter((item) => item.templateId === templateId);
  assert.equal(afterRestore.length, versionsBeforeRestore + 1);
  const archived = afterRestore.find((item) => item.versionNo === 3);
  assert.equal(archived?.source, "restore");
  assert.equal(archived?.body, thirdBody);
  assert.equal(archived?.title, "开场三");
  const restoreAudit = store.callScriptAudits.find((item) => item.templateId === templateId && item.action === "restore" && item.result === "updated");
  assert.ok(restoreAudit);
  assert.equal(restoreAudit.actorId, adminUser.id);
  assert.equal(restoreAudit.previousValue, formatCallScriptValue({
    title: "开场三",
    scenario: "objection",
    language: "",
    body: thirdBody,
    enabled: true
  }));
  assert.equal(restoreAudit.nextValue, formatCallScriptValue({
    title: "开场",
    scenario: "first_call",
    language: "zh",
    body: marker,
    enabled: true
  }));
  assert.equal(store.callScriptAudits.length, auditsBeforeRestore + 1);
  assert.equal(store.callScriptTemplates.find((item) => item.id === templateId)?.id, templateId);

  const auditsBeforeRepeat = store.callScriptAudits.length;
  const versionsBeforeRepeat = store.callScriptVersions.filter((item) => item.templateId === templateId).length;
  const repeated = await request("/api/call-script-templates/restore", admin, "POST", { templateId, versionId: firstId });
  assert.equal(repeated.json.result, "unchanged");
  assert.equal(store.callScriptAudits.length, auditsBeforeRepeat);
  assert.equal(store.callScriptVersions.filter((item) => item.templateId === templateId).length, versionsBeforeRepeat);
  assert.equal(JSON.stringify(store.outboundCallRecords.find((item) => item.id === "ocr_ver_1")), callBefore);
  assert.equal(store.outboundCallRecords.some((item) => String(item.callScriptTemplateId).startsWith("csver_")), false);

  const other = await request("/api/call-script-templates", admin, "POST", {
    title: "另一条",
    scenario: "first_call",
    body: otherOld,
    language: ""
  });
  const otherId = String(other.json.template.id);
  await request("/api/call-script-templates/update", admin, "POST", {
    id: otherId,
    title: "另一条",
    scenario: "first_call",
    body: "另一条新正文",
    language: ""
  });
  const otherVersionId = store.callScriptVersions.find((item) => item.templateId === otherId)?.id;
  assert.ok(otherVersionId);
  assert.equal(store.callScriptVersions.find((item) => item.id === otherVersionId)?.body, otherOld);
  const auditsBeforeMiss = store.callScriptAudits.length;
  const missed = await request("/api/call-script-templates/restore", admin, "POST", { templateId, versionId: otherVersionId });
  assert.equal(missed.response.status, 404);
  assert.equal(missed.json.reason, "not_found");
  assert.equal(store.callScriptTemplates.find((item) => item.id === templateId)?.body, marker);
  const missAudit = store.callScriptAudits.find((item) => item.action === "restore" && item.reason === "not_found" && item.templateId === templateId);
  assert.ok(missAudit);
  assert.equal(missAudit.previousValue, "");
  assert.equal(missAudit.nextValue, "");
  assert.equal(missAudit.previousValue.includes(otherOld), false);
  assert.equal(store.callScriptAudits.length, auditsBeforeMiss + 1);

  const auditsBeforeDisable = store.callScriptAudits.length;
  const versionsBeforeDisable = store.callScriptVersions.filter((item) => item.templateId === templateId).length;
  const disabled = await request("/api/call-script-templates/disable", admin, "POST", { id: templateId });
  assert.equal(disabled.response.status, 200);
  assert.equal(store.callScriptVersions.filter((item) => item.templateId === templateId).length, versionsBeforeDisable);
  const restoreDisabled = await request("/api/call-script-templates/restore", admin, "POST", { templateId, versionId: firstId });
  assert.equal(restoreDisabled.response.status, 400);
  assert.equal(restoreDisabled.json.reason, "disabled");
  assert.equal(store.callScriptAudits.length, auditsBeforeDisable + 1);
  assert.equal(store.callScriptTemplates.find((item) => item.id === templateId)?.body, marker);
  const disabledList = await request(`/api/call-script-templates/${templateId}/versions`, admin);
  assert.equal(disabledList.response.status, 200);
  assert.equal(disabledList.json.versions.length, versionsBeforeDisable);
  const disabledDetail = await request(`/api/call-script-templates/${templateId}/versions/${firstId}`, admin);
  assert.equal(disabledDetail.json.version.body, marker);

  async function forbidden(token: string, actorId: string) {
    const before = store.callScriptAudits.length;
    const versionCount = store.callScriptVersions.filter((item) => item.templateId === templateId).length;
    const listDenied = await request(`/api/call-script-templates/${templateId}/versions`, token);
    const oneDenied = await request(`/api/call-script-templates/${templateId}/versions/${firstId}`, token);
    const restoreDenied = await request("/api/call-script-templates/restore", token, "POST", { templateId, versionId: firstId });
    assert.equal(listDenied.response.status, 403);
    assert.equal(oneDenied.response.status, 403);
    assert.equal(restoreDenied.response.status, 403);
    assert.equal(listDenied.json.versions, undefined);
    assert.equal(oneDenied.json.version, undefined);
    for (const payload of [listDenied.text, oneDenied.text, restoreDenied.text]) {
      assert.equal(payload.includes(marker), false);
      assert.equal(payload.includes("alert(1)"), false);
    }
    const rows = store.callScriptAudits.filter((item) => item.actorId === actorId && item.result === "rejected").slice(0, 3);
    assert.equal(rows.length >= 3, true);
    const newest = store.callScriptAudits.filter((item) => item.actorId === actorId).slice(0, 3);
    assert.deepEqual(newest.map((item) => item.action).sort(), ["restore", "version", "versions"]);
    for (const row of newest) {
      assert.equal(row.previousValue, "");
      assert.equal(row.nextValue, "");
      assert.equal(row.reason, "forbidden");
      assert.equal(row.previousValue.includes(marker), false);
    }
    assert.equal(store.callScriptAudits.length, before + 3);
    assert.equal(store.callScriptVersions.filter((item) => item.templateId === templateId).length, versionCount);
    assert.equal(store.callScriptTemplates.find((item) => item.id === templateId)?.body, marker);
  }
  await forbidden(shirley, shirleyUser.id);
  await forbidden(alex, "u_manager_alex");
  const noReadDenied = await request(`/api/call-script-templates/${templateId}/versions`, noRead);
  assert.equal(noReadDenied.response.status, 403);
  assert.equal(store.callScriptAudits.some((item) => item.actorId === "u_no_script_version_read" && item.action === "versions" && item.result === "rejected"), true);
  assert.equal(noReadDenied.text.includes(marker), false);

  const asiaCreated = await request("/api/call-script-templates", asia, "POST", {
    title: "亚洲话术",
    scenario: "first_call",
    body: asiaBody
  });
  assert.equal(asiaCreated.response.status, 200);
  const asiaId = String(asiaCreated.json.template.id);
  const cross = await request(`/api/call-script-templates/${asiaId}/versions`, admin);
  assert.equal(cross.response.status, 404);
  const crossOne = await request(`/api/call-script-templates/${asiaId}/versions/${firstId}`, admin);
  assert.equal(crossOne.response.status, 404);
  const crossRestore = await request("/api/call-script-templates/restore", admin, "POST", { templateId: asiaId, versionId: firstId });
  assert.equal(crossRestore.response.status, 404);
  assert.equal(store.callScriptTemplates.find((item) => item.id === asiaId)?.body, asiaBody);
  assert.equal(JSON.stringify(store.outboundCallRecords.find((item) => item.id === "ocr_ver_1")), callBefore);
  const europeAudits = JSON.stringify(store.callScriptAudits.filter((item) => item.teamId === "europe"));
  assert.equal(europeAudits.includes(asiaBody), false);
  const asiaList = await request(`/api/call-script-templates/${asiaId}/versions`, asia);
  assert.equal(asiaList.response.status, 200);
  assert.deepEqual(asiaList.json.versions, []);
  const europeOnAsia = await request("/api/call-script-templates/update", admin, "POST", {
    id: asiaId,
    title: "亚洲话术",
    scenario: "first_call",
    body: "不该写上",
    language: ""
  });
  assert.equal(europeOnAsia.response.status, 404);
  assert.equal(store.callScriptVersions.some((item) => item.templateId === asiaId), false);

  assert.equal(aliyunHits, 0);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outreachSequences.length, sequencesBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.callScriptUsageAudits.length, usageAuditsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  const auditText = JSON.stringify(store.callScriptAudits);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("aliyuncs"), false);
  assert.equal(auditText.includes("do-not-leak-version"), false);
  assert.equal(JSON.stringify(store.callScriptVersions).includes("do-not-leak-version"), false);
  const responseLeak = `${firstDetail.text}${restored.text}${disabledList.text}`;
  assert.equal(responseLeak.includes("do-not-leak-version"), false);
  assert.equal(responseLeak.includes("*******2333"), false);

  console.log("call script version http tests passed");
} finally {
  const store = getStore();
  store.callScriptVersions = store.callScriptVersions.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.callScriptTemplates = store.callScriptTemplates.filter((item) => item.teamId !== "europe" && item.teamId !== "asia" || !item.id.startsWith("cst_"));
  store.callScriptAudits = store.callScriptAudits.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => item.id !== "ocr_ver_1");
  store.users = store.users.filter((item) => !["u_no_script_version_read", "u_script_version_asia", "u_script_version_super"].includes(item.id));
  globalThis.fetch = originalFetch;
  server.close();
}
