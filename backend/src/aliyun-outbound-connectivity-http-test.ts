import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { encryptAliyunOutboundSecret } from "./credential-security.js";
import { setOutboundDialerForTests } from "./outbound-call.js";
import {
  CONNECTIVITY_CHECK_LIMIT,
  CONNECTIVITY_CHECK_WINDOW_MS,
  setConnectivityClockForTests,
  setConnectivityTransportForTests
} from "./aliyun-outbound-connectivity.js";
import type { CccRpcRequest } from "./aliyun-ccc-make-call.js";
import type { ConnectivityItem } from "./aliyun-outbound-connectivity.js";

const secret = "SkSecretValue9999wxyz";
const accessKeyId = "LTAI12345678wxyz";
const callbackToken = "callbackTokenValueWxyz";
const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start connectivity test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

const calls: CccRpcRequest[] = [];
let dials = 0;
let mode: "ok" | "credentials" = "ok";
setOutboundDialerForTests({
  async makeCall() {
    dials += 1;
    return { jobId: "should-not-dial", callType: "OUTBOUND" };
  }
});
setConnectivityTransportForTests(async (request) => {
  calls.push(request);
  if (mode === "credentials") {
    return { Code: "SignatureDoesNotMatch", Message: `bad ${secret} ${accessKeyId}` };
  }
  return {
    Code: "OK",
    HttpStatusCode: 200,
    Message: secret,
    Data: {
      TotalCount: 1,
      List: [{ UserId: "agent@ccc-demo", Mobile: "13800001111", Email: "agent@example.com" }]
    }
  };
});

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

function item(items: ConnectivityItem[], id: ConnectivityItem["id"]) {
  const found = items.find((entry) => entry.id === id);
  assert.ok(found, id);
  return found;
}

