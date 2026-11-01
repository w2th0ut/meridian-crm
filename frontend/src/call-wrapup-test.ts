import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { callWrapupBody, renderCallWrapupForm, renderCallWrapupPanel } from "./call-wrapup.js";
import { renderOutboundCallRecordDetail } from "./outbound-call-records.js";

assert.deepEqual(callWrapupBody({
  outcome: null,
  note: { note: "要样品", tags: ["需求"] },
  script: null,
  callTag: null,
  callback: null
}), { note: { note: "要样品", tags: ["需求"] } });
assert.deepEqual(callWrapupBody({
  script: { templateId: "" },
  callTag: { tagId: "ctag_a", action: "remove" },
  callTags: [
    { tagId: "ctag_b", action: "add" },
    { tagId: "ctag_off", action: "remove" }
  ],
  callback: { cancel: true }
}), {
  script: { templateId: null },
  callTag: { tagId: "ctag_a", action: "remove" },
  callTags: [
    { tagId: "ctag_b", action: "add" },
    { tagId: "ctag_off", action: "remove" }
  ],
  callback: { cancel: true }
});
assert.deepEqual(callWrapupBody({}), {});

const form = renderCallWrapupForm({
  id: "ocr_1",
  targetType: "customer",
  targetId: "c1",
  callOutcome: "有意向",
  callOutcomeNote: "原<script>",
  callNote: "纪要",
  callNoteTags: ["预算"],
  callScriptTemplateId: "cst_a",
  callScriptTitle: "开场",
  callTags: [{ id: "ctag_off", name: "停用", enabled: false }],
  callbackScheduledAt: "2026-12-01 09:30",
  callbackNote: "备注"
}, [
  { id: "cst_a", title: "开场", enabled: true },
  { id: "cst_off", title: "旧话术", enabled: false }
], [
  { id: "ctag_on", name: "价格敏感", enabled: true }
]);
assert.match(form, /data-call-wrapup-form="1"/);
assert.match(form, /data-record-id="ocr_1"/);
assert.match(form, /data-wrapup-include="outcome"/);
assert.match(form, /data-wrapup-include="note"/);
assert.match(form, /data-wrapup-include="script"/);
assert.match(form, /data-wrapup-include="callTag"/);
assert.match(form, /data-wrapup-tag-add="ctag_on"/);
assert.match(form, /data-wrapup-tag-remove="ctag_off"/);
assert.match(form, /一次最多 10 个/);
assert.equal(form.includes("data-wrapup-tag-add=\"ctag_off\""), false);
assert.match(form, /data-wrapup-include="callback"/);
assert.match(form, /提交通话小结/);
assert.match(form, /原&lt;script&gt;/);
assert.match(form, /value="预算" checked/);
assert.match(form, /value="2026-12-01T09:30"/);
assert.match(form, /已停用/);
assert.equal(form.includes(">外呼<"), false);
assert.equal(form.includes("data-outbound-call"), false);
assert.equal(form.includes("<script>"), false);
assert.equal((form.match(/type="submit"/g) || []).length, 1);

const missing = renderCallWrapupPanel({ id: "ocr_2" });
assert.match(missing, /data-call-wrapup-panel="1"/);
assert.match(missing, /data-wrapup-callback-missing="1"/);
assert.equal(missing.includes("data-wrapup-include=\"callback\""), false);

const detail = renderOutboundCallRecordDetail({
  record: { id: "ocr_1", established: true, maskedNumber: "*******2333", targetType: "lead", targetId: "l1" },
  scriptChoices: [{ id: "cst_a", title: "开场" }],
  tagChoices: [{ id: "ctag_on", name: "价格敏感", enabled: true }]
});
assert.match(detail, /data-call-wrapup-panel="1"/);
assert.match(detail, /data-call-note-panel="1"/);
assert.match(detail, /data-call-script-usage-panel="1"/);
assert.match(detail, /data-call-tag-panel="1"/);
assert.match(detail, /data-callback-schedule-panel="1"/);
assert.equal(detail.includes(">外呼<"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /data-call-wrapup-form/);
assert.match(api, /outbound-call-records\/\$\{encodeURIComponent\(recordId\)\}\/wrapup/);
assert.match(api, /callWrapupBody/);
assert.match(api, /data-wrapup-tag-add/);
assert.match(api, /data-wrapup-tag-remove/);
assert.match(api, /CALL_WRAPUP_TAG_LIMIT/);

console.log("call wrapup frontend tests passed");
