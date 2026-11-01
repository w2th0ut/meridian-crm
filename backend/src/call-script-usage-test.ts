import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  callScriptUsageAction,
  callScriptUsageCounts,
  parseCallScriptUsageRequest
} from "./call-script-usage.js";
import { parseOutboundCallRecordQuery, recordsMatchingScript } from "./outbound-call-records.js";
import type { CallScriptTemplate } from "./types.js";
import type { CrmStore } from "./store.js";

assert.equal(callScriptUsageAction("", "cst_a"), "set");
assert.equal(callScriptUsageAction("cst_a", "cst_b"), "update");
assert.equal(callScriptUsageAction("cst_a", ""), "clear");
assert.equal(parseCallScriptUsageRequest({ templateId: " cst_a " }).ok && parseCallScriptUsageRequest({ templateId: " cst_a " }).ok, true);
const parsed = parseCallScriptUsageRequest({ templateId: " cst_demo " });
assert.equal(parsed.ok && parsed.templateId, "cst_demo");
assert.equal(parseCallScriptUsageRequest({ templateId: null }).ok && (parseCallScriptUsageRequest({ templateId: null }) as { templateId: string }).templateId, "");
assert.equal(parseCallScriptUsageRequest({ templateId: "  " }).ok, true);
assert.equal(parseCallScriptUsageRequest({}).ok, false);
assert.equal(parseCallScriptUsageRequest({ templateId: "bad id" }).ok, false);
assert.equal(parseCallScriptUsageRequest({ templateId: "cst_a", templates: [] }).ok, false);
assert.equal(parseCallScriptUsageRequest([{ templateId: "cst_a" }]).ok, false);
assert.equal(parseCallScriptUsageRequest({ templateId: 1 }).ok, false);

assert.equal(parseOutboundCallRecordQuery({ script: "none" })?.script, "none");
assert.equal(parseOutboundCallRecordQuery({ script: " cst_a " })?.script, "cst_a");
assert.equal(parseOutboundCallRecordQuery({ script: "" })?.script, null);
assert.equal(parseOutboundCallRecordQuery({ script: "nope id" }), null);
assert.equal(parseOutboundCallRecordQuery({ script: ["cst_a"] }), null);
assert.deepEqual(
  recordsMatchingScript([
    { id: "a", callScriptTemplateId: "cst_a" },
    { id: "b", callScriptTemplateId: "" },
    { id: "c", callScriptTemplateId: "cst_b" }
  ], "cst_a").map((item) => item.id),
  ["a"]
);
assert.deepEqual(recordsMatchingScript([
  { id: "a", callScriptTemplateId: "cst_a" },
  { id: "b", callScriptTemplateId: "" }
], "none").map((item) => item.id), ["b"]);

function template(partial: Partial<CallScriptTemplate> & Pick<CallScriptTemplate, "id" | "teamId">): CallScriptTemplate {
  return {
    title: partial.id,
    scenario: "first_call",
    language: "",
    body: "正文",
    enabled: true,
    createdBy: "",
    updatedBy: "",
    createdAt: "",
    updatedAt: "",
    disabledAt: "",
    ...partial
  };
}

const counts = callScriptUsageCounts({
  callScriptTemplates: [
    template({ id: "cst_a", teamId: "europe", title: "开场" }),
    template({ id: "cst_b", teamId: "europe", title: "回访", enabled: false }),
    template({ id: "cst_c", teamId: "europe", title: "未用" }),
    template({ id: "cst_asia", teamId: "asia", title: "亚洲" })
  ],
  outboundCallRecords: [
    { teamId: "europe", callScriptTemplateId: "cst_a" },
    { teamId: "europe", callScriptTemplateId: "cst_a" },
    { teamId: "europe", callScriptTemplateId: "cst_b" },
    { teamId: "europe", callScriptTemplateId: "" },
    { teamId: "asia", callScriptTemplateId: "cst_a" }
  ]
} as unknown as CrmStore, "europe");
const countOf = (id: string) => counts.find((item) => item.id === id)?.usageCount;
assert.equal(countOf("cst_a"), 2);
assert.equal(countOf("cst_b"), 1);
assert.equal(countOf("cst_c"), 0);
assert.equal(counts.some((item) => item.id === "cst_asia"), false);
assert.equal("usageRate" in counts[0], false);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_script_usage_audits \(/);
assert.match(schema, /ensureColumn\(pool, "outbound_call_records", "call_script_template_id", "VARCHAR\(64\) NOT NULL DEFAULT ''"\)/);
assert.match(schema, /ensureColumn\(pool, "outbound_call_records", "call_script_updated_at", "VARCHAR\(40\) NOT NULL DEFAULT ''"\)/);
assert.match(schema, /previous_template_id VARCHAR\(64\) NOT NULL DEFAULT ''/);
assert.match(schema, /next_template_id VARCHAR\(64\) NOT NULL DEFAULT ''/);
assert.equal(schema.includes("CREATE TABLE call_script_usage_audits"), false);
assert.equal(schema.includes("DROP TABLE call_script_usage_audits"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS call_script_usage_audits"), false);
assert.equal(schema.includes("DROP TABLE outbound_call_records"), false);

const source = readFileSync(new URL("./call-script-usage.ts", import.meta.url), "utf8");
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("requestOutboundCall"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("usageRate"), false);

console.log("call script usage unit tests passed");
