import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AGENT_WORK_STATUS_TIMEOUT_MAX_SECONDS,
  AGENT_WORK_STATUS_TIMEOUT_MIN_SECONDS,
  agentWorkStatusTimeoutFiltersText,
  agentWorkStatusTimeoutSinceText,
  buildAgentWorkStatusTimeouts,
  currentWorkStatusSegment,
  isAgentWorkStatusTimeoutManager,
  parseAgentWorkStatusTimeoutBody,
  parseAgentWorkStatusTimeoutQuery,
  saveAgentWorkStatusTimeout,
  listAgentWorkStatusTimeouts
} from "./agent-work-status-timeout.js";
import type { CrmStore } from "./store.js";
import type { AgentWorkStatusLog, AgentWorkStatusTimeout, AgentWorkStatusTimeoutAudit, SessionUser } from "./types.js";

const now = new Date("2026-11-04T02:30:00.000Z");

function log(partial: Partial<AgentWorkStatusLog> & Pick<AgentWorkStatusLog, "id" | "at" | "status">): AgentWorkStatusLog {
  return {
    teamId: "europe",
    agentId: "agent@ccc-a",
    crmUserId: "",
    actorId: "",
    reason: "",
    source: "self",
    ...partial
  };
}

assert.equal(isAgentWorkStatusTimeoutManager({ role: "manager" }), true);
assert.equal(isAgentWorkStatusTimeoutManager({ role: "admin" }), true);
assert.equal(isAgentWorkStatusTimeoutManager({ role: "super_admin" }), true);
assert.equal(isAgentWorkStatusTimeoutManager({ role: "sales" }), false);
assert.deepEqual(parseAgentWorkStatusTimeoutQuery({}), { status: "" });
assert.equal(parseAgentWorkStatusTimeoutQuery({ status: "break" })?.status, "break");
assert.equal(parseAgentWorkStatusTimeoutQuery({ status: "available" }), null);
assert.equal(parseAgentWorkStatusTimeoutQuery({ status: ["break"] }), null);
assert.equal(parseAgentWorkStatusTimeoutQuery({ plaintext: "1" }), null);
assert.equal(parseAgentWorkStatusTimeoutBody({ status: "break", thresholdSeconds: 60 })?.thresholdSeconds, 60);
assert.equal(parseAgentWorkStatusTimeoutBody({ status: "busy", thresholdSeconds: AGENT_WORK_STATUS_TIMEOUT_MAX_SECONDS })?.thresholdSeconds, 28800);
assert.equal(parseAgentWorkStatusTimeoutBody({ status: "break", thresholdSeconds: null })?.thresholdSeconds, null);
assert.equal(parseAgentWorkStatusTimeoutBody({ status: "available", thresholdSeconds: 60 }), null);
assert.equal(parseAgentWorkStatusTimeoutBody({ status: "break", thresholdSeconds: 59 }), null);
assert.equal(parseAgentWorkStatusTimeoutBody({ status: "break", thresholdSeconds: 28801 }), null);
assert.equal(parseAgentWorkStatusTimeoutBody({ status: "break", thresholdSeconds: 60.5 }), null);
assert.equal(parseAgentWorkStatusTimeoutBody({ status: "break", thresholdSeconds: "900" }), null);
assert.equal(parseAgentWorkStatusTimeoutBody({ status: "break" }), null);
assert.equal(parseAgentWorkStatusTimeoutBody({ status: "break", thresholdSeconds: 900, note: "x" }), null);
assert.equal(agentWorkStatusTimeoutFiltersText("break").includes("900"), false);
assert.equal(agentWorkStatusTimeoutSinceText("2026-11-04T02:00:00.000Z"), "2026-11-04 10:00");
assert.equal(agentWorkStatusTimeoutSinceText("nope"), "");
assert.equal(AGENT_WORK_STATUS_TIMEOUT_MIN_SECONDS, 60);

