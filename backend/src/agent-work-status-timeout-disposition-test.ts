import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AGENT_WORK_STATUS_TIMEOUT_DISPOSITION_NOTE_MAX,
  agentWorkStatusTimeoutDispositionReadFilters,
  agentWorkStatusTimeoutDispositionRecordFilters,
  buildAgentWorkStatusTimeoutDispositions,
  listAgentWorkStatusTimeoutDispositions,
  parseAgentWorkStatusTimeoutDispositionBody,
  parseAgentWorkStatusTimeoutDispositionQuery,
  recordAgentWorkStatusTimeoutDisposition
} from "./agent-work-status-timeout-disposition.js";
import type { CrmStore } from "./store.js";
import type { AgentWorkStatusLog, AgentWorkStatusTimeout, AgentWorkStatusTimeoutDispositionAudit, SessionUser } from "./types.js";

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

assert.equal(parseAgentWorkStatusTimeoutDispositionQuery({})?.disposition, "");
assert.equal(parseAgentWorkStatusTimeoutDispositionQuery({ from: "2026-11-04", to: "2026-11-04", disposition: "noted" })?.from, "2026-11-04");
assert.equal(parseAgentWorkStatusTimeoutDispositionQuery({ from: "2026-11-05", to: "2026-11-04" }), null);
assert.equal(parseAgentWorkStatusTimeoutDispositionQuery({ from: "2026-02-31" }), null);
assert.equal(parseAgentWorkStatusTimeoutDispositionQuery({ disposition: "available" }), null);
assert.equal(parseAgentWorkStatusTimeoutDispositionQuery({ disposition: ["noted"] }), null);
assert.equal(parseAgentWorkStatusTimeoutDispositionQuery({ plaintext: "1" }), null);
assert.equal(parseAgentWorkStatusTimeoutDispositionBody({ agentId: "agent@ccc-a", disposition: "reminded" })?.note, "");
assert.equal(parseAgentWorkStatusTimeoutDispositionBody({ agentId: "agent@ccc-a", disposition: "noted", note: "  已口头说过  " })?.note, "已口头说过");
assert.equal(parseAgentWorkStatusTimeoutDispositionBody({ agentId: "agent@ccc-a", disposition: "noted" }), null);
assert.equal(parseAgentWorkStatusTimeoutDispositionBody({ agentId: "agent@ccc-a", disposition: "noted", note: "   " }), null);
assert.equal(parseAgentWorkStatusTimeoutDispositionBody({ agentId: "agent@ccc-a", disposition: "reminded", note: "x".repeat(AGENT_WORK_STATUS_TIMEOUT_DISPOSITION_NOTE_MAX + 1) }), null);
assert.equal(parseAgentWorkStatusTimeoutDispositionBody({ agentId: "bad id", disposition: "reminded" }), null);
assert.equal(parseAgentWorkStatusTimeoutDispositionBody({ agentId: "agent@ccc-a", disposition: "available" }), null);
assert.equal(parseAgentWorkStatusTimeoutDispositionBody({ agentId: "agent@ccc-a", disposition: "reminded", phone: "1" }), null);
assert.equal(agentWorkStatusTimeoutDispositionReadFilters({ from: "2026-11-04", to: null, disposition: "" }).includes("note"), false);
assert.equal(agentWorkStatusTimeoutDispositionRecordFilters("break", "reminded").includes("小休"), false);

const logs: AgentWorkStatusLog[] = [
  log({ id: "awsl_break", at: "2026-11-04T02:00:00.000Z", status: "break", reason: "=小休" }),
  log({ id: "awsl_short", agentId: "agent@ccc-short", at: "2026-11-04T02:25:00.000Z", status: "break" }),
  log({ id: "awsl_ready", agentId: "agent@ccc-ready", at: "2026-11-03T16:00:00.000Z", status: "available" }),
  log({ id: "awsl_asia", teamId: "asia", agentId: "agent@ccc-asia", at: "2026-11-04T01:00:00.000Z", status: "break", reason: "亚洲原因不要出现" })
];
const thresholds: AgentWorkStatusTimeout[] = [
  { id: "awst_break", teamId: "europe", status: "break", thresholdSeconds: 900, updatedBy: "u-manager", updatedAt: now.toISOString() },
  { id: "awst_asia", teamId: "asia", status: "break", thresholdSeconds: 60, updatedBy: "u-asia", updatedAt: now.toISOString() }
];

