import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  agentWorkStatusReportDayStartMs,
  agentWorkStatusReportFiltersText,
  agentWorkStatusReportWindow,
  buildAgentWorkStatusReport,
  buildAgentWorkStatusReportCsv,
  listAgentWorkStatusReport,
  parseAgentWorkStatusReportQuery,
  summarizeWorkStatusRange,
  type AgentWorkStatusReportSource
} from "./agent-work-status-report.js";
import type { CrmStore } from "./store.js";
import type { AgentWorkStatusAudit, AgentWorkStatusLog, AgentWorkStatusReportAudit, SessionUser } from "./types.js";

const now = new Date("2026-11-04T02:30:00.000Z");

assert.deepEqual(parseAgentWorkStatusReportQuery({}), { from: null, to: null, agentId: null });
assert.deepEqual(parseAgentWorkStatusReportQuery({ from: "2026-11-04", to: "2026-11-04", agentId: "agent@ccc-a" }), {
  from: "2026-11-04",
  to: "2026-11-04",
  agentId: "agent@ccc-a"
});
assert.equal(parseAgentWorkStatusReportQuery({ from: "2026-11-05", to: "2026-11-04" }), null);
assert.equal(parseAgentWorkStatusReportQuery({ from: "2026-02-31" }), null);
assert.equal(parseAgentWorkStatusReportQuery({ from: ["2026-11-04"] }), null);
assert.equal(parseAgentWorkStatusReportQuery({ agentId: "not an agent" }), null);
assert.equal(parseAgentWorkStatusReportQuery({ plaintext: "1" }), null);
assert.equal(agentWorkStatusReportFiltersText({ from: "2026-11-04", to: null, agentId: "agent@ccc-a" }).includes("=休息"), false);
assert.equal(new Date(agentWorkStatusReportDayStartMs("2026-11-04")).toISOString(), "2026-11-03T16:00:00.000Z");

const today = agentWorkStatusReportWindow({ from: "2026-11-04", to: "2026-11-04", agentId: null }, now);
assert.equal(today.start, Date.parse("2026-11-03T16:00:00.000Z"));
assert.equal(today.end, now.getTime());
assert.equal(today.inclusiveEnd, true);
const yesterday = agentWorkStatusReportWindow({ from: "2026-11-03", to: "2026-11-03", agentId: null }, now);
assert.equal(yesterday.end, Date.parse("2026-11-03T16:00:00.000Z"));
assert.equal(yesterday.inclusiveEnd, false);

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

assert.deepEqual(summarizeWorkStatusRange([], 0, 10_000, true), {
  availableSeconds: null,
  busySeconds: null,
  breakSeconds: null
});
assert.deepEqual(summarizeWorkStatusRange([
  log({ id: "short", at: new Date(0).toISOString(), status: "available" })
], 0, 1500, true), {
  availableSeconds: 1,
  busySeconds: 0,
  breakSeconds: 0
});
assert.deepEqual(summarizeWorkStatusRange([
  log({ id: "tiny", at: new Date(0).toISOString(), status: "busy" })
], 0, 400, true).busySeconds, 0);
assert.equal(summarizeWorkStatusRange([
  log({ id: "future-log", at: new Date(5_000).toISOString(), status: "available" })
], 10_000, 5_000, true).availableSeconds, null);

const split = summarizeWorkStatusRange([
  log({ id: "back", at: new Date(2_000).toISOString(), status: "available" }),
  log({ id: "mid", at: new Date(1_500).toISOString(), status: "busy" }),
  log({ id: "open", at: new Date(0).toISOString(), status: "available" })
], 0, 3_500, true);
assert.equal(split.availableSeconds, 3);
assert.equal(split.busySeconds, 0);

const tied = summarizeWorkStatusRange([
  log({ id: "later", at: new Date(0).toISOString(), status: "break" }),
  log({ id: "earlier", at: new Date(0).toISOString(), status: "busy" })
], 0, 5_000, true);
assert.equal(tied.breakSeconds, 5);
assert.equal(tied.busySeconds, 0);
assert.equal(tied.availableSeconds, 0);

const ignored = summarizeWorkStatusRange([
  log({ id: "bad-time", at: "not-a-time", status: "available" }),
  log({ id: "cloud", at: new Date(0).toISOString(), status: "ON_SITE" as AgentWorkStatusLog["status"] })
], 0, 5_000, true);
assert.equal(ignored.availableSeconds, null);

