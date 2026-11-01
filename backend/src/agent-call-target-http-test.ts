import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start agent call target test server");
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

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "agentIds" | "startTimeRaw">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    targetType: "customer",
    targetId: "c1",
    maskedNumber: "*******2333",
    contactType: "OUTBOUND",
    contactDisposition: "NoAnswer",
    earlyMediaState: "",
    callDurationRaw: "10",
    establishedTimeRaw: "",
    releaseTimeRaw: "",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/do-not-leak-target",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "",
    callOutcomeNote: "",
    callNote: "",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

try {
  const store = getStore();
  setOutboundNowForTests(new Date("2026-04-04T12:00:00.000Z"));
  setTenantTimezoneOverride(store, "europe", "America/New_York");
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const alexUser = store.users.find((item) => item.email === "alex@keduoduo.com");
  const adminUser = store.users.find((item) => item.email === "admin@keduoduo.com");
  assert.ok(shirleyUser && miaUser && alexUser && adminUser);
  store.users.push({
    ...shirleyUser,
    id: "u_no_target_read",
    name: "No Target Read",
    email: "no-target-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...adminUser,
    id: "u_target_asia_admin",
    name: "Asia Target Admin",
    email: "asia-target-admin@keduoduo.com",
    role: "admin",
    teamId: "asia",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_no_target_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };

  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const sequencesBefore = store.outreachSequences.length;
  const plansBefore = store.prospectOutreachPlans.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const recordsBefore = store.outboundCallRecords.map((item) => JSON.stringify(item));
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);

  store.aliyunAgentMappings.push(
    {
      id: "map_tgt_shirley",
      teamId: "europe",
      crmUserId: shirleyUser.id,
      cccUserId: "agent@ccc-tgt-a",
      loginName: "shirley",
      displayName: "Shirley坐席",
      extension: "8301",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_tgt_mia",
      teamId: "europe",
      crmUserId: miaUser.id,
      cccUserId: "agent@ccc-tgt-b",
      loginName: "mia",
      displayName: "Mia坐席",
      extension: "8302",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_tgt_alex",
      teamId: "europe",
      crmUserId: alexUser.id,
      cccUserId: "agent@ccc-tgt-alex",
      loginName: "alex",
      displayName: "Alex坐席",
      extension: "8303",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_tgt_asia",
      teamId: "asia",
      crmUserId: "u_target_asia_admin",
      cccUserId: "agent@ccc-tgt-asia",
      loginName: "asia",
      displayName: "亚洲坐席",
      extension: "8304",
      workMode: "ON_SITE",
      updatedBy: "u_target_asia_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    }
  );
  store.agentCallTargets.push({
    id: "act_orphan",
    teamId: "europe",
    agentId: "agent@ccc-tgt-orphan",
    dialTarget: 4,
    connectedTarget: 2,
    intentTarget: 1,
    updatedBy: "u_admin",
    updatedAt: "2026-04-01T00:00:00.000Z"
  });
  const today = String(Date.parse("2026-04-04T02:00:00.000Z"));
  store.outboundCallRecords.push(
    record({ id: "ocr_tgt_intent", agentIds: "agent@ccc-tgt-a", establishedTimeRaw: "1", callOutcome: "有意向", startTimeRaw: today }),
    record({ id: "ocr_tgt_connected", agentIds: "agent@ccc-tgt-a", establishedTimeRaw: "2", startTimeRaw: String(Date.parse("2026-04-04T03:00:00.000Z")) }),
    record({ id: "ocr_tgt_success", agentIds: "agent@ccc-tgt-a", establishedTimeRaw: "", contactDisposition: "Success", callOutcome: "需回访", startTimeRaw: String(Date.parse("2026-04-04T04:00:00.000Z")) }),
    record({ id: "ocr_tgt_blank", agentIds: "agent@ccc-tgt-a", establishedTimeRaw: "  ", startTimeRaw: String(Date.parse("2026-04-04T05:00:00.000Z")) }),
    record({ id: "ocr_tgt_yesterday", agentIds: "agent@ccc-tgt-a", establishedTimeRaw: "9", callOutcome: "有意向", startTimeRaw: String(Date.parse("2026-04-03T15:30:00.000Z")) }),
    record({ id: "ocr_tgt_boundary", agentIds: "agent@ccc-tgt-a", establishedTimeRaw: "8", startTimeRaw: String(Date.parse("2026-04-03T16:00:00.000Z")) }),
    record({ id: "ocr_tgt_shared", agentIds: "agent@ccc-tgt-a, agent@ccc-tgt-b", establishedTimeRaw: "3", startTimeRaw: String(Date.parse("2026-04-04T06:00:00.000Z")) }),
    record({ id: "ocr_tgt_none", agentIds: "", establishedTimeRaw: "4", callOutcome: "有意向", startTimeRaw: today }),
    record({ id: "ocr_tgt_asia", teamId: "asia", agentIds: "agent@ccc-tgt-asia", establishedTimeRaw: "5", callOutcome: "有意向", startTimeRaw: today }),
    record({ id: "ocr_tgt_alex", agentIds: "agent@ccc-tgt-alex", establishedTimeRaw: "", startTimeRaw: today })
  );

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const noRead = await login("no-target-read@keduoduo.com");
  const asia = await login("asia-target-admin@keduoduo.com");

  const created = await request("/api/agent-call-targets", admin, "POST", {
    agentId: "agent@ccc-tgt-a",
    dialTarget: 20,
    connectedTarget: 8,
    intentTarget: 3
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.json.result, "updated");
  assert.equal(created.json.target.dialTarget, 20);
  assert.equal(created.json.progress.dialed, 6);
  assert.equal(created.json.progress.connected, 4);
  assert.equal(created.json.progress.intent, 1);
  const createdAudit = store.agentCallTargetAudits.find((item) => item.agentId === "agent@ccc-tgt-a" && item.action === "set");
  assert.ok(createdAudit);
  assert.equal(createdAudit.actorId, adminUser.id);
  assert.equal(createdAudit.previousValue, "");
  assert.equal(createdAudit.nextValue, "20|8|3");
  assert.equal(createdAudit.result, "updated");

  const same = await request("/api/agent-call-targets", admin, "POST", {
    agentId: "agent@ccc-tgt-a",
    dialTarget: 20,
    connectedTarget: 8,
    intentTarget: 3
  });
  assert.equal(same.response.status, 200);
  assert.equal(same.json.result, "unchanged");
  assert.equal(store.agentCallTargetAudits.filter((item) => item.agentId === "agent@ccc-tgt-a" && item.action === "set").length, 1);

  const updated = await request("/api/agent-call-targets", admin, "POST", {
    agentId: "agent@ccc-tgt-a",
    dialTarget: 20,
    connectedTarget: 8
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.json.result, "updated");
  assert.equal(updated.json.target.intentTarget, null);
  const updateAudit = store.agentCallTargetAudits.find((item) => item.agentId === "agent@ccc-tgt-a" && item.action === "update");
  assert.ok(updateAudit);
  assert.equal(updateAudit.previousValue, "20|8|3");
  assert.equal(updateAudit.nextValue, "20|8|");

  const zero = await request("/api/agent-call-targets", admin, "POST", {
    agentId: "agent@ccc-tgt-b",
    dialTarget: 0,
    connectedTarget: 10000,
    intentTarget: 0
  });
  assert.equal(zero.response.status, 200);
  assert.equal(zero.json.target.intentTarget, 0);

  const auditsBeforeInvalid = store.agentCallTargetAudits.length;
  for (const body of [
    { agentId: "agent@ccc-tgt-a", dialTarget: 10001, connectedTarget: 1 },
    { agentId: "agent@ccc-tgt-a", dialTarget: -1, connectedTarget: 1 },
    { agentId: "agent@ccc-tgt-a", dialTarget: 1.5, connectedTarget: 1 },
    { agentId: "agent@ccc-tgt-a", dialTarget: "20", connectedTarget: 1 },
    { agentId: "agent@ccc-tgt-a", dialTarget: 1, connectedTarget: 1, intentTarget: "" },
    { agentId: "agent@ccc-tgt-a", connectedTarget: 1 },
    [{ agentId: "agent@ccc-tgt-a", dialTarget: 1, connectedTarget: 1 }],
    { agentId: "agent@ccc-tgt-a", dialTarget: 1, connectedTarget: 1, targets: [] },
    { agentId: "agent@ccc-tgt-a", dialTarget: 1, connectedTarget: 1, agentIds: ["a"] }
  ]) {
    const rejected = await request("/api/agent-call-targets", admin, "POST", body);
    assert.equal(rejected.response.status, 400, JSON.stringify(body));
  }
  assert.equal(store.agentCallTargetAudits.length, auditsBeforeInvalid);
  assert.equal(store.agentCallTargets.find((item) => item.agentId === "agent@ccc-tgt-a")?.dialTarget, 20);

  const salesSet = await request("/api/agent-call-targets", shirley, "POST", {
    agentId: "agent@ccc-tgt-a",
    dialTarget: 1,
    connectedTarget: 1
  });
  assert.equal(salesSet.response.status, 403);
  assert.equal(salesSet.json.reason, "forbidden");
  assert.equal(store.agentCallTargets.find((item) => item.agentId === "agent@ccc-tgt-a")?.dialTarget, 20);
  assert.equal(store.agentCallTargetAudits.some((item) => item.actorId === shirleyUser.id && item.result === "rejected" && item.action === "update"), true);

  const managerSet = await request("/api/agent-call-targets", alex, "POST", {
    agentId: "agent@ccc-tgt-alex",
    dialTarget: 9,
    connectedTarget: 1
  });
  assert.equal(managerSet.response.status, 403);
  assert.equal(store.agentCallTargets.some((item) => item.agentId === "agent@ccc-tgt-alex"), false);
  assert.equal(store.agentCallTargetAudits.some((item) => item.actorId === alexUser.id && item.action === "set" && item.result === "rejected"), true);

  const wrapMissing = await request("/api/agent-call-targets", alex, "POST", {
    agentId: "agent@ccc-tgt-alex",
    wrapupTarget: 4
  });
  assert.equal(wrapMissing.response.status, 400);
  assert.equal(wrapMissing.json.reason, "no_target");
  assert.equal(store.agentCallTargets.some((item) => item.agentId === "agent@ccc-tgt-alex"), false);
  assert.equal(store.agentCallTargetAudits.some((item) => item.actorId === alexUser.id && item.agentId === "agent@ccc-tgt-alex" && item.reason === "no_target" && item.nextValue === "|||4" && item.result === "rejected"), true);

  const alexBase = await request("/api/agent-call-targets", admin, "POST", {
    agentId: "agent@ccc-tgt-alex",
    dialTarget: 10,
    connectedTarget: 2
  });
  assert.equal(alexBase.response.status, 200);
  assert.equal(alexBase.json.target.dialTarget, 10);
  assert.equal(alexBase.json.target.wrapupTarget, null);
  assert.equal(alexBase.json.target.intentTarget, null);

  const salesWrap = await request("/api/agent-call-targets", shirley, "POST", {
    agentId: "agent@ccc-tgt-a",
    wrapupTarget: 9
  });
  assert.equal(salesWrap.response.status, 403);
  assert.equal(salesWrap.json.reason, "forbidden");
  assert.equal(store.agentCallTargets.find((item) => item.agentId === "agent@ccc-tgt-a")?.dialTarget, 20);
  assert.equal(store.agentCallTargets.find((item) => item.agentId === "agent@ccc-tgt-a")?.wrapupTarget ?? null, null);

  const managerWrap = await request("/api/agent-call-targets", alex, "POST", {
    agentId: "agent@ccc-tgt-alex",
    wrapupTarget: 4
  });
  assert.equal(managerWrap.response.status, 200);
  assert.equal(managerWrap.json.result, "updated");
  assert.equal(managerWrap.json.target.wrapupTarget, 4);
  assert.equal(managerWrap.json.target.dialTarget, 10);
  assert.equal(managerWrap.json.target.connectedTarget, 2);
  assert.equal(managerWrap.json.target.intentTarget, null);
  const wrapAudit = store.agentCallTargetAudits.find((item) => item.actorId === alexUser.id && item.agentId === "agent@ccc-tgt-alex" && item.result === "updated");
  assert.ok(wrapAudit);
  assert.equal(wrapAudit.action, "update");
  assert.equal(wrapAudit.previousValue, "10|2|");
  assert.equal(wrapAudit.nextValue, "10|2||4");

  const wrapSame = await request("/api/agent-call-targets", alex, "POST", {
    agentId: "agent@ccc-tgt-alex",
    wrapupTarget: 4
  });
  assert.equal(wrapSame.response.status, 200);
  assert.equal(wrapSame.json.result, "unchanged");
  assert.equal(store.agentCallTargetAudits.filter((item) => item.actorId === alexUser.id && item.agentId === "agent@ccc-tgt-alex" && item.result === "updated").length, 1);

  const preserved = await request("/api/agent-call-targets", admin, "POST", {
    agentId: "agent@ccc-tgt-alex",
    dialTarget: 11,
    connectedTarget: 2
  });
  assert.equal(preserved.response.status, 200);
  assert.equal(preserved.json.target.dialTarget, 11);
  assert.equal(preserved.json.target.wrapupTarget, 4);
  const preservedAudit = store.agentCallTargetAudits.find((item) => item.agentId === "agent@ccc-tgt-alex" && item.nextValue === "11|2||4" && item.result === "updated");
  assert.ok(preservedAudit);
  assert.equal(preservedAudit.previousValue, "10|2||4");

  const clearedWrap = await request("/api/agent-call-targets", alex, "POST", {
    agentId: "agent@ccc-tgt-alex",
    wrapupTarget: null
  });
  assert.equal(clearedWrap.response.status, 200);
  assert.equal(clearedWrap.json.target.wrapupTarget, null);
  assert.equal(clearedWrap.json.target.dialTarget, 11);
  assert.equal(store.agentCallTargetAudits.some((item) => item.agentId === "agent@ccc-tgt-alex" && item.previousValue === "11|2||4" && item.nextValue === "11|2|" && item.result === "updated"), true);

  const zeroWrap = await request("/api/agent-call-targets", alex, "POST", {
    agentId: "agent@ccc-tgt-alex",
    wrapupTarget: 0
  });
  assert.equal(zeroWrap.response.status, 200);
  assert.equal(zeroWrap.json.target.wrapupTarget, 0);
  assert.equal(store.agentCallTargets.find((item) => item.agentId === "agent@ccc-tgt-alex")?.dialTarget, 11);

  const teammateWrap = await request("/api/agent-call-targets", alex, "POST", {
    agentId: "agent@ccc-tgt-a",
    wrapupTarget: 6
  });
  assert.equal(teammateWrap.response.status, 200);
  assert.equal(teammateWrap.json.target.wrapupTarget, 6);
  assert.equal(teammateWrap.json.target.dialTarget, 20);
  assert.equal(teammateWrap.json.target.connectedTarget, 8);
  const teammateClear = await request("/api/agent-call-targets", alex, "POST", {
    agentId: "agent@ccc-tgt-a",
    wrapupTarget: null
  });
  assert.equal(teammateClear.response.status, 200);
  assert.equal(store.agentCallTargets.find((item) => item.agentId === "agent@ccc-tgt-a")?.wrapupTarget ?? null, null);
  assert.equal(store.agentCallTargets.find((item) => item.agentId === "agent@ccc-tgt-a")?.dialTarget, 20);

  const foreignWrap = await request("/api/agent-call-targets", alex, "POST", {
    agentId: "agent@ccc-tgt-asia",
    wrapupTarget: 6
  });
  assert.equal(foreignWrap.response.status, 403);
  assert.equal(store.agentCallTargets.some((item) => item.teamId === "europe" && item.agentId === "agent@ccc-tgt-asia"), false);

  const auditsBeforeBadWrap = store.agentCallTargetAudits.length;
  const badWrap = await request("/api/agent-call-targets", alex, "POST", {
    agentId: "agent@ccc-tgt-alex",
    wrapupTarget: 10001
  });
  assert.equal(badWrap.response.status, 400);
  assert.equal(store.agentCallTargetAudits.length, auditsBeforeBadWrap);
  assert.equal(store.agentCallTargets.find((item) => item.agentId === "agent@ccc-tgt-alex")?.wrapupTarget, 0);

  const own = await request("/api/agent-call-targets", shirley);
  assert.equal(own.response.status, 200);
  assert.equal(own.json.canManage, false);
  assert.equal(own.json.timeZone, "Asia/Shanghai");
  assert.equal(own.json.today, "2026-04-04");
  assert.equal(own.json.criteria.connectedBy, "establishedTimeRaw");
  assert.equal(own.json.criteria.intentBy, "有意向");
  assert.equal(own.json.rows.length, 1);
  assert.equal(own.json.rows[0].agentId, "agent@ccc-tgt-a");
  assert.equal(own.json.rows[0].displayName, "Shirley坐席");
  assert.equal(own.json.rows[0].dialed, 6);
  assert.equal(own.json.rows[0].connected, 4);
  assert.equal(own.json.rows[0].intent, 1);
  assert.equal(own.json.rows[0].dialTarget, 20);
  assert.equal(own.json.rows[0].connectedTarget, 8);
  assert.equal(own.json.rows[0].intentTarget, null);
  assert.equal(own.text.includes("*******2333"), false);
  assert.equal(own.text.includes("do-not-leak-target"), false);

  const other = await request("/api/agent-call-targets?agentId=agent@ccc-tgt-b", shirley);
  assert.equal(other.response.status, 403);
  assert.equal(other.json.rows, undefined);
  assert.equal(store.agentCallTargetAudits.some((item) => item.actorId === shirleyUser.id && item.action === "read" && item.agentId === "agent@ccc-tgt-b" && item.result === "rejected"), true);

  const unknownToSales = await request("/api/agent-call-targets?agentId=agent@ccc-tgt-missing", shirley);
  assert.equal(unknownToSales.response.status, 403);

  const managerList = await request("/api/agent-call-targets", alex);
  assert.equal(managerList.response.status, 200);
  assert.equal(managerList.json.canManage, false);
  assert.equal(managerList.json.rows.length, 1);
  assert.equal(managerList.json.rows[0].agentId, "agent@ccc-tgt-alex");
  assert.equal(managerList.json.rows[0].dialed, 1);
  assert.equal(managerList.json.rows[0].connected, 0);
  const managerOther = await request("/api/agent-call-targets?agentId=agent@ccc-tgt-a", alex);
  assert.equal(managerOther.response.status, 403);

  const miaList = await request("/api/agent-call-targets", mia);
  assert.equal(miaList.json.rows.length, 1);
  assert.equal(miaList.json.rows[0].dialed, 1);
  assert.equal(miaList.json.rows[0].connected, 1);
  assert.equal(miaList.json.rows[0].intent, 0);
  assert.equal(miaList.json.rows[0].dialTarget, 0);
  assert.equal(miaList.json.rows[0].intentTarget, 0);

  const all = await request("/api/agent-call-targets", admin);
  assert.equal(all.response.status, 200);
  assert.equal(all.json.canManage, true);
  const ids = all.json.rows.map((item: { agentId: string }) => item.agentId);
  assert.equal(ids.includes("agent@ccc-tgt-a"), true);
  assert.equal(ids.includes("agent@ccc-tgt-b"), true);
  assert.equal(ids.includes("agent@ccc-tgt-alex"), true);
  assert.equal(ids.includes("agent@ccc-tgt-orphan"), true);
  assert.equal(ids.includes("agent@ccc-tgt-asia"), false);
  const shirleyRow = all.json.rows.find((item: { agentId: string }) => item.agentId === "agent@ccc-tgt-a");
  assert.equal(shirleyRow.dialed, 6);
  assert.equal(shirleyRow.connected, 4);
  assert.equal(shirleyRow.intent, 1);

  const denied = await request("/api/agent-call-targets", noRead);
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.permissionCode, "communication.read");
  assert.equal(store.agentCallTargetAudits.some((item) => item.actorId === "u_no_target_read" && item.action === "read" && item.result === "rejected"), true);

  const asiaSet = await request("/api/agent-call-targets", asia, "POST", {
    agentId: "agent@ccc-tgt-asia",
    dialTarget: 6,
    connectedTarget: 2,
    intentTarget: 1
  });
  assert.equal(asiaSet.response.status, 200);
  const crossWrap = await request("/api/agent-call-targets", admin, "POST", {
    agentId: "agent@ccc-tgt-asia",
    wrapupTarget: 3
  });
  assert.equal(crossWrap.response.status, 404);
  assert.equal(store.agentCallTargets.find((item) => item.teamId === "asia" && item.agentId === "agent@ccc-tgt-asia")?.dialTarget, 6);
  assert.equal(store.agentCallTargets.find((item) => item.teamId === "asia" && item.agentId === "agent@ccc-tgt-asia")?.wrapupTarget ?? null, null);
  const cross = await request("/api/agent-call-targets", admin, "POST", {
    agentId: "agent@ccc-tgt-asia",
    dialTarget: 1,
    connectedTarget: 1
  });
  assert.equal(cross.response.status, 404);
  assert.equal(store.agentCallTargets.find((item) => item.agentId === "agent@ccc-tgt-asia" && item.teamId === "asia")?.dialTarget, 6);
  assert.equal(store.agentCallTargetAudits.some((item) => item.teamId === "europe" && item.agentId === "agent@ccc-tgt-asia" && item.result === "rejected" && item.previousValue === ""), true);
  const europeSeesAsia = await request("/api/agent-call-targets?agentId=agent@ccc-tgt-asia", admin);
  assert.equal(europeSeesAsia.response.status, 404);

  const orphanBefore = store.agentCallTargets.find((item) => item.id === "act_orphan");
  assert.ok(orphanBefore);
  const orphanSet = await request("/api/agent-call-targets", admin, "POST", {
    agentId: "agent@ccc-tgt-orphan",
    dialTarget: 9,
    connectedTarget: 1
  });
  assert.equal(orphanSet.response.status, 404);
  assert.equal(store.agentCallTargets.find((item) => item.id === "act_orphan")?.dialTarget, 4);
  const orphanWrap = await request("/api/agent-call-targets", admin, "POST", {
    agentId: "agent@ccc-tgt-orphan",
    wrapupTarget: 2
  });
  assert.equal(orphanWrap.response.status, 404);
  assert.equal(store.agentCallTargets.find((item) => item.id === "act_orphan")?.dialTarget, 4);
  assert.equal(store.agentCallTargets.find((item) => item.id === "act_orphan")?.wrapupTarget ?? null, null);

  const cleared = await request("/api/agent-call-targets/clear", admin, "POST", { agentId: "agent@ccc-tgt-a" });
  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.json.result, "cleared");
  assert.equal(store.agentCallTargets.some((item) => item.agentId === "agent@ccc-tgt-a"), false);
  const clearAudit = store.agentCallTargetAudits.find((item) => item.agentId === "agent@ccc-tgt-a" && item.action === "clear" && item.result === "updated");
  assert.ok(clearAudit);
  assert.equal(clearAudit.previousValue, "20|8|");
  assert.equal(clearAudit.nextValue, "");
  assert.equal(clearAudit.actorId, adminUser.id);

  const clearAgain = await request("/api/agent-call-targets/clear", admin, "POST", { agentId: "agent@ccc-tgt-a" });
  assert.equal(clearAgain.response.status, 200);
  assert.equal(clearAgain.json.result, "unchanged");
  assert.equal(store.agentCallTargetAudits.filter((item) => item.agentId === "agent@ccc-tgt-a" && item.action === "clear" && item.result === "updated").length, 1);

  const salesClear = await request("/api/agent-call-targets/clear", shirley, "POST", { agentId: "agent@ccc-tgt-b" });
  assert.equal(salesClear.response.status, 403);
  assert.equal(store.agentCallTargets.some((item) => item.agentId === "agent@ccc-tgt-b"), true);

  const orphanClear = await request("/api/agent-call-targets/clear", admin, "POST", { agentId: "agent@ccc-tgt-orphan" });
  assert.equal(orphanClear.response.status, 200);
  assert.equal(orphanClear.json.result, "cleared");
  assert.equal(store.agentCallTargets.some((item) => item.id === "act_orphan"), false);

  const auditsBeforeClearInvalid = store.agentCallTargetAudits.length;
  const badClear = await request("/api/agent-call-targets/clear", admin, "POST", { agentId: "agent@ccc-tgt-a", targets: [] });
  assert.equal(badClear.response.status, 400);
  assert.equal(store.agentCallTargetAudits.length, auditsBeforeClearInvalid);

  assert.equal(aliyunHits, 0);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outreachSequences.length, sequencesBefore);
  assert.equal(store.prospectOutreachPlans.length, plansBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.deepEqual(store.outboundCallRecords.map((item) => JSON.stringify(item)), recordsBefore.concat(store.outboundCallRecords.slice(recordsBefore.length).map((item) => JSON.stringify(item))));
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  const auditText = JSON.stringify(store.agentCallTargetAudits);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("do-not-leak-target"), false);
  assert.equal(auditText.includes("aliyuncs"), false);
  assert.equal(auditText.includes("*******2333"), false);

  console.log("agent call target http tests passed");
} finally {
  setOutboundNowForTests(undefined);
  const store = getStore();
  setTenantTimezoneOverride(store, "europe", undefined);
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_tgt_"));
  store.agentCallTargets = store.agentCallTargets.filter((item) => !item.agentId.startsWith("agent@ccc-tgt-"));
  store.agentCallTargetAudits = store.agentCallTargetAudits.filter((item) => !item.agentId.startsWith("agent@ccc-tgt-") && item.agentId !== "");
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_tgt_"));
  store.users = store.users.filter((item) => item.id !== "u_no_target_read" && item.id !== "u_target_asia_admin");
  globalThis.fetch = originalFetch;
  server.close();
}
