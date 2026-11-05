import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundDialerForTests, setOutboundNowForTests } from "./outbound-call.js";
import type { AliyunAgentMapping, CallScriptTemplate, OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start call note append test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

const calls: number[] = [];
setOutboundDialerForTests({
  async makeCall() {
    calls.push(1);
    throw new Error("call note append must not dial");
  }
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

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "targetType" | "targetId">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    maskedNumber: "****8000",
    contactType: "OUTBOUND",
    contactDisposition: "NoEcho",
    earlyMediaState: "",
    callDurationRaw: "",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: "3000",
    agentIds: "agent@ccc-cna-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://secret.example/rec",
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
    updatedAt: "2026-11-02T00:00:00.000Z",
    ...partial
  };
}

const store = getStore();
setOutboundNowForTests(new Date("2026-11-04T04:00:00.000Z"));
const previewPath = "/api/call-outcome-notes/batch-append/preview";
const confirmPath = "/api/call-outcome-notes/batch-append";

try {
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  assert.ok(shirleyUser && miaUser);
  store.users.push({
    ...shirleyUser,
    id: "u_cna_no_write",
    name: "No Write",
    email: "no-cna-write@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_cna_no_read",
    name: "No Read",
    email: "no-cna-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    if (actor.id !== "u_cna_no_write" && actor.id !== "u_cna_no_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    if (actor.id === "u_cna_no_write") {
      delete permissions["customer.update"];
      delete permissions["lead.update"];
      delete permissions["prospect.execute"];
    }
    if (actor.id === "u_cna_no_read") delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };
  const shirley = await login("shirley@keduoduo.com");
  const mia = await login("mia@keduoduo.com");
  const noWrite = await login("no-cna-write@keduoduo.com");
  const noRead = await login("no-cna-read@keduoduo.com");
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
    mapping({ crmUserId: shirleyUser.id, cccUserId: "agent@ccc-cna-a", displayName: "Shirley坐席" }),
    mapping({ crmUserId: miaUser.id, cccUserId: "agent@ccc-cna-b", displayName: "Mia坐席" }),
    mapping({ crmUserId: "u_cna_no_write", cccUserId: "agent@ccc-cna-c", displayName: "NoWrite坐席" })
  );
  const customerTemplate = store.customers.find((item) => item.id === "c1");
  const leadTemplate = store.leads.find((item) => item.id === "l1");
  const prospectTemplate = store.websiteOpportunities.find((item) => item.id === "web_seed_1");
  assert.ok(customerTemplate && leadTemplate && prospectTemplate);
  let phoneSerial = 46832000000;
  const secrets = new Set<string>(["https://secret.example/rec", "13800138000", "NoEcho"]);
  const phone = () => {
    const value = `+${phoneSerial++}`;
    secrets.add(value);
    return value;
  };
  const customer = (id: string, extra: Partial<typeof customerTemplate> = {}) => {
    store.customers.push({
      ...customerTemplate,
      company: `Nordic <${id}>`,
      teamId: "europe",
      nextReminder: "",
      poolStatus: "owned",
      ownerId: shirleyUser.id,
      phone: phone(),
      ...extra,
      id
    });
  };
  const lead = (id: string, extra: Partial<typeof leadTemplate> = {}) => {
    store.leads.push({
      ...leadTemplate,
      company: `Lead <${id}>`,
      teamId: "europe",
      nextFollowAt: "",
      ownerId: shirleyUser.id,
      phone: phone(),
      deletedAt: "",
      ...extra,
      id
    });
  };
  const prospect = (id: string, extra: Partial<typeof prospectTemplate> = {}) => {
    store.websiteOpportunities.push({
      ...prospectTemplate,
      company: `Prospect <${id}>`,
      teamId: "europe",
      nextFollowAt: "",
      ownerId: shirleyUser.id,
      status: "contactable",
      phone: phone(),
      leadId: "",
      ...extra,
      id
    });
  };

  customer("c_cna_neg", { nextReminder: "2026-11-10 09:00" });
  customer("c_cna_long", { nextReminder: "2026-11-10 10:00" });
  customer("c_cna_exact", { nextReminder: "2026-11-10 11:00" });
  customer("c_cna_public", { nextReminder: "2026-11-12 10:00", poolStatus: "public", ownerId: "" });
  customer("c_cna_mia", { nextReminder: "2026-11-12 11:00", ownerId: miaUser.id, company: "Mia Hidden" });
  customer("c_cna_nowrite", { nextReminder: "2026-11-13 09:00", ownerId: "u_cna_no_write" });
  customer("c_cna_plain");
  customer("c_cna_miss");
  lead("l_cna_other");
  prospect("p_cna_intent", { outreachState: "suppressed" });
  prospect("p_cna_ex", { status: "excluded" });

  const longNote = "字".repeat(199);
  store.outboundCallRecords.push(
    record({ id: "ocr_cna_old", targetType: "customer", targetId: "c_cna_neg", callOutcome: "无意向", callOutcomeNote: "更早的备注", startTimeRaw: "1000" }),
    record({ id: "ocr_cna_neg", targetType: "customer", targetId: "c_cna_neg", callOutcome: "无意向", callOutcomeNote: "原备注", startTimeRaw: "5000", maskedNumber: "13800138000" }),
    record({ id: "ocr_cna_long", targetType: "customer", targetId: "c_cna_long", callOutcome: "号码错误", callOutcomeNote: longNote, startTimeRaw: "4000" }),
    record({ id: "ocr_cna_exact", targetType: "customer", targetId: "c_cna_exact", callOutcome: "无意向", startTimeRaw: "4100" }),
    record({ id: "ocr_cna_public", targetType: "customer", targetId: "c_cna_public", callOutcome: "无意向", callOutcomeNote: "公池原备注", startTimeRaw: "4200" }),
    record({ id: "ocr_cna_mia", targetType: "customer", targetId: "c_cna_mia", callOutcome: "无意向", callOutcomeNote: "别的坐席", agentIds: "agent@ccc-cna-b", startTimeRaw: "4300" }),
    record({ id: "ocr_cna_nowrite", targetType: "customer", targetId: "c_cna_nowrite", callOutcome: "无意向", callOutcomeNote: "无权原备注", agentIds: "agent@ccc-cna-c", startTimeRaw: "4400" }),
    record({ id: "ocr_cna_plain", targetType: "customer", targetId: "c_cna_plain", callOutcome: "", startTimeRaw: "4500" }),
    record({ id: "ocr_cna_other", targetType: "lead", targetId: "l_cna_other", callOutcome: "其他", startTimeRaw: "4600" }),
    record({ id: "ocr_cna_intent", targetType: "prospect", targetId: "p_cna_intent", callOutcome: "有意向", startTimeRaw: "4700" }),
    record({ id: "ocr_cna_ex", targetType: "prospect", targetId: "p_cna_ex", callOutcome: "需回访", startTimeRaw: "4800" }),
    record({ id: "ocr_cna_miss", targetType: "customer", targetId: "c_cna_miss", callOutcome: "", establishedTimeRaw: "", startTimeRaw: "2000" })
  );

  const script: CallScriptTemplate = {
    id: "cst_cna_script",
    teamId: "europe",
    title: "话术",
    scenario: "first_call",
    language: "",
    body: "不要把话术写进备注",
    enabled: true,
    createdBy: shirleyUser.id,
    updatedBy: shirleyUser.id,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    disabledAt: "",
    usageKind: "script",
    ownerId: ""
  };
  store.callScriptTemplates.unshift(script);
  const phrase = await request("/api/call-outcome-note-phrases", shirley, "POST", { text: "请稍后再打", scope: "personal" });
  assert.equal(phrase.response.status, 200);
  const phraseId = String(phrase.json.phrase?.id || "");
  assert.ok(phraseId);
  const retired = await request("/api/call-outcome-note-phrases", shirley, "POST", { text: "停用这句", scope: "personal" });
  const retiredId = String(retired.json.phrase?.id || "");
  assert.equal((await request("/api/call-outcome-note-phrases/disable", shirley, "POST", { id: retiredId })).response.status, 200);
  const miaPhrase = await request("/api/call-outcome-note-phrases", mia, "POST", { text: "别人的短语", scope: "personal" });
  const miaPhraseId = String(miaPhrase.json.phrase?.id || "");
  const scriptAudits = store.callScriptAudits.length;
  const configBefore = JSON.stringify(store.aliyunOutboundConfigs);
  const enabledBefore = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled === true;
  const activities = store.leadActivities.length;
  const customerActivities = store.customerActivities.length;
  const leads = store.leads.length;
  const decisions = store.prospectContactabilityDecisions.length;
  const phraseBody = store.callScriptTemplates.find((item) => item.id === phraseId)?.body;

  const badBodies = [
    {},
    { callRecordIds: [] },
    { callRecordIds: ["ocr_cna_neg", "ocr_cna_neg"], note: "补" },
    { callRecordIds: Array.from({ length: 101 }, (_, index) => `c${index}`), note: "补" },
    { callRecordIds: ["ocr_cna_neg"], note: "字".repeat(201) },
    { callRecordIds: ["ocr_cna_neg"], note: 1 },
    { callRecordIds: ["ocr_cna_neg"], note: "补", outcome: "其他" },
    { callRecordIds: ["ocr_cna_neg"], note: "补", targets: [] },
    { records: ["ocr_cna_neg"], note: "补" },
    { callRecordIds: ["ocr_cna_neg"], phraseId: "有空格" },
    { callRecordIds: ["ocr_cna_neg"], phraseId: phraseId, note: "不是这句" },
    { callRecordIds: ["ocr_cna_neg"], phraseId: retiredId },
    { callRecordIds: ["ocr_cna_neg"], phraseId: miaPhraseId },
    { callRecordIds: ["ocr_cna_neg"], phraseId: "cst_cna_script" }
  ];
  for (const body of badBodies) {
    const rejected = await request(confirmPath, shirley, "POST", body);
    assert.equal(rejected.response.status, 400, JSON.stringify(body));
    assert.equal(store.callOutcomeAudits.some((item) => item.action === "append"), false);
  }
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_neg")?.callOutcomeNote, "原备注");
  assert.equal(store.callScriptTemplates.find((item) => item.id === "cst_cna_script")?.body, "不要把话术写进备注");
  assert.equal(store.callScriptTemplates.find((item) => item.id === retiredId)?.enabled, false);

  const anonymous = await request(confirmPath, "", "POST", { callRecordIds: ["ocr_cna_neg"], note: "补" });
  assert.equal(anonymous.response.status, 401);
  const unread = await request(confirmPath, noRead, "POST", { callRecordIds: ["ocr_cna_neg"], note: "补" });
  assert.equal(unread.response.status, 403);
  assert.equal(store.callOutcomeAudits.some((item) => item.actorId === "u_cna_no_read"), false);

  const hidden = await request(confirmPath, shirley, "POST", {
    callRecordIds: ["ocr_cna_neg", "ocr_cna_mia"],
    note: "不该写下"
  });
  assert.equal(hidden.response.status, 404);
  assert.equal(hidden.json.reason, "not_found");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_neg")?.callOutcomeNote, "原备注");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_mia")?.callOutcomeNote, "别的坐席");
  assert.equal(store.callOutcomeAudits.some((item) => item.action === "append"), false);

  const pending = await request(confirmPath, shirley, "POST", {
    callRecordIds: ["ocr_cna_neg", "ocr_cna_old"],
    note: "不该写下"
  });
  assert.equal(pending.response.status, 400);
  assert.equal(pending.json.reason, "not_pending");
  const plain = await request(confirmPath, shirley, "POST", {
    callRecordIds: ["ocr_cna_plain"],
    note: "不该写下"
  });
  assert.equal(plain.response.status, 400);
  assert.equal(plain.json.reason, "not_pending");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_old")?.callOutcomeNote, "更早的备注");
  assert.equal(store.callOutcomeAudits.some((item) => item.action === "append"), false);

  const deniedPreview = await request(previewPath, shirley, "POST", {
    callRecordIds: ["ocr_cna_neg", "ocr_cna_public"],
    note: "公池不写"
  });
  assert.equal(deniedPreview.response.status, 409);
  assert.equal(deniedPreview.json.reason, "public_pool");
  assert.equal(store.callOutcomeAudits.some((item) => item.action === "append"), false);
  const denied = await request(confirmPath, shirley, "POST", {
    callRecordIds: ["ocr_cna_neg", "ocr_cna_public"],
    note: "公池不写"
  });
  assert.equal(denied.response.status, 409);
  assert.equal(denied.json.reason, "public_pool");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_neg")?.callOutcomeNote, "原备注");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_public")?.callOutcomeNote, "公池原备注");
  assert.equal(store.customers.find((item) => item.id === "c_cna_public")?.poolStatus, "public");
  const deniedAudits = store.callOutcomeAudits.filter((item) => item.callRecordId === "ocr_cna_public");
  assert.equal(deniedAudits.length, 1);
  assert.equal(deniedAudits[0]?.action, "append");
  assert.equal(deniedAudits[0]?.result, "rejected");
  assert.equal(deniedAudits[0]?.reason, "public_pool");
  assert.equal(deniedAudits[0]?.previousNote, "");
  assert.equal(deniedAudits[0]?.nextNote, "");
  assert.equal(store.callOutcomeAudits.some((item) => item.callRecordId === "ocr_cna_neg"), false);

  const ownDenied = await request(confirmPath, noWrite, "POST", {
    callRecordIds: ["ocr_cna_nowrite"],
    note: "无权不写"
  });
  assert.equal(ownDenied.response.status, 403);
  assert.equal(ownDenied.json.reason, "forbidden");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_nowrite")?.callOutcomeNote, "无权原备注");
  const ownAudit = store.callOutcomeAudits.find((item) => item.callRecordId === "ocr_cna_nowrite");
  assert.equal(ownAudit?.action, "append");
  assert.equal(ownAudit?.result, "rejected");
  assert.equal(ownAudit?.reason, "forbidden");

  const excluded = await request(confirmPath, shirley, "POST", {
    callRecordIds: ["ocr_cna_ex", "ocr_cna_intent"],
    note: "排除不写"
  });
  assert.equal(excluded.response.status, 409);
  assert.equal(excluded.json.reason, "not_contactable");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_intent")?.callOutcomeNote, "");
  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_cna_ex")?.status, "excluded");
  assert.equal(store.callOutcomeAudits.some((item) => item.callRecordId === "ocr_cna_ex" && item.reason === "not_contactable"), true);
  assert.equal(store.callOutcomeAudits.some((item) => item.callRecordId === "ocr_cna_intent"), false);

  const full = "字".repeat(200);
  const exact = await request(confirmPath, shirley, "POST", { callRecordIds: ["ocr_cna_exact"], note: full });
  assert.equal(exact.response.status, 200, JSON.stringify(exact.json));
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_exact")?.callOutcomeNote, full);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_exact")?.callOutcome, "无意向");

  const phrasePreview = await request(previewPath, shirley, "POST", { callRecordIds: ["ocr_cna_miss"], phraseId });
  assert.equal(phrasePreview.response.status, 200);
  assert.equal(phrasePreview.json.note, "请稍后再打");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_miss")?.callOutcomeNote, "");
  const phraseSaved = await request(confirmPath, shirley, "POST", { callRecordIds: ["ocr_cna_miss"], phraseId });
  assert.equal(phraseSaved.response.status, 200, JSON.stringify(phraseSaved.json));
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_miss")?.callOutcomeNote, "请稍后再打");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_miss")?.callOutcome, "");
  assert.equal(store.callScriptTemplates.find((item) => item.id === phraseId)?.body, phraseBody);
  assert.equal(store.callScriptAudits.length, scriptAudits);

  const beforePreview = store.callOutcomeAudits.filter((item) => item.action === "append" && item.result === "updated").length;
  const preview = await request(previewPath, shirley, "POST", {
    callRecordIds: ["ocr_cna_neg", "ocr_cna_other", "ocr_cna_intent", "ocr_cna_miss", "ocr_cna_long"],
    note: "  补一句  "
  });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.json.result, "preview");
  assert.equal(preview.json.count, 4);
  assert.equal(preview.json.skipped, 1);
  assert.equal(preview.json.note, "补一句");
  assert.equal(store.callOutcomeAudits.filter((item) => item.action === "append" && item.result === "updated").length, beforePreview);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_neg")?.callOutcomeNote, "原备注");
  const names = (preview.json.items as Array<{ name?: string; status?: string }>).map((item) => `${item.status}:${item.name}`).join(" ");
  assert.match(names, /ready:Nordic <c_cna_neg>/);
  assert.match(names, /too_long:/);
  for (const secret of secrets) assert.equal(preview.text.includes(secret), false);
  assert.equal(preview.text.includes("secret.example"), false);

  const saved = await request(confirmPath, shirley, "POST", {
    callRecordIds: ["ocr_cna_neg", "ocr_cna_other", "ocr_cna_intent", "ocr_cna_miss", "ocr_cna_long"],
    note: "补一句"
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.result, "updated");
  assert.equal(saved.json.count, 4);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_neg")?.callOutcomeNote, "原备注 补一句");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_neg")?.callOutcome, "无意向");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_other")?.callOutcomeNote, "补一句");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_other")?.callOutcome, "其他");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_intent")?.callOutcomeNote, "补一句");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_intent")?.callOutcome, "有意向");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_miss")?.callOutcomeNote, "请稍后再打 补一句");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_long")?.callOutcomeNote, longNote);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_old")?.callOutcomeNote, "更早的备注");
  assert.equal(store.customers.find((item) => item.id === "c_cna_neg")?.nextReminder, "2026-11-10 09:00");
  assert.equal(store.leads.find((item) => item.id === "l_cna_other")?.nextFollowAt, "");
  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_cna_intent")?.outreachState, "suppressed");
  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_cna_intent")?.nextFollowAt, "");
  const success = store.callOutcomeAudits.filter((item) => item.batchId === saved.json.batchId);
  assert.equal(success.length, 4);
  assert.ok(success.every((item) => item.action === "append" && item.result === "updated" && item.reason === "" && item.previousOutcome === item.nextOutcome));
  assert.equal(success.find((item) => item.callRecordId === "ocr_cna_neg")?.previousNote, "原备注");
  assert.equal(success.find((item) => item.callRecordId === "ocr_cna_neg")?.nextNote, "原备注 补一句");
  assert.equal(success.some((item) => item.callRecordId === "ocr_cna_long"), false);
  for (const secret of secrets) assert.equal(saved.text.includes(secret), false);

  const again = await request(confirmPath, shirley, "POST", { callRecordIds: ["ocr_cna_neg"], note: "补一句" });
  assert.equal(again.response.status, 200);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_neg")?.callOutcomeNote, "原备注 补一句 补一句");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_neg")?.callOutcome, "无意向");

  const unchanged = await request(confirmPath, shirley, "POST", { callRecordIds: ["ocr_cna_long"], note: "补一句" });
  assert.equal(unchanged.response.status, 200);
  assert.equal(unchanged.json.result, "unchanged");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_long")?.callOutcomeNote, longNote);
  assert.equal(store.callOutcomeAudits.some((item) => item.callRecordId === "ocr_cna_long" && item.result === "updated"), false);

  const single = await request("/api/outbound-call-records/ocr_cna_other/outcome", shirley, "POST", {
    callRecordIds: ["ocr_cna_other"],
    outcome: "无意向",
    note: "覆盖"
  });
  assert.equal(single.response.status, 400);
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_other")?.callOutcomeNote, "补一句");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_other")?.callOutcome, "其他");
  const labeled = await request("/api/unlabeled-connected-calls/label", shirley, "POST", {
    callRecordIds: ["ocr_cna_other"],
    outcome: "无意向",
    note: "覆盖"
  });
  assert.equal(labeled.response.status, 400);
  assert.equal(labeled.json.reason, "not_pending");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_cna_other")?.callOutcome, "其他");

  assert.equal(store.leadActivities.length, activities);
  assert.equal(store.customerActivities.length, customerActivities);
  assert.equal(store.leads.length, leads);
  assert.equal(store.prospectContactabilityDecisions.length, decisions);
  assert.equal(store.callScriptAudits.length, scriptAudits);
  assert.equal(JSON.stringify(store.aliyunOutboundConfigs), configBefore);
  assert.equal(enabledBefore, false);
  assert.equal(aliyunHits, 0);
  assert.equal(calls.length, 0);
  console.log("call note append batch http tests passed");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