const source: AgentWorkStatusReportSource = {
  logs: [
    log({ id: "awsl_break", at: "2026-11-04T02:00:00.000Z", status: "break", source: "manager", actorId: "u-manager", reason: "=休息" }),
    log({ id: "awsl_busy", at: "2026-11-03T16:10:00.000Z", status: "busy" }),
    log({ id: "awsl_open", at: "2026-11-03T15:00:00.000Z", status: "available", reason: "夜班" }),
    log({ id: "awsl_old", agentId: "agent@ccc-old", at: "2026-11-03T16:00:00.000Z", status: "available" }),
    log({ id: "awsl_before", agentId: "agent@ccc-carry", at: "2026-11-02T00:00:00.000Z", status: "available" }),
    log({ id: "awsl_carry", agentId: "agent@ccc-carry", at: "2026-11-03T15:00:00.000Z", status: "busy" }),
    log({ id: "awsl_asia", teamId: "asia", agentId: "agent@ccc-asia", at: "2026-11-03T16:00:00.000Z", status: "available", reason: "亚洲原因不要出现" }),
    log({ id: "awsl_bad", at: "nope", status: "available", reason: "坏时间" })
  ],
  audits: [
    {
      id: "awsa_break",
      teamId: "europe",
      actorId: "u-manager",
      at: "2026-11-04T02:00:00.000Z",
      agentId: "agent@ccc-a",
      action: "reset",
      previousStatus: "busy",
      nextStatus: "break",
      reason: "=休息",
      result: "updated",
      reasonCode: ""
    },
    {
      id: "awsa_reject",
      teamId: "europe",
      actorId: "u-manager",
      at: "2026-11-04T01:00:00.000Z",
      agentId: "agent@ccc-a",
      action: "reset",
      previousStatus: "",
      nextStatus: "available",
      reason: "拒绝原因",
      result: "rejected",
      reasonCode: "forbidden"
    },
    {
      id: "awsa_mia",
      teamId: "europe",
      actorId: "u-manager",
      at: "2026-11-04T01:30:00.000Z",
      agentId: "agent@ccc-b",
      action: "reset",
      previousStatus: "",
      nextStatus: "busy",
      reason: "没有日志",
      result: "rejected",
      reasonCode: "forbidden"
    },
    {
      id: "awsa_old_reject",
      teamId: "europe",
      actorId: "u-manager",
      at: "2026-11-02T01:00:00.000Z",
      agentId: "agent@ccc-a",
      action: "reset",
      previousStatus: "",
      nextStatus: "available",
      reason: "昨天的拒绝",
      result: "rejected",
      reasonCode: "forbidden"
    }
  ],
  mappings: [
    { teamId: "europe", cccUserId: "agent@ccc-a", displayName: "甲<script>", loginName: "a" },
    { teamId: "europe", cccUserId: "agent@ccc-b", displayName: "乙", loginName: "b" },
    { teamId: "asia", cccUserId: "agent@ccc-asia", displayName: "亚洲", loginName: "asia" }
  ],
  users: [
    { id: "u1", teamId: "europe", name: "甲" },
    { id: "u-manager", teamId: "europe", name: "主管" }
  ]
};

const query = { from: "2026-11-04", to: "2026-11-04", agentId: null };
const built = buildAgentWorkStatusReport({ source, teamId: "europe", query, now });
assert.equal(built.denied, false);
assert.equal(built.timeline, null);
const shirley = built.agents.find((item) => item.agentId === "agent@ccc-a");
const mia = built.agents.find((item) => item.agentId === "agent@ccc-b");
const old = built.agents.find((item) => item.agentId === "agent@ccc-old");
const carry = built.agents.find((item) => item.agentId === "agent@ccc-carry");
assert.ok(shirley && mia && old && carry);
assert.equal(shirley.availableSeconds, 600);
assert.equal(shirley.busySeconds, 35400);
assert.equal(shirley.breakSeconds, 1800);
assert.equal(shirley.label, "甲<script>");
assert.equal(mia.availableSeconds, null);
assert.equal(mia.busySeconds, null);
assert.equal(mia.breakSeconds, null);
assert.equal(old.availableSeconds, 37800);
assert.equal(old.busySeconds, 0);
assert.equal(old.breakSeconds, 0);
assert.equal(carry.busySeconds, 600 + 35400 + 1800);
assert.equal(carry.availableSeconds, 0);
assert.equal(built.agents.some((item) => item.agentId === "agent@ccc-asia"), false);

