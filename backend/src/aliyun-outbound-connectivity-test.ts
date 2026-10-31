import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encryptAliyunOutboundSecret } from "./credential-security.js";
import { setOutboundDialerForTests } from "./outbound-call.js";
import {
  CONNECTIVITY_CHECK_LIMIT,
  CONNECTIVITY_CHECK_WINDOW_MS,
  CONNECTIVITY_READONLY_ACTIONS,
  ConnectivityReadonlyDeniedError,
  assertConnectivityReadonlyAction,
  invokeConnectivityReadonly,
  runAliyunOutboundConnectivityCheck,
  setConnectivityClockForTests,
  setConnectivityTransportForTests,
  type ConnectivityCheckStore,
  type ConnectivityItem
} from "./aliyun-outbound-connectivity.js";
import type { CccRpcRequest } from "./aliyun-ccc-make-call.js";
import type { AliyunAgentMapping, AliyunOutboundConfig, AliyunOutboundConnectivityAudit } from "./types.js";

const secret = "SkSecretValue9999abcd";
const accessKeyId = "LTAI12345678abcd";
const callbackToken = "callbackTokenValue1234";

function memoryStore(): ConnectivityCheckStore & {
  aliyunOutboundConfigs: AliyunOutboundConfig[];
  aliyunAgentMappings: AliyunAgentMapping[];
  aliyunOutboundConnectivityAudits: AliyunOutboundConnectivityAudit[];
} {
  return {
    aliyunOutboundConfigs: [],
    aliyunAgentMappings: [],
    aliyunOutboundConnectivityAudits: [],
    async persist() {}
  };
}

function savedConfig(enabled: boolean, token = callbackToken): AliyunOutboundConfig {
  return {
    teamId: "europe",
    aliyunOutboundEnabled: enabled,
    instanceId: "ccc-demo",
    region: "cn-shanghai",
    callerNumber: "02100001111",
    callWindowStart: "09:00",
    callWindowEnd: "20:00",
    maxCallsPerNumberPerDay: 3,
    minIntervalMinutes: 30,
    accessKeyIdEncrypted: encryptAliyunOutboundSecret("europe", "accessKeyId", accessKeyId),
    accessKeySecretEncrypted: encryptAliyunOutboundSecret("europe", "accessKeySecret", secret),
    callbackPathTokenEncrypted: token ? encryptAliyunOutboundSecret("europe", "callbackPathToken", token) : "",
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  };
}

function mapping(): AliyunAgentMapping {
  return {
    id: "map_1",
    teamId: "europe",
    crmUserId: "u_sales",
    cccUserId: "agent@ccc-demo",
    loginName: "agent",
    displayName: "坐席",
    extension: "8001",
    workMode: "ON_SITE",
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  };
}

const admin = { id: "u_admin", teamId: "europe", role: "admin" as const, name: "Admin", email: "admin@keduoduo.com", status: "active" as const };
const sales = { id: "u_sales", teamId: "europe", role: "sales" as const, name: "Sales", email: "sales@keduoduo.com", status: "active" as const };

function itemById(items: ConnectivityItem[], id: ConnectivityItem["id"]) {
  const found = items.find((entry) => entry.id === id);
  assert.ok(found, id);
  return found;
}

let transportCalls: CccRpcRequest[] = [];
let dials = 0;
setOutboundDialerForTests({
  async makeCall() {
    dials += 1;
    return { jobId: "should-not-dial", callType: "OUTBOUND" };
  }
});

function okBody() {
  return {
    Code: "OK",
    HttpStatusCode: 200,
    Message: `echo ${secret} ${accessKeyId} ${callbackToken}`,
    Data: {
      PageNumber: 1,
      PageSize: 1,
      TotalCount: 1,
      List: [{ UserId: "agent@ccc-demo", Mobile: "13800001111", Email: "agent@example.com", LoginName: "agent" }]
    }
  };
}

