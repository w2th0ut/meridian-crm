import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildProspectTagBody,
  PROSPECT_TAG_BATCH_LIMIT,
  showProspectTagEntry,
  summarizeProspectTagChange
} from "./prospect-batch-tags.js";

assert.equal(showProspectTagEntry(false), false);
assert.equal(showProspectTagEntry(true), true);

const empty = buildProspectTagBody([], "add", "重点");
assert.equal(empty.ok, false);
if (!empty.ok) assert.equal(empty.message, "请先选择候选");

const missing = buildProspectTagBody(["web_seed_1"], "remove", "  ， ");
assert.equal(missing.ok, false);
if (!missing.ok) assert.equal(missing.message, "请填写标签");

const tooLong = buildProspectTagBody(["web_seed_1"], "add", "重".repeat(41));
assert.equal(tooLong.ok, false);
if (!tooLong.ok) assert.equal(tooLong.message, "标签过长");

const tooMany = buildProspectTagBody(
  ["web_seed_1"],
  "add",
  Array.from({ length: 21 }, (_, index) => `标签${index}`).join(",")
);
assert.equal(tooMany.ok, false);
if (!tooMany.ok) assert.match(tooMany.message, /20/);

const overRows = buildProspectTagBody(
  Array.from({ length: PROSPECT_TAG_BATCH_LIMIT + 1 }, (_, index) => `web_${index}`),
  "add",
  "重点"
);
assert.equal(overRows.ok, false);
if (!overRows.ok) assert.match(overRows.message, /100/);

const built = buildProspectTagBody([" web_a ", "web_a", "web_b"], "add", " 重点，重点, 欧洲 ");
assert.equal(built.ok, true);
if (built.ok) {
  assert.deepEqual(built.body, {
    ids: ["web_a", "web_b"],
    action: "add",
    tags: ["重点", "欧洲"]
  });
}

assert.equal(summarizeProspectTagChange("add", [
  { ok: true },
  { ok: true }
]), "已为 2 条打上标签");
assert.equal(summarizeProspectTagChange("remove", [
  { ok: true },
  { ok: false, reason: "无权修改该候选的标签" }
]), "已从 1 条移除标签。未改 1 条：无权修改该候选的标签");

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /id="prospectAddTagsButton"[^>]*hidden/);
assert.match(html, /id="prospectRemoveTagsButton"[^>]*hidden/);
assert.match(html, /批量打标签/);
assert.match(html, /批量移除标签/);
const apiLayer = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(apiLayer, /\/api\/prospect-list\/tags/);
assert.match(apiLayer, /showProspectTagEntry/);
assert.match(apiLayer, /confirmProspectTagsButton/);
assert.match(apiLayer, /data-prospect-tags/);
assert.doesNotMatch(apiLayer, /submitProspectTags[\s\S]{0,800}outbound|submitProspectTags[\s\S]{0,400}\/api\/prospect-list\/batch/);

console.log("prospect batch tags frontend tests passed");
