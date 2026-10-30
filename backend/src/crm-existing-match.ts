import type { Customer, Lead, WebsiteOpportunity } from "./types.js";

/**
 * 客户/线索撞库复用搜客入库时的同一套判定（域名、联系邮箱、公司名+国家）。
 * 只读解释候选是否已经对上可见的客户或线索，不写库、不合并、不改归属。
 * 邮箱域名只在展示时补充，且公共邮箱域不算撞库；入库过滤仍只用原来的三条。
 */

const providerCountryAliases: Record<string, string> = {
  at: "AT",
  austria: "AT",
  奥地利: "AT",
  au: "AU",
  australia: "AU",
  澳大利亚: "AU",
  be: "BE",
  belgium: "BE",
  比利时: "BE",
  br: "BR",
  brazil: "BR",
  巴西: "BR",
  ca: "CA",
  canada: "CA",
  加拿大: "CA",
  ch: "CH",
  switzerland: "CH",
  瑞士: "CH",
  cn: "CN",
  china: "CN",
  中国: "CN",
  de: "DE",
  germany: "DE",
  deutschland: "DE",
  德国: "DE",
  es: "ES",
  spain: "ES",
  西班牙: "ES",
  fr: "FR",
  france: "FR",
  法国: "FR",
  gb: "GB",
  uk: "GB",
  unitedkingdom: "GB",
  greatbritain: "GB",
  英国: "GB",
  id: "ID",
  indonesia: "ID",
  印度尼西亚: "ID",
  in: "IN",
  india: "IN",
  印度: "IN",
  it: "IT",
  italy: "IT",
  意大利: "IT",
  jp: "JP",
  japan: "JP",
  日本: "JP",
  kr: "KR",
  southkorea: "KR",
  korea: "KR",
  韩国: "KR",
  mx: "MX",
  mexico: "MX",
  墨西哥: "MX",
  my: "MY",
  malaysia: "MY",
  马来西亚: "MY",
  nl: "NL",
  netherlands: "NL",
  holland: "NL",
  荷兰: "NL",
  pl: "PL",
  poland: "PL",
  波兰: "PL",
  ru: "RU",
  russia: "RU",
  俄罗斯: "RU",
  sg: "SG",
  singapore: "SG",
  新加坡: "SG",
  tr: "TR",
  turkey: "TR",
  türkiye: "TR",
  土耳其: "TR",
  tw: "TW",
  taiwan: "TW",
  中国台湾: "TW",
  us: "US",
  usa: "US",
  unitedstates: "US",
  unitedstatesofamerica: "US",
  美国: "US",
  vn: "VN",
  vietnam: "VN",
  越南: "VN"
};

export function normalizeProviderCountry(country: string) {
  const normalized = country
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[.\s_()-]+/g, "");
  if (!normalized || ["unknown", "未知", "待维护", "n/a", "na"].includes(normalized)) return "";
  return providerCountryAliases[normalized] || normalized;
}

export function normalizeCrmCompanyName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/&/gu, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/gu)
    .filter(Boolean)
    .filter((token) => ![
      "co", "company", "corp", "corporation", "inc", "incorporated",
      "ltd", "limited", "llc", "gmbh", "ag", "bv", "srl", "sa",
      "spa", "pte", "plc", "kg", "oy", "ab", "sas", "sarl",
      "tnhh", "sdn", "bhd", "jsc", "kk", "kabushiki", "kaisha", "pvt", "pty"
    ].includes(token))
    .join(" ")
    .trim();
}

function emailsFromText(value: string) {
  return [...new Set((value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu) || [])
    .map((item) => item.toLocaleLowerCase("en-US")))];
}

function crmCandidateEmails(candidate: Pick<WebsiteOpportunity, "contactInfo" | "contact" | "description">) {
  return new Set(emailsFromText([
    candidate.contactInfo,
    candidate.contact,
    candidate.description
  ].filter(Boolean).join(" ")));
}

function crmWebsiteDomains(values: string[]) {
  return new Set(values
    .map((value) => websiteDomainKey(value))
    .filter((value) => value && value.includes(".")));
}

function sameKnownCompany(
  candidateName: string,
  candidateCountry: string,
  existingName: string,
  existingCountry: string
) {
  const leftName = normalizeCrmCompanyName(candidateName);
  const rightName = normalizeCrmCompanyName(existingName);
  if (!leftName || !rightName || leftName !== rightName) return false;
  const leftCountry = normalizeProviderCountry(candidateCountry);
  const rightCountry = normalizeProviderCountry(existingCountry);
  if (leftCountry && rightCountry) return leftCountry === rightCountry;
  return leftName.length >= 8;
}

