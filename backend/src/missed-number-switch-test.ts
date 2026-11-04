import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseMissedNumberSwitchRequest,
  pickAlternatePhoneId,
  selectLatestObjectCall,
  switchPreferredAfterMiss
} from "./missed-number-switch.js";
import type { CrmStore } from "./store.js";
import type { OutboundCallAudit, OutboundCallRecord, PhoneValidity, PreferredPhone, PreferredPhoneAudit, SessionUser } from "./types.js";

assert.equal(parseMissedNumberSwitchRequest({ targetType: "customer", targetId: "c_1" }).ok, true);
assert.equal(parseMissedNumberSwitchRequest({ targetType: "lead", targetId: " l_1 " }).ok, true);
assert.equal(parseMissedNumberSwitchRequest({ targetType: "prospect", targetId: "p_1", phoneId: "ch" }).ok, false);
assert.equal(parseMissedNumberSwitchRequest({ targetType: "customer", targetId: "c_1", phones: [] }).ok, false);
assert.equal(parseMissedNumberSwitchRequest({ targetType: "customer", targetId: "c_1", targets: ["c_1"] }).ok, false);
assert.equal(parseMissedNumberSwitchRequest(["c_1"]).ok, false);
assert.equal(parseMissedNumberSwitchRequest({ targetType: "vendor", targetId: "c_1" }).ok, false);

assert.equal(pickAlternatePhoneId(
  [{ phoneId: "a" }, { phoneId: "b" }, { phoneId: "c" }],
  "a",
  (phoneId) => phoneId === "b"
), "c");
assert.equal(pickAlternatePhoneId([{ phoneId: "a" }], "a", () => false), "");
assert.equal(pickAlternatePhoneId([{ phoneId: "a" }, { phoneId: "b" }], "a", () => true), "");

const ranked = selectLatestObjectCall([
  { id: "a", teamId: "europe", targetType: "customer", targetId: "c1", startTimeRaw: "1000", createdAt: "", updatedAt: "2026-11-01T00:00:00.000Z" },
  { id: "b", teamId: "europe", targetType: "customer", targetId: "c1", startTimeRaw: "1000", createdAt: "", updatedAt: "2026-11-01T00:00:00.000Z" },
  { id: "old", teamId: "europe", targetType: "customer", targetId: "c1", startTimeRaw: "500", createdAt: "", updatedAt: "2026-11-02T00:00:00.000Z" },
  { id: "other", teamId: "asia", targetType: "customer", targetId: "c1", startTimeRaw: "9000", createdAt: "", updatedAt: "" }
], "europe", "customer", "c1");
assert.equal(ranked?.id, "b");

function user(permissions: SessionUser["iamPermissions"]): SessionUser {
  return {
    id: "u1",
    name: "U",
    email: "u@example.com",
    role: "sales",
    teamId: "europe",
    avatar: "",
    authVersion: 1,
    iamPermissions: permissions
  };
}

const writer = user({
  "customer.update": ["tenant"],
  "lead.update": ["tenant"],
  "prospect.execute": ["tenant"]
});

function record(partial: Partial<OutboundCallRecord> & Pick<OutboundCallRecord, "id" | "targetType" | "targetId">): OutboundCallRecord {
  return {
    teamId: "europe",
    instanceId: "ccc-demo",
    contactId: partial.id,
    outboundCallAuditId: "",
    maskedNumber: "2333",
    contactType: "OUTBOUND",
    contactDisposition: "Success",
    earlyMediaState: "",
    callDurationRaw: "",
    establishedTimeRaw: "",
    releaseTimeRaw: "",
    startTimeRaw: "1000",
    agentIds: "agent-a",
    recordingReady: null,
    recordingRef: "",
    recordingFileName: "",
    recordingUrl: "https://secret.example/do-not-leak",
    recordingDurationRaw: "",
    followUpActivityId: "",
    callOutcome: "",
    callOutcomeNote: "",
    callNote: "纪要不要出现",
    callNoteTags: "",
    callNoteUpdatedAt: "",
    callScriptTemplateId: "",
    callScriptUpdatedAt: "",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...partial
  };
}

