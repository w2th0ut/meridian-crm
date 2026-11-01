import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONTACT_PHONE_AUDIT_SCHEMA_SQL,
  CONTACT_PHONE_LEGACY_CUSTOMER_SQL,
  CONTACT_PHONE_LEGACY_LEAD_SQL,
  CONTACT_PHONE_SCHEMA_SQL,
  applyLegacyContactPhoneMigration,
  contactPhoneAuditValue,
  parseContactPhoneCreateRequest,
  parseContactPhoneDeleteRequest,
  parseContactPhoneUpdateRequest,
  planLegacyContactPhones
} from "./contact-phone.js";
import { listObjectPhones } from "./phone-validity-state.js";
import type { ContactPhone } from "./types.js";

const phone = "+46111222333";
const created = parseContactPhoneCreateRequest({
  targetType: "customer",
  targetId: "c1",
  label: "手机",
  phone: " +46 111 333 444 "
});
assert.equal(created.ok, true);
if (created.ok) {
  assert.equal(created.phone, "+46 111 333 444");
  assert.equal(created.digits, "46111333444");
}
assert.equal(parseContactPhoneCreateRequest({ targetType: "customer", targetId: "c1", label: "传真", phone: "+46111333444" }).ok, false);
assert.equal(parseContactPhoneCreateRequest({ targetType: "customer", targetId: "c1", label: "手机", phone: "12-34" }).ok, false);
assert.equal(parseContactPhoneCreateRequest({ targetType: "customer", targetId: "c1", label: "手机", phone: "abc123456" }).ok, false);
assert.equal(parseContactPhoneCreateRequest({ targetType: "prospect", targetId: "c1", label: "手机", phone: "+46111333444" }).ok, false);
assert.equal(parseContactPhoneCreateRequest({ targetType: "customer", targetId: "c1", label: "手机", phone: "+46111333444", phones: [] }).ok, false);
assert.equal(parseContactPhoneCreateRequest(["+46111333444"]).ok, false);

const updated = parseContactPhoneUpdateRequest({
  targetType: "lead",
  targetId: "l1",
  phoneId: "contact-phone:1",
  label: "总机",
  phone: "+46555000111"
});
assert.equal(updated.ok, true);
assert.equal(parseContactPhoneUpdateRequest({ targetType: "lead", targetId: "l1", phoneId: "contact-phone:1", label: "总机" }).ok, false);
assert.equal(parseContactPhoneDeleteRequest({ targetType: "customer", targetId: "c1", phoneId: "contact-phone:1" }).ok, true);
assert.equal(parseContactPhoneDeleteRequest({ targetType: "customer", targetId: "c1", phoneId: "contact-phone:1", phoneIds: ["a"] }).ok, false);
assert.equal(contactPhoneAuditValue("手机", phone).includes(phone), false);
assert.match(contactPhoneAuditValue("手机", phone), /手机\|/);

const customer = { id: "c1", teamId: "europe", ownerId: "u1", phone };
const lead = { id: "l1", teamId: "europe", phone: "+46555000999", deletedAt: "" };
const deletedLead = { id: "l2", teamId: "europe", phone: "+46555000888", deletedAt: "2026-11-01T00:00:00.000Z" };
const store = {
  contactPhones: [] as ContactPhone[],
  customers: [customer],
  leads: [lead, deletedLead],
  websiteOpportunities: [],
  prospectContactChannels: [],
  outboundCallAudits: [],
  phoneValidities: []
};
const planned = planLegacyContactPhones([], store);
assert.equal(planned.length, 2);
assert.equal(customer.phone, phone);
assert.equal(planned.find((item) => item.targetId === "c1")?.phone, phone);
assert.equal(planned.find((item) => item.targetId === "c1")?.phoneId, "customer-phone:c1");
assert.equal(planned.find((item) => item.targetId === "c1")?.origin, "legacy");
assert.equal(planned.some((item) => item.targetId === "l2"), false);
assert.equal(planLegacyContactPhones(planned, store).length, 0);

const inserted = applyLegacyContactPhoneMigration(store);
assert.equal(inserted, 2);
assert.equal(customer.phone, phone);
assert.equal(store.contactPhones.length, 2);
assert.equal(applyLegacyContactPhoneMigration(store), 0);
assert.equal(store.contactPhones.length, 2);
assert.equal(listObjectPhones(store, "europe", "customer", "c1").length, 1);
assert.equal(listObjectPhones(store, "europe", "customer", "c1")[0]?.phone, phone);
assert.equal(listObjectPhones(store, "europe", "customer", "c1")[0]?.phoneId, "customer-phone:c1");

customer.phone = "+46999000111";
assert.equal(listObjectPhones(store, "europe", "customer", "c1").length, 1);
assert.equal(listObjectPhones(store, "europe", "customer", "c1")[0]?.phone, "+46999000111");
assert.equal(applyLegacyContactPhoneMigration(store), 0);
assert.equal(customer.phone, "+46999000111");
assert.equal(store.contactPhones.length, 2);

customer.phone = "";
assert.equal(listObjectPhones(store, "europe", "customer", "c1")[0]?.phone, phone);
customer.phone = phone;
store.contactPhones.push({
  id: "cph_extra",
  teamId: "europe",
  targetType: "customer",
  targetId: "c1",
  phoneId: "contact-phone:extra",
  label: "手机",
  phone: "+46700001111",
  phoneDigits: "46700001111",
  origin: "extra",
  updatedBy: "u1",
  updatedAt: "2026-11-01T00:00:00.000Z"
});
const listed = listObjectPhones(store, "europe", "customer", "c1");
assert.equal(listed.length, 2);
assert.equal(listed.some((item) => item.phoneId === "contact-phone:extra"), true);
assert.equal(applyLegacyContactPhoneMigration(store), 0);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CONTACT_PHONE_SCHEMA_SQL/);
assert.match(schema, /CONTACT_PHONE_AUDIT_SCHEMA_SQL/);
assert.match(schema, /CONTACT_PHONE_LEGACY_CUSTOMER_SQL/);
assert.match(schema, /CONTACT_PHONE_LEGACY_LEAD_SQL/);
assert.match(schema, /phone VARCHAR\(40\) DEFAULT ''/);
assert.equal(schema.includes("DROP TABLE"), false);
assert.equal(schema.includes("RENAME TABLE"), false);
assert.equal(schema.includes("DROP COLUMN"), false);
for (const sql of [CONTACT_PHONE_SCHEMA_SQL, CONTACT_PHONE_AUDIT_SCHEMA_SQL, CONTACT_PHONE_LEGACY_CUSTOMER_SQL, CONTACT_PHONE_LEGACY_LEAD_SQL]) {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS|INSERT INTO contact_phones/);
  assert.equal(sql.includes("DROP "), false);
  assert.equal(sql.includes("RENAME "), false);
  assert.equal(sql.includes("DELETE "), false);
  assert.equal(sql.includes("UPDATE customers"), false);
  assert.equal(sql.includes("UPDATE leads"), false);
}
assert.match(CONTACT_PHONE_LEGACY_CUSTOMER_SQL, /NOT EXISTS/);
assert.match(CONTACT_PHONE_LEGACY_LEAD_SQL, /deleted_at IS NULL/);

const source = readFileSync(new URL("./contact-phone.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /convert_to_lead|convertProspectToLead|approved_contactable|MakeCall|aliyuncs\.com|requestOutboundCall|prospectSuppressionEvents/);

console.log("contact phone tests passed");
