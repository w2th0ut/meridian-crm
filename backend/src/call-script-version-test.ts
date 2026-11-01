import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCallScriptRestore, parseCallScriptVersionQuery } from "./call-script.js";

assert.deepEqual(parseCallScriptVersionQuery("cst_demo", null, {}), { ok: true, templateId: "cst_demo", versionId: null });
assert.deepEqual(parseCallScriptVersionQuery("cst_demo", "csver_demo", {}), { ok: true, templateId: "cst_demo", versionId: "csver_demo" });
assert.equal(parseCallScriptVersionQuery("cst_demo", null, { includeDisabled: "1" }).ok, false);
assert.equal(parseCallScriptVersionQuery("cst_demo", "csver_demo", { ids: ["a"] }).ok, false);
assert.equal(parseCallScriptVersionQuery("bad id", null, {}).ok, false);
assert.equal(parseCallScriptVersionQuery("cst_demo", "bad id", {}).ok, false);

const restored = parseCallScriptRestore({ templateId: "cst_demo", versionId: "csver_demo" });
assert.equal(restored.ok && restored.templateId, "cst_demo");
assert.equal(restored.ok && restored.versionId, "csver_demo");
for (const body of [
  [{ templateId: "cst_demo", versionId: "csver_demo" }],
  { templateId: "cst_demo", versionId: "csver_demo", versions: [] },
  { templateId: "cst_demo", versionId: "csver_demo", versionIds: ["csver_demo"] },
  { templateId: "cst_demo", versionId: "csver_demo", templates: [] },
  { templateId: "bad id", versionId: "csver_demo" },
  { templateId: "cst_demo" },
  { versionId: "csver_demo" },
  {}
]) {
  assert.equal(parseCallScriptRestore(body).ok, false);
}

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_script_versions \(/);
assert.match(schema, /uniq_call_script_versions_no/);
assert.match(schema, /idx_call_script_versions_team/);
assert.equal(schema.includes("CREATE TABLE call_script_versions"), false);
assert.equal(schema.includes("DROP TABLE call_script_versions"), false);
assert.equal(schema.includes("DROP TABLE IF EXISTS call_script_versions"), false);
assert.equal(schema.includes("DROP TABLE call_script_templates"), false);
assert.equal(schema.includes("DROP TABLE call_script_audits"), false);
assert.equal(schema.includes("ALTER TABLE call_script_templates"), false);
assert.equal(schema.includes("ALTER TABLE outbound_call_records"), false);

const source = readFileSync(new URL("./call-script.ts", import.meta.url), "utf8");
assert.equal(source.includes("aliyuncs.com"), false);
assert.equal(source.includes("requestOutboundCall"), false);
assert.equal(source.includes("MakeCall"), false);
assert.equal(source.includes("convert_to_lead"), false);
assert.equal(source.includes("approved_contactable"), false);
assert.equal(source.includes("callScriptTemplateId"), false);
assert.match(source, /archiveCallScriptVersion\(store, local, prior, user\.id, "edit"/);
assert.match(source, /archiveCallScriptVersion\(store, local, prior, user\.id, "restore"/);

console.log("call script version unit tests passed");
