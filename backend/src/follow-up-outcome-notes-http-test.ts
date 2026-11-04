import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import type { AliyunAgentMapping, CallOutcomeAudit, OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start follow-up outcome note test server");
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
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
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

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "targetType" | "targetId">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    maskedNumber: "****8000",
    contactType: "OUTBOUND",
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: "999999",
    agentIds: "agent@ccc-fon-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://secret.example/do-not-leak",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "有意向",
    callOutcomeNote: "",
    callNote: "纪要正文不要出现",
    callNoteTags: "需求",
    callNoteUpdatedAt: "2026-11-04T01:00:00.000Z",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
    ...partial
  };
}

try {
  const store = getStore();
  const shirley = await login("shirley@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const alexUser = store.users.find((item) => item.email === "alex@keduoduo.com");
  assert.ok(shirleyUser && miaUser && alexUser);
  store.users.push({
    ...shirleyUser,
    id: "u_fon_no_comm",
    name: "No Comm",
    email: "no-fon-comm@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_fon_no_customer",
    name: "No Customer",
    email: "no-fon-customer@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_fon_no_lead",
    name: "No Lead",
    email: "no-fon-lead@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    const permissions = { ...snapshot.permissions };
    if (actor.id === "u_fon_no_comm") delete permissions["communication.read"];
    if (actor.id === "u_fon_no_customer") delete permissions["customer.read"];
    if (actor.id === "u_fon_no_lead") delete permissions["lead.read"];
    if (actor.id === "u_fon_no_comm" || actor.id === "u_fon_no_customer" || actor.id === "u_fon_no_lead") {
      return { ...snapshot, permissions };
    }
    return snapshot;
  };
  const noComm = await login("no-fon-comm@keduoduo.com");
  const noCustomer = await login("no-fon-customer@keduoduo.com");
  const noLead = await login("no-fon-lead@keduoduo.com");
  const mapping = (partial: Partial<AliyunAgentMapping> & Pick<AliyunAgentMapping, "crmUserId" | "cccUserId">): AliyunAgentMapping => ({
    id: `map_${partial.cccUserId}`,
    teamId: "europe",
    loginName: "",
    displayName: partial.displayName || "",
    extension: "",
    workMode: "",
    updatedBy: "",
    updatedAt: "",
    ...partial
  });
  store.aliyunAgentMappings.push(
    mapping({ crmUserId: shirleyUser.id, cccUserId: "agent@ccc-fon-a", displayName: "Shirley坐席" }),
    mapping({ crmUserId: miaUser.id, cccUserId: "agent@ccc-fon-b", displayName: "Mia坐席" }),
    mapping({ crmUserId: "u_fon_no_customer", cccUserId: "agent@ccc-fon-nocust", displayName: "无客户读" }),
    mapping({ crmUserId: "u_fon_no_lead", cccUserId: "agent@ccc-fon-nolead", displayName: "无线索读" })
  );
  const customerTemplate = store.customers.find((item) => item.id === "c1");
  const leadTemplate = store.leads.find((item) => item.id === "l1");
  assert.ok(customerTemplate && leadTemplate);
  store.customers.push({
    ...customerTemplate,
    id: "c_fon_empty",
    company: "没有备注",
    ownerId: shirleyUser.id,
    teamId: "europe",
    poolStatus: "owned"
  }, {
    ...customerTemplate,
    id: "c_fon_public",
    company: "公池客户",
    ownerId: miaUser.id,
    teamId: "europe",
    poolStatus: "public"
  }, {
    ...customerTemplate,
    id: "c_fon_asia",
    company: "亚洲客户",
    ownerId: "someone",
    teamId: "asia",
    poolStatus: "owned"
  });
  store.leads.push({
    ...leadTemplate,
    id: "l_fon_deleted",
    company: "已删除线索",
    ownerId: shirleyUser.id,
    teamId: "europe",
    deletedAt: "2026-11-01T00:00:00.000Z"
  }, {
    ...leadTemplate,
    id: "l_fon_nocust",
    company: "无客户读的线索",
    ownerId: "u_fon_no_customer",
    teamId: "europe",
    deletedAt: ""
  });
  store.customers.push({
    ...customerTemplate,
    id: "c_fon_nolead",
    company: "无线索读的客户",
    ownerId: "u_fon_no_lead",
    teamId: "europe",
    poolStatus: "owned"
  });
  store.outboundCallRecords.push(
    record({
      id: "ocr_fon_old",
      targetType: "customer",
      targetId: "c1",
      callOutcomeNote: "  要样品<script>  ",
      maskedNumber: "13800138000"
    }),
    record({
      id: "ocr_fon_new",
      targetType: "customer",
      targetId: "c1",
      callOutcome: " 其他 ",
      callOutcomeNote: "下午再打"
    }),
    record({
      id: "ocr_fon_blank",
      targetType: "customer",
      targetId: "c1",
      callOutcomeNote: "   "
    }),
    record({
      id: "ocr_fon_raw",
      targetType: "customer",
      targetId: "c1",
      callOutcome: "NotALabel",
      callOutcomeNote: "未标也要看备注",
      updatedAt: "",
      createdAt: "2026-10-01T00:00:00.000Z"
    }),
    record({
      id: "ocr_fon_mia",
      targetType: "customer",
      targetId: "c1",
      agentIds: "agent@ccc-fon-b",
      callOutcomeNote: "Mia 坐席的备注不要给 Shirley"
    }),
    record({
      id: "ocr_fon_noagent",
      targetType: "customer",
      targetId: "c1",
      agentIds: "",
      callOutcomeNote: "没有坐席的备注"
    }),
    record({
      id: "ocr_fon_prospect",
      targetType: "prospect",
      targetId: "c1",
      callOutcomeNote: "搜客备注不要混进来"
    }),
    record({
      id: "ocr_fon_lead_mix",
      targetType: "lead",
      targetId: "c1",
      callOutcomeNote: "线索备注不要混进客户"
    }),
    record({
      id: "ocr_fon_empty",
      targetType: "customer",
      targetId: "c_fon_empty",
      callOutcomeNote: ""
    }),
    record({
      id: "ocr_fon_public",
      targetType: "customer",
      targetId: "c_fon_public",
      callOutcome: "需回访",
      callOutcomeNote: "公池备注"
    }),
    record({
      id: "ocr_fon_mia_customer",
      targetType: "customer",
      targetId: "c3",
      agentIds: "agent@ccc-fon-b",
      callOutcomeNote: "Mia 客户的备注不要进拒绝响应"
    }),
    record({
      id: "ocr_fon_asia",
      teamId: "asia",
      targetType: "customer",
      targetId: "c_fon_asia",
      callOutcomeNote: "别的租户备注"
    }),
    record({
      id: "ocr_fon_lead",
      targetType: "lead",
      targetId: "l1",
      callOutcome: "需回访",
      callOutcomeNote: "线索要回访<script>"
    }),
    record({
      id: "ocr_fon_deleted",
      targetType: "lead",
      targetId: "l_fon_deleted",
      callOutcomeNote: "已删除线索的备注不要出现"
    }),
    record({
      id: "ocr_fon_mia_lead",
      targetType: "lead",
      targetId: "l3",
      agentIds: "agent@ccc-fon-b",
      callOutcomeNote: "Mia 线索的备注不要进拒绝响应"
    }),
    record({
      id: "ocr_fon_nocust_lead",
      targetType: "lead",
      targetId: "l_fon_nocust",
      agentIds: "agent@ccc-fon-nocust",
      callOutcomeNote: "无客户读仍能看自己的线索备注"
    }),
    record({
      id: "ocr_fon_nolead_customer",
      targetType: "customer",
      targetId: "c_fon_nolead",
      agentIds: "agent@ccc-fon-nolead",
      callOutcomeNote: "无线索读仍能看自己的客户备注"
    })
  );
  const outcomeAudit = (partial: Pick<CallOutcomeAudit, "id" | "callRecordId" | "nextNote" | "at">): CallOutcomeAudit => ({
    teamId: "europe",
    actorId: shirleyUser.id,
    previousOutcome: "",
    nextOutcome: "有意向",
    previousNote: "",
    ...partial
  });
  store.callOutcomeAudits.push(
    outcomeAudit({ id: "coa_fon_old", callRecordId: "ocr_fon_old", nextNote: "要样品<script>", at: "2026-11-01T01:00:00.000Z" }),
    outcomeAudit({ id: "coa_fon_new", callRecordId: "ocr_fon_new", nextNote: "下午再打", at: "2026-11-03T01:00:00.000Z" }),
    outcomeAudit({ id: "coa_fon_stale", callRecordId: "ocr_fon_new", nextNote: "旧备注", at: "2026-12-01T01:00:00.000Z" }),
    outcomeAudit({ id: "coa_fon_lead", callRecordId: "ocr_fon_lead", nextNote: "线索要回访<script>", at: "2026-11-02T01:00:00.000Z" })
  );

  const reminderBefore = store.customers.find((item) => item.id === "c1")?.nextReminder;
  const leadFollowBefore = store.leads.find((item) => item.id === "l1")?.nextFollowAt;
  const noteBefore = store.outboundCallRecords.find((item) => item.id === "ocr_fon_old")?.callOutcomeNote;
  const outcomeBefore = store.outboundCallRecords.find((item) => item.id === "ocr_fon_old")?.callOutcome;
  const callNoteBefore = store.outboundCallRecords.find((item) => item.id === "ocr_fon_old")?.callNote;
  const activitiesBefore = store.customerActivities.length;
  const outcomeAuditsBefore = store.callOutcomeAudits.length;
  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions);
  const leadsBefore = store.leads.length;
  const customersBefore = store.customers.length;

  const mine = await request("/api/follow-up-outcome-notes?targetType=customer&targetId=c1", shirley);
  assert.equal(mine.response.status, 200);
  assert.equal(mine.json.targetType, "customer");
  assert.equal(mine.json.targetId, "c1");
  assert.equal(mine.json.empty, false);
  assert.equal("rowCount" in mine.json, false);
  assert.equal("connectRate" in mine.json, false);
  assert.deepEqual(mine.json.items.map((item: { callRecordId: string }) => item.callRecordId), ["ocr_fon_new", "ocr_fon_old", "ocr_fon_raw"]);
  const older = mine.json.items.find((item: { callRecordId: string }) => item.callRecordId === "ocr_fon_old");
  assert.equal(older.note, "要样品<script>");
  assert.equal(older.outcomeLabel, "有意向");
  assert.equal(older.at, "2026-11-01T01:00:00.000Z");
  assert.equal(String(older.maskedNumber).includes("13800138000"), false);
  const newer = mine.json.items.find((item: { callRecordId: string }) => item.callRecordId === "ocr_fon_new");
  assert.equal(newer.outcomeLabel, "其他");
  assert.equal(newer.note, "下午再打");
  assert.equal(newer.at, "2026-11-03T01:00:00.000Z");
  const raw = mine.json.items.find((item: { callRecordId: string }) => item.callRecordId === "ocr_fon_raw");
  assert.equal(raw.outcomeLabel, "未标注");
  assert.equal(raw.note, "未标也要看备注");
  assert.equal(raw.at, "2026-10-01T00:00:00.000Z");
  const packed = JSON.stringify(mine.json);
  assert.equal(packed.includes("secret.example"), false);
  assert.equal(packed.includes("纪要正文不要出现"), false);
  assert.equal(packed.includes("NotALabel"), false);
  assert.equal(packed.includes("Success"), false);
  assert.equal(packed.includes("999999"), false);
  assert.equal(packed.includes("Mia 坐席"), false);
  assert.equal(packed.includes("没有坐席的备注"), false);
  assert.equal(packed.includes("搜客备注"), false);
  assert.equal(packed.includes("线索备注不要混进客户"), false);
  assert.equal(store.followUpOutcomeNoteViewAudits.some((item) => item.actorId === shirleyUser.id && item.action === "read" && item.targetType === "customer" && item.targetId === "c1" && item.result === "read" && item.rowCount === 3), true);

  const again = await request("/api/follow-up-outcome-notes?targetType=customer&targetId=c1", shirley);
  assert.equal(again.response.status, 200);
  assert.equal(store.followUpOutcomeNoteViewAudits.filter((item) => item.actorId === shirleyUser.id && item.action === "read" && item.result === "read" && item.targetType === "customer" && item.targetId === "c1").length, 2);

  const empty = await request("/api/follow-up-outcome-notes?targetType=customer&targetId=c_fon_empty", shirley);
  assert.equal(empty.response.status, 200);
  assert.equal(empty.json.empty, true);
  assert.deepEqual(empty.json.items, []);
  assert.equal(store.followUpOutcomeNoteViewAudits.some((item) => item.targetId === "c_fon_empty" && item.result === "read" && item.rowCount === 0), true);

  const publicView = await request("/api/follow-up-outcome-notes?targetType=customer&targetId=c_fon_public", shirley);
  assert.equal(publicView.response.status, 200);
  assert.equal(publicView.json.items[0]?.note, "公池备注");
  assert.equal(publicView.json.items[0]?.outcomeLabel, "需回访");

  const leadView = await request("/api/follow-up-outcome-notes?targetType=lead&targetId=l1", shirley);
  assert.equal(leadView.response.status, 200);
  assert.equal(leadView.json.items.length, 1);
  assert.equal(leadView.json.items[0].note, "线索要回访<script>");
  assert.equal(leadView.json.items[0].outcomeLabel, "需回访");
  assert.equal(leadView.json.items[0].at, "2026-11-02T01:00:00.000Z");

  const alexView = await request("/api/follow-up-outcome-notes?targetType=customer&targetId=c1", alex);
  assert.equal(alexView.response.status, 200);
  const alexIds = alexView.json.items.map((item: { callRecordId: string }) => item.callRecordId);
  assert.equal(alexIds.includes("ocr_fon_old"), true);
  assert.equal(alexIds.includes("ocr_fon_mia"), true);
  const adminView = await request("/api/follow-up-outcome-notes?targetType=customer&targetId=c1", admin);
  assert.equal(adminView.response.status, 200);
  const adminIds = adminView.json.items.map((item: { callRecordId: string }) => item.callRecordId);
  assert.equal(adminIds.includes("ocr_fon_mia"), true);
  assert.equal(adminIds.includes("ocr_fon_noagent"), true);

  const auditsAfterOk = store.followUpOutcomeNoteViewAudits.length;
  assert.equal((await request("/api/follow-up-outcome-notes", shirley)).response.status, 400);
  assert.equal((await request("/api/follow-up-outcome-notes?targetType=customer&targetId=", shirley)).response.status, 400);
  assert.equal((await request("/api/follow-up-outcome-notes?targetType=prospect&targetId=c1", shirley)).response.status, 400);
  assert.equal((await request("/api/follow-up-outcome-notes?targetType=customer&targetId=c1&outcome=%E5%85%B6%E4%BB%96", shirley)).response.status, 400);
  assert.equal((await request("/api/follow-up-outcome-notes?targetType=customer&targetId=c1&targetId=c2", shirley)).response.status, 400);
  assert.equal((await request("/api/follow-up-outcome-notes?targetType=customer&targetId=c1", "")).response.status, 401);
  assert.equal(store.followUpOutcomeNoteViewAudits.length, auditsAfterOk);

  const deniedComm = await request("/api/follow-up-outcome-notes?targetType=customer&targetId=c1", noComm);
  assert.equal(deniedComm.response.status, 403);
  assert.equal(deniedComm.json.reason, "forbidden");
  assert.equal(JSON.stringify(deniedComm.json).includes("要样品"), false);
  assert.equal(store.followUpOutcomeNoteViewAudits.some((item) => item.actorId === "u_fon_no_comm" && item.result === "rejected" && item.reason === "forbidden" && item.rowCount === 0), true);

  const deniedCustomer = await request("/api/follow-up-outcome-notes?targetType=customer&targetId=c1", noCustomer);
  assert.equal(deniedCustomer.response.status, 403);
  assert.equal(JSON.stringify(deniedCustomer.json).includes("要样品"), false);
  const stillLead = await request("/api/follow-up-outcome-notes?targetType=lead&targetId=l_fon_nocust", noCustomer);
  assert.equal(stillLead.response.status, 200);
  assert.equal(stillLead.json.items[0].note, "无客户读仍能看自己的线索备注");

  const deniedLead = await request("/api/follow-up-outcome-notes?targetType=lead&targetId=l_fon_nocust", noLead);
  assert.equal(deniedLead.response.status, 403);
  assert.equal(JSON.stringify(deniedLead.json).includes("无客户读仍能看"), false);
  const stillCustomer = await request("/api/follow-up-outcome-notes?targetType=customer&targetId=c_fon_nolead", noLead);
  assert.equal(stillCustomer.response.status, 200);
  assert.equal(stillCustomer.json.items[0].note, "无线索读仍能看自己的客户备注");

  const hidden = await request("/api/follow-up-outcome-notes?targetType=customer&targetId=c3", shirley);
  assert.equal(hidden.response.status, 403);
  assert.equal(JSON.stringify(hidden.json).includes("Mia 客户"), false);
  const hiddenLead = await request("/api/follow-up-outcome-notes?targetType=lead&targetId=l3", shirley);
  assert.equal(hiddenLead.response.status, 403);
  assert.equal(JSON.stringify(hiddenLead.json).includes("Mia 线索"), false);
  const deleted = await request("/api/follow-up-outcome-notes?targetType=lead&targetId=l_fon_deleted", shirley);
  assert.equal(deleted.response.status, 403);
  assert.equal(JSON.stringify(deleted.json).includes("已删除线索"), false);
  const otherTeam = await request("/api/follow-up-outcome-notes?targetType=customer&targetId=c_fon_asia", shirley);
  assert.equal(otherTeam.response.status, 403);
  assert.equal(JSON.stringify(otherTeam.json).includes("别的租户备注"), false);
  const auditText = JSON.stringify(store.followUpOutcomeNoteViewAudits);
  assert.equal(auditText.includes("要样品"), false);
  assert.equal(auditText.includes("线索要回访"), false);
  assert.equal(auditText.includes("已删除线索"), false);
  assert.equal(auditText.includes("别的租户备注"), false);
  assert.equal(auditText.includes("13800138000"), false);
  assert.equal(auditText.includes("secret.example"), false);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("纪要正文"), false);

  assert.equal(store.customers.find((item) => item.id === "c1")?.nextReminder, reminderBefore);
  assert.equal(store.leads.find((item) => item.id === "l1")?.nextFollowAt, leadFollowBefore);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_fon_old")?.callOutcomeNote, noteBefore);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_fon_old")?.callOutcome, outcomeBefore);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_fon_old")?.callNote, callNoteBefore);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.callOutcomeAudits.length, outcomeAuditsBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.customers.length, customersBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), false);
  assert.equal(aliyunHits, 0);
  console.log("follow-up outcome note http tests passed");
} finally {
  globalThis.fetch = originalFetch;
  server.close();
}
