import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { outboundInstant, setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { AliyunAgentMapping, OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start queue call glance view test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

async function request(path: string, token = "") {
  const response = await originalFetch(`${baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
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

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "targetId">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    targetType: "customer",
    maskedNumber: "****8000",
    contactType: "OUTBOUND",
    contactDisposition: "NoAnswer",
    earlyMediaState: "",
    callDurationRaw: "",
    establishedTimeRaw: "",
    releaseTimeRaw: "",
    startTimeRaw: "",
    agentIds: "agent@ccc-view-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "",
    callOutcomeNote: "",
    callNote: "",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...partial
  };
}

function idsOf(items: Array<{ targetId?: string }> | undefined) {
  return (items || []).map((item) => item.targetId);
}

try {
  const store = getStore();
  const instant = new Date("2026-11-04T02:30:00.000Z");
  setOutboundNowForTests(instant);
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  const shirley = await login("shirley@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const template = store.customers.find((item) => item.id === "c1");
  assert.ok(shirleyUser && miaUser && template);
  store.users.push({
    ...shirleyUser,
    id: "u_view_no_read",
    name: "No Read",
    email: "no-view-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    if (actor.id !== "u_view_no_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };
  const noRead = await login("no-view-read@keduoduo.com");
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
    mapping({ crmUserId: shirleyUser.id, cccUserId: "agent@ccc-view-a", displayName: "Shirley坐席" }),
    mapping({ crmUserId: miaUser.id, cccUserId: "agent@ccc-view-b", displayName: "Mia坐席" })
  );
  const customer = (id: string, ownerId: string, company: string, nextReminder: string) => ({
    ...template,
    id,
    company,
    ownerId,
    teamId: "europe",
    poolStatus: "owned" as const,
    phone: "+8613800138800",
    nextReminder
  });
  store.customers.push(
    customer("c_view_zero", shirleyUser.id, "Zero Co", ""),
    customer("c_view_two", shirleyUser.id, "Two <Co>", ""),
    customer("c_view_hidden", miaUser.id, "Hidden Co", ""),
    customer("c_view_early", shirleyUser.id, "Early Co", "2026-11-04 09:00"),
    customer("c_view_late", shirleyUser.id, "Late Co", "2026-11-04 11:00")
  );
  const old = String(Date.parse("2026-11-02T02:00:00.000Z"));
  const early = String(Date.parse("2026-11-04T01:00:00.000Z"));
  const late = String(Date.parse("2026-11-04T01:20:00.000Z"));
  store.outboundCallRecords.push(
    record({ id: "ocr_view_zero", targetId: "c_view_zero", startTimeRaw: old, callOutcome: "无意向" }),
    record({ id: "ocr_view_two_old", targetId: "c_view_two", startTimeRaw: old, callOutcome: "有意向" }),
    record({ id: "ocr_view_two_a", targetId: "c_view_two", startTimeRaw: early, callOutcome: "有意向", establishedTimeRaw: "1", contactDisposition: "Success" }),
    record({ id: "ocr_view_two_b", targetId: "c_view_two", startTimeRaw: late, callOutcome: "需回访", establishedTimeRaw: "1", contactDisposition: "Success" }),
    record({ id: "ocr_view_hidden", targetId: "c_view_hidden", startTimeRaw: old, callOutcome: "号码错误" }),
    record({ id: "ocr_view_early", targetId: "c_view_early", startTimeRaw: early, callOutcome: "需回访", establishedTimeRaw: "1", contactDisposition: "Success" }),
    record({ id: "ocr_view_early_2", targetId: "c_view_early", startTimeRaw: late, callOutcome: "需回访", establishedTimeRaw: "1", contactDisposition: "Success" })
  );
  const callsBefore = JSON.stringify(store.outboundCallRecords.map((item) => [item.id, item.callOutcome, item.establishedTimeRaw]));
  const auditsBefore = store.outboundCallAudits.length;
  const queueAuditsBefore = (store.unansweredPendingQueueAudits || []).length;
  const leadsBefore = store.leads.length;
  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions);

  const bad = await request("/api/unanswered-pending-queue?scope=mine&todayCalls=3", shirley);
  assert.equal(bad.response.status, 400);
  assert.equal(bad.json.reason, "invalid_request");
  assert.equal(bad.text.includes("todayCallCount"), false);
  assert.equal(bad.text.includes("c_view_hidden"), false);
  assert.equal((store.unansweredPendingQueueAudits || []).length, queueAuditsBefore);

  const denied = await request("/api/unanswered-pending-queue?scope=mine&todayCalls=0", noRead);
  assert.equal(denied.response.status, 403);
  assert.equal(denied.text.includes("todayCallCount"), false);
  const teamDenied = await request("/api/unanswered-pending-queue?scope=team&todayCallSort=uncalled", shirley);
  assert.equal(teamDenied.response.status, 403);
  assert.equal(teamDenied.text.includes("todayCallCount"), false);
  assert.equal(teamDenied.text.includes("c_view_zero"), false);

  const plain = await request("/api/unanswered-pending-queue?scope=mine", shirley);
  assert.equal(plain.response.status, 200, JSON.stringify(plain.json));
  assert.equal(plain.json.todayCalls, "");
  assert.equal(plain.json.todayCallSort, "");
  const plainIds = idsOf(plain.json.items);
  assert.equal(plainIds.includes("c_view_zero"), true);
  assert.equal(plainIds.includes("c_view_two"), true);
  assert.equal(plainIds.includes("c_view_hidden"), true);
  const plainHidden = plain.json.items.find((item: { targetId: string }) => item.targetId === "c_view_hidden");
  assert.equal("todayCallCount" in plainHidden, false);
  assert.equal("lastCallOutcome" in plainHidden, false);

  const uncalled = await request("/api/unanswered-pending-queue?scope=mine&todayCalls=0", shirley);
  assert.equal(uncalled.response.status, 200, JSON.stringify(uncalled.json));
  assert.deepEqual(idsOf(uncalled.json.items).filter((id) => String(id).startsWith("c_view_")), ["c_view_zero"]);
  assert.equal(uncalled.json.items.every((item: { todayCallCount: number }) => item.todayCallCount === 0), true);
  assert.equal(uncalled.text.includes("c_view_hidden"), false);
  assert.equal(uncalled.text.includes("号码错误"), false);

  const repeated = await request("/api/unanswered-pending-queue?scope=mine&todayCalls=2%2B&lastOutcome=%E9%9C%80%E5%9B%9E%E8%AE%BF", shirley);
  assert.equal(repeated.response.status, 200, JSON.stringify(repeated.json));
  assert.deepEqual(idsOf(repeated.json.items), ["c_view_two"]);
  assert.equal(repeated.json.items[0].todayCallCount, 2);
  assert.equal(repeated.json.items[0].lastCallOutcome, "需回访");
  assert.equal(repeated.json.items[0].callRecordId, "ocr_view_two_old");

  const none = await request("/api/unanswered-pending-queue?scope=mine&todayCalls=1", shirley);
  assert.equal(none.response.status, 200);
  assert.equal(none.json.empty, true);
  assert.deepEqual(none.json.items, []);
  assert.equal(none.text.includes("c_view_"), false);

  const unlabeled = await request("/api/unanswered-pending-queue?scope=mine&lastOutcome=%E6%9C%AA%E6%A0%87%E6%B3%A8", shirley);
  assert.equal(unlabeled.response.status, 200);
  assert.equal(unlabeled.text.includes("c_view_hidden"), false);
  assert.equal(unlabeled.text.includes("c_view_zero"), false);

  const sorted = await request("/api/unanswered-pending-queue?scope=mine&todayCallSort=uncalled", shirley);
  assert.equal(sorted.response.status, 200, JSON.stringify(sorted.json));
  const sortedIds = idsOf(sorted.json.items);
  const zeroAt = sortedIds.indexOf("c_view_zero");
  const twoAt = sortedIds.indexOf("c_view_two");
  const hiddenAt = sortedIds.indexOf("c_view_hidden");
  assert.equal(zeroAt >= 0 && twoAt > zeroAt && hiddenAt > twoAt, true);
  const counts = sorted.json.items
    .filter((item: { todayCallCount?: number }) => typeof item.todayCallCount === "number")
    .map((item: { todayCallCount: number }) => item.todayCallCount);
  assert.deepEqual(counts, [...counts].sort((left, right) => left - right));
  assert.equal(plainIds.join(","), idsOf((await request("/api/unanswered-pending-queue?scope=mine", shirley)).json.items).join(","));

  const team = await request("/api/unanswered-pending-queue?scope=team&todayCalls=0&lastOutcome=%E5%8F%B7%E7%A0%81%E9%94%99%E8%AF%AF", alex);
  assert.equal(team.response.status, 200, JSON.stringify(team.json));
  const teamHidden = team.json.items.find((item: { targetId: string }) => item.targetId === "c_view_hidden");
  assert.ok(teamHidden);
  assert.equal(teamHidden.todayCallCount, 0);
  assert.equal(teamHidden.lastCallOutcome, "号码错误");
  assert.equal(idsOf(team.json.items).includes("c_view_two"), false);

  async function walk(query: string) {
    const found: Array<{ targetId: string; todayCallCount?: number; lastCallOutcome?: string }> = [];
    let afterType = "";
    let afterId = "";
    for (let index = 0; index < 40; index += 1) {
      const params = new URLSearchParams(query);
      params.set("scope", "mine");
      if (afterType && afterId) {
        params.set("afterType", afterType);
        params.set("afterId", afterId);
      }
      const result = await request(`/api/today-follow-next?${params.toString()}`, shirley);
      assert.equal(result.response.status, 200, result.text);
      const next = result.json.next;
      if (!next?.targetId) break;
      found.push(next);
      afterType = next.targetType;
      afterId = next.targetId;
    }
    return found;
  }

  const byTime = await walk("");
  const earlyAt = byTime.findIndex((item) => item.targetId === "c_view_early");
  const lateAt = byTime.findIndex((item) => item.targetId === "c_view_late");
  assert.equal(earlyAt >= 0 && lateAt > earlyAt, true);
  const byUncalled = await walk("todayCallSort=uncalled");
  const earlySorted = byUncalled.findIndex((item) => item.targetId === "c_view_early");
  const lateSorted = byUncalled.findIndex((item) => item.targetId === "c_view_late");
  assert.equal(lateSorted >= 0 && earlySorted > lateSorted, true);
  const onlyZero = await walk("todayCalls=0");
  assert.equal(onlyZero.some((item) => item.targetId === "c_view_late"), true);
  assert.equal(onlyZero.some((item) => item.targetId === "c_view_early"), false);
  assert.equal(onlyZero.every((item) => item.todayCallCount === 0), true);
  assert.equal(onlyZero.some((item) => item.targetId === "c_view_hidden"), false);

  const todayBad = await request("/api/today-follow-next?scope=mine&todayCalls=9", shirley);
  assert.equal(todayBad.response.status, 400);
  assert.equal(todayBad.text.includes("todayCallCount"), false);
  const todayDenied = await request("/api/today-follow-next?scope=team&todayCallSort=uncalled", shirley);
  assert.equal(todayDenied.response.status, 403);
  assert.equal(todayDenied.text.includes("c_view_late"), false);

  const paths = [
    "/api/intent-followup-queue?todayCalls=0",
    "/api/negative-outcome-followups?scope=mine&todayCalls=0&todayCallSort=uncalled",
    "/api/other-outcome-followups?scope=mine&lastOutcome=%E6%9C%AA%E6%A0%87%E6%B3%A8",
    "/api/unlabeled-connected-followups?scope=mine&todayCalls=2%2B"
  ];
  for (const path of paths) {
    const result = await request(path, shirley);
    assert.equal(result.response.status, 200, `${path} ${result.text}`);
    const items = result.json.items || [];
    assert.equal(items.every((item: { todayCallCount?: number; lastCallOutcome?: string }) => {
      if (path.includes("todayCalls=0")) return item.todayCallCount === 0;
      if (path.includes("todayCalls=2")) return typeof item.todayCallCount === "number" && item.todayCallCount >= 2;
      if (path.includes("lastOutcome")) return item.lastCallOutcome === "未标注";
      return true;
    }), true, path);
    assert.equal(items.every((item: { todayCallCount?: number }) => typeof item.todayCallCount === "number"), true, path);
  }
  for (const path of [
    "/api/intent-followup-queue?lastOutcome=Success",
    "/api/negative-outcome-followups?scope=mine&todayCallSort=asc",
    "/api/other-outcome-followups?scope=mine&todayCalls=2",
    "/api/unlabeled-connected-followups?scope=mine&todayCalls=0&todayCalls=1"
  ]) {
    const result = await request(path, shirley);
    assert.equal(result.response.status, 400, path);
    assert.equal(result.text.includes("todayCallCount"), false, path);
  }

  assert.equal(JSON.stringify(store.outboundCallRecords.map((item) => [item.id, item.callOutcome, item.establishedTimeRaw])), callsBefore);
  assert.equal(store.outboundCallAudits.length, auditsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(store.customers.find((item) => item.id === "c_view_early")?.nextReminder, "2026-11-04 09:00");
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), false);
  assert.equal(aliyunHits, 0);
  assert.equal(outboundInstant().toISOString(), instant.toISOString());
  console.log("queue call glance view http tests passed");
} finally {
  setOutboundNowForTests(undefined);
  const store = getStore();
  setTenantTimezoneOverride(store, "europe", undefined);
  globalThis.fetch = originalFetch;
  server.close();
}
