import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { encryptAliyunOutboundSecret } from "./credential-security.js";
import { maskOutboundNumber, setOutboundDialerForTests } from "./outbound-call.js";
import type { CallDetailRecord, GetCallDetailRecordParams, GetMonoRecordingParams, MonoRecording } from "./aliyun-ccc-make-call.js";

const token = "callbackTokenValue1234";
const phone = "+46111222999";
const caller = "02100001111";
const downloadUrl = "https://oss.example/record.wav?callee=46111222999";
const recordingUrl = "https://example.test/ccc-record/job-callback-1.wav?Expires=300&Signature=abc";
const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start ccc event test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let remoteHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com") || url.includes("example.test") || url.includes("oss.example")) remoteHits += 1;
  return originalFetch(input, init);
};

const lookups: GetCallDetailRecordParams[] = [];
const recordings: GetMonoRecordingParams[] = [];
let lookupError: Error | null = new Error("话单回查失败");

function detailFor(contactId: string, instanceId: string): CallDetailRecord {
  return {
    contactId,
    instanceId,
    contactType: "OUTBOUND",
    contactDisposition: "NoAnswer",
    earlyMediaState: "Busy",
    callDurationRaw: "42",
    establishedTimeRaw: "",
    releaseTimeRaw: "1532458000000",
    startTimeRaw: "1532457000000",
    callingNumber: caller,
    calledNumber: phone,
    agentIds: "agent@ccc-test",
    skillGroupIds: "skillgroup@ccc-test",
    recordingReady: true,
    releaseInitiator: "customer",
    releaseReason: "200 - OK"
  };
}

setOutboundDialerForTests({
  async makeCall() {
    throw new Error("回调测试不应拨号");
  },
  async getCallDetailRecord(params) {
    lookups.push({ ...params });
    if (lookupError) throw lookupError;
    return detailFor(params.ContactId, params.InstanceId);
  },
  async getMonoRecording(params): Promise<MonoRecording> {
    recordings.push({ ...params });
    return {
      fileUrl: recordingUrl,
      fileName: "job-callback-1.wav",
      durationRaw: "30000"
    };
  }
});