function memory() {
  const audits: AgentWorkStatusTimeoutDispositionAudit[] = [];
  const store = {
    agentWorkStatusLogs: logs.map((item) => ({ ...item })),
    agentWorkStatusTimeouts: thresholds.map((item) => ({ ...item })),
    agentWorkStatusTimeoutAudits: [],
    agentWorkStatusTimeoutDispositionAudits: audits,
    agentWorkStatusAudits: [],
    aliyunAgentMappings: [
      { teamId: "europe", cccUserId: "agent@ccc-a", displayName: "甲<script>", loginName: "a" },
      { teamId: "asia", cccUserId: "agent@ccc-asia", displayName: "亚洲坐席", loginName: "asia" }
    ],
    users: [
      { id: "u-manager", teamId: "europe", name: "主管甲" },
      { id: "u-asia", teamId: "asia", name: "亚洲主管" }
    ],
    async persist() {}
  };
  return { store: store as unknown as CrmStore, audits };
}

const manager = { id: "u-manager", teamId: "europe", role: "manager" } as SessionUser;
const sales = { id: "u-sales", teamId: "europe", role: "sales" } as SessionUser;
const asia = { id: "u-asia", teamId: "asia", role: "admin" } as SessionUser;

const { store, audits } = memory();
const logsBefore = JSON.stringify(store.agentWorkStatusLogs);
const thresholdsBefore = JSON.stringify(store.agentWorkStatusTimeouts);

const anonymous = await recordAgentWorkStatusTimeoutDisposition(store, undefined, { agentId: "agent@ccc-a", disposition: "reminded" }, now);
assert.equal(anonymous.status, 401);
assert.equal(audits.length, 0);

const bad = await recordAgentWorkStatusTimeoutDisposition(store, manager, { agentId: "agent@ccc-a", disposition: "noted" }, now);
assert.equal(bad.status, 400);
assert.equal(audits.length, 0);

const denied = await recordAgentWorkStatusTimeoutDisposition(store, sales, { agentId: "agent@ccc-a", disposition: "reminded", note: "机密备注不要进拒绝审计" }, now);
assert.equal(denied.status, 403);
assert.equal(JSON.stringify(denied.body).includes("机密备注"), false);
assert.equal(JSON.stringify(denied.body).includes("=小休"), false);
assert.equal(audits.length, 1);
assert.equal(audits[0]?.result, "rejected");
assert.equal(audits[0]?.note, "");
assert.equal(audits[0]?.filters.includes("机密备注"), false);

const missing = await recordAgentWorkStatusTimeoutDisposition(store, manager, { agentId: "agent@ccc-short", disposition: "reminded" }, now);
assert.equal(missing.status, 400);
assert.equal(missing.body.reason, "not_timeout");
const ready = await recordAgentWorkStatusTimeoutDisposition(store, manager, { agentId: "agent@ccc-ready", disposition: "acknowledged" }, now);
assert.equal(ready.body.reason, "not_timeout");
const other = await recordAgentWorkStatusTimeoutDisposition(store, manager, { agentId: "agent@ccc-asia", disposition: "reminded" }, now);
assert.equal(other.body.reason, "not_timeout");
assert.equal(audits.filter((item) => item.result === "recorded").length, 0);

