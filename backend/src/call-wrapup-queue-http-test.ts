import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundNowForTests } from "./outbound-call.js";
import type { OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call wrapup queue test server");
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

const now = Date.parse("2026-04-04T06:00:00.000Z");
const later = String(Date.parse("2026-04-04T05:30:00.000Z"));
const middle = String(Date.parse("2026-04-04T05:00:00.000Z"));
const earlier = String(Date.parse("2026-04-04T04:00:00.000Z"));

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "agentIds">): OutboundCallRecord {
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
    releaseTimeRaw: earlier,
    startTimeRaw: earlier,
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/do-not-leak-queue",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "",
    callOutcomeNote: "",
    callNote: "",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

try {
  setOutboundNowForTests(new Date(now));
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const alexUser = store.users.find((item) => item.email === "alex@keduoduo.com");
  const adminUser = store.users.find((item) => item.email === "admin@keduoduo.com");
  assert.ok(shirleyUser && miaUser && alexUser && adminUser);
  assert.equal(alexUser.role, "manager");
  store.users.push({
    ...shirleyUser,
    id: "u_no_queue_read",
    name: "No Queue Read",
    email: "no-queue-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_queue_asia",
    name: "Asia Queue",
    email: "asia-queue@keduoduo.com",
    role: "sales",
    teamId: "asia",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_no_queue_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };

  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const sequencesBefore = store.outreachSequences.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const wrapupsBefore = store.callWrapupAudits.length;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  const noteBefore = store.outboundCallRecords.find((item) => item.id === "c1");
  const seedProspect = store.websiteOpportunities[0];
  assert.ok(seedProspect);

  store.aliyunAgentMappings.push(
    {
      id: "map_q_shirley",
      teamId: "europe",
      crmUserId: shirleyUser.id,
      cccUserId: "agent@ccc-q-a",
      loginName: "shirley",
      displayName: "Shirley坐席",
      extension: "8301",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_q_mia",
      teamId: "europe",
      crmUserId: miaUser.id,
      cccUserId: "agent@ccc-q-b",
      loginName: "mia",
      displayName: "Mia坐席",
      extension: "8302",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_q_asia",
      teamId: "asia",
      crmUserId: "u_queue_asia",
      cccUserId: "agent@ccc-q-asia",
      loginName: "asia",
      displayName: "亚洲坐席",
      extension: "8303",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    }
  );
  store.websiteOpportunities.push({ ...seedProspect, id: "web_q_mia", ownerId: miaUser.id, company: "队列候选" });
  store.outboundCallRecords.push(
    record({ id: "ocr_q_new", agentIds: "agent@ccc-q-a", releaseTimeRaw: later, maskedNumber: "13800138000" }),
    record({ id: "ocr_q_old", agentIds: "agent@ccc-q-a", releaseTimeRaw: earlier, targetType: "lead", targetId: "l1" }),
    record({ id: "ocr_q_both", agentIds: "agent@ccc-q-a,agent@ccc-q-b", releaseTimeRaw: middle, targetType: "prospect", targetId: "web_q_mia" }),
    record({ id: "ocr_q_note", agentIds: "agent@ccc-q-a", callNote: "已有纪要不要进队列" }),
    record({ id: "ocr_q_done", agentIds: "agent@ccc-q-a" }),
    record({ id: "ocr_q_reject", agentIds: "agent@ccc-q-a" }),
    record({ id: "ocr_q_open", agentIds: "agent@ccc-q-a", releaseTimeRaw: "" }),
    record({ id: "ocr_q_mia", agentIds: "agent@ccc-q-b", targetId: "c2" }),
    record({ id: "ocr_q_none", agentIds: "", targetType: "lead", targetId: "l1" }),
    record({ id: "ocr_q_asia", teamId: "asia", agentIds: "agent@ccc-q-asia", targetId: "c_asia", callNote: "亚洲纪要不要出现" })
  );
  store.callWrapupAudits.push(
    {
      id: "cwu_q_done",
      teamId: "europe",
      actorId: shirleyUser.id,
      at: "2026-04-04T05:10:00.000Z",
      callRecordId: "ocr_q_done",
      action: "submit",
      parts: "{\"outcome\":\"updated\"}",
      result: "updated",
      reason: ""
    },
    {
      id: "cwu_q_reject",
      teamId: "europe",
      actorId: shirleyUser.id,
      at: "2026-04-04T05:11:00.000Z",
      callRecordId: "ocr_q_reject",
      action: "submit",
      parts: "{\"note\":\"rejected\"}",
      result: "rejected",
      reason: "forbidden"
    }
  );

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const noRead = await login("no-queue-read@keduoduo.com");
  const asia = await login("asia-queue@keduoduo.com");

  const anon = await request("/api/call-wrapup-queue", "");
  assert.equal(anon.response.status, 401);
  assert.equal(store.callWrapupSkipAudits.length, 0);

  const badQuery = await request("/api/call-wrapup-queue?agentId=agent@ccc-q-a", shirley);
  assert.equal(badQuery.response.status, 400);
  assert.equal(store.callWrapupSkipAudits.length, 0);

  const listed = await request("/api/call-wrapup-queue", shirley);
  assert.equal(listed.response.status, 200);
  assert.equal(listed.json.canViewCounts, false);
  assert.deepEqual(listed.json.items.map((item: { callRecordId: string }) => item.callRecordId), [
    "ocr_q_new",
    "ocr_q_both",
    "ocr_q_reject",
    "ocr_q_old"
  ]);
  assert.equal(listed.json.items[0].targetLabel, "客户");
  assert.equal(listed.json.items[0].name, "Nordic Tools AB");
  assert.equal(listed.json.items[0].maskedNumber, "*******8000");
  assert.equal(listed.json.items[0].endedAgoLabel, "30分钟");
  assert.equal(listed.json.items[1].targetLabel, "搜客");
  assert.equal(listed.json.items[1].name, "队列候选");
  assert.equal(listed.json.items[1].endedAgoLabel, "1小时");
  assert.equal(listed.json.items[3].targetLabel, "线索");
  assert.equal(listed.json.items[3].name, "Example Lighting GmbH");
  assert.equal(listed.json.items[3].endedAgoLabel, "2小时");
  assert.equal(listed.json.skipped.length, 0);
  assert.equal(JSON.stringify(listed.json).includes("do-not-leak-queue"), false);
  assert.equal(JSON.stringify(listed.json).includes("13800138000"), false);
  assert.equal(JSON.stringify(listed.json).includes("已有纪要"), false);
  assert.equal(JSON.stringify(listed.json).includes("亚洲纪要"), false);
  assert.equal(store.callWrapupSkipAudits.length, 0);

  const miaList = await request("/api/call-wrapup-queue", mia);
  assert.deepEqual(miaList.json.items.map((item: { callRecordId: string }) => item.callRecordId), ["ocr_q_both", "ocr_q_mia"]);

  const managerList = await request("/api/call-wrapup-queue", alex);
  assert.equal(managerList.json.canViewCounts, true);
  const managerIds = managerList.json.items.map((item: { callRecordId: string }) => item.callRecordId);
  assert.equal(managerIds.includes("ocr_q_new"), true);
  assert.equal(managerIds.includes("ocr_q_mia"), true);
  assert.equal(managerIds.includes("ocr_q_none"), false);
  assert.equal(managerIds.includes("ocr_q_asia"), false);

  const adminList = await request("/api/call-wrapup-queue", admin);
  const adminIds = adminList.json.items.map((item: { callRecordId: string }) => item.callRecordId);
  assert.equal(adminIds.includes("ocr_q_none"), true);
  assert.equal(adminIds.includes("ocr_q_note"), false);
  assert.equal(adminIds.includes("ocr_q_done"), false);
  assert.equal(adminIds.includes("ocr_q_open"), false);
  assert.equal(adminList.json.items.find((item: { callRecordId: string }) => item.callRecordId === "ocr_q_none").targetLabel, "线索");

  const denied = await request("/api/call-wrapup-queue", noRead);
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.reason, "forbidden");
  assert.equal(denied.json.items, undefined);
  assert.equal(store.callWrapupSkipAudits.some((item) => item.actorId === "u_no_queue_read" && item.action === "read" && item.result === "rejected"), true);

  const foreign = await request("/api/call-wrapup-queue/ocr_q_asia/skip", shirley, "POST", { reason: "missed" });
  assert.equal(foreign.response.status, 403);
  assert.equal(store.callWrapupSkips.some((item) => item.callRecordId === "ocr_q_asia"), false);
  assert.equal(store.callWrapupSkipAudits.some((item) => item.actorId === shirleyUser.id && item.callRecordId === "ocr_q_asia" && item.result === "rejected"), true);
  assert.equal(JSON.stringify(store.callWrapupSkipAudits).includes("亚洲纪要"), false);

  const hidden = await request("/api/call-wrapup-queue/ocr_q_mia/skip", shirley, "POST", { reason: "missed" });
  assert.equal(hidden.response.status, 403);
  assert.equal(store.callWrapupSkips.some((item) => item.callRecordId === "ocr_q_mia"), false);

  const noReason = await request("/api/call-wrapup-queue/ocr_q_new/skip", shirley, "POST", {});
  assert.equal(noReason.response.status, 400);
  const batch = await request("/api/call-wrapup-queue/ocr_q_new/skip", shirley, "POST", { reason: "missed", records: ["ocr_q_old"] });
  assert.equal(batch.response.status, 400);
  const queried = await request("/api/call-wrapup-queue/ocr_q_new/skip?x=1", shirley, "POST", { reason: "missed" });
  assert.equal(queried.response.status, 400);
  const badReason = await request("/api/call-wrapup-queue/ocr_q_new/skip", shirley, "POST", { reason: "随便" });
  assert.equal(badReason.response.status, 400);
  assert.equal(store.callWrapupSkips.length, 0);

  const noted = await request("/api/call-wrapup-queue/ocr_q_note/skip", shirley, "POST", { reason: "other" });
  assert.equal(noted.response.status, 400);
  assert.equal(noted.json.reason, "not_pending");
  const done = await request("/api/call-wrapup-queue/ocr_q_done/skip", shirley, "POST", { reason: "other" });
  assert.equal(done.response.status, 400);
  const open = await request("/api/call-wrapup-queue/ocr_q_open/skip", shirley, "POST", { reason: "missed" });
  assert.equal(open.response.status, 400);
  assert.equal(store.callWrapupSkips.length, 0);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_q_note")?.callNote, "已有纪要不要进队列");

  const auditsBeforeSkip = store.callWrapupSkipAudits.length;
  const skipped = await request("/api/call-wrapup-queue/ocr_q_new/skip", shirley, "POST", { reason: "missed" });
  assert.equal(skipped.response.status, 200);
  assert.equal(skipped.json.result, "skipped");
  assert.equal(skipped.json.reasonLabel, "未接通");
  assert.equal(store.callWrapupSkips.filter((item) => item.callRecordId === "ocr_q_new" && item.active).length, 1);
  assert.equal(store.callWrapupSkipAudits.filter((item) => item.callRecordId === "ocr_q_new" && item.result === "skipped").length, 1);

  const again = await request("/api/call-wrapup-queue/ocr_q_new/skip", shirley, "POST", { reason: "missed" });
  assert.equal(again.response.status, 200);
  assert.equal(again.json.result, "unchanged");
  assert.equal(store.callWrapupSkipAudits.filter((item) => item.callRecordId === "ocr_q_new" && item.result === "skipped").length, 1);

  const changed = await request("/api/call-wrapup-queue/ocr_q_new/skip", shirley, "POST", { reason: "duplicate" });
  assert.equal(changed.response.status, 200);
  assert.equal(changed.json.reason, "duplicate");
  assert.equal(store.callWrapupSkips.filter((item) => item.callRecordId === "ocr_q_new").length, 1);
  assert.equal(store.callWrapupSkips.find((item) => item.callRecordId === "ocr_q_new")?.reason, "duplicate");

  const afterSkip = await request("/api/call-wrapup-queue", shirley);
  assert.equal(afterSkip.json.items.some((item: { callRecordId: string }) => item.callRecordId === "ocr_q_new"), false);
  assert.equal(afterSkip.json.skipped[0].callRecordId, "ocr_q_new");
  assert.equal(afterSkip.json.skipped[0].reasonLabel, "重复通话");
  assert.equal(afterSkip.json.skipped[0].maskedNumber, "*******8000");

  const badRestore = await request("/api/call-wrapup-queue/ocr_q_new/restore", shirley, "POST", { reason: "missed" });
  assert.equal(badRestore.response.status, 400);
  const restored = await request("/api/call-wrapup-queue/ocr_q_new/restore", shirley, "POST", {});
  assert.equal(restored.response.status, 200);
  assert.equal(restored.json.result, "restored");
  assert.equal(store.callWrapupSkips.find((item) => item.callRecordId === "ocr_q_new")?.active, false);
  assert.equal(store.callWrapupSkipAudits.some((item) => item.callRecordId === "ocr_q_new" && item.action === "restore" && item.result === "restored" && item.reason === "duplicate"), true);
  const restoreAgain = await request("/api/call-wrapup-queue/ocr_q_new/restore", shirley, "POST", {});
  assert.equal(restoreAgain.json.result, "unchanged");
  const back = await request("/api/call-wrapup-queue", shirley);
  assert.equal(back.json.items[0].callRecordId, "ocr_q_new");

  const salesCounts = await request("/api/call-wrapup-queue/counts", shirley);
  assert.equal(salesCounts.response.status, 403);
  assert.equal(salesCounts.json.rows, undefined);
  assert.equal(salesCounts.json.pendingTotal, undefined);
  assert.equal(store.callWrapupSkipAudits.some((item) => item.actorId === shirleyUser.id && item.action === "read" && item.result === "rejected" && item.reason === "forbidden"), true);

  const countQuery = await request("/api/call-wrapup-queue/counts?agentId=1", alex);
  assert.equal(countQuery.response.status, 400);

  const counts = await request("/api/call-wrapup-queue/counts", alex);
  assert.equal(counts.response.status, 200);
  const shirleyCount = counts.json.rows.find((row: { agentId: string }) => row.agentId === "agent@ccc-q-a");
  const miaCount = counts.json.rows.find((row: { agentId: string }) => row.agentId === "agent@ccc-q-b");
  assert.equal(shirleyCount.agentLabel, "Shirley坐席");
  assert.equal(shirleyCount.pendingCount, 4);
  assert.equal(miaCount.pendingCount, 2);
  assert.equal(counts.json.rows.some((row: { agentId: string }) => row.agentId === ""), false);
  assert.equal(counts.json.rows.some((row: { agentId: string }) => row.agentId === "agent@ccc-q-asia"), false);
  assert.equal(JSON.stringify(counts.json).includes("13800138000"), false);
  assert.equal(JSON.stringify(counts.json).includes("do-not-leak-queue"), false);
  assert.equal(store.callWrapupSkipAudits.filter((item) => item.actorId === alexUser.id && item.action === "read").length, 0);

  const adminCounts = await request("/api/call-wrapup-queue/counts", admin);
  const unassigned = adminCounts.json.rows.find((row: { agentId: string }) => row.agentId === "");
  assert.equal(unassigned.agentLabel, "未分配坐席");
  assert.equal(unassigned.pendingCount, 1);
  assert.ok(adminCounts.json.pendingTotal >= 5);

  const managerSkip = await request("/api/call-wrapup-queue/ocr_q_mia/skip", alex, "POST", { reason: "internal" });
  assert.equal(managerSkip.response.status, 200);
  assert.equal(managerSkip.json.result, "skipped");
  const miaAfter = await request("/api/call-wrapup-queue", mia);
  assert.equal(miaAfter.json.items.some((item: { callRecordId: string }) => item.callRecordId === "ocr_q_mia"), false);
  assert.equal(miaAfter.json.skipped.some((item: { callRecordId: string }) => item.callRecordId === "ocr_q_mia"), true);

  const noneDenied = await request("/api/call-wrapup-queue/ocr_q_none/skip", shirley, "POST", { reason: "other" });
  assert.equal(noneDenied.response.status, 403);
  const noneOk = await request("/api/call-wrapup-queue/ocr_q_none/skip", admin, "POST", { reason: "wrong_number" });
  assert.equal(noneOk.response.status, 200);
  assert.equal(store.callWrapupSkips.find((item) => item.callRecordId === "ocr_q_none")?.active, true);

  assert.equal(store.callWrapupAudits.length, wrapupsBefore + 2);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outreachSequences.length, sequencesBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  assert.equal(noteBefore, undefined);
  assert.equal(aliyunHits, 0);
  assert.equal(JSON.stringify(store.callWrapupSkipAudits).includes("AccessKey"), false);
  assert.equal(JSON.stringify(store.callWrapupSkipAudits).includes("do-not-leak-queue"), false);
  assert.ok(store.callWrapupSkipAudits.length > auditsBeforeSkip);

  console.log("call wrapup queue http tests passed");
} finally {
  setOutboundNowForTests(undefined);
  const store = getStore();
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_q_"));
  store.callWrapupAudits = store.callWrapupAudits.filter((item) => !item.id.startsWith("cwu_q_"));
  store.callWrapupSkips = store.callWrapupSkips.filter((item) => !item.callRecordId.startsWith("ocr_q_"));
  store.callWrapupSkipAudits = store.callWrapupSkipAudits.filter((item) => !item.callRecordId.startsWith("ocr_q_") && item.actorId !== "u_no_queue_read" && item.actorId !== shirleyActor(store));
  store.websiteOpportunities = store.websiteOpportunities.filter((item) => item.id !== "web_q_mia");
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_q_"));
  store.users = store.users.filter((item) => item.id !== "u_no_queue_read" && item.id !== "u_queue_asia");
  globalThis.fetch = originalFetch;
  server.close();
}

function shirleyActor(store: ReturnType<typeof getStore>) {
  return store.users.find((item) => item.email === "shirley@keduoduo.com")?.id || "";
}