try {
  assert.deepEqual(CONNECTIVITY_READONLY_ACTIONS, ["ListUsers"]);
  assert.throws(() => assertConnectivityReadonlyAction("MakeCall"), ConnectivityReadonlyDeniedError);
  for (const action of ["MakeCall", "StartBack2BackCall", "RedialCall", "SingleCallByTts", "CreateUser", "ModifyUser", "RemoveUsers", "UpdateSubscription", "AssignJobs", "CreateJobGroup", "CreateCampaign", "ImportDoNotCallNumbers", "ListCampaigns"]) {
    let calls = 0;
    await assert.rejects(() => invokeConnectivityReadonly(action, "cn-shanghai", { InstanceId: "ccc-demo", PageNumber: 1, PageSize: 1, Callee: "13800138000" }, async () => {
      calls += 1;
      return {};
    }), ConnectivityReadonlyDeniedError);
    assert.equal(calls, 0, action);
  }
  let extraCalls = 0;
  await assert.rejects(() => invokeConnectivityReadonly("ListUsers", "cn-shanghai", { InstanceId: "ccc-demo", PageNumber: 1, PageSize: 1, Callee: "13800138000" }, async () => {
    extraCalls += 1;
    return {};
  }), ConnectivityReadonlyDeniedError);
  assert.equal(extraCalls, 0);

  const store = memoryStore();
  const denied = await runAliyunOutboundConnectivityCheck(store, sales, {});
  assert.equal(denied.status, 403);
  assert.equal(store.aliyunOutboundConnectivityAudits.length, 0);
  assert.equal(JSON.stringify(denied.body).includes(secret), false);

  const missing = await runAliyunOutboundConnectivityCheck(store, admin, {});
  assert.equal(missing.status, 200);
  const missingItems = missing.body.items as ConnectivityItem[];
  assert.equal(itemById(missingItems, "config_complete").ok, false);
  assert.equal(itemById(missingItems, "credentials").ok, false);
  assert.equal(itemById(missingItems, "instance").ok, false);
  assert.equal(itemById(missingItems, "agent_mapping").ok, false);
  assert.equal(itemById(missingItems, "callback").ok, false);
  assert.equal(missing.body.aliyunOutboundEnabled, false);
  assert.equal(transportCalls.length, 0);
  assert.equal(store.aliyunOutboundConnectivityAudits.length, 1);
  assert.equal(store.aliyunOutboundConnectivityAudits[0].result, "completed");

  store.aliyunOutboundConfigs.push(savedConfig(false));
  store.aliyunAgentMappings.push(mapping());
  const unwired = await runAliyunOutboundConnectivityCheck(store, admin, {});
  assert.equal(unwired.status, 200);
  assert.equal(itemById(unwired.body.items as ConnectivityItem[], "credentials").detail, "只读查询没有接通");
  assert.equal(itemById(unwired.body.items as ConnectivityItem[], "instance").detail, "只读查询没有接通");
  assert.equal(unwired.body.aliyunOutboundEnabled, false);
  assert.equal(transportCalls.length, 0);
  const enabledBefore = store.aliyunOutboundConfigs[0].aliyunOutboundEnabled;
  const windowBefore = store.aliyunOutboundConfigs[0].callWindowStart;
  setConnectivityTransportForTests(async (request) => {
    transportCalls.push(request);
    return okBody();
  });
  const success = await runAliyunOutboundConnectivityCheck(store, admin, { action: "MakeCall", Callee: "13800138000", accessKeySecret: secret });
  assert.equal(success.status, 200);
  assert.equal(success.body.aliyunOutboundEnabled, false);
  assert.equal(store.aliyunOutboundConfigs[0].aliyunOutboundEnabled, enabledBefore);
  assert.equal(store.aliyunOutboundConfigs[0].callWindowStart, windowBefore);
  assert.equal(store.aliyunAgentMappings.length, 1);
  const successItems = success.body.items as ConnectivityItem[];
  for (const id of ["config_complete", "credentials", "instance", "agent_mapping", "callback"] as const) {
    assert.equal(itemById(successItems, id).ok, true, id);
  }
  assert.equal(transportCalls.length, 1);
  assert.equal(transportCalls[0].action, "ListUsers");
  assert.equal(transportCalls[0].host, "ccc.cn-shanghai.aliyuncs.com");
  assert.deepEqual(transportCalls[0].params, { InstanceId: "ccc-demo", PageNumber: 1, PageSize: 1 });
  const successJson = JSON.stringify(success.body);
  assert.equal(successJson.includes(secret), false);
  assert.equal(successJson.includes(accessKeyId), false);
  assert.equal(successJson.includes(callbackToken), false);
  assert.equal(successJson.includes("13800001111"), false);
  assert.equal(successJson.includes("agent@example.com"), false);
  assert.equal(successJson.includes("agent@ccc-demo"), false);
  const auditJson = JSON.stringify(store.aliyunOutboundConnectivityAudits);
  assert.equal(auditJson.includes(secret), false);
  assert.equal(auditJson.includes(accessKeyId), false);
  assert.equal(auditJson.includes(callbackToken), false);

  let credentialCalls = 0;
  setConnectivityTransportForTests(async (request) => {
    credentialCalls += 1;
    transportCalls.push(request);
    return {
      Code: "SignatureDoesNotMatch",
      Message: `the secret is ${secret} and id is ${accessKeyId}`
    };
  });
  const badCredential = await runAliyunOutboundConnectivityCheck(store, admin, {});
  assert.equal(badCredential.status, 200);
  const badItems = badCredential.body.items as ConnectivityItem[];
  assert.equal(itemById(badItems, "config_complete").ok, true);
  assert.equal(itemById(badItems, "credentials").ok, false);
  assert.match(itemById(badItems, "credentials").detail, /凭证不可用/);
  assert.equal(itemById(badItems, "instance").ok, false);
  assert.equal(badCredential.body.aliyunOutboundEnabled, false);
  const badJson = JSON.stringify(badCredential.body);
  assert.equal(badJson.includes(secret), false);
  assert.equal(badJson.includes(accessKeyId), false);
  assert.equal(badJson.includes("SignatureDoesNotMatch"), false);
  assert.equal(credentialCalls, 1);
  assert.equal(transportCalls.at(-1)?.action, "ListUsers");

  setConnectivityTransportForTests(async () => {
    throw new Error(`leaked ${secret}`);
  });
  const thrown = await runAliyunOutboundConnectivityCheck(store, admin, {});
  assert.equal(thrown.status, 200);
  assert.equal(JSON.stringify(thrown.body).includes(secret), false);
  assert.equal((thrown.body.items as ConnectivityItem[]).find((entry) => entry.id === "credentials")?.ok, false);

  store.aliyunOutboundConfigs[0].aliyunOutboundEnabled = true;
  store.aliyunOutboundConnectivityAudits.length = 0;
  setConnectivityTransportForTests(async (request) => {
    transportCalls.push(request);
    return okBody();
  });
  const stillOn = await runAliyunOutboundConnectivityCheck(store, admin, {});
  assert.equal(stillOn.status, 200);
  assert.equal(stillOn.body.aliyunOutboundEnabled, true);
  assert.equal(store.aliyunOutboundConfigs[0].aliyunOutboundEnabled, true);
  store.aliyunOutboundConfigs[0].aliyunOutboundEnabled = false;

  const other = { ...admin, id: "u_other", teamId: "middle-east" };
  const beforeAudits = store.aliyunOutboundConnectivityAudits.length;
  const cross = await runAliyunOutboundConnectivityCheck(store, other, { teamId: "europe" });
  assert.equal(cross.status, 403);
  assert.equal(store.aliyunOutboundConnectivityAudits.length, beforeAudits);

  store.aliyunOutboundConnectivityAudits.length = 0;
  let clock = Date.parse("2030-01-01T00:00:00.000Z");
  let windowCalls = 0;
  setConnectivityClockForTests(() => clock);
  setConnectivityTransportForTests(async () => {
    windowCalls += 1;
    return okBody();
  });
  for (let index = 0; index < CONNECTIVITY_CHECK_LIMIT; index += 1) {
    const allowed = await runAliyunOutboundConnectivityCheck(store, admin, {});
    assert.equal(allowed.status, 200, `attempt ${index}`);
  }
  const limited = await runAliyunOutboundConnectivityCheck(store, admin, { accessKeySecret: secret });
  assert.equal(limited.status, 429);
  assert.equal(windowCalls, CONNECTIVITY_CHECK_LIMIT);
  assert.match(String(limited.body.message), /过于频繁/);
  assert.equal(JSON.stringify(limited.body).includes(secret), false);
  assert.equal(store.aliyunOutboundConnectivityAudits.filter((entry) => entry.result === "rate_limited").length, 1);
  assert.equal(JSON.stringify(store.aliyunOutboundConnectivityAudits).includes(secret), false);
  assert.equal(store.aliyunOutboundConfigs[0].aliyunOutboundEnabled, false);
  clock += CONNECTIVITY_CHECK_WINDOW_MS + 1;
  const afterWindow = await runAliyunOutboundConnectivityCheck(store, admin, {});
  assert.equal(afterWindow.status, 200);
  assert.equal(windowCalls, CONNECTIVITY_CHECK_LIMIT + 1);

  const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS aliyun_outbound_connectivity_audits \(/);
  assert.equal(schema.includes("CREATE TABLE aliyun_outbound_connectivity_audits"), false);
  const source = readFileSync(new URL("./aliyun-outbound-connectivity.ts", import.meta.url), "utf8");
  assert.match(source, /ListUsers/);
  assert.doesNotMatch(source, /MakeCall|StartBack2BackCall|CreateUser|UpdateSubscription|AssignJobs|makeCall\(|fetch\(|aliyuncs\.com/);
  assert.doesNotMatch(source, /approved_contactable|convert_to_lead|prospectSuppression/);
  assert.equal(dials, 0);

  console.log("aliyun outbound connectivity tests passed");
} finally {
  setConnectivityTransportForTests(undefined);
  setConnectivityClockForTests(undefined);
  setOutboundDialerForTests(undefined);
}
