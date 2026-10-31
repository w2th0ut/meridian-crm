import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CCC_MAKE_CALL_ACTION,
  CCC_MAKE_CALL_VERSION,
  createAliyunCccMakeCallDialer,
  type CccMakeCallRequest
} from "./aliyun-ccc-make-call.js";
import { maskOutboundNumber } from "./outbound-call.js";

const originalFetch = globalThis.fetch;
let fetches = 0;
globalThis.fetch = async (...args) => {
  fetches += 1;
  return originalFetch(...args);
};

try {
  assert.equal(maskOutboundNumber(""), "");
  assert.equal(maskOutboundNumber("1234"), "****");
  assert.equal(maskOutboundNumber("+46111222333"), "*******2333");
  assert.equal(maskOutboundNumber("+46111222333").includes("46111222333"), false);

  const seen: CccMakeCallRequest[] = [];
  const dialer = createAliyunCccMakeCallDialer({
    region: "cn-shanghai",
    transport: async (request) => {
      seen.push(request);
      return { Data: { CallContext: { JobId: "job-unit", CallType: "OUTBOUND" } } };
    }
  });
  const result = await dialer.makeCall({
    InstanceId: "ccc-demo",
    DeviceId: "keduoduo-crm",
    Callee: "+46111222333",
    Caller: "02100001111",
    UserId: "agent@ccc-demo",
    MaskedCallee: "*******2333"
  });
  assert.equal(result.jobId, "job-unit");
  assert.equal(result.callType, "OUTBOUND");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].action, CCC_MAKE_CALL_ACTION);
  assert.equal(seen[0].version, CCC_MAKE_CALL_VERSION);
  assert.equal(seen[0].host, "ccc.cn-shanghai.aliyuncs.com");
  assert.equal(seen[0].params.InstanceId, "ccc-demo");
  assert.equal(seen[0].params.DeviceId, "keduoduo-crm");
  assert.equal(seen[0].params.Callee, "+46111222333");
  assert.equal(seen[0].params.Caller, "02100001111");
  assert.equal(seen[0].params.UserId, "agent@ccc-demo");
  assert.equal(JSON.stringify(seen[0]).includes("LTAI"), false);
  assert.equal(JSON.stringify(seen[0]).includes("Secret"), false);

  const hangzhou = createAliyunCccMakeCallDialer({
    region: "cn-hangzhou",
    transport: async (request) => {
      assert.equal(request.host, "ccc.cn-hangzhou.aliyuncs.com");
      return { Data: { CallContext: { JobId: "job-hz", CallType: "OUTBOUND" } } };
    }
  });
  assert.equal((await hangzhou.makeCall({
    InstanceId: "ccc-demo",
    DeviceId: "device",
    Callee: "10086"
  })).jobId, "job-hz");

  assert.throws(() => createAliyunCccMakeCallDialer({
    region: "cn-beijing",
    transport: async () => ({})
  }), /接入点/);

  const failing = createAliyunCccMakeCallDialer({
    region: "cn-shanghai",
    transport: async () => ({ Data: { CallContext: { JobId: "", CallType: "OUTBOUND" } } })
  });
  await assert.rejects(() => failing.makeCall({
    InstanceId: "ccc-demo",
    DeviceId: "device",
    Callee: "10086"
  }), /JobId/);

  const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS outbound_call_audits \(/);
  assert.equal(schema.includes("CREATE TABLE outbound_call_audits"), false);

  const source = readFileSync(new URL("./outbound-call.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /setProspectSuppression|convertProspectToLead|convert_to_lead|setInterval|fetch\(|aliyuncs\.com/);
  const dialerSource = readFileSync(new URL("./aliyun-ccc-make-call.ts", import.meta.url), "utf8");
  assert.doesNotMatch(dialerSource, /fetch\(|https\.request|axios/);
  assert.match(dialerSource, /MakeCall/);
  assert.match(dialerSource, /2020-07-01/);

  const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  const timerAt = server.indexOf("const telephonyStrategyTimer = setInterval");
  const pruneAt = server.indexOf("const telephonyPruneTimer = setInterval");
  assert.ok(timerAt > 0 && pruneAt > timerAt);
  const timer = server.slice(timerAt, pruneAt);
  assert.doesNotMatch(timer, /outbound-calls|requestOutboundCall|MakeCall/);
  assert.equal(server.includes('app.post("/api/outbound-calls"'), true);
  const outboundGets = [...server.matchAll(/app\.get\("([^"]*outbound-calls[^"]*)"/g)].map((item) => item[1]);
  assert.deepEqual(outboundGets, ["/api/outbound-calls/availability"]);
  const getRoute = server.slice(
    server.indexOf('app.get("/api/outbound-calls/availability"'),
    server.indexOf('app.post("/api/outbound-calls"')
  );
  assert.match(getRoute, /readOutboundCallAvailability/);
  assert.doesNotMatch(getRoute, /requestOutboundCall/);
  const requestSource = source.slice(source.indexOf("export async function requestOutboundCall"));
  const suppressedAt = requestSource.indexOf("numberSuppressed");
  const limitAt = requestSource.indexOf("callingLimitReason");
  const dialAt = requestSource.indexOf("dialerFor(");
  assert.ok(suppressedAt > 0 && limitAt > suppressedAt && dialAt > limitAt);
  const availability = source.slice(
    source.indexOf("export function readOutboundCallAvailability"),
    source.indexOf("export async function requestOutboundCall")
  );
  assert.match(availability, /aliyunOutboundEnabled === true/);
  assert.doesNotMatch(availability, /writeAudit|makeCall|dialerFor|persist\(|accessKey|callerNumber|instanceId/);

  const telephony = readFileSync(new URL("./telephony/service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(telephony, /outbound-call|requestOutboundCall|\/api\/outbound-calls/);

  assert.equal(fetches, 0);
  console.log("outbound call tests passed");
} finally {
  globalThis.fetch = originalFetch;
}
