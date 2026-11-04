import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { AgentWorkStatusLog } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start agent work status timeout disposition test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

async function request(path: string, token: string, body?: unknown) {
  const response = await originalFetch(`${baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const type = response.headers.get("content-type") || "";
  const json = type.includes("json") && text ? JSON.parse(text) as Record<string, any> : {};
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

function log(partial: Partial<AgentWorkStatusLog> & Pick<AgentWorkStatusLog, "id" | "at" | "status">): AgentWorkStatusLog {
  return {
    teamId: "europe",
    agentId: "agent@ccc-disp-a",
    crmUserId: "",
    actorId: "",
    reason: "",
    source: "self",
    ...partial
  };
}

try {
  const store = getStore();
  setOutboundNowForTests(new Date("2026-11-04T02:30:00.000Z"));
  setTenantTimezoneOverride(store, "europe", "America/New_York");
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const alexUser = store.users.find((item) => item.email === "alex@keduoduo.com");
  const adminUser = store.users.find((item) => item.email === "admin@keduoduo.com");
  assert.ok(shirleyUser && alexUser && adminUser);
  assert.equal(shirleyUser.role, "sales");
  assert.equal(alexUser.role, "manager");
  store.users.push({
    ...adminUser,
    id: "u_status_disposition_asia",
    name: "Asia Status Disposition",
    email: "asia-status-disposition@keduoduo.com",
    role: "admin",
    teamId: "asia",
    status: "active"
  });
  store.aliyunAgentMappings.push({
    id: "map_disp_shirley",
    teamId: "europe",
    crmUserId: shirleyUser.id,
    cccUserId: "agent@ccc-disp-a",
    loginName: "shirley-disp",
    displayName: "Shirley处置<script>",
    extension: "8602",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  });
  const leadsBefore = store.leads.length;
  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions);
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  const logsBefore = store.agentWorkStatusLogs.length;
  const statusAuditsBefore = store.agentWorkStatusAudits.length;
  const timeoutAuditsBefore = store.agentWorkStatusTimeoutAudits.length;
  const logs: AgentWorkStatusLog[] = [
    log({ id: "awsl_disp_break", at: "2026-11-04T02:00:00.000Z", status: "break", reason: "=小休", crmUserId: shirleyUser.id, actorId: shirleyUser.id }),
    log({ id: "awsl_disp_short", agentId: "agent@ccc-disp-short", at: "2026-11-04T02:25:00.000Z", status: "busy" }),
    log({ id: "awsl_disp_asia", teamId: "asia", agentId: "agent@ccc-disp-asia", at: "2026-11-04T01:00:00.000Z", status: "break", reason: "亚洲原因不要出现" })
  ];
  store.agentWorkStatusLogs.unshift(...logs);
  store.agentWorkStatusTimeouts.unshift({
    id: "awst_disp_break",
    teamId: "europe",
    status: "break",
    thresholdSeconds: 900,
    updatedBy: alexUser.id,
    updatedAt: "2026-11-04T02:00:00.000Z"
  });
  if (!store.agentWorkStatusTimeoutDispositionAudits) store.agentWorkStatusTimeoutDispositionAudits = [];

  const shirley = await login("shirley@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const asia = await login("asia-status-disposition@keduoduo.com");

  const anonymous = await request("/api/agent-work-status-timeout-dispositions", "");
  assert.equal(anonymous.response.status, 401);
  const anonymousSave = await request("/api/agent-work-status-timeout-dispositions", "", { agentId: "agent@ccc-disp-a", disposition: "reminded" });
  assert.equal(anonymousSave.response.status, 401);
  assert.equal(store.agentWorkStatusTimeoutDispositionAudits.length, 0);

  const bad = await request("/api/agent-work-status-timeout-dispositions?from=2026-11-05&to=2026-11-04", alex);
  assert.equal(bad.response.status, 400);
  const extra = await request("/api/agent-work-status-timeout-dispositions?plaintext=1", alex);
  assert.equal(extra.response.status, 400);
  assert.equal(store.agentWorkStatusTimeoutDispositionAudits.length, 0);

  const denied = await request("/api/agent-work-status-timeout-dispositions", shirley);
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.rows, undefined);
  const deniedSave = await request("/api/agent-work-status-timeout-dispositions", shirley, {
    agentId: "agent@ccc-disp-a",
    disposition: "reminded",
    note: "机密备注不要进拒绝审计"
  });
  assert.equal(deniedSave.response.status, 403);
  assert.equal(JSON.stringify(deniedSave.json).includes("机密备注"), false);
  assert.equal(store.agentWorkStatusTimeoutDispositionAudits.some((item) => item.actorId === shirleyUser.id && item.result === "rejected" && item.note === ""), true);

  const badBody = await request("/api/agent-work-status-timeout-dispositions", alex, { agentId: "agent@ccc-disp-a", disposition: "noted" });
  assert.equal(badBody.response.status, 400);
  const badStatus = await request("/api/agent-work-status-timeout-dispositions", alex, { agentId: "agent@ccc-disp-a", disposition: "available" });
  assert.equal(badStatus.response.status, 400);
  assert.equal(store.agentWorkStatusTimeoutDispositionAudits.filter((item) => item.actorId === alexUser.id).length, 0);

  const notTimeout = await request("/api/agent-work-status-timeout-dispositions", alex, { agentId: "agent@ccc-disp-short", disposition: "reminded" });
  assert.equal(notTimeout.response.status, 400);
  assert.equal(notTimeout.json.reason, "not_timeout");
  const otherTeam = await request("/api/agent-work-status-timeout-dispositions", alex, { agentId: "agent@ccc-disp-asia", disposition: "reminded" });
  assert.equal(otherTeam.response.status, 400);
  assert.equal(otherTeam.json.reason, "not_timeout");

  const created = await request("/api/agent-work-status-timeout-dispositions", alex, {
    agentId: "agent@ccc-disp-a",
    disposition: "reminded",
    note: "已提醒"
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.json.result, "recorded");
  assert.equal(created.json.logId, "awsl_disp_break");
  assert.equal(created.json.elapsedSeconds, 1800);
  const same = await request("/api/agent-work-status-timeout-dispositions", alex, {
    agentId: "agent@ccc-disp-a",
    disposition: "reminded",
    note: "已提醒"
  });
  assert.equal(same.json.result, "unchanged");
  assert.equal(store.agentWorkStatusTimeoutDispositionAudits.filter((item) => item.result === "recorded").length, 1);

  const noted = await request("/api/agent-work-status-timeout-dispositions", alex, {
    agentId: "agent@ccc-disp-a",
    disposition: "noted",
    note: "=备注<script>"
  });
  assert.equal(noted.json.result, "recorded");

  const viewed = await request("/api/agent-work-status-timeout-dispositions?from=2026-11-04&to=2026-11-04", alex);
  assert.equal(viewed.response.status, 200);
  assert.equal(viewed.json.timeZone, "Asia/Shanghai");
  assert.equal(viewed.json.rowCount, 2);
  assert.equal(viewed.json.rows[0].atText, "2026-11-04 10:30");
  assert.equal(viewed.json.rows[0].label, "Shirley处置<script>");
  assert.equal(viewed.json.rows[0].note, "=备注<script>");
  assert.equal(JSON.stringify(viewed.json).includes("=小休"), false);
  assert.equal(JSON.stringify(viewed.json).includes("亚洲原因不要出现"), false);
  const yesterday = await request("/api/agent-work-status-timeout-dispositions?from=2026-11-03&to=2026-11-03", alex);
  assert.equal(yesterday.json.rowCount, 0);
  const again = await request("/api/agent-work-status-timeout-dispositions?disposition=reminded", alex);
  assert.equal(again.json.rows.length, 1);
  assert.equal(again.json.rows[0].disposition, "reminded");
  assert.equal(store.agentWorkStatusTimeoutDispositionAudits.filter((item) => item.actorId === alexUser.id && item.action === "read" && item.result === "read").length, 3);

  const asiaView = await request("/api/agent-work-status-timeout-dispositions", asia);
  assert.equal(asiaView.response.status, 200);
  assert.equal(asiaView.json.rowCount, 0);
  assert.equal(JSON.stringify(asiaView.json).includes("=备注"), false);
  assert.equal(JSON.stringify(asiaView.json).includes("Shirley"), false);

  assert.equal(aliyunHits, 0);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  assert.equal(store.agentWorkStatusLogs.length, logsBefore + logs.length);
  assert.equal(store.agentWorkStatusAudits.length, statusAuditsBefore);
  assert.equal(store.agentWorkStatusTimeoutAudits.length, timeoutAuditsBefore);
  assert.equal(store.agentWorkStatusTimeouts.filter((item) => item.id === "awst_disp_break").length, 1);
  assert.equal(store.aliyunAgentMappings.find((item) => item.id === "map_disp_shirley")?.workMode, "ON_SITE");
  const auditText = JSON.stringify(store.agentWorkStatusTimeoutDispositionAudits);
  assert.equal(auditText.includes("=小休"), false);
  assert.equal(auditText.includes("亚洲原因不要出现"), false);
  assert.equal(auditText.includes("Shirley处置"), false);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("机密备注不要进拒绝审计"), false);
  assert.equal(auditText.includes("接通率"), false);
  assert.equal(auditText.includes("超时率"), false);

  console.log("agent work status timeout disposition http tests passed");
} finally {
  const store = getStore();
  store.agentWorkStatusLogs = store.agentWorkStatusLogs.filter((item) => !item.id.startsWith("awsl_disp_"));
  store.agentWorkStatusTimeouts = store.agentWorkStatusTimeouts.filter((item) => item.id !== "awst_disp_break");
  store.agentWorkStatusTimeoutDispositionAudits = (store.agentWorkStatusTimeoutDispositionAudits || []).filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_disp_"));
  store.users = store.users.filter((item) => item.id !== "u_status_disposition_asia");
  setTenantTimezoneOverride(store, "europe", undefined);
  setOutboundNowForTests(undefined);
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
