import assert from "node:assert/strict";
import {
  describeProspectCrmCollision,
  existingCrmCustomerMatch,
  type CrmCollisionCustomer,
  type CrmCollisionLead
} from "./crm-existing-match.js";
import type { Customer, Lead, WebsiteOpportunity } from "./types.js";

function candidate(partial: Partial<WebsiteOpportunity> & Pick<WebsiteOpportunity, "company" | "website">): WebsiteOpportunity {
  return {
    id: partial.id || "cand",
    business: "",
    country: partial.country || "Germany",
    contact: "",
    contactInfo: "",
    description: "",
    ownerId: "owner",
    teamId: "team",
    status: "preview",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...partial
  } as WebsiteOpportunity;
}

function customer(partial: Partial<CrmCollisionCustomer> & Pick<CrmCollisionCustomer, "id" | "company">): CrmCollisionCustomer {
  return {
    country: "Germany",
    contact: "",
    ownerId: "owner",
    teamId: "team",
    stage: "",
    amount: 0,
    health: 1,
    nextReminder: "",
    wecomBound: false,
    billingName: partial.company,
    billingAddress: "",
    documentContact: "",
    defaultPortDischarge: "",
    defaultIncoterm: "",
    defaultPaymentTerm: "",
    visible: true,
    ...partial
  } as CrmCollisionCustomer;
}

function lead(partial: Partial<CrmCollisionLead> & Pick<CrmCollisionLead, "id" | "company">): CrmCollisionLead {
  return {
    contact: "",
    country: "Germany",
    email: "",
    phone: "",
    wechat: "",
    source: "",
    intent: "",
    stage: "",
    status: "following",
    ownerId: "owner",
    teamId: "team",
    estimatedAmount: 0,
    nextFollowAt: "",
    lastActivityAt: "",
    remark: "",
    convertedCustomerId: "",
    convertedDealId: "",
    sourceType: "outbound",
    sourceChannel: "",
    sourceCampaign: "",
    externalId: "",
    sourceUrl: "",
    createdAt: "2026-09-01T00:00:00.000Z",
    visible: true,
    ...partial
  } as CrmCollisionLead;
}

const pump = candidate({
  company: "Existing Pump GmbH",
  country: "Germany",
  website: "https://existing-pump.example/products",
  contactInfo: "sales@existing-pump.example"
});
const pumpCustomer = customer({
  id: "customer_pump",
  company: "Existing Pump GmbH",
  country: "德国",
  website: "https://existing-pump.example",
  email: "anna@existing-pump.example",
  claimedAt: "2026-08-01T00:00:00.000Z"
});

const none = describeProspectCrmCollision({
  candidate: candidate({ company: "New Lamp AG", website: "https://new-lamp.example", country: "Germany" }),
  customers: [pumpCustomer],
  leads: []
});
assert.equal(none.status, "none");
assert.equal(none.label, "未撞库");
assert.equal(none.linkable, false);
assert.equal(none.recordId, "");
assert.equal(none.name, "");

const byDomain = describeProspectCrmCollision({
  candidate: pump,
  customers: [pumpCustomer],
  leads: []
});
assert.equal(byDomain.status, "customer");
assert.equal(byDomain.label, "已有客户");
assert.equal(byDomain.reason, "官网域名已在客户库");
assert.equal(byDomain.recordId, "customer_pump");
assert.equal(byDomain.name, "Existing Pump GmbH");
assert.equal(byDomain.linkable, true);
assert.equal(byDomain.at, "2026-08-01T00:00:00.000Z");
assert.equal(existingCrmCustomerMatch(pump, pumpCustomer), "官网域名已在客户库");

const byCountryAlias = describeProspectCrmCollision({
  candidate: candidate({
    company: "Existing Pump GmbH",
    country: "Germany",
    website: "https://other.example"
  }),
  customers: [customer({
    id: "customer_name",
    company: "Existing Pump GmbH",
    country: "德国",
    website: ""
  })],
  leads: []
});
assert.equal(byCountryAlias.reason, "公司名称与国家已在客户库");

const emailOnly = candidate({
  company: "Different Name",
  country: "France",
  website: "https://different.example",
  contactInfo: "buyer@existing-pump.example"
});
const byEmail = describeProspectCrmCollision({
  candidate: emailOnly,
  customers: [customer({
    id: "customer_mail",
    company: "Mailbox Owner",
    country: "France",
    website: "",
    email: "buyer@existing-pump.example"
  })],
  leads: []
});
assert.equal(byEmail.reason, "联系邮箱已在客户库");

const domainMail = describeProspectCrmCollision({
  candidate: candidate({
    company: "Other Co",
    country: "France",
    website: "https://brochure.example",
    contactInfo: "hello@acme-tools.example"
  }),
  customers: [customer({
    id: "customer_domain_mail",
    company: "Acme Tools",
    country: "France",
    website: "https://acme-tools.example",
    email: ""
  })],
  leads: []
});
assert.equal(domainMail.status, "customer");
assert.equal(domainMail.reason, "邮箱域名已在客户库");
assert.equal(domainMail.name, "Acme Tools");

