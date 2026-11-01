import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { outboundCallRecordQuery } from "./outbound-call-records.js";

const query = outboundCallRecordQuery({
  agentId: "agent-a",
  from: "2026-04-01",
  to: "2026-04-02",
  outcome: "有意向",
  note: "has",
  plaintext: "1"
});
assert.match(query, /agentId=agent-a/);
assert.match(query, /from=2026-04-01/);
assert.match(query, /to=2026-04-02/);
assert.match(query, /note=has/);
assert.match(query, /plaintext=1/);
assert.equal(outboundCallRecordQuery({ plaintext: "0" }).includes("plaintext"), false);
assert.equal(outboundCallRecordQuery({}).includes("plaintext"), false);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const viewStart = page.indexOf('id="outbound-call-records"');
const viewEnd = page.indexOf('id="intent-followup-queue"');
const view = page.slice(viewStart, viewEnd);
assert.match(view, /id="outboundCallRecordExport"/);
assert.match(view, /导出 CSV/);
assert.match(view, /id="outboundCallRecordPlaintextLabel" hidden/);
assert.match(view, /id="outboundCallRecordPlaintext"/);
assert.match(view, /导出明文号码/);
assert.match(view, /data-call-export-message/);
assert.match(view, /浏览器本地下载/);
assert.equal(view.includes("mailto:"), false);
assert.equal(view.includes(">外呼<"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const exportStart = api.indexOf("async function exportOutboundCallRecords");
const exportEnd = api.indexOf("async function loadOutboundCallRecords");
assert.equal(exportStart > 0, true);
const body = api.slice(exportStart, exportEnd);
assert.match(body, /\/api\/outbound-call-records\/export/);
assert.match(body, /outboundCallRecordQuery/);
assert.match(body, /URL\.createObjectURL/);
assert.match(body, /link\.download = "外呼通话记录\.csv"/);
assert.match(body, /isSystemAdministrator\(\)/);
assert.match(body, /data-call-export-message|outboundCallRecordExportMessage/);
assert.equal(body.includes("mailto:"), false);
assert.equal(body.includes("aliyuncs.com"), false);
assert.match(api, /#outboundCallRecordExport/);
assert.match(api, /syncCallExportPlaintext/);

console.log("call export frontend tests passed");
