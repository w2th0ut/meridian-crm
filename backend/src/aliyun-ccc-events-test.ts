import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CCC_GET_CALL_DETAIL_RECORD_ACTION,
  CCC_GET_MONO_RECORDING_ACTION,
  CCC_MAKE_CALL_VERSION,
  createAliyunCccMakeCallDialer,
  readCallDetailRecord,
  type CccRpcRequest
} from "./aliyun-ccc-make-call.js";
import { callbackTokensEqual, parseCccEvent } from "./aliyun-ccc-events.js";

const originalFetch = globalThis.fetch;
let fetches = 0;
globalThis.fetch = async (...args) => {
  fetches += 1;
  return originalFetch(...args);
};

try {
  assert.equal(callbackTokensEqual("callbackTokenValue1234", "callbackTokenValue1234"), true);
  assert.equal(callbackTokensEqual("callbackTokenValue1234", "callbackTokenValue9999"), false);
  assert.equal(callbackTokensEqual("short", "callbackTokenValue1234"), false);
  assert.equal(callbackTokensEqual("", "callbackTokenValue1234"), false);

  const flat = parseCccEvent({
    eventType: "CDRReady",
    eventTime: "2022-06-20T12:03:12.243Z",
    instanceId: "ccc-test",
    contactId: "job-callback-1",
    callType: "OUTBOUND",
    caller: "13800001111",
    callee: "13900002222",
    dispositionCode: "Success"
  });
  assert.equal(flat?.contactId, "job-callback-1");
  assert.equal(flat?.contactIdSource, "contactId");
  assert.equal(flat?.eventType, "CDRReady");

  const wrapped = parseCccEvent({
    data: {
      eventType: "Released",
      eventTime: "2022-06-20T12:03:12.243Z",
      instanceId: "ccc-test",
      contactId: "job-wrapped"
    }
  });
  assert.equal(wrapped?.eventType, "Released");
  assert.equal(wrapped?.contactId, "job-wrapped");

  const jobOnly = parseCccEvent({
    eventType: "Released",
    eventTime: "2022-06-20T12:03:12.243Z",
    instanceId: "ccc-test",
    jobId: "job-from-makecall"
  });
  assert.equal(jobOnly?.contactId, "job-from-makecall");
  assert.equal(jobOnly?.contactIdSource, "jobId");
  assert.equal(parseCccEvent(["nope"]), null);
  assert.equal(parseCccEvent({ instanceId: "ccc-test" })?.eventType, "");

  const seen: CccRpcRequest[] = [];
  const dialer = createAliyunCccMakeCallDialer({
    region: "cn-shanghai",
    transport: async (request) => {
      if (request.action === "MakeCall") {
        return { Data: { CallContext: { JobId: "job-unit", CallType: "OUTBOUND" } } };
      }
      seen.push(request as CccRpcRequest);
      if (request.action === CCC_GET_CALL_DETAIL_RECORD_ACTION) {
        return {
          Code: "OK",
          Data: {
            ContactId: "job-callback-1",
            ContactType: "OUTBOUND",
            ContactDisposition: "NoAnswer",
            CallDuration: "00:50",
            EarlyMediaState: "Busy",
            AgentIds: "agent@ccc-test"
          }
        };
      }
      return {
        Code: "OK",
        Data: {
          FileUrl: "https://example.test/job-callback-1.wav?Expires=300&Signature=abc",
          FileName: "job-callback-1.wav",
          Duration: 30000
        }
      };
    }
  });
  const detail = await dialer.getCallDetailRecord!({
    InstanceId: "ccc-test",
    ContactId: "job-callback-1"
  });
  assert.equal(seen[0].action, CCC_GET_CALL_DETAIL_RECORD_ACTION);
  assert.equal(seen[0].version, CCC_MAKE_CALL_VERSION);
  assert.equal(seen[0].host, "ccc.cn-shanghai.aliyuncs.com");
  assert.equal(seen[0].params.InstanceId, "ccc-test");
  assert.equal(seen[0].params.ContactId, "job-callback-1");
  assert.equal(detail.callDurationRaw, "00:50");
  assert.equal(detail.contactDisposition, "NoAnswer");
  assert.equal(detail.instanceId, "");

  const numeric = readCallDetailRecord({
    Code: "OK",
    Data: {
      ContactId: "job-callback-1",
      InstanceId: "ccc-test",
      CallDuration: 42
    }
  }, { instanceId: "ccc-test", contactId: "job-callback-1" });
  assert.equal(numeric.callDurationRaw, "42");
  assert.equal(numeric.instanceId, "ccc-test");

  assert.throws(() => readCallDetailRecord({
    Code: "OK",
    Data: { ContactId: "job-other", InstanceId: "ccc-test" }
  }, { instanceId: "ccc-test", contactId: "job-callback-1" }), /ContactId/);
  assert.throws(() => readCallDetailRecord({
    Code: "Failed",
    Data: { ContactId: "job-callback-1" }
  }, { instanceId: "ccc-test", contactId: "job-callback-1" }), /未成功/);

  const recording = await dialer.getMonoRecording!({
    InstanceId: "ccc-test",
    ContactId: "job-callback-1",
    ExpireSeconds: 300
  });
  assert.equal(seen[1].action, CCC_GET_MONO_RECORDING_ACTION);
  assert.equal(seen[1].params.ExpireSeconds, 300);
  assert.equal(recording.durationRaw, "30000");
  assert.equal(recording.fileUrl.includes("example.test"), true);
  assert.equal(fetches, 0);

  const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS aliyun_ccc_event_audits \(/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS outbound_call_records \(/);
  assert.equal(schema.includes("CREATE TABLE aliyun_ccc_event_audits"), false);
  assert.equal(schema.includes("CREATE TABLE outbound_call_records"), false);

  const source = readFileSync(new URL("./aliyun-ccc-events.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|aliyuncs\.com|convertProspectToLead|convert_to_lead|setProspectSuppression|approved_contactable|dispatchOutbound/);
  assert.match(source, /GetCallDetailRecord|getCallDetailRecord/);
  assert.match(source, /待核实/);
  const dialerSource = readFileSync(new URL("./aliyun-ccc-make-call.ts", import.meta.url), "utf8");
  assert.doesNotMatch(dialerSource, /fetch\(|https\.request|axios/);
  assert.match(dialerSource, /GetCallDetailRecord/);
  assert.match(dialerSource, /GetMonoRecording/);

  console.log("aliyun ccc event tests passed");
} finally {
  globalThis.fetch = originalFetch;
}
