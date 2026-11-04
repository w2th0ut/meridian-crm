import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCallOutcomeBatchRequest } from "./call-outcome-batch.js";
import { parseCallOutcomeRequest } from "./call-outcome.js";
import {
  callOutcomeNextFollowAt,
  isSameDayFollowChoice,
  parseCallOutcomeNextFollowChoice,
  planCallOutcomeNextFollow
} from "./call-outcome-next-follow.js";
import { setTenantTimezoneOverride } from "./outbound-call.js";
import type { CrmStore } from "./store.js";
import type { SessionUser, WebsiteOpportunity } from "./types.js";

assert.deepEqual(parseCallOutcomeNextFollowChoice("2 小时后"), { ok: true, choice: "plus2h" });
assert.deepEqual(parseCallOutcomeNextFollowChoice("2小时后"), { ok: true, choice: "plus2h" });
assert.deepEqual(parseCallOutcomeNextFollowChoice("4小时后"), { ok: true, choice: "plus4h" });
assert.deepEqual(parseCallOutcomeNextFollowChoice(" plus4h "), { ok: true, choice: "plus4h" });
assert.equal(parseCallOutcomeNextFollowChoice("2小时").ok, false);
assert.equal(isSameDayFollowChoice("plus2h"), true);
assert.equal(isSameDayFollowChoice("tomorrow"), false);

assert.deepEqual(parseCallOutcomeRequest({ outcome: "其他", nextFollowChoice: "plus2h" }), {
  ok: true,
  outcome: "其他",
  note: "",
  nextFollowChoice: "plus2h",
  markNumberInvalid: false,
  transferTo: ""
});
assert.equal(parseCallOutcomeBatchRequest({
  callRecordIds: ["ocr_1"],
  outcome: "其他",
  nextFollowChoice: "plus2h"
}).ok, false);

const store = {
  aliyunOutboundConfigs: [{ teamId: "europe", callWindowStart: "09:00", callWindowEnd: "20:00" }],
  customers: [{ id: "c_sup", teamId: "europe", ownerId: "u1", nextReminder: "保持", poolStatus: "owned" }],
  leads: [],
  websiteOpportunities: [{
    id: "p_sup",
    teamId: "europe",
    ownerId: "u1",
    customerId: "c_sup",
    status: "contacted",
    outreachState: "suppressed"
  } as WebsiteOpportunity],
  prospectSuppressionEvents: [],
  prospectContactVerificationSnapshots: [],
  tenantProspects: [],
  users: [{ id: "u1", teamId: "europe", status: "active", role: "sales" }],
  resolveIamDataScope: async () => ({ tenantWide: true, ownerIds: ["u1"] })
} as unknown as CrmStore;
setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");

const ten = new Date("2026-11-04T02:00:00.000Z");
assert.equal(await callOutcomeNextFollowAt(store, "europe", "plus2h", ten), "2026-11-04 12:00");
assert.equal(await callOutcomeNextFollowAt(store, "europe", "plus4h", ten), "2026-11-04 14:00");
assert.equal(await callOutcomeNextFollowAt(store, "europe", "tomorrow", ten), "2026-11-05 09:00");

const eighteen = new Date("2026-11-04T10:00:00.000Z");
assert.equal(await callOutcomeNextFollowAt(store, "europe", "plus2h", eighteen), "2026-11-04 20:00");
assert.equal(await callOutcomeNextFollowAt(store, "europe", "plus4h", eighteen), "2026-11-05 09:00");
const eighteenThirty = new Date("2026-11-04T10:30:00.000Z");
assert.equal(await callOutcomeNextFollowAt(store, "europe", "plus2h", eighteenThirty), "2026-11-05 09:00");

const early = new Date("2026-11-03T22:30:00.000Z");
assert.equal(await callOutcomeNextFollowAt(store, "europe", "plus2h", early), "2026-11-04 09:00");
assert.equal(await callOutcomeNextFollowAt(store, "europe", "plus4h", early), "2026-11-04 10:30");

store.aliyunOutboundConfigs[0].callWindowStart = "10:30";
store.aliyunOutboundConfigs[0].callWindowEnd = "18:30";
const eight = new Date("2026-11-04T00:00:00.000Z");
assert.equal(await callOutcomeNextFollowAt(store, "europe", "plus2h", eight), "2026-11-04 10:30");
assert.equal(await callOutcomeNextFollowAt(store, "europe", "plus4h", eight), "2026-11-04 12:00");
const atEnd = new Date("2026-11-04T08:30:00.000Z");
assert.equal(await callOutcomeNextFollowAt(store, "europe", "plus2h", atEnd), "2026-11-04 18:30");

store.aliyunOutboundConfigs[0].callWindowStart = "09:00";
store.aliyunOutboundConfigs[0].callWindowEnd = "20:00";
setTenantTimezoneOverride(store, "europe", "America/New_York");
assert.equal(await callOutcomeNextFollowAt(store, "europe", "plus2h", new Date("2026-11-04T15:00:00.000Z")), "2026-11-04 12:00");
assert.equal(await callOutcomeNextFollowAt(store, "europe", "plus2h", new Date("2026-11-04T02:00:00.000Z")), "2026-11-04 09:00");

const user = { id: "u1", teamId: "europe", role: "sales", name: "U", email: "u@example.com" } as SessionUser;
setTenantTimezoneOverride(store, "europe", "Asia/Shanghai");
const planned = await planCallOutcomeNextFollow(store, user, { targetType: "customer", targetId: "c_sup" }, "plus2h", ten);
assert.equal(planned.ok, true);
if (planned.ok && planned.kind === "write") {
  assert.equal(planned.next, "2026-11-04 12:00");
  assert.match(planned.notice, /不改变抑制状态/);
  assert.equal(store.customers[0].nextReminder, "保持");
  planned.apply();
  assert.equal(store.customers[0].nextReminder, "2026-11-04 12:00");
}
setTenantTimezoneOverride(store, "europe", undefined);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /ensureColumn\(pool, "next_follow_up_audits", "call_record_id", "VARCHAR\(64\) NULL"\)/);
assert.equal(schema.includes("CREATE TABLE call_outcome_same_day"), false);
assert.equal(schema.includes("CREATE TABLE IF NOT EXISTS same_day_missed"), false);
assert.equal(schema.includes("DROP TABLE next_follow_up_audits"), false);
assert.equal(schema.includes("DROP COLUMN call_record_id"), false);

const source = readFileSync(new URL("./call-outcome-next-follow.ts", import.meta.url), "utf8");
const outcome = readFileSync(new URL("./call-outcome.ts", import.meta.url), "utf8");
for (const text of [source, outcome]) {
  assert.equal(text.includes("convert_to_lead"), false);
  assert.equal(text.includes("approved_contactable"), false);
  assert.equal(text.includes("aliyuncs.com"), false);
  assert.equal(text.includes("MakeCall"), false);
  assert.equal(text.includes("makeCall"), false);
}
assert.match(outcome, /not_unanswered/);
assert.equal(outcome.includes("same_day_call_skips"), false);

console.log("call outcome same day follow tests passed");