async function postEvent(pathToken: string, body: unknown) {
  const response = await originalFetch(`${baseUrl}/api/integrations/aliyun-ccc/events/${pathToken}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await response.json().catch(() => ({})) as { accepted?: boolean; reason?: string };
  return { response, json };
}

function putConfig(enabled: boolean) {
  const store = getStore();
  const next = {
    teamId: "europe",
    aliyunOutboundEnabled: enabled,
    instanceId: "ccc-test",
    region: "cn-shanghai",
    callerNumber: caller,
    accessKeyIdEncrypted: encryptAliyunOutboundSecret("europe", "accessKeyId", "LTAI12345678wxyz"),
    accessKeySecretEncrypted: encryptAliyunOutboundSecret("europe", "accessKeySecret", "SkSecretValue9999wxyz"),
    callbackPathTokenEncrypted: encryptAliyunOutboundSecret("europe", "callbackPathToken", token),
    updatedBy: "u_admin",
    updatedAt: "2026-10-31T00:00:00.000Z"
  };
  const existing = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe");
  if (existing) Object.assign(existing, next);
  else store.aliyunOutboundConfigs.push(next);
}

try {
  const store = getStore();
  const customer = store.customers.find((item) => item.id === "c1");
  assert.ok(customer);
  assert.equal(customer.teamId, "europe");
  const reminderBefore = customer.nextReminder;
  const leadSnapshot = store.leads.map((item) => [item.id, item.status, item.deletedAt || ""]);
  const opportunitySnapshot = store.websiteOpportunities.map((item) => [item.id, item.status]);
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const leadsBefore = store.leads.length;
  const callActivities = () => store.customerActivities.filter((item) => item.customerId === "c1" && item.type === "call");
  const followUps = () => store.followUpAudits.filter((item) => item.objectId === "c1" && item.action === "record_follow_up");
  const activitiesBefore = callActivities().length;
  const followUpsBefore = followUps().length;
  const recordsBefore = store.outboundCallRecords.length;

  putConfig(true);
  const wrongToken = await postEvent("wrongTokenValue0001", {
    eventType: "CDRReady",
    eventTime: "2022-06-20T12:03:12.243Z",
    instanceId: "ccc-test",
    contactId: "job-callback-1",
    callee: phone
  });
  assert.equal(wrongToken.response.status, 401);
  assert.equal(wrongToken.json.accepted, false);
  assert.equal(wrongToken.json.reason, "invalid_token");
  assert.equal(lookups.length, 0);
  assert.equal(store.outboundCallRecords.length, recordsBefore);
  assert.equal(callActivities().length, activitiesBefore);
  assert.equal(store.aliyunCccEventAudits[0]?.decision, "rejected");
  assert.equal(store.aliyunCccEventAudits[0]?.teamId, "");

  putConfig(false);
  const disabled = await postEvent(token, {
    eventType: "CDRReady",
    eventTime: "2022-06-20T12:03:12.243Z",
    instanceId: "ccc-test",
    contactId: "job-callback-1",
    callee: phone
  });
  assert.equal(disabled.response.status, 403);
  assert.equal(disabled.json.reason, "disabled");
  assert.equal(lookups.length, 0);
  assert.equal(store.outboundCallRecords.length, recordsBefore);
  assert.equal(callActivities().length, activitiesBefore);

  putConfig(true);
  const wrongInstance = await postEvent(token, {
    eventType: "CDRReady",
    eventTime: "2022-06-20T12:03:12.243Z",
    instanceId: "ccc-other",
    contactId: "job-callback-1",
    callee: phone
  });
  assert.equal(wrongInstance.response.status, 403);
  assert.equal(wrongInstance.json.reason, "instance_mismatch");
  assert.equal(lookups.length, 0);
  assert.equal(store.outboundCallRecords.length, recordsBefore);

  store.outboundCallAudits.unshift({
    id: "oca_callback_1",
    teamId: "europe",
    actorId: "u_sales_shirley",
    at: "2026-10-31T00:00:00.000Z",
    targetType: "customer",
    targetId: "c1",
    phoneId: "customer-phone:c1",
    maskedNumber: maskOutboundNumber(phone),
    result: "allowed",
    reason: "",
    jobId: "job-callback-1"
  });

  const lookupFailed = await postEvent(token, {
    eventType: "CDRReady",
    eventTime: "2022-06-20T12:03:12.243Z",
    instanceId: "ccc-test",
    contactId: "job-callback-1",
    callee: phone,
    dispositionCode: "Success"
  });
  assert.equal(lookupFailed.response.status, 502);
  assert.equal(lookupFailed.json.reason, "lookup_failed");
  assert.equal(lookups.length, 1);
  assert.equal(recordings.length, 0);
  assert.equal(store.outboundCallRecords.length, recordsBefore);
  assert.equal(callActivities().length, activitiesBefore);
  assert.equal(followUps().length, followUpsBefore);

  lookupError = null;
  const unmatched = await postEvent(token, {
    eventType: "CDRReady",
    eventTime: "2022-06-20T12:03:12.243Z",
    instanceId: "ccc-test",
    contactId: "job-not-ours",
    callee: phone
  });
  assert.equal(unmatched.response.status, 409);
  assert.equal(unmatched.json.reason, "unmatched");
  assert.equal(lookups.length, 1);
  assert.equal(store.outboundCallRecords.length, recordsBefore);

  const recordingFirst = await postEvent(token, {
    eventType: "RecordingReady",
    eventTime: "2022-06-20T12:03:11.638Z",
    instanceId: "ccc-test",
    contactId: "job-callback-1",
    caller: phone,
    callee: caller,
    duration: 999,
    downloadURL: downloadUrl,
    fileName: "from-event.wav"
  });
  assert.equal(recordingFirst.response.status, 200);
  assert.equal(recordingFirst.json.accepted, true);
  assert.equal(recordingFirst.json.reason, "recording_only");
  assert.equal(store.outboundCallRecords.length, recordsBefore + 1);
  assert.equal(callActivities().length, activitiesBefore);
  assert.equal(followUps().length, followUpsBefore);
  assert.equal(lookups.at(-1)?.InstanceId, "ccc-test");
  assert.equal(lookups.at(-1)?.ContactId, "job-callback-1");
  assert.equal(recordings.at(-1)?.ExpireSeconds, 300);
  const pending = store.outboundCallRecords.find((item) => item.contactId === "job-callback-1");
  assert.ok(pending);
  assert.equal(pending.followUpActivityId, "");
  assert.equal(pending.recordingRef, "job-callback-1");
  assert.equal(pending.recordingUrl, recordingUrl);
  assert.equal(pending.recordingFileName, "job-callback-1.wav");
  assert.equal(pending.callDurationRaw, "42");
  assert.equal(JSON.stringify(pending).includes(downloadUrl), false);
  assert.equal(JSON.stringify(pending).includes("from-event.wav"), false);

  const saved = await postEvent(token, {
    eventType: "CDRReady",
    eventTime: "2022-06-20T12:03:12.243Z",
    instanceId: "ccc-test",
    contactId: "job-callback-1",
    callType: "OUTBOUND",
    caller,
    callee: phone,
    dispositionCode: "Success",
    agentIds: "other@ccc-test",
    startTime: "2022-06-20T12:03:11.478Z"
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.json.reason, "recorded");
  assert.equal(store.outboundCallRecords.length, recordsBefore + 1);
  assert.equal(callActivities().length, activitiesBefore + 1);
  assert.equal(followUps().length, followUpsBefore + 1);
  const record = store.outboundCallRecords.find((item) => item.contactId === "job-callback-1");
  assert.ok(record);
  assert.equal(record.outboundCallAuditId, "oca_callback_1");
  assert.equal(record.targetType, "customer");
  assert.equal(record.targetId, "c1");
  assert.equal(record.maskedNumber, maskOutboundNumber(phone));
  assert.equal(record.contactDisposition, "NoAnswer");
  assert.equal(record.earlyMediaState, "Busy");
  assert.equal(record.callDurationRaw, "42");
  assert.equal(record.agentIds, "agent@ccc-test");
  assert.equal(record.recordingDurationRaw, "30000");
  assert.equal(record.recordingRef, "job-callback-1");
  const activity = callActivities()[0];
  assert.equal(activity.type, "call");
  assert.equal(activity.id, record.followUpActivityId);
  assert.match(activity.content, /NoAnswer/);
  assert.match(activity.content, /42/);
  assert.match(activity.content, /agent@ccc-test/);
  assert.match(activity.content, /job-callback-1/);
  assert.equal(activity.content.includes("Success"), false);
  assert.equal(activity.content.includes("other@ccc-test"), false);
  assert.equal(activity.content.includes(phone), false);
  assert.equal(activity.content.includes("46111222999"), false);
  const followUp = followUps()[0];
  assert.equal(followUp.actorId, "u_sales_shirley");
  assert.equal(followUp.objectType, "customer");
  assert.equal(followUp.objectId, "c1");
  assert.equal(followUp.activityId, activity.id);

  const lookupsAfterSave = lookups.length;
  const recordingsAfterSave = recordings.length;
  const duplicate = await postEvent(token, {
    eventType: "CDRReady",
    eventTime: "2022-06-20T12:03:12.243Z",
    instanceId: "ccc-test",
    contactId: "job-callback-1",
    callee: phone,
    dispositionCode: "Success"
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.json.reason, "duplicate");
  assert.equal(lookups.length, lookupsAfterSave);
  assert.equal(recordings.length, recordingsAfterSave);
  assert.equal(store.outboundCallRecords.length, recordsBefore + 1);
  assert.equal(callActivities().length, activitiesBefore + 1);
  assert.equal(followUps().length, followUpsBefore + 1);

  const recordingLater = await postEvent(token, {
    eventType: "RecordingReady",
    eventTime: "2022-06-20T12:04:11.638Z",
    instanceId: "ccc-test",
    contactId: "job-callback-1",
    caller: phone,
    downloadURL: downloadUrl,
    duration: 999
  });
  assert.equal(recordingLater.response.status, 200);
  assert.equal(recordingLater.json.reason, "updated");
  assert.equal(store.outboundCallRecords.length, recordsBefore + 1);
  assert.equal(callActivities().length, activitiesBefore + 1);
  assert.equal(followUps().length, followUpsBefore + 1);
  assert.equal(store.outboundCallRecords.find((item) => item.contactId === "job-callback-1")?.followUpActivityId, activity.id);

  const ringing = await postEvent(token, {
    eventType: "Ringing",
    eventTime: "2022-06-20T12:03:10.000Z",
    instanceId: "ccc-test",
    contactId: "job-callback-1",
    caller,
    callee: phone
  });
  assert.equal(ringing.response.status, 200);
  assert.equal(ringing.json.reason, "ignored");
  assert.equal(callActivities().length, activitiesBefore + 1);
  assert.equal(followUps().length, followUpsBefore + 1);

  const stored = JSON.stringify({
    audits: store.aliyunCccEventAudits,
    records: store.outboundCallRecords,
    activities: callActivities(),
    responses: [wrongToken.json, disabled.json, wrongInstance.json, lookupFailed.json, saved.json, duplicate.json]
  });
  assert.equal(stored.includes(phone), false);
  assert.equal(stored.includes("46111222999"), false);
  assert.equal(stored.includes(caller), false);
  assert.equal(stored.includes(token), false);
  assert.equal(stored.includes("LTAI12345678wxyz"), false);
  assert.equal(stored.includes("SkSecretValue9999wxyz"), false);
  assert.equal(stored.includes(downloadUrl), false);
  assert.equal(stored.includes("oss.example"), false);
  assert.equal(customer.nextReminder, reminderBefore);
  assert.deepEqual(store.leads.map((item) => [item.id, item.status, item.deletedAt || ""]), leadSnapshot);
  assert.deepEqual(store.websiteOpportunities.map((item) => [item.id, item.status]), opportunitySnapshot);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(remoteHits, 0);
  assert.deepEqual(store.aliyunCccEventAudits.slice(0, 10).map((item) => item.reason), [
    "ignored",
    "updated",
    "duplicate",
    "recorded",
    "recording_only",
    "unmatched",
    "lookup_failed",
    "instance_mismatch",
    "disabled",
    "invalid_token"
  ]);
  console.log("aliyun ccc event http tests passed");
} finally {
  setOutboundDialerForTests(undefined);
  globalThis.fetch = originalFetch;
  server.close();
}
