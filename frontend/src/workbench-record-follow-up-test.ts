import assert from "node:assert/strict";
import {
  buildWorkbenchFollowUpBody,
  CUSTOMER_FOLLOW_UP_TYPES,
  followUpTypesFor,
  PROSPECT_FOLLOW_UP_TYPES,
  prospectReadoutsAfterFollowUp,
  showCustomerRecordEntry,
  showProspectRecordEntry
} from "./workbench-record-follow-up.js";

const empty = buildWorkbenchFollowUpBody({
  subject: "prospect",
  content: "   ",
  type: "note",
  nextFollowAt: ""
});
assert.equal(empty.ok, false);
if (!empty.ok) assert.equal(empty.message, "请填写跟进内容");

const prospectBody = buildWorkbenchFollowUpBody({
  subject: "prospect",
  content: " 已电话确认样品 ",
  type: "call",
  nextFollowAt: "2026-11-04T15:30"
});
assert.equal(prospectBody.ok, true);
if (prospectBody.ok) {
  assert.deepEqual(prospectBody.body, {
    type: "call",
    content: "已电话确认样品",
    nextFollowAt: "2026-11-04T15:30"
  });
}

const customerBody = buildWorkbenchFollowUpBody({
  subject: "customer",
  content: "微信确认交期",
  type: "wechat",
  nextFollowAt: ""
});
assert.equal(customerBody.ok, true);
if (customerBody.ok) {
  assert.equal(customerBody.body.nextReminder, undefined);
  assert.equal(customerBody.body.type, "wechat");
}

const badType = buildWorkbenchFollowUpBody({
  subject: "customer",
  content: "不该用领英",
  type: "linkedin",
  nextFollowAt: ""
});
assert.equal(badType.ok, false);

assert.ok(PROSPECT_FOLLOW_UP_TYPES.includes("note"));
assert.equal(PROSPECT_FOLLOW_UP_TYPES.includes("stage" as never), false);
assert.equal(PROSPECT_FOLLOW_UP_TYPES.includes("system" as never), false);
assert.deepEqual([...followUpTypesFor("customer")], [...CUSTOMER_FOLLOW_UP_TYPES]);
assert.equal(followUpTypesFor("prospect").includes("linkedin"), true);

assert.equal(showProspectRecordEntry({
  userId: "owner-a",
  ownerId: "owner-a",
  status: "contactable"
}), true);
assert.equal(showProspectRecordEntry({
  userId: "manager",
  ownerId: "owner-a",
  status: "contactable"
}), false);
assert.equal(showProspectRecordEntry({
  userId: "owner-a",
  ownerId: "owner-a",
  status: "preview"
}), false);
assert.equal(showProspectRecordEntry({
  userId: "owner-a",
  ownerId: "owner-a",
  status: "preview",
  contactableApproved: true
}), true);
assert.equal(showProspectRecordEntry({
  userId: "owner-a",
  ownerId: "owner-a",
  status: "excluded",
  contactableApproved: true
}), false);

assert.equal(showCustomerRecordEntry({
  userId: "sales",
  ownerId: "sales",
  teamId: "europe",
  userTeamId: "europe",
  userRole: "sales",
  inOwnedList: true
}), true);
assert.equal(showCustomerRecordEntry({
  userId: "sales",
  ownerId: "other",
  teamId: "europe",
  userTeamId: "europe",
  userRole: "sales",
  inOwnedList: false
}), false);
assert.equal(showCustomerRecordEntry({
  userId: "manager",
  ownerId: "sales",
  teamId: "europe",
  userTeamId: "europe",
  userRole: "manager",
  inOwnedList: true
}), true);

const now = new Date(2026, 9, 31, 12, 0, 0);
const before = prospectReadoutsAfterFollowUp({
  latestFollowUpAt: "",
  nextFollowAt: ""
}, now);
assert.equal(before.gap.kind, "none");
assert.equal(before.next.kind, "empty");

const after = prospectReadoutsAfterFollowUp({
  latestFollowUpAt: new Date(2026, 9, 30, 12, 0, 0).toISOString(),
  nextFollowAt: "2026-11-04 15:30"
}, now);
assert.equal(after.gap.kind, "recent");
assert.equal(after.next.kind, "upcoming");

const stale = prospectReadoutsAfterFollowUp({
  latestFollowUpAt: new Date(2026, 9, 1, 12, 0, 0).toISOString(),
  nextFollowAt: "2026-10-01 09:00"
}, now);
assert.equal(stale.gap.kind, "gap");
assert.equal(stale.next.kind, "overdue");

console.log("workbench record follow-up frontend tests passed");