export function existingCrmCustomerMatch(
  candidate: WebsiteOpportunity,
  customer: Customer
) {
  if (candidate.teamId !== customer.teamId) return "";
  const candidateDomains = crmWebsiteDomains([
    candidate.website,
    ...(candidate.sourceEvidence || []).flatMap((item) => [
      item.officialWebsite,
      item.sourceUrl
    ])
  ]);
  const customerDomains = crmWebsiteDomains([
    customer.website || ""
  ]);
  if ([...candidateDomains].some((domain) => customerDomains.has(domain))) {
    return "官网域名已在客户库";
  }
  const candidateEmails = crmCandidateEmails(candidate);
  const customerEmails = new Set(emailsFromText([
    customer.email || "",
    customer.contactRemark || "",
    customer.documentContact || ""
  ].join(" ")));
  if ([...candidateEmails].some((email) => customerEmails.has(email))) {
    return "联系邮箱已在客户库";
  }
  const customerNames = [
    customer.company,
    customer.companyFullName || "",
    customer.billingName || ""
  ].filter(Boolean);
  if (customerNames.some((name) =>
    sameKnownCompany(candidate.company, candidate.country, name, customer.country)
  )) {
    return "公司名称与国家已在客户库";
  }
  return "";
}

export function existingCrmLeadMatch(
  candidate: WebsiteOpportunity,
  lead: Lead
) {
  if (candidate.teamId !== lead.teamId || lead.deletedAt || lead.status === "invalid") return "";
  const candidateDomains = crmWebsiteDomains([
    candidate.website,
    ...(candidate.sourceEvidence || []).flatMap((item) => [
      item.officialWebsite,
      item.sourceUrl
    ])
  ]);
  const leadDomains = crmWebsiteDomains([lead.sourceUrl || ""]);
  if ([...candidateDomains].some((domain) => leadDomains.has(domain))) {
    return "官网域名已在线索库";
  }
  const candidateEmails = crmCandidateEmails(candidate);
  const leadEmails = new Set(emailsFromText([
    lead.email,
    lead.remark,
    lead.inquiryContent || ""
  ].join(" ")));
  if ([...candidateEmails].some((email) => leadEmails.has(email))) {
    return "联系邮箱已在线索库";
  }
  if (sameKnownCompany(candidate.company, candidate.country, lead.company, lead.country)) {
    return "公司名称与国家已在线索库";
  }
  return "";
}

export function websiteDomainKey(raw: string) {
  if (!raw) return "";
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
  }
}


const PUBLIC_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "qq.com",
  "163.com",
  "126.com",
  "sina.com",
  "foxmail.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "yandex.com",
  "mail.com",
  "gmx.com",
  "gmx.de"
]);

export type CrmCollisionStatus = "customer" | "lead" | "none";

export interface CrmCollisionView {
  status: CrmCollisionStatus;
  label: "已有客户" | "已有线索" | "未撞库";
  reason: string;
  recordId: string;
  name: string;
  at: string;
  linkable: boolean;
}

export type CrmCollisionCustomer = Customer & { visible: boolean };
export type CrmCollisionLead = Lead & { visible: boolean };

export interface ProspectCrmCollisionInput {
  candidate: WebsiteOpportunity;
  customers: CrmCollisionCustomer[];
  leads: CrmCollisionLead[];
  customerTouchedAt?: Record<string, string>;
}

function noneCollision(): CrmCollisionView {
  return {
    status: "none",
    label: "未撞库",
    reason: "",
    recordId: "",
    name: "",
    at: "",
    linkable: false
  };
}

function hiddenCollision(status: "customer" | "lead", reason: string): CrmCollisionView {
  return {
    status,
    label: status === "customer" ? "已有客户" : "已有线索",
    reason,
    recordId: "",
    name: "",
    at: "",
    linkable: false
  };
}

function emailDomain(value: string) {
  const at = value.lastIndexOf("@");
  if (at < 0) return "";
  return value.slice(at + 1).toLocaleLowerCase("en-US");
}

function companyEmailDomains(emails: Iterable<string>) {
  const domains = new Set<string>();
  for (const email of emails) {
    const domain = emailDomain(email);
    if (!domain.includes(".") || PUBLIC_MAIL_DOMAINS.has(domain)) continue;
    domains.add(domain);
  }
  return domains;
}

function emailDomainsOverlap(
  candidate: WebsiteOpportunity,
  counterpartyEmails: string[],
  counterpartyWebsites: string[]
) {
  const candidateEmailDomains = companyEmailDomains(crmCandidateEmails(candidate));
  const otherEmailDomains = companyEmailDomains(counterpartyEmails);
  if ([...candidateEmailDomains].some((domain) => otherEmailDomains.has(domain))) return true;
  const candidateSites = crmWebsiteDomains([
    candidate.website,
    ...(candidate.sourceEvidence || []).flatMap((item) => [item.officialWebsite, item.sourceUrl])
  ]);
  const otherSites = crmWebsiteDomains(counterpartyWebsites);
  if ([...otherEmailDomains].some((domain) => candidateSites.has(domain))) return true;
  if ([...candidateEmailDomains].some((domain) => otherSites.has(domain))) return true;
  return false;
}

