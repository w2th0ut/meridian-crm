import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";

const secret = "SkSecretValue9999wxyz";
const accessKeyId = "LTAI12345678wxyz";
const callbackToken = "callbackTokenValueWxyz";
const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start aliyun outbound config test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

const consoleMethods = ["log", "info", "debug", "warn", "error"] as const;
const consoleOutput: string[] = [];
const originalConsole = Object.fromEntries(consoleMethods.map((method) => [method, console[method]])) as Record<typeof consoleMethods[number], (...args: unknown[]) => void>;
for (const method of consoleMethods) {
  console[method] = (...args: unknown[]) => {
    consoleOutput.push(args.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join(" "));
    originalConsole[method](...args);
  };
}

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
  const admin = await login("admin@keduoduo.com");
  const manager = await login("alex@keduoduo.com");
  const sales = await login("shirley@keduoduo.com");
  const adminUser = store.users.find((item) => item.email === "admin@keduoduo.com");
  assert.ok(adminUser);
  store.users.push({
    ...adminUser,
    id: "u_admin_me_outbound",
    name: "ME Admin",
    email: "me-admin-outbound@keduoduo.com",
    teamId: "middle-east",
    role: "admin",
    status: "active",
    authVersion: adminUser.authVersion || 1
  });
  const otherAdmin = await login("me-admin-outbound@keduoduo.com");

  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const leadsBefore = store.leads.length;
  const auditsBefore = store.aliyunOutboundConfigAudits.length;

  const denied = await request("/api/aliyun-outbound/config", sales);
  assert.equal(denied.response.status, 403);
  const managerDenied = await request("/api/aliyun-outbound/config", manager);
  assert.equal(managerDenied.response.status, 403);
  const salesWrite = await request("/api/aliyun-outbound/config", sales, "PUT", {
    aliyunOutboundEnabled: true,
    region: "cn-shanghai",
    accessKeySecret: secret
  });
  assert.equal(salesWrite.response.status, 403);
  assert.equal(JSON.stringify(salesWrite.json).includes(secret), false);
  assert.equal(store.aliyunOutboundConfigAudits.length, auditsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.teamId === "europe"), false);

  const initial = await request("/api/aliyun-outbound/config", admin);
  assert.equal(initial.response.status, 200);
  assert.equal(initial.json.teamId, "europe");
  assert.equal(initial.json.config.aliyunOutboundEnabled, false);
  assert.equal(initial.json.config.callWindowStart, "09:00");
  assert.equal(initial.json.config.callWindowEnd, "20:00");
  assert.equal(initial.json.config.maxCallsPerNumberPerDay, 3);
  assert.equal(initial.json.config.minIntervalMinutes, 30);
  assert.equal(initial.json.config.accessKeyId.configured, false);
  assert.equal(initial.json.config.accessKeySecret.configured, false);
  assert.equal(initial.json.config.callbackPathToken.configured, false);
  assert.equal(initial.json.canManage, true);
  assert.deepEqual(initial.json.regions, ["cn-shanghai", "cn-hangzhou"]);

  const illegal = await request("/api/aliyun-outbound/config", admin, "PUT", {
    region: "cn-beijing",
    accessKeySecret: secret,
    accessKeyId,
    callbackPathToken: callbackToken
  });
  assert.equal(illegal.response.status, 400);
  assert.match(String(illegal.json.message || ""), /地域必须是 cn-shanghai 或 cn-hangzhou/);
  assert.equal(JSON.stringify(illegal.json).includes(secret), false);
  assert.equal(JSON.stringify(illegal.json).includes("cn-beijing"), false);
  assert.equal(store.aliyunOutboundConfigAudits.length, auditsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.accessKeySecretEncrypted), false);

  const saved = await request("/api/aliyun-outbound/config", admin, "PUT", {
    aliyunOutboundEnabled: false,
    instanceId: "ccc-demo",
    region: "cn-shanghai",
    callerNumber: "02100001111",
    accessKeyId,
    accessKeySecret: secret,
    callbackPathToken: callbackToken
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.json.config.aliyunOutboundEnabled, false);
  assert.equal(saved.json.config.instanceId, "ccc-demo");
  assert.equal(saved.json.config.region, "cn-shanghai");
  assert.equal(saved.json.config.accessKeySecret.configured, true);
  assert.equal(saved.json.config.accessKeySecret.last4, "wxyz");
  assert.equal(saved.json.config.accessKeyId.last4, "wxyz");
  assert.equal(saved.json.config.callbackPathToken.last4, "Wxyz");
  const savedJson = JSON.stringify(saved.json);
  assert.equal(savedJson.includes(secret), false);
  assert.equal(savedJson.includes(accessKeyId), false);
  assert.equal(savedJson.includes(callbackToken), false);
  assert.equal(savedJson.includes("aliyun-ccc-v1"), false);

  const stored = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe");
  assert.ok(stored);
  assert.equal(stored.aliyunOutboundEnabled, false);
  assert.equal(stored.accessKeySecretEncrypted.includes(secret), false);
  assert.equal(stored.accessKeyIdEncrypted.includes(accessKeyId), false);
  assert.equal(stored.callbackPathTokenEncrypted.includes(callbackToken), false);

  const auditJson = JSON.stringify(store.aliyunOutboundConfigAudits);
  assert.equal(auditJson.includes(secret), false);
  assert.equal(auditJson.includes(accessKeyId), false);
  assert.equal(auditJson.includes(callbackToken), false);
  assert.match(store.aliyunOutboundConfigAudits[0]?.summary || "", /accessKeySecret: 已配置/);
  assert.equal(store.aliyunOutboundConfigAudits.length, auditsBefore + 1);

  const reread = await request("/api/aliyun-outbound/config", admin);
  assert.equal(reread.json.config.accessKeySecret.last4, "wxyz");
  assert.equal(JSON.stringify(reread.json).includes(secret), false);

  const kept = await request("/api/aliyun-outbound/config", admin, "PUT", {
    callerNumber: "02100002222"
  });
  assert.equal(kept.response.status, 200);
  assert.equal(kept.json.config.callerNumber, "02100002222");
  assert.equal(kept.json.config.callWindowStart, "09:00");
  assert.equal(kept.json.config.accessKeySecret.last4, "wxyz");
  const auditsBeforeWindow = store.aliyunOutboundConfigAudits.length;
  const windowed = await request("/api/aliyun-outbound/config", admin, "PUT", {
    callWindowStart: "10:00",
    callWindowEnd: "18:00",
    maxCallsPerNumberPerDay: 2,
    minIntervalMinutes: 45
  });
  assert.equal(windowed.response.status, 200);
  assert.equal(windowed.json.config.aliyunOutboundEnabled, false);
  assert.equal(windowed.json.config.callWindowStart, "10:00");
  assert.equal(windowed.json.config.callWindowEnd, "18:00");
  assert.equal(windowed.json.config.maxCallsPerNumberPerDay, 2);
  assert.equal(windowed.json.config.minIntervalMinutes, 45);
  assert.equal(store.aliyunOutboundConfigAudits.length, auditsBeforeWindow + 1);
  assert.equal(store.aliyunOutboundConfigAudits[0]?.action, "update_config");
  assert.match(store.aliyunOutboundConfigAudits[0]?.summary || "", /callWindowStart: 09:00 → 10:00/);
  assert.match(store.aliyunOutboundConfigAudits[0]?.summary || "", /minIntervalMinutes: 30 → 45/);
  assert.equal(JSON.stringify(windowed.json).includes(secret), false);
  const reversed = await request("/api/aliyun-outbound/config", admin, "PUT", {
    callWindowStart: "20:00",
    callWindowEnd: "09:00"
  });
  assert.equal(reversed.response.status, 400);
  assert.match(String(reversed.json.message || ""), /开始必须早于结束/);
  assert.equal(store.aliyunOutboundConfigAudits.length, auditsBeforeWindow + 1);
  assert.equal(store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.callWindowStart, "10:00");
  assert.equal(store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled, false);
  assert.equal(JSON.stringify(kept.json).includes(secret), false);
  assert.equal(JSON.stringify(store.aliyunOutboundConfigAudits).includes(secret), false);

  const other = await request("/api/aliyun-outbound/config", otherAdmin);
  assert.equal(other.response.status, 200);
  assert.equal(other.json.teamId, "middle-east");
  assert.equal(other.json.config.aliyunOutboundEnabled, false);
  assert.equal(other.json.config.instanceId, "");
  assert.equal(other.json.config.accessKeySecret.configured, false);
  assert.equal(JSON.stringify(other.json).includes("wxyz"), false);
  assert.equal(JSON.stringify(other.json).includes(secret), false);

  const crossWrite = await request("/api/aliyun-outbound/config", otherAdmin, "PUT", {
    teamId: "europe",
    aliyunOutboundEnabled: true,
    accessKeySecret: "AnotherSecretValue1234"
  });
  assert.equal(crossWrite.response.status, 403);
  assert.equal(store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled, false);
  assert.equal(JSON.stringify(store.aliyunOutboundConfigAudits).includes("AnotherSecretValue1234"), false);

  const crossRead = await request("/api/aliyun-outbound/config?teamId=europe", otherAdmin);
  assert.equal(crossRead.response.status, 403);

  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(aliyunHits, 0);
  const logs = consoleOutput.join("\n");
  assert.equal(logs.includes(secret), false);
  assert.equal(logs.includes(accessKeyId), false);
  assert.equal(logs.includes(callbackToken), false);

  console.log("aliyun outbound config http tests passed");
} finally {
  globalThis.fetch = originalFetch;
  for (const method of consoleMethods) console[method] = originalConsole[method];
  server.close();
}
