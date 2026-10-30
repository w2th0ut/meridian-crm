import assert from "node:assert/strict";
import {
  crmCollisionDisplayName,
  crmCollisionLinkLabel,
  crmCollisionMatchesFilter,
  crmCollisionSummary,
  emptyCrmCollision,
  parseCrmCollision,
  presentCrmCollision
} from "./prospect-crm-collision.js";

const none = emptyCrmCollision();
assert.equal(none.label, "未撞库");
assert.equal(none.status, "none");
assert.match(crmCollisionSummary(none), /不是正式企业覆盖池/);
assert.match(crmCollisionSummary(none), /不会自动合并或改归属/);
assert.doesNotMatch(crmCollisionSummary(none), /未进正式企业覆盖池/);
assert.equal(crmCollisionMatchesFilter(none, "clear"), true);
assert.equal(crmCollisionMatchesFilter(none, "hit"), false);
assert.equal(crmCollisionDisplayName(none), "");
assert.equal(crmCollisionLinkLabel(none), "");

assert.equal(parseCrmCollision(null), null);
assert.equal(parseCrmCollision({ status: "pooled" }), null);
assert.equal(parseCrmCollision({ status: "none", name: "Secret" })?.name, "");

const leaked = parseCrmCollision({
  status: "customer",
  label: "已有客户",
  reason: "官网域名已在客户库",
  recordId: "customer_hidden",
  name: "Secret Pump GmbH",
  at: "2026-10-01T00:00:00.000Z",
  linkable: false
});
assert.equal(leaked?.linkable, false);
assert.equal(leaked?.name, "");
assert.equal(leaked?.recordId, "");
assert.equal(leaked?.at, "");
assert.equal(leaked?.label, "已有客户");
assert.match(crmCollisionSummary(leaked!), /名称不展示/);
assert.match(crmCollisionSummary(leaked!), /不会自动合并，也不会改归属/);
assert.doesNotMatch(crmCollisionSummary(leaked!), /Secret Pump/);
assert.equal(crmCollisionLinkLabel(leaked!), "");

const remote = {
  status: "customer",
  label: "已有客户",
  reason: "官网域名已在客户库",
  recordId: "customer_pump",
  name: "Existing Pump GmbH",
  at: "2026-08-01T00:00:00.000Z",
  linkable: true
};
const shown = presentCrmCollision(remote, { customer: null, lead: null });
assert.equal(shown.status, "customer");
assert.equal(shown.name, "Existing Pump GmbH");
assert.equal(shown.linkable, true);
assert.equal(crmCollisionDisplayName(shown), "Existing Pump GmbH");
assert.equal(crmCollisionLinkLabel(shown), "查看已有客户");
assert.match(crmCollisionSummary(shown, "2026-08-01 08:00"), /关键时间 2026-08-01 08:00/);
assert.match(crmCollisionSummary(shown, "2026-08-01 08:00"), /可以打开现有详情/);
assert.equal(crmCollisionMatchesFilter(shown, "hit"), true);
assert.equal(crmCollisionMatchesFilter(shown, "all"), true);

const directLead = presentCrmCollision(
  { status: "none" },
  { customer: null, lead: { id: "lead_1", name: "Visible Lead Co", at: "2026-10-02T00:00:00.000Z" } }
);
assert.equal(directLead.status, "lead");
assert.equal(directLead.label, "已有线索");
assert.equal(directLead.reason, "已关联线索");
assert.equal(directLead.name, "Visible Lead Co");
assert.equal(crmCollisionLinkLabel(directLead), "查看已有线索");

const customerBeatsLead = presentCrmCollision(remote, {
  customer: null,
  lead: { id: "lead_1", name: "Visible Lead Co", at: "" }
});
assert.equal(customerBeatsLead.status, "customer");
assert.equal(customerBeatsLead.recordId, "customer_pump");

const directCustomer = presentCrmCollision(
  { status: "lead", recordId: "lead_1", name: "Other", linkable: true, reason: "官网域名已在线索库" },
  { customer: { id: "customer_direct", name: "Kept Customer", at: "2026-07-01T00:00:00.000Z" }, lead: null }
);
assert.equal(directCustomer.status, "customer");
assert.equal(directCustomer.reason, "已关联客户");
assert.equal(directCustomer.name, "Kept Customer");
assert.equal(directCustomer.linkable, true);

const sameCustomerReason = presentCrmCollision(remote, {
  customer: { id: "customer_pump", name: "Existing Pump GmbH", at: "2026-10-20T03:04:00.000Z" },
  lead: null
});
assert.equal(sameCustomerReason.reason, "官网域名已在客户库");
assert.equal(sameCustomerReason.at, "2026-10-20T03:04:00.000Z");

console.log("prospect-crm-collision-test: ok");
