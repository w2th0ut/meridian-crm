import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeProspectOutreachReply } from "./prospect-outreach-reply.js";

const candidate = { id: "cand_1", teamId: "team" };

const none = describeProspectOutreachReply({
  candidate,
  emailLogs: [{
    teamId: "team",
    entityType: "prospect_candidate",
    entityId: "cand_1",
    repliedAt: ""
  }],
  touchpoints: [{
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "email",
    direction: "outbound",
    eventType: "send",
    occurredAt: "2026-10-01T00:00:00.000Z",
    content: "发出的开发信不是回复"
  }]
});
assert.equal(none.status, "none");
assert.equal(none.at, "");
assert.equal(none.excerpt, "");

const opened = describeProspectOutreachReply({
  candidate,
  touchpoints: [{
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "email",
    direction: "inbound",
    eventType: "open",
    occurredAt: "2026-10-02T00:00:00.000Z"
  }, {
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "email",
    direction: "inbound",
    eventType: "click",
    occurredAt: "2026-10-02T01:00:00.000Z"
  }]
});
assert.equal(opened.status, "none");

const bounced = describeProspectOutreachReply({
  candidate,
  emailLogs: [{
    teamId: "team",
    entityType: "prospect_candidate",
    entityId: "cand_1",
    repliedAt: ""
  }],
  touchpoints: [{
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "email",
    direction: "inbound",
    eventType: "bounce",
    replyClassification: "bounced",
    occurredAt: "2026-10-03T00:00:00.000Z",
    content: "550 user unknown"
  }, {
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "email",
    direction: "inbound",
    eventType: "reply",
    replyClassification: "bounced",
    occurredAt: "2026-10-03T01:00:00.000Z",
    content: "退信不进回复条"
  }]
});
assert.equal(bounced.status, "none");

const classificationOnly = describeProspectOutreachReply({
  candidate: { ...candidate, lastReplyClassification: "clear_demand" } as typeof candidate,
  emailLogs: [],
  touchpoints: []
});
assert.equal(classificationOnly.status, "none");

const withExcerpt = describeProspectOutreachReply({
  candidate,
  touchpoints: [{
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "email",
    direction: "inbound",
    eventType: "reply",
    replyClassification: "clear_demand",
    occurredAt: "2026-10-04T08:00:00.000Z",
    subject: "Re: lighting",
    content: "请发一份 LED 面板的样品报价"
  }]
});
assert.equal(withExcerpt.status, "hit");
assert.equal(withExcerpt.at, "2026-10-04T08:00:00.000Z");
assert.equal(withExcerpt.excerpt, "请发一份 LED 面板的样品报价");

const timeOnly = describeProspectOutreachReply({
  candidate,
  emailLogs: [{
    teamId: "team",
    entityType: "prospect_candidate",
    entityId: "cand_1",
    repliedAt: "2026-10-05T09:30:00.000Z"
  }]
});
assert.equal(timeOnly.status, "hit");
assert.equal(timeOnly.at, "2026-10-05T09:30:00.000Z");
assert.equal(timeOnly.excerpt, "");

const subjectFallback = describeProspectOutreachReply({
  candidate,
  touchpoints: [{
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "email",
    eventType: "reply",
    occurredAt: "2026-10-06T01:00:00.000Z",
    subject: "客户回信",
    content: ""
  }]
});
assert.equal(subjectFallback.excerpt, "");
assert.equal(subjectFallback.at, "2026-10-06T01:00:00.000Z");

const usefulSubject = describeProspectOutreachReply({
  candidate,
  touchpoints: [{
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "email",
    eventType: "reply",
    occurredAt: "2026-10-06T02:00:00.000Z",
    subject: "下季度要 200 套",
    content: "   "
  }]
});
assert.equal(usefulSubject.excerpt, "下季度要 200 套");

const latestWins = describeProspectOutreachReply({
  candidate,
  emailLogs: [{
    teamId: "team",
    entityType: "prospect_candidate",
    entityId: "cand_1",
    repliedAt: "2026-10-08T12:00:00.000Z"
  }],
  touchpoints: [{
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "email",
    eventType: "reply",
    occurredAt: "2026-10-07T08:00:00.000Z",
    content: "较早的一封"
  }, {
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "email",
    eventType: "reply",
    occurredAt: "2026-10-08T12:00:00.000Z",
    content: ""
  }]
});
assert.equal(latestWins.at, "2026-10-08T12:00:00.000Z");
assert.equal(latestWins.excerpt, "");

