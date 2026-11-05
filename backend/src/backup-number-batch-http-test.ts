import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundDialerForTests, setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { AliyunAgentMapping, ContactPhone, OutboundCallRecord, PhoneValidity, PreferredPhone, ProspectContactChannel } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start backup number batch test server");
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
    throw new Error("backup number batch must not dial");
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
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "",
    establishedTimeRaw: "1",
    releaseTimeRaw: "",
    startTimeRaw: "2000",
    agentIds: "agent@ccc-bnb-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://secret.example/rec",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "其他",
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
setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");

try {
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  assert.ok(shirleyUser && miaUser);
  store.users.push({
    ...shirleyUser,
    id: "u_bnb_no_write",
    name: "No Write",
    email: "no-bnb-write@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_bnb_no_read",
    name: "No Read",
    email: "no-bnb-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    if (actor.id !== "u_bnb_no_write" && actor.id !== "u_bnb_no_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    if (actor.id === "u_bnb_no_write") {
      delete permissions["customer.update"];
      delete permissions["lead.update"];
      delete permissions["prospect.execute"];
    }
    if (actor.id === "u_bnb_no_read") delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };
  const shirley = await login("shirley@keduoduo.com");
  const noWrite = await login("no-bnb-write@keduoduo.com");
  const noRead = await login("no-bnb-read@keduoduo.com");
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
    mapping({ crmUserId: shirleyUser.id, cccUserId: "agent@ccc-bnb-a", displayName: "Shirley坐席" }),
    mapping({ crmUserId: miaUser.id, cccUserId: "agent@ccc-bnb-b", displayName: "Mia坐席" }),
    mapping({ crmUserId: "u_bnb_no_write", cccUserId: "agent@ccc-bnb-c", displayName: "NoWrite坐席" })
  );
  const customerTemplate = store.customers.find((item) => item.id === "c1");
  const leadTemplate = store.leads.find((item) => item.id === "l1");
  const prospectTemplate = store.websiteOpportunities.find((item) => item.id === "web_seed_1");
  assert.ok(customerTemplate && leadTemplate && prospectTemplate);
  let phoneSerial = 46821000000;
  const nextPhone = () => `+${phoneSerial++}`;
  const secrets = new Set<string>();
  const phone = () => {
    const value = nextPhone();
    secrets.add(value);
    return value;
  };
  const customer = (id: string, extra: Partial<typeof customerTemplate> = {}) => {
    store.customers.push({
      ...customerTemplate,
      company: id,
      teamId: "europe",
      nextReminder: "",
      poolStatus: "owned",
      ownerId: shirleyUser.id,
      phone: phone(),
      ...extra,
      id
    });
  };
  const extraPhone = (targetType: "customer" | "lead", targetId: string, phoneId: string, ownerId = shirleyUser.id) => {
    store.contactPhones.push({
      id: `cph_${phoneId}`,
      teamId: "europe",
      targetType,
      targetId,
      phoneId,
      label: "手机",
      phone: phone(),
      phoneDigits: "",
      origin: "extra",
      updatedBy: ownerId,
      updatedAt: "2026-11-04T00:00:00.000Z"
    } satisfies ContactPhone);
  };
  customer("c_bnb_today", { company: "Today Buyer", nextReminder: "2026-11-04 10:00" });
  extraPhone("customer", "c_bnb_today", "contact-phone:bnb-today");
  customer("c_bnb_miss", { company: "Miss Buyer" });
  extraPhone("customer", "c_bnb_miss", "contact-phone:bnb-miss");
  customer("c_bnb_chain", { company: "Chain Buyer" });
  extraPhone("customer", "c_bnb_chain", "contact-phone:bnb-chain-a");
  extraPhone("customer", "c_bnb_chain", "contact-phone:bnb-chain-b");
  customer("c_bnb_skip", { company: "Skip <Buyer>" });
  extraPhone("customer", "c_bnb_skip", "contact-phone:bnb-mid");
  extraPhone("customer", "c_bnb_skip", "contact-phone:bnb-skip-good");
  customer("c_bnb_stale", { company: "Stale Buyer" });
  extraPhone("customer", "c_bnb_stale", "contact-phone:bnb-stale-bad");
  extraPhone("customer", "c_bnb_stale", "contact-phone:bnb-stale-good");
  customer("c_bnb_only", { company: "Only <Buyer>" });
  customer("c_bnb_last", { company: "Last Buyer" });
  extraPhone("customer", "c_bnb_last", "contact-phone:bnb-last");
  customer("c_bnb_intent", { company: "Intent Buyer" });
  extraPhone("customer", "c_bnb_intent", "contact-phone:bnb-intent");
  customer("c_bnb_open", { company: "Open Buyer" });
  extraPhone("customer", "c_bnb_open", "contact-phone:bnb-open");
  customer("c_bnb_neg", { company: "Neg Buyer", nextReminder: "下周" });
  extraPhone("customer", "c_bnb_neg", "contact-phone:bnb-neg");
  customer("c_bnb_plain", { company: "Plain Buyer" });
  customer("c_bnb_pool", { company: "Pool Buyer", poolStatus: "public", nextReminder: "下周" });
  extraPhone("customer", "c_bnb_pool", "contact-phone:bnb-pool");
  customer("c_bnb_mia", { company: "Mia Buyer", ownerId: miaUser.id });
  extraPhone("customer", "c_bnb_mia", "contact-phone:bnb-mia", miaUser.id);
  customer("c_bnb_scope", { company: "Scope Buyer" });
  extraPhone("customer", "c_bnb_scope", "contact-phone:bnb-scope");
  customer("c_bnb_nowrite", { company: "No Write Buyer", ownerId: "u_bnb_no_write" });
  extraPhone("customer", "c_bnb_nowrite", "contact-phone:bnb-nowrite", "u_bnb_no_write");
  customer("c_bnb_single", { company: "Single Buyer" });
  store.phoneValidities.push({
    id: "pv_bnb_mid",
    teamId: "europe",
    targetType: "customer",
    targetId: "c_bnb_skip",
    phoneId: "contact-phone:bnb-mid",
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z"
  } satisfies PhoneValidity, {
    id: "pv_bnb_stale",
    teamId: "europe",
    targetType: "customer",
    targetId: "c_bnb_stale",
    phoneId: "contact-phone:bnb-stale-bad",
    updatedBy: shirleyUser.id,
    updatedAt: "2026-11-04T00:00:00.000Z"
  } satisfies PhoneValidity);
  const prefer = (targetId: string, phoneId: string) => {
    store.preferredPhones.push({
      id: `pph_${targetId}`,
      teamId: "europe",
      targetType: "customer",
      targetId,
      phoneId,
      updatedBy: shirleyUser.id,
      updatedAt: "2026-11-04T00:00:00.000Z"
    } satisfies PreferredPhone);
  };
  prefer("c_bnb_chain", "customer-phone:c_bnb_chain");
  prefer("c_bnb_skip", "customer-phone:c_bnb_skip");
  prefer("c_bnb_stale", "contact-phone:bnb-stale-bad");
  prefer("c_bnb_only", "customer-phone:c_bnb_only");
  prefer("c_bnb_last", "contact-phone:bnb-last");
  store.leads.push({
    ...leadTemplate,
    id: "l_bnb_ok",
    company: "批量线索",
    teamId: "europe",
    ownerId: shirleyUser.id,
    phone: phone(),
    nextFollowAt: "",
    status: "new",
    deletedAt: ""
  });
  extraPhone("lead", "l_bnb_ok", "contact-phone:bnb-lead");
  const channel = (id: string, prospectId: string, ownerId = shirleyUser.id): ProspectContactChannel => ({
    id,
    teamId: "europe",
    ownerId,
    prospectId,
    organizationId: "",
    contactId: "",
    channelType: "phone",
    value: phone(),
    normalizedValueHash: "",
    sourceEvidenceId: "",
    acquiredAt: "",
    idempotencyKeyHash: "",
    requestHash: "",
    recordHash: "",
    createdAt: "2026-11-01T00:00:00.000Z"
  });
  store.prospectContactChannels.push(
    channel("ch_bnb_ok_a", "tp_bnb_ok"),
    channel("ch_bnb_ok_b", "tp_bnb_ok"),
    channel("ch_bnb_sup_a", "tp_bnb_sup"),
    channel("ch_bnb_sup_b", "tp_bnb_sup")
  );
  store.websiteOpportunities.push({
    ...prospectTemplate,
    id: "p_bnb_ok",
    company: "批量搜客",
    teamId: "europe",
    ownerId: shirleyUser.id,
    status: "contacted",
    leadId: "",
    nextFollowAt: "",
    outreachState: "uncontacted",
    tenantProspectId: "tp_bnb_ok"
  }, {
    ...prospectTemplate,
    id: "p_bnb_sup",
    company: "已抑制搜客",
    teamId: "europe",
    ownerId: shirleyUser.id,
    status: "contacted",
    leadId: "",
    nextFollowAt: "",
    outreachState: "suppressed",
    tenantProspectId: "tp_bnb_sup"
  });
  store.outboundCallRecords.push(
    record({ id: "ocr_bnb_miss", targetType: "customer", targetId: "c_bnb_miss", callOutcome: "", establishedTimeRaw: "", startTimeRaw: "3000" }),
    record({ id: "ocr_bnb_chain", targetType: "customer", targetId: "c_bnb_chain", callOutcome: "其他", startTimeRaw: "2900" }),
    record({ id: "ocr_bnb_skip", targetType: "customer", targetId: "c_bnb_skip", callOutcome: "其他", startTimeRaw: "2890" }),
    record({ id: "ocr_bnb_stale", targetType: "customer", targetId: "c_bnb_stale", callOutcome: "其他", startTimeRaw: "2880" }),
    record({ id: "ocr_bnb_only", targetType: "customer", targetId: "c_bnb_only", callOutcome: "其他", startTimeRaw: "2870" }),
    record({ id: "ocr_bnb_last", targetType: "customer", targetId: "c_bnb_last", callOutcome: "其他", startTimeRaw: "2860" }),
    record({ id: "ocr_bnb_intent", targetType: "customer", targetId: "c_bnb_intent", callOutcome: "有意向", startTimeRaw: "2800" }),
    record({ id: "ocr_bnb_open", targetType: "customer", targetId: "c_bnb_open", callOutcome: "", startTimeRaw: "2700" }),
    record({ id: "ocr_bnb_neg", targetType: "customer", targetId: "c_bnb_neg", callOutcome: "无意向", startTimeRaw: "2600" }),
    record({ id: "ocr_bnb_pool", targetType: "customer", targetId: "c_bnb_pool", callOutcome: "无意向", startTimeRaw: "2500" }),
    record({ id: "ocr_bnb_mia", targetType: "customer", targetId: "c_bnb_mia", agentIds: "agent@ccc-bnb-b", callOutcome: "其他", startTimeRaw: "2400" }),
    record({ id: "ocr_bnb_scope", targetType: "customer", targetId: "c_bnb_scope", callOutcome: "其他", startTimeRaw: "2350" }),
    record({ id: "ocr_bnb_nowrite", targetType: "customer", targetId: "c_bnb_nowrite", agentIds: "agent@ccc-bnb-c", callOutcome: "其他", startTimeRaw: "2305" }),
    record({ id: "ocr_bnb_lead", targetType: "lead", targetId: "l_bnb_ok", callOutcome: "其他", startTimeRaw: "2300" }),
    record({ id: "ocr_bnb_prospect", targetType: "prospect", targetId: "p_bnb_ok", callOutcome: "其他", startTimeRaw: "2200" }),
    record({ id: "ocr_bnb_sup", targetType: "prospect", targetId: "p_bnb_sup", callOutcome: "其他", startTimeRaw: "2100" }),
    record({ id: "ocr_bnb_single", targetType: "customer", targetId: "c_bnb_single", callOutcome: "其他", startTimeRaw: "2050" })
  );

  const previewPath = "/api/preferred-phones/batch-backup/preview";
  const path = "/api/preferred-phones/batch-backup";
  const one = (targetType: string, targetId: string) => ({ targetType, targetId });
  const chosen = [
    one("customer", "c_bnb_today"),
    one("customer", "c_bnb_miss"),
    one("customer", "c_bnb_chain"),
    one("customer", "c_bnb_skip"),
    one("customer", "c_bnb_stale"),
    one("customer", "c_bnb_only"),
    one("customer", "c_bnb_last"),
    one("customer", "c_bnb_intent"),
    one("customer", "c_bnb_open"),
    one("customer", "c_bnb_neg"),
    one("lead", "l_bnb_ok"),
    one("prospect", "p_bnb_ok"),
    one("prospect", "p_bnb_sup")
  ];
  const auditsAt = () => store.preferredPhoneAudits.length;
  const preferredId = (targetId: string) => store.preferredPhones.find((item) => item.targetId === targetId)?.phoneId || "";
  const enabledBefore = store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled;
  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents || []);
  const decisionsBefore = store.prospectContactabilityDecisions.length;
  const leadsBefore = store.leads.length;
  const validityBefore = store.phoneValidities.length;
  const outcomeBefore = store.outboundCallRecords.find((item) => item.id === "ocr_bnb_chain")?.callOutcome;
  const reminderBefore = store.customers.find((item) => item.id === "c_bnb_neg")?.nextReminder;
  const containsSecret = (text: string) => [...secrets].some((item) => text.includes(item));

  const empty = await request(path, shirley, "POST", { targets: [] });
  assert.equal(empty.response.status, 400);
  assert.equal(empty.json.reason, "invalid_request");
  const tooMany = await request(previewPath, shirley, "POST", {
    targets: Array.from({ length: 101 }, (_, index) => one("customer", `c_bnb_${index}`))
  });
  assert.equal(tooMany.response.status, 400);
  assert.equal(tooMany.json.reason, "too_many");
  const duplicate = await request(path, shirley, "POST", { targets: [one("customer", "c_bnb_chain"), one("customer", "c_bnb_chain")] });
  assert.equal(duplicate.response.status, 400);
  const extra = await request(path, shirley, "POST", { targets: [one("customer", "c_bnb_chain")], phones: ["1"] });
  assert.equal(extra.response.status, 400);
  assert.equal(auditsAt(), store.preferredPhoneAudits.length);

  const beforeHidden = auditsAt();
  const hiddenPreview = await request(previewPath, shirley, "POST", {
    targets: [one("customer", "c_bnb_chain"), one("customer", "c_bnb_mia")]
  });
  assert.equal(hiddenPreview.response.status, 404, hiddenPreview.text);
  assert.equal(hiddenPreview.json.reason, "not_found");
  assert.equal(preferredId("c_bnb_chain"), "customer-phone:c_bnb_chain");
  assert.equal(auditsAt(), beforeHidden);
  const hidden = await request(path, shirley, "POST", {
    targets: [one("customer", "c_bnb_chain"), one("customer", "c_bnb_mia")]
  });
  assert.equal(hidden.response.status, 404, hidden.text);
  assert.equal(auditsAt(), beforeHidden);

  const pending = await request(path, shirley, "POST", {
    targets: [one("customer", "c_bnb_chain"), one("customer", "c_bnb_plain")]
  });
  assert.equal(pending.response.status, 400, pending.text);
  assert.equal(pending.json.reason, "not_pending");
  assert.equal(auditsAt(), beforeHidden);

  const beforePool = auditsAt();
  const poolPreview = await request(previewPath, shirley, "POST", {
    targets: [one("customer", "c_bnb_chain"), one("customer", "c_bnb_pool")]
  });
  assert.equal(poolPreview.response.status, 409, poolPreview.text);
  assert.equal(poolPreview.json.reason, "public_pool");
  assert.equal(auditsAt(), beforePool);
  const pooled = await request(path, shirley, "POST", {
    targets: [one("customer", "c_bnb_chain"), one("customer", "c_bnb_pool")]
  });
  assert.equal(pooled.response.status, 409, pooled.text);
  assert.equal(pooled.json.reason, "public_pool");
  assert.equal(preferredId("c_bnb_chain"), "customer-phone:c_bnb_chain");
  assert.equal(preferredId("c_bnb_pool"), "");
  const poolAudit = store.preferredPhoneAudits.find((item) => item.targetId === "c_bnb_pool");
  assert.equal(poolAudit?.result, "rejected");
  assert.equal(poolAudit?.reason, "public_pool");
  assert.equal(poolAudit?.nextPhoneId, "");
  assert.equal(Boolean(poolAudit?.batchId), true);
  assert.equal(store.preferredPhoneAudits.some((item) => item.targetId === "c_bnb_chain" && item.batchId === poolAudit?.batchId), false);
  assert.equal(store.customers.find((item) => item.id === "c_bnb_pool")?.poolStatus, "public");

  const beforeDenied = auditsAt();
  const denied = await request(path, noWrite, "POST", { targets: [one("customer", "c_bnb_nowrite")] });
  assert.equal(denied.response.status, 403, denied.text);
  assert.equal(denied.json.reason, "forbidden");
  assert.equal(preferredId("c_bnb_nowrite"), "");
  const deniedAudit = store.preferredPhoneAudits.find((item) => item.targetId === "c_bnb_nowrite");
  assert.equal(deniedAudit?.result, "rejected");
  assert.equal(deniedAudit?.reason, "forbidden");
  assert.equal(auditsAt(), beforeDenied + 1);

  const originalScope = store.resolveIamDataScope?.bind(store);
  store.resolveIamDataScope = async (actor, permission) => {
    if (actor.id === shirleyUser.id && permission === "customer.update") return { tenantWide: false, ownerIds: [] };
    if (originalScope) return originalScope(actor, permission);
    return { tenantWide: false, ownerIds: actor.id ? [actor.id] : [] };
  };
  const beforeScope = auditsAt();
  const scoped = await request(path, shirley, "POST", { targets: [one("customer", "c_bnb_scope")] });
  store.resolveIamDataScope = originalScope;
  assert.equal(scoped.response.status, 404, scoped.text);
  assert.equal(scoped.json.reason, "not_found");
  assert.equal(preferredId("c_bnb_scope"), "");
  const scopeAudit = store.preferredPhoneAudits.find((item) => item.targetId === "c_bnb_scope");
  assert.equal(scopeAudit?.result, "rejected");
  assert.equal(scopeAudit?.reason, "not_found");
  assert.equal(auditsAt(), beforeScope + 1);

  const beforeRead = auditsAt();
  const unread = await request(path, noRead, "POST", { targets: [one("customer", "c_bnb_chain")] });
  assert.equal(unread.response.status, 403);
  assert.equal(auditsAt(), beforeRead);
  const anon = await request(path, "", "POST", { targets: [one("customer", "c_bnb_chain")] });
  assert.equal(anon.response.status, 401);
  assert.equal(auditsAt(), beforeRead);

  const single = await request("/api/preferred-phones", shirley, "POST", {
    targetType: "customer",
    targetId: "c_bnb_single",
    phoneId: "customer-phone:c_bnb_single",
    targets: [one("customer", "c_bnb_single")]
  });
  assert.equal(single.response.status, 400);
  assert.equal(preferredId("c_bnb_single"), "");
  const alone = await request("/api/preferred-phones", shirley, "POST", {
    targetType: "customer",
    targetId: "c_bnb_single",
    phoneId: "customer-phone:c_bnb_single"
  });
  assert.equal(alone.response.status, 200, alone.text);
  const aloneAudit = store.preferredPhoneAudits.find((item) => item.targetId === "c_bnb_single" && item.result === "updated");
  assert.equal(aloneAudit?.batchId || "", "");
  assert.equal(aloneAudit?.reason, "set");
  const missed = await request("/api/preferred-phones/switch-after-miss", shirley, "POST", {
    targetType: "customer",
    targetId: "c_bnb_miss",
    targets: [one("customer", "c_bnb_miss")]
  });
  assert.equal(missed.response.status, 400);
  assert.equal(preferredId("c_bnb_miss"), "");

  const beforePreview = auditsAt();
  const looked = await request(previewPath, shirley, "POST", { targets: chosen });
  assert.equal(looked.response.status, 200, looked.text);
  assert.equal(looked.json.result, "preview");
  assert.equal(looked.json.skipped, 2);
  assert.equal(containsSecret(looked.text), false);
  assert.equal(looked.text.includes("secret.example"), false);
  assert.equal(looked.text.includes("Success"), false);
  const lookedItems = looked.json.items as Array<Record<string, string>>;
  const onlyRow = lookedItems.find((item) => item.targetId === "c_bnb_only");
  const lastRow = lookedItems.find((item) => item.targetId === "c_bnb_last");
  const skipRow = lookedItems.find((item) => item.targetId === "c_bnb_skip");
  assert.equal(onlyRow?.status, "no_backup");
  assert.equal(onlyRow?.name, "Only <Buyer>");
  assert.equal(onlyRow?.nextPhoneId, "");
  assert.equal(lastRow?.status, "no_backup");
  assert.equal(lastRow?.currentPhoneId, "contact-phone:bnb-last");
  assert.equal(skipRow?.status, "ready");
  assert.equal(skipRow?.nextPhoneId, "contact-phone:bnb-skip-good");
  assert.equal(skipRow?.name, "Skip <Buyer>");
  assert.match(String(skipRow?.maskedNext || ""), /0021$|good|^\*/);
  assert.equal(String(skipRow?.maskedNext || "").includes("+"), false);
  assert.equal(preferredId("c_bnb_chain"), "customer-phone:c_bnb_chain");
  assert.equal(preferredId("c_bnb_skip"), "customer-phone:c_bnb_skip");
  assert.equal(store.phoneValidities.length, validityBefore);
  assert.equal(auditsAt(), beforePreview);

  const saved = await request(path, shirley, "POST", { targets: chosen });
  assert.equal(saved.response.status, 200, saved.text);
  assert.equal(saved.json.result, "updated");
  assert.equal(saved.json.count, chosen.length - 2);
  assert.equal(containsSecret(saved.text), false);
  assert.equal(saved.text.includes("secret.example"), false);
  assert.equal(saved.text.includes("Success"), false);
  const batchId = String(saved.json.batchId || "");
  assert.equal(batchId.startsWith("pbb_"), true);
  const skipped = saved.json.skipped as Array<Record<string, string>>;
  assert.equal(skipped.filter((item) => item.status === "no_backup").map((item) => item.targetId).sort().join(","), "c_bnb_last,c_bnb_only");
  assert.equal(preferredId("c_bnb_only"), "customer-phone:c_bnb_only");
  assert.equal(preferredId("c_bnb_last"), "contact-phone:bnb-last");
  assert.equal(preferredId("c_bnb_chain"), "contact-phone:bnb-chain-a");
  assert.equal(preferredId("c_bnb_skip"), "contact-phone:bnb-skip-good");
  assert.equal(preferredId("c_bnb_stale"), "contact-phone:bnb-stale-good");
  assert.equal(preferredId("c_bnb_miss"), "contact-phone:bnb-miss");
  assert.equal(preferredId("c_bnb_today"), "contact-phone:bnb-today");
  assert.equal(preferredId("l_bnb_ok"), "contact-phone:bnb-lead");
  assert.equal(preferredId("p_bnb_ok"), "ch_bnb_ok_b");
  assert.equal(preferredId("p_bnb_sup"), "ch_bnb_sup_b");
  const chainAudit = store.preferredPhoneAudits.find((item) => item.targetId === "c_bnb_chain" && item.batchId === batchId);
  assert.equal(chainAudit?.action, "update");
  assert.equal(chainAudit?.reason, "next_backup");
  assert.equal(chainAudit?.result, "updated");
  assert.equal(chainAudit?.previousPhoneId, "customer-phone:c_bnb_chain");
  assert.equal(chainAudit?.nextPhoneId, "contact-phone:bnb-chain-a");
  const missAudit = store.preferredPhoneAudits.find((item) => item.targetId === "c_bnb_miss" && item.batchId === batchId);
  assert.equal(missAudit?.action, "set");
  assert.equal(missAudit?.previousPhoneId, "");
  assert.equal(missAudit?.reason, "next_backup");
  const staleAudit = store.preferredPhoneAudits.find((item) => item.targetId === "c_bnb_stale" && item.batchId === batchId);
  assert.equal(staleAudit?.previousPhoneId, "contact-phone:bnb-stale-bad");
  assert.equal(staleAudit?.nextPhoneId, "contact-phone:bnb-stale-good");
  assert.equal(store.preferredPhoneAudits.some((item) => item.batchId === batchId && item.reason === "missed_alternate"), false);
  assert.equal(store.preferredPhoneAudits.some((item) => item.batchId === batchId && item.reason === "wrong_number_alternate"), false);
  assert.equal(store.preferredPhoneAudits.filter((item) => item.batchId === batchId && item.result === "updated").length, chosen.length - 2);
  assert.equal(store.phoneValidities.some((item) => item.phoneId === "contact-phone:bnb-mid"), true);
  assert.equal(store.phoneValidities.some((item) => item.phoneId === "contact-phone:bnb-stale-bad"), true);
  assert.equal(store.phoneValidities.length, validityBefore);
  assert.equal(JSON.stringify(store.preferredPhoneAudits).includes("+468"), false);

  const again = await request(path, shirley, "POST", { targets: [one("customer", "c_bnb_chain")] });
  assert.equal(again.response.status, 200, again.text);
  assert.equal(again.json.result, "updated");
  assert.equal(preferredId("c_bnb_chain"), "contact-phone:bnb-chain-b");
  assert.notEqual(again.json.batchId, batchId);
  const third = await request(path, shirley, "POST", { targets: [one("customer", "c_bnb_chain"), one("customer", "c_bnb_only")] });
  assert.equal(third.response.status, 200, third.text);
  assert.equal(third.json.result, "unchanged");
  assert.equal(third.json.count, 0);
  assert.equal(third.json.batchId, "");
  assert.equal(preferredId("c_bnb_chain"), "contact-phone:bnb-chain-b");
  assert.equal(store.preferredPhoneAudits.filter((item) => item.targetId === "c_bnb_chain" && item.result === "updated").length, 2);

  assert.equal(store.customers.find((item) => item.id === "c_bnb_neg")?.nextReminder, reminderBefore);
  assert.equal(store.customers.find((item) => item.id === "c_bnb_today")?.nextReminder, "2026-11-04 10:00");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_bnb_chain")?.callOutcome, outcomeBefore);
  assert.equal(store.aliyunOutboundConfigs.find((item) => item.teamId === "europe")?.aliyunOutboundEnabled, enabledBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents || []), suppressionBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(aliyunHits, 0);
  assert.equal(calls.length, 0);
  console.log("backup number batch http tests passed");
} finally {
  setOutboundDialerForTests(undefined);
  setOutboundNowForTests(undefined);
  setTenantTimezoneOverride(store, "europe", undefined);
  globalThis.fetch = originalFetch;
  server.close();
}
