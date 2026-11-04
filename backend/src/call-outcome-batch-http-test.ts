import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import type { OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call outcome batch test server");
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

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "agentIds">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    targetType: "customer",
    targetId: "c1",
    maskedNumber: "13800138000",
    contactType: "OUTBOUND",
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "10",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: String(Date.parse("2026-04-04T04:00:00.000Z")),
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/do-not-leak-batch",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "",
    callOutcomeNote: "原备注",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const alexUser = store.users.find((item) => item.email === "alex@keduoduo.com");
  assert.ok(shirleyUser && miaUser && alexUser);
  assert.equal(shirleyUser.role, "sales");
  assert.equal(alexUser.role, "manager");
  store.users.push({
    ...shirleyUser,
    id: "u_no_batch_read",
    name: "No Batch Read",
    email: "no-batch-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_batch_asia",
    name: "Asia Batch",
    email: "asia-batch@keduoduo.com",
    role: "sales",
    teamId: "asia",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_no_batch_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };

  const reminderBefore = store.customers.find((item) => item.id === "c1")?.nextReminder;
  const activitiesBefore = store.customerActivities.length;
  const leadActivitiesBefore = store.leadActivities.length;
  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const sequencesBefore = store.outreachSequences.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  const customer = store.customers.find((item) => item.id === "c1");
  if (customer) customer.company = "Nordic <Tools>";

  store.aliyunAgentMappings.push(
    {
      id: "map_batch_shirley",
      teamId: "europe",
      crmUserId: shirleyUser.id,
      cccUserId: "agent@ccc-batch-a",
      loginName: "shirley-batch",
      displayName: "Shirley坐席",
      extension: "8201",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_batch_mia",
      teamId: "europe",
      crmUserId: miaUser.id,
      cccUserId: "agent@ccc-batch-b",
      loginName: "mia-batch",
      displayName: "Mia坐席",
      extension: "8202",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_batch_asia",
      teamId: "asia",
      crmUserId: "u_batch_asia",
      cccUserId: "agent@ccc-batch-asia",
      loginName: "asia-batch",
      displayName: "亚洲坐席",
      extension: "8203",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    }
  );
  store.outboundCallRecords.push(
    record({ id: "ocr_cob_a1", agentIds: "agent@ccc-batch-a", startTimeRaw: "2000" }),
    record({ id: "ocr_cob_a2", agentIds: "agent@ccc-batch-a", startTimeRaw: "3000", callOutcome: "Success", callOutcomeNote: "" }),
    record({ id: "ocr_cob_labeled", agentIds: "agent@ccc-batch-a", startTimeRaw: "4000", callOutcome: "有意向" }),
    record({ id: "ocr_cob_padded", agentIds: "agent@ccc-batch-a", callOutcome: " 其他 " }),
    record({ id: "ocr_cob_missed", agentIds: "agent@ccc-batch-a", establishedTimeRaw: "" }),
    record({ id: "ocr_cob_blank_established", agentIds: "agent@ccc-batch-a", establishedTimeRaw: "   " }),
    record({ id: "ocr_cob_mia", agentIds: "agent@ccc-batch-b", targetType: "lead", targetId: "l1" }),
    record({ id: "ocr_cob_none", agentIds: "" }),
    record({ id: "ocr_cob_asia", teamId: "asia", agentIds: "agent@ccc-batch-asia" })
  );

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const noRead = await login("no-batch-read@keduoduo.com");
  const asia = await login("asia-batch@keduoduo.com");

  const denied = await request("/api/unlabeled-connected-calls?scope=mine", noRead);
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.permissionCode, "communication.read");
  assert.equal(store.callOutcomeAudits.some((item) => item.action === "read"), false);

  const anonymous = await request("/api/unlabeled-connected-calls?scope=mine", "");
  assert.equal(anonymous.response.status, 401);
  assert.equal(store.callOutcomeAudits.some((item) => item.action === "read"), false);

  const badQuery = await request("/api/unlabeled-connected-calls?scope=all", shirley);
  assert.equal(badQuery.response.status, 400);
  assert.equal(store.callOutcomeAudits.some((item) => item.action === "read"), false);

  const teamDenied = await request("/api/unlabeled-connected-calls?scope=team", shirley);
  assert.equal(teamDenied.response.status, 403);
  assert.equal(teamDenied.json.reason, "forbidden");
  const teamAudit = store.callOutcomeAudits.find((item) => item.action === "read" && item.result === "rejected");
  assert.ok(teamAudit);
  assert.equal(teamAudit?.reason, "forbidden");
  assert.equal(teamAudit?.callRecordId, "");
  assert.equal(teamAudit?.batchId, "");
  assert.equal(JSON.stringify(teamAudit).includes("13800138000"), false);

  const mine = await request("/api/unlabeled-connected-calls?scope=mine", shirley);
  assert.equal(mine.response.status, 200);
  const mineIds = (mine.json.items as Array<{ callRecordId: string; outcome: string; name: string; maskedNumber: string }>).map((item) => item.callRecordId);
  assert.deepEqual(mineIds, ["ocr_cob_a2", "ocr_cob_a1"]);
  assert.equal(mine.json.items.every((item: { outcome: string }) => item.outcome === "未标注"), true);
  assert.equal(JSON.stringify(mine.json).includes("13800138000"), false);
  assert.equal(JSON.stringify(mine.json).includes("Success"), false);
  assert.equal(JSON.stringify(mine.json).includes("do-not-leak-batch"), false);
  assert.match(JSON.stringify(mine.json), /Nordic &lt;Tools&gt;|<Tools>|Nordic/);
  assert.match(mine.json.items[1].name, /Nordic/);
  assert.equal(mine.json.items[1].name.includes("<"), true);
  const readAudits = store.callOutcomeAudits.filter((item) => item.action === "read" && item.result === "read");
  assert.equal(readAudits.length, 1);
  assert.equal(readAudits[0]?.rowCount, 2);
  assert.equal(readAudits[0]?.scope, "mine");
  assert.equal(readAudits[0]?.callRecordId, "");

  const miaMine = await request("/api/unlabeled-connected-calls?scope=mine", mia);
  const miaIds = (miaMine.json.items as Array<{ callRecordId: string }>).map((item) => item.callRecordId);
  assert.equal(miaIds.includes("ocr_cob_mia"), true);
  assert.equal(miaIds.includes("ocr_cob_a1"), false);

  const again = await request("/api/unlabeled-connected-calls?scope=mine", shirley);
  assert.equal(again.response.status, 200);
  assert.equal(store.callOutcomeAudits.filter((item) => item.action === "read" && item.result === "read" && item.actorId === shirleyUser.id).length, 2);

  const team = await request("/api/unlabeled-connected-calls?scope=team", alex);
  assert.equal(team.response.status, 200);
  const teamIds = (team.json.items as Array<{ callRecordId: string }>).map((item) => item.callRecordId);
  assert.equal(teamIds.includes("ocr_cob_a1"), true);
  assert.equal(teamIds.includes("ocr_cob_mia"), true);
  assert.equal(teamIds.includes("ocr_cob_labeled"), false);
  assert.equal(teamIds.includes("ocr_cob_missed"), false);
  assert.equal(teamIds.includes("ocr_cob_asia"), false);
  assert.equal(teamIds.includes("ocr_cob_none"), false);

  const adminList = await request("/api/unlabeled-connected-calls?scope=team", admin);
  const adminIds = (adminList.json.items as Array<{ callRecordId: string }>).map((item) => item.callRecordId);
  assert.equal(adminIds.includes("ocr_cob_none"), true);
  assert.equal(adminIds.includes("ocr_cob_asia"), false);

  const asiaList = await request("/api/unlabeled-connected-calls?scope=mine", asia);
  assert.deepEqual((asiaList.json.items as Array<{ callRecordId: string }>).map((item) => item.callRecordId), ["ocr_cob_asia"]);

  const singleBatch = await request("/api/outbound-call-records/ocr_cob_a1/outcome", shirley, "POST", {
    outcome: "无意向",
    callRecordIds: ["ocr_cob_a1", "ocr_cob_a2"]
  });
  assert.equal(singleBatch.response.status, 400);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cob_a1")?.callOutcome, "");

  const hidden = await request("/api/unlabeled-connected-calls/label", shirley, "POST", {
    callRecordIds: ["ocr_cob_a1", "ocr_cob_mia"],
    outcome: "无意向"
  });
  assert.equal(hidden.response.status, 404);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cob_a1")?.callOutcome, "");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cob_mia")?.callOutcome, "");
  assert.equal(store.callOutcomeAudits.some((item) => item.action === "batch"), false);

  const mixed = await request("/api/unlabeled-connected-calls/label", shirley, "POST", {
    callRecordIds: ["ocr_cob_a1", "ocr_cob_labeled"],
    outcome: "无意向"
  });
  assert.equal(mixed.response.status, 400);
  assert.equal(mixed.json.reason, "not_pending");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cob_a1")?.callOutcome, "");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cob_labeled")?.callOutcome, "有意向");

  const otherTenant = await request("/api/unlabeled-connected-calls/label", shirley, "POST", {
    callRecordIds: ["ocr_cob_asia"],
    outcome: "其他"
  });
  assert.equal(otherTenant.response.status, 404);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cob_asia")?.callOutcome, "");

  const tooLong = await request("/api/unlabeled-connected-calls/label", shirley, "POST", {
    callRecordIds: ["ocr_cob_a1"],
    outcome: "其他",
    note: "字".repeat(201)
  });
  assert.equal(tooLong.response.status, 400);
  assert.equal(tooLong.json.reason, "note_too_long");
  assert.equal(store.callOutcomeAudits.some((item) => item.action === "batch"), false);

  const duplicate = await request("/api/unlabeled-connected-calls/label", shirley, "POST", {
    callRecordIds: ["ocr_cob_a1", "ocr_cob_a1"],
    outcome: "其他"
  });
  assert.equal(duplicate.response.status, 400);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cob_a1")?.callOutcome, "");

  const dispositionBefore = store.outboundCallRecords.find((item) => item.id === "ocr_cob_a1")?.contactDisposition;
  const establishedBefore = store.outboundCallRecords.find((item) => item.id === "ocr_cob_a1")?.establishedTimeRaw;
  const updatedBefore = store.outboundCallRecords.find((item) => item.id === "ocr_cob_a1")?.updatedAt;
  const labeled = await request("/api/unlabeled-connected-calls/label", shirley, "POST", {
    callRecordIds: ["ocr_cob_a2", "ocr_cob_a1"],
    outcome: "需回访",
    note: "  同一批 <备注>  "
  });
  assert.equal(labeled.response.status, 200);
  assert.equal(labeled.json.result, "updated");
  assert.deepEqual(labeled.json.callRecordIds, ["ocr_cob_a2", "ocr_cob_a1"]);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cob_a1")?.callOutcome, "需回访");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cob_a1")?.callOutcomeNote, "同一批 <备注>");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cob_a2")?.callOutcome, "需回访");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cob_a2")?.callOutcomeNote, "同一批 <备注>");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cob_a1")?.contactDisposition, dispositionBefore);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cob_a1")?.establishedTimeRaw, establishedBefore);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cob_a1")?.updatedAt, updatedBefore);
  const batchRows = store.callOutcomeAudits.filter((item) => item.action === "batch" && item.batchId === labeled.json.batchId);
  assert.equal(batchRows.length, 2);
  assert.equal(new Set(batchRows.map((item) => item.batchId)).size, 1);
  assert.equal(batchRows.every((item) => item.result === "updated" && item.nextOutcome === "需回访"), true);
  const firstAudit = batchRows.find((item) => item.callRecordId === "ocr_cob_a1");
  assert.equal(firstAudit?.previousOutcome, "");
  assert.equal(firstAudit?.previousNote, "原备注");
  assert.equal(firstAudit?.nextNote, "同一批 <备注>");
  assert.equal(firstAudit?.actorId, shirleyUser.id);
  assert.equal(JSON.stringify(batchRows).includes("13800138000"), false);
  assert.equal(JSON.stringify(batchRows).includes("do-not-leak-batch"), false);

  const replay = await request("/api/unlabeled-connected-calls/label", shirley, "POST", {
    callRecordIds: ["ocr_cob_a1", "ocr_cob_a2"],
    outcome: "需回访"
  });
  assert.equal(replay.response.status, 400);
  assert.equal(replay.json.reason, "not_pending");
  assert.equal(store.callOutcomeAudits.filter((item) => item.action === "batch").length, 2);

  const after = await request("/api/unlabeled-connected-calls?scope=mine", shirley);
  const afterIds = (after.json.items as Array<{ callRecordId: string }>).map((item) => item.callRecordId);
  assert.equal(afterIds.includes("ocr_cob_a1"), false);
  assert.equal(afterIds.includes("ocr_cob_a2"), false);

  const managerLabel = await request("/api/unlabeled-connected-calls/label", alex, "POST", {
    callRecordIds: ["ocr_cob_mia"],
    outcome: "号码错误"
  });
  assert.equal(managerLabel.response.status, 200);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cob_mia")?.callOutcome, "号码错误");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cob_mia")?.callOutcomeNote, "");

  const noReadLabel = await request("/api/unlabeled-connected-calls/label", noRead, "POST", {
    callRecordIds: ["ocr_cob_none"],
    outcome: "其他"
  });
  assert.equal(noReadLabel.response.status, 403);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cob_none")?.callOutcome, "");

  assert.equal(aliyunHits, 0);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.leadActivities.length, leadActivitiesBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outreachSequences.length, sequencesBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.customers.find((item) => item.id === "c1")?.nextReminder, reminderBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  assert.equal(JSON.stringify(store.callOutcomeAudits).includes("AccessKey"), false);
  assert.equal(JSON.stringify(store.callOutcomeAudits).includes("13800138000"), false);
  assert.equal(JSON.stringify(store.callOutcomeAudits).includes("do-not-leak-batch"), false);

  console.log("call outcome batch http tests passed");
} finally {
  const store = getStore();
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_cob_"));
  store.callOutcomeAudits = store.callOutcomeAudits.filter((item) => !item.id.startsWith("cob_") && !item.id.startsWith("cor_") && !item.callRecordId.startsWith("ocr_cob_"));
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_batch_"));
  store.users = store.users.filter((item) => item.id !== "u_no_batch_read" && item.id !== "u_batch_asia");
  const customer = store.customers.find((item) => item.id === "c1");
  if (customer?.company === "Nordic <Tools>") customer.company = "Nordic Tools AB";
  globalThis.fetch = originalFetch;
  server.close();
}