const created = await recordAgentWorkStatusTimeoutDisposition(store, manager, { agentId: "agent@ccc-a", disposition: "reminded", note: "已提醒" }, now);
assert.equal(created.status, 200);
assert.equal(created.body.result, "recorded");
if (created.body.result === "recorded") {
  assert.equal(created.body.logId, "awsl_break");
  assert.equal(created.body.elapsedSeconds, 1800);
  assert.equal(created.body.thresholdSeconds, 900);
  assert.equal(created.body.status, "break");
}
assert.equal(audits.filter((item) => item.result === "recorded").length, 1);
assert.equal(audits.find((item) => item.result === "recorded")?.note, "已提醒");
assert.equal(audits.find((item) => item.result === "recorded")?.filters.includes("已提醒"), false);

const same = await recordAgentWorkStatusTimeoutDisposition(store, manager, { agentId: "agent@ccc-a", disposition: "reminded", note: "已提醒" }, now);
assert.equal(same.body.result, "unchanged");
assert.equal(audits.filter((item) => item.result === "recorded").length, 1);

const later = new Date("2026-11-04T02:31:00.000Z");
const noted = await recordAgentWorkStatusTimeoutDisposition(store, manager, { agentId: "agent@ccc-a", disposition: "noted", note: "=备注<script>" }, later);
assert.equal(noted.body.result, "recorded");
assert.equal(audits.filter((item) => item.result === "recorded").length, 2);

const viewed = await listAgentWorkStatusTimeoutDispositions(store, manager, { from: "2026-11-04", to: "2026-11-04" }, later);
assert.equal(viewed.status, 200);
if (viewed.status === 200) {
  assert.equal(viewed.body.timeZone, "Asia/Shanghai");
  assert.equal(viewed.body.rowCount, 2);
  assert.deepEqual(viewed.body.rows.map((row) => row.disposition), ["noted", "reminded"]);
  assert.equal(viewed.body.rows[0]?.atText, "2026-11-04 10:31");
  assert.equal(viewed.body.rows[1]?.atText, "2026-11-04 10:30");
  assert.equal(viewed.body.rows[0]?.label, "甲<script>");
  assert.equal(viewed.body.rows[0]?.actorLabel, "主管甲");
  assert.equal(viewed.body.rows[0]?.note, "=备注<script>");
  assert.equal(JSON.stringify(viewed.body).includes("亚洲原因不要出现"), false);
  assert.equal(JSON.stringify(viewed.body).includes("=小休"), false);
}
assert.equal(audits.filter((item) => item.result === "read").length, 1);

const yesterday = await listAgentWorkStatusTimeoutDispositions(store, manager, { from: "2026-11-03", to: "2026-11-03" }, now);
assert.equal(yesterday.status, 200);
if (yesterday.status === 200) assert.equal(yesterday.body.rowCount, 0);
const onlyNoted = await listAgentWorkStatusTimeoutDispositions(store, manager, { disposition: "noted" }, later);
assert.equal(onlyNoted.status, 200);
if (onlyNoted.status === 200) assert.deepEqual(onlyNoted.body.rows.map((row) => row.disposition), ["noted"]);

audits.unshift({
  id: "awstda_bad_time",
  teamId: "europe",
  actorId: "u-manager",
  at: "nope",
  action: "acknowledged",
  agentId: "agent@ccc-a",
  logId: "awsl_break",
  status: "break",
  note: "坏时间",
  elapsedSeconds: 1800,
  thresholdSeconds: 900,
  filters: "",
  rowCount: 0,
  result: "recorded",
  reason: ""
});
const withBad = buildAgentWorkStatusTimeoutDispositions({
  audits,
  mappings: store.aliyunAgentMappings || [],
  users: store.users || [],
  teamId: "europe",
  query: { from: null, to: null, disposition: "" },
  now: later
});
assert.equal(withBad.some((row) => row.id === "awstda_bad_time"), true);
assert.equal(withBad.at(-1)?.id, "awstda_bad_time");
const dated = buildAgentWorkStatusTimeoutDispositions({
  audits,
  mappings: [],
  users: [],
  teamId: "europe",
  query: { from: "2026-11-04", to: "2026-11-04", disposition: "" },
  now
});
assert.equal(dated.some((row) => row.id === "awstda_bad_time"), false);

