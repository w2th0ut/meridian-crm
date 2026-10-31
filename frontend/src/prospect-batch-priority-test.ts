import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PROSPECT_PRIORITY_BATCH_LIMIT,
  buildProspectPriorityBody,
  prospectPriorityLabel,
  showProspectPriorityEntry,
  summarizeProspectPriorityChange
} from "./prospect-batch-priority.js";

assert.equal(showProspectPriorityEntry(false), false);
assert.equal(showProspectPriorityEntry(true), true);
assert.equal(prospectPriorityLabel("high"), "高");
assert.equal(prospectPriorityLabel("normal"), "普通");
assert.equal(prospectPriorityLabel("low"), "低");
assert.equal(prospectPriorityLabel(null), "未设优先级");
assert.equal(prospectPriorityLabel(undefined), "未设优先级");

const empty = buildProspectPriorityBody([], "set", "high");
assert.equal(empty.ok, false);
if (!empty.ok) assert.equal(empty.message, "请先选择候选");

const missing = buildProspectPriorityBody(["web_seed_1"], "set", "  ");
assert.equal(missing.ok, false);
if (!missing.ok) assert.equal(missing.message, "请填写优先级");

const invalid = buildProspectPriorityBody(["web_seed_1"], "set", "medium");
assert.equal(invalid.ok, false);
if (!invalid.ok) assert.equal(invalid.message, "优先级不正确");

const overRows = buildProspectPriorityBody(
  Array.from({ length: PROSPECT_PRIORITY_BATCH_LIMIT + 1 }, (_, index) => `web_${index}`),
  "clear"
);
assert.equal(overRows.ok, false);
if (!overRows.ok) assert.match(overRows.message, /100/);

const built = buildProspectPriorityBody([" web_a ", "web_a", "web_b"], "set", " high ");
assert.equal(built.ok, true);
if (built.ok) {
  assert.deepEqual(built.body, {
    ids: ["web_a", "web_b"],
    action: "set",
    priority: "high"
  });
}

const cleared = buildProspectPriorityBody(["web_a"], "clear", "high");
assert.equal(cleared.ok, true);
if (cleared.ok) assert.deepEqual(cleared.body, { ids: ["web_a"], action: "clear" });

assert.equal(summarizeProspectPriorityChange("set", [
  { ok: true },
  { ok: true }
]), "已为 2 条设置优先级");
assert.equal(summarizeProspectPriorityChange("clear", [
  { ok: true },
  { ok: false, reason: "无权修改该候选的优先级" }
]), "已清除 1 条优先级。未改 1 条：无权修改该候选的优先级");

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /id="prospectSetPriorityButton"[^>]*hidden/);
assert.match(html, /id="prospectClearPriorityButton"[^>]*hidden/);
assert.match(html, /批量设置优先级/);
assert.match(html, /批量清除优先级/);
const apiLayer = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(apiLayer, /\/api\/prospect-list\/priority/);
assert.match(apiLayer, /showProspectPriorityEntry/);
assert.match(apiLayer, /confirmProspectPriorityButton/);
assert.match(apiLayer, /data-prospect-priority/);
assert.doesNotMatch(apiLayer, /submitProspectPriority[\s\S]{0,900}outbound|submitProspectPriority[\s\S]{0,500}\/api\/prospect-list\/batch|submitProspectPriority[\s\S]{0,700}send-development-email|submitProspectPriority[\s\S]{0,700}convert-to-lead/);

console.log("prospect batch priority frontend tests passed");
