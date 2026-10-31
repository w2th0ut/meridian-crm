import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { encryptAliyunOutboundSecret } from "./credential-security.js";
import { setOutboundDialerForTests } from "./outbound-call.js";
import { setCccDirectoryForTests, type CccDirectory } from "./aliyun-ccc-directory.js";
import type { MakeCallParams } from "./aliyun-ccc-make-call.js";

const secret = "SkSecretValue9999wxyz";
const accessKeyId = "LTAI12345678wxyz";
const phone = "+46111000999";
const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start workbench test server");
const baseUrl = `http://127.0.0.1:${address.port}`;
const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com") || url.includes("alicdn.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

const calls: MakeCallParams[] = [];
setOutboundDialerForTests({
  async makeCall(params) {
    calls.push({ ...params });
    return { jobId: "job-workbench-1", callType: "OUTBOUND" };
  }
});

const directoryActions: string[] = [];
const directory: CccDirectory = {
  async listUsers(input) {
    directoryActions.push(`ListUsers:${input.instanceId}`);
    return {
      seats: [{
        userId: "agent@ccc-demo",
        loginName: "agent",
        displayName: "坐席小王",
        extension: "8001",
        workMode: "ON_SITE",
        roleId: "Agent@ccc-demo"
      }],
      pageNumber: 1,
      pageSize: 100,
      totalCount: 1
    };
  },
  async listCampaigns(input) {
    directoryActions.push(`ListCampaigns:${input.instanceId}`);
    return {
      campaigns: [{
        campaignId: "camp-1",
        name: "测试活动",
        state: "Paused",
        totalCases: 2,
        casesConnected: 1,
        casesUncompleted: 1,
        casesAborted: 0,
        queueName: "组"
      }],
      pageNumber: 1,
      pageSize: 20,
      totalCount: 1
    };
  },
  async listCases(input) {
    directoryActions.push(`ListCases:${input.campaignId}`);
    return {
      cases: [{
        caseId: "case-1",
        state: "Pending",
        attemptCount: 0,
        failureReason: "",
        maskedNumber: phone
      }],
      pageNumber: 1,
      pageSize: 20,
      totalCount: 1
    };
  },
  async invoke(action, params) {
    directoryActions.push(`${action}:${String(params.InstanceId || "")}:${String(params.UserId || "")}`);
    return {
      Code: "OK",
      HttpStatusCode: 200,
      RequestId: "req-1",
      Data: { AccessKeySecret: secret, AccessKeyId: accessKeyId, UserId: params.UserId || "" }
    };
  }
};
setCccDirectoryForTests(directory);

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