function audit(partial: Partial<OutboundCallAudit> & Pick<OutboundCallAudit, "id" | "phoneId" | "targetType" | "targetId">): OutboundCallAudit {
  return {
    teamId: "europe",
    actorId: "u1",
    at: "2026-11-01T00:00:00.000Z",
    maskedNumber: "2333",
    result: "allowed",
    reason: "",
    jobId: "job-1",
    ...partial
  };
}

const store = {
  customers: [
    { id: "c1", teamId: "europe", ownerId: "u1", phone: "+46111222333", poolStatus: "owned", nextReminder: "keep" },
    { id: "c-pool", teamId: "europe", ownerId: "u1", phone: "+46111000011", poolStatus: "public", nextReminder: "pool" },
    { id: "c-asia", teamId: "asia", ownerId: "u-asia", phone: "+85291110000", poolStatus: "owned", nextReminder: "asia" }
  ],
  leads: [
    { id: "l1", teamId: "europe", ownerId: "u1", phone: "+46111222333", deletedAt: "" },
    { id: "l-gone", teamId: "europe", ownerId: "u1", phone: "+46111222333", deletedAt: "2026-11-01T00:00:00.000Z" }
  ],
  websiteOpportunities: [
    { id: "p1", teamId: "europe", ownerId: "u1", tenantProspectId: "tp1" }
  ],
  prospectContactChannels: [
    { id: "ch-a", teamId: "europe", ownerId: "u1", prospectId: "tp1", channelType: "phone", value: "+46111222333" },
    { id: "ch-b", teamId: "europe", ownerId: "u1", prospectId: "tp1", channelType: "phone", value: "+46700999888" },
    { id: "ch-same-1", teamId: "europe", ownerId: "u1", prospectId: "tp-same", channelType: "phone", value: "+46111000111" },
    { id: "ch-same-2", teamId: "europe", ownerId: "u1", prospectId: "tp-same", channelType: "phone", value: "+46777000111" }
  ],
  contactPhones: [
    { teamId: "europe", targetType: "customer", targetId: "c1", phoneId: "contact-phone:b", phone: "+46700999888" },
    { teamId: "europe", targetType: "customer", targetId: "c1", phoneId: "contact-phone:c", phone: "+46700888777" },
    { teamId: "europe", targetType: "lead", targetId: "l1", phoneId: "contact-phone:lead", phone: "+46700999888" }
  ],
  phoneValidities: [] as PhoneValidity[],
  outboundCallAudits: [] as OutboundCallAudit[],
  outboundCallRecords: [] as OutboundCallRecord[],
  preferredPhones: [] as PreferredPhone[],
  preferredPhoneAudits: [] as PreferredPhoneAudit[],
  users: [],
  async persist() {}
} as unknown as CrmStore;

function audits() {
  return store.preferredPhoneAudits;
}

store.outboundCallAudits.push(
  audit({ id: "oca-c", phoneId: "customer-phone:c1", targetType: "customer", targetId: "c1" }),
  audit({ id: "oca-l", phoneId: "lead-phone:l1", targetType: "lead", targetId: "l1", maskedNumber: "2333" }),
  audit({ id: "oca-p", phoneId: "ch-a", targetType: "prospect", targetId: "p1", maskedNumber: "2333" })
);
store.preferredPhones.push({
  id: "pph_seed",
  teamId: "europe",
  targetType: "customer",
  targetId: "c1",
  phoneId: "customer-phone:c1",
  updatedBy: "u1",
  updatedAt: "2026-11-01T00:00:00.000Z"
});

const anonymous = await switchPreferredAfterMiss(store, undefined, { targetType: "customer", targetId: "c1" });
assert.equal(anonymous.status, 401);
assert.equal(audits().length, 0);

const invalid = await switchPreferredAfterMiss(store, writer, { targetType: "customer", targetId: "c1", records: [] });
assert.equal(invalid.status, 400);
assert.equal(invalid.body.reason, "invalid_request");
assert.equal(audits().length, 0);

const noCall = await switchPreferredAfterMiss(store, writer, { targetType: "customer", targetId: "c1" });
assert.equal(noCall.status, 400);
assert.equal(noCall.body.reason, "no_call");
assert.equal(audits()[0]?.reason, "no_call");
assert.equal(store.preferredPhones[0]?.phoneId, "customer-phone:c1");

