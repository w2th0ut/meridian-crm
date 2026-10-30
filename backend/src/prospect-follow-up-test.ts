import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyProspectNextFollow,
  describeProspectLatestFollowUp,
  hasCurrentApprovedContactable,
  linkProspectFollowUpNotes,
  listProspectFollowUps,
  normalizeProspectNextFollowAt,
  ProspectFollowUpError,
  recordProspectFollowUp,
  setProspectNextFollowAt
} from "./prospect-follow-up.js";
import type {
  Lead,
  LeadActivity,
  ProspectContactabilityDecision,
  WebsiteOpportunity
} from "./types.js";

const at = (day: number, hour = 9) => new Date(Date.UTC(2026, 6, day, hour)).toISOString();

function candidate(patch: Partial<WebsiteOpportunity> = {}): WebsiteOpportunity {
  return {
    id: "candidate-1",
    company: "Follow GmbH",
    business: "Components",
    country: "DE",
    website: "https://follow.example.test",
    contact: "Buyer",
    contactInfo: "buyer@follow.example.test",
    description: "",
    ownerId: "owner-a",
    teamId: "team-a",
    status: "contactable",
    createdAt: at(1),
    tenantProspectId: "prospect-1",
    outreachState: "uncontacted",
    ...patch
  };
}

function decision(patch: Partial<ProspectContactabilityDecision> = {}): ProspectContactabilityDecision {
  return {
    id: "decision-1",
    teamId: "team-a",
    ownerId: "owner-a",
    prospectId: "prospect-1",
    organizationId: "org-1",
    campaignId: "campaign-1",
    campaignVersion: 1,
    channelId: "channel-1",
    status: "approved_contactable",
    reasonCodes: [],
    dependencyHash: "",
    approvedBy: "owner-a",
    approvedAt: at(2),
    previousDecisionId: "",
    contractVersion: "v1",
    idempotencyKeyHash: "k",
    requestHash: "r",
    recordHash: "h",
    createdAt: at(2),
    ...patch
  };
}

function lead(patch: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    company: "Follow GmbH",
    contact: "Buyer",
    country: "DE",
    email: "",
    phone: "",
    wechat: "",
    source: "搜客清单",
    intent: "中",
    stage: "新线索",
    status: "new",
    ownerId: "owner-a",
    teamId: "team-a",
    estimatedAmount: 0,
    nextFollowAt: "",
    lastActivityAt: "",
    remark: "",
    convertedCustomerId: "",
    convertedDealId: "",
    sourceType: "outbound",
    sourceChannel: "prospect",
    sourceCampaign: "",
    externalId: "",
    sourceUrl: "",
    createdAt: at(1),
    ...patch
  };
}

function store(seed?: {
  activities?: LeadActivity[];
  leads?: Lead[];
  decisions?: ProspectContactabilityDecision[];
}) {
  return {
    leadActivities: seed?.activities ? [...seed.activities] : [],
    leads: seed?.leads ? [...seed.leads] : [],
    prospectContactabilityDecisions: seed?.decisions ? [...seed.decisions] : []
  };
}

const preview = candidate({ status: "preview" });
assert.equal(describeProspectLatestFollowUp(store(), preview), null);
assert.equal(listProspectFollowUps(store(), preview).length, 0);

assert.throws(
  () => recordProspectFollowUp(store(), {
    candidate: preview,
    actorId: "owner-a",
    content: "还没批准",
    createdAt: at(3)
  }),
  (error: unknown) => error instanceof ProspectFollowUpError
    && error.status === 409
    && /达到可联系后再记录跟进/.test(error.message)
);

const approvedPreview = candidate({ status: "preview" });
const approvedStore = store({ decisions: [decision()] });
assert.equal(hasCurrentApprovedContactable(approvedStore, approvedPreview, "owner-a"), true);
const approvedNote = recordProspectFollowUp(approvedStore, {
  candidate: approvedPreview,
  actorId: "owner-a",
  content: "批准后先记一句",
  createdAt: at(3)
});
assert.equal(approvedPreview.status, "preview");
assert.equal(approvedStore.prospectContactabilityDecisions.length, 1);
assert.equal(approvedStore.leads.length, 0);
assert.equal(approvedNote.activity.type, "note");
assert.equal(approvedNote.activity.leadId, "");
assert.equal(approvedNote.activity.prospectCandidateId, approvedPreview.id);
assert.equal(approvedNote.latestFollowUp?.typeLabel, "备注");
assert.equal(approvedNote.latestFollowUp?.excerpt, "批准后先记一句");

const staleStore = store({
  decisions: [
    decision({ createdAt: at(2) }),
    decision({
      id: "decision-2",
      status: "stale",
      createdAt: at(4)
    })
  ]
});
assert.equal(hasCurrentApprovedContactable(staleStore, preview, "owner-a"), false);
assert.throws(
  () => recordProspectFollowUp(staleStore, {
    candidate: preview,
    actorId: "owner-a",
    content: "批准已过期",
    createdAt: at(5)
  }),
  (error: unknown) => error instanceof ProspectFollowUpError && error.status === 409
);

