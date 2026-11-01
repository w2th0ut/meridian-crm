import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import type { CallScriptTemplate, CallTag, OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call wrapup test server");
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

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "agentIds">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    targetType: "customer",
    targetId: "c1",
    maskedNumber: "*******2333",
    contactType: "OUTBOUND",
    contactDisposition: "NoAnswer",
    earlyMediaState: "",
    callDurationRaw: "10",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: String(Date.parse("2026-04-04T04:00:00.000Z")),
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://oss.example/do-not-leak-wrapup",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "有意向",
    callOutcomeNote: "原标注",
    callNote: "原纪要",
    callNoteTags: "需求",
    callNoteUpdatedAt: "2026-04-04T01:00:00.000Z",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...partial
  };
}

function template(partial: Partial<CallScriptTemplate> & Pick<CallScriptTemplate, "id">): CallScriptTemplate {
  return {
    teamId: "europe",
    title: "开场",
    scenario: "first_call",
    language: "zh",
    body: "正文不要出现在汇总审计",
    enabled: true,
    createdBy: "u_admin",
    updatedBy: "u_admin",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    disabledAt: "",
    ...partial
  };
}

function tag(partial: Partial<CallTag> & Pick<CallTag, "id" | "name">): CallTag {
  return {
    teamId: "europe",
    enabled: true,
    createdBy: "u_admin",
    updatedBy: "u_admin",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    disabledAt: "",
    ...partial
  };
}

async function counted(store: ReturnType<typeof getStore>, run: () => Promise<void>) {
  const original = store.persist.bind(store);
  let count = 0;
  store.persist = async () => {
    count += 1;
    await original();
  };
  try {
    await run();
  } finally {
    store.persist = original;
  }
  return count;
}

