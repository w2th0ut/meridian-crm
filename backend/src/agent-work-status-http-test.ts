import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundNowForTests } from "./outbound-call.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start agent work status test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com") || url.includes("g.alicdn.com")) aliyunHits += 1;
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

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const alexUser = store.users.find((item) => item.email === "alex@keduoduo.com");
  const adminUser = store.users.find((item) => item.email === "admin@keduoduo.com");
  assert.ok(shirleyUser && miaUser && alexUser && adminUser);
  store.users.push({
    ...adminUser,
    id: "u_status_asia",
    name: "Asia Status",
    email: "asia-status@keduoduo.com",
    role: "admin",
    teamId: "asia",
    status: "active"
  });
  store.aliyunAgentMappings.push(
    {
      id: "map_ws_shirley",
      teamId: "europe",
      crmUserId: shirleyUser.id,
      cccUserId: "agent@ccc-ws-a",
      loginName: "shirley-ws",
      displayName: "Shirley状态<script>",
      extension: "8401",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_ws_mia",
      teamId: "europe",
      crmUserId: miaUser.id,
      cccUserId: "agent@ccc-ws-b",
      loginName: "mia-ws",
      displayName: "Mia状态",
      extension: "8402",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    }
  );

  const now = new Date("2026-04-03T16:30:00.000Z");
  setOutboundNowForTests(now);
  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  const workloadBefore = store.callWorkloadViewAudits.length;

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const asia = await login("asia-status@keduoduo.com");

  const anonymous = await request("/api/agent-work-status?scope=self", "");
  assert.equal(anonymous.response.status, 401);
  assert.equal(store.agentWorkStatusLogs.length, 0);
  assert.equal(store.agentWorkStatusAudits.length, 0);

  const bad = await request("/api/agent-work-status", shirley);
  assert.equal(bad.response.status, 400);
  assert.equal(bad.json.reason, "invalid_request");
  const extra = await request("/api/agent-work-status?scope=self&plaintext=1", shirley);
  assert.equal(extra.response.status, 400);

  store.agentWorkStatusLogs.push({
    id: "awsl_seed_yesterday",
    teamId: "europe",
    agentId: "agent@ccc-ws-a",
    crmUserId: shirleyUser.id,
    actorId: shirleyUser.id,
    at: "2026-04-03T15:00:00.000Z",
    status: "available",
    reason: "夜班",
    source: "self"
  }, {
    id: "awsl_seed_busy",
    teamId: "europe",
    agentId: "agent@ccc-ws-a",
    crmUserId: shirleyUser.id,
    actorId: shirleyUser.id,
    at: "2026-04-03T16:10:00.000Z",
    status: "busy",
    reason: "回访",
    source: "self"
  });

  const self = await request("/api/agent-work-status?scope=self", shirley);
  assert.equal(self.response.status, 200);
  assert.equal(self.json.unmapped, false);
  assert.equal(self.json.rows.length, 1);
  assert.equal(self.json.rows[0].status, "busy");
  assert.equal(self.json.rows[0].reason, "回访");
  assert.equal(self.json.rows[0].availableSeconds, 600);
  assert.equal(self.json.rows[0].busySeconds, 1200);
  assert.equal(self.json.rows[0].breakSeconds, 0);
  assert.equal(self.json.rows[0].label, "Shirley状态<script>");
  assert.equal(store.agentWorkStatusAudits.length, 0);
  assert.equal(store.callWorkloadViewAudits.length, workloadBefore);

  const salesTeam = await request("/api/agent-work-status?scope=team", shirley);
  assert.equal(salesTeam.response.status, 403);
  assert.equal(salesTeam.json.reason, "forbidden");
  assert.equal(salesTeam.json.rows, undefined);
  assert.equal(store.agentWorkStatusAudits.length, 0);

  const cloudStatus = await request("/api/agent-work-status", shirley, "POST", { status: "ON_SITE" });
  assert.equal(cloudStatus.response.status, 400);
  assert.equal(store.agentWorkStatusLogs.length, 2);

  const saved = await request("/api/agent-work-status", shirley, "POST", { status: "break", reason: " 午饭 " });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.json.result, "updated");
  assert.equal(saved.json.row.status, "break");
  assert.equal(saved.json.row.reason, "午饭");
  assert.equal(saved.json.row.breakSeconds, 0);
  assert.equal(saved.json.row.availableSeconds, 600);
  assert.equal(saved.json.row.busySeconds, 1200);
  assert.equal(store.agentWorkStatusLogs.filter((item) => item.agentId === "agent@ccc-ws-a" && item.source === "self" && item.status === "break").length, 1);
  assert.equal(store.agentWorkStatusAudits.length, 0);
  assert.equal(store.aliyunAgentMappings.find((item) => item.id === "map_ws_shirley")?.workMode, "ON_SITE");

  const same = await request("/api/agent-work-status", shirley, "POST", { status: "break", reason: "午饭" });
  assert.equal(same.json.result, "unchanged");
  assert.equal(store.agentWorkStatusLogs.filter((item) => item.agentId === "agent@ccc-ws-a").length, 3);

  const miaReset = await request("/api/agent-work-status/reset", mia, "POST", { agentId: "agent@ccc-ws-a", status: "available", reason: "代改" });
  assert.equal(miaReset.response.status, 403);
  assert.equal(miaReset.json.rows, undefined);
  assert.equal(miaReset.text.includes("Shirley状态"), false);
  assert.equal(store.agentWorkStatusLogs.filter((item) => item.agentId === "agent@ccc-ws-a").length, 3);
  assert.equal(store.agentWorkStatusAudits.some((item) => item.actorId === miaUser.id && item.result === "rejected" && item.reasonCode === "forbidden" && item.previousStatus === ""), true);

  const alexReset = await request("/api/agent-work-status/reset", alex, "POST", { agentId: "agent@ccc-ws-a", status: "available", reason: "回来了" });
  assert.equal(alexReset.response.status, 200);
  assert.equal(alexReset.json.result, "updated");
  assert.equal(alexReset.json.row.status, "available");
  const updated = store.agentWorkStatusAudits.find((item) => item.actorId === alexUser.id && item.result === "updated");
  assert.ok(updated);
  assert.equal(updated?.previousStatus, "break");
  assert.equal(updated?.nextStatus, "available");
  assert.equal(updated?.action, "reset");
  assert.equal(store.agentWorkStatusLogs.find((item) => item.actorId === alexUser.id)?.source, "manager");

  const alexSame = await request("/api/agent-work-status/reset", alex, "POST", { agentId: "agent@ccc-ws-a", status: "available", reason: "回来了" });
  assert.equal(alexSame.json.result, "unchanged");
  assert.equal(store.agentWorkStatusAudits.filter((item) => item.actorId === alexUser.id && item.result === "updated").length, 1);

  const hidden = await request("/api/agent-work-status/reset", alex, "POST", { agentId: "agent@ccc-ws-asia", status: "busy" });
  assert.equal(hidden.response.status, 404);
  assert.equal(hidden.json.reason, "not_found");
  const asiaReset = await request("/api/agent-work-status/reset", asia, "POST", { agentId: "agent@ccc-ws-a", status: "busy" });
  assert.equal(asiaReset.response.status, 404);
  assert.equal(asiaReset.text.includes("回访"), false);
  assert.equal(store.agentWorkStatusLogs.some((item) => item.teamId === "asia"), false);

  const team = await request("/api/agent-work-status?scope=team", alex);
  assert.equal(team.response.status, 200);
  const teamMine = team.json.rows.find((item: { agentId: string }) => item.agentId === "agent@ccc-ws-a");
  const teamMia = team.json.rows.find((item: { agentId: string }) => item.agentId === "agent@ccc-ws-b");
  assert.equal(teamMine.status, "available");
  assert.equal(teamMine.availableSeconds, 600);
  assert.equal(teamMia.status, null);
  assert.equal(teamMia.availableSeconds, null);
  assert.equal(team.json.canReset, true);
  assert.equal(store.agentWorkStatusAudits.filter((item) => item.result === "updated").length, 1);

  const workload = await request("/api/call-workload?scope=team", alex);
  assert.equal(workload.response.status, 200);
  const workloadMine = workload.json.rows.find((item: { agentId: string }) => item.agentId === "agent@ccc-ws-a");
  assert.ok(workloadMine);
  assert.equal(workloadMine.workStatus, "available");
  assert.equal(workloadMine.workStatusReason, "回来了");
  assert.equal(workloadMine.availableSeconds, 600);
  assert.equal(workloadMine.busySeconds, 1200);
  assert.equal(workloadMine.breakSeconds, 0);
  assert.equal(workload.json.canResetWorkStatus, true);
  const workloadMia = workload.json.rows.find((item: { agentId: string }) => item.agentId === "agent@ccc-ws-b");
  assert.equal(workloadMia.workStatus, null);
  assert.equal(workloadMia.availableSeconds, null);

  const selfWorkload = await request("/api/call-workload?scope=self", shirley);
  assert.equal(selfWorkload.response.status, 200);
  assert.equal(selfWorkload.json.rows[0].workStatus, "available");
  assert.equal(selfWorkload.json.canResetWorkStatus, false);
  assert.equal(store.callWorkloadViewAudits.some((item) => item.actorId === shirleyUser.id), false);

  const adminSelf = await request("/api/agent-work-status?scope=self", admin);
  assert.equal(adminSelf.response.status, 200);
  assert.equal(adminSelf.json.unmapped, true);
  assert.equal(adminSelf.json.rows.length, 0);

  assert.equal(aliyunHits, 0);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  const auditText = JSON.stringify(store.agentWorkStatusAudits);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("1380013"), false);
  assert.equal(auditText.includes("Shirley状态"), false);

  console.log("agent work status http tests passed");
} finally {
  setOutboundNowForTests(undefined);
  const store = getStore();
  store.agentWorkStatusLogs = store.agentWorkStatusLogs.filter((item) => !item.id.startsWith("awsl_"));
  store.agentWorkStatusAudits = store.agentWorkStatusAudits.filter((item) => !item.id.startsWith("awsa_"));
  store.callWorkloadViewAudits = store.callWorkloadViewAudits.filter((item) => !String(item.id || "").startsWith("cwva_"));
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_ws_"));
  store.users = store.users.filter((item) => item.id !== "u_status_asia");
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
