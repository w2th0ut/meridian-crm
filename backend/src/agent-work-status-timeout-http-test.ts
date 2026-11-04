import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { AgentWorkStatusLog } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start agent work status timeout test server");
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
    agentId: "agent@ccc-wst-a",
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
    id: "u_status_timeout_asia",
    name: "Asia Status Timeout",
    email: "asia-status-timeout@keduoduo.com",
    role: "admin",
    teamId: "asia",
    status: "active"
  });
  store.aliyunAgentMappings.push({
    id: "map_wst_shirley",
    teamId: "europe",
    crmUserId: shirleyUser.id,
    cccUserId: "agent@ccc-wst-a",
    loginName: "shirley-wst",
    displayName: "Shirley超时<script>",
    extension: "8601",
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
  const logs: AgentWorkStatusLog[] = [
    log({ id: "awsl_wst_break", at: "2026-11-04T02:00:00.000Z", status: "break", reason: "=小休", crmUserId: shirleyUser.id, actorId: shirleyUser.id }),
    log({ id: "awsl_wst_short", agentId: "agent@ccc-wst-short", at: "2026-11-04T02:25:00.000Z", status: "busy" }),
    log({ id: "awsl_wst_ready", agentId: "agent@ccc-wst-ready", at: "2026-11-03T16:00:00.000Z", status: "available" }),
    log({ id: "awsl_wst_asia", teamId: "asia", agentId: "agent@ccc-wst-asia", at: "2026-11-04T01:00:00.000Z", status: "break", reason: "亚洲原因不要出现" })
  ];
  store.agentWorkStatusLogs.unshift(...logs);

  const shirley = await login("shirley@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const asia = await login("asia-status-timeout@keduoduo.com");

  const anonymous = await request("/api/agent-work-status-timeouts", "");
  assert.equal(anonymous.response.status, 401);
  assert.equal(store.agentWorkStatusTimeoutAudits.length, 0);

  const bad = await request("/api/agent-work-status-timeouts?status=available", alex);
  assert.equal(bad.response.status, 400);
  assert.equal(bad.json.reason, "invalid_request");
  const extra = await request("/api/agent-work-status-timeouts?plaintext=1", alex);
  assert.equal(extra.response.status, 400);
  assert.equal(store.agentWorkStatusTimeoutAudits.length, 0);

  const denied = await request("/api/agent-work-status-timeouts", shirley);
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.reason, "forbidden");
  assert.equal(denied.json.rows, undefined);
  assert.equal(denied.json.thresholds, undefined);
  assert.equal(store.agentWorkStatusTimeoutAudits.some((item) => item.actorId === shirleyUser.id && item.action === "read" && item.result === "rejected"), true);

  const deniedSave = await request("/api/agent-work-status-timeouts", shirley, { status: "break", thresholdSeconds: 900 });
  assert.equal(deniedSave.response.status, 403);
  assert.equal(store.agentWorkStatusTimeouts.some((item) => item.teamId === "europe"), false);
  assert.equal(store.agentWorkStatusTimeoutAudits.some((item) => item.actorId === shirleyUser.id && item.action === "set" && item.result === "rejected"), true);

  const badBody = await request("/api/agent-work-status-timeouts", alex, { status: "break", thresholdSeconds: 59 });
  assert.equal(badBody.response.status, 400);
  const badStatus = await request("/api/agent-work-status-timeouts", alex, { status: "available", thresholdSeconds: 900 });
  assert.equal(badStatus.response.status, 400);
  const badString = await request("/api/agent-work-status-timeouts", alex, { status: "break", thresholdSeconds: "900" });
  assert.equal(badString.response.status, 400);
  assert.equal(store.agentWorkStatusTimeouts.length, 0);
  assert.equal(store.agentWorkStatusTimeoutAudits.filter((item) => item.actorId === alexUser.id).length, 0);

  const empty = await request("/api/agent-work-status-timeouts", alex);
  assert.equal(empty.response.status, 200);
  assert.equal(empty.json.thresholds.break, null);
  assert.equal(empty.json.thresholds.busy, null);
  assert.equal(empty.json.rowCount, 0);
  assert.deepEqual(empty.json.rows, []);
  assert.equal(empty.json.timeZone, "Asia/Shanghai");

  const created = await request("/api/agent-work-status-timeouts", alex, { status: "break", thresholdSeconds: 900 });
  assert.equal(created.response.status, 200);
  assert.equal(created.json.result, "updated");
  assert.equal(store.agentWorkStatusTimeouts.filter((item) => item.teamId === "europe" && item.status === "break").length, 1);

  const same = await request("/api/agent-work-status-timeouts", alex, { status: "break", thresholdSeconds: 900 });
  assert.equal(same.json.result, "unchanged");
  assert.equal(store.agentWorkStatusTimeoutAudits.filter((item) => item.actorId === alexUser.id && item.action === "set").length, 1);

  const viewed = await request("/api/agent-work-status-timeouts", alex);
  assert.equal(viewed.response.status, 200);
  assert.equal(viewed.json.rows.length, 1);
  assert.equal(viewed.json.rows[0].agentId, "agent@ccc-wst-a");
  assert.equal(viewed.json.rows[0].elapsedSeconds, 1800);
  assert.equal(viewed.json.rows[0].sinceText, "2026-11-04 10:00");
  assert.equal(viewed.json.rows[0].label, "Shirley超时<script>");
  assert.equal(viewed.json.rows[0].reason, "=小休");
  assert.equal(viewed.json.rows.some((row: { agentId?: string }) => row.agentId === "agent@ccc-wst-short"), false);
  assert.equal(viewed.json.rows.some((row: { agentId?: string }) => row.agentId === "agent@ccc-wst-ready"), false);
  assert.equal(JSON.stringify(viewed.json).includes("亚洲原因不要出现"), false);
  assert.equal(store.agentWorkStatusTimeoutAudits.filter((item) => item.actorId === alexUser.id && item.action === "read" && item.result === "read").length, 2);

  const busy = await request("/api/agent-work-status-timeouts", alex, { status: "busy", thresholdSeconds: 60 });
  assert.equal(busy.json.result, "updated");
  const both = await request("/api/agent-work-status-timeouts?status=busy", alex);
  assert.equal(both.json.thresholds.break, 900);
  assert.equal(both.json.thresholds.busy, 60);
  assert.equal(both.json.rows.length, 1);
  assert.equal(both.json.rows[0].agentId, "agent@ccc-wst-short");

  const asiaView = await request("/api/agent-work-status-timeouts", asia);
  assert.equal(asiaView.response.status, 200);
  assert.equal(asiaView.json.thresholds.break, null);
  assert.deepEqual(asiaView.json.rows, []);
  assert.equal(JSON.stringify(asiaView.json).includes("=小休"), false);
  assert.equal(JSON.stringify(asiaView.json).includes("亚洲原因不要出现"), false);
  assert.equal(JSON.stringify(viewed.json).includes("亚洲原因不要出现"), false);

  const cleared = await request("/api/agent-work-status-timeouts", alex, { status: "break", thresholdSeconds: null });
  assert.equal(cleared.json.result, "cleared");
  assert.equal(store.agentWorkStatusTimeouts.some((item) => item.teamId === "europe" && item.status === "break"), false);
  const clearAgain = await request("/api/agent-work-status-timeouts", alex, { status: "break", thresholdSeconds: null });
  assert.equal(clearAgain.response.status, 400);
  assert.equal(clearAgain.json.reason, "not_set");
  assert.equal(store.agentWorkStatusTimeoutAudits.filter((item) => item.actorId === alexUser.id && item.action === "clear" && item.result === "cleared").length, 1);

  const after = await request("/api/agent-work-status-timeouts", alex);
  assert.equal(after.json.rows.some((row: { agentId?: string }) => row.agentId === "agent@ccc-wst-a"), false);
  assert.equal(after.json.rows.some((row: { agentId?: string }) => row.agentId === "agent@ccc-wst-short"), true);

  assert.equal(aliyunHits, 0);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  assert.equal(store.agentWorkStatusLogs.length, logsBefore + logs.length);
  assert.equal(store.agentWorkStatusAudits.length, statusAuditsBefore);
  assert.equal(store.aliyunAgentMappings.find((item) => item.id === "map_wst_shirley")?.workMode, "ON_SITE");
  const auditText = JSON.stringify(store.agentWorkStatusTimeoutAudits);
  assert.equal(auditText.includes("=小休"), false);
  assert.equal(auditText.includes("亚洲原因不要出现"), false);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("Shirley"), false);

  console.log("agent work status timeout http tests passed");
} finally {
  const store = getStore();
  store.agentWorkStatusLogs = store.agentWorkStatusLogs.filter((item) => !item.id.startsWith("awsl_wst_"));
  store.agentWorkStatusTimeouts = store.agentWorkStatusTimeouts.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.agentWorkStatusTimeoutAudits = store.agentWorkStatusTimeoutAudits.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_wst_"));
  store.users = store.users.filter((item) => item.id !== "u_status_timeout_asia");
  setTenantTimezoneOverride(store, "europe", undefined);
  setOutboundNowForTests(undefined);
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
