import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sameDaySkipActive } from "./outbound-call.js";
import { parseSameDayCallSkipClear, parseSameDayCallSkipQuery, parseSameDayCallSkipSet } from "./same-day-call-skip.js";
import type { CrmStore } from "./store.js";

assert.equal(parseSameDayCallSkipQuery({ scope: "mine" })?.scope, "mine");
assert.equal(parseSameDayCallSkipQuery({ scope: "team" })?.scope, "team");
assert.equal(parseSameDayCallSkipQuery({ scope: "mine", outcome: "其他" }), null);
assert.equal(parseSameDayCallSkipQuery({ scope: ["mine"] }), null);
assert.equal(parseSameDayCallSkipSet({ targetType: "customer", targetId: "c_1", reason: "reached" }).ok, true);
assert.equal(parseSameDayCallSkipSet({ targetType: "customer", targetId: "c_1", reason: "reached", note: "  改日  " }).ok, true);
assert.equal(parseSameDayCallSkipSet({ targetType: "prospect", targetId: "c_1", reason: "nope" }).ok, false);
assert.equal(parseSameDayCallSkipSet({ targetType: "customer", targetId: "c_1", reason: "other", targets: ["c_1"] }).ok, false);
assert.equal(parseSameDayCallSkipSet({ targetType: "customer", targetId: "c_1", reason: "other", note: "字".repeat(201) }).ok, false);
assert.equal(parseSameDayCallSkipSet({ targetType: "customer", targetId: "c_1", reason: "other", note: "字".repeat(200) }).ok, true);
assert.equal(parseSameDayCallSkipClear({ targetType: "lead", targetId: "l_1" }).ok, true);
assert.equal(parseSameDayCallSkipClear({ targetType: "lead", targetId: "l_1", reason: "other" }).ok, false);

const store = { sameDayCallSkips: [
  { teamId: "europe", targetType: "customer", targetId: "c1", active: true, skipOn: "2026-11-04" },
  { teamId: "europe", targetType: "customer", targetId: "c2", active: false, skipOn: "2026-11-04" },
  { teamId: "europe", targetType: "lead", targetId: "l1", active: true, skipOn: "2026-11-03" }
] } as CrmStore;
assert.equal(sameDaySkipActive(store, "europe", "customer", "c1", "2026-11-04"), true);
assert.equal(sameDaySkipActive(store, "europe", "customer", "c2", "2026-11-04"), false);
assert.equal(sameDaySkipActive(store, "europe", "lead", "l1", "2026-11-04"), false);
assert.equal(sameDaySkipActive(store, "asia", "customer", "c1", "2026-11-04"), false);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS same_day_call_skips \(/g) || []).length, 1);
assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS same_day_call_skip_audits \(/g) || []).length, 1);
assert.match(schema, /INSERT INTO same_day_call_skips/);
assert.match(schema, /INSERT INTO same_day_call_skip_audits/);
assert.match(schema, /WHERE NOT EXISTS/);
assert.match(schema, /team_id = ''/);
assert.equal(schema.includes("DROP TABLE same_day_call_skips"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS same_day_call_skips"), false);
assert.equal(schema.includes("DROP TABLE same_day_call_skip_audits"), false);

const dial = readFileSync(new URL("./outbound-call.ts", import.meta.url), "utf8");
const invalidAt = dial.indexOf('if (!reason && isPhoneMarkedInvalid');
const skippedAt = dial.indexOf('reason = "skipped_today"');
assert.equal(invalidAt > 0 && skippedAt > invalidAt, true);
assert.match(dial, /skipped_today: "这个对象今天已标记不再拨打"/);
const feature = readFileSync(new URL("./same-day-call-skip.ts", import.meta.url), "utf8");
assert.equal(feature.includes("aliyuncs.com"), false);
assert.equal(feature.includes("MakeCall"), false);
assert.equal(feature.includes("convert_to_lead"), false);
assert.equal(feature.includes("approved_contactable"), false);

console.log("same-day call skip unit tests passed");