const tied = currentWorkStatusSegment([
  log({ id: "later", at: new Date(0).toISOString(), status: "break" }),
  log({ id: "earlier", at: new Date(0).toISOString(), status: "busy" })
], 5_000);
assert.equal(tied?.log.status, "break");
assert.equal(tied?.elapsedSeconds, 5);

const future = currentWorkStatusSegment([
  log({ id: "future", at: new Date(9_000).toISOString(), status: "busy" }),
  log({ id: "past", at: new Date(0).toISOString(), status: "available" })
], 5_000);
assert.equal(future?.log.status, "available");

const ignored = currentWorkStatusSegment([
  log({ id: "bad", at: "not-a-time", status: "break" }),
  log({ id: "cloud", at: new Date(0).toISOString(), status: "ON_SITE" as AgentWorkStatusLog["status"] })
], 5_000);
assert.equal(ignored, null);

const logs: AgentWorkStatusLog[] = [
  log({ id: "awsl_break", at: "2026-11-04T02:00:00.000Z", status: "break", reason: "=小休", source: "self" }),
  log({ id: "awsl_busy_old", at: "2026-11-03T16:00:00.000Z", status: "busy" }),
  log({ id: "awsl_short", agentId: "agent@ccc-short", at: "2026-11-04T02:25:00.000Z", status: "break" }),
  log({ id: "awsl_available", agentId: "agent@ccc-ready", at: "2026-11-03T16:00:00.000Z", status: "available" }),
  log({ id: "awsl_switched", agentId: "agent@ccc-switched", at: "2026-11-04T02:20:00.000Z", status: "available" }),
  log({ id: "awsl_switched_old", agentId: "agent@ccc-switched", at: "2026-11-03T16:00:00.000Z", status: "break" }),
  log({ id: "awsl_busy", agentId: "agent@ccc-busy", at: "2026-11-04T02:00:00.000Z", status: "busy", reason: "忙" }),
  log({ id: "awsl_only", agentId: "agent@ccc-only", at: "2026-11-04T01:30:00.000Z", status: "break" }),
  log({ id: "awsl_asia", teamId: "asia", agentId: "agent@ccc-asia", at: "2026-11-04T01:00:00.000Z", status: "break", reason: "亚洲原因不要出现" }),
  log({ id: "awsl_bad", at: "nope", status: "break", reason: "坏时间" }),
  log({ id: "awsl_cloud", agentId: "agent@ccc-cloud", at: "2026-11-04T01:00:00.000Z", status: "ON_SITE" as AgentWorkStatusLog["status"] })
];

const thresholds: AgentWorkStatusTimeout[] = [
  { id: "awst_break", teamId: "europe", status: "break", thresholdSeconds: 900, updatedBy: "u-manager", updatedAt: now.toISOString() },
  { id: "awst_asia", teamId: "asia", status: "break", thresholdSeconds: 60, updatedBy: "u-asia", updatedAt: now.toISOString() }
];

