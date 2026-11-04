import assert from "node:assert/strict";
import { app } from "./server.js";
import { getStore } from "./store.js";
import { setOutboundNowForTests, setTenantTimezoneOverride } from "./outbound-call.js";
import type { CallbackDueQueueAudit, CallbackSchedule, CallbackScheduleAudit } from "./types.js";

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Cannot start callback schedule report test server");
const baseUrl = `http://127.0.0.1:${address.port}`;

const originalFetch = globalThis.fetch;
let aliyunHits = 0;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("aliyuncs.com")) aliyunHits += 1;
  return originalFetch(input, init);
};

async function request(path: string, token: string, method = "GET") {
  const response = await originalFetch(`${baseUrl}${path}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
  const type = response.headers.get("content-type") || "";
  if (type.includes("text/csv")) {
    const bytes = Buffer.from(await response.arrayBuffer());
    return { response, text: bytes.toString("utf8"), json: {} as Record<string, any> };
  }
  const text = await response.text();
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

function schedule(partial: Partial<CallbackSchedule> & Pick<CallbackSchedule, "id" | "targetId" | "scheduledAt">): CallbackSchedule {
  return {
    teamId: "europe",
    targetType: "customer",
    note: "",
    updatedBy: "u_sales_shirley",
    updatedAt: "2026-11-04T01:00:00.000Z",
    sourceCallRecordId: "",
    ...partial
  };
}

function audit(partial: Partial<CallbackScheduleAudit> & Pick<CallbackScheduleAudit, "id" | "action">): CallbackScheduleAudit {
  return {
    teamId: "europe",
    actorId: "u_sales_shirley",
    at: "2026-11-03T16:30:00.000Z",
    targetType: "customer",
    targetId: "c1",
    previousScheduledAt: "2026-11-03 10:00",
    nextScheduledAt: "",
    previousNote: "",
    nextNote: "",
    result: "updated",
    reason: "",
    sourceCallRecordId: "",
    ...partial
  };
}

function queue(partial: Partial<CallbackDueQueueAudit> & Pick<CallbackDueQueueAudit, "id" | "action" | "result">): CallbackDueQueueAudit {
  return {
    teamId: "europe",
    actorId: "u_manager_alex",
    at: "2026-11-03T16:30:00.000Z",
    scope: "team",
    overdueOnly: false,
    rowCount: 0,
    reason: "",
    ...partial
  };
}

try {
  const store = getStore();
  setOutboundNowForTests(new Date("2026-11-04T02:30:00.000Z"));
  setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
  const shirleyUser = store.users.find((item) => item.email === "shirley@keduoduo.com");
  const alexUser = store.users.find((item) => item.email === "alex@keduoduo.com");
  const adminUser = store.users.find((item) => item.email === "admin@keduoduo.com");
  assert.ok(shirleyUser && alexUser && adminUser);
  assert.equal(shirleyUser.role, "sales");
  assert.equal(alexUser.role, "manager");
  store.users.push({
    ...adminUser,
    id: "u_schedule_report_asia",
    name: "Asia Schedule Report",
    email: "asia-schedule-report@keduoduo.com",
    role: "admin",
    teamId: "asia",
    status: "active"
  });

  const leadsBefore = store.leads.length;
  const activitiesBefore = store.customerActivities.length;
  const suppressionBefore = JSON.stringify(store.prospectSuppressionEvents);
  const decisionsBefore = JSON.stringify(store.prospectContactabilityDecisions);
  const enabledBefore = store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true);
  const schedulesBefore = store.callbackSchedules.map((item) => ({ ...item }));
  const scheduleAuditsBefore = store.callbackScheduleAudits.length;
  const queueAuditsBefore = store.callbackDueQueueAudits.length;
  const customer = store.customers.find((item) => item.id === "c1");
  assert.ok(customer);
  const reminderBefore = customer.nextReminder;

  store.callbackSchedules.push(
    schedule({ id: "cbs_rpt_due", targetId: "c1", scheduledAt: "2026-11-04 10:00", note: "今日" }),
    schedule({ id: "cbs_rpt_over", targetId: "c5", scheduledAt: "2026-11-03 09:00", note: "逾期" }),
    schedule({ id: "cbs_rpt_later", targetType: "lead", targetId: "l1", scheduledAt: "2026-11-05 09:00", note: "未到" }),
    schedule({ id: "cbs_rpt_asia", teamId: "asia", targetId: "c_asia", scheduledAt: "2026-11-03 10:00", note: "亚洲备注不要出现" })
  );
  store.callbackScheduleAudits.push(
    audit({ id: "cba_rpt_done", action: "cancel", reason: "reached", previousNote: "=改期" }),
    audit({ id: "cba_rpt_plain", action: "cancel", at: "2026-11-03T17:00:00.000Z", targetId: "missing_rpt", previousScheduledAt: "2026-11-02 10:00" }),
    audit({ id: "cba_rpt_old", action: "cancel", at: "2026-11-02T10:00:00.000Z" }),
    audit({ id: "cba_rpt_reject", action: "cancel", result: "rejected", reason: "forbidden" }),
    audit({
      id: "cba_rpt_move",
      action: "update",
      at: "2026-11-03T18:00:00.000Z",
      previousScheduledAt: "2026-11-04 09:00",
      nextScheduledAt: "2026-11-06 11:00",
      previousNote: "旧备注",
      nextNote: "新备注"
    }),
    audit({
      id: "cba_rpt_note",
      action: "update",
      previousScheduledAt: "2026-11-04 09:00",
      nextScheduledAt: "2026-11-04 09:00",
      previousNote: "只改备注",
      nextNote: "备注新"
    }),
    audit({ id: "cba_rpt_asia", teamId: "asia", action: "cancel", previousNote: "亚洲备注不要出现", targetId: "c_asia" })
  );
  store.callbackDueQueueAudits.push(
    queue({ id: "cdqa_rpt_read", action: "read", result: "read", rowCount: 0 }),
    queue({ id: "cdqa_rpt_deny", action: "read", result: "rejected", reason: "forbidden" })
  );

  const shirley = await login("shirley@keduoduo.com");
  const alex = await login("alex@keduoduo.com");
  const admin = await login("admin@keduoduo.com");
  const asia = await login("asia-schedule-report@keduoduo.com");

  const anonymous = await request("/api/callback-schedule-report", "");
  assert.equal(anonymous.response.status, 401);
  assert.equal(store.callbackScheduleReportAudits.length, 0);

  const bad = await request("/api/callback-schedule-report?from=2026-11-05&to=2026-11-04", alex);
  assert.equal(bad.response.status, 400);
  assert.equal(bad.json.reason, "invalid_request");
  const extra = await request("/api/callback-schedule-report?agentId=none", alex);
  assert.equal(extra.response.status, 400);
  assert.equal(store.callbackScheduleReportAudits.length, 0);

  const denied = await request("/api/callback-schedule-report", shirley);
  assert.equal(denied.response.status, 403);
  assert.equal(denied.json.reason, "forbidden");
  assert.equal(denied.json.counts, undefined);
  assert.equal(denied.json.rows, undefined);
  assert.equal(denied.text.includes("Nordic"), false);
  assert.equal(denied.text.includes("=改期"), false);
  const deniedAudit = store.callbackScheduleReportAudits.find((item) => item.actorId === shirleyUser.id && item.action === "read");
  assert.ok(deniedAudit);
  assert.equal(deniedAudit.result, "rejected");
  assert.equal(deniedAudit.reason, "forbidden");
  assert.equal(deniedAudit.rowCount, 0);

  const deniedExport = await request("/api/callback-schedule-report/export", shirley);
  assert.equal(deniedExport.response.status, 403);
  assert.equal(deniedExport.response.headers.get("content-type")?.includes("text/csv"), false);
  assert.equal(deniedExport.json.rows, undefined);
  assert.equal(store.callbackScheduleReportAudits.some((item) => item.actorId === shirleyUser.id && item.action === "export" && item.result === "rejected"), true);

  const viewed = await request("/api/callback-schedule-report?from=2026-11-04&to=2026-11-04", alex);
  assert.equal(viewed.response.status, 200);
  assert.equal(viewed.json.today, "2026-11-04");
  assert.equal(viewed.json.timeZone, "Asia/Shanghai");
  assert.equal(viewed.json.counts.dueCount, 1);
  assert.equal(viewed.json.counts.overdueCount, 0);
  assert.equal(viewed.json.counts.completedCount, 2);
  assert.equal(viewed.json.counts.rescheduledCount, 1);
  assert.deepEqual(Object.keys(viewed.json.counts).sort(), ["completedCount", "dueCount", "overdueCount", "rescheduledCount"]);
  assert.equal(viewed.json.metrics.due, true);
  assert.equal("completionRate" in viewed.json, false);
  assert.equal(viewed.json.rowCount, viewed.json.rows.length);
  assert.equal(viewed.json.rows.some((row: { id: string }) => row.id === "cba_rpt_done"), true);
  assert.equal(viewed.json.rows.some((row: { id: string }) => row.id === "cba_rpt_note" || row.id === "cba_rpt_reject" || row.id === "cbs_rpt_later" || row.id === "cdqa_rpt_deny"), false);
  const missing = viewed.json.rows.find((row: { id: string }) => row.id === "cba_rpt_plain");
  assert.equal(missing.name, "");
  assert.equal(missing.previousScheduledAt, "2026-11-02 10:00");
  assert.equal(missing.nextScheduledAt, "");
  const readAudit = store.callbackScheduleReportAudits.find((item) => item.actorId === alexUser.id && item.action === "read" && item.result === "read");
  assert.ok(readAudit);
  assert.equal(readAudit.rowCount, viewed.json.rowCount);
  assert.equal(readAudit.filters.includes("=改期"), false);
  assert.equal(readAudit.filters.includes("2026-11-04"), true);

  const again = await request("/api/callback-schedule-report?from=2026-11-04&to=2026-11-04", alex);
  assert.equal(again.response.status, 200);
  assert.equal(store.callbackScheduleReportAudits.filter((item) => item.actorId === alexUser.id && item.action === "read" && item.result === "read").length, 2);

  const exported = await request("/api/callback-schedule-report/export?from=2026-11-04&to=2026-11-04", alex);
  assert.equal(exported.response.status, 200);
  assert.match(exported.response.headers.get("content-type") || "", /text\/csv/);
  assert.equal(exported.response.headers.get("cache-control"), "no-store");
  assert.equal(exported.text.startsWith("\uFEFF"), true);
  assert.match(exported.text, /'=改期/);
  assert.match(exported.text, /已完成/);
  assert.match(exported.text, /队列查看/);
  assert.equal(exported.text.includes("+49 000 000 0000"), false);
  assert.equal(exported.text.includes("亚洲备注不要出现"), false);
  assert.equal(exported.text.includes("完成率"), false);
  const exportAudit = store.callbackScheduleReportAudits.find((item) => item.actorId === alexUser.id && item.action === "export" && item.result === "exported");
  assert.ok(exportAudit);
  assert.equal(exportAudit.rowCount, viewed.json.rowCount);
  assert.equal(exportAudit.filters.includes("=改期"), false);

  const adminView = await request("/api/callback-schedule-report?from=2026-11-04&to=2026-11-04", admin);
  assert.equal(adminView.response.status, 200);
  assert.equal(adminView.json.counts.completedCount, 2);

  const open = await request("/api/callback-schedule-report", alex);
  assert.equal(open.response.status, 200);
  assert.equal(open.json.counts.dueCount, 1);
  assert.equal(open.json.counts.overdueCount, 1);
  assert.equal(open.json.counts.completedCount, 3);
  assert.equal(open.json.rows.some((row: { id: string }) => row.id === "cba_rpt_old"), true);
  assert.equal(open.json.rows.some((row: { id: string }) => row.id === "cbs_rpt_later"), false);

  const asiaView = await request("/api/callback-schedule-report", asia);
  assert.equal(asiaView.response.status, 200);
  assert.equal(asiaView.json.rows.some((row: { id: string }) => row.id === "cbs_rpt_asia" || row.id === "cba_rpt_asia"), true);
  assert.equal(JSON.stringify(asiaView.json).includes("=改期"), false);
  assert.equal(JSON.stringify(asiaView.json).includes("Nordic"), false);
  assert.equal(JSON.stringify(viewed.json).includes("亚洲备注不要出现"), false);

  setTenantTimezoneOverride(store, "europe", "America/New_York");
  const shifted = await request("/api/callback-schedule-report", alex);
  assert.equal(shifted.response.status, 200);
  assert.equal(shifted.json.today, "2026-11-03");
  assert.equal(shifted.json.counts.dueCount, 1);
  assert.equal(shifted.json.rows.find((row: { kind: string }) => row.kind === "due")?.id, "cbs_rpt_over");
  assert.equal(shifted.json.rows.some((row: { id: string }) => row.id === "cbs_rpt_due"), false);

  assert.equal(aliyunHits, 0);
  assert.equal(store.leads.length, leadsBefore);
  assert.equal(store.customerActivities.length, activitiesBefore);
  assert.equal(JSON.stringify(store.prospectSuppressionEvents), suppressionBefore);
  assert.equal(JSON.stringify(store.prospectContactabilityDecisions), decisionsBefore);
  assert.equal(store.aliyunOutboundConfigs.some((item) => item.aliyunOutboundEnabled === true), enabledBefore);
  assert.equal(customer.nextReminder, reminderBefore);
  assert.equal(store.callbackScheduleAudits.length, scheduleAuditsBefore + 7);
  assert.equal(store.callbackDueQueueAudits.length, queueAuditsBefore + 2);
  assert.equal(store.callbackSchedules.filter((item) => !item.id.startsWith("cbs_rpt_")).length, schedulesBefore.length);
  for (const before of schedulesBefore) {
    const current = store.callbackSchedules.find((item) => item.id === before.id);
    assert.equal(current?.scheduledAt, before.scheduledAt);
    assert.equal(current?.note, before.note);
  }
  const auditText = JSON.stringify(store.callbackScheduleReportAudits);
  assert.equal(auditText.includes("=改期"), false);
  assert.equal(auditText.includes("亚洲备注不要出现"), false);
  assert.equal(auditText.includes("AccessKey"), false);
  assert.equal(auditText.includes("+49 000 000 0000"), false);

  console.log("callback schedule report http tests passed");
} finally {
  const store = getStore();
  store.callbackSchedules = store.callbackSchedules.filter((item) => !item.id.startsWith("cbs_rpt_"));
  store.callbackScheduleAudits = store.callbackScheduleAudits.filter((item) => !item.id.startsWith("cba_rpt_"));
  store.callbackDueQueueAudits = store.callbackDueQueueAudits.filter((item) => !item.id.startsWith("cdqa_rpt_"));
  store.callbackScheduleReportAudits = store.callbackScheduleReportAudits.filter((item) => item.teamId !== "europe" && item.teamId !== "asia");
  store.users = store.users.filter((item) => item.id !== "u_schedule_report_asia");
  setTenantTimezoneOverride(store, "europe", undefined);
  setOutboundNowForTests(undefined);
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
