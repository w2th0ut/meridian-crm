import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseCallPhoneValidityRequest,
  parsePhoneValidityRequest
} from "./phone-validity.js";
import {
  isPhoneMarkedInvalid,
  maskedTailMatches,
  resolveCallRecordPhone
} from "./phone-validity-state.js";

assert.equal(parseCallPhoneValidityRequest(undefined).ok, true);
assert.equal(parseCallPhoneValidityRequest(null).ok, true);
assert.equal(parseCallPhoneValidityRequest({}).ok, true);
assert.equal(parseCallPhoneValidityRequest({ invalid: true }).ok, true);
assert.equal(parseCallPhoneValidityRequest({ invalid: false }).ok, false);
assert.equal(parseCallPhoneValidityRequest({ invalid: true, records: ["a"] }).ok, false);
assert.equal(parseCallPhoneValidityRequest(["invalid"]).ok, false);
assert.equal(parseCallPhoneValidityRequest({ phoneIds: ["a"] }).ok, false);

const manual = parsePhoneValidityRequest({
  targetType: "customer",
  targetId: "c1",
  phoneId: "customer-phone:c1",
  invalid: false
});
assert.equal(manual.ok, true);
assert.equal(parsePhoneValidityRequest({ targetType: "customer", targetId: "c1", phoneId: "customer-phone:c1", invalid: "true" }).ok, false);
assert.equal(parsePhoneValidityRequest({ targetType: "vendor", targetId: "c1", phoneId: "x", invalid: true }).ok, false);
assert.equal(parsePhoneValidityRequest({ targetType: "lead", targetId: "l1", phoneId: "lead-phone:l1", invalid: true, targets: [] }).ok, false);

assert.equal(maskedTailMatches("+46111222333", "*******2333"), true);
assert.equal(maskedTailMatches("+46111222333", "*******9999"), false);
assert.equal(maskedTailMatches("1234", "****"), true);
assert.equal(maskedTailMatches("", "****"), false);

const store = {
  phoneValidities: [{
    id: "phv_1",
    teamId: "europe",
    targetType: "customer" as const,
    targetId: "c1",
    phoneId: "customer-phone:c1",
    updatedBy: "u1",
    updatedAt: "2026-11-01T00:00:00.000Z"
  }],
  outboundCallAudits: [],
  customers: [{ id: "c1", teamId: "europe", ownerId: "u1", phone: "+46111222333" }],
  leads: [],
  websiteOpportunities: [],
  prospectContactChannels: []
};
assert.equal(isPhoneMarkedInvalid(store, "europe", "customer-phone:c1"), true);
assert.equal(isPhoneMarkedInvalid(store, "asia", "customer-phone:c1"), false);
assert.equal(isPhoneMarkedInvalid(store, "europe", "customer-phone:c2"), false);

const matched = resolveCallRecordPhone(store, {
  teamId: "europe",
  targetType: "customer",
  targetId: "c1",
  maskedNumber: "*******2333",
  outboundCallAuditId: ""
});
assert.equal(matched.ok, true);
if (matched.ok) assert.equal(matched.phone.phoneId, "customer-phone:c1");
const changed = resolveCallRecordPhone(store, {
  teamId: "europe",
  targetType: "customer",
  targetId: "c1",
  maskedNumber: "*******9999",
  outboundCallAuditId: ""
});
assert.deepEqual(changed, { ok: false, reason: "number_changed" });

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS phone_validities \(/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS phone_validity_audits \(/);
assert.equal(schema.includes("CREATE TABLE phone_validities"), false);
assert.equal(schema.includes("CREATE TABLE phone_validity_audits"), false);

const source = readFileSync(new URL("./phone-validity.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /convert_to_lead|convertProspectToLead|approved_contactable|MakeCall|fetch\(|aliyuncs\.com|prospectSuppressionEvents/);
const gate = readFileSync(new URL("./outbound-call.ts", import.meta.url), "utf8");
assert.match(gate, /invalid_number/);
assert.match(gate, /isPhoneMarkedInvalid/);

console.log("phone validity tests passed");