const priorOnly = buildAgentWorkStatusReport({
  source,
  teamId: "europe",
  query: { from: "2026-11-04", to: "2026-11-04", agentId: "agent@ccc-carry" },
  now
});
assert.equal(priorOnly.timeline?.some((item) => item.id === "awsl_before"), false);
assert.equal(priorOnly.timeline?.find((item) => item.kind === "opening")?.id, "awsl_carry");

const drilled = buildAgentWorkStatusReport({
  source,
  teamId: "europe",
  query: { from: "2026-11-04", to: "2026-11-04", agentId: "agent@ccc-a" },
  now
});
assert.equal(drilled.timeline?.length, 4);
assert.equal(drilled.timeline?.[0]?.id, "awsl_break");
assert.equal(drilled.timeline?.find((item) => item.id === "awsl_break")?.previousStatus, "busy");
assert.equal(drilled.timeline?.find((item) => item.id === "awsl_open")?.kind, "opening");
assert.equal(drilled.timeline?.find((item) => item.id === "awsl_open")?.previousStatus, "");
assert.equal(drilled.timeline?.find((item) => item.id === "awsa_reject")?.counted, false);
assert.equal(drilled.timeline?.some((item) => item.id === "awsa_old_reject"), false);
assert.equal(drilled.agents.find((item) => item.agentId === "agent@ccc-a")?.breakSeconds, 1800);

const miaLine = buildAgentWorkStatusReport({
  source,
  teamId: "europe",
  query: { from: "2026-11-04", to: "2026-11-04", agentId: "agent@ccc-b" },
  now
});
assert.equal(miaLine.agents.find((item) => item.agentId === "agent@ccc-b")?.availableSeconds, null);
assert.equal(miaLine.timeline?.length, 1);
assert.equal(miaLine.timeline?.[0]?.counted, false);

const hidden = buildAgentWorkStatusReport({
  source,
  teamId: "europe",
  query: { from: "2026-11-04", to: "2026-11-04", agentId: "agent@missing" },
  now
});
assert.equal(hidden.denied, true);
assert.deepEqual(hidden.agents, []);

const future = buildAgentWorkStatusReport({
  source,
  teamId: "europe",
  query: { from: "2026-11-05", to: "2026-11-05", agentId: "agent@ccc-a" },
  now
});
assert.equal(future.agents.find((item) => item.agentId === "agent@ccc-a")?.availableSeconds, null);
assert.deepEqual(future.timeline, []);

const yesterdayReport = buildAgentWorkStatusReport({
  source,
  teamId: "europe",
  query: { from: "2026-11-03", to: "2026-11-03", agentId: null },
  now
});
const yesterdayShirley = yesterdayReport.agents.find((item) => item.agentId === "agent@ccc-a");
assert.equal(yesterdayShirley?.availableSeconds, 3600);
assert.equal(yesterdayShirley?.busySeconds, 0);
assert.equal(yesterdayShirley?.breakSeconds, 0);

