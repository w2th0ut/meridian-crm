import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PROSPECT_NEXT_FOLLOW_UP_BATCH_LIMIT,
  buildProspectNextFollowUpBody,
  earliestProspectNextFollowDate,
  showProspectNextFollowUpEntry,
  summarizeProspectNextFollowUpChange
} from "./prospect-batch-next-follow-up.js";

assert.equal(showProspectNextFollowUpEntry(false), false);
assert.equal(showProspectNextFollowUpEntry(true), true);

const now = new Date(2026, 9, 31, 15, 0, 0);
assert.equal(earliestProspectNextFollowDate(now), "2026-10-30");

const empty = buildProspectNextFollowUpBody([], "set", "2026-10-31", now);
assert.equal(empty.ok, false);
if (!empty.ok) assert.equal(empty.message, "请先选择候选");

const missing = buildProspectNextFollowUpBody(["web_seed_1"], "set", "  ", now);
assert.equal(missing.ok, false);
if (!missing.ok) assert.equal(missing.message, "请填写下次跟进日期");

const invalid = buildProspectNextFollowUpBody(["web_seed_1"], "set", "2026-02-31", now);
assert.equal(invalid.ok, false);
if (!invalid.ok) assert.equal(invalid.message, "下次跟进日期不正确");

const tooEarly = buildProspectNextFollowUpBody(["web_seed_1"], "set", "2026-10-29", now);
assert.equal(tooEarly.ok, false);
if (!tooEarly.ok) assert.equal(tooEarly.message, "下次跟进日期不能早于昨天");

const overRows = buildProspectNextFollowUpBody(
  Array.from({ length: PROSPECT_NEXT_FOLLOW_UP_BATCH_LIMIT + 1 }, (_, index) => `web_${index}`),
  "clear"
);
assert.equal(overRows.ok, false);
if (!overRows.ok) assert.match(overRows.message, /100/);

const built = buildProspectNextFollowUpBody([" web_a ", "web_a", "web_b"], "set", " 2026-11-02 ", now);
assert.equal(built.ok, true);
if (built.ok) {
  assert.deepEqual(built.body, {
    ids: ["web_a", "web_b"],
    action: "set",
    date: "2026-11-02"
  });
}

const cleared = buildProspectNextFollowUpBody(["web_a"], "clear", "", now);
assert.equal(cleared.ok, true);
if (cleared.ok) assert.deepEqual(cleared.body, { ids: ["web_a"], action: "clear" });

assert.equal(summarizeProspectNextFollowUpChange("set", [
  { ok: true },
  { ok: true }
]), "已为 2 条设置下次跟进");
assert.equal(summarizeProspectNextFollowUpChange("clear", [
  { ok: true },
  { ok: false, reason: "无权修改该候选的下次跟进" }
]), "已清空 1 条下次跟进。未改 1 条：无权修改该候选的下次跟进");

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /id="prospectSetNextFollowUpButton"[^>]*hidden/);
assert.match(html, /id="prospectClearNextFollowUpButton"[^>]*hidden/);
assert.match(html, /批量设置下次跟进/);
assert.match(html, /批量清空下次跟进/);
const apiLayer = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(apiLayer, /\/api\/prospect-list\/next-follow-up/);
assert.match(apiLayer, /showProspectNextFollowUpEntry/);
assert.match(apiLayer, /confirmProspectNextFollowUpButton/);
assert.doesNotMatch(apiLayer, /submitProspectNextFollowUp[\s\S]{0,900}outbound|submitProspectNextFollowUp[\s\S]{0,500}\/api\/prospect-list\/batch|submitProspectNextFollowUp[\s\S]{0,700}send-development-email|submitProspectNextFollowUp[\s\S]{0,700}convert-to-lead/);

console.log("prospect batch next follow up frontend tests passed");
