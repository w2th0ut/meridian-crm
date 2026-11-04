import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { outboundHoldMessage, outboundHoldUntil } from "./outbound-call.js";
import { addCalendarDays, isCalendarDateKey, parseOutboundCallHoldClear, parseOutboundCallHoldQuery, parseOutboundCallHoldSet } from "./outbound-call-hold.js";
import type { CrmStore } from "./store.js";

assert.equal(parseOutboundCallHoldQuery({ scope: "mine" })?.scope, "mine");
assert.equal(parseOutboundCallHoldQuery({ scope: "team" })?.scope, "team");
assert.equal(parseOutboundCallHoldQuery({ scope: "mine", outcome: "其他" }), null);
assert.equal(parseOutboundCallHoldQuery({ scope: ["mine"] }), null);
assert.equal(parseOutboundCallHoldSet({ targetType: "customer", targetId: "c_1", untilOn: "2026-11-06", reason: "asked_later" }).ok, true);
assert.equal(parseOutboundCallHoldSet({ targetType: "customer", targetId: "c_1", untilOn: "2026-11-06", reason: "colleague", note: "  改日  " }).ok, true);
assert.equal(parseOutboundCallHoldSet({ targetType: "prospect", targetId: "c_1", untilOn: "2026-11-06", reason: "reached" }).ok, false);
assert.equal(parseOutboundCallHoldSet({ targetType: "customer", targetId: "c_1", untilOn: "2026-11-06", reason: "other", targets: ["c_1"] }).ok, false);
assert.equal(parseOutboundCallHoldSet({ targetType: "customer", targetId: "c_1", untilOn: "2026-11-31", reason: "other" }).ok, false);
assert.equal(parseOutboundCallHoldSet({ targetType: "customer", targetId: "c_1", untilOn: "2026-11-06", reason: "other", note: "字".repeat(201) }).ok, false);
assert.equal(parseOutboundCallHoldSet({ targetType: "customer", targetId: "c_1", untilOn: "2026-11-06", reason: "other", note: "字".repeat(200) }).ok, true);
assert.equal(parseOutboundCallHoldClear({ targetType: "lead", targetId: "l_1" }).ok, true);
assert.equal(parseOutboundCallHoldClear({ targetType: "lead", targetId: "l_1", untilOn: "2026-11-06" }).ok, false);
assert.equal(isCalendarDateKey("2026-02-29"), false);
assert.equal(isCalendarDateKey("2024-02-29"), true);
assert.equal(addCalendarDays("2026-11-04", 30), "2026-12-04");
assert.equal(addCalendarDays("2026-11-04", 31), "2026-12-05");

const store = { outboundCallHolds: [
  { teamId: "europe", targetType: "customer", targetId: "c1", active: true, untilOn: "2026-11-06" },
  { teamId: "europe", targetType: "customer", targetId: "c2", active: false, untilOn: "2026-11-06" },
  { teamId: "europe", targetType: "lead", targetId: "l1", active: true, untilOn: "2026-11-04" },
  { teamId: "asia", targetType: "customer", targetId: "c1", active: true, untilOn: "2026-11-08" }
] } as CrmStore;
assert.equal(outboundHoldUntil(store, "europe", "customer", "c1", "2026-11-04"), "2026-11-06");
assert.equal(outboundHoldUntil(store, "europe", "customer", "c1", "2026-11-06"), "");
assert.equal(outboundHoldUntil(store, "europe", "customer", "c2", "2026-11-04"), "");
assert.equal(outboundHoldUntil(store, "europe", "lead", "l1", "2026-11-04"), "");
assert.equal(outboundHoldUntil(store, "asia", "customer", "c1", "2026-11-04"), "2026-11-08");
assert.equal(outboundHoldMessage("2026-11-06"), "这个对象已暂停外呼，要到 2026-11-06 才可再拨");

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS outbound_call_holds \(/g) || []).length, 1);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS outbound_call_hold_audits \(/g) || []).length, 1);
assert.match(schema, /INSERT INTO outbound_call_holds/);
assert.match(schema, /INSERT INTO outbound_call_hold_audits/);
assert.match(schema, /WHERE NOT EXISTS/);
assert.match(schema, /team_id = ''/);
assert.equal(schema.includes("DROP TABLE outbound_call_holds"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS outbound_call_holds"), false);
assert.equal(schema.includes("DROP TABLE outbound_call_hold_audits"), false);
assert.equal(schema.includes("ALTER TABLE same_day_call_skips"), false);

const dial = readFileSync(new URL("./outbound-call.ts", import.meta.url), "utf8");
const skippedAt = dial.indexOf('reason = "skipped_today"');
const heldAt = dial.indexOf('reason = "held_until"');
assert.equal(skippedAt > 0 && heldAt > skippedAt, true);
assert.match(dial, /held_until: "这个对象已暂停外呼"/);
const feature = readFileSync(new URL("./outbound-call-hold.ts", import.meta.url), "utf8");
assert.equal(feature.includes("aliyuncs.com"), false);
assert.equal(feature.includes("MakeCall"), false);
assert.equal(feature.includes("convert_to_lead"), false);
assert.equal(feature.includes("approved_contactable"), false);

console.log("outbound call hold unit tests passed");