try {
  const store = getStore();
  const admin = await login("admin@keduoduo.com");
  const manager = await login("alex@keduoduo.com");
  const sales = await login("shirley@keduoduo.com");
  const adminUser = store.users.find((entry) => entry.email === "admin@keduoduo.com");
  assert.ok(adminUser);
  store.users.push({
    ...adminUser,
    id: "u_admin_me_connectivity",
    name: "ME Admin",
    email: "me-admin-connectivity@keduoduo.com",
    teamId: "middle-east",
    role: "admin",
    status: "active",
    authVersion: adminUser.authVersion || 1
  });
  const otherAdmin = await login("me-admin-connectivity@keduoduo.com");

  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const leadsBefore = store.leads.length;
  const auditsBefore = store.aliyunOutboundConnectivityAudits.length;
  const mappingsBefore = store.aliyunAgentMappings.length;

  const denied = await request("/api/aliyun-outbound/connectivity-check", sales, "POST", {});
  assert.equal(denied.response.status, 403);
  const managerDenied = await request("/api/aliyun-outbound/connectivity-check", manager, "POST", {});
  assert.equal(managerDenied.response.status, 403);
  assert.equal(store.aliyunOutboundConnectivityAudits.length, auditsBefore);
  assert.equal(calls.length, 0);
  assert.equal(JSON.stringify(denied.json).includes(secret), false);

  const missing = await request("/api/aliyun-outbound/connectivity-check", admin, "POST", {});
  assert.equal(missing.response.status, 200);
  assert.equal(missing.json.aliyunOutboundEnabled, false);
  assert.equal(item(missing.json.items, "config_complete").ok, false);
  assert.equal(item(missing.json.items, "credentials").ok, false);
  assert.equal(calls.length, 0);
  assert.equal(store.aliyunOutboundConfigs.find((entry) => entry.teamId === "europe")?.aliyunOutboundEnabled, undefined);

  store.aliyunOutboundConfigs.push({
    teamId: "europe",
    aliyunOutboundEnabled: false,
    instanceId: "ccc-demo",
    region: "cn-shanghai",
    callerNumber: "02100001111",
    callWindowStart: "09:00",
    callWindowEnd: "20:00",
    maxCallsPerNumberPerDay: 3,
    minIntervalMinutes: 30,
    accessKeyIdEncrypted: encryptAliyunOutboundSecret("europe", "accessKeyId", accessKeyId),
    accessKeySecretEncrypted: encryptAliyunOutboundSecret("europe", "accessKeySecret", secret),
    callbackPathTokenEncrypted: encryptAliyunOutboundSecret("europe", "callbackPathToken", callbackToken),
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  });
  const salesUser = store.users.find((entry) => entry.email === "shirley@keduoduo.com");
  assert.ok(salesUser);
  store.aliyunAgentMappings.push({
    id: "map_connectivity",
    teamId: "europe",
    crmUserId: salesUser.id,
    cccUserId: "agent@ccc-demo",
    loginName: "agent",
    displayName: "坐席",
    extension: "8001",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  });

  const success = await request("/api/aliyun-outbound/connectivity-check", admin, "POST", {
    action: "MakeCall",
    Callee: "13800138000",
    accessKeySecret: secret
  });
  assert.equal(success.response.status, 200);
  assert.equal(success.json.aliyunOutboundEnabled, false);
  for (const id of ["config_complete", "credentials", "instance", "agent_mapping", "callback"] as const) {
    assert.equal(item(success.json.items, id).ok, true, id);
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "ListUsers");
  assert.equal("Callee" in calls[0].params, false);
  assert.equal(calls[0].params.InstanceId, "ccc-demo");
  const successJson = JSON.stringify(success.json);
  assert.equal(successJson.includes(secret), false);
  assert.equal(successJson.includes(accessKeyId), false);
  assert.equal(successJson.includes(callbackToken), false);
  assert.equal(successJson.includes("13800001111"), false);
  assert.equal(successJson.includes("MakeCall"), false);
  assert.equal(store.aliyunOutboundConfigs.find((entry) => entry.teamId === "europe")?.aliyunOutboundEnabled, false);
  assert.equal(JSON.stringify(store.aliyunOutboundConnectivityAudits).includes(secret), false);
  assert.equal(JSON.stringify(store.aliyunOutboundConnectivityAudits).includes(accessKeyId), false);

  mode = "credentials";
  const bad = await request("/api/aliyun-outbound/connectivity-check", admin, "POST", {});
  assert.equal(bad.response.status, 200);
  assert.equal(item(bad.json.items, "credentials").ok, false);
  assert.equal(item(bad.json.items, "instance").ok, false);
  assert.equal(JSON.stringify(bad.json).includes(secret), false);
  assert.equal(JSON.stringify(bad.json).includes(accessKeyId), false);
  assert.equal(calls.at(-1)?.action, "ListUsers");
  mode = "ok";

  const cross = await request("/api/aliyun-outbound/connectivity-check", otherAdmin, "POST", { teamId: "europe", accessKeySecret: secret });
  assert.equal(cross.response.status, 403);
  assert.equal(JSON.stringify(cross.json).includes(secret), false);
  assert.equal(store.aliyunOutboundConfigs.find((entry) => entry.teamId === "europe")?.aliyunOutboundEnabled, false);

  const callsBeforeLimit = calls.length;
  let clock = Date.parse("2030-06-01T00:00:00.000Z");
  setConnectivityClockForTests(() => clock);
  for (let index = 0; index < CONNECTIVITY_CHECK_LIMIT; index += 1) {
    const allowed = await request("/api/aliyun-outbound/connectivity-check", admin, "POST", {});
    assert.equal(allowed.response.status, 200, `attempt ${index}`);
  }
  const limited = await request("/api/aliyun-outbound/connectivity-check", admin, "POST", { accessKeySecret: secret });
  assert.equal(limited.response.status, 429);
  assert.match(String(limited.json.message), /过于频繁/);
  assert.equal(JSON.stringify(limited.json).includes(secret), false);
  assert.equal(calls.length, callsBeforeLimit + CONNECTIVITY_CHECK_LIMIT);
  assert.equal(store.aliyunOutboundConnectivityAudits.some((entry) => entry.result === "rate_limited"), true);
  clock += CONNECTIVITY_CHECK_WINDOW_MS + 1;
  const again = await request("/api/aliyun-outbound/connectivity-check", admin, "POST", {});
  assert.equal(again.response.status, 200);

  assert.equal(store.aliyunOutboundConfigs.find((entry) => entry.teamId === "europe")?.aliyunOutboundEnabled, false);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.aliyunAgentMappings.length, mappingsBefore + 1);
  assert.equal(dials, 0);
  assert.equal(aliyunHits, 0);
  assert.equal(calls.every((entry) => entry.action === "ListUsers"), true);

  console.log("aliyun outbound connectivity http tests passed");
} finally {
  setConnectivityTransportForTests(undefined);
  setConnectivityClockForTests(undefined);
  setOutboundDialerForTests(undefined);
  globalThis.fetch = originalFetch;
  server.close();
}