store.outboundCallRecords.push(record({
  id: "ocr-old-connected",
  targetType: "customer",
  targetId: "c1",
  startTimeRaw: "1000",
  establishedTimeRaw: "1",
  outboundCallAuditId: "oca-c"
}));
store.outboundCallRecords.push(record({
  id: "ocr-miss",
  targetType: "customer",
  targetId: "c1",
  startTimeRaw: "2000",
  establishedTimeRaw: "",
  contactDisposition: "Success",
  outboundCallAuditId: "oca-c",
  maskedNumber: "2333"
}));
store.phoneValidities.push({
  id: "pv-b",
  teamId: "europe",
  targetType: "customer",
  targetId: "c1",
  phoneId: "contact-phone:b",
  updatedBy: "u1",
  updatedAt: "2026-11-01T00:00:00.000Z"
});
const switched = await switchPreferredAfterMiss(store, writer, { targetType: "customer", targetId: "c1" });
assert.equal(switched.status, 200);
assert.equal(switched.body.result, "updated");
assert.equal(switched.body.action, "update");
assert.equal(switched.body.phoneId, "contact-phone:c");
assert.equal(switched.body.callRecordId, "ocr-miss");
assert.equal(store.preferredPhones.find((item) => item.targetId === "c1")?.phoneId, "contact-phone:c");
const successAudit = audits().find((item) => item.reason === "missed_alternate");
assert.ok(successAudit);
assert.equal(successAudit.previousPhoneId, "customer-phone:c1");
assert.equal(successAudit.nextPhoneId, "contact-phone:c");
assert.equal(JSON.stringify(successAudit).includes("+46111222333"), false);
assert.equal(JSON.stringify(successAudit).includes("secret.example"), false);
assert.equal(JSON.stringify(switched.body).includes("纪要不要出现"), false);
assert.equal(store.customers[0]?.nextReminder, "keep");
assert.equal(store.phoneValidities.length, 1);

const again = await switchPreferredAfterMiss(store, writer, { targetType: "customer", targetId: "c1" });
assert.equal(again.status, 200);
assert.equal(again.body.result, "unchanged");
assert.equal(audits().filter((item) => item.reason === "missed_alternate").length, 1);

store.outboundCallRecords.push(record({
  id: "ocr-connected",
  targetType: "customer",
  targetId: "c1",
  startTimeRaw: "3000",
  establishedTimeRaw: "  9  ",
  outboundCallAuditId: "oca-c"
}));
const connected = await switchPreferredAfterMiss(store, writer, { targetType: "customer", targetId: "c1" });
assert.equal(connected.status, 400);
assert.equal(connected.body.reason, "already_connected");
assert.equal(connected.body.callRecordId, "ocr-connected");
assert.equal(store.preferredPhones.find((item) => item.targetId === "c1")?.phoneId, "contact-phone:c");

store.outboundCallRecords.push(record({
  id: "ocr-blank",
  targetType: "customer",
  targetId: "c1",
  startTimeRaw: "4000",
  establishedTimeRaw: "   ",
  outboundCallAuditId: "oca-c",
  maskedNumber: "9999"
}));
const unresolved = await switchPreferredAfterMiss(store, writer, { targetType: "customer", targetId: "c1" });
assert.equal(unresolved.status, 400);
assert.equal(unresolved.body.reason, "number_unresolved");
assert.equal(store.preferredPhones.find((item) => item.targetId === "c1")?.phoneId, "contact-phone:c");

const onlyOne = await switchPreferredAfterMiss(store, writer, { targetType: "customer", targetId: "c-pool" });
assert.equal(onlyOne.status, 409);
assert.equal(onlyOne.body.reason, "public_pool");
assert.equal(store.customers[1]?.nextReminder, "pool");

const foreign = await switchPreferredAfterMiss(store, writer, { targetType: "customer", targetId: "c-asia" });
assert.equal(foreign.status, 404);
assert.equal(foreign.body.reason, "not_found");
assert.equal(audits().at(0)?.teamId, "europe");
assert.equal(store.preferredPhones.some((item) => item.targetId === "c-asia"), false);

