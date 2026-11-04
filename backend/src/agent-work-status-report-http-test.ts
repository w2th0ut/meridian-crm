import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { AgentWorkStatusAudit, AgentWorkStatusLog } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start agent work status report test server");
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
  const type = response.headers.get("content-type") || "";
  if (type.includes("text/csv")) {
    const bytes = Buffer.from(await response.arrayBuffer());
    return { response, text: bytes.toString("utf8"), json: {} as Record<string, any> };
  }
  const text = await response.text();
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
    agentId: "agent@ccc-wsr-a",
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
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const alexUser = store.users.find((item) => item.email === "alex@keduoduo.com");
  const adminUser = store.users.find((item) => item.email === "admin@keduoduo.com");
  assert.ok(shirleyUser && miaUser && alexUser && adminUser);
  assert.equal(shirleyUser.role, "sales");
  assert.equal(alexUser.role, "manager");
  store.users.push({
    ...adminUser,
    id: "u_status_report_asia",
    name: "Asia Status Report",
    email: "asia-status-report@keduoduo.com",
    role: "admin",
    teamId: "asia",
    status: "active"
  });
  store.aliyunAgentMappings.push(
    {
      id: "map_wsr_shirley",
      teamId: "europe",
      crmUserId: shirleyUser.id,
      cccUserId: "agent@ccc-wsr-a",
      loginName: "shirley-wsr",
      displayName: "Shirley状态<script>",
      extension: "8501",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_wsr_mia",
      teamId: "europe",
      crmUserId: miaUser.id,
      cccUserId: "agent@ccc-wsr-b",
      loginName: "mia-wsr",
      displayName: "Mia状态",
      extension: "8502",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    }
  );
  const leadsBefore = store.leads.length;
  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions);
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  const logsBefore = store.agentWorkStatusLogs.length;
  const statusAuditsBefore = store.agentWorkStatusAudits.length;

  const logs: AgentWorkStatusLog[] = [
    log({ id: "awsl_wsr_break", at: "2026-11-04T02:00:00.000Z", status: "break", source: "manager", actorId: alexUser.id, crmUserId: shirleyUser.id, reason: "=休息" }),
    log({ id: "awsl_wsr_busy", at: "2026-11-03T16:10:00.000Z", status: "busy", actorId: shirleyUser.id, crmUserId: shirleyUser.id }),
    log({ id: "awsl_wsr_open", at: "2026-11-03T15:00:00.000Z", status: "available", actorId: shirleyUser.id, crmUserId: shirleyUser.id, reason: "夜班" }),
    log({ id: "awsl_wsr_old", agentId: "agent@ccc-wsr-old", at: "2026-11-03T16:00:00.000Z", status: "available" }),
    log({ id: "awsl_wsr_asia", teamId: "asia", agentId: "agent@ccc-wsr-asia", at: "2026-11-03T16:00:00.000Z", status: "available", reason: "亚洲原因不要出现" })
  ];
  const audits: AgentWorkStatusAudit[] = [
    {
      id: "awsa_wsr_break",
      teamId: "europe",
      actorId: alexUser.id,
      at: "2026-11-04T02:00:00.000Z",
      agentId: "agent@ccc-wsr-a",
      action: "reset",
      previousStatus: "busy",
      nextStatus: "break",
      reason: "=休息",
      result: "updated",
      reasonCode: ""
    },
    {
      id: "awsa_wsr_reject",
      teamId: "europe",
      actorId: alexUser.id,
      at: "2026-11-04T01:00:00.000Z",
      agentId: "agent@ccc-wsr-a",
      action: "reset",
      previousStatus: "",
      nextStatus: "available",
      reason: "拒绝原因",
      result: "rejected",
      reasonCode: "forbidden"
    },
    {
      id: "awsa_wsr_mia",
      teamId: "europe",
      actorId: alexUser.id,
      at: "2026-11-04T01:30:00.000Z",
      agentId: "agent@ccc-wsr-b",
      action: "reset",
      previousStatus: "",
      nextStatus: "busy",
      reason: "乙没有日志",
      result: "rejected",
      reasonCode: "forbidden"
    }
  ];
  store.agentWorkStatusLogs.unshift(...logs);
  store.agentWorkStatusAudits.unshift(...audits);

  const shirley = await login("shirley@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const asia = await login("asia-status-report@keduoduo.com");

  const anonymous = await request("/api/agent-work-status-report", "");
  assert.equal(anonymous.response.status, 401);
  assert.equal(store.agentWorkStatusReportAudits.length, 0);

  const bad = await request("/api/agent-work-status-report?from=2026-11-05&to=2026-11-04", alex);
  assert.equal(bad.response.status, 400);
  assert.equal(bad.json.reason, "invalid_request");
  const extra = await request("/api/agent-work-status-report?plaintext=1", alex);
  assert.equal(extra.response.status, 400);
  assert.equal(store.agentWorkStatusReportAudits.length, 0);

  const denied = await request("/api/agent-work-status-report?from=2026-11-04&to=2026-11-04", shirley);
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.reason, "forbidden");
  assert.equal(denied.json.agents, undefined);
  assert.equal(denied.text.includes("夜班"), false);
  assert.equal(denied.text.includes("=休息"), false);
  const deniedAudit = store.agentWorkStatusReportAudits.find((item) => item.actorId === shirleyUser.id && item.action === "read");
  assert.ok(deniedAudit);
  assert.equal(deniedAudit.rowCount, 0);
  assert.equal(deniedAudit.result, "rejected");
  assert.equal(deniedAudit.reason, "forbidden");
  const deniedExport = await request("/api/agent-work-status-report/export", shirley);
  assert.equal(deniedExport.response.status, 403);
  assert.equal(deniedExport.response.headers.get("content-type")?.includes("text/csv"), false);
  assert.equal(store.agentWorkStatusReportAudits.some((item) => item.actorId === shirleyUser.id && item.action === "export" && item.result === "rejected"), true);

  const viewed = await request("/api/agent-work-status-report?from=2026-11-04&to=2026-11-04", alex);
  assert.equal(viewed.response.status, 200);
  assert.equal(viewed.json.timeZone, "Asia/Shanghai");
  assert.equal(viewed.json.today, "2026-11-04");
  assert.equal(viewed.json.timeline, null);
  assert.equal(viewed.json.rowCount, 3);
  const mine = viewed.json.agents.find((item: { agentId: string }) => item.agentId === "agent@ccc-wsr-a");
  const quiet = viewed.json.agents.find((item: { agentId: string }) => item.agentId === "agent@ccc-wsr-b");
  const historic = viewed.json.agents.find((item: { agentId: string }) => item.agentId === "agent@ccc-wsr-old");
  assert.equal(mine.availableSeconds, 600);
  assert.equal(mine.busySeconds, 35400);
  assert.equal(mine.breakSeconds, 1800);
  assert.equal(mine.label, "Shirley状态<script>");
  assert.equal(quiet.availableSeconds, null);
  assert.equal(quiet.busySeconds, null);
  assert.equal(quiet.breakSeconds, null);
  assert.equal(historic.availableSeconds, 37800);
  assert.equal(historic.busySeconds, 0);
  assert.equal(historic.breakSeconds, 0);
  assert.equal(viewed.json.agents.some((item: { agentId: string }) => item.agentId === "agent@ccc-wsr-asia"), false);
  assert.equal(JSON.stringify(viewed.json).includes("亚洲原因不要出现"), false);
  assert.equal(JSON.stringify(viewed.json).includes("接通率"), false);
  assert.equal(JSON.stringify(viewed.json).includes("利用率"), false);
  const readAudit = store.agentWorkStatusReportAudits.find((item) => item.actorId === alexUser.id && item.action === "read" && item.result === "read");
  assert.ok(readAudit);
  assert.equal(readAudit.rowCount, 3);
  assert.equal(readAudit.filters.includes("夜班"), false);
  assert.equal(readAudit.filters.includes("=休息"), false);

  const again = await request("/api/agent-work-status-report?from=2026-11-04&to=2026-11-04", alex);
  assert.equal(again.response.status, 200);
  assert.equal(store.agentWorkStatusReportAudits.filter((item) => item.actorId === alexUser.id && item.action === "read" && item.result === "read").length, 2);

  const missing = await request("/api/agent-work-status-report?agentId=agent@missing", alex);
  assert.equal(missing.response.status, 403);
  assert.equal(missing.json.agents, undefined);
  assert.equal(missing.json.timeline, undefined);

  const drilled = await request("/api/agent-work-status-report?from=2026-11-04&to=2026-11-04&agentId=agent@ccc-wsr-a", alex);
  assert.equal(drilled.response.status, 200);
  assert.equal(drilled.json.timeline.length, 4);
  assert.equal(drilled.json.timeline.find((item: { id: string }) => item.id === "awsl_wsr_break")?.previousStatus, "busy");
  assert.equal(drilled.json.timeline.find((item: { id: string }) => item.id === "awsl_wsr_open")?.kind, "opening");
  assert.equal(drilled.json.timeline.find((item: { id: string }) => item.id === "awsa_wsr_reject")?.counted, false);
  assert.equal(drilled.json.agents.find((item: { agentId: string }) => item.agentId === "agent@ccc-wsr-a")?.breakSeconds, 1800);

  const miaView = await request("/api/agent-work-status-report?from=2026-11-04&to=2026-11-04&agentId=agent@ccc-wsr-b", alex);
  assert.equal(miaView.response.status, 200);
  assert.equal(miaView.json.agents.find((item: { agentId: string }) => item.agentId === "agent@ccc-wsr-b")?.availableSeconds, null);
  assert.equal(miaView.json.timeline.length, 1);
  assert.equal(miaView.json.timeline[0].counted, false);

  const exported = await request("/api/agent-work-status-report/export?from=2026-11-04&to=2026-11-04&agentId=agent@ccc-wsr-a", alex);
  assert.equal(exported.response.status, 200);
  assert.match(exported.response.headers.get("content-type") || "", /text\/csv/);
  assert.equal(exported.response.headers.get("cache-control"), "no-store");
  assert.match(exported.response.headers.get("content-disposition") || "", /agent-work-status-report\.csv/);
  assert.match(decodeURIComponent(exported.response.headers.get("content-disposition") || ""), /坐席工作状态时长\.csv/);
  assert.equal(exported.text.charCodeAt(0), 0xfeff);
  assert.match(exported.text, /种类,坐席,坐席 ID,可接听秒,忙碌秒,小休秒/);
  assert.match(exported.text, /600,35400,1800/);
  assert.match(exported.text, /Mia状态,agent@ccc-wsr-b,—,—,—/);
  assert.match(exported.text, /'=休息/);
  assert.match(exported.text, /未生效的改回/);
  assert.match(exported.text, /延续进入/);
  assert.match(exported.text, /\r\n/);
  assert.equal(exported.text.includes("亚洲原因不要出现"), false);
  assert.match(exported.text, /夜班/);
  assert.equal(exported.text.includes("接通率"), false);
  assert.equal(exported.text.includes("利用率"), false);
  const exportAudit = store.agentWorkStatusReportAudits.find((item) => item.actorId === alexUser.id && item.action === "export" && item.result === "exported");
  assert.ok(exportAudit);
  assert.equal(exportAudit.rowCount, 3);
  assert.equal(exportAudit.filters.includes("=休息"), false);

  const summary = await request("/api/agent-work-status-report/export?from=2026-11-04&to=2026-11-04", admin);
  assert.equal(summary.response.status, 200);
  assert.equal(summary.text.includes("延续进入"), false);
  assert.equal(summary.text.includes("拒绝原因"), false);
  assert.match(summary.text, /37800,0,0/);

  const asiaView = await request("/api/agent-work-status-report?from=2026-11-04&to=2026-11-04", asia);
  assert.equal(asiaView.response.status, 200);
  assert.equal(asiaView.json.agents.some((item: { agentId: string }) => item.agentId === "agent@ccc-wsr-a"), false);
  assert.equal(JSON.stringify(asiaView.json).includes("夜班"), false);
  assert.equal(JSON.stringify(asiaView.json).includes("=休息"), false);
  assert.equal(asiaView.json.agents.find((item: { agentId: string }) => item.agentId === "agent@ccc-wsr-asia")?.availableSeconds, 37800);

  setTenantTimezoneOverride(store, "europe", "America/New_York");
  const shifted = await request("/api/agent-work-status-report?from=2026-11-04&to=2026-11-04", alex);
  assert.equal(shifted.response.status, 200);
  assert.equal(shifted.json.timeZone, "Asia/Shanghai");
  assert.equal(shifted.json.today, "2026-11-04");
  const shiftedMine = shifted.json.agents.find((item: { agentId: string }) => item.agentId === "agent@ccc-wsr-a");
  assert.equal(shiftedMine.availableSeconds, 600);
  assert.equal(shiftedMine.busySeconds, 35400);
  assert.equal(shiftedMine.breakSeconds, 1800);

  assert.equal(aliyunHits, 0);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  assert.equal(store.agentWorkStatusLogs.length, logsBefore + logs.length);
  assert.equal(store.agentWorkStatusAudits.length, statusAuditsBefore + audits.length);
  assert.equal(store.aliyunAgentMappings.find((item) => item.id === "map_wsr_shirley")?.workMode, "ON_SITE");
  const auditText = JSON.stringify(store.agentWorkStatusReportAudits);
  assert.equal(auditText.includes("=休息"), false);
  assert.equal(auditText.includes("夜班"), false);
  assert.equal(auditText.includes("亚洲原因不要出现"), false);
  assert.equal(auditText.includes("AccessKey"), false);

  console.log("agent work status report http tests passed");
} finally {
  const store = getStore();
  store.agentWorkStatusLogs = store.agentWorkStatusLogs.filter((item) => !item.id.startsWith("awsl_wsr_"));
  store.agentWorkStatusAudits = store.agentWorkStatusAudits.filter((item) => !item.id.startsWith("awsa_wsr_"));
  store.agentWorkStatusReportAudits = store.agentWorkStatusReportAudits.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_wsr_"));
  store.users = store.users.filter((item) => item.id !== "u_status_report_asia");
  setTenantTimezoneOverride(store, "europe", undefined);
  setOutboundNowForTests(undefined);
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
