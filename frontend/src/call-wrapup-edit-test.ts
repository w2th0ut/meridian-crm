import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderCallWrapupEdit } from "./call-wrapup-edit.js";
import { renderOutboundCallRecordDetail } from "./outbound-call-records.js";

const record = {
  id: "ocr_1",
  callOutcome: "有意向",
  callOutcomeNote: "原<script>",
  callNote: "原纪要",
  callTags: [{ id: "ctag_off", name: "停用", enabled: false }]
};
const choices = [
  { id: "ctag_on", name: "价格敏感", enabled: true },
  { id: "ctag_off", name: "停用", enabled: false }
];
const form = renderCallWrapupEdit(record, {
  submitted: true,
  edited: true,
  editable: true,
  windowHours: 24,
  nextFollowAt: "2026-11-02 10:15",
  history: [{
    id: "cwe_1",
    at: "2026-11-01T00:00:00.000Z",
    actorId: "u_sales_shirley",
    before: { note: "原<纪要>", outcome: "有意向", outcomeNote: "原", tagIds: ["ctag_off"], nextFollowAt: "2026-11-01 09:00" },
    after: { note: "改正后", outcome: "无意向", outcomeNote: "改", tagIds: ["ctag_on"], nextFollowAt: "2026-11-02 10:15" }
  }]
}, choices);
assert.match(form, /data-call-wrapup-edited="1"/);
assert.match(form, /已改正/);
assert.match(form, /data-call-wrapup-edit-history="1"/);
assert.match(form, /data-call-wrapup-edit-entry="cwe_1"/);
assert.match(form, /data-call-wrapup-edit-before-note="cwe_1">原&lt;纪要&gt;/);
assert.match(form, /data-call-wrapup-edit-after-note="cwe_1">改正后/);
assert.match(form, /data-call-wrapup-edit-before-tags="cwe_1">ctag_off/);
assert.match(form, /data-call-wrapup-edit-after-tags="cwe_1">ctag_on/);
assert.match(form, /data-call-wrapup-edit-before-follow="cwe_1">2026-11-01 09:00/);
assert.match(form, /data-call-wrapup-edit-after-follow="cwe_1">2026-11-02 10:15/);
assert.match(form, /data-call-wrapup-edit-form="1"/);
assert.match(form, /data-wrapup-edit-include="note"/);
assert.match(form, /data-wrapup-edit-include="outcome"/);
assert.match(form, /data-wrapup-edit-include="callTag"/);
assert.match(form, /data-wrapup-edit-include="nextFollowAt"/);
assert.match(form, /data-wrapup-edit-tag-add="ctag_on"/);
assert.match(form, /data-wrapup-edit-tag-remove="ctag_off"/);
assert.equal(form.includes("data-wrapup-edit-tag-add=\"ctag_off\""), false);
assert.match(form, /value="2026-11-02T10:15"/);
assert.match(form, /改正通话小结/);
assert.match(form, /原&lt;script&gt;/);
assert.equal(form.includes(">外呼<"), false);
assert.equal(form.includes("data-outbound-call"), false);
assert.equal(form.includes("<script>"), false);
assert.equal((form.match(/type="submit"/g) || []).length, 1);

const closed = renderCallWrapupEdit(record, { submitted: true, edited: false, editable: false, reason: "window_closed" });
assert.match(closed, /data-call-wrapup-edit-closed="1"/);
assert.equal(closed.includes("data-call-wrapup-edit-form"), false);
const forbidden = renderCallWrapupEdit(record, { submitted: true, editable: false, reason: "not_owner" });
assert.match(forbidden, /data-call-wrapup-edit-forbidden="1"/);
assert.equal(forbidden.includes("data-call-wrapup-edit-form"), false);
assert.equal(renderCallWrapupEdit(record, { submitted: false }), "");
assert.equal(renderCallWrapupEdit(record, null), "");

const detail = renderOutboundCallRecordDetail({
  record: { id: "ocr_1", established: true, maskedNumber: "*******2333", callNote: "纪要" },
  wrapupEdit: { submitted: true, edited: true, editable: true, history: [] },
  tagChoices: choices
});
assert.match(detail, /data-call-wrapup-edit-panel="1"/);
assert.match(detail, /data-call-wrapup-edited="1"/);
assert.match(detail, /data-call-wrapup-panel="1"/);
assert.equal(detail.includes(">外呼<"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /data-call-wrapup-edit-form/);
assert.match(api, /outbound-call-records\/\$\{encodeURIComponent\(recordId\)\}\/wrapup-edit/);
assert.match(api, /data-wrapup-edit-include/);
assert.match(api, /data-wrapup-edit-tag-add/);
assert.match(api, /data-wrapup-edit-follow-clear/);

console.log("call wrapup edit frontend tests passed");