const csv = buildAgentWorkStatusReportCsv(drilled.agents, drilled.timeline);
assert.equal(csv.charCodeAt(0), 0xfeff);
assert.match(csv, /种类,坐席,坐席 ID,可接听秒,忙碌秒,小休秒,时间,状态,来源,原因,操作人,改前状态,计入时长/);
assert.match(csv, /600,35400,1800/);
assert.match(csv, /乙,agent@ccc-b,—,—,—/);
assert.match(csv, /37800,0,0/);
assert.match(csv, /'=休息/);
assert.match(csv, /未生效的改回/);
assert.match(csv, /延续进入/);
assert.equal(csv.includes("亚洲原因不要出现"), false);
assert.equal(csv.includes("接通率"), false);
assert.equal(csv.includes("利用率"), false);
assert.match(csv, /\r\n/);

const summaryOnly = buildAgentWorkStatusReportCsv(built.agents, null);
assert.equal(summaryOnly.includes("延续进入"), false);
assert.equal(summaryOnly.includes("拒绝原因"), false);

function memory() {
  const audits: AgentWorkStatusReportAudit[] = [];
  const store = {
    users: [{ id: "u-manager", teamId: "europe", name: "主管", role: "manager" }],
    aliyunAgentMappings: source.mappings.map((item, index) => ({
      id: `map-${index}`,
      teamId: item.teamId,
      crmUserId: "u1",
      cccUserId: item.cccUserId,
      loginName: item.loginName,
      displayName: item.displayName,
      extension: "",
      workMode: "ON_SITE",
      updatedBy: "admin",
      updatedAt: "2026-11-01T00:00:00.000Z"
    })),
    agentWorkStatusLogs: source.logs,
    agentWorkStatusAudits: source.audits,
    agentWorkStatusReportAudits: audits,
    async persist() {}
  };
  return { store: store as unknown as CrmStore, audits };
}

const { store, audits } = memory();
const sales = { id: "u-sales", teamId: "europe", role: "sales" } as SessionUser;
const manager = { id: "u-manager", teamId: "europe", role: "manager", name: "主管" } as SessionUser;
const logsBefore = store.agentWorkStatusLogs.length;
const statusAuditsBefore = store.agentWorkStatusAudits.length;

const anonymous = await listAgentWorkStatusReport(store, undefined, {}, now);
assert.equal(anonymous.status, 401);
assert.equal(audits.length, 0);
const bad = await listAgentWorkStatusReport(store, manager, { from: "2026-11-05", to: "2026-11-04" }, now);
assert.equal(bad.status, 400);
assert.equal(audits.length, 0);
const denied = await listAgentWorkStatusReport(store, sales, { from: "2026-11-04", to: "2026-11-04" }, now);
assert.equal(denied.status, 403);
assert.equal(denied.body.reason, "forbidden");
assert.equal("agents" in denied.body, false);
assert.equal(audits[0]?.result, "rejected");
assert.equal(audits[0]?.rowCount, 0);
assert.equal(audits[0]?.filters.includes("=休息"), false);
const viewed = await listAgentWorkStatusReport(store, manager, { from: "2026-11-04", to: "2026-11-04" }, now);
assert.equal(viewed.status, 200);
if (viewed.status !== 200) throw new Error("expected report");
assert.equal(viewed.body.timeZone, "Asia/Shanghai");
assert.equal(viewed.body.today, "2026-11-04");
assert.equal(viewed.body.rowCount, 4);
assert.equal(viewed.body.timeline, null);
assert.equal(viewed.body.agents.find((item) => item.agentId === "agent@ccc-a")?.availableSeconds, 600);
assert.equal(viewed.body.agents.find((item) => item.agentId === "agent@ccc-b")?.busySeconds, null);
assert.equal(JSON.stringify(viewed.body).includes("接通率"), false);
assert.equal(JSON.stringify(viewed.body).includes("亚洲原因不要出现"), false);
const missing = await listAgentWorkStatusReport(store, manager, { agentId: "agent@missing" }, now);
assert.equal(missing.status, 403);
assert.equal("agents" in missing.body, false);
assert.equal(store.agentWorkStatusLogs.length, logsBefore);
assert.equal(store.agentWorkStatusAudits.length, statusAuditsBefore);
assert.equal(store.aliyunAgentMappings[0]?.workMode, "ON_SITE");

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS agent_work_status_report_audits \(/);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS agent_work_status_report_audits \(/g) || []).length, 1);
assert.match(schema, /INSERT INTO agent_work_status_report_audits/);
assert.match(schema, /team_id = ''/);
assert.equal(schema.includes("DROP TABLE agent_work_status_report_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS agent_work_status_report_audits"), false);
assert.equal(schema.includes("ALTER TABLE agent_work_status_logs"), false);
assert.equal(schema.includes("ALTER TABLE agent_work_status_audits"), false);
assert.equal(schema.includes("CREATE TABLE agent_work_status "), false);

const reportSource = readFileSync(new URL("./agent-work-status-report.ts", import.meta.url), "utf8");
assert.equal(reportSource.includes("aliyuncs.com"), false);
assert.equal(reportSource.includes("MakeCall"), false);
assert.equal(reportSource.includes("PollUserStatus"), false);
assert.equal(reportSource.includes("ListUsers"), false);
assert.equal(reportSource.includes("workMode"), false);
assert.equal(reportSource.includes("convert_to_lead"), false);
assert.equal(reportSource.includes("approved_contactable"), false);
assert.equal(reportSource.includes("接通率"), false);
assert.equal(reportSource.includes("利用率"), false);

console.log("agent work status report unit tests passed");