function customerEmailDomainReason(candidate: WebsiteOpportunity, customer: Customer) {
  if (candidate.teamId !== customer.teamId) return "";
  if (existingCrmCustomerMatch(candidate, customer)) return "";
  return emailDomainsOverlap(
    candidate,
    [customer.email || "", customer.contactRemark || "", customer.documentContact || ""],
    [customer.website || ""]
  ) ? "邮箱域名已在客户库" : "";
}

function leadEmailDomainReason(candidate: WebsiteOpportunity, lead: Lead) {
  if (candidate.teamId !== lead.teamId || lead.deletedAt || lead.status === "invalid") return "";
  if (existingCrmLeadMatch(candidate, lead)) return "";
  return emailDomainsOverlap(
    candidate,
    [lead.email, lead.remark, lead.inquiryContent || ""],
    [lead.sourceUrl || ""]
  ) ? "邮箱域名已在线索库" : "";
}

function activeLead(lead: Lead) {
  return !lead.deletedAt && lead.status !== "invalid";
}

function customerStamp(customer: Customer, touchedAt: Record<string, string>) {
  return touchedAt[customer.id] || customer.claimedAt || customer.wonAt || customer.releasedAt || "";
}

function visibleCustomerView(
  customer: CrmCollisionCustomer,
  reason: string,
  touchedAt: Record<string, string>
): CrmCollisionView {
  return {
    status: "customer",
    label: "已有客户",
    reason,
    recordId: customer.id,
    name: customer.company.trim(),
    at: customerStamp(customer, touchedAt),
    linkable: true
  };
}

function visibleLeadView(lead: CrmCollisionLead, reason: string): CrmCollisionView {
  return {
    status: "lead",
    label: "已有线索",
    reason,
    recordId: lead.id,
    name: lead.company.trim(),
    at: lead.lastActivityAt || lead.createdAt || "",
    linkable: true
  };
}

/**
 * 只读撞库。客户优先于线索；看得见的记录优先于看不见的记录。
 * 看不见时不回传名称、时间和 id。不合并，不改归属。
 */
export function describeProspectCrmCollision(input: ProspectCrmCollisionInput): CrmCollisionView {
  const { candidate, customers, leads } = input;
  const touchedAt = input.customerTouchedAt || {};
  const linkedCustomerId = (candidate.customerId || "").trim();
  const linkedLeadId = (candidate.leadId || "").trim();

  if (linkedCustomerId) {
    const linked = customers.find((item) => item.id === linkedCustomerId && item.visible);
    if (linked) return visibleCustomerView(linked, "已关联客户", touchedAt);
  }
  for (const customer of customers) {
    if (!customer.visible) continue;
    const reason = existingCrmCustomerMatch(candidate, customer) || customerEmailDomainReason(candidate, customer);
    if (reason) return visibleCustomerView(customer, reason, touchedAt);
  }
  if (linkedLeadId) {
    const linked = leads.find((item) => item.id === linkedLeadId && item.visible && activeLead(item));
    if (linked) return visibleLeadView(linked, "已关联线索");
  }
  for (const lead of leads) {
    if (!lead.visible || !activeLead(lead)) continue;
    const reason = existingCrmLeadMatch(candidate, lead) || leadEmailDomainReason(candidate, lead);
    if (reason) return visibleLeadView(lead, reason);
  }
  if (linkedCustomerId) {
    const linked = customers.find((item) => item.id === linkedCustomerId && !item.visible);
    if (linked) return hiddenCollision("customer", "已关联客户，当前账号看不到对方名称");
  }
  for (const customer of customers) {
    if (customer.visible) continue;
    const reason = existingCrmCustomerMatch(candidate, customer) || customerEmailDomainReason(candidate, customer);
    if (reason) return hiddenCollision("customer", reason);
  }
  if (linkedLeadId) {
    const linked = leads.find((item) => item.id === linkedLeadId && !item.visible && activeLead(item));
    if (linked) return hiddenCollision("lead", "已关联线索，当前账号看不到对方名称");
  }
  for (const lead of leads) {
    if (lead.visible || !activeLead(lead)) continue;
    const reason = existingCrmLeadMatch(candidate, lead) || leadEmailDomainReason(candidate, lead);
    if (reason) return hiddenCollision("lead", reason);
  }
  return noneCollision();
}
