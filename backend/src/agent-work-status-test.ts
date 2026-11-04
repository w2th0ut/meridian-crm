import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AGENT_WORK_STATUS_TIME_ZONE,
  attachAgentWorkStatus,
  parseOwnWorkStatusBody,
  parseResetWorkStatusBody,
  resetAgentWorkStatus,
  setOwnAgentWorkStatus,
  summarizeAgentWorkStatus,
  zonedDayStartMs
} from "./agent-work-status.js";
import type { CrmStore } from "./store.js";
import type { AgentWorkStatusAudit, AgentWorkStatusLog, AliyunAgentMapping, SessionUser } from "./types.js";

const now = new Date("2026-04-03T16:30:00.000Z");
assert.equal(zonedDayStartMs(now, AGENT_WORK_STATUS_TIME_ZONE), Date.parse("2026-04-03T16:00:00.000Z"));

function log(partial: Partial<AgentWorkStatusLog> & Pick<AgentWorkStatusLog, "id" | "at" | "status">): AgentWorkStatusLog {
  return {
    teamId: "europe",
    agentId: "agent@ccc-a",
    crmUserId: "u1",
    actorId: "u1",
    reason: "",
    source: "self",
    ...partial
  };
}

const summary = summarizeAgentWorkStatus([
  log({ id: "yesterday", at: "2026-04-03T15:00:00.000Z", status: "available", reason: "夜班" }),
  log({ id: "busy", at: "2026-04-03T16:10:00.000Z", status: "busy", reason: "回访" }),
  log({ id: "future", at: "2026-04-03T17:00:00.000Z", status: "break" }),
  log({ id: "other", at: "2026-04-03T16:00:00.000Z", status: "break", teamId: "asia", agentId: "agent@ccc-a" }),
  log({ id: "blank", at: "", status: "available" })
].filter((item) => item.teamId === "europe" && item.agentId === "agent@ccc-a"), now);

assert.equal(summary.status, "busy");
assert.equal(summary.reason, "回访");
assert.equal(summary.changedAt, "2026-04-03T16:10:00.000Z");
assert.equal(summary.availableSeconds, 10 * 60);
assert.equal(summary.busySeconds, 20 * 60);
assert.equal(summary.breakSeconds, 0);

assert.deepEqual(summarizeAgentWorkStatus([], now), {
  status: null,
  reason: "",
  changedAt: null,
  availableSeconds: null,
  busySeconds: null,
  breakSeconds: null
});

const attached = attachAgentWorkStatus(
  [
    { agentId: "agent@ccc-a", callsMade: 2 },
    { agentId: "none", callsMade: 1 }
  ],
  [log({ id: "busy", at: "2026-04-03T16:10:00.000Z", status: "busy" })],
  "europe",
  now
);
assert.equal(attached[0]?.callsMade, 2);
assert.equal(attached[0]?.status, "busy");
assert.equal(attached[0]?.busySeconds, 20 * 60);
assert.equal(attached[0]?.availableSeconds, 0);
assert.equal(attached[1]?.status, null);
assert.equal(attached[1]?.availableSeconds, null);
assert.equal(attached[1]?.busySeconds, null);

assert.equal(parseOwnWorkStatusBody({ status: "break", reason: " 午饭 " }).ok, true);
assert.equal(parseOwnWorkStatusBody({ status: "ON_SITE" }).ok, false);
assert.equal(parseOwnWorkStatusBody({ status: "busy", agentId: "agent@ccc-a" }).ok, false);
assert.equal(parseOwnWorkStatusBody({ status: "busy", reason: "x".repeat(201) }).ok, false);
assert.equal(parseResetWorkStatusBody({ agentId: "agent@ccc-a", status: "available" }).ok, true);
assert.equal(parseResetWorkStatusBody({ status: "available" }).ok, false);

function user(partial: Partial<SessionUser>): SessionUser {
  return {
    id: "u1",
    name: "甲",
    email: "a@example.com",
    role: "sales",
    teamId: "europe",
    avatar: "",
    authVersion: 1,
    ...partial
  };
}

function mapping(partial: Partial<AliyunAgentMapping>): AliyunAgentMapping {
  return {
    id: partial.id || "map-a",
    teamId: "europe",
    crmUserId: "u1",
    cccUserId: "agent@ccc-a",
    loginName: "a",
    displayName: "甲<script>",
    extension: "",
    workMode: "ON_SITE",
    updatedBy: "admin",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...partial
  };
}

function memory(users: SessionUser[], mappings: AliyunAgentMapping[]) {
  const logs: AgentWorkStatusLog[] = [];
  const audits: AgentWorkStatusAudit[] = [];
  const store = {
    users: users.map((item) => ({ ...item, password: "x", status: "active" as const })),
    aliyunAgentMappings: mappings,
    outboundCallRecords: [],
    agentWorkStatusLogs: logs,
    agentWorkStatusAudits: audits,
    async persist() {}
  };
  return store as unknown as CrmStore;
}