const asiaRecord = await recordAgentWorkStatusTimeoutDisposition(store, asia, { agentId: "agent@ccc-asia", disposition: "acknowledged", note: "亚洲备注" }, now);
assert.equal(asiaRecord.body.result, "recorded");
const europeAgain = await listAgentWorkStatusTimeoutDispositions(store, manager, { disposition: "acknowledged" }, now);
assert.equal(europeAgain.status, 200);
if (europeAgain.status === 200) {
  assert.equal(europeAgain.body.rows.some((row) => row.note === "亚洲备注"), false);
  assert.equal(JSON.stringify(europeAgain.body).includes("亚洲坐席"), false);
}
const asiaList = await listAgentWorkStatusTimeoutDispositions(store, asia, {}, now);
assert.equal(asiaList.status, 200);
if (asiaList.status === 200) {
  assert.equal(asiaList.body.rows.length, 1);
  assert.equal(asiaList.body.rows[0]?.label, "亚洲坐席");
  assert.equal(JSON.stringify(asiaList.body).includes("=备注"), false);
}

const salesList = await listAgentWorkStatusTimeoutDispositions(store, sales, {}, now);
assert.equal(salesList.status, 403);
assert.equal(JSON.stringify(salesList.body).includes("=备注"), false);
const badList = await listAgentWorkStatusTimeoutDispositions(store, manager, { from: "2026-11-05", to: "2026-11-04" }, now);
assert.equal(badList.status, 400);

store.agentWorkStatusLogs.unshift(log({ id: "awsl_break_next", at: "2026-11-04T02:10:00.000Z", status: "break", reason: "=小休" }));
const nextSegment = await recordAgentWorkStatusTimeoutDisposition(store, manager, { agentId: "agent@ccc-a", disposition: "reminded", note: "已提醒" }, now);
assert.equal(nextSegment.body.result, "recorded");
if (nextSegment.body.result === "recorded") assert.equal(nextSegment.body.logId, "awsl_break_next");

assert.equal(JSON.stringify(store.agentWorkStatusTimeouts), thresholdsBefore);
const auditText = JSON.stringify(audits);
assert.equal(auditText.includes("=小休"), false);
assert.equal(auditText.includes("亚洲原因不要出现"), false);
assert.equal(auditText.includes("甲<script>"), false);
assert.equal(auditText.includes("AccessKey"), false);
assert.equal(auditText.includes("机密备注不要进拒绝审计"), false);
assert.equal(logsBefore.includes("awsl_break_next"), false);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS agent_work_status_timeout_disposition_audits \(/);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS agent_work_status_timeout_disposition_audits \(/g) || []).length, 1);
assert.match(schema, /INSERT INTO agent_work_status_timeout_disposition_audits/);
assert.match(schema, /team_id <> '' AND team_id <> 'all' AND team_id = ''/);
assert.equal(schema.includes("DROP TABLE agent_work_status_timeout_disposition_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS agent_work_status_timeouts"), false);
assert.equal(schema.includes("DROP TABLE agent_work_status_timeout_audits"), false);
assert.equal(schema.includes("ALTER TABLE agent_work_status_logs"), false);
assert.equal(schema.includes("ALTER TABLE agent_work_status_timeouts"), false);
assert.equal(schema.includes("ALTER TABLE agent_work_status_timeout_audits"), false);
assert.equal(schema.includes("UPDATE agent_work_status_timeouts"), false);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS agent_work_status_logs \(/g) || []).length, 1);

const source = readFileSync(new URL("./agent-work-status-timeout-disposition.ts", import.meta.url), "utf8");
assert.equal(source.includes("PollUserStatus"), false);
assert.equal(source.includes("ListUsers"), false);
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("nodemailer"), false);
assert.equal(source.includes("fetch("), false);

console.log("agent work status timeout disposition tests passed");
