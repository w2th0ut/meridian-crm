import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildOutboundCallBody,
  createOutboundCallInFlight,
  customerOutboundTarget,
  leadOutboundTarget,
  outboundCallFeedback,
  OUTBOUND_CALL_REASON_TEXT,
  prospectOutboundTargets,
  runConfirmedOutboundCall,
  showOutboundCallButton,
  type OutboundCallTarget
} from "./outbound-call.js";

const phone = "+46111222333";
const customer = customerOutboundTarget("c1", `  ${phone}  `);
assert.ok(customer);
assert.equal(customer.phoneId, "customer-phone:c1");
assert.equal(customer.phone, phone);
assert.equal(customerOutboundTarget("c1", "  "), null);
assert.equal(leadOutboundTarget("l1", phone)?.phoneId, "lead-phone:l1");
assert.equal(leadOutboundTarget("l1", ""), null);

const channels = prospectOutboundTargets("cand-1", [
  { id: "ch-mail", channelType: "email", value: "a@example.com" },
  { id: "ch-wa", channelType: "whatsapp", value: "+460000" },
  { id: "ch-phone", channelType: "phone", value: "  +46555000111 " },
  { id: "ch-empty", channelType: "phone", value: "   " },
  { id: "ch-phone-2", channelType: "phone", value: "+46555000222" }
]);
assert.equal(channels.length, 2);
assert.deepEqual(channels.map((item) => item.phoneId), ["ch-phone", "ch-phone-2"]);
assert.equal(channels[0].targetType, "prospect");
assert.equal(channels[0].targetId, "cand-1");
assert.equal(prospectOutboundTargets("", [{ id: "ch", channelType: "phone", value: "10086" }]).length, 0);

assert.equal(showOutboundCallButton({ enabled: false, permitted: true, phone }), false);
assert.equal(showOutboundCallButton({ enabled: true, permitted: false, phone }), false);
assert.equal(showOutboundCallButton({ enabled: true, permitted: true, phone: "   " }), false);
assert.equal(showOutboundCallButton({ enabled: false, permitted: false, phone }), false);
assert.equal(showOutboundCallButton({ enabled: true, permitted: true, phone }), true);

const body = buildOutboundCallBody(customer);
assert.deepEqual(body, { targetType: "customer", targetId: "c1", phoneId: "customer-phone:c1" });
assert.equal("phone" in body, false);
assert.equal("callee" in body, false);
assert.equal("targets" in body, false);
assert.equal("calls" in body, false);
assert.equal("phoneIds" in body, false);
assert.equal(JSON.stringify(body).includes(phone), false);

assert.equal(outboundCallFeedback({ result: "allowed", jobId: "job-1" }).tone, "ok");
assert.match(outboundCallFeedback({ result: "allowed", jobId: "job-1" }).message, /外呼已受理/);
assert.match(outboundCallFeedback({ result: "allowed", jobId: "job-1" }).message, /job-1/);
assert.equal(outboundCallFeedback({ result: "allowed" }).message, "外呼已受理");

for (const [reason, text] of Object.entries(OUTBOUND_CALL_REASON_TEXT)) {
  const fallback = outboundCallFeedback({ result: "rejected", reason, message: "" });
  assert.equal(fallback.tone, "error");
  assert.equal(fallback.message, text);
  const server = outboundCallFeedback({ result: "rejected", reason, message: `${text}（服务端）` });
  assert.equal(server.message, `${text}（服务端）`);
}
assert.equal(outboundCallFeedback({ result: "rejected", reason: "unknown" }).message, "外呼没有发出");
assert.equal(outboundCallFeedback({ message: "号码在抑制或退订名单中" }).message, "号码在抑制或退订名单中");

const target: OutboundCallTarget = customer;
let posts = 0;
const cancelled = await runConfirmedOutboundCall({
  target,
  gate: createOutboundCallInFlight(),
  confirm: async () => false,
  post: async () => {
    posts += 1;
    return { result: "allowed", jobId: "job-should-not" };
  }
});
assert.equal(cancelled.cancelled, true);
assert.equal(cancelled.sent, false);
assert.equal(cancelled.feedback, null);
assert.equal(posts, 0);

const allowed = await runConfirmedOutboundCall({
  target,
  gate: createOutboundCallInFlight(),
  confirm: async () => true,
  post: async (payload) => {
    posts += 1;
    assert.deepEqual(payload, body);
    return { result: "allowed", jobId: "job-ok" };
  }
});
assert.equal(allowed.sent, true);
assert.equal(allowed.feedback?.tone, "ok");
assert.match(allowed.feedback?.message || "", /job-ok/);
assert.equal(posts, 1);

