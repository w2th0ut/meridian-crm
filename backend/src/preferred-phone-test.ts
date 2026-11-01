import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  activePreferredPhoneId,
  parsePreferredPhoneClearRequest,
  parsePreferredPhoneRequest,
  releasePreferredPhonesMarkedInvalid
} from "./preferred-phone.js";
import type { PreferredPhone, PreferredPhoneAudit } from "./types.js";

assert.equal(parsePreferredPhoneRequest({ targetType: "customer", targetId: "c1", phoneId: "customer-phone:c1" }).ok, true);
assert.equal(parsePreferredPhoneRequest({ targetType: "lead", targetId: "l1", phoneId: "lead-phone:l1" }).ok, true);
assert.equal(parsePreferredPhoneRequest({ targetType: "customer", targetId: "c1", phoneId: "  customer-phone:c1  " }).ok, true);
assert.equal(parsePreferredPhoneRequest({ targetType: "customer", targetId: "c1" }).ok, false);
assert.equal(parsePreferredPhoneRequest({ targetType: "customer", targetId: "c1", phoneId: " " }).ok, false);
assert.equal(parsePreferredPhoneRequest({ targetType: "vendor", targetId: "c1", phoneId: "x" }).ok, false);
assert.equal(parsePreferredPhoneRequest({ targetType: "customer", targetId: "c1", phoneId: "customer-phone:c1", phones: [] }).ok, false);
assert.equal(parsePreferredPhoneRequest({ targetType: "customer", targetId: "c1", phoneId: "customer-phone:c1", phoneIds: ["a"] }).ok, false);
assert.equal(parsePreferredPhoneRequest(["customer-phone:c1"]).ok, false);

const cleared = parsePreferredPhoneClearRequest({ targetType: "prospect", targetId: "cand-1" });
assert.equal(cleared.ok, true);
assert.equal(parsePreferredPhoneClearRequest({ targetType: "prospect", targetId: "cand-1", phoneId: "ch" }).ok, false);
assert.equal(parsePreferredPhoneClearRequest({ targetType: "lead", targetId: "l1", targets: [] }).ok, false);

const store = {
  preferredPhones: [] as PreferredPhone[],
  preferredPhoneAudits: [] as PreferredPhoneAudit[],
  customers: [{ id: "c1", teamId: "europe", ownerId: "u1", phone: "+46111222333" }],
  leads: [],
  websiteOpportunities: [],
  prospectContactChannels: [],
  outboundCallAudits: []
};
assert.equal(activePreferredPhoneId(store, "europe", "customer", "c1"), "");
store.preferredPhones.push({
  id: "pph_1",
  teamId: "europe",
  targetType: "customer",
  targetId: "c1",
  phoneId: "customer-phone:c1",
  updatedBy: "u1",
  updatedAt: "2026-11-01T00:00:00.000Z"
});
assert.equal(activePreferredPhoneId(store, "europe", "customer", "c1"), "customer-phone:c1");
store.customers[0].phone = "";
assert.equal(activePreferredPhoneId(store, "europe", "customer", "c1"), "");

store.customers[0].phone = "+46111222333";
releasePreferredPhonesMarkedInvalid(store, { id: "u1", teamId: "europe" }, "customer-phone:c1");
assert.equal(store.preferredPhones.length, 0);
assert.equal(store.preferredPhoneAudits.length, 1);
assert.equal(store.preferredPhoneAudits[0]?.reason, "marked_invalid");
assert.equal(store.preferredPhoneAudits[0]?.action, "clear");
assert.equal(store.preferredPhoneAudits[0]?.previousPhoneId, "customer-phone:c1");
assert.equal(store.preferredPhoneAudits[0]?.nextPhoneId, "");
assert.equal(store.preferredPhoneAudits[0]?.actorId, "u1");
assert.equal(JSON.stringify(store.preferredPhoneAudits[0]).includes("+46111222333"), false);
releasePreferredPhonesMarkedInvalid(store, { id: "u1", teamId: "europe" }, "customer-phone:c1");
assert.equal(store.preferredPhoneAudits.length, 1);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS preferred_phones \(/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS preferred_phone_audits \(/);
assert.equal(schema.includes("CREATE TABLE preferred_phones"), false);
assert.equal(schema.includes("CREATE TABLE preferred_phone_audits"), false);

const source = readFileSync(new URL("./preferred-phone.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /convert_to_lead|convertProspectToLead|approved_contactable|MakeCall|fetch\(|aliyuncs\.com|prospectSuppressionEvents|requestOutboundCall/);
const validity = readFileSync(new URL("./phone-validity.ts", import.meta.url), "utf8");
assert.match(validity, /releasePreferredPhonesMarkedInvalid/);

console.log("preferred phone tests passed");