const freemail = describeProspectCrmCollision({
  candidate: candidate({
    company: "Gmail Buyer",
    country: "France",
    website: "https://gmail-buyer.example",
    contactInfo: "buyer@gmail.com"
  }),
  customers: [customer({
    id: "customer_gmail",
    company: "Another Gmail",
    country: "France",
    website: "https://another.example",
    email: "owner@gmail.com"
  })],
  leads: []
});
assert.equal(freemail.status, "none");
assert.equal(existingCrmCustomerMatch(
  candidate({ company: "Gmail Buyer", country: "France", website: "https://gmail-buyer.example", contactInfo: "buyer@gmail.com" }),
  { ...customer({ id: "customer_gmail", company: "Another Gmail", website: "", email: "owner@gmail.com" }) }
), "");

const otherTeam = describeProspectCrmCollision({
  candidate: pump,
  customers: [customer({ ...pumpCustomer, id: "other", teamId: "other-team" })],
  leads: []
});
assert.equal(otherTeam.status, "none");

const leadHit = lead({
  id: "lead_pump",
  company: "Existing Pump GmbH",
  sourceUrl: "https://existing-pump.example/about",
  lastActivityAt: "2026-09-12T00:00:00.000Z"
});
const byLead = describeProspectCrmCollision({
  candidate: candidate({
    company: "Existing Pump GmbH",
    country: "Germany",
    website: "https://existing-pump.example"
  }),
  customers: [],
  leads: [leadHit]
});
assert.equal(byLead.status, "lead");
assert.equal(byLead.label, "已有线索");
assert.equal(byLead.reason, "官网域名已在线索库");
assert.equal(byLead.recordId, "lead_pump");
assert.equal(byLead.at, "2026-09-12T00:00:00.000Z");

const customerWins = describeProspectCrmCollision({
  candidate: pump,
  customers: [pumpCustomer],
  leads: [leadHit]
});
assert.equal(customerWins.status, "customer");
assert.equal(customerWins.recordId, "customer_pump");

const deletedLead = describeProspectCrmCollision({
  candidate: candidate({ company: "Existing Pump GmbH", country: "Germany", website: "https://existing-pump.example", leadId: "lead_gone" }),
  customers: [],
  leads: [lead({ ...leadHit, id: "lead_gone", deletedAt: "2026-09-02T00:00:00.000Z", visible: true })]
});
assert.equal(deletedLead.status, "none");

const invalidLead = describeProspectCrmCollision({
  candidate: candidate({ company: "Existing Pump GmbH", country: "Germany", website: "https://note.example", leadId: "lead_bad" }),
  customers: [],
  leads: [lead({ id: "lead_bad", company: "Existing Pump GmbH", country: "Germany", status: "invalid", visible: true })]
});
assert.equal(invalidLead.status, "none");

const direct = describeProspectCrmCollision({
  candidate: candidate({
    company: "Renamed Candidate",
    country: "Japan",
    website: "https://renamed.example",
    customerId: "customer_direct"
  }),
  customers: [customer({
    id: "customer_direct",
    company: "Kept Customer",
    country: "日本",
    website: "https://kept.example",
    claimedAt: "2026-07-01T00:00:00.000Z"
  })],
  leads: [leadHit]
});
assert.equal(direct.status, "customer");
assert.equal(direct.reason, "已关联客户");
assert.equal(direct.name, "Kept Customer");
assert.equal(direct.recordId, "customer_direct");

const hidden = describeProspectCrmCollision({
  candidate: pump,
  customers: [customer({ ...pumpCustomer, visible: false })],
  leads: []
});
assert.equal(hidden.status, "customer");
assert.equal(hidden.label, "已有客户");
assert.equal(hidden.linkable, false);
assert.equal(hidden.recordId, "");
assert.equal(hidden.name, "");
assert.equal(hidden.at, "");
assert.equal(hidden.reason, "官网域名已在客户库");
assert.equal(JSON.stringify(hidden).includes("Existing Pump"), false);
assert.equal(JSON.stringify(hidden).includes("customer_pump"), false);

const visibleLeadBeatsHiddenCustomer = describeProspectCrmCollision({
  candidate: { ...pump, leadId: "lead_visible" },
  customers: [customer({ ...pumpCustomer, visible: false })],
  leads: [lead({ id: "lead_visible", company: "Visible Lead Co", visible: true, lastActivityAt: "2026-10-02T00:00:00.000Z" })]
});
assert.equal(visibleLeadBeatsHiddenCustomer.status, "lead");
assert.equal(visibleLeadBeatsHiddenCustomer.name, "Visible Lead Co");
assert.equal(visibleLeadBeatsHiddenCustomer.linkable, true);

const activityWins = describeProspectCrmCollision({
  candidate: candidate({ company: "Kept Customer", country: "Japan", website: "https://other.example", customerId: "customer_direct" }),
  customers: [customer({ id: "customer_direct", company: "Kept Customer", country: "Japan", claimedAt: "2026-07-01T00:00:00.000Z" })],
  leads: [],
  customerTouchedAt: { customer_direct: "2026-10-20T03:04:00.000Z" }
});
assert.equal(activityWins.at, "2026-10-20T03:04:00.000Z");

console.log("crm-existing-match-test: ok");
