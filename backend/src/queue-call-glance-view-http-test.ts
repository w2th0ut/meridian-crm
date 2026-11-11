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
    customer("c_view_late", shirleyUser.id, "Late Co", "2026-11-04 11:00"),
    customer("c_gap_20", shirleyUser.id, "Gap 20", ""),
    customer("c_gap_30", shirleyUser.id, "Gap 30", ""),
    customer("c_gap_31", shirleyUser.id, "Gap 31", ""),
    customer("c_gap_60", shirleyUser.id, "Gap 60", ""),
    customer("c_gap_61", shirleyUser.id, "Gap 61", ""),
    customer("c_gap_future", shirleyUser.id, "Gap Future", ""),
    customer("c_gap_yest", shirleyUser.id, "Gap Yest", ""),
    customer("c_gap_ny", shirleyUser.id, "Gap NY", ""),
    customer("c_gap_dash", shirleyUser.id, "Gap Dash", ""),
    customer("c_gap_secret", miaUser.id, "Secret <Gap>", "")
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
    record({ id: "ocr_view_early_2", targetId: "c_view_early", startTimeRaw: late, callOutcome: "需回访", establishedTimeRaw: "1", contactDisposition: "Success" }),
    record({ id: "ocr_gap_20", targetId: "c_gap_20", startTimeRaw: String(Date.parse("2026-11-04T02:10:00.000Z")), callOutcome: "有意向" }),
    record({ id: "ocr_gap_30", targetId: "c_gap_30", startTimeRaw: String(Date.parse("2026-11-04T02:00:00.000Z")), callOutcome: "有意向" }),
    record({ id: "ocr_gap_31", targetId: "c_gap_31", startTimeRaw: String(Date.parse("2026-11-04T01:59:00.000Z")), callOutcome: "有意向" }),
    record({ id: "ocr_gap_60", targetId: "c_gap_60", startTimeRaw: String(Date.parse("2026-11-04T01:30:00.000Z")), callOutcome: "有意向" }),
    record({ id: "ocr_gap_61", targetId: "c_gap_61", startTimeRaw: String(Date.parse("2026-11-04T01:29:00.000Z")), callOutcome: "有意向" }),
    record({ id: "ocr_gap_future", targetId: "c_gap_future", startTimeRaw: String(Date.parse("2026-11-04T02:31:00.000Z")), callOutcome: "有意向" }),
    record({ id: "ocr_gap_yest", targetId: "c_gap_yest", startTimeRaw: String(Date.parse("2026-11-03T02:30:00.000Z")), callOutcome: "无意向" }),
    record({ id: "ocr_gap_ny", targetId: "c_gap_ny", startTimeRaw: String(Date.parse("2026-11-03T15:00:00.000Z")), callOutcome: "有意向" }),
    record({ id: "ocr_gap_dash", targetId: "c_gap_dash", startTimeRaw: "", callOutcome: "", createdAt: "2026-11-04T02:20:00.000Z", updatedAt: "2026-11-04T02:20:00.000Z" }),
    record({ id: "ocr_gap_secret", targetId: "c_gap_secret", startTimeRaw: String(Date.parse("2026-11-04T02:20:00.000Z")), callOutcome: "需回访", agentIds: "agent@ccc-view-a" })
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
  assert.equal(plain.json.lastCallWithin, "");
  assert.equal(plain.json.lastCallSort, "");
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
  assert.equal(none.json.items.some((item: { targetId?: string }) => String(item.targetId || "").startsWith("c_view_")), false);
  assert.equal(none.json.items.every((item: { todayCallCount?: number }) => item.todayCallCount === 1), true);

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

  const auditsBeforeGap = JSON.stringify(store.unansweredPendingQueueAudits || []);
  function placed(items: Array<{ targetId?: string; lastCallAt?: string }>, id: string) {
    return items.findIndex((item) => item.targetId === id);
  }
  const within30 = await request("/api/unanswered-pending-queue?scope=mine&lastCallWithin=30m", shirley);
  assert.equal(within30.response.status, 200, within30.text);
  assert.equal(within30.json.lastCallWithin, "30m");
  const within30Ids = idsOf(within30.json.items);
  assert.equal(within30Ids.includes("c_gap_20") && within30Ids.includes("c_gap_30"), true);
  for (const id of ["c_gap_31", "c_gap_60", "c_gap_61", "c_gap_future", "c_gap_yest", "c_gap_ny", "c_gap_dash", "c_view_zero", "c_view_two", "c_view_hidden", "c_gap_secret"]) {
    assert.equal(within30Ids.includes(id), false, id);
  }
  assert.equal(within30.text.includes("Secret <Gap>"), false);
  assert.equal(within30.text.includes("c_gap_secret"), false);
  assert.equal(within30.text.includes("ocr_gap_secret"), false);

  const withinHour = await request("/api/unanswered-pending-queue?scope=mine&lastCallWithin=1h", shirley);
  assert.equal(withinHour.response.status, 200, withinHour.text);
  const withinHourIds = idsOf(withinHour.json.items);
  for (const id of ["c_gap_20", "c_gap_30", "c_gap_31", "c_gap_60"]) assert.equal(withinHourIds.includes(id), true, id);
  for (const id of ["c_gap_61", "c_gap_future", "c_gap_yest", "c_gap_dash", "c_view_zero", "c_view_two", "c_view_hidden", "c_gap_secret"]) {
    assert.equal(withinHourIds.includes(id), false, id);
  }

  const calledToday = await request("/api/unanswered-pending-queue?scope=mine&lastCallWithin=today", shirley);
  assert.equal(calledToday.response.status, 200, calledToday.text);
  const calledTodayIds = idsOf(calledToday.json.items);
  for (const id of ["c_gap_20", "c_gap_30", "c_gap_31", "c_gap_60", "c_gap_61", "c_gap_future", "c_view_two"]) {
    assert.equal(calledTodayIds.includes(id), true, id);
  }
  for (const id of ["c_gap_yest", "c_gap_ny", "c_gap_dash", "c_view_zero", "c_view_hidden", "c_gap_secret"]) {
    assert.equal(calledTodayIds.includes(id), false, id);
  }
  assert.equal(calledToday.text.includes("lastCallAt"), true);

  const older = await request("/api/unanswered-pending-queue?scope=mine&lastCallSort=older", shirley);
  assert.equal(older.response.status, 200, older.text);
  const olderItems = older.json.items as Array<{ targetId?: string; lastCallAt?: string }>;
  const olderChain = ["c_view_zero", "c_gap_yest", "c_gap_ny", "c_view_two", "c_gap_61", "c_gap_60", "c_gap_31", "c_gap_30", "c_gap_20", "c_gap_future", "c_gap_dash"];
  const olderAt = olderChain.map((id) => placed(olderItems, id));
  assert.equal(olderAt.every((index, at) => index >= 0 && (at === 0 || index > olderAt[at - 1])), true, olderAt.join(","));
  const futureAt = placed(olderItems, "c_gap_future");
  for (const id of ["c_gap_dash", "c_gap_secret", "c_view_hidden"]) {
    assert.equal(placed(olderItems, id) > futureAt, true, id);
  }
  assert.equal("lastCallAt" in (olderItems.find((item) => item.targetId === "c_gap_secret") || {}), false);
  assert.equal("lastCallAt" in (olderItems.find((item) => item.targetId === "c_view_hidden") || {}), false);
  assert.equal(olderItems.find((item) => item.targetId === "c_gap_dash")?.lastCallAt, "—");

  const newer = await request("/api/unanswered-pending-queue?scope=mine&lastCallSort=newer", shirley);
  assert.equal(newer.response.status, 200, newer.text);
  const newerItems = newer.json.items as Array<{ targetId?: string }>;
  const newerChain = ["c_gap_future", "c_gap_20", "c_view_zero", "c_gap_dash"];
  const newerAt = newerChain.map((id) => placed(newerItems, id));
  assert.equal(newerAt.every((index, at) => index >= 0 && (at === 0 || index > newerAt[at - 1])), true, newerAt.join(","));
  assert.equal(placed(newerItems, "c_gap_secret") > placed(newerItems, "c_view_zero"), true);
  assert.equal("lastCallAt" in (newerItems.find((item) => item.targetId === "c_gap_secret") || {}), false);
  assert.equal(plainIds.join(","), idsOf((await request("/api/unanswered-pending-queue?scope=mine", shirley)).json.items).join(","));

  const combined = await request("/api/unanswered-pending-queue?scope=mine&lastCallWithin=1h&todayCalls=1&todayCallSort=uncalled", shirley);
  assert.equal(combined.response.status, 200, combined.text);
  assert.deepEqual(idsOf(combined.json.items).filter((id) => String(id).startsWith("c_gap_")), ["c_gap_60", "c_gap_31", "c_gap_30", "c_gap_20"]);

  setTenantTimezoneOverride(store, "europe", "America/New_York");
  const nyToday = await request("/api/unanswered-pending-queue?scope=mine&lastCallWithin=today", shirley);
  assert.equal(nyToday.response.status, 200, nyToday.text);
  const nyRow = nyToday.json.items.find((item: { targetId?: string }) => item.targetId === "c_gap_ny");
  assert.equal(nyRow?.lastCallAt, "2026-11-03 10:00");
  assert.equal(idsOf(nyToday.json.items).includes("c_gap_yest"), false);
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  const backToday = await request("/api/unanswered-pending-queue?scope=mine&lastCallWithin=today", shirley);
  assert.equal(idsOf(backToday.json.items).includes("c_gap_ny"), false);
  assert.equal(backToday.json.items.find((item: { targetId?: string; lastCallAt?: string }) => item.targetId === "c_gap_20")?.lastCallAt, "2026-11-04 10:10");

  const badWindow = await request("/api/unanswered-pending-queue?scope=mine&lastCallWithin=2h", shirley);
  assert.equal(badWindow.response.status, 400);
  assert.equal(badWindow.text.includes("todayCallCount"), false);
  assert.equal(badWindow.text.includes("c_gap_20"), false);
  const badSort = await request("/api/unanswered-pending-queue?scope=mine&lastCallSort=asc", shirley);
  assert.equal(badSort.response.status, 400);
  const badTwice = await request("/api/unanswered-pending-queue?scope=mine&lastCallWithin=1h&lastCallWithin=30m", shirley);
  assert.equal(badTwice.response.status, 400);
  const gapAuditBefore = (JSON.parse(auditsBeforeGap) as unknown[]).length;
  const gapAudits = store.unansweredPendingQueueAudits || [];
  const addedGap = gapAudits.slice(0, gapAudits.length - gapAuditBefore);
  assert.equal(addedGap.length, 9);
  assert.equal(JSON.stringify(addedGap).includes("lastCallWithin"), false);
  assert.equal(JSON.stringify(addedGap).includes("lastCallAt"), false);

  for (const path of [
    "/api/intent-followup-queue?lastCallWithin=1h&lastCallSort=older",
    "/api/negative-outcome-followups?scope=mine&lastCallWithin=30m",
    "/api/other-outcome-followups?scope=mine&lastCallSort=newer",
    "/api/unlabeled-connected-followups?scope=mine&lastCallWithin=today",
    "/api/today-follow-next?scope=mine&lastCallSort=older"
  ]) {
    const result = await request(path, shirley);
    assert.equal(result.response.status, 200, `${path} ${result.text}`);
    assert.equal(result.text.includes("c_gap_secret"), false, path);
  }
  for (const path of [
    "/api/intent-followup-queue?lastCallWithin=soon",
    "/api/negative-outcome-followups?scope=mine&lastCallSort=0",
    "/api/other-outcome-followups?scope=mine&lastCallWithin=1h&lastCallWithin=today",
    "/api/unlabeled-connected-followups?scope=mine&lastCallSort=older&lastCallSort=newer",
    "/api/today-follow-next?scope=mine&lastCallWithin=hour"
  ]) {
    const result = await request(path, shirley);
    assert.equal(result.response.status, 400, path);
    assert.equal(result.text.includes("c_gap_secret"), false, path);
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
