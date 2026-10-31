import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PROSPECT_INDUSTRY_BATCH_LIMIT,
  PROSPECT_INDUSTRY_TEXT_MAX,
  buildProspectIndustryBody,
  prospectIndustryLabel,
  showProspectIndustryEntry,
  summarizeProspectIndustryChange
} from "./prospect-batch-industry.js";

assert.equal(showProspectIndustryEntry(false), false);
assert.equal(showProspectIndustryEntry(true), true);
assert.equal(prospectIndustryLabel("工业照明"), "工业照明");
assert.equal(prospectIndustryLabel("  水处理  "), "水处理");
assert.equal(prospectIndustryLabel(null), "未设行业");
assert.equal(prospectIndustryLabel(undefined), "未设行业");
assert.equal(prospectIndustryLabel(""), "未设行业");
assert.equal(prospectIndustryLabel("灯".repeat(PROSPECT_INDUSTRY_TEXT_MAX + 1)), "未设行业");

const empty = buildProspectIndustryBody([], "set", "工业照明");
assert.equal(empty.ok, false);
if (!empty.ok) assert.equal(empty.message, "请先选择候选");

const missing = buildProspectIndustryBody(["web_seed_1"], "set", "  ");
assert.equal(missing.ok, false);
if (!missing.ok) assert.equal(missing.message, "请填写行业");

const tooLong = buildProspectIndustryBody(["web_seed_1"], "set", "灯".repeat(PROSPECT_INDUSTRY_TEXT_MAX + 1));
assert.equal(tooLong.ok, false);
if (!tooLong.ok) assert.equal(tooLong.message, "行业过长");

const overRows = buildProspectIndustryBody(
  Array.from({ length: PROSPECT_INDUSTRY_BATCH_LIMIT + 1 }, (_, index) => `web_${index}`),
  "clear"
);
assert.equal(overRows.ok, false);
if (!overRows.ok) assert.match(overRows.message, /100/);

const built = buildProspectIndustryBody([" web_a ", "web_a", "web_b"], "set", " 工业照明 ");
assert.equal(built.ok, true);
if (built.ok) {
  assert.deepEqual(built.body, {
    ids: ["web_a", "web_b"],
    action: "set",
    industry: "工业照明"
  });
}

const cleared = buildProspectIndustryBody(["web_a"], "clear", "工业照明");
assert.equal(cleared.ok, true);
if (cleared.ok) assert.deepEqual(cleared.body, { ids: ["web_a"], action: "clear" });

assert.equal(summarizeProspectIndustryChange("set", [
  { ok: true },
  { ok: true }
]), "已为 2 条设置行业");
assert.equal(summarizeProspectIndustryChange("clear", [
  { ok: true },
  { ok: false, reason: "无权修改该候选的行业" }
]), "已清除 1 条行业。未改 1 条：无权修改该候选的行业");

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /id="prospectSetIndustryButton"[^>]*hidden/);
assert.match(html, /id="prospectClearIndustryButton"[^>]*hidden/);
assert.match(html, /批量设置行业/);
assert.match(html, /批量清除行业/);
const apiLayer = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(apiLayer, /\/api\/prospect-list\/industry/);
assert.match(apiLayer, /showProspectIndustryEntry/);
assert.match(apiLayer, /confirmProspectIndustryButton/);
assert.match(apiLayer, /data-prospect-industry/);
assert.doesNotMatch(apiLayer, /submitProspectIndustry[\s\S]{0,900}outbound|submitProspectIndustry[\s\S]{0,500}\/api\/prospect-list\/batch|submitProspectIndustry[\s\S]{0,700}send-development-email|submitProspectIndustry[\s\S]{0,700}convert-to-lead/);

console.log("prospect batch industry frontend tests passed");