const built = buildAgentWorkStatusTimeouts({
  logs,
  mappings: [
    { teamId: "europe", cccUserId: "agent@ccc-a", displayName: "甲<script>", loginName: "a" },
    { teamId: "europe", cccUserId: "agent@ccc-short", displayName: "", loginName: "short" },
    { teamId: "europe", cccUserId: "agent@ccc-ready", displayName: "在岗", loginName: "ready" },
    { teamId: "europe", cccUserId: "agent@ccc-switched", displayName: "已改走", loginName: "switched" },
    { teamId: "europe", cccUserId: "agent@ccc-busy", displayName: "忙碌的人", loginName: "busy" },
    { teamId: "europe", cccUserId: "agent@ccc-none", displayName: "没有日志", loginName: "none" },
    { teamId: "asia", cccUserId: "agent@ccc-asia", displayName: "亚洲", loginName: "asia" }
  ],
  thresholds,
  teamId: "europe",
  status: "",
  now
});
assert.equal(built.thresholds.break, 900);
assert.equal(built.thresholds.busy, null);
assert.deepEqual(built.rows.map((row) => row.agentId), ["agent@ccc-only", "agent@ccc-a"]);
const shirley = built.rows.find((row) => row.agentId === "agent@ccc-a");
assert.ok(shirley);
assert.equal(shirley.elapsedSeconds, 1800);
assert.equal(shirley.thresholdSeconds, 900);
assert.equal(shirley.sinceText, "2026-11-04 10:00");
assert.equal(shirley.label, "甲<script>");
assert.equal(shirley.reason, "=小休");
assert.equal(built.rows.find((row) => row.agentId === "agent@ccc-only")?.elapsedSeconds, 3600);
assert.equal(built.rows.some((row) => row.agentId === "agent@ccc-short"), false);
assert.equal(built.rows.some((row) => row.agentId === "agent@ccc-ready"), false);
assert.equal(built.rows.some((row) => row.agentId === "agent@ccc-switched"), false);
assert.equal(built.rows.some((row) => row.agentId === "agent@ccc-busy"), false);
assert.equal(built.rows.some((row) => row.agentId === "agent@ccc-none"), false);
assert.equal(built.rows.some((row) => row.reason.includes("亚洲")), false);
assert.equal(JSON.stringify(built).includes("ON_SITE"), false);
assert.equal(JSON.stringify(built).includes("接通率"), false);

const onlyBreak = buildAgentWorkStatusTimeouts({
  logs,
  mappings: [],
  thresholds: [
    ...thresholds,
    { id: "awst_busy", teamId: "europe", status: "busy", thresholdSeconds: 60, updatedBy: "u-manager", updatedAt: now.toISOString() }
  ],
  teamId: "europe",
  status: "break",
  now
});
assert.equal(onlyBreak.thresholds.busy, 60);
assert.equal(onlyBreak.rows.every((row) => row.status === "break"), true);
assert.equal(onlyBreak.rows.some((row) => row.agentId === "agent@ccc-busy"), false);

const exact = buildAgentWorkStatusTimeouts({
  logs: [log({ id: "exact", at: "2026-11-04T02:15:00.000Z", status: "break" })],
  mappings: [],
  thresholds,
  teamId: "europe",
  status: "",
  now
});
assert.equal(exact.rows[0]?.elapsedSeconds, 900);

const under = buildAgentWorkStatusTimeouts({
  logs: [log({ id: "under", at: "2026-11-04T02:15:01.000Z", status: "break" })],
  mappings: [],
  thresholds,
  teamId: "europe",
  status: "",
  now
});
assert.equal(under.rows.length, 0);

function memory() {
  const audits: AgentWorkStatusTimeoutAudit[] = [];
  const saved: AgentWorkStatusTimeout[] = [];
  const store = {
    agentWorkStatusLogs: logs,
    agentWorkStatusTimeouts: saved,
    agentWorkStatusTimeoutAudits: audits,
    aliyunAgentMappings: [],
    async persist() {}
  };
  return { store: store as unknown as CrmStore, audits, saved };
}

const manager = { id: "u-manager", teamId: "europe", role: "manager" } as SessionUser;
const sales = { id: "u-sales", teamId: "europe", role: "sales" } as SessionUser;

const { store, audits, saved } = memory();
const denied = await listAgentWorkStatusTimeouts(store, sales, {}, now);
assert.equal(denied.status, 403);
assert.equal(audits.length, 1);
assert.equal(audits[0]?.reason, "forbidden");
assert.equal(JSON.stringify(denied.body).includes("=小休"), false);

const invalid = await listAgentWorkStatusTimeouts(store, manager, { status: "available" }, now);
assert.equal(invalid.status, 400);
assert.equal(audits.length, 1);

const anonymous = await saveAgentWorkStatusTimeout(store, undefined, { status: "break", thresholdSeconds: 900 }, now);
assert.equal(anonymous.status, 401);
assert.equal(audits.length, 1);