for (const reason of ["disabled", "forbidden", "suppressed", "not_contactable", "config_incomplete"] as const) {
  const rejected = await runConfirmedOutboundCall({
    target,
    gate: createOutboundCallInFlight(),
    confirm: async () => true,
    post: async () => {
      throw new Error(OUTBOUND_CALL_REASON_TEXT[reason]);
    }
  });
  assert.equal(rejected.sent, true);
  assert.equal(rejected.feedback?.tone, "error");
  assert.equal(rejected.feedback?.message, OUTBOUND_CALL_REASON_TEXT[reason]);
}

const gate = createOutboundCallInFlight();
let releaseConfirm: (value: boolean) => void = () => {};
const holding = runConfirmedOutboundCall({
  target,
  gate,
  confirm: () => new Promise<boolean>((resolve) => {
    releaseConfirm = resolve;
  }),
  post: async () => {
    posts += 1;
    return { result: "allowed", jobId: "job-once" };
  }
});
const second = await runConfirmedOutboundCall({
  target,
  gate,
  confirm: async () => true,
  post: async () => {
    posts += 1;
    return { result: "allowed", jobId: "job-twice" };
  }
});
assert.equal(second.busy, true);
assert.equal(second.sent, false);
assert.equal(second.cancelled, false);
releaseConfirm(true);
const first = await holding;
assert.equal(first.sent, true);
assert.match(first.feedback?.message || "", /job-once/);
assert.equal(posts, 2);

const after = await runConfirmedOutboundCall({
  target,
  gate,
  confirm: async () => false,
  post: async () => {
    posts += 1;
    return { result: "allowed" };
  }
});
assert.equal(after.cancelled, true);
assert.equal(posts, 2);

const phases: string[] = [];
await runConfirmedOutboundCall({
  target,
  gate: createOutboundCallInFlight(),
  confirm: async () => true,
  onPending: (phase) => phases.push(phase),
  post: async () => ({ result: "allowed", jobId: "job-phase" })
});
assert.deepEqual(phases, ["confirm", "request", "idle"]);

const page = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(page, /loadOutboundCallAvailability|\/api\/outbound-calls\/availability/);
assert.match(page, /customerOutboundTarget/);
assert.match(page, /leadOutboundTarget/);
assert.match(page, /prospectOutboundTargets/);
assert.match(page, /runConfirmedOutboundCall/);
assert.match(page, /renderCustomerDetailPage/);
assert.match(page, /renderLeadDrawer/);
assert.match(page, /renderProspectDetail/);
assert.match(page, /renderProspectOutboundCalls/);
assert.doesNotMatch(page, /批量外呼|全部外呼|定时外呼|自动外呼/);
assert.doesNotMatch(page, /AssignJobs|CreateCampaign|CreateJobGroup|g\.alicdn\.com/);

const headStart = page.indexOf("lead-drawer-head-actions");
assert.ok(headStart > 0);
assert.doesNotMatch(page.slice(headStart, headStart + 700), /outbound-call|外呼/);
const customerActions = page.indexOf("customer-page-actions");
assert.ok(customerActions > 0);
assert.doesNotMatch(page.slice(customerActions, customerActions + 500), /outbound-call|外呼/);
const prospectActions = page.indexOf('class="prospect-action-row"');
assert.ok(prospectActions > 0);
assert.doesNotMatch(page.slice(prospectActions, prospectActions + 900), /outbound-call|renderProspectOutboundCalls/);
const saveAt = page.indexOf('id="prospectSaveButton"');
const saveRow = page.lastIndexOf('class="prospect-action-row"', saveAt);
assert.ok(saveRow > 0 && saveAt - saveRow < 500);
assert.doesNotMatch(page.slice(saveRow, saveAt + 400), /outbound-call|renderProspectOutboundCalls/);

assert.match(style, /\.outbound-call-button/);
assert.match(style, /\.outbound-call-line/);
assert.doesNotMatch(style.slice(style.indexOf(".outbound-call-button"), style.indexOf(".outbound-call-button") + 400), /position:\s*(absolute|fixed)/);

const serverHint = readFileSync(new URL("../../backend/src/outbound-call.ts", import.meta.url), "utf8");
assert.match(serverHint, /export function readOutboundCallAvailability/);
assert.doesNotMatch(
  serverHint.slice(serverHint.indexOf("export function readOutboundCallAvailability"), serverHint.indexOf("export async function requestOutboundCall")),
  /makeCall|writeAudit/
);

console.log("outbound call frontend tests passed");
