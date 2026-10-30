import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeProspectOutreachFailure } from "./prospect-outreach-failure.js";

const candidate = { id: "cand_1", teamId: "team" };

const none = describeProspectOutreachFailure({
  candidate,
  emailLogs: [{
    teamId: "team",
    entityType: "prospect_candidate",
    entityId: "cand_1",
    dispatchStatus: "sent",
    sentAt: "2026-10-01T00:00:00.000Z",
    subject: "Hello"
  }],
  touchpoints: [{
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "email",
    eventType: "send",
    occurredAt: "2026-10-01T00:00:00.000Z",
    subject: "Hello",
    content: "body"
  }]
});
assert.equal(none.status, "none");
assert.equal(none.label, "无失败记录");
assert.equal(none.reason, "");
assert.equal(none.at, "");

const sendFailed = describeProspectOutreachFailure({
  candidate,
  emailLogs: [{
    teamId: "team",
    entityType: "prospect_candidate",
    entityId: "cand_1",
    dispatchStatus: "uncertain",
    dispatchError: "SMTP连接失败：请检查服务器、端口和加密方式。",
    sentAt: "2026-10-02T03:04:00.000Z"
  }]
});
assert.equal(sendFailed.status, "hit");
assert.equal(sendFailed.kind, "send_failed");
assert.equal(sendFailed.label, "发送失败");
assert.match(sendFailed.reason, /SMTP连接失败/);
assert.equal(sendFailed.at, "2026-10-02T03:04:00.000Z");

const missingSendReason = describeProspectOutreachFailure({
  candidate,
  emailLogs: [{
    teamId: "team",
    entityType: "prospect_candidate",
    entityId: "cand_1",
    dispatchStatus: "uncertain",
    dispatchError: "   ",
    sentAt: "2026-10-02T03:04:00.000Z"
  }]
});
assert.equal(missingSendReason.reason, "发送失败说明未写入");
assert.doesNotMatch(missingSendReason.reason, /原因未回传/);

const bounceWins = describeProspectOutreachFailure({
  candidate,
  emailLogs: [
    {
      teamId: "team",
      entityType: "prospect_candidate",
      entityId: "cand_1",
      dispatchStatus: "uncertain",
      dispatchError: "更早的发送失败",
      sentAt: "2026-10-01T00:00:00.000Z",
      bouncedAt: "2026-10-03T08:00:00.000Z"
    }
  ],
  touchpoints: [{
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "email",
    eventType: "bounce",
    replyClassification: "bounced",
    subject: "退信通知",
    content: "550 user unknown",
    occurredAt: "2026-10-03T08:00:00.000Z"
  }]
});
assert.equal(bounceWins.kind, "bounced");
assert.equal(bounceWins.label, "开发信退信");
assert.equal(bounceWins.reason, "550 user unknown");
assert.equal(bounceWins.at, "2026-10-03T08:00:00.000Z");
assert.notEqual(bounceWins.label, "已退信");

const otherTeam = describeProspectOutreachFailure({
  candidate,
  emailLogs: [{
    teamId: "other",
    entityType: "prospect_candidate",
    entityId: "cand_1",
    dispatchStatus: "uncertain",
    dispatchError: "别人的失败",
    sentAt: "2026-10-04T00:00:00.000Z"
  }],
  touchpoints: [{
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "whatsapp",
    eventType: "bounce",
    content: "WhatsApp 退回",
    occurredAt: "2026-10-04T01:00:00.000Z"
  }]
});
assert.equal(otherTeam.status, "none");

const batchFailed = describeProspectOutreachFailure({
  candidate,
  batches: [{
    teamId: "team",
    updatedAt: "2026-10-05T02:00:00.000Z",
    items: [{
      candidateId: "cand_1",
      steps: [
        { status: "skipped", error: "", sentAt: "", scheduledAt: "2026-10-05T01:00:00.000Z" },
        { status: "failed", error: "发信保护：今天已达到上限", sentAt: "", scheduledAt: "2026-10-05T02:00:00.000Z" }
      ]
    }]
  }]
});
assert.equal(batchFailed.kind, "send_failed");
assert.equal(batchFailed.reason, "发信保护：今天已达到上限");
assert.equal(batchFailed.at, "2026-10-05T02:00:00.000Z");

const laterPlan = describeProspectOutreachFailure({
  candidate,
  emailLogs: [{
    teamId: "team",
    entityType: "prospect_candidate",
    entityId: "cand_1",
    dispatchStatus: "sent",
    bouncedAt: "2026-10-01T00:00:00.000Z",
    sentAt: "2026-09-30T00:00:00.000Z"
  }],
  plans: [{
    teamId: "team",
    updatedAt: "2026-10-06T00:00:00.000Z",
    items: [{
      candidateId: "cand_1",
      steps: [{ status: "failed", error: "邮件发送失败：超时", sentAt: "2026-10-06T00:00:00.000Z", scheduledAt: "" }]
    }]
  }]
});
assert.equal(laterPlan.kind, "send_failed");
assert.equal(laterPlan.at, "2026-10-06T00:00:00.000Z");
assert.match(laterPlan.reason, /超时/);

const pendingIgnored = describeProspectOutreachFailure({
  candidate,
  emailLogs: [{
    teamId: "team",
    entityType: "prospect_candidate",
    entityId: "cand_1",
    dispatchStatus: "pending",
    dispatchError: "",
    sentAt: "2026-10-07T00:00:00.000Z"
  }]
});
assert.equal(pendingIgnored.status, "none");

const serverSource = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
assert.match(serverSource, /from "\.\/prospect-outreach-failure\.js"/);
assert.match(
  serverSource,
  /outreachFailure: describeProspectOutreachFailure\(/,
  "搜客清单接口必须带回最近一次开发信失败或退信"
);
assert.doesNotMatch(
  readFileSync(new URL("./prospect-outreach-failure.ts", import.meta.url), "utf8"),
  /convert_to_lead|approved_contactable|setProspectSuppression/
);

console.log("prospect-outreach-failure-test: ok");
