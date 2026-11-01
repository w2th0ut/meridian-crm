import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import type { OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call script favorite test server");
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
    agentIds: "agent@ccc-fav",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/do-not-leak-favorite",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "",
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

const marker = "收藏正文甲<script>alert(1)</script>";
const secondBody = "收藏正文乙";
const disabledBody = "收藏正文停用";
const asiaBody = "亚洲收藏勿出现";

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const adminUser = store.users.find((item) => item.email === "admin@keduoduo.com");
  assert.ok(shirleyUser && adminUser);
  store.users.push({
    ...shirleyUser,
    id: "u_no_script_favorite_read",
    name: "No Script Favorite Read",
    email: "no-script-favorite-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...adminUser,
    id: "u_script_favorite_asia",
    name: "Asia Script Favorite",
    email: "asia-script-favorite@keduoduo.com",
    role: "admin",
    teamId: "asia",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_no_script_favorite_read") return snapshot;
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
  const versionsBefore = store.callScriptVersions.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);

  store.aliyunAgentMappings.push({
    id: "map_fav_shirley",
    teamId: "europe",
    crmUserId: shirleyUser.id,
    cccUserId: "agent@ccc-fav",
    loginName: "shirley",
    displayName: "Shirley坐席",
    extension: "8211",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  });
  store.outboundCallRecords.push(record({ id: "ocr_fav_1" }));

  const admin = await login("admin@keduoduo.com");
  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const noRead = await login("no-script-favorite-read@keduoduo.com");
  const asia = await login("asia-script-favorite@keduoduo.com");

  const auditsBeforeInvalid = store.callScriptFavoriteAudits.length;
  const rowsBeforeInvalid = store.callScriptFavorites.length;
  for (const body of [
    [{ templateId: "cst_demo" }],
    { templateId: "cst_demo", favorites: [] },
    { templateId: "cst_demo", favoriteIds: ["cst_demo"] },
    { templateId: "bad id" },
    {}
  ]) {
    const rejected = await request("/api/call-script-favorites", admin, "POST", body);
    assert.equal(rejected.response.status, 400);
    const removed = await request("/api/call-script-favorites/remove", shirley, "POST", body);
    assert.equal(removed.response.status, 400);
  }
  const badQuery = await request("/api/call-script-favorites?includeDisabled=1", shirley);
  assert.equal(badQuery.response.status, 400);
  assert.equal(store.callScriptFavoriteAudits.length, auditsBeforeInvalid);
  assert.equal(store.callScriptFavorites.length, rowsBeforeInvalid);

  const noReadPost = await request("/api/call-script-favorites", noRead, "POST", { templateId: "cst_demo" });
  assert.equal(noReadPost.response.status, 403);
  assert.equal(noReadPost.json.reason, "forbidden");
  const noReadList = await request("/api/call-script-favorites", noRead);
  assert.equal(noReadList.response.status, 403);
  assert.equal(noReadList.json.favorites, undefined);
  assert.equal(store.callScriptFavoriteAudits.some((item) => item.actorId === "u_no_script_favorite_read" && item.action === "favorite" && item.result === "rejected"), true);
  assert.equal(store.callScriptFavoriteAudits.some((item) => item.actorId === "u_no_script_favorite_read" && item.action === "read" && item.result === "rejected"), true);
  assert.equal(store.callScriptFavorites.length, rowsBeforeInvalid);

  const created = await request("/api/call-script-templates", admin, "POST", {
    title: "开场",
    scenario: "first_call",
    body: marker,
    language: "zh"
  });
  assert.equal(created.response.status, 200);
  const templateId = String(created.json.template.id);
  const second = await request("/api/call-script-templates", admin, "POST", {
    title: "回访",
    scenario: "follow_up",
    body: secondBody
  });
  const secondId = String(second.json.template.id);
  const retiring = await request("/api/call-script-templates", admin, "POST", {
    title: "将停用",
    scenario: "objection",
    body: disabledBody
  });
  const retiringId = String(retiring.json.template.id);
  const plain = await request("/api/call-script-templates", admin, "POST", {
    title: "未收藏",
    scenario: "missed_callback",
    body: "没有人收藏"
  });
  const plainId = String(plain.json.template.id);

  const favored = await request("/api/call-script-favorites", shirley, "POST", { templateId });
  assert.equal(favored.response.status, 200);
  assert.equal(favored.json.result, "created");
  assert.equal(favored.json.favorite.templateId, templateId);
  assert.equal(favored.json.favorite.selectable, true);
  assert.equal(favored.text.includes("do-not-leak-favorite"), false);
  const favoriteAudit = store.callScriptFavoriteAudits.find((item) => item.actorId === shirleyUser.id && item.action === "favorite" && item.result === "updated");
  assert.equal(favoriteAudit?.templateId, templateId);
  assert.equal(favoriteAudit?.ownerId, shirleyUser.id);
  assert.equal(JSON.stringify(store.callScriptFavoriteAudits).includes(marker), false);

  const auditsBeforeSame = store.callScriptFavoriteAudits.length;
  const same = await request("/api/call-script-favorites", shirley, "POST", { templateId });
  assert.equal(same.json.result, "unchanged");
  assert.equal(store.callScriptFavoriteAudits.length, auditsBeforeSame);
  assert.equal(store.callScriptFavorites.filter((item) => item.actorId === shirleyUser.id && item.templateId === templateId).length, 1);

  const secondFavorite = await request("/api/call-script-favorites", shirley, "POST", { templateId: secondId });
  assert.equal(secondFavorite.json.result, "created");
  const retiringFavorite = await request("/api/call-script-favorites", shirley, "POST", { templateId: retiringId });
  assert.equal(retiringFavorite.json.result, "created");
  const listed = await request("/api/call-script-favorites", shirley);
  assert.equal(listed.response.status, 200);
  assert.deepEqual(listed.json.favorites.map((item: { templateId: string }) => item.templateId), [retiringId, secondId, templateId]);
  assert.equal(store.callScriptFavoriteAudits.filter((item) => item.action === "read" && item.result === "updated").length, 0);
  assert.equal(listed.text.includes(marker), true);

  const rowsBeforeOther = store.callScriptFavorites.map((item) => item.id);
  for (const token of [mia, alex, admin]) {
    const denied = await request("/api/call-script-favorites", token, "POST", { templateId, actorId: shirleyUser.id });
    assert.equal(denied.response.status, 403);
    assert.equal(denied.json.reason, "forbidden");
    assert.equal(denied.json.favorite, undefined);
    const deniedList = await request(`/api/call-script-favorites?actorId=${encodeURIComponent(shirleyUser.id)}`, token);
    assert.equal(deniedList.response.status, 403);
    assert.equal(deniedList.json.reason, "forbidden");
    assert.equal(deniedList.json.favorites, undefined);
    const deniedRemove = await request("/api/call-script-favorites/remove", token, "POST", { templateId, actorId: shirleyUser.id });
    assert.equal(deniedRemove.response.status, 403);
    assert.equal(deniedRemove.text.includes(marker), false);
  }
  assert.deepEqual(store.callScriptFavorites.map((item) => item.id), rowsBeforeOther);
  assert.equal(store.callScriptFavoriteAudits.some((item) => item.ownerId === shirleyUser.id && item.actorId !== shirleyUser.id && item.result === "rejected"), true);
  assert.equal(JSON.stringify(store.callScriptFavoriteAudits).includes(marker), false);

  const miaOwn = await request("/api/call-script-favorites", mia, "POST", { templateId });
  assert.equal(miaOwn.json.result, "created");
  const shirleyStill = await request("/api/call-script-favorites", shirley);
  assert.equal(shirleyStill.json.favorites.filter((item: { templateId: string }) => item.templateId === templateId).length, 1);
  const miaList = await request("/api/call-script-favorites", mia);
  assert.deepEqual(miaList.json.favorites.map((item: { templateId: string }) => item.templateId), [templateId]);

  const bodyBeforeDisable = store.callScriptTemplates.find((item) => item.id === retiringId)?.body;
  const favoriteCountBeforeDisable = store.callScriptFavorites.filter((item) => item.templateId === retiringId).length;
  const disabled = await request("/api/call-script-templates/disable", admin, "POST", { id: retiringId });
  assert.equal(disabled.response.status, 200);
  assert.equal(store.callScriptFavorites.filter((item) => item.templateId === retiringId).length, favoriteCountBeforeDisable);
  assert.equal(store.callScriptTemplates.find((item) => item.id === retiringId)?.body, bodyBeforeDisable);
  assert.equal(store.callScriptTemplates.find((item) => item.id === retiringId)?.enabled, false);
  const afterDisable = await request("/api/call-script-favorites", shirley);
  const retiredRow = afterDisable.json.favorites.find((item: { templateId: string }) => item.templateId === retiringId);
  assert.equal(retiredRow.enabled, false);
  assert.equal(retiredRow.selectable, false);
  const auditsBeforeDisabled = store.callScriptFavoriteAudits.length;
  const favoriteDisabled = await request("/api/call-script-favorites", shirley, "POST", { templateId: retiringId });
  assert.equal(favoriteDisabled.response.status, 400);
  assert.equal(favoriteDisabled.json.reason, "disabled");
  const unfavoriteDisabled = await request("/api/call-script-favorites/remove", shirley, "POST", { templateId: retiringId });
  assert.equal(unfavoriteDisabled.response.status, 400);
  assert.equal(unfavoriteDisabled.json.reason, "disabled");
  assert.equal(store.callScriptFavoriteAudits.length, auditsBeforeDisabled);
  assert.equal(store.callScriptFavorites.some((item) => item.actorId === shirleyUser.id && item.templateId === retiringId), true);

  const detail = await request("/api/outbound-call-records/ocr_fav_1", shirley);
  assert.equal(detail.response.status, 200);
  const choiceIds = detail.json.scriptChoices.map((item: { id: string }) => item.id);
  assert.ok(choiceIds.indexOf(retiringId) < choiceIds.indexOf(secondId));
  assert.ok(choiceIds.indexOf(secondId) < choiceIds.indexOf(templateId));
  assert.ok(choiceIds.indexOf(templateId) < choiceIds.indexOf(plainId));
  assert.equal(detail.json.scriptChoices.find((item: { id: string }) => item.id === retiringId).selectable, false);
  assert.equal(detail.json.scriptChoices.find((item: { id: string }) => item.id === secondId).favorited, true);
  assert.equal(detail.text.includes("do-not-leak-favorite"), false);
  assert.equal(detail.text.includes(marker) , false);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_fav_1")?.callScriptTemplateId, "");

  const removed = await request("/api/call-script-favorites/remove", shirley, "POST", { templateId: secondId });
  assert.equal(removed.json.result, "removed");
  assert.equal(store.callScriptFavorites.some((item) => item.actorId === shirleyUser.id && item.templateId === secondId), false);
  assert.equal(store.callScriptFavorites.some((item) => item.actorId !== shirleyUser.id && item.templateId === templateId), true);
  const auditsBeforeRepeat = store.callScriptFavoriteAudits.length;
  const removedAgain = await request("/api/call-script-favorites/remove", shirley, "POST", { templateId: secondId });
  assert.equal(removedAgain.json.result, "unchanged");
  assert.equal(store.callScriptFavoriteAudits.length, auditsBeforeRepeat);
  assert.equal(store.callScriptTemplates.find((item) => item.id === secondId)?.body, secondBody);
  assert.equal(store.callScriptVersions.length, versionsBefore);

  const asiaCreated = await request("/api/call-script-templates", asia, "POST", {
    title: "亚洲话术",
    scenario: "first_call",
    body: asiaBody
  });
  const asiaId = String(asiaCreated.json.template.id);
  const cross = await request("/api/call-script-favorites", shirley, "POST", { templateId: asiaId });
  assert.equal(cross.response.status, 404);
  assert.equal(cross.json.reason, "not_found");
  assert.equal(cross.text.includes(asiaBody), false);
  assert.equal(store.callScriptTemplates.find((item) => item.id === asiaId)?.body, asiaBody);
  assert.equal(store.callScriptFavorites.some((item) => item.templateId === asiaId && item.teamId === "europe"), false);
  assert.equal(JSON.stringify(store.callScriptFavoriteAudits.filter((item) => item.teamId === "europe")).includes(asiaBody), false);
  const asiaFavorite = await request("/api/call-script-favorites", asia, "POST", { templateId: asiaId });
  assert.equal(asiaFavorite.json.result, "created");
  const europeList = await request("/api/call-script-favorites", shirley);
  assert.equal(europeList.json.favorites.some((item: { templateId: string }) => item.templateId === asiaId), false);

  assert.equal(aliyunHits, 0);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outreachSequences.length, sequencesBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.callScriptUsageAudits.length, usageAuditsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  const auditText = JSON.stringify(store.callScriptFavoriteAudits);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("aliyuncs"), false);
  assert.equal(auditText.includes("do-not-leak-favorite"), false);
  assert.equal(auditText.includes("*******2333"), false);
  assert.equal(auditText.includes(marker), false);

  console.log("call script favorite http tests passed");
} finally {
  const store = getStore();
  store.callScriptFavorites = store.callScriptFavorites.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.callScriptFavoriteAudits = store.callScriptFavoriteAudits.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.callScriptTemplates = store.callScriptTemplates.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.callScriptAudits = store.callScriptAudits.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => item.id !== "ocr_fav_1");
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => item.id !== "map_fav_shirley");
  store.users = store.users.filter((item) => !["u_no_script_favorite_read", "u_script_favorite_asia"].includes(item.id));
  globalThis.fetch = originalFetch;
  server.close();
}
