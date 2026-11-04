import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start outcome note phrase test server");
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

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  assert.ok(shirleyUser);
  store.users.push({
    ...shirleyUser,
    id: "u_no_phrase_read",
    name: "No Phrase Read",
    email: "no-phrase-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_phrase_asia",
    name: "Asia Phrase",
    email: "asia-phrase@keduoduo.com",
    role: "sales",
    teamId: "asia",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_no_phrase_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };

  const recordsBefore = store.outboundCallRecords.length;
  const outcomeAuditsBefore = store.callOutcomeAudits.length;
  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  const marker = "短语标记要样品";

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const noRead = await login("no-phrase-read@keduoduo.com");
  const asia = await login("asia-phrase@keduoduo.com");

  assert.equal((await request("/api/call-outcome-note-phrases", "")).response.status, 401);
  assert.equal(store.callScriptAudits.some((item) => item.action === "phrase_read"), false);

  const denied = await request("/api/call-outcome-note-phrases", noRead);
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.phrases, undefined);
  assert.equal(store.callScriptAudits[0]?.action, "phrase_read");
  assert.equal(store.callScriptAudits[0]?.result, "rejected");

  const invalid = await request("/api/call-outcome-note-phrases", shirley, "POST", { text: "文".repeat(201), scope: "personal" });
  assert.equal(invalid.response.status, 400);
  const auditsAfterInvalid = store.callScriptAudits.length;
  const batch = await request("/api/call-outcome-note-phrases", shirley, "POST", { text: marker, scope: "team", phrases: [marker] });
  assert.equal(batch.response.status, 400);
  assert.equal(store.callScriptAudits.length, auditsAfterInvalid);

  const personal = await request("/api/call-outcome-note-phrases", shirley, "POST", { text: `  ${marker}  `, scope: "personal" });
  assert.equal(personal.response.status, 200);
  assert.equal(personal.json.result, "created");
  const personalId = String(personal.json.phrase?.id || "");
  assert.equal(store.callScriptTemplates.find((item) => item.id === personalId)?.usageKind, "outcome_note");
  assert.equal(store.callScriptTemplates.find((item) => item.id === personalId)?.scenario, "");
  const createdAudits = store.callScriptAudits.filter((item) => item.action === "phrase_create" && item.result === "updated");
  assert.equal(createdAudits.length, 1);
  const duplicate = await request("/api/call-outcome-note-phrases", shirley, "POST", { text: marker, scope: "personal" });
  assert.equal(duplicate.json.result, "unchanged");
  assert.equal(store.callScriptAudits.filter((item) => item.action === "phrase_create" && item.result === "updated").length, 1);

  const team = await request("/api/call-outcome-note-phrases", shirley, "POST", { text: "团队短语改日再打", scope: "team" });
  assert.equal(team.json.result, "created");
  const teamId = String(team.json.phrase?.id || "");
  const teamAgain = await request("/api/call-outcome-note-phrases", mia, "POST", { text: "团队短语改日再打", scope: "team" });
  assert.equal(teamAgain.json.result, "unchanged");

  const mine = await request("/api/call-outcome-note-phrases", mia);
  assert.equal(mine.response.status, 200);
  assert.equal((mine.json.phrases || []).some((item: { text?: string }) => item.text === marker), false);
  assert.equal((mine.json.phrases || []).some((item: { id?: string; canDisable?: boolean }) => item.id === teamId && item.canDisable === false), true);
  const reads = store.callScriptAudits.filter((item) => item.action === "phrase_read" && item.result === "updated");
  assert.equal(reads.length, 0);

  const scripts = await request("/api/call-script-templates", shirley);
  assert.equal(scripts.response.status, 200);
  assert.equal(JSON.stringify(scripts.json).includes(marker), false);
  const scenarios = await request("/api/call-script-scenarios", shirley);
  assert.equal(JSON.stringify(scenarios.json).includes("note_phrase"), false);
  assert.equal(JSON.stringify(scenarios.json).includes(marker), false);
  const favorite = await request("/api/call-script-favorites", shirley, "POST", { templateId: personalId });
  assert.equal(favorite.response.status, 404);
  const scriptDisable = await request("/api/call-script-templates/disable", admin, "POST", { id: teamId });
  assert.equal(scriptDisable.response.status, 404);
  assert.equal(store.callScriptTemplates.find((item) => item.id === teamId)?.enabled, true);
  assert.equal(store.callScriptTemplates.find((item) => item.id === teamId)?.body, "团队短语改日再打");

  const report = await request("/api/call-script-report", admin);
  assert.equal(report.response.status, 200);
  assert.equal(JSON.stringify(report.json).includes(marker), false);
  assert.equal(JSON.stringify(report.json).includes("团队短语改日再打"), false);

  const otherPersonal = await request("/api/call-outcome-note-phrases/disable", mia, "POST", { id: personalId });
  assert.equal(otherPersonal.response.status, 403);
  assert.equal(store.callScriptTemplates.find((item) => item.id === personalId)?.enabled, true);
  assert.equal(store.callScriptAudits[0]?.previousValue.includes(marker), false);

  const otherTeam = await request("/api/call-outcome-note-phrases/disable", mia, "POST", { id: teamId });
  assert.equal(otherTeam.response.status, 403);
  assert.equal(store.callScriptTemplates.find((item) => item.id === teamId)?.enabled, true);
  const manager = await request("/api/call-outcome-note-phrases/disable", alex, "POST", { id: teamId });
  assert.equal(manager.json.result, "disabled");
  const managerAgain = await request("/api/call-outcome-note-phrases/disable", alex, "POST", { id: teamId });
  assert.equal(managerAgain.json.result, "unchanged");
  assert.equal(store.callScriptAudits.filter((item) => item.templateId === teamId && item.action === "phrase_disable" && item.result === "updated").length, 1);

  const gone = await request("/api/call-outcome-note-phrases", shirley);
  assert.equal((gone.json.phrases || []).some((item: { id?: string }) => item.id === teamId), false);
  assert.equal((gone.json.phrases || []).some((item: { text?: string }) => item.text === marker), true);
  const disabledRows = await request("/api/call-outcome-note-phrases?includeDisabled=1", alex);
  assert.equal((disabledRows.json.phrases || []).some((item: { id?: string; enabled?: boolean }) => item.id === teamId && item.enabled === false), true);

  const foreign = await request("/api/call-outcome-note-phrases/disable", asia, "POST", { id: personalId });
  assert.equal(foreign.response.status, 404);
  assert.equal(store.callScriptTemplates.find((item) => item.id === personalId)?.enabled, true);
  assert.equal(store.callScriptAudits.filter((item) => item.teamId === "asia").every((item) => !item.previousValue.includes(marker) && !item.nextValue.includes(marker)), true);

  const ownDisable = await request("/api/call-outcome-note-phrases/disable", shirley, "POST", { id: personalId });
  assert.equal(ownDisable.json.result, "disabled");

  assert.equal(aliyunHits, 0);
  assert.equal(store.outboundCallRecords.length, recordsBefore);
  assert.equal(store.callOutcomeAudits.length, outcomeAuditsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  assert.equal(JSON.stringify(store.callScriptAudits).includes("AccessKey"), false);
  assert.equal(JSON.stringify(store.callScriptAudits).includes("aliyuncs"), false);

  console.log("call outcome note phrase http tests passed");
} finally {
  const store = getStore();
  store.callScriptTemplates = store.callScriptTemplates.filter((item) => !item.id.startsWith("csp_"));
  store.callScriptAudits = store.callScriptAudits.filter((item) => !item.id.startsWith("cspa_") && !item.templateId.startsWith("csp_") && !item.action.startsWith("phrase_"));
  store.callScriptFavoriteAudits = store.callScriptFavoriteAudits.filter((item) => !item.templateId.startsWith("csp_"));
  store.users = store.users.filter((item) => item.id !== "u_no_phrase_read" && item.id !== "u_phrase_asia");
  globalThis.fetch = originalFetch;
  server.close();
}
