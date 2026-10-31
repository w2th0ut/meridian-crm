import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start workbench follow-up test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

async function request(path: string, token: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
  const json = await response.json().catch(() => ({})) as Record<string, any>;
  return { response, json };
}

async function login(email: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "keduoduo123" })
  });
  const json = await response.json() as { token?: string };
  assert.equal(response.status, 200, `登录失败：${email}`);
  return String(json.token);
}

function isIso(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

try {
  const store = getStore();
  const shirley = await login("shirley@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  assert.ok(shirleyUser);
  const candidate = store.websiteOpportunities.find((item) => item.id === "web_seed_1");
  assert.ok(candidate);
  assert.equal(candidate.ownerId, shirleyUser.id);
  candidate.status = "preview";

  const emailsBefore = store.outboundEmailLogs.length;
  const suppressBefore = store.prospectSuppressionEvents.length;
  const decisionsBefore = store.prospectContactabilityDecisions.length;

  const blocked = await request(`/api/prospect-list/${candidate.id}/follow-ups`, shirley, {
    content: "还没可联系",
    type: "note"
  });
  assert.equal(blocked.response.status, 409, blocked.json.message);
  assert.equal(store.followUpAudits.some((item) => item.objectId === candidate.id), false);

  candidate.status = "contactable";
  const activitiesBefore = store.leadActivities.length;
  const auditsBefore = store.followUpAudits.length;

  const empty = await request(`/api/prospect-list/${candidate.id}/follow-ups`, shirley, {
    content: "   ",
    type: "call"
  });
  assert.equal(empty.response.status, 400);
  assert.match(String(empty.json.message || ""), /请填写跟进内容|参数格式错误/);
  assert.equal(store.leadActivities.length, activitiesBefore);
  assert.equal(store.followUpAudits.length, auditsBefore);

  const forbidden = await request(`/api/prospect-list/${candidate.id}/follow-ups`, alex, {
    content: "主管越权记跟进",
    type: "note"
  });
  assert.equal(forbidden.response.status, 403);
  assert.equal(store.leadActivities.length, activitiesBefore);
  assert.equal(store.followUpAudits.length, auditsBefore);

  const saved = await request(`/api/prospect-list/${candidate.id}/follow-ups`, shirley, {
    content: "已电话确认样品",
    type: "call",
    nextFollowAt: "2026-11-04T15:30"
  });
  assert.equal(saved.response.status, 201, saved.json.message);
  assert.equal(saved.json.activity?.type, "call");
  assert.equal(saved.json.activity?.content, "已电话确认样品");
  assert.equal(saved.json.nextFollowAt, "2026-11-04 15:30");
  assert.equal(saved.json.latestFollowUp?.type, "call");
  assert.equal(candidate.nextFollowAt, "2026-11-04 15:30");
  assert.equal(store.leadActivities.length, activitiesBefore + 1);
  const audit = store.followUpAudits.find((item) => item.activityId === saved.json.activity?.id);
  assert.ok(audit, "成功写入后必须有审计");
  assert.equal(audit.actorId, shirleyUser.id);
  assert.equal(audit.objectType, "prospect_candidate");
  assert.equal(audit.objectId, candidate.id);
  assert.equal(audit.action, "record_follow_up");
  assert.equal(isIso(audit.at), true);

  const customerActivitiesBefore = store.customerActivities.filter((item) => item.customerId === "c1").length;
  const customerEmpty = await request("/api/customers/c1/activities", shirley, {
    type: "note",
    content: "  "
  });
  assert.equal(customerEmpty.response.status, 400);
  assert.equal(store.customerActivities.filter((item) => item.customerId === "c1").length, customerActivitiesBefore);

  const mia = await login("mia@keduoduo.com");
  const customerForbidden = await request("/api/customers/c1/activities", mia, {
    type: "note",
    content: "越权记他人客户"
  });
  assert.equal(customerForbidden.response.status, 404);
  assert.equal(store.customerActivities.some((item) => item.content === "越权记他人客户"), false);
  assert.equal(store.followUpAudits.some((item) => item.objectId === "c1" && item.activityId && item.actorId !== shirleyUser.id), false);

  const customerSaved = await request("/api/customers/c1/activities", shirley, {
    type: "wechat",
    content: "微信确认交期",
    nextReminder: "2026-11-05 10:00"
  });
  assert.equal(customerSaved.response.status, 200, customerSaved.json.message);
  assert.equal(customerSaved.json.activity?.type, "wechat");
  assert.equal(customerSaved.json.customer?.nextReminder, "2026-11-05 10:00");
  const customerAudit = store.followUpAudits.find((item) => item.activityId === customerSaved.json.activity?.id);
  assert.ok(customerAudit);
  assert.equal(customerAudit.actorId, shirleyUser.id);
  assert.equal(customerAudit.objectType, "customer");
  assert.equal(customerAudit.objectId, "c1");
  assert.equal(customerAudit.action, "record_follow_up");
  assert.equal(isIso(customerAudit.at), true);

  assert.equal(store.outboundEmailLogs.length, emailsBefore);
  assert.equal(store.prospectSuppressionEvents.length, suppressBefore);
  assert.equal(store.prospectContactabilityDecisions.length, decisionsBefore);

  console.log("workbench follow-up http tests passed");
} finally {
  server.close();
}