const contactable = candidate();
const notes = store();
const beforeStatus = contactable.status;
const beforeOutreach = contactable.outreachState;
const first = recordProspectFollowUp(notes, {
  candidate: contactable,
  actorId: "owner-a",
  content: "  已发开发信，对方说下周再看  ",
  createdAt: at(3)
});
assert.equal(first.activity.content, "已发开发信，对方说下周再看");
assert.equal(contactable.status, beforeStatus);
assert.equal(contactable.outreachState, beforeOutreach);
assert.equal(contactable.leadId, undefined);
assert.equal(notes.prospectContactabilityDecisions.length, 0);
const second = recordProspectFollowUp(notes, {
  candidate: contactable,
  actorId: "owner-a",
  content: "电话里确认样品数量是 20",
  createdAt: at(5)
});
assert.equal(second.latestFollowUp?.excerpt, "电话里确认样品数量是 20");
assert.equal(second.latestFollowUp?.at, at(5));
assert.equal(listProspectFollowUps(notes, contactable).length, 2);
assert.equal(describeProspectLatestFollowUp(notes, candidate({ id: "other" })), null);

const long = "甲".repeat(60);
const clipped = recordProspectFollowUp(store(), {
  candidate: candidate({ id: "candidate-long" }),
  actorId: "owner-a",
  content: long,
  createdAt: at(6)
});
assert.equal(clipped.latestFollowUp?.excerpt, `${"甲".repeat(48)}…`);

assert.throws(
  () => recordProspectFollowUp(store(), {
    candidate: contactable,
    actorId: "owner-b",
    content: "别人的候选",
    createdAt: at(3)
  }),
  (error: unknown) => error instanceof ProspectFollowUpError && error.status === 403
);

assert.throws(
  () => recordProspectFollowUp(store(), {
    candidate: candidate({ status: "excluded" }),
    actorId: "owner-a",
    content: "已排除",
    createdAt: at(3)
  }),
  (error: unknown) => error instanceof ProspectFollowUpError
    && error.status === 409
    && /已排除/.test(error.message)
);

assert.throws(
  () => recordProspectFollowUp(store(), {
    candidate: contactable,
    actorId: "owner-a",
    content: "   ",
    createdAt: at(3)
  }),
  (error: unknown) => error instanceof ProspectFollowUpError && error.status === 400
);

const syncedLead = lead();
const synced = candidate({ status: "synced", leadId: syncedLead.id });
const syncedStore = store({
  leads: [syncedLead],
  activities: [{
    id: "la-system",
    leadId: syncedLead.id,
    type: "system",
    content: "候选客户经人工确认转为正式线索",
    operatorId: "owner-a",
    nextFollowAt: "",
    createdAt: at(4)
  }]
});
assert.equal(describeProspectLatestFollowUp(syncedStore, synced), null);
const syncedNote = recordProspectFollowUp(syncedStore, {
  candidate: synced,
  actorId: "owner-a",
  content: "转入后继续跟",
  createdAt: at(6)
});
assert.equal(syncedNote.activity.leadId, syncedLead.id);
assert.equal(syncedLead.status, "following");
assert.equal(syncedLead.lastActivityAt, "刚刚");
assert.equal(synced.status, "synced");
assert.equal(describeProspectLatestFollowUp(syncedStore, synced)?.type, "note");

const earlierCall: LeadActivity = {
  id: "la-call",
  leadId: syncedLead.id,
  type: "call",
  content: "打过一次，没人接",
  operatorId: "owner-a",
  nextFollowAt: "",
  createdAt: at(7)
};
syncedStore.leadActivities.unshift(earlierCall);
assert.equal(describeProspectLatestFollowUp(syncedStore, synced)?.typeLabel, "电话");
assert.match(describeProspectLatestFollowUp(syncedStore, synced)?.excerpt || "", /没人接/);

const pending = candidate({ id: "candidate-link", status: "contactable" });
const linkStore = store();
recordProspectFollowUp(linkStore, {
  candidate: pending,
  actorId: "owner-a",
  content: "转入前的注记",
  createdAt: at(3)
});
linkProspectFollowUpNotes(linkStore, pending, "lead-linked");
assert.equal(linkStore.leadActivities[0]?.leadId, "lead-linked");
assert.equal(linkStore.leadActivities[0]?.prospectCandidateId, pending.id);
pending.leadId = "lead-linked";
assert.equal(describeProspectLatestFollowUp(linkStore, pending)?.excerpt, "转入前的注记");

const clock = new Date(2026, 9, 30, 10, 0);
assert.equal(classifyProspectNextFollow("", clock), "empty");
assert.equal(classifyProspectNextFollow("2026-10-30 09:00", clock), "overdue");
assert.equal(classifyProspectNextFollow("2026-10-30 15:30", clock), "today");
assert.equal(classifyProspectNextFollow("2026-10-31 09:00", clock), "later");
assert.equal(classifyProspectNextFollow("明天 10:00", clock), "later");
assert.equal(normalizeProspectNextFollowAt("2026-11-02T11:15"), "2026-11-02 11:15");
assert.equal(normalizeProspectNextFollowAt(""), "");
assert.throws(
  () => normalizeProspectNextFollowAt("2026-02-31 10:00"),
  (error: unknown) => error instanceof ProspectFollowUpError && error.status === 400
);
assert.throws(
  () => normalizeProspectNextFollowAt("下周五"),
  (error: unknown) => error instanceof ProspectFollowUpError && error.status === 400
);