try {
  const store = getStore();
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  const adminUser = store.users.find((item) => item.email === "admin@keduoduo.com");
  assert.ok(shirleyUser && miaUser && adminUser);
  store.users.push({
    ...shirleyUser,
    id: "u_no_wrap_read",
    name: "No Wrap Read",
    email: "no-wrap-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_wrap_asia",
    name: "Asia Wrap",
    email: "asia-wrap@keduoduo.com",
    role: "sales",
    teamId: "asia",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot!(actor);
    if (actor.id !== "u_no_wrap_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };

  const activitiesBefore = store.customerActivities.length;
  const leadActivitiesBefore = store.leadActivities.length;
  const followAuditsBefore = store.followUpAudits.length;
  const leadsBefore = store.leads.length;
  const suppressionBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const sequencesBefore = store.outreachSequences.length;
  const plansBefore = store.prospectOutreachPlans.length;
  const callAuditsBefore = store.outboundCallAudits.length;
  const reminderBefore = store.customers.find((item) => item.id === "c1")?.nextReminder;
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  const seedProspect = store.websiteOpportunities[0];
  assert.ok(seedProspect);

  store.aliyunAgentMappings.push(
    {
      id: "map_wrap_shirley",
      teamId: "europe",
      crmUserId: shirleyUser.id,
      cccUserId: "agent@ccc-wrap-a",
      loginName: "shirley",
      displayName: "Shirley坐席",
      extension: "8201",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_wrap_mia",
      teamId: "europe",
      crmUserId: miaUser.id,
      cccUserId: "agent@ccc-wrap-b",
      loginName: "mia",
      displayName: "Mia坐席",
      extension: "8202",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    },
    {
      id: "map_wrap_asia",
      teamId: "asia",
      crmUserId: "u_wrap_asia",
      cccUserId: "agent@ccc-wrap-asia",
      loginName: "asia",
      displayName: "亚洲坐席",
      extension: "8203",
      workMode: "ON_SITE",
      updatedBy: "u_admin",
      updatedAt: "2026-10-31T00:00:00.000Z"
    }
  );
  store.callScriptTemplates.push(
    template({ id: "cst_wrap_a", title: "开场" }),
    template({ id: "cst_wrap_off", title: "旧话术", enabled: false, disabledAt: "2026-04-02T00:00:00.000Z" })
  );
  store.callTags.push(
    tag({ id: "ctag_wrap_on", name: "价格敏感" }),
    tag({ id: "ctag_wrap_off", name: "停用标签", enabled: false, disabledAt: "2026-04-02T00:00:00.000Z" })
  );
  store.websiteOpportunities.push({ ...seedProspect, id: "web_wrap_mia", ownerId: miaUser.id, company: "只属于 Mia" });
  store.outboundCallRecords.push(
    record({ id: "ocr_wrap_a1", agentIds: "agent@ccc-wrap-a" }),
    record({ id: "ocr_wrap_mia", agentIds: "agent@ccc-wrap-b", targetId: "c2", callNote: "对方原纪要" }),
    record({ id: "ocr_wrap_none", agentIds: "", targetType: "lead", targetId: "l1" }),
    record({ id: "ocr_wrap_asia", teamId: "asia", agentIds: "agent@ccc-wrap-asia", targetId: "c_asia", callNote: "亚洲纪要不要出现" }),
    record({ id: "ocr_wrap_prospect", agentIds: "agent@ccc-wrap-a", targetType: "prospect", targetId: "web_wrap_mia", callNote: "候选纪要" })
  );

  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const noRead = await login("no-wrap-read@keduoduo.com");
  const asia = await login("asia-wrap@keduoduo.com");

  const anon = await request("/api/outbound-call-records/ocr_wrap_a1/wrapup", "", "POST", { outcome: { outcome: "其他" } });
  assert.equal(anon.response.status, 401);
  assert.equal(store.callWrapupAudits.length, 0);

  const empty = await request("/api/outbound-call-records/ocr_wrap_a1/wrapup", shirley, "POST", {});
  assert.equal(empty.response.status, 400);
  assert.equal(empty.json.reason, "invalid_request");
  assert.equal(store.callWrapupAudits.length, 0);

  const batch = await request("/api/outbound-call-records/ocr_wrap_a1/wrapup", shirley, "POST", {
    outcome: { outcome: "其他" },
    records: ["ocr_wrap_a1"]
  });
  assert.equal(batch.response.status, 400);
  assert.equal(store.callWrapupAudits.length, 0);
  const query = await request("/api/outbound-call-records/ocr_wrap_a1/wrapup?x=1", shirley, "POST", { outcome: { outcome: "其他" } });
  assert.equal(query.response.status, 400);
  assert.equal(store.callWrapupAudits.length, 0);

  const savedBody = {
    outcome: { outcome: "需回访", note: "  下午再打  " },
    note: { note: "  要样品  ", tags: ["竞品", "需求"] },
    script: { templateId: "cst_wrap_a" },
    callTag: { tagId: "ctag_wrap_on", action: "add" },
    callback: { scheduledAt: "2026-12-01 09:30", note: "约好了" }
  };
  let saved: { response: { status: number }; json: Record<string, any> } = { response: { status: 0 }, json: {} };
  const savedPersists = await counted(store, async () => {
    saved = await request("/api/outbound-call-records/ocr_wrap_a1/wrapup", shirley, "POST", savedBody);
  });
  assert.equal(savedPersists, 1);
  assert.equal(saved.response.status, 200);
  assert.equal(saved.json.result, "updated");
  assert.equal(saved.json.parts.outcome, "updated");
  assert.equal(saved.json.parts.note, "updated");
  assert.equal(saved.json.parts.script, "updated");
  assert.equal(saved.json.parts.callTag, "updated");
  assert.equal(saved.json.parts.callback, "updated");
  assert.equal(JSON.stringify(saved.json).includes("do-not-leak-wrapup"), false);
  assert.equal(JSON.stringify(saved.json).includes("正文不要出现在汇总审计"), false);
  const row = store.outboundCallRecords.find((item) => item.id === "ocr_wrap_a1");
  assert.equal(row?.callOutcome, "需回访");
  assert.equal(row?.callOutcomeNote, "下午再打");
  assert.equal(row?.callNote, "要样品");
  assert.equal(row?.callNoteTags, "需求,竞品");
  assert.equal(row?.callScriptTemplateId, "cst_wrap_a");
  assert.equal(row?.updatedAt, "2026-04-04T00:00:00.000Z");
  assert.equal(row?.contactDisposition, "NoAnswer");
  assert.equal(store.callRecordTags.some((item) => item.callRecordId === "ocr_wrap_a1" && item.tagId === "ctag_wrap_on"), true);
  assert.equal(store.callbackSchedules.some((item) => item.targetId === "c1" && item.scheduledAt === "2026-12-01 09:30" && item.sourceCallRecordId === "ocr_wrap_a1"), true);
  assert.equal(store.callOutcomeAudits.some((item) => item.callRecordId === "ocr_wrap_a1" && item.nextOutcome === "需回访"), true);
  assert.equal(store.callNoteAudits.some((item) => item.callRecordId === "ocr_wrap_a1" && item.result === "updated" && item.nextNote === "要样品"), true);
  assert.equal(store.callScriptUsageAudits.some((item) => item.callRecordId === "ocr_wrap_a1" && item.result === "updated" && item.nextTemplateId === "cst_wrap_a"), true);
  assert.equal(store.callTagAudits.some((item) => item.callRecordId === "ocr_wrap_a1" && item.action === "add" && item.result === "updated"), true);
  assert.equal(store.callbackScheduleAudits.some((item) => item.sourceCallRecordId === "ocr_wrap_a1" && item.result === "updated"), true);
  const summary = store.callWrapupAudits.find((item) => item.callRecordId === "ocr_wrap_a1" && item.result === "updated");
  assert.equal(summary?.actorId, shirleyUser.id);
  assert.equal(summary?.teamId, "europe");
  assert.equal(summary?.action, "submit");
  assert.equal(summary?.reason, "");
  assert.equal(summary?.parts.includes("要样品"), false);
  assert.equal(summary?.parts.includes("正文不要出现"), false);
  assert.equal(summary?.parts.includes("do-not-leak"), false);
  const summaryParts = JSON.parse(summary?.parts || "{}") as Record<string, string>;
  assert.equal(summaryParts.outcome, "updated");
  assert.equal(summaryParts.callback, "updated");

  const outcomeAuditsAfterSave = store.callOutcomeAudits.filter((item) => item.callRecordId === "ocr_wrap_a1").length;
  const noteAuditsAfterSave = store.callNoteAudits.filter((item) => item.callRecordId === "ocr_wrap_a1").length;
  const wrapupsAfterSave = store.callWrapupAudits.filter((item) => item.callRecordId === "ocr_wrap_a1").length;
  let samePersists = -1;
  const same = await (async () => {
    let result: { response: { status: number }; json: Record<string, any> } = { response: { status: 0 }, json: {} };
    samePersists = await counted(store, async () => {
      result = await request("/api/outbound-call-records/ocr_wrap_a1/wrapup", shirley, "POST", {
        ...savedBody,
        outcome: { outcome: "需回访", note: "下午再打" },
        note: { note: "要样品", tags: ["需求", "竞品"] }
      });
    });
    return result;
  })();
  assert.equal(samePersists, 0);
  assert.equal(same.json.result, "unchanged");
  assert.equal(store.callOutcomeAudits.filter((item) => item.callRecordId === "ocr_wrap_a1").length, outcomeAuditsAfterSave);
  assert.equal(store.callNoteAudits.filter((item) => item.callRecordId === "ocr_wrap_a1").length, noteAuditsAfterSave);
  assert.equal(store.callWrapupAudits.filter((item) => item.callRecordId === "ocr_wrap_a1").length, wrapupsAfterSave);

  const noteBeforeOmit = store.outboundCallRecords.find((item) => item.id === "ocr_wrap_a1")?.callNote;
  const omit = await request("/api/outbound-call-records/ocr_wrap_a1/wrapup", shirley, "POST", {
    outcome: { outcome: "无意向", note: "不买了" }
  });
  assert.equal(omit.response.status, 200);
  assert.equal(omit.json.parts.outcome, "updated");
  assert.equal(omit.json.parts.note, undefined);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wrap_a1")?.callOutcome, "无意向");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wrap_a1")?.callNote, noteBeforeOmit);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wrap_a1")?.callScriptTemplateId, "cst_wrap_a");
  assert.equal(store.callRecordTags.some((item) => item.callRecordId === "ocr_wrap_a1" && item.tagId === "ctag_wrap_on"), true);

  const beforeReject = {
    outcome: store.outboundCallRecords.find((item) => item.id === "ocr_wrap_a1")?.callOutcome,
    outcomeAudits: store.callOutcomeAudits.length,
    tagAudits: store.callTagAudits.length,
    wrapups: store.callWrapupAudits.length
  };
  let disabledPersists = -1;
  const disabled = await (async () => {
    let result: { response: { status: number }; json: Record<string, any> } = { response: { status: 0 }, json: {} };
    disabledPersists = await counted(store, async () => {
      result = await request("/api/outbound-call-records/ocr_wrap_a1/wrapup", shirley, "POST", {
        outcome: { outcome: "其他", note: "不该留下" },
        callTag: { tagId: "ctag_wrap_off", action: "add" }
      });
    });
    return result;
  })();
  assert.equal(disabledPersists, 0);
  assert.equal(disabled.response.status, 400);
  assert.equal(disabled.json.reason, "disabled");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wrap_a1")?.callOutcome, beforeReject.outcome);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wrap_a1")?.callOutcomeNote, "不买了");
  assert.equal(store.callOutcomeAudits.length, beforeReject.outcomeAudits);
  assert.equal(store.callTagAudits.length, beforeReject.tagAudits);
  assert.equal(store.callWrapupAudits.length, beforeReject.wrapups);
  assert.equal(store.callRecordTags.some((item) => item.tagId === "ctag_wrap_off"), false);

  let missingPersists = -1;
  const missingTag = await (async () => {
    let result: { response: { status: number }; json: Record<string, any> } = { response: { status: 0 }, json: {} };
    missingPersists = await counted(store, async () => {
      result = await request("/api/outbound-call-records/ocr_wrap_a1/wrapup", shirley, "POST", {
        outcome: { outcome: "有意向", note: "回滚这一次" },
        callTag: { tagId: "ctag_wrap_missing", action: "add" }
      });
    });
    return result;
  })();
  assert.equal(missingPersists, 1);
  assert.equal(missingTag.response.status, 404);
  assert.equal(missingTag.json.reason, "not_found");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wrap_a1")?.callOutcome, "无意向");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wrap_a1")?.callOutcomeNote, "不买了");
  assert.equal(store.callOutcomeAudits.some((item) => item.nextNote === "回滚这一次"), false);
  assert.equal(store.callTagAudits.some((item) => item.tagId === "ctag_wrap_missing" && item.result === "rejected" && item.reason === "not_found"), true);
  const missingWrap = store.callWrapupAudits.find((item) => item.callRecordId === "ocr_wrap_a1" && item.reason === "not_found");
  assert.equal(missingWrap?.result, "rejected");
  assert.equal(JSON.parse(missingWrap?.parts || "{}").outcome, "rolled_back");
  assert.equal(JSON.parse(missingWrap?.parts || "{}").callTag, "rejected");
  assert.equal(missingWrap?.parts.includes("回滚这一次"), false);

  const prospectBefore = store.outboundCallRecords.find((item) => item.id === "ocr_wrap_prospect")?.callOutcome;
  let deniedCallbackPersists = -1;
  const deniedCallback = await (async () => {
    let result: { response: { status: number }; json: Record<string, any> } = { response: { status: 0 }, json: {} };
    deniedCallbackPersists = await counted(store, async () => {
      result = await request("/api/outbound-call-records/ocr_wrap_prospect/wrapup", shirley, "POST", {
        outcome: { outcome: "号码错误", note: "不该改候选通话" },
        callback: { scheduledAt: "2026-12-02 10:00", note: "回拨备注勿进汇总" }
      });
    });
    return result;
  })();
  assert.equal(deniedCallbackPersists, 1);
  assert.equal(deniedCallback.response.status, 403);
  assert.equal(deniedCallback.json.reason, "forbidden");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wrap_prospect")?.callOutcome, prospectBefore);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wrap_prospect")?.callOutcomeNote, "原标注");
  assert.equal(store.callOutcomeAudits.some((item) => item.callRecordId === "ocr_wrap_prospect"), false);
  assert.equal(store.callbackSchedules.some((item) => item.targetId === "web_wrap_mia"), false);
  assert.equal(store.callbackScheduleAudits.some((item) => item.sourceCallRecordId === "ocr_wrap_prospect" && item.result === "rejected" && item.nextNote === "回拨备注勿进汇总"), true);
  const callbackWrap = store.callWrapupAudits.find((item) => item.callRecordId === "ocr_wrap_prospect");
  assert.equal(callbackWrap?.result, "rejected");
  assert.equal(callbackWrap?.reason, "forbidden");
  assert.equal(callbackWrap?.parts.includes("回拨备注勿进汇总"), false);
  assert.equal(callbackWrap?.parts.includes("不该改候选通话"), false);

  const hidden = await request("/api/outbound-call-records/ocr_wrap_mia/wrapup", shirley, "POST", {
    note: { note: "改别人的", tags: [] }
  });
  assert.equal(hidden.response.status, 403);
  assert.equal(hidden.json.reason, "forbidden");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wrap_mia")?.callNote, "对方原纪要");
  assert.equal(store.callNoteAudits.some((item) => item.callRecordId === "ocr_wrap_mia"), false);
  const hiddenWrap = store.callWrapupAudits.find((item) => item.callRecordId === "ocr_wrap_mia" && item.actorId === shirleyUser.id);
  assert.equal(hiddenWrap?.result, "rejected");
  assert.equal(hiddenWrap?.reason, "forbidden");
  assert.equal(hiddenWrap?.parts.includes("改别人的"), false);
  assert.equal(hiddenWrap?.parts.includes("对方原纪要"), false);

  const manager = await request("/api/outbound-call-records/ocr_wrap_mia/wrapup", alex, "POST", {
    note: { note: "主管补记", tags: ["决策人"] }
  });
  assert.equal(manager.response.status, 200);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wrap_mia")?.callNote, "主管补记");

  const unmapped = await request("/api/outbound-call-records/ocr_wrap_none/wrapup", shirley, "POST", {
    note: { note: "没有坐席", tags: [] }
  });
  assert.equal(unmapped.response.status, 403);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wrap_none")?.callNote, "原纪要");
  const adminNote = await request("/api/outbound-call-records/ocr_wrap_none/wrapup", admin, "POST", {
    note: { note: "管理员纪要", tags: ["异议"] }
  });
  assert.equal(adminNote.response.status, 200);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wrap_none")?.callNote, "管理员纪要");

  const deniedRead = await request("/api/outbound-call-records/ocr_wrap_a1/wrapup", noRead, "POST", {
    note: { note: "无权", tags: [] }
  });
  assert.equal(deniedRead.response.status, 403);
  assert.equal(deniedRead.json.reason, "forbidden");
  assert.equal(deniedRead.json.permissionCode, "communication.read");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wrap_a1")?.callNote, "要样品");
  assert.equal(store.callNoteAudits.some((item) => item.actorId === "u_no_wrap_read"), false);
  assert.equal(store.callWrapupAudits.some((item) => item.actorId === "u_no_wrap_read" && item.result === "rejected"), true);

  const foreign = await request("/api/outbound-call-records/ocr_wrap_asia/wrapup", shirley, "POST", {
    note: { note: "不该写的纪要", tags: [] }
  });
  assert.equal(foreign.response.status, 403);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wrap_asia")?.callNote, "亚洲纪要不要出现");
  const foreignWrap = store.callWrapupAudits.find((item) => item.actorId === shirleyUser.id && item.callRecordId === "ocr_wrap_asia");
  assert.equal(foreignWrap?.teamId, "europe");
  assert.equal(foreignWrap?.result, "rejected");
  assert.equal(foreignWrap?.parts.includes("亚洲纪要不要出现"), false);
  assert.equal(foreignWrap?.parts.includes("不该写的纪要"), false);
  const reverse = await request("/api/outbound-call-records/ocr_wrap_a1/wrapup", asia, "POST", {
    outcome: { outcome: "其他" }
  });
  assert.equal(reverse.response.status, 403);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wrap_a1")?.callOutcome, "无意向");

  const missingRecord = await request("/api/outbound-call-records/ocr_wrap_missing/wrapup", shirley, "POST", {
    outcome: { outcome: "其他" }
  });
  assert.equal(missingRecord.response.status, 403);
  assert.equal(store.callWrapupAudits.some((item) => item.callRecordId === "ocr_wrap_missing" && item.result === "rejected"), true);
  assert.equal(store.callOutcomeAudits.some((item) => item.callRecordId === "ocr_wrap_missing"), false);

  const removed = await request("/api/outbound-call-records/ocr_wrap_a1/wrapup", shirley, "POST", {
    callTag: { tagId: "ctag_wrap_on", action: "remove" }
  });
  assert.equal(removed.response.status, 200);
  assert.equal(removed.json.parts.callTag, "updated");
  assert.equal(store.callRecordTags.some((item) => item.callRecordId === "ocr_wrap_a1" && item.tagId === "ctag_wrap_on"), false);
  assert.equal(store.callTagAudits.some((item) => item.callRecordId === "ocr_wrap_a1" && item.action === "remove" && item.result === "updated"), true);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_wrap_a1")?.callOutcome, "无意向");

  assert.equal(aliyunHits, 0);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(store.leadActivities.length, leadActivitiesBefore);
  assert.equal(store.followUpAudits.length, followAuditsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.outreachSequences.length, sequencesBefore);
  assert.equal(store.prospectOutreachPlans.length, plansBefore);
  assert.equal(store.outboundCallAudits.length, callAuditsBefore);
  assert.equal(store.customers.find((item) => item.id === "c1")?.nextReminder, reminderBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  const auditText = JSON.stringify(store.callWrapupAudits);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("do-not-leak-wrapup"), false);
  assert.equal(auditText.includes("aliyuncs"), false);
  assert.equal(auditText.includes("正文不要出现在汇总审计"), false);

  console.log("call wrapup http tests passed");
} finally {
  const store = getStore();
  store.outboundCallRecords = store.outboundCallRecords.filter((item) => !item.id.startsWith("ocr_wrap_"));
  store.callOutcomeAudits = store.callOutcomeAudits.filter((item) => !item.callRecordId.startsWith("ocr_wrap_"));
  store.callNoteAudits = store.callNoteAudits.filter((item) => !item.callRecordId.startsWith("ocr_wrap_"));
  store.callScriptUsageAudits = store.callScriptUsageAudits.filter((item) => !item.callRecordId.startsWith("ocr_wrap_"));
  store.callTagAudits = store.callTagAudits.filter((item) => !item.callRecordId.startsWith("ocr_wrap_") && !item.tagId.startsWith("ctag_wrap_"));
  store.callRecordTags = store.callRecordTags.filter((item) => !item.callRecordId.startsWith("ocr_wrap_") && !item.tagId.startsWith("ctag_wrap_"));
  store.callTags = store.callTags.filter((item) => !item.id.startsWith("ctag_wrap_"));
  store.callScriptTemplates = store.callScriptTemplates.filter((item) => !item.id.startsWith("cst_wrap_"));
  store.callWrapupAudits = store.callWrapupAudits.filter((item) => !item.callRecordId.startsWith("ocr_wrap_"));
  store.callbackScheduleAudits = store.callbackScheduleAudits.filter((item) => !item.sourceCallRecordId.startsWith("ocr_wrap_"));
  store.callbackSchedules = store.callbackSchedules.filter((item) => item.sourceCallRecordId !== "ocr_wrap_a1" && item.targetId !== "web_wrap_mia");
  store.websiteOpportunities = store.websiteOpportunities.filter((item) => item.id !== "web_wrap_mia");
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => !item.id.startsWith("map_wrap_"));
  store.users = store.users.filter((item) => item.id !== "u_no_wrap_read" && item.id !== "u_wrap_asia");
  globalThis.fetch = originalFetch;
  server.close();
}
