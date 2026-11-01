import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import type { CallWrapupAudit, CallWrapupEditAudit, CallWrapupSkip, OutboundCallAudit, OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call workload test server");
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
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
  const text = await response.text();
  const type = response.headers.get("content-type") || "";
  const json = type.includes("json") && text ? JSON.parse(text) as Record<string, any> : {};
  return { response, text, json };
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

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "agentIds" | "outboundCallAuditId">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    targetType: "customer",
    targetId: "c1",
    maskedNumber: "13800139999",
    contactType: "OUTBOUND",
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "",
    establishedTimeRaw: "",
    releaseTimeRaw: "",
    startTimeRaw: "",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/do-not-leak-workload",
    recordingDurationRaw: "999",
    followUpActivityId: "",
    callOutcome: "",
    callOutcomeNote: "",
    callNote: "纪要不要出现",
    callNoteTags: "",
    callNoteUpdatedAt: "",
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
  const alexUser = store.users.find((item) => item.email === "alex@keduoduo.com");
  const adminUser = store.users.find((item) => item.email === "admin@keduoduo.com");
  assert.ok(shirleyUser && miaUser && alexUser && adminUser);
  store.users.push({
    ...adminUser,
    id: "u_workload_asia",
    name: "Asia Workload",
    email: "asia-workload@keduoduo.com",
    role: "admin",
    teamId: "asia",
    status: "active"
  });

  const nowMs = Date.now();
  const todayRaw = String(nowMs);
  const oldRaw = String(nowMs - 3 * 24 * 60 * 60 * 1000);
  const activitiesBefore = store.customerActivities.length;
  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const wrapupBefore = store.callWrapupAudits.length;
  const editBefore = store.callWrapupEditAudits.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  const workloadBefore = store.callWorkloadViewAudits.length;

  const allowed = (id: string, teamId = "europe"): OutboundCallAudit => ({
    id,
    teamId,
    actorId: shirleyUser.id,
    at: new Date(nowMs).toISOString(),
    targetType: "customer",
    targetId: "c1",
    phoneId: "p_wl",
    maskedNumber: "138****9999",
    result: "allowed",
    reason: "",
    jobId: id
  });
  store.outboundCallAudits.push(
    allowed("oca_wl_a"),
    allowed("oca_wl_b"),
    {
      ...allowed("oca_wl_rejected"),
      result: "rejected",
      reason: "suppressed",
      jobId: ""
    },
    allowed("oca_wl_asia", "asia")
  );
  store.aliyunAgentMappings.push(
    {
      id: "map_wl_shirley",
      teamId: "europe",
      crmUserId: shirleyUser.id,
      cccUserId: "agent@ccc-wl-a",
      loginName: "shirley-wl",
      displayName: "Shirley负荷",
      extension: "8301",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_wl_mia",
      teamId: "europe",
      crmUserId: miaUser.id,
      cccUserId: "agent@ccc-wl-b",
      loginName: "mia-wl",
      displayName: "Mia负荷",
      extension: "8302",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    }
  );
  store.outboundCallRecords.push(
    record({ id: "ocr_wl_done", agentIds: "agent@ccc-wl-a", outboundCallAuditId: "oca_wl_a", establishedTimeRaw: "1", callDurationRaw: "10", releaseTimeRaw: todayRaw, startTimeRaw: todayRaw, callNote: "" }),
    record({ id: "ocr_wl_pending", agentIds: "agent@ccc-wl-a", outboundCallAuditId: "oca_wl_a", establishedTimeRaw: "1", callDurationRaw: "nope", releaseTimeRaw: todayRaw, startTimeRaw: todayRaw, callNote: "" }),
    record({ id: "ocr_wl_skip", agentIds: "agent@ccc-wl-a", outboundCallAuditId: "oca_wl_a", callDurationRaw: "3", releaseTimeRaw: todayRaw, startTimeRaw: todayRaw, callNote: "" }),
    record({ id: "ocr_wl_open", agentIds: "agent@ccc-wl-a", outboundCallAuditId: "oca_wl_a", establishedTimeRaw: "1", callDurationRaw: "5", releaseTimeRaw: "", startTimeRaw: todayRaw, callNote: "" }),
    record({ id: "ocr_wl_multi", agentIds: "agent@ccc-wl-a,agent@ccc-wl-b", outboundCallAuditId: "oca_wl_a", establishedTimeRaw: "1", callDurationRaw: "4", releaseTimeRaw: todayRaw, startTimeRaw: todayRaw, callNote: "" }),
    record({ id: "ocr_wl_noclick", agentIds: "agent@ccc-wl-a", outboundCallAuditId: "", establishedTimeRaw: "1", callDurationRaw: "100", releaseTimeRaw: todayRaw, startTimeRaw: todayRaw, callNote: "" }),
    record({ id: "ocr_wl_rejected", agentIds: "agent@ccc-wl-a", outboundCallAuditId: "oca_wl_rejected", establishedTimeRaw: "1", callDurationRaw: "100", releaseTimeRaw: todayRaw, startTimeRaw: todayRaw, callNote: "" }),
    record({ id: "ocr_wl_old", agentIds: "agent@ccc-wl-a", outboundCallAuditId: "oca_wl_a", establishedTimeRaw: "1", callDurationRaw: "50", releaseTimeRaw: oldRaw, startTimeRaw: oldRaw, callNote: "" }),
    record({ id: "ocr_wl_mia", agentIds: "agent@ccc-wl-b", outboundCallAuditId: "oca_wl_b", establishedTimeRaw: "1", callDurationRaw: "20", releaseTimeRaw: todayRaw, startTimeRaw: todayRaw, callNote: "" }),
    record({ id: "ocr_wl_blank", agentIds: "", outboundCallAuditId: "oca_wl_a", establishedTimeRaw: "1", callDurationRaw: "", releaseTimeRaw: todayRaw, startTimeRaw: todayRaw, callNote: "" }),
    record({ id: "ocr_wl_asia", teamId: "asia", agentIds: "agent@ccc-wl-asia", outboundCallAuditId: "oca_wl_asia", establishedTimeRaw: "1", callDurationRaw: "9", releaseTimeRaw: todayRaw, startTimeRaw: todayRaw, callNote: "亚洲纪要不要出现" })
  );
  const wrap = (partial: Partial<CallWrapupAudit> & Pick<CallWrapupAudit, "id" | "callRecordId">): CallWrapupAudit => ({
    teamId: "europe",
    actorId: shirleyUser.id,
    at: new Date(nowMs).toISOString(),
    action: "submit",
    parts: "",
    addedTagIds: "[]",
    removedTagIds: "[]",
    result: "updated",
    reason: "",
    ...partial
  });
  store.callWrapupAudits.push(
    wrap({ id: "cwa_wl_done", callRecordId: "ocr_wl_done" }),
    wrap({ id: "cwa_wl_rejected", callRecordId: "ocr_wl_pending", result: "rejected", reason: "forbidden" })
  );
  const skip: CallWrapupSkip = {
    id: "cws_wl_skip",
    teamId: "europe",
    actorId: shirleyUser.id,
    at: new Date(nowMs).toISOString(),
    callRecordId: "ocr_wl_skip",
    reason: "missed",
    active: true
  };
  store.callWrapupSkips.push(skip);
  const edit = (partial: Partial<CallWrapupEditAudit> & Pick<CallWrapupEditAudit, "id" | "callRecordId">): CallWrapupEditAudit => ({
    teamId: "europe",
    actorId: shirleyUser.id,
    at: new Date(nowMs).toISOString(),
    beforeJson: "{\"note\":\"改正前不要出现\"}",
    afterJson: "{\"note\":\"改正后不要出现\"}",
    result: "updated",
    reason: "",
    ...partial
  });
  store.callWrapupEditAudits.push(
    edit({ id: "cwe_wl_today", callRecordId: "ocr_wl_old" }),
    edit({ id: "cwe_wl_rejected", callRecordId: "ocr_wl_done", result: "rejected", reason: "window_closed" })
  );

  const shirley = await login("shirley@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const asia = await login("asia-workload@keduoduo.com");

  const anonymous = await request("/api/call-workload?scope=self", "");
  assert.equal(anonymous.response.status, 401);
  assert.equal(store.callWorkloadViewAudits.length, workloadBefore);

  const bad = await request("/api/call-workload", alex);
  assert.equal(bad.response.status, 400);
  assert.equal(bad.json.reason, "invalid_request");
  const extra = await request("/api/call-workload?scope=team&plaintext=1", alex);
  assert.equal(extra.response.status, 400);
  assert.equal(store.callWorkloadViewAudits.length, workloadBefore);

  const self = await request("/api/call-workload?scope=self", shirley);
  assert.equal(self.response.status, 200);
  assert.equal(self.json.scope, "self");
  assert.equal(self.json.timeZone, "Asia/Shanghai");
  assert.equal(self.json.unmapped, false);
  assert.equal(self.json.criteria.callsBy, "humanClickedCallRecord");
  assert.equal(self.json.criteria.talkTimeField, "callDurationRaw");
  const mine = self.json.rows.find((item: { agentId: string }) => item.agentId === "agent@ccc-wl-a");
  assert.ok(mine);
  assert.equal(mine.label, "Shirley负荷");
  assert.equal(mine.callsMade, 5);
  assert.equal(mine.wrapupCompleted, 1);
  assert.equal(mine.wrapupPending, 2);
  assert.equal(mine.wrapupSkipped, 1);
  assert.equal(mine.correctionsMade, 1);
  assert.equal(mine.talkTimeSeconds, 19);
  assert.equal(self.json.rows.some((item: { agentId: string }) => item.agentId === "agent@ccc-wl-b"), false);
  assert.equal(store.callWorkloadViewAudits.length, workloadBefore);
  assert.equal(self.text.includes("13800139999"), false);
  assert.equal(self.text.includes("do-not-leak-workload"), false);
  assert.equal(self.text.includes("纪要不要出现"), false);
  assert.equal(self.text.includes("改正前不要出现"), false);
  assert.equal(self.text.includes("亚洲纪要不要出现"), false);
  assert.equal(self.text.includes("接通率"), false);

  const salesTeam = await request("/api/call-workload?scope=team", shirley);
  assert.equal(salesTeam.response.status, 403);
  assert.equal(salesTeam.json.reason, "forbidden");
  assert.equal(salesTeam.json.rows, undefined);
  assert.equal(store.callWorkloadViewAudits.some((item) => item.actorId === shirleyUser.id && item.scope === "team" && item.result === "rejected" && item.reason === "forbidden" && item.rowCount === 0), true);

  const team = await request("/api/call-workload?scope=team", alex);
  assert.equal(team.response.status, 200);
  assert.equal(team.json.scope, "team");
  const teamMine = team.json.rows.find((item: { agentId: string }) => item.agentId === "agent@ccc-wl-a");
  const teamMia = team.json.rows.find((item: { agentId: string }) => item.agentId === "agent@ccc-wl-b");
  assert.equal(teamMine.callsMade, 5);
  assert.equal(teamMine.talkTimeSeconds, 19);
  assert.equal(teamMia.callsMade, 2);
  assert.equal(teamMia.wrapupPending, 2);
  assert.equal(teamMia.talkTimeSeconds, 24);
  assert.equal(teamMia.correctionsMade, 0);
  assert.equal(team.json.rows.some((item: { agentId: string }) => item.agentId === "none"), false);
  assert.equal(team.json.rows.some((item: { agentId: string }) => item.agentId === "agent@ccc-wl-asia"), false);
  const readAudit = store.callWorkloadViewAudits.find((item) => item.actorId === alexUser.id && item.result === "read");
  assert.ok(readAudit);
  assert.equal(readAudit.scope, "team");
  assert.equal(readAudit.rowCount, team.json.rows.length);
  assert.equal(readAudit.action, "read");

  const again = await request("/api/call-workload?scope=team", alex);
  assert.equal(again.response.status, 200);
  assert.equal(store.callWorkloadViewAudits.filter((item) => item.actorId === alexUser.id && item.result === "read").length, 2);

  const hiddenAgent = await request("/api/call-workload?scope=team&agentId=agent@ccc-wl-asia", alex);
  assert.equal(hiddenAgent.response.status, 403);
  assert.equal(hiddenAgent.json.rows, undefined);
  assert.equal(store.callWorkloadViewAudits.some((item) => item.actorId === alexUser.id && item.agentId === "agent@ccc-wl-asia" && item.result === "rejected"), true);

  const adminTeam = await request("/api/call-workload?scope=team&agentId=none", admin);
  assert.equal(adminTeam.response.status, 200);
  assert.equal(adminTeam.json.rows.length, 1);
  assert.equal(adminTeam.json.rows[0].agentId, "none");
  assert.equal(adminTeam.json.rows[0].label, "未分配坐席");
  assert.equal(adminTeam.json.rows[0].callsMade, 1);
  assert.equal(adminTeam.json.rows[0].wrapupPending, 1);
  assert.equal(adminTeam.json.rows[0].talkTimeSeconds, null);

  const adminSelf = await request("/api/call-workload?scope=self", admin);
  assert.equal(adminSelf.response.status, 200);
  assert.equal(adminSelf.json.unmapped, true);
  assert.equal(adminSelf.json.rows.length, 0);
  assert.equal(store.callWorkloadViewAudits.some((item) => item.actorId === adminUser.id && item.scope === "team" && item.agentId === "none" && item.result === "read"), true);
  assert.equal(store.callWorkloadViewAudits.some((item) => item.actorId === adminUser.id && item.scope === "team" && item.result === "read" && item.agentId === "" && item.rowCount === 0), false);

  const asiaView = await request("/api/call-workload?scope=team", asia);
  assert.equal(asiaView.response.status, 200);
  assert.equal(asiaView.json.rows.some((item: { agentId: string }) => item.agentId === "agent@ccc-wl-a"), false);
  assert.equal(asiaView.text.includes("Shirley负荷"), false);
  assert.equal(asiaView.json.rows.some((item: { callsMade: number; agentId: string }) => item.agentId === "agent@ccc-wl-asia" && item.callsMade === 1), true);

  assert.equal(aliyunHits, 0);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore + 4);
  assert.equal(store.callWrapupAudits.length, wrapupBefore + 2);
  assert.equal(store.callWrapupEditAudits.length, editBefore + 2);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  const auditText = JSON.stringify(store.callWorkloadViewAudits);
  assert.equal(auditText.includes("13800139999"), false);
  assert.equal(auditText.includes("do-not-leak-workload"), false);
  assert.equal(auditText.includes("纪要不要出现"), false);
  assert.equal(auditText.includes("改正前不要出现"), false);
  assert.equal(auditText.includes("AccessKey"), false);

  console.log("call workload http tests passed");
} finally {
  const store = getStore();
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_wl_"));
  store.outboundCallAudits = store.outboundCallAudits.filter((item) => !item.id.startsWith("oca_wl_"));
  store.callWrapupAudits = store.callWrapupAudits.filter((item) => !item.id.startsWith("cwa_wl_"));
  store.callWrapupSkips = store.callWrapupSkips.filter((item) => !item.id.startsWith("cws_wl_"));
  store.callWrapupEditAudits = store.callWrapupEditAudits.filter((item) => !item.id.startsWith("cwe_wl_"));
  store.callWorkloadViewAudits = store.callWorkloadViewAudits.filter((item) => item.agentId !== "agent@ccc-wl-asia" && !String(item.id || "").startsWith("cwva_"));
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_wl_"));
  store.users = store.users.filter((item) => item.id !== "u_workload_asia");
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