const badSave = await saveAgentWorkStatusTimeout(store, sales, { status: "available", thresholdSeconds: 900 }, now);
assert.equal(badSave.status, 400);
assert.equal(audits.length, 1);
assert.equal(saved.length, 0);

const salesSave = await saveAgentWorkStatusTimeout(store, sales, { status: "break", thresholdSeconds: 900 }, now);
assert.equal(salesSave.status, 403);
assert.equal(saved.length, 0);
assert.equal(JSON.stringify(salesSave.body).includes("=小休"), false);

const created = await saveAgentWorkStatusTimeout(store, manager, { status: "break", thresholdSeconds: 900 }, now);
assert.equal(created.status, 200);
assert.equal(created.body.result, "updated");
assert.equal(saved.length, 1);
assert.equal(audits.filter((item) => item.result === "updated").length, 1);

const same = await saveAgentWorkStatusTimeout(store, manager, { status: "break", thresholdSeconds: 900 }, now);
assert.equal(same.body.result, "unchanged");
assert.equal(saved.length, 1);
assert.equal(audits.filter((item) => item.actorId === "u-manager" && item.action === "set").length, 1);

const viewed = await listAgentWorkStatusTimeouts(store, manager, {}, now);
assert.equal(viewed.status, 200);
if (viewed.status === 200) {
  assert.equal(viewed.body.thresholds.break, 900);
  assert.equal(viewed.body.thresholds.busy, null);
  assert.equal(viewed.body.rows.some((row) => row.agentId === "agent@ccc-a"), true);
  assert.equal(viewed.body.rows.some((row) => row.reason.includes("亚洲")), false);
}
assert.equal(audits.filter((item) => item.result === "read").length, 1);

const again = await listAgentWorkStatusTimeouts(store, manager, { status: "break" }, now);
assert.equal(again.status, 200);
assert.equal(audits.filter((item) => item.result === "read").length, 2);

const cleared = await saveAgentWorkStatusTimeout(store, manager, { status: "break", thresholdSeconds: null }, now);
assert.equal(cleared.body.result, "cleared");
assert.equal(saved.length, 0);

const missing = await saveAgentWorkStatusTimeout(store, manager, { status: "break", thresholdSeconds: null }, now);
assert.equal(missing.status, 400);
assert.equal(missing.body.reason, "not_set");
assert.equal(audits.filter((item) => item.action === "clear").length, 1);

const auditText = JSON.stringify(audits);
assert.equal(auditText.includes("=小休"), false);
assert.equal(auditText.includes("亚洲原因不要出现"), false);
assert.equal(auditText.includes("AccessKey"), false);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS agent_work_status_timeouts \(/);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS agent_work_status_timeouts \(/g) || []).length, 1);
assert.match(schema, /INSERT INTO agent_work_status_timeouts/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS agent_work_status_timeout_audits \(/);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS agent_work_status_timeout_audits \(/g) || []).length, 1);
assert.match(schema, /INSERT INTO agent_work_status_timeout_audits/);
assert.match(schema, /team_id <> '' AND team_id <> 'all' AND team_id = ''/);
assert.equal(schema.includes("DROP TABLE agent_work_status_timeouts"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS agent_work_status_timeouts"), false);
assert.equal(schema.includes("DROP TABLE agent_work_status_timeout_audits"), false);
assert.equal(schema.includes("ALTER TABLE agent_work_status_logs"), false);
assert.equal(schema.includes("ALTER TABLE agent_work_status_audits"), false);
assert.equal(schema.includes("UPDATE agent_work_status_logs"), false);
assert.equal(schema.includes("UPDATE agent_work_status_timeouts"), false);

const source = readFileSync(new URL("./agent-work-status-timeout.ts", import.meta.url), "utf8");
assert.equal(source.includes("PollUserStatus"), false);
assert.equal(source.includes("ListUsers"), false);
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("nodemailer"), false);
assert.equal(source.includes("fetch("), false);

console.log("agent work status timeout tests passed");
