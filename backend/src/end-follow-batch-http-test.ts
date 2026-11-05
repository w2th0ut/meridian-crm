import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundDialerForTests, setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { AliyunAgentMapping, OutboundCallRecord } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start end follow batch test server");
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
    throw new Error("end follow batch must not dial");
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
    agentIds: "agent@ccc-efb-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://secret.example/rec",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "无意向",
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
const previewPath = "/api/next-follow-ups/batch-clear/preview";
const confirmPath = "/api/next-follow-ups/batch-clear";

try {
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const miaUser = store.users.find((item) => item.email === "mia@keduoduo.com");
  assert.ok(shirleyUser && miaUser);
  store.users.push({
    ...shirleyUser,
    id: "u_efb_no_write",
    name: "No Write",
    email: "no-efb-write@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  }, {
    ...shirleyUser,
    id: "u_efb_no_read",
    name: "No Read",
    email: "no-efb-read@keduoduo.com",
    role: "sales",
    teamId: "europe",
    status: "active"
  });
  const originalSnapshot = store.getIamCapabilitySnapshot?.bind(store);
  assert.ok(originalSnapshot);
  store.getIamCapabilitySnapshot = async (actor) => {
    const snapshot = await originalSnapshot(actor);
    if (actor.id !== "u_efb_no_write" && actor.id !== "u_efb_no_read") return snapshot;
    const permissions = { ...snapshot.permissions };
    if (actor.id === "u_efb_no_write") {
      delete permissions["customer.update"];
      delete permissions["lead.update"];
      delete permissions["prospect.execute"];
    }
    if (actor.id === "u_efb_no_read") delete permissions["communication.read"];
    return { ...snapshot, permissions };
  };
  const shirley = await login("shirley@keduoduo.com");
  const noWrite = await login("no-efb-write@keduoduo.com");
  const noRead = await login("no-efb-read@keduoduo.com");
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
    mapping({ crmUserId: shirleyUser.id, cccUserId: "agent@ccc-efb-a", displayName: "Shirley坐席" }),
    mapping({ crmUserId: miaUser.id, cccUserId: "agent@ccc-efb-b", displayName: "Mia坐席" }),
    mapping({ crmUserId: "u_efb_no_write", cccUserId: "agent@ccc-efb-c", displayName: "NoWrite坐席" })
  );
  const customerTemplate = store.customers.find((item) => item.id === "c1");
  const leadTemplate = store.leads.find((item) => item.id === "l1");
  const prospectTemplate = store.websiteOpportunities.find((item) => item.id === "web_seed_1");
  assert.ok(customerTemplate && leadTemplate && prospectTemplate);
  let phoneSerial = 46831000000;
  const secrets = new Set<string>(["https://secret.example/rec"]);
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

  customer("c_efb_neg", { nextReminder: "2026-11-10 09:00" });
  customer("c_efb_today", { nextReminder: "2026-11-04 15:00" });
  customer("c_efb_hold", { nextReminder: "2026-11-12 09:00" });
  customer("c_efb_public", { nextReminder: "2026-11-12 10:00", poolStatus: "public", ownerId: "" });
  customer("c_efb_later", { nextReminder: "2026-12-20 09:00" });
  customer("c_efb_mia", { nextReminder: "2026-11-12 11:00", ownerId: miaUser.id, company: "Mia Hidden" });
  customer("c_efb_nowrite", { nextReminder: "2026-11-13 09:00", ownerId: "u_efb_no_write" });
  lead("l_efb_neg", { nextFollowAt: "2026-11-08 10:00", status: leadTemplate.status });
  lead("l_efb_link", { nextFollowAt: "2026-12-01 09:00", status: leadTemplate.status });
  prospect("p_efb_neg", { nextFollowAt: "2026-11-09 11:00", leadId: "l_efb_link", outreachState: "suppressed" });

  store.outboundCallRecords.push(
    record({ id: "ocr_efb_neg", targetType: "customer", targetId: "c_efb_neg", callOutcome: "无意向" }),
    record({ id: "ocr_efb_today", targetType: "customer", targetId: "c_efb_today", callOutcome: "有意向" }),
    record({ id: "ocr_efb_hold", targetType: "customer", targetId: "c_efb_hold", callOutcome: "号码错误" }),
    record({ id: "ocr_efb_public", targetType: "customer", targetId: "c_efb_public", callOutcome: "无意向" }),
    record({ id: "ocr_efb_later", targetType: "customer", targetId: "c_efb_later", callOutcome: "有意向" }),
    record({ id: "ocr_efb_mia", targetType: "customer", targetId: "c_efb_mia", callOutcome: "无意向", agentIds: "agent@ccc-efb-b" }),
    record({ id: "ocr_efb_nowrite", targetType: "customer", targetId: "c_efb_nowrite", callOutcome: "无意向", agentIds: "agent@ccc-efb-c" }),
    record({ id: "ocr_efb_lead", targetType: "lead", targetId: "l_efb_neg", callOutcome: "无意向" }),
    record({ id: "ocr_efb_prospect", targetType: "prospect", targetId: "p_efb_neg", callOutcome: "号码错误" })
  );

  const activities = store.leadActivities.length;
  const customerActivities = store.customerActivities.length;
  const leads = store.leads.length;
  const decisions = store.prospectContactabilityDecisions.length;
  const negativeAudits = store.negativeOutcomeFollowupAudits?.length || 0;
  const linked = store.leads.find((item) => item.id === "l_efb_link");
  assert.ok(linked);
  const linkedStatus = linked.status;

  const badBodies = [
    {},
    { targets: [] },
    { targets: [{ targetType: "customer", targetId: "c_efb_neg" }, { targetType: "customer", targetId: "c_efb_neg" }] },
    { targets: Array.from({ length: 101 }, (_, index) => ({ targetType: "customer", targetId: `c${index}` })) },
    { targets: [{ targetType: "customer", targetId: "c_efb_neg" }], records: ["c_efb_neg"] },
    { targets: [{ targetType: "customer", targetId: "c_efb_neg" }], reason: "字".repeat(201) },
    { targets: [{ targetType: "customer", targetId: "c_efb_neg" }], reason: 1 }
  ];
  for (const body of badBodies) {
    const rejected = await request(confirmPath, shirley, "POST", body);
    assert.equal(rejected.response.status, 400);
    assert.equal(store.nextFollowUpAudits.some((item) => item.batchId.startsWith("nfc_")), false);
  }
  const anonymous = await request(confirmPath, "", "POST", { targets: [{ targetType: "customer", targetId: "c_efb_neg" }] });
  assert.equal(anonymous.response.status, 401);
  const unread = await request(confirmPath, noRead, "POST", { targets: [{ targetType: "customer", targetId: "c_efb_neg" }] });
  assert.equal(unread.response.status, 403);
  assert.equal(store.nextFollowUpAudits.some((item) => item.actorId === "u_efb_no_read"), false);

  const beforePreview = store.nextFollowUpAudits.length;
  const preview = await request(previewPath, shirley, "POST", {
    targets: [
      { targetType: "customer", targetId: "c_efb_neg" },
      { targetType: "lead", targetId: "l_efb_neg" },
      { targetType: "prospect", targetId: "p_efb_neg" },
      { targetType: "customer", targetId: "c_efb_today" }
    ],
    reason: "  不再跟进  "
  });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.json.result, "preview");
  assert.equal(preview.json.count, 4);
  assert.equal(preview.json.reason, "不再跟进");
  assert.equal(store.nextFollowUpAudits.length, beforePreview);
  assert.equal(store.customers.find((item) => item.id === "c_efb_neg")?.nextReminder, "2026-11-10 09:00");
  const names = (preview.json.items as Array<{ name?: string; suppressionNotice?: string }>).map((item) => item.name).join(" ");
  assert.match(names, /Nordic <c_efb_neg>/);
  assert.match(JSON.stringify(preview.json), /不改变抑制状态|抑制/);
  for (const secret of secrets) assert.equal(preview.text.includes(secret), false);
  assert.equal(preview.text.includes("secret.example"), false);
  assert.equal(preview.text.includes("Success"), false);

  const hidden = await request(confirmPath, shirley, "POST", {
    targets: [
      { targetType: "customer", targetId: "c_efb_hold" },
      { targetType: "customer", targetId: "c_efb_mia" }
    ],
    reason: "不该写下"
  });
  assert.equal(hidden.response.status, 404);
  assert.equal(hidden.json.reason, "not_found");
  assert.equal(store.customers.find((item) => item.id === "c_efb_hold")?.nextReminder, "2026-11-12 09:00");
  assert.equal(store.nextFollowUpAudits.some((item) => item.objectId === "c_efb_hold" || item.objectId === "c_efb_mia"), false);

  const pending = await request(confirmPath, shirley, "POST", {
    targets: [
      { targetType: "customer", targetId: "c_efb_hold" },
      { targetType: "customer", targetId: "c_efb_later" }
    ]
  });
  assert.equal(pending.response.status, 400);
  assert.equal(pending.json.reason, "not_pending");
  assert.equal(store.customers.find((item) => item.id === "c_efb_hold")?.nextReminder, "2026-11-12 09:00");
  assert.equal(store.nextFollowUpAudits.some((item) => item.objectId === "c_efb_later"), false);

  const deniedPreview = await request(previewPath, shirley, "POST", {
    targets: [
      { targetType: "customer", targetId: "c_efb_hold" },
      { targetType: "customer", targetId: "c_efb_public" }
    ]
  });
  assert.equal(deniedPreview.response.status, 409);
  assert.equal(deniedPreview.json.reason, "public_pool");
  assert.equal(store.nextFollowUpAudits.some((item) => item.objectId === "c_efb_public"), false);
  const denied = await request(confirmPath, shirley, "POST", {
    targets: [
      { targetType: "customer", targetId: "c_efb_hold" },
      { targetType: "customer", targetId: "c_efb_public" }
    ],
    reason: "公池不该记下原因"
  });
  assert.equal(denied.response.status, 409);
  assert.equal(denied.json.reason, "public_pool");
  assert.equal(store.customers.find((item) => item.id === "c_efb_hold")?.nextReminder, "2026-11-12 09:00");
  assert.equal(store.customers.find((item) => item.id === "c_efb_public")?.nextReminder, "2026-11-12 10:00");
  assert.equal(store.customers.find((item) => item.id === "c_efb_public")?.poolStatus, "public");
  const deniedAudits = store.nextFollowUpAudits.filter((item) => item.objectId === "c_efb_public");
  assert.equal(deniedAudits.length, 1);
  assert.equal(deniedAudits[0]?.action, "batch_reject_public_pool");
  assert.equal(deniedAudits[0]?.oldValue, "");
  assert.equal(deniedAudits[0]?.newValue, "");
  assert.equal(deniedAudits[0]?.reason, "");
  assert.equal(store.nextFollowUpAudits.some((item) => item.objectId === "c_efb_hold"), false);

  const ownDenied = await request(confirmPath, noWrite, "POST", {
    targets: [{ targetType: "customer", targetId: "c_efb_nowrite" }]
  });
  assert.equal(ownDenied.response.status, 403);
  assert.equal(ownDenied.json.reason, "forbidden");
  assert.equal(store.customers.find((item) => item.id === "c_efb_nowrite")?.nextReminder, "2026-11-13 09:00");
  const ownAudit = store.nextFollowUpAudits.find((item) => item.objectId === "c_efb_nowrite");
  assert.equal(ownAudit?.action, "batch_reject_forbidden");

  const reason = "字".repeat(200);
  const saved = await request(confirmPath, shirley, "POST", {
    targets: [
      { targetType: "customer", targetId: "c_efb_neg" },
      { targetType: "lead", targetId: "l_efb_neg" },
      { targetType: "prospect", targetId: "p_efb_neg" },
      { targetType: "customer", targetId: "c_efb_today" },
      { targetType: "customer", targetId: "c_efb_hold" }
    ],
    reason
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.result, "updated");
  assert.equal(saved.json.count, 5);
  assert.equal(saved.json.reason, reason);
  assert.equal(store.customers.find((item) => item.id === "c_efb_neg")?.nextReminder, "");
  assert.equal(store.customers.find((item) => item.id === "c_efb_today")?.nextReminder, "");
  assert.equal(store.customers.find((item) => item.id === "c_efb_hold")?.nextReminder, "");
  assert.equal(store.leads.find((item) => item.id === "l_efb_neg")?.nextFollowAt, "");
  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_efb_neg")?.nextFollowAt, "");
  assert.equal(store.leads.find((item) => item.id === "l_efb_link")?.nextFollowAt, "");
  assert.equal(store.leads.find((item) => item.id === "l_efb_link")?.status, linkedStatus);
  assert.equal(store.websiteOpportunities.find((item) => item.id === "p_efb_neg")?.outreachState, "suppressed");
  assert.equal(store.outboundCallRecords.find((item) => item.id === "ocr_efb_neg")?.callOutcome, "无意向");
  const success = store.nextFollowUpAudits.filter((item) => item.batchId === saved.json.batchId);
  assert.equal(success.length, 5);
  assert.equal(new Set(success.map((item) => item.batchId)).size, 1);
  assert.ok(success.every((item) => item.action === "batch_clear_next_follow_up" && item.newValue === "" && item.reason === reason && !item.callRecordId));
  assert.equal(success.find((item) => item.objectId === "c_efb_neg")?.objectType, "customer");
  assert.equal(success.find((item) => item.objectId === "l_efb_neg")?.objectType, "lead");
  assert.equal(success.find((item) => item.objectId === "p_efb_neg")?.objectType, "prospect_candidate");
  assert.equal(success.find((item) => item.objectId === "c_efb_neg")?.oldValue, "2026-11-10 09:00");
  for (const secret of secrets) assert.equal(saved.text.includes(secret), false);

  const again = await request(confirmPath, shirley, "POST", {
    targets: [{ targetType: "customer", targetId: "c_efb_neg" }],
    reason: "再来一次"
  });
  assert.equal(again.response.status, 400);
  assert.equal(again.json.reason, "not_pending");
  assert.equal(store.nextFollowUpAudits.filter((item) => item.objectId === "c_efb_neg" && item.action === "batch_clear_next_follow_up").length, 1);

  const single = await request("/api/negative-outcome-followups/clear", shirley, "POST", {
    targets: [{ targetType: "customer", targetId: "c_efb_public" }]
  });
  assert.equal(single.response.status, 400);
  assert.equal(store.customers.find((item) => item.id === "c_efb_public")?.nextReminder, "2026-11-12 10:00");

  assert.equal(store.leadActivities.length, activities);
  assert.equal(store.customerActivities.length, customerActivities);
  assert.equal(store.leads.length, leads);
  assert.equal(store.prospectContactabilityDecisions.length, decisions);
  assert.equal(store.negativeOutcomeFollowupAudits?.length || 0, negativeAudits);
  assert.equal(aliyunHits, 0);
  assert.equal(calls.length, 0);
  console.log("end follow batch http tests passed");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
