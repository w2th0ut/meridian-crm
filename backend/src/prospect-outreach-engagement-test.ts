import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeProspectOutreachEngagement } from "./prospect-outreach-engagement.js";

const candidate = { id: "cand_1", teamId: "team" };

const none = describeProspectOutreachEngagement({
  candidate,
  emailLogs: [{
    teamId: "team",
    entityType: "prospect_candidate",
    entityId: "cand_1",
    openCount: 0,
    clickCount: 0,
    firstOpenedAt: "",
    lastOpenedAt: "",
    lastClickedAt: ""
  }],
  touchpoints: [{
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "email",
    eventType: "send",
    occurredAt: "2026-10-01T00:00:00.000Z"
  }]
});
assert.equal(none.status, "none");
assert.equal(none.open.count, 0);
assert.equal(none.open.at, "");
assert.equal(none.click.count, 0);
assert.equal(none.click.at, "");

const sentOnly = describeProspectOutreachEngagement({
  candidate,
  emailLogs: [{
    teamId: "team",
    entityType: "prospect_candidate",
    entityId: "cand_1",
    openCount: 0,
    clickCount: 0
  }]
});
assert.equal(sentOnly.status, "none");

const opened = describeProspectOutreachEngagement({
  candidate,
  emailLogs: [{
    teamId: "team",
    entityType: "prospect_candidate",
    entityId: "cand_1",
    openCount: 2,
    clickCount: 0,
    firstOpenedAt: "2026-10-02T01:00:00.000Z",
    lastOpenedAt: "2026-10-03T08:00:00.000Z"
  }]
});
assert.equal(opened.status, "hit");
assert.equal(opened.open.count, 2);
assert.equal(opened.open.at, "2026-10-03T08:00:00.000Z");
assert.equal(opened.click.count, 0);
assert.equal(opened.click.at, "");

const clickedOnCandidate = describeProspectOutreachEngagement({
  candidate: {
    ...candidate,
    clickCount: 1,
    lastClickedAt: "2026-10-04T09:30:00.000Z"
  }
});
assert.equal(clickedOnCandidate.click.count, 1);
assert.equal(clickedOnCandidate.click.at, "2026-10-04T09:30:00.000Z");
assert.equal(clickedOnCandidate.open.count, 0);

const fullest = describeProspectOutreachEngagement({
  candidate: {
    ...candidate,
    openCount: 2,
    lastOpenedAt: "2026-10-01T00:00:00.000Z",
    clickCount: 1,
    lastClickedAt: "2026-10-02T00:00:00.000Z"
  },
  emailLogs: [
    {
      teamId: "team",
      entityType: "prospect_candidate",
      entityId: "cand_1",
      openCount: 1,
      clickCount: 0,
      lastOpenedAt: "2026-10-01T00:00:00.000Z"
    },
    {
      teamId: "team",
      entityType: "prospect_candidate",
      entityId: "cand_1",
      openCount: 3,
      clickCount: 2,
      lastOpenedAt: "2026-10-05T12:00:00.000Z",
      lastClickedAt: "2026-10-05T12:05:00.000Z"
    }
  ],
  touchpoints: [{
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "email",
    eventType: "open",
    occurredAt: "2026-10-04T00:00:00.000Z"
  }]
});
assert.equal(fullest.open.count, 4);
assert.equal(fullest.open.at, "2026-10-05T12:00:00.000Z");
assert.equal(fullest.click.count, 2);
assert.equal(fullest.click.at, "2026-10-05T12:05:00.000Z");

const firstOpenOnly = describeProspectOutreachEngagement({
  candidate,
  emailLogs: [{
    teamId: "team",
    entityType: "prospect_candidate",
    entityId: "cand_1",
    openCount: 0,
    firstOpenedAt: "2026-10-06T01:02:00.000Z",
    lastOpenedAt: ""
  }]
});
assert.equal(firstOpenOnly.open.count, 1);
assert.equal(firstOpenOnly.open.at, "2026-10-06T01:02:00.000Z");

const otherTeam = describeProspectOutreachEngagement({
  candidate,
  emailLogs: [{
    teamId: "other",
    entityType: "prospect_candidate",
    entityId: "cand_1",
    openCount: 4,
    lastOpenedAt: "2026-10-07T00:00:00.000Z"
  }],
  touchpoints: [
    {
      teamId: "team",
      prospectCandidateId: "cand_1",
      channel: "whatsapp",
      eventType: "open",
      occurredAt: "2026-10-07T01:00:00.000Z"
    },
    {
      teamId: "team",
      prospectCandidateId: "cand_1",
      channel: "email",
      eventType: "bounce",
      occurredAt: "2026-10-07T02:00:00.000Z"
    },
    {
      teamId: "team",
      prospectCandidateId: "other",
      channel: "email",
      eventType: "click",
      occurredAt: "2026-10-07T03:00:00.000Z"
    }
  ]
});
assert.equal(otherTeam.status, "none");

const bounceStillShowsOpen = describeProspectOutreachEngagement({
  candidate,
  emailLogs: [{
    teamId: "team",
    entityType: "prospect_candidate",
    entityId: "cand_1",
    openCount: 1,
    lastOpenedAt: "2026-10-08T04:00:00.000Z"
  }],
  touchpoints: [{
    teamId: "team",
    prospectCandidateId: "cand_1",
    channel: "email",
    eventType: "bounce",
    occurredAt: "2026-10-08T05:00:00.000Z"
  }]
});
assert.equal(bounceStillShowsOpen.status, "hit");
assert.equal(bounceStillShowsOpen.open.count, 1);
assert.equal(bounceStillShowsOpen.click.count, 0);

const invalidTime = describeProspectOutreachEngagement({
  candidate: {
    ...candidate,
    openCount: 2,
    lastOpenedAt: "not-a-date"
  }
});
assert.equal(invalidTime.open.count, 2);
assert.equal(invalidTime.open.at, "");

const source = readFileSync(new URL("./prospect-outreach-engagement.ts", import.meta.url), "utf8");
assert.match(source, /没有 deliveredAt/);
assert.doesNotMatch(source, /sentAt|dispatchStatus|deliveredAt\s*[:=]/);
assert.doesNotMatch(source, /convert_to_lead|approved_contactable|setProspectSuppression/);

const serverSource = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
assert.match(serverSource, /from "\.\/prospect-outreach-engagement\.js"/);
assert.match(
  serverSource,
  /outreachEngagement: describeProspectOutreachEngagement\(/,
  "搜客清单接口必须带回打开和点击"
);

console.log("prospect-outreach-engagement-test: ok");
