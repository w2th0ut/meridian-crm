import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setTenantTimezoneOverride } from "./outbound-call.js";
import type { OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start outbound call record test server");
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

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "agentIds" | "establishedTimeRaw" | "callDurationRaw" | "startTimeRaw">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    targetType: "customer",
    targetId: "c1",
    maskedNumber: "*******2333",
    contactType: "OUTBOUND",
    contactDisposition: "",
    earlyMediaState: "",
    releaseTimeRaw: "",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/do-not-leak-recording",
    recordingDurationRaw: "999",
    followUpActivityId: "",
    callOutcome: "",
    callOutcomeNote: "",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  assert.ok(shirleyUser && miaUser);
  store.users.push({
    ...shirleyUser,
    id: "u_no_call_read",
    name: "No Call Read",
    email: "no-call-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_no_call_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };

  const configBefore = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe");
  const enabledBefore = configBefore?.aliyunOutboundEnabled === true;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const auditsBefore = store.outboundCallAudits.length;
  const recordsBefore = store.outboundCallRecords.length;

  const boundary = String(Date.parse("2026-10-31T16:30:00.000Z"));
  const october = String(Date.parse("2026-10-01T04:00:00.000Z"));
  const april = String(Date.parse("2026-04-04T04:00:00.000Z"));
  const aprilFifth = String(Date.parse("2026-04-05T04:00:00.000Z"));
  const march = String(Date.parse("2026-03-03T04:00:00.000Z"));
  const added = [
    record({ id: "ocr_stat_boundary", agentIds: "agent@ccc-a", establishedTimeRaw: "1", callDurationRaw: "10", startTimeRaw: boundary }),
    record({ id: "ocr_stat_success_only", agentIds: "agent@ccc-a", establishedTimeRaw: "", callDurationRaw: "99", contactDisposition: "Success", startTimeRaw: boundary }),
    record({ id: "ocr_stat_mia", agentIds: "agent@ccc-b", establishedTimeRaw: "1", callDurationRaw: "30", startTimeRaw: boundary }),
    record({ id: "ocr_stat_other", teamId: "other", agentIds: "agent@ccc-a", establishedTimeRaw: "1", callDurationRaw: "1", startTimeRaw: boundary }),
    record({ id: "ocr_stat_unmapped", agentIds: "agent@ccc-z", establishedTimeRaw: "1", callDurationRaw: "5", startTimeRaw: boundary }),
    record({ id: "ocr_stat_noagent", agentIds: "", establishedTimeRaw: "1", callDurationRaw: "4", startTimeRaw: boundary }),
    record({ id: "ocr_stat_badduration", agentIds: "agent@ccc-a", establishedTimeRaw: "1", callDurationRaw: "nope", startTimeRaw: october }),
    record({ id: "ocr_stat_nodate", agentIds: "agent@ccc-a", establishedTimeRaw: "1", callDurationRaw: "8", startTimeRaw: "" }),
    record({ id: "ocr_stat_ten", agentIds: "agent@ccc-a", establishedTimeRaw: "1", callDurationRaw: "10", startTimeRaw: april }),
    record({ id: "ocr_stat_twenty", agentIds: "agent@ccc-a", establishedTimeRaw: "2", callDurationRaw: "20", startTimeRaw: april }),
    record({ id: "ocr_stat_missed", agentIds: "agent@ccc-a", establishedTimeRaw: "", callDurationRaw: "3", startTimeRaw: april }),
    record({ id: "ocr_stat_success_april", agentIds: "agent@ccc-a", establishedTimeRaw: "", callDurationRaw: "8", contactDisposition: "Success", startTimeRaw: april }),
    record({ id: "ocr_stat_fraction", agentIds: "agent@ccc-a", establishedTimeRaw: "3", callDurationRaw: "1.5", startTimeRaw: aprilFifth }),
    record({ id: "ocr_stat_march", agentIds: "agent@ccc-a", establishedTimeRaw: "", callDurationRaw: "50", contactDisposition: "Success", startTimeRaw: march })
  ];
  store.outboundCallRecords.push(...added);
  store.aliyunAgentMappings.push(
    {
      id: "map_stat_shirley",
      teamId: "europe",
      crmUserId: shirleyUser.id,
      cccUserId: "agent@ccc-a",
      loginName: "shirley",
      displayName: "Shirley坐席",
      extension: "8001",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_stat_mia",
      teamId: "europe",
      crmUserId: miaUser.id,
      cccUserId: "agent@ccc-b",
      loginName: "mia",
      displayName: "Mia坐席",
      extension: "8002",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    }
  );
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const noRead = await login("no-call-read@keduoduo.com");

  const denied = await request("/api/outbound-call-records", noRead);
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.permissionCode, "communication.read");

  const anonymous = await request("/api/outbound-call-records", "");
  assert.equal(anonymous.response.status, 401);

  const own = await request("/api/outbound-call-records", shirley);
  assert.equal(own.response.status, 200);
  assert.equal(own.json.scope, "self");
  assert.equal(own.json.timeZone, "Asia/Shanghai");
  assert.equal(own.json.empty, false);
  assert.equal(own.json.criteria.connectedBy, "establishedTimeRaw");
  assert.equal(own.json.criteria.durationUnit, "seconds");
  assert.equal(own.json.criteria.durationField, "callDurationRaw");
  assert.equal(own.json.criteria.dateField, "startTimeRaw");
  assert.deepEqual(own.json.stats, {
    totalCalls: 10,
    connectedCalls: 6,
    connectRate: 6 / 10,
    averageConnectedDurationSeconds: (10 + 8 + 10 + 20) / 4
  });
  assert.deepEqual(
    own.json.records.map((item: { id: string }) => item.id).sort(),
    [
      "ocr_stat_boundary",
      "ocr_stat_success_only",
      "ocr_stat_badduration",
      "ocr_stat_nodate",
      "ocr_stat_ten",
      "ocr_stat_twenty",
      "ocr_stat_missed",
      "ocr_stat_success_april",
      "ocr_stat_fraction",
      "ocr_stat_march"
    ].sort()
  );
  assert.equal(own.json.records.some((item: { id: string }) => item.id === "ocr_stat_mia"), false);
  assert.equal(JSON.stringify(own.json).includes("do-not-leak-recording"), false);
  assert.equal(JSON.stringify(own.json).includes("AccessKey"), false);
  assert.deepEqual(own.json.agents.map((item: { cccUserId: string }) => item.cccUserId), ["agent@ccc-a"]);

  const otherSeat = await request("/api/outbound-call-records?agentId=agent@ccc-b", shirley);
  assert.equal(otherSeat.response.status, 403);
  assert.equal(otherSeat.json.reason, "forbidden");

  const miaView = await request("/api/outbound-call-records", mia);
  assert.equal(miaView.response.status, 200);
  assert.equal(miaView.json.scope, "self");
  assert.deepEqual(miaView.json.records.map((item: { id: string }) => item.id), ["ocr_stat_mia"]);
  assert.equal(miaView.json.stats.totalCalls, 1);
  assert.equal(miaView.json.stats.connectedCalls, 1);
  assert.equal(miaView.json.stats.connectRate, 1);
  assert.equal(miaView.json.stats.averageConnectedDurationSeconds, 30);

  const team = await request("/api/outbound-call-records", alex);
  assert.equal(team.response.status, 200);
  assert.equal(team.json.scope, "team");
  assert.equal(team.json.stats.totalCalls, 11);
  assert.equal(team.json.stats.connectedCalls, 7);
  assert.equal(team.json.stats.connectRate, 7 / 11);
  assert.equal(team.json.stats.averageConnectedDurationSeconds, (10 + 8 + 10 + 20 + 30) / 5);
  assert.equal(team.json.records.some((item: { id: string }) => item.id === "ocr_stat_unmapped" || item.id === "ocr_stat_noagent" || item.id === "ocr_stat_other"), false);
  const teamAgentIds = team.json.agents.map((item: { cccUserId: string }) => item.cccUserId).sort();
  assert.deepEqual(teamAgentIds, ["agent@ccc-a", "agent@ccc-b"]);

  const oneAgent = await request("/api/outbound-call-records?agentId=agent%40ccc-a", alex);
  assert.equal(oneAgent.response.status, 200);
  assert.equal(oneAgent.json.records.some((item: { id: string }) => item.id === "ocr_stat_mia"), false);
  assert.equal(oneAgent.json.records.some((item: { id: string }) => item.id === "ocr_stat_ten"), true);
  assert.equal(oneAgent.json.stats.totalCalls, 10);

  const outside = await request("/api/outbound-call-records?agentId=agent@ccc-z", alex);
  assert.equal(outside.response.status, 403);

  const all = await request("/api/outbound-call-records", admin);
  assert.equal(all.response.status, 200);
  assert.equal(all.json.scope, "team");
  assert.equal(all.json.stats.totalCalls, 13);
  assert.equal(all.json.stats.connectedCalls, 9);
  assert.equal(all.json.stats.averageConnectedDurationSeconds, (10 + 8 + 10 + 20 + 30 + 5 + 4) / 7);
  assert.equal(all.json.records.some((item: { id: string }) => item.id === "ocr_stat_other"), false);
  assert.equal(all.json.records.some((item: { id: string }) => item.id === "ocr_stat_noagent"), true);

  const aprilPage = await request("/api/outbound-call-records?from=2026-04-04&to=2026-04-04", shirley);
  assert.equal(aprilPage.response.status, 200);
  assert.equal(aprilPage.json.empty, false);
  assert.deepEqual(aprilPage.json.stats, {
    totalCalls: 4,
    connectedCalls: 2,
    connectRate: 0.5,
    averageConnectedDurationSeconds: 15
  });
  assert.equal(aprilPage.json.records.find((item: { id: string }) => item.id === "ocr_stat_success_april").established, false);
  assert.equal(aprilPage.json.records.find((item: { id: string }) => item.id === "ocr_stat_success_april").contactDisposition, "Success");

  const fractional = await request("/api/outbound-call-records?from=2026-04-05&to=2026-04-05", shirley);
  assert.equal(fractional.json.stats.totalCalls, 1);
  assert.equal(fractional.json.stats.connectedCalls, 1);
  assert.equal(fractional.json.stats.connectRate, 1);
  assert.equal(fractional.json.stats.averageConnectedDurationSeconds, null);

  const unanswered = await request("/api/outbound-call-records?from=2026-03-03&to=2026-03-03", shirley);
  assert.equal(unanswered.json.empty, false);
  assert.equal(unanswered.json.stats.totalCalls, 1);
  assert.equal(unanswered.json.stats.connectedCalls, 0);
  assert.equal(unanswered.json.stats.connectRate, 0);
  assert.equal(unanswered.json.stats.averageConnectedDurationSeconds, null);

  const shanghai = await request("/api/outbound-call-records?from=2026-11-01&to=2026-11-01", shirley);
  assert.deepEqual(shanghai.json.records.map((item: { id: string }) => item.id).sort(), ["ocr_stat_boundary", "ocr_stat_success_only"].sort());
  assert.equal(shanghai.json.stats.connectedCalls, 1);
  assert.equal(shanghai.json.stats.averageConnectedDurationSeconds, 10);

  setTenantTimezoneOverride(store, "europe", "America/New_York");
  const newYorkMiss = await request("/api/outbound-call-records?from=2026-11-01&to=2026-11-01", shirley);
  assert.equal(newYorkMiss.response.status, 200);
  assert.equal(newYorkMiss.json.timeZone, "America/New_York");
  assert.equal(newYorkMiss.json.empty, true);
  assert.equal(newYorkMiss.json.stats, null);
  assert.deepEqual(newYorkMiss.json.records, []);

  const newYorkHit = await request("/api/outbound-call-records?from=2026-10-31&to=2026-10-31", shirley);
  assert.deepEqual(newYorkHit.json.records.map((item: { id: string }) => item.id).sort(), ["ocr_stat_boundary", "ocr_stat_success_only"].sort());

  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  const blank = await request("/api/outbound-call-records?from=1999-01-01&to=1999-01-02", shirley);
  assert.equal(blank.json.empty, true);
  assert.equal(blank.json.stats, null);
  assert.deepEqual(blank.json.records, []);

  const badDate = await request("/api/outbound-call-records?from=2026-13-01", shirley);
  assert.equal(badDate.response.status, 400);
  assert.equal(badDate.json.reason, "invalid_request");
  const reversed = await request("/api/outbound-call-records?from=2026-11-02&to=2026-11-01", shirley);
  assert.equal(reversed.response.status, 400);

  const posted = await request("/api/outbound-call-records", shirley, "POST", { totalCalls: 99 });
  assert.equal(posted.response.status, 404);

  assert.equal(aliyunHits, 0);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outboundCallAudits.length, auditsBefore);
  assert.equal(store.outboundCallRecords.length, recordsBefore + added.length);
  const configAfter = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe");
  assert.equal(configAfter?.aliyunOutboundEnabled === true, enabledBefore);
  assert.equal(JSON.stringify(store.outboundCallRecords).includes("aliyuncs.com"), false);

  console.log("outbound call record http tests passed");
} finally {
  const store = getStore();
  setTenantTimezoneOverride(store, "europe", undefined);
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_stat_"));
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_stat_"));
  store.users = store.users.filter((item) => item.id !== "u_no_call_read");
  globalThis.fetch = originalFetch;
  server.close();
}