const outsider = user({ "customer.update": ["self"] });
outsider.id = "u-other";
const denied = await switchPreferredAfterMiss(store, outsider, { targetType: "customer", targetId: "c1" });
assert.equal(denied.status, 403);
assert.equal(store.preferredPhones.find((item) => item.targetId === "c1")?.phoneId, "contact-phone:c");

store.outboundCallRecords.push(record({
  id: "ocr-lead",
  targetType: "lead",
  targetId: "l1",
  startTimeRaw: "2000",
  establishedTimeRaw: "",
  outboundCallAuditId: "oca-l",
  maskedNumber: "2333"
}));
const lead = await switchPreferredAfterMiss(store, writer, { targetType: "lead", targetId: "l1" });
assert.equal(lead.status, 200);
assert.equal(lead.body.action, "set");
assert.equal(lead.body.phoneId, "contact-phone:lead");
assert.equal(audits().find((item) => item.targetId === "l1" && item.result === "updated")?.reason, "missed_alternate");

const gone = await switchPreferredAfterMiss(store, writer, { targetType: "lead", targetId: "l-gone" });
assert.equal(gone.status, 404);
assert.equal(store.preferredPhones.some((item) => item.targetId === "l-gone"), false);

store.outboundCallRecords.push(record({
  id: "ocr-prospect",
  targetType: "prospect",
  targetId: "p1",
  startTimeRaw: "2000",
  establishedTimeRaw: "",
  outboundCallAuditId: "oca-p",
  maskedNumber: "2333"
}));
const prospect = await switchPreferredAfterMiss(store, writer, { targetType: "prospect", targetId: "p1" });
assert.equal(prospect.status, 200);
assert.equal(prospect.body.phoneId, "ch-b");

store.websiteOpportunities.push({ id: "p-same", teamId: "europe", ownerId: "u1", tenantProspectId: "tp-same" } as never);
store.outboundCallRecords.push(record({
  id: "ocr-same",
  targetType: "prospect",
  targetId: "p-same",
  startTimeRaw: "2000",
  establishedTimeRaw: "",
  outboundCallAuditId: "",
  maskedNumber: "1111"
}));
const ambiguous = await switchPreferredAfterMiss(store, writer, { targetType: "prospect", targetId: "p-same" });
assert.equal(ambiguous.status, 400);
assert.equal(ambiguous.body.reason, "number_unresolved");
assert.equal(store.preferredPhones.some((item) => item.targetId === "p-same"), false);

const solo = {
  customers: [{ id: "c-solo", teamId: "europe", ownerId: "u1", phone: "+46111222333", poolStatus: "owned" }],
  leads: [],
  websiteOpportunities: [],
  prospectContactChannels: [],
  contactPhones: [],
  phoneValidities: [],
  outboundCallAudits: [audit({ id: "oca-solo", phoneId: "customer-phone:c-solo", targetType: "customer", targetId: "c-solo" })],
  outboundCallRecords: [record({
    id: "ocr-solo",
    targetType: "customer",
    targetId: "c-solo",
    outboundCallAuditId: "oca-solo",
    maskedNumber: "2333"
  })],
  preferredPhones: [] as PreferredPhone[],
  preferredPhoneAudits: [] as PreferredPhoneAudit[],
  users: [],
  async persist() {}
} as unknown as CrmStore;
const noAlternate = await switchPreferredAfterMiss(solo, writer, { targetType: "customer", targetId: "c-solo" });
assert.equal(noAlternate.status, 400);
assert.equal(noAlternate.body.reason, "no_alternate");
assert.equal(solo.preferredPhones.length, 0);
assert.equal(solo.preferredPhoneAudits[0]?.reason, "no_alternate");
assert.equal(JSON.stringify(solo.preferredPhoneAudits[0]).includes("+46111222333"), false);

const source = readFileSync(new URL("./missed-number-switch.ts", import.meta.url), "utf8");
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("outbound_call_holds"), false);
assert.equal(source.includes("outbound_call_hold_audits"), false);
assert.equal(source.includes("same_day_call_skips"), false);
assert.equal(source.includes("CREATE TABLE"), false);

console.log("missed number switch unit tests passed");
