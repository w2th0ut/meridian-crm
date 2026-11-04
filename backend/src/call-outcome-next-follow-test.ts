import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCallOutcomeBatchRequest } from "./call-outcome-batch.js";
import { parseCallOutcomeRequest } from "./call-outcome.js";
import {
  addCalendarDays,
  callOutcomeNextFollowAt,
  parseCallOutcomeNextFollowChoice,
  planCallOutcomeNextFollow
} from "./call-outcome-next-follow.js";
import { setTenantTimezoneOverride } from "./outbound-call.js";
import type { CrmStore } from "./store.js";
import type { SessionUser, WebsiteOpportunity } from "./types.js";

assert.deepEqual(parseCallOutcomeNextFollowChoice(undefined), { ok: true, choice: "none" });
assert.deepEqual(parseCallOutcomeNextFollowChoice("  "), { ok: true, choice: "none" });
assert.deepEqual(parseCallOutcomeNextFollowChoice("不设"), { ok: true, choice: "none" });
assert.deepEqual(parseCallOutcomeNextFollowChoice("明天"), { ok: true, choice: "tomorrow" });
assert.deepEqual(parseCallOutcomeNextFollowChoice("3 天后"), { ok: true, choice: "plus3" });
assert.deepEqual(parseCallOutcomeNextFollowChoice("1周后"), { ok: true, choice: "plus7" });
assert.equal(parseCallOutcomeNextFollowChoice("下周一").ok, false);
assert.equal(parseCallOutcomeNextFollowChoice(3).ok, false);

assert.deepEqual(parseCallOutcomeRequest({ outcome: "无意向", nextFollowChoice: "none" }), {
  ok: true,
  outcome: "无意向",
  note: "",
  nextFollowChoice: "none",
  markNumberInvalid: false
});
assert.equal(parseCallOutcomeRequest({ outcome: "有意向", nextFollowChoice: "下周" }).ok, false);
assert.equal(parseCallOutcomeRequest({ outcome: "有意向", nextFollowAt: "2026-11-07 09:00" }).ok, false);
assert.equal(parseCallOutcomeBatchRequest({
  callRecordIds: ["ocr_1"],
  outcome: "有意向",
  nextFollowChoice: "tomorrow"
}).ok, false);

assert.equal(addCalendarDays("2026-11-06", 1), "2026-11-07");
assert.equal(addCalendarDays("2026-11-06", 3), "2026-11-09");
assert.equal(addCalendarDays("2026-11-06", 7), "2026-11-13");

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
const friday = new Date("2026-11-06T02:30:00.000Z");
assert.equal(await callOutcomeNextFollowAt(store, "europe", "tomorrow", friday), "2026-11-07 09:00");
assert.equal(await callOutcomeNextFollowAt(store, "europe", "plus3", friday), "2026-11-09 09:00");
assert.equal(await callOutcomeNextFollowAt(store, "europe", "plus7", friday), "2026-11-13 09:00");
store.aliyunOutboundConfigs[0].callWindowStart = "10:30";
assert.equal(await callOutcomeNextFollowAt(store, "europe", "tomorrow", friday), "2026-11-07 10:30");
setTenantTimezoneOverride(store, "europe", "America/New_York");
store.aliyunOutboundConfigs[0].callWindowStart = "09:00";
assert.equal(await callOutcomeNextFollowAt(store, "europe", "tomorrow", friday), "2026-11-06 09:00");

const user = { id: "u1", teamId: "europe", role: "sales", name: "U", email: "u@example.com" } as SessionUser;
const planned = await planCallOutcomeNextFollow(
  store,
  user,
  { targetType: "customer", targetId: "c_sup" },
  "tomorrow",
  friday
);
assert.equal(planned.ok, true);
if (planned.ok && planned.kind === "write") {
  assert.match(planned.notice, /不改变抑制状态/);
  assert.equal(store.customers[0].nextReminder, "保持");
}
const skipped = await planCallOutcomeNextFollow(store, user, { targetType: "customer", targetId: "c_sup" }, "none", friday);
assert.equal(skipped.ok && skipped.kind === "skip", true);
setTenantTimezoneOverride(store, "europe", undefined);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
const tableStart = schema.indexOf("CREATE TABLE IF NOT EXISTS next_follow_up_audits");
const tableEnd = schema.indexOf("CREATE TABLE IF NOT EXISTS prospect_note_audits", tableStart);
assert.ok(tableStart > 0 && tableEnd > tableStart);
const table = schema.slice(tableStart, tableEnd);
assert.match(table, /call_record_id VARCHAR\(64\) NULL/);
assert.match(schema, /ensureColumn\(pool, "next_follow_up_audits", "call_record_id", "VARCHAR\(64\) NULL"\)/);
assert.equal(schema.includes("CREATE TABLE call_outcome_next_follow"), false);
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

console.log("call outcome next follow tests passed");
