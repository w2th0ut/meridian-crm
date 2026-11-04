import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { AliyunAgentMapping, OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start negative outcome follow-up test server");
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
    startTimeRaw: "2000",
    agentIds: "agent@ccc-nof-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "无意向",
    callOutcomeNote: "",
    callNote: "",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
    ...partial
  };
}

try {
  const store = getStore();
  setOutboundNowForTests(new Date("2026-11-04T02:30:00.000Z"));
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const alexUser = store.users.find((item) => item.email === "alex@keduoduo.com");
  assert.ok(shirleyUser && miaUser && alexUser);
  store.users.push({
    ...shirleyUser,
    id: "u_nof_no_read",
    name: "No Read",
    email: "no-nof-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_nof_no_update",
    name: "No Update",
    email: "no-nof-update@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    if (actor.id !== "u_nof_no_read" && actor.id !== "u_nof_no_update") return snapshot;
    const permissions = { ...snapshot.permissions };
    if (actor.id === "u_nof_no_read") delete permissions["communication.read"];
    if (actor.id === "u_nof_no_update") delete permissions["customer.update"];
    return { ...snapshot, permissions };
  };
  const noRead = await login("no-nof-read@keduoduo.com");
  const noUpdate = await login("no-nof-update@keduoduo.com");
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
    mapping({ crmUserId: shirleyUser.id, cccUserId: "agent@ccc-nof-a", displayName: "Shirley坐席" }),
    mapping({ crmUserId: "u_nof_no_update", cccUserId: "agent@ccc-nof-a", displayName: "No Update坐席" }),
    mapping({ crmUserId: miaUser.id, cccUserId: "agent@ccc-nof-b", displayName: "Mia坐席" })
  );
  const customer = store.customers.find((item) => item.id === "c1");
  const wrong = store.customers.find((item) => item.id === "c2");
  const miaCustomer = store.customers.find((item) => item.id === "c3");
  const pooled = store.customers.find((item) => item.id === "c4");
  const emptyFollow = store.customers.find((item) => item.id === "c5");
  const lead = store.leads.find((item) => item.id === "l2");
  const leadTemplate = store.leads.find((item) => item.id === "l1");
  const prospect = store.websiteOpportunities.find((item) => item.id === "web_seed_1");
  assert.ok(customer && wrong && miaCustomer && pooled && emptyFollow && lead && leadTemplate && prospect);
  customer.ownerId = shirleyUser.id;
  customer.nextReminder = "已逾期";
  customer.poolStatus = "owned";
  wrong.ownerId = shirleyUser.id;
  wrong.nextReminder = "明".repeat(201);
  wrong.poolStatus = "owned";
  miaCustomer.ownerId = alexUser.id;
  miaCustomer.nextReminder = "下周";
  miaCustomer.poolStatus = "owned";
  pooled.ownerId = shirleyUser.id;
  pooled.nextReminder = "还在";
  pooled.poolStatus = "public";
  emptyFollow.nextReminder = "";
  emptyFollow.poolStatus = "owned";
  lead.ownerId = shirleyUser.id;
  lead.nextFollowAt = "2026-11-06 09:00";
  lead.deletedAt = "";
  prospect.ownerId = shirleyUser.id;
  prospect.teamId = "europe";
  prospect.status = "excluded";
  prospect.leadId = "";
  prospect.nextFollowAt = "2026-11-08 09:00";
  prospect.outreachState = "suppressed";
  store.customers.push({
    ...customer,
    id: "c_nof_blank",
    company: "空白跟进",
    nextReminder: "   ",
    poolStatus: "owned",
    ownerId: shirleyUser.id
  });
  store.leads.push({
    ...leadTemplate,
    id: "l_nof_deleted",
    company: "已删除线索",
    ownerId: shirleyUser.id,
    nextFollowAt: "明天",
    deletedAt: "2026-11-01T00:00:00.000Z"
  });
  store.callOutcomeAudits.push({
    id: "coa_nof_c1",
    teamId: "europe",
    actorId: shirleyUser.id,
    at: "2026-11-04T01:00:00.000Z",
    callRecordId: "ocr_nof_c1",
    previousOutcome: "",
    nextOutcome: "无意向",
    previousNote: "",
    nextNote: ""
  });
  store.outboundCallRecords.push(
    record({ id: "ocr_nof_c1_old", targetType: "customer", targetId: "c1", callOutcome: "有意向", startTimeRaw: "1000", maskedNumber: "13800138000" }),
    record({ id: "ocr_nof_c1", targetType: "customer", targetId: "c1", callOutcome: "无意向", startTimeRaw: "3000", maskedNumber: "13800138000", establishedTimeRaw: "1" }),
    record({ id: "ocr_nof_c2", targetType: "customer", targetId: "c2", callOutcome: "号码错误", startTimeRaw: "2800", contactDisposition: "NoAnswer", establishedTimeRaw: "" }),
    record({ id: "ocr_nof_c3", targetType: "customer", targetId: "c3", callOutcome: "无意向", startTimeRaw: "2700", agentIds: "agent@ccc-nof-b" }),
    record({ id: "ocr_nof_c4", targetType: "customer", targetId: "c4", callOutcome: "无意向", startTimeRaw: "2600" }),
    record({ id: "ocr_nof_c5", targetType: "customer", targetId: "c5", callOutcome: "无意向", startTimeRaw: "2500" }),
    record({ id: "ocr_nof_blank", targetType: "customer", targetId: "c_nof_blank", callOutcome: "无意向", startTimeRaw: "2400" }),
    record({ id: "ocr_nof_other", targetType: "customer", targetId: "c5", callOutcome: "其他", startTimeRaw: "1000" }),
    record({ id: "ocr_nof_l2", targetType: "lead", targetId: "l2", callOutcome: "无意向", startTimeRaw: "2200", createdAt: "", updatedAt: "" }),
    record({ id: "ocr_nof_deleted", targetType: "lead", targetId: "l_nof_deleted", callOutcome: "无意向", startTimeRaw: "2100" }),
    record({ id: "ocr_nof_web", targetType: "prospect", targetId: "web_seed_1", callOutcome: "号码错误", startTimeRaw: "2000" }),
    record({ id: "ocr_nof_asia", teamId: "asia", targetType: "customer", targetId: "c_asia", callOutcome: "无意向", startTimeRaw: "3000", maskedNumber: "不要出现" })
  );
  const activitiesBefore = store.customerActivities.length;
  const leadActivitiesBefore = store.leadActivities.length;
  const leadsBefore = store.leads.length;
  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions);
  const callAuditsBefore = store.outboundCallAudits.length;
  const outcomeBefore = store.outboundCallRecords.find((item) => item.id === "ocr_nof_c1")?.callOutcome;

  const mine = await request("/api/negative-outcome-followups?scope=mine", shirley);
  assert.equal(mine.response.status, 200);
  assert.equal(mine.json.scope, "mine");
  assert.equal(mine.json.empty, false);
  assert.equal("connectRate" in mine.json, false);
  const mineIds = mine.json.items.map((item: { targetId: string }) => item.targetId);
  for (const id of ["c1", "c2", "c4", "l2", "web_seed_1"]) assert.equal(mineIds.includes(id), true, id);
  assert.equal(mineIds.includes("c_nof_blank"), false);
  assert.equal(mineIds.includes("c3"), false);
  assert.equal(mineIds.includes("c5"), false);
  assert.equal(mineIds.includes("l_nof_deleted"), false);
  const open = mine.json.items.find((item: { targetId: string }) => item.targetId === "c1");
  assert.equal(open.callRecordId, "ocr_nof_c1");
  assert.equal(open.outcome, "无意向");
  assert.equal(open.labeledAt, "2026-11-04T01:00:00.000Z");
  assert.equal(open.nextFollowAt, "已逾期");
  assert.equal(String(open.maskedNumber).includes("13800138000"), false);
  const prospectRow = mine.json.items.find((item: { targetId: string }) => item.targetId === "web_seed_1");
  assert.match(prospectRow.suppressionNotice, /不改变抑制状态/);
  const undated = mine.json.items.find((item: { targetId: string }) => item.targetId === "l2");
  assert.equal(undated.labeledAt, "");
  assert.equal(store.negativeOutcomeFollowupAudits.some((item) => item.actorId === shirleyUser.id && item.action === "read" && item.result === "read" && item.rowCount === mine.json.items.length), true);

  const onlyWrong = await request("/api/negative-outcome-followups?scope=mine&outcome=%E5%8F%B7%E7%A0%81%E9%94%99%E8%AF%AF", shirley);
  assert.equal(onlyWrong.response.status, 200);
  const wrongIds = onlyWrong.json.items.map((item: { targetId: string }) => item.targetId);
  assert.equal(wrongIds.includes("c2"), true);
  assert.equal(wrongIds.includes("web_seed_1"), true);
  assert.equal(wrongIds.includes("c1"), false);

  const teamDenied = await request("/api/negative-outcome-followups?scope=team", shirley);
  assert.equal(teamDenied.response.status, 403);
  assert.equal(store.negativeOutcomeFollowupAudits.some((item) => item.actorId === shirleyUser.id && item.action === "read" && item.scope === "team" && item.result === "rejected" && item.reason === "forbidden"), true);
  const miaTeam = await request("/api/negative-outcome-followups?scope=team", mia);
  assert.equal(miaTeam.response.status, 403);
  const alexTeam = await request("/api/negative-outcome-followups?scope=team", alex);
  assert.equal(alexTeam.response.status, 200);
  const adminTeam = await request("/api/negative-outcome-followups?scope=team", admin);
  assert.equal(adminTeam.response.status, 200);
  assert.equal(adminTeam.json.items.some((item: { targetId: string }) => item.targetId === "c3"), true);

  const auditsAfterOk = store.negativeOutcomeFollowupAudits.length;
  assert.equal((await request("/api/negative-outcome-followups?scope=all", shirley)).response.status, 400);
  assert.equal((await request("/api/negative-outcome-followups?scope=mine&outcome=%E6%9C%89%E6%84%8F%E5%90%91", shirley)).response.status, 400);
  assert.equal((await request("/api/negative-outcome-followups?scope=mine", "")).response.status, 401);
  assert.equal((await request("/api/negative-outcome-followups?scope=mine", noRead)).response.status, 403);
  assert.equal(store.negativeOutcomeFollowupAudits.length, auditsAfterOk);

  const pooledClear = await request("/api/negative-outcome-followups/clear", shirley, "POST", { targetType: "customer", targetId: "c4" });
  assert.equal(pooledClear.response.status, 409);
  assert.equal(pooledClear.json.reason, "public_pool");
  assert.equal(pooled.nextReminder, "还在");
  assert.equal(store.negativeOutcomeFollowupAudits.some((item) => item.action === "clear" && item.targetId === "c4" && item.result === "rejected" && item.reason === "public_pool" && item.previousNextFollowAt === ""), true);

  const previewClear = await request("/api/negative-outcome-followups/clear", shirley, "POST", { targetType: "prospect", targetId: "web_seed_1" });
  assert.equal(previewClear.response.status, 409, JSON.stringify(previewClear.json));
  assert.equal(previewClear.json.reason, "not_contactable");
  assert.equal(prospect.nextFollowAt, "2026-11-08 09:00");
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);

  prospect.status = "contactable";
  const prospectClear = await request("/api/negative-outcome-followups/clear", shirley, "POST", { targetType: "prospect", targetId: "web_seed_1" });
  assert.equal(prospectClear.response.status, 200, JSON.stringify(prospectClear.json));
  assert.equal(prospect.nextFollowAt, "");
  assert.equal(prospect.outreachState, "suppressed");
  assert.match(prospectClear.json.suppressionNotice, /不改变抑制状态/);
  assert.equal(store.leadActivities.length, leadActivitiesBefore);
  const afterProspect = await request("/api/negative-outcome-followups?scope=mine", shirley);
  assert.equal(afterProspect.json.items.some((item: { targetId: string }) => item.targetId === "web_seed_1"), false);

  const noUpdateClear = await request("/api/negative-outcome-followups/clear", noUpdate, "POST", { targetType: "customer", targetId: "c1" });
  assert.equal(noUpdateClear.response.status, 403);
  assert.equal(customer.nextReminder, "已逾期");
  assert.equal(store.negativeOutcomeFollowupAudits.some((item) => item.actorId === "u_nof_no_update" && item.action === "clear" && item.result === "rejected" && item.reason === "forbidden"), true);

  const cleared = await request("/api/negative-outcome-followups/clear", shirley, "POST", { targetType: "customer", targetId: "c1" });
  assert.equal(cleared.response.status, 200);
  assert.equal(customer.nextReminder, "");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_nof_c1")?.callOutcome, outcomeBefore);
  assert.equal(store.customerActivities.length, activitiesBefore);
  const again = await request("/api/negative-outcome-followups/clear", shirley, "POST", { targetType: "customer", targetId: "c1" });
  assert.equal(again.response.status, 400);
  assert.equal(again.json.reason, "not_pending");
  assert.equal(store.negativeOutcomeFollowupAudits.filter((item) => item.action === "clear" && item.targetId === "c1" && item.result === "updated").length, 1);

  const longClear = await request("/api/negative-outcome-followups/clear", shirley, "POST", { targetType: "customer", targetId: "c2" });
  assert.equal(longClear.response.status, 200);
  assert.equal(wrong.nextReminder, "");
  assert.equal(longClear.json.previousNextFollowAt.length, 200);
  const longAudit = store.negativeOutcomeFollowupAudits.find((item) => item.action === "clear" && item.targetId === "c2" && item.result === "updated");
  assert.equal(longAudit?.previousNextFollowAt.length, 200);

  const hidden = await request("/api/negative-outcome-followups/clear", shirley, "POST", { targetType: "customer", targetId: "c3" });
  assert.equal(hidden.response.status, 400);
  assert.equal(hidden.json.reason, "not_pending");
  assert.equal(miaCustomer.nextReminder, "下周");
  const adminClear = await request("/api/negative-outcome-followups/clear", admin, "POST", { targetType: "customer", targetId: "c3" });
  assert.equal(adminClear.response.status, 200, JSON.stringify(adminClear.json));
  assert.equal(miaCustomer.nextReminder, "");

  const leadActivitiesAtLead = store.leadActivities.length;
  const leadClear = await request("/api/negative-outcome-followups/clear", shirley, "POST", { targetType: "lead", targetId: "l2" });
  assert.equal(leadClear.response.status, 200, JSON.stringify(leadClear.json));
  assert.equal(lead.nextFollowAt, "");
  assert.equal(store.leadActivities.length, leadActivitiesAtLead);

  prospect.leadId = lead.id;
  prospect.nextFollowAt = "2026-11-09 09:00";
  lead.nextFollowAt = "2026-11-09 09:00";
  const synced = await request("/api/negative-outcome-followups/clear", shirley, "POST", { targetType: "prospect", targetId: "web_seed_1" });
  assert.equal(synced.response.status, 200, JSON.stringify(synced.json));
  assert.equal(prospect.nextFollowAt, "");
  assert.equal(lead.nextFollowAt, "");
  assert.equal(store.leadActivities.length, leadActivitiesAtLead);

  const beforeBatch = store.negativeOutcomeFollowupAudits.length;
  const batch = await request("/api/negative-outcome-followups/clear", shirley, "POST", { targetType: "customer", targetId: "c_nof_blank", targets: ["c_nof_blank"] });
  assert.equal(batch.response.status, 400);
  assert.equal((await request("/api/negative-outcome-followups/clear", shirley, "POST", { targetType: "customer", targetId: "c_nof_blank", note: "x" })).response.status, 400);
  assert.equal((await request("/api/negative-outcome-followups/clear", "", "POST", { targetType: "customer", targetId: "c_nof_blank" })).response.status, 401);
  assert.equal((await request("/api/negative-outcome-followups/clear", noRead, "POST", { targetType: "customer", targetId: "c_nof_blank" })).response.status, 403);
  assert.equal(store.negativeOutcomeFollowupAudits.length, beforeBatch);
  assert.equal(store.customers.find((item) => item.id === "c_nof_blank")?.nextReminder, "   ");

  assert.equal(store.leads.length, leadsBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), false);
  assert.equal(aliyunHits, 0);
  const auditText = JSON.stringify(store.negativeOutcomeFollowupAudits);
  assert.equal(auditText.includes("13800138000"), false);
  assert.equal(auditText.includes("不要出现"), false);
  assert.equal(auditText.includes("AccessKey"), false);
  console.log("negative outcome follow-up http tests passed");
} finally {
  setOutboundNowForTests(undefined);
  const store = getStore();
  setTenantTimezoneOverride(store, "europe", undefined);
  globalThis.fetch = originalFetch;
  server.close();
}
