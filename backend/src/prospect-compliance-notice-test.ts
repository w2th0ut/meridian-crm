import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeProspectComplianceNotices } from "./prospect-compliance-notice.js";
import type {
  ProspectContactVerificationSnapshot,
  ProspectSuppressionEvent,
  TenantProspect,
  WebsiteOpportunity
} from "./types.js";

const at = (day: number) => new Date(Date.UTC(2026, 6, day, 9)).toISOString();

function candidate(patch: Partial<WebsiteOpportunity> = {}): WebsiteOpportunity {
  return {
    id: "candidate-hold",
    company: "Hold GmbH",
    business: "Components",
    country: "DE",
    website: "https://hold.example.test",
    contact: "Buyer",
    contactInfo: "buyer@hold.example.test",
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

function suppression(patch: Partial<ProspectSuppressionEvent>): ProspectSuppressionEvent {
  return {
    id: "pse-1",
    teamId: "team-a",
    ownerId: "owner-a",
    prospectId: "prospect-1",
    organizationId: "org-1",
    contactId: "",
    channelId: "",
    channelType: "",
    scope: "organization_all",
    scopeKeyHash: "scope-1",
    action: "imposed",
    reasonCode: "HUMAN_TEMPORARY_SUPPRESSION",
    reasonNote: "",
    effectiveAt: at(2),
    expiresAt: "",
    createdBy: "owner-a",
    idempotencyKeyHash: "k",
    requestHash: "r",
    recordHash: "h",
    createdAt: at(2),
    ...patch
  };
}

function verification(
  patch: Partial<ProspectContactVerificationSnapshot>
): ProspectContactVerificationSnapshot {
  return {
    id: "pcv-1",
    teamId: "team-a",
    ownerId: "owner-a",
    prospectId: "prospect-1",
    organizationId: "org-1",
    contactId: "contact-1",
    channelId: "channel-1",
    status: "bounced",
    providerCode: "",
    reasonCode: "",
    verifiedAt: at(3),
    expiresAt: "",
    previousVerificationId: "",
    idempotencyKeyHash: "k",
    requestHash: "r",
    recordHash: "h",
    createdAt: at(3),
    ...patch
  };
}

function prospect(patch: Partial<TenantProspect> = {}): TenantProspect {
  return {
    id: "prospect-1",
    teamId: "team-a",
    organizationId: "org-1",
    status: "active",
    latestClassification: "net_new",
    queueState: "none",
    queueReasonCode: "",
    firstSeenAt: at(1),
    lastSeenAt: at(1),
    lastMaterialChangeAt: at(1),
    lastQueuedAt: "",
    lastReviewedAt: "",
    nextReviewAt: "",
    hitCount: 1,
    sourceCount: 1,
    evidenceCount: 0,
    sourceKeyHashes: [],
    materialEvidenceKeyHashes: [],
    exclusionScope: "none",
    exclusionMode: "none",
    exclusionReasonCode: "",
    excludedUntil: "",
    leadId: "",
    customerId: "",
    dealId: "",
    version: 1,
    eventCount: 0,
    eventTailHash: "",
    prospectHash: "",
    createdAt: at(1),
    updatedAt: at(1),
    ...patch
  };
}

function notices(input: {
  candidate?: WebsiteOpportunity;
  events?: ProspectSuppressionEvent[];
  verifications?: ProspectContactVerificationSnapshot[];
  prospects?: TenantProspect[];
  at?: string;
}) {
  return describeProspectComplianceNotices({
    prospectSuppressionEvents: input.events || [],
    prospectContactVerificationSnapshots: input.verifications || [],
    tenantProspects: input.prospects || []
  }, input.candidate || candidate(), input.at || at(10));
}

const quiet = notices({});
assert.deepEqual(quiet, [], "没有抑制、退订或退信时不生成说明");

const manualExclude = notices({
  candidate: candidate({
    status: "excluded",
    excludedReason: "非目标行业",
    outreachState: "uncontacted"
  })
});
assert.deepEqual(manualExclude, [], "普通人工排除不冒充抑制或退订");

const noted = notices({
  events: [suppression({ reasonNote: "法务要求暂停联系" })]
});
assert.equal(noted.length, 1);
assert.equal(noted[0]?.kind, "suppressed");
assert.equal(noted[0]?.label, "已抑制");
assert.equal(noted[0]?.reason, "法务要求暂停联系");
assert.equal(noted[0]?.source, "");

const dnc = notices({
  events: [suppression({
    reasonCode: "HUMAN_DO_NOT_CONTACT",
    reasonNote: "客户书面要求不再联系"
  })],
  prospects: [prospect({ status: "do_not_contact", exclusionReasonCode: "HUMAN_DO_NOT_CONTACT" })]
});
assert.equal(dnc[0]?.label, "禁止联系");
assert.equal(dnc[0]?.reason, "客户书面要求不再联系");

const missing = notices({
  candidate: candidate({ outreachState: "suppressed", excludedReason: "" })
});
assert.equal(missing[0]?.reason, "原因未回传");
assert.equal(missing[0]?.source, "");

const unsubscribed = notices({
  candidate: candidate({
    outreachState: "suppressed",
    lastReplyClassification: "unsubscribed",
    excludedReason: "要求退订",
    source: "web_search",
    sourceLabel: "公开网页"
  })
});
assert.equal(unsubscribed.length, 1);
assert.equal(unsubscribed[0]?.kind, "opted_out");
assert.equal(unsubscribed[0]?.label, "已退订");
assert.equal(unsubscribed[0]?.reason, "要求退订");
assert.equal(unsubscribed[0]?.source, "", "获客来源不是退订来源");

const rejected = notices({
  candidate: candidate({
    outreachState: "suppressed",
    lastReplyClassification: "rejected",
    excludedReason: "明确拒绝"
  })
});
assert.equal(rejected.length, 1);
assert.equal(rejected[0]?.kind, "suppressed");
assert.equal(rejected[0]?.reason, "明确拒绝");

const bounced = notices({
  candidate: candidate({ outreachState: "contact_invalid", lastReplyClassification: "bounced" }),
  verifications: [verification({
    reasonCode: "outreach_bounced",
    providerCode: "keduoduo_manual_outreach"
  })]
});
assert.equal(bounced.length, 1);
assert.equal(bounced[0]?.kind, "bounced");
assert.equal(bounced[0]?.label, "已退信");
assert.equal(bounced[0]?.reason, "outreach_bounced");
assert.equal(bounced[0]?.source, "keduoduo_manual_outreach");

const bounceWithoutReason = notices({
  candidate: candidate({ outreachState: "contact_invalid" })
});
assert.equal(bounceWithoutReason[0]?.reason, "原因未回传");
assert.equal(bounceWithoutReason[0]?.source, "");

const redacted = notices({
  events: [suppression({
    ownerId: "owner-b",
    reasonCode: "OPTED_OUT",
    reasonNote: "另一位业务员的内部备注"
  })]
});
assert.equal(redacted.length, 1);
assert.equal(redacted[0]?.kind, "suppressed");
assert.equal(redacted[0]?.reason, "SUPPRESSED");
assert.equal(JSON.stringify(redacted).includes("内部备注"), false);

const hiddenContactScope = notices({
  events: [suppression({
    ownerId: "owner-b",
    scope: "contact_channel",
    reasonNote: "不能给其他归属人看"
  })]
});
assert.deepEqual(hiddenContactScope, []);

const revoked = notices({
  events: [
    suppression({ reasonNote: "旧抑制", createdAt: at(2) }),
    suppression({
      id: "pse-2",
      action: "revoked",
      reasonNote: "",
      createdAt: at(4)
    })
  ]
});
assert.deepEqual(revoked, []);

const expired = notices({
  events: [suppression({ reasonNote: "已过期", expiresAt: at(3) })],
  at: at(10)
});
assert.deepEqual(expired, []);

const invalidChannel = notices({
  verifications: [verification({
    status: "invalid",
    reasonCode: "",
    providerCode: "manual_review"
  })]
});
assert.equal(invalidChannel.length, 1);
assert.equal(invalidChannel[0]?.kind, "invalid");
assert.equal(invalidChannel[0]?.label, "联系方式无效");
assert.equal(invalidChannel[0]?.reason, "原因未回传");
assert.equal(invalidChannel[0]?.source, "manual_review");

const both = notices({
  candidate: candidate({ outreachState: "contact_invalid" }),
  events: [suppression({ reasonNote: "暂停外发" })],
  verifications: [verification({ reasonCode: "", providerCode: "mailbox_probe" })]
});
assert.deepEqual(both.map((item) => item.kind), ["suppressed", "bounced"]);
assert.equal(both[1]?.reason, "原因未回传");
assert.equal(both[1]?.source, "mailbox_probe");

const serverSource = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
assert.match(
  serverSource,
  /complianceNotices: describeProspectComplianceNotices\(store, verified\)/,
  "搜客清单接口必须带回只读说明"
);
assert.match(
  serverSource,
  /from "\.\/prospect-compliance-notice\.js"/,
  "清单接口必须复用同一份只读汇总"
);

console.log("prospect compliance notice tests passed");