try {
  const store = getStore();
  const shirley = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const adminUser = store.users.find((item) => item.email === "admin@keduoduo.com");
  assert.ok(shirley && adminUser);
  const customer = store.customers.find((item) => item.id === "c1");
  assert.ok(customer);
  const phoneBefore = customer.phone;
  customer.phone = phone;
  const customersBefore = store.customers.length;
  const leadsBefore = store.leads.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const token = "callback-token-demo-1";
  const config = {
    teamId: "europe",
    aliyunOutboundEnabled: true,
    instanceId: "ccc-demo",
    region: "cn-shanghai",
    callerNumber: "02100001111",
    accessKeyIdEncrypted: encryptAliyunOutboundSecret("europe", "accessKeyId", accessKeyId),
    accessKeySecretEncrypted: encryptAliyunOutboundSecret("europe", "accessKeySecret", secret),
    callbackPathTokenEncrypted: encryptAliyunOutboundSecret("europe", "callbackPathToken", token),
    updatedBy: adminUser.id,
    updatedAt: "2026-10-31T00:00:00.000Z"
  };
  const existing = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe");
  if (existing) Object.assign(existing, config);
  else store.aliyunOutboundConfigs.push(config);

  const admin = await login("admin@keduoduo.com");
  const shirleyToken = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");

  const salesList = await request("/api/aliyun-outbound/agent-mappings", shirleyToken);
  assert.equal(salesList.response.status, 403);
  assert.equal(directoryActions.length, 0);

  const createdDenied = await request("/api/aliyun-outbound/agent-mappings", shirleyToken, "POST", {
    crmUserId: shirley.id,
    cccUserId: "agent@ccc-demo"
  });
  assert.equal(createdDenied.response.status, 403);
  assert.equal(store.agentMappingAudits[0]?.result, "rejected");
  assert.equal(store.agentMappingAudits[0]?.reason, "forbidden");
  assert.equal(store.agentMappingAudits[0]?.actorId, shirley.id);

  const missingSeat = await request("/api/aliyun-outbound/agent-mappings", admin, "POST", {
    crmUserId: shirley.id,
    cccUserId: "other@ccc-demo"
  });
  assert.equal(missingSeat.response.status, 409);
  assert.equal(missingSeat.json.reason, "not_in_directory");
  assert.equal(store.aliyunAgentMappings.length, 0);
  assert.equal(store.agentMappingAudits[0]?.action, "create");
  assert.equal(store.agentMappingAudits[0]?.result, "rejected");

  const created = await request("/api/aliyun-outbound/agent-mappings", admin, "POST", {
    crmUserId: shirley.id,
    cccUserId: "agent@ccc-demo"
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.json.mapping.cccUserId, "agent@ccc-demo");
  assert.equal(created.json.mapping.loginName, "agent");
  assert.equal(JSON.stringify(created.json).includes(secret), false);
  assert.equal(JSON.stringify(created.json).includes(accessKeyId), false);
  assert.equal(store.agentMappingAudits[0]?.result, "allowed");
  assert.equal(store.agentMappingAudits[0]?.action, "create");

  const conflict = await request("/api/aliyun-outbound/agent-mappings", admin, "POST", {
    crmUserId: adminUser.id,
    cccUserId: "agent@ccc-demo"
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.json.reason, "conflict");
  assert.equal(store.agentMappingAudits[0]?.result, "rejected");
  assert.equal(store.aliyunAgentMappings.filter((item) => item.cccUserId === "agent@ccc-demo").length, 1);

  const sessionBeforePerm = await request("/api/aliyun-outbound/workbench/session", mia);
  assert.equal(sessionBeforePerm.response.status, 200);
  assert.equal(sessionBeforePerm.json.load, false);
  assert.equal(sessionBeforePerm.json.instanceId, undefined);
  assert.equal(JSON.stringify(sessionBeforePerm.json).includes(secret), false);

  const session = await request("/api/aliyun-outbound/workbench/session", shirleyToken);
  assert.equal(session.json.load, true);
  assert.equal(session.json.instanceId, "ccc-demo");
  assert.equal(session.json.regionId, "cn-shanghai");
  assert.equal(session.json.ajaxPath, "/api/aliyun-outbound/workbench/api");
  assert.equal(JSON.stringify(session.json).includes(secret), false);
  assert.equal(JSON.stringify(session.json).includes(accessKeyId), false);

  const before = await request("/api/aliyun-outbound/workbench/before-dial", shirleyToken, "POST", { callee: phone });
  assert.equal(before.response.status, 200);
  assert.equal(before.json.allowed, true);
  assert.equal(calls.length, 0);

  const makeCall = await request(
    "/api/aliyun-outbound/workbench/api?action=MakeCall&product=CloudCallCenter&version=2020-07-01&region=cn-shanghai",
    shirleyToken,
    "POST",
    { request: JSON.stringify({ Callee: phone, UserId: "someone-else" }) }
  );
  assert.equal(makeCall.response.status, 200);
  assert.equal(makeCall.json.data.CallContext.JobId, "job-workbench-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].UserId, "agent@ccc-demo");
  assert.equal(calls[0].Callee, phone);
  assert.equal(directoryActions.some((item) => item.startsWith("MakeCall")), false);
  assert.equal(JSON.stringify(makeCall.json).includes(secret), false);

  const blocked = await request(
    "/api/aliyun-outbound/workbench/api?action=CreateUser&product=CloudCallCenter&version=2020-07-01&region=cn-shanghai",
    shirleyToken,
    "POST",
    {}
  );
  assert.equal(blocked.response.status, 403);
  assert.equal(directoryActions.some((item) => item.startsWith("CreateUser")), false);

  const forwarded = await request(
    "/api/aliyun-outbound/workbench/api?action=PollUserStatus&product=CloudCallCenter&version=2020-07-01&region=cn-shanghai",
    shirleyToken,
    "POST",
    { UserId: "someone-else", AccessKeySecret: secret }
  );
  assert.equal(forwarded.response.status, 200);
  assert.equal(directoryActions.at(-1), "PollUserStatus:ccc-demo:agent@ccc-demo");
  assert.equal(JSON.stringify(forwarded.json).includes(secret), false);
  assert.equal(JSON.stringify(forwarded.json).includes(accessKeyId), false);

  const customersNow = store.customers.length;
  const unknown = await request("/api/aliyun-outbound/screen-pops/match", shirleyToken, "POST", {
    callType: "INBOUND",
    caller: "+46999000111",
    callee: "02100001111",
    jobId: ""
  });
  assert.equal(unknown.response.status, 200);
  assert.equal(unknown.json.label, "未知来电");
  assert.equal(unknown.json.unknown, true);
  assert.equal(unknown.json.matches.length, 0);
  assert.equal(store.customers.length, customersNow);
  assert.equal(JSON.stringify(unknown.json).includes("46999000111"), false);

  const other = await request("/api/aliyun-outbound/screen-pops", mia);
  assert.equal(other.response.status, 403);

  const eventBody = {
    eventType: "Ringing",
    eventTime: "2026-10-31T01:02:03.000Z",
    instanceId: "ccc-demo",
    contactId: "job-pop-1",
    callType: "INBOUND",
    caller: phone,
    callee: "02100001111",
    agentId: "agent@ccc-demo"
  };
  const wrong = await originalFetch(`${baseUrl}/api/integrations/aliyun-ccc/events/wrong-token-value`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(eventBody)
  });
  assert.equal(wrong.status, 401);
  assert.equal(store.aliyunScreenPops.length, 0);

  const posted = await originalFetch(`${baseUrl}/api/integrations/aliyun-ccc/events/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(eventBody)
  });
  const postedJson = await posted.json() as { reason?: string };
  assert.equal(posted.status, 200);
  assert.equal(postedJson.reason, "ignored");
  await originalFetch(`${baseUrl}/api/integrations/aliyun-ccc/events/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(eventBody)
  });
  assert.equal(store.aliyunScreenPops.length, 1);
  assert.equal(store.customers.length, customersBefore);
  assert.equal(store.leads.length, leadsBefore);

  const pops = await request("/api/aliyun-outbound/screen-pops", shirleyToken);
  assert.equal(pops.response.status, 200);
  assert.equal(pops.json.pops.length, 1);
  assert.equal(pops.json.pops[0].matches.some((item: { targetId: string }) => item.targetId === "c1"), true);
  assert.equal(JSON.stringify(pops.json).includes(phone), false);
  assert.equal(JSON.stringify(pops.json).includes(phone.replace(/\D/g, "")), false);

  const miaMapped = store.aliyunAgentMappings.find((item) => item.crmUserId === "u_sales_mia");
  assert.equal(miaMapped, undefined);
  const miaPops = await request("/api/aliyun-outbound/screen-pops", mia);
  assert.equal(miaPops.response.status, 403);

  const syncOff = await request("/api/aliyun-outbound/campaigns/sync", admin, "POST");
  assert.equal(syncOff.response.status, 403);
  assert.equal(syncOff.json.reason, "campaign_disabled");
  assert.equal(directoryActions.some((item) => item.startsWith("ListCampaigns")), false);
  assert.equal(store.aliyunCampaignSyncAudits[0]?.result, "rejected");
  assert.equal(store.aliyunCampaignSyncAudits[0]?.action, "sync");

  const opened = await request("/api/aliyun-outbound/campaigns/setting", admin, "PUT", { enabled: true });
  assert.equal(opened.response.status, 200);
  assert.equal(store.aliyunCampaignSyncAudits[0]?.action, "enable");

  const synced = await request("/api/aliyun-outbound/campaigns/sync", admin, "POST");
  assert.equal(synced.response.status, 200);
  assert.equal(synced.json.campaigns[0].state, "Paused");
  assert.equal(synced.json.campaigns[0].cases[0].maskedNumber.endsWith("0999"), true);
  assert.equal(JSON.stringify(synced.json).includes(phone), false);
  assert.equal(directoryActions.filter((item) => item.startsWith("ListCampaigns")).length, 1);
  assert.equal(directoryActions.filter((item) => item.startsWith("ListCases")).length, 1);
  assert.equal(directoryActions.some((item) => /Submit|Resume|AddCases|CreateCampaign|Import/.test(item)), false);
  assert.equal(store.aliyunCampaignSyncAudits[0]?.result, "allowed");
  assert.equal(store.aliyunCampaignSyncAudits[0]?.campaignCount, 1);

  const closed = await request("/api/aliyun-outbound/campaigns/setting", admin, "PUT", { enabled: false });
  assert.equal(closed.json.enabled, false);
  const syncAgain = await request("/api/aliyun-outbound/campaigns/sync", admin, "POST");
  assert.equal(syncAgain.json.reason, "campaign_disabled");
  assert.equal(directoryActions.filter((item) => item.startsWith("ListCampaigns")).length, 1);

  const removed = await request(`/api/aliyun-outbound/agent-mappings/${created.json.mapping.id}`, admin, "DELETE");
  assert.equal(removed.response.status, 200);
  assert.equal(store.agentMappingAudits[0]?.action, "delete");
  assert.equal(store.agentMappingAudits[0]?.result, "allowed");
  const afterDelete = await request("/api/aliyun-outbound/workbench/session", shirleyToken);
  assert.equal(afterDelete.json.load, false);

  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.customers.length, customersBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(aliyunHits, 0);
  assert.equal(JSON.stringify(store.agentMappingAudits).includes(secret), false);
  assert.equal(JSON.stringify(store.aliyunCampaignSyncAudits).includes(secret), false);
  customer.phone = phoneBefore;
  console.log("aliyun agent workbench http tests passed");
} finally {
  setOutboundDialerForTests(undefined);
  setCccDirectoryForTests(undefined);
  globalThis.fetch = originalFetch;
  server.close();
}