const kept = candidate({ nextFollowAt: "2026-11-02 11:15" });
const keptStore = store();
const keptBefore = kept.status;
recordProspectFollowUp(keptStore, {
  candidate: kept,
  actorId: "owner-a",
  content: "只记一句，不改时间",
  createdAt: at(3)
});
assert.equal(kept.nextFollowAt, "2026-11-02 11:15");
assert.equal(kept.status, keptBefore);
assert.equal(keptStore.leadActivities[0]?.nextFollowAt, "");
assert.equal(keptStore.leadActivities.length, 1);

const scheduled = recordProspectFollowUp(keptStore, {
  candidate: kept,
  actorId: "owner-a",
  content: "约了下周一上午",
  nextFollowAt: "2026-11-02T11:20",
  createdAt: at(4)
});
assert.equal(scheduled.activity.nextFollowAt, "2026-11-02 11:20");
assert.equal(scheduled.nextFollowAt, "2026-11-02 11:20");
assert.equal(kept.nextFollowAt, "2026-11-02 11:20");
assert.equal(kept.outreachState, "uncontacted");
assert.equal(keptStore.prospectContactabilityDecisions.length, 0);

const cleared = setProspectNextFollowAt(keptStore, {
  candidate: kept,
  actorId: "owner-a",
  nextFollowAt: ""
});
assert.equal(cleared.nextFollowAt, "");
assert.equal(kept.nextFollowAt, "");
assert.equal(keptStore.leadActivities.length, 2);
assert.equal(kept.status, "contactable");

assert.throws(
  () => setProspectNextFollowAt(store(), {
    candidate: preview,
    actorId: "owner-a",
    nextFollowAt: "2026-11-02 11:15"
  }),
  (error: unknown) => error instanceof ProspectFollowUpError && error.status === 409
);
assert.throws(
  () => setProspectNextFollowAt(store(), {
    candidate: candidate({ status: "excluded", nextFollowAt: "2026-11-02 11:15" }),
    actorId: "owner-a",
    nextFollowAt: "2026-11-03 09:00"
  }),
  (error: unknown) => error instanceof ProspectFollowUpError && error.status === 409
);
assert.throws(
  () => recordProspectFollowUp(store(), {
    candidate: contactable,
    actorId: "owner-a",
    content: "时间不对",
    nextFollowAt: "下周",
    createdAt: at(3)
  }),
  (error: unknown) => error instanceof ProspectFollowUpError && error.status === 400
);

const leadForSchedule = lead({ nextFollowAt: "旧时间" });
const scheduledCandidate = candidate({ status: "synced", leadId: leadForSchedule.id });
const scheduleStore = store({ leads: [leadForSchedule] });
setProspectNextFollowAt(scheduleStore, {
  candidate: scheduledCandidate,
  actorId: "owner-a",
  nextFollowAt: "2026-11-04 09:30"
});
assert.equal(scheduledCandidate.nextFollowAt, "2026-11-04 09:30");
assert.equal(leadForSchedule.nextFollowAt, "2026-11-04 09:30");
assert.equal(leadForSchedule.status, "new");
assert.equal(scheduleStore.leadActivities.length, 0);

const serverSource = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
const followUpRouteStart = serverSource.indexOf('app.post("/api/prospect-list/:id/follow-ups"');
assert.ok(followUpRouteStart > 0, "必须提供候选跟进写入接口");
const followUpRouteEnd = serverSource.indexOf("const dailyReportBodySchema", followUpRouteStart);
const followUpRoute = serverSource.slice(followUpRouteStart, followUpRouteEnd);
assert.match(followUpRoute, /recordProspectFollowUp\(store/);
assert.match(followUpRoute, /setProspectNextFollowAt\(store/);
assert.match(followUpRoute, /nextFollowAt/);
assert.doesNotMatch(followUpRoute, /convertProspectToLead|convert-to-lead|approved_contactable|ensureProspectFollowUpTodo|send-development-email|sendDevelopmentEmail/);
assert.match(
  serverSource,
  /latestFollowUp: describeProspectLatestFollowUp\(store, verified\)/,
  "搜客清单接口必须带回最近跟进"
);
const conversionSource = readFileSync(new URL("./prospect-lead-conversion.ts", import.meta.url), "utf8");
assert.match(
  conversionSource,
  /selected\.status !== "approved_contactable"/,
  "转线索仍要求当前人工可联系批准"
);
const outreachSource = readFileSync(new URL("./prospect-outreach.ts", import.meta.url), "utf8");
assert.match(outreachSource, /linkProspectFollowUpNotes\(store, candidate, leadId\)/);

console.log("prospect follow-up tests passed");
