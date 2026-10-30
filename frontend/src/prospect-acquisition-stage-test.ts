import assert from "node:assert/strict";
import {
  ACQUISITION_STAGE_FILTERS,
  deriveAcquisitionStage,
  type AcquisitionStageInput
} from "./prospect-acquisition-stage.js";

function input(patch: Partial<AcquisitionStageInput> = {}): AcquisitionStageInput {
  return {
    status: "preview",
    createdAt: "2026-10-01T01:00:00.000Z",
    shortlistedAt: "2026-10-02T01:00:00.000Z",
    ...patch
  };
}

const pending = deriveAcquisitionStage(input());
assert.equal(pending.key, "pending_touch");
assert.equal(pending.filter, "pending");
assert.equal(pending.label, "待触达");
assert.equal(pending.enteredLabel, "加入搜客清单");
assert.match(pending.summary, /还没有发出开发信/);

const notOnList = deriveAcquisitionStage(input({ shortlistedAt: "" }));
assert.match(notOnList.summary, /还没加入搜客清单/);

const readyToWrite = deriveAcquisitionStage(input({
  status: "contactable",
  hasSendableEmail: true
}));
assert.equal(readyToWrite.key, "ready_to_write");
assert.equal(readyToWrite.filter, "pending");
assert.equal(readyToWrite.label, "待写开发信");
assert.match(readyToWrite.summary, /草稿不落库/);

const contactableWithoutEmail = deriveAcquisitionStage(input({
  status: "contactable",
  hasSendableEmail: false
}));
assert.equal(contactableWithoutEmail.label, "待触达");
assert.equal(contactableWithoutEmail.filter, "pending");

const reachedBySend = deriveAcquisitionStage(input({
  status: "contacted",
  lastDevelopmentEmailAt: "2026-10-03T02:00:00.000Z",
  nextFollowAt: "2026-10-06 09:00",
  outreachState: "awaiting_reply"
}));
assert.equal(reachedBySend.key, "reached_unapproved");
assert.equal(reachedBySend.filter, "reached");
assert.equal(reachedBySend.label, "已触达待批准");
assert.equal(reachedBySend.enteredLabel, "发出开发信");
assert.match(reachedBySend.summary, /不会自动批准/);

const replied = deriveAcquisitionStage(input({
  status: "contacted",
  outreachState: "replied",
  lastTouchpointAt: "2026-10-04T02:00:00.000Z"
}));
assert.equal(replied.filter, "reached");
assert.match(replied.summary, /已经有回复/);
assert.equal(replied.enteredLabel, "最近触达");

const approved = deriveAcquisitionStage(input({
  status: "contactable",
  hasSendableEmail: true,
  approvedContactable: true
}));
assert.equal(approved.key, "contactable");
assert.equal(approved.filter, "contactable");
assert.equal(approved.label, "可联系");
assert.match(approved.summary, /仍要再确认/);
assert.equal(approved.enteredAt, "");

const approvedThenSent = deriveAcquisitionStage(input({
  status: "contacted",
  lastDevelopmentEmailAt: "2026-10-03T02:00:00.000Z",
  approvedContactable: true
}));
assert.equal(approvedThenSent.label, "可联系");

const followingByNote = deriveAcquisitionStage(input({
  status: "contacted",
  approvedContactable: true,
  nextFollowAt: "2026-10-06 09:00",
  latestFollowUpAt: "2026-10-05T08:00:00.000Z"
}));
assert.equal(followingByNote.key, "following");
assert.equal(followingByNote.filter, "following");
assert.equal(followingByNote.label, "跟进中");
assert.equal(followingByNote.enteredLabel, "最近跟进");
assert.match(followingByNote.summary, /不会自动推进/);
assert.match(followingByNote.summary, /也不会发送/);

const followingBySchedule = deriveAcquisitionStage(input({
  status: "contactable",
  nextFollowAt: "2026-10-08 15:30"
}));
assert.equal(followingBySchedule.label, "跟进中");
assert.equal(followingBySchedule.enteredKind, "follow");
assert.equal(followingBySchedule.enteredLabel, "下次跟进");

const approvedWithSchedule = deriveAcquisitionStage(input({
  status: "contacted",
  approvedContactable: true,
  nextFollowAt: "2026-10-06 09:00",
  lastDevelopmentEmailAt: "2026-10-03T02:00:00.000Z"
}));
assert.equal(approvedWithSchedule.filter, "following");

const noteBeforeApproval = deriveAcquisitionStage(input({
  status: "contacted",
  latestFollowUpAt: "2026-10-05T08:00:00.000Z",
  lastDevelopmentEmailAt: "2026-10-03T02:00:00.000Z"
}));
assert.equal(noteBeforeApproval.filter, "following");

const converted = deriveAcquisitionStage(input({
  status: "synced",
  leadId: "lead-1",
  latestFollowUpAt: "2026-10-05T08:00:00.000Z",
  statusChangedAt: "2026-10-06T00:00:00.000Z"
}));
assert.equal(converted.key, "converted");
assert.equal(converted.filter, "converted");
assert.equal(converted.label, "已转线索");
assert.equal(converted.enteredLabel, "状态变更");
assert.match(converted.summary, /不能再转一次/);

const alreadyLead = deriveAcquisitionStage(input({
  status: "contactable",
  alreadyLead: true
}));
assert.equal(alreadyLead.filter, "converted");

const optedOut = deriveAcquisitionStage(input({
  status: "excluded",
  leadId: "lead-2",
  outreachState: "suppressed",
  complianceNotices: [{ kind: "opted_out", label: "已退订" }]
}));
assert.equal(optedOut.key, "held");
assert.equal(optedOut.filter, "held");
assert.equal(optedOut.label, "已退订");
assert.equal(optedOut.holdFocusable, true);
assert.match(optedOut.summary, /查看抑制原因/);
assert.match(optedOut.summary, /已经转入线索/);
assert.match(optedOut.summary, /不能解除/);

const suppressedOnly = deriveAcquisitionStage(input({
  status: "contactable",
  outreachState: "suppressed"
}));
assert.equal(suppressedOnly.label, "已抑制");
assert.equal(suppressedOnly.holdFocusable, false);
assert.match(suppressedOnly.summary, /原因未回传/);

const invalid = deriveAcquisitionStage(input({
  outreachState: "contact_invalid"
}));
assert.equal(invalid.label, "联系方式无效");
assert.equal(invalid.filter, "held");

const bounced = deriveAcquisitionStage(input({
  lastReplyClassification: "bounced",
  complianceNotices: [{ kind: "bounced", label: "已退信" }, { kind: "invalid", label: "联系方式无效" }]
}));
assert.equal(bounced.label, "已退信");

const unsubscribedReply = deriveAcquisitionStage(input({
  lastReplyClassification: "unsubscribed",
  outreachState: "suppressed"
}));
assert.equal(unsubscribedReply.label, "已退订");

const excluded = deriveAcquisitionStage(input({
  status: "excluded",
  statusChangedAt: "2026-10-07T00:00:00.000Z"
}));
assert.equal(excluded.key, "excluded");
assert.equal(excluded.filter, "excluded");
assert.equal(excluded.label, "已排除");
assert.match(excluded.summary, /不是抑制或退订/);

const frozen = Object.freeze(input({ status: "preview" }));
deriveAcquisitionStage(frozen);
assert.equal(frozen.status, "preview");

assert.deepEqual(
  ACQUISITION_STAGE_FILTERS.map((item) => item.key),
  ["pending", "reached", "contactable", "following", "converted", "held", "excluded"]
);

console.log("prospect-acquisition-stage-test ok");