const sameTimePrefersExcerpt = describeProspectOutreachReply({
  candidate,
  emailLogs: [{
    teamId: "team",
    entityType: "prospect_candidate",
    entityId: "cand_1",
    repliedAt: "2026-10-09T03:00:00.000Z"
  }],
  touchpoints: [{
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "email",
    eventType: "reply",
    occurredAt: "2026-10-09T03:00:00.000Z",
    content: "同一时刻的正文"
  }]
});
assert.equal(sameTimePrefersExcerpt.at, "2026-10-09T03:00:00.000Z");
assert.equal(sameTimePrefersExcerpt.excerpt, "同一时刻的正文");

const clipped = describeProspectOutreachReply({
  candidate,
  touchpoints: [{
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "email",
    eventType: "reply",
    occurredAt: "2026-10-10T00:00:00.000Z",
    content: "甲".repeat(60)
  }]
});
assert.equal(clipped.excerpt, `${"甲".repeat(48)}…`);

const legacyInbound = describeProspectOutreachReply({
  candidate,
  touchpoints: [{
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "email",
    direction: "inbound",
    replyClassification: "interested_nurture",
    occurredAt: "2026-10-11T04:00:00.000Z",
    content: "先寄目录"
  }]
});
assert.equal(legacyInbound.status, "hit");
assert.equal(legacyInbound.excerpt, "先寄目录");

const unsubscribeStillReply = describeProspectOutreachReply({
  candidate,
  touchpoints: [{
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "email",
    eventType: "reply",
    replyClassification: "unsubscribed",
    occurredAt: "2026-10-12T05:00:00.000Z",
    content: "请不要再发"
  }]
});
assert.equal(unsubscribeStillReply.status, "hit");
assert.equal(unsubscribeStillReply.excerpt, "请不要再发");
assert.equal(unsubscribeStillReply.at, "2026-10-12T05:00:00.000Z");

const otherTeam = describeProspectOutreachReply({
  candidate,
  emailLogs: [{
    teamId: "other",
    entityType: "prospect_candidate",
    entityId: "cand_1",
    repliedAt: "2026-10-13T00:00:00.000Z"
  }, {
    teamId: "team",
    entityType: "lead",
    entityId: "cand_1",
    repliedAt: "2026-10-13T01:00:00.000Z"
  }],
  touchpoints: [{
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "whatsapp",
    direction: "inbound",
    eventType: "reply",
    occurredAt: "2026-10-13T02:00:00.000Z",
    content: "WhatsApp 不算开发信回复"
  }, {
    teamId: "team",
    prospectCandidateId: "other",
    channel: "email",
    eventType: "reply",
    occurredAt: "2026-10-13T03:00:00.000Z",
    content: "别人的回复"
  }]
});
assert.equal(otherTeam.status, "none");

const invalidTimeKeepsExcerpt = describeProspectOutreachReply({
  candidate,
  touchpoints: [{
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "email",
    eventType: "reply",
    occurredAt: "not-a-date",
    content: "时间坏了但仍有正文"
  }]
});
assert.equal(invalidTimeKeepsExcerpt.status, "hit");
assert.equal(invalidTimeKeepsExcerpt.at, "");
assert.equal(invalidTimeKeepsExcerpt.excerpt, "时间坏了但仍有正文");

const source = readFileSync(new URL("./prospect-outreach-reply.ts", import.meta.url), "utf8");
assert.match(source, /repliedAt/);
assert.match(source, /eventType === "reply"/);
assert.doesNotMatch(source, /convert_to_lead|approved_contactable|recordProspectTouchpoint|send-development-email/);
assert.doesNotMatch(source, /lastReplyClassification/);

const serverSource = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
assert.match(serverSource, /from "\.\/prospect-outreach-reply\.js"/);
assert.match(
  serverSource,
  /outreachReply: describeProspectOutreachReply\(/,
  "搜客清单接口必须带回开发信回复"
);

console.log("prospect-outreach-reply-test: ok");