const sales = user({ id: "u1", role: "sales" });
const colleague = user({ id: "u2", name: "乙", role: "sales" });
const manager = user({
  id: "u-manager",
  role: "manager",
  iamPermissions: { "communication.read": ["org_subtree"] }
});
const store = memory(
  [sales, colleague, manager],
  [
    mapping({ id: "map-a", crmUserId: "u1", cccUserId: "agent@ccc-a", displayName: "甲<script>" }),
    mapping({ id: "map-b", crmUserId: "u2", cccUserId: "agent@ccc-b", displayName: "乙坐席", workMode: "ON_SITE" })
  ]
);

const saved = await setOwnAgentWorkStatus(store, sales, { status: "busy", reason: "回访" }, now);
assert.equal(saved.status, 200);
assert.equal(saved.body.result, "updated");
assert.equal(store.agentWorkStatusLogs.length, 1);
assert.equal(store.agentWorkStatusLogs[0]?.source, "self");
assert.equal(store.agentWorkStatusAudits.length, 0);
assert.equal(store.aliyunAgentMappings[0]?.workMode, "ON_SITE");
const again = await setOwnAgentWorkStatus(store, sales, { status: "busy", reason: "回访" }, now);
assert.equal(again.body.result, "unchanged");
assert.equal(store.agentWorkStatusLogs.length, 1);

const denied = await resetAgentWorkStatus(store, sales, { agentId: "agent@ccc-b", status: "break", reason: "代改" }, now);
assert.equal(denied.status, 403);
assert.equal(denied.body.reason, "forbidden");
assert.equal(store.agentWorkStatusLogs.some((item) => item.agentId === "agent@ccc-b"), false);
assert.equal(store.agentWorkStatusAudits.some((item) => item.actorId === "u1" && item.result === "rejected" && item.reasonCode === "forbidden"), true);
assert.equal(JSON.stringify(denied.body).includes("乙坐席"), false);

const reset = await resetAgentWorkStatus(store, manager, { agentId: "agent@ccc-b", status: "available", reason: "回来了" }, now);
assert.equal(reset.status, 200);
assert.equal(reset.body.result, "updated");
const managerLog = store.agentWorkStatusLogs.find((item) => item.agentId === "agent@ccc-b");
assert.equal(managerLog?.source, "manager");
assert.equal(managerLog?.status, "available");
const managerAudit = store.agentWorkStatusAudits.find((item) => item.agentId === "agent@ccc-b" && item.result === "updated");
assert.ok(managerAudit);
assert.equal(managerAudit?.previousStatus, "");
assert.equal(managerAudit?.nextStatus, "available");
assert.equal(managerAudit?.action, "reset");
const same = await resetAgentWorkStatus(store, manager, { agentId: "agent@ccc-b", status: "available", reason: "回来了" }, now);
assert.equal(same.body.result, "unchanged");
assert.equal(store.agentWorkStatusAudits.filter((item) => item.agentId === "agent@ccc-b" && item.result === "updated").length, 1);

const missing = await resetAgentWorkStatus(store, manager, { agentId: "agent@missing", status: "busy" }, now);
assert.equal(missing.status, 404);
assert.equal(missing.body.reason, "not_found");
assert.equal(store.agentWorkStatusAudits.some((item) => item.agentId === "agent@missing" && item.reasonCode === "not_found"), true);

const bad = await setOwnAgentWorkStatus(store, sales, { status: "ON_SITE" }, now);
assert.equal(bad.status, 400);
assert.equal(store.agentWorkStatusLogs.length, 2);

const unmapped = user({ id: "u-none", role: "sales" });
const noMap = await setOwnAgentWorkStatus(store, unmapped, { status: "available" }, now);
assert.equal(noMap.status, 404);
assert.equal(noMap.body.reason, "unmapped");

const noPerm = user({ id: "u1", role: "sales", iamPermissions: {} });
const forbiddenSelf = await setOwnAgentWorkStatus(store, noPerm, { status: "break" }, now);
assert.equal(forbiddenSelf.status, 403);
assert.equal(store.agentWorkStatusAudits.some((item) => item.actorId === "u1" && item.agentId === "agent@ccc-a"), false);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS agent_work_status_logs \(/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS agent_work_status_audits \(/);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS agent_work_status_logs \(/g) || []).length, 1);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS agent_work_status_audits \(/g) || []).length, 1);
assert.match(schema, /INSERT INTO agent_work_status_logs/);
assert.match(schema, /INSERT INTO agent_work_status_audits/);
assert.match(schema, /WHERE NOT EXISTS/);
assert.match(schema, /team_id = ''/);
assert.equal(schema.includes("DROP TABLE agent_work_status_logs"), false);
assert.equal(schema.includes("DROP TABLE agent_work_status_audits"), false);
assert.equal(schema.includes("ALTER TABLE agent_work_status_logs"), false);
assert.equal(schema.includes("ALTER TABLE agent_work_status_audits"), false);
assert.equal(schema.includes("CREATE TABLE agent_work_status_logs"), false);

const source = readFileSync(new URL("./agent-work-status.ts", import.meta.url), "utf8");
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("PollUserStatus"), false);
assert.equal(source.includes("ListUsers"), false);
assert.equal(source.includes("workMode"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(JSON.stringify(store.agentWorkStatusAudits).includes("AccessKey"), false);

console.log("agent work status unit tests passed");
