import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isEstablishedCall } from "./outbound-call-records.js";
import { zonedDateKey } from "./outbound-call.js";
import { nextBusinessDateKey } from "./outbound-missed-follow-up.js";

const friday = new Date("2026-10-30T03:00:00.000Z");
assert.equal(zonedDateKey(friday, "Asia/Shanghai"), "2026-10-30");
assert.equal(zonedDateKey(friday, "America/New_York"), "2026-10-29");
assert.equal(nextBusinessDateKey("2026-10-30"), "2026-11-02");
assert.equal(nextBusinessDateKey("2026-10-29"), "2026-10-30");
assert.equal(nextBusinessDateKey("2026-10-31"), "2026-11-02");
assert.equal(nextBusinessDateKey("2026-11-01"), "2026-11-02");
assert.equal(nextBusinessDateKey("2026-11-02"), "2026-11-03");

assert.equal(isEstablishedCall(""), false);
assert.equal(isEstablishedCall("   "), false);
assert.equal(isEstablishedCall("1"), true);
assert.equal(isEstablishedCall("0"), true);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS outbound_missed_follow_ups \(/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS outbound_missed_follow_up_audits \(/);
assert.equal(schema.includes("CREATE TABLE outbound_missed_follow_ups"), false);
assert.equal(schema.includes("CREATE TABLE outbound_missed_follow_up_audits"), false);
assert.match(schema, /uniq_outbound_missed_follow_up_record/);

const source = readFileSync(new URL("./outbound-missed-follow-up.ts", import.meta.url), "utf8");
assert.match(source, /isEstablishedCall/);
assert.doesNotMatch(source, /makeCall|MakeCall|aliyuncs|convert_to_lead|convertProspect|send-development-email|unsuppress/i);

console.log("outbound missed follow-up tests passed");
