import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CALL_NOTE_MAX,
  CALL_NOTE_TAGS,
  renderCallNoteForm,
  renderCallNoteTimeline,
  renderOutboundCallNoteFilterEmpty
} from "./call-note.js";
import {
  outboundCallRecordQuery,
  renderOutboundCallRecordDetail,
  renderOutboundCallRecordList
} from "./outbound-call-records.js";

assert.deepEqual([...CALL_NOTE_TAGS], ["需求", "预算", "决策人", "竞品", "异议"]);
assert.equal(CALL_NOTE_MAX, 1000);
assert.equal(outboundCallRecordQuery({ note: "has" }), "?note=has");
assert.equal(outboundCallRecordQuery({ outcome: "有意向", note: "none" }).includes("note=none"), true);
assert.equal(outboundCallRecordQuery({}).includes("note"), false);

const form = renderCallNoteForm({ id: "ocr_1", callNote: "先看看<script>", callNoteTags: ["预算", "需求"] });
assert.match(form, /data-call-note-form="1"/);
assert.match(form, /data-record-id="ocr_1"/);
assert.match(form, /maxlength="1000"/);
assert.match(form, /先看看&lt;script&gt;/);
assert.match(form, /value="需求" checked/);
assert.match(form, /value="预算" checked/);
assert.match(form, /value="决策人"/);
assert.equal(form.includes("value=\"决策人\" checked"), false);
assert.match(form, /保存纪要/);
assert.match(form, /data-call-note-clear="1"/);
assert.equal(form.includes("data-outbound-call"), false);
assert.equal(form.includes(">外呼<"), false);

const list = renderOutboundCallRecordList([
  { id: "ocr_1", established: true, callNote: "样品", callNoteTags: ["需求"] }
]);
assert.match(list, /data-call-note-form="1"/);
assert.match(list, /通话纪要/);
assert.equal(list.includes(">外呼<"), false);

const detail = renderOutboundCallRecordDetail({
  record: { id: "ocr_1", established: true, maskedNumber: "*******2333", callNote: "空号说明", callNoteTags: ["异议"] }
});
assert.match(detail, /data-call-note-panel="1"/);
assert.match(detail, /空号说明/);
assert.match(detail, /value="异议" checked/);

const timeline = renderCallNoteTimeline([
  { callRecordId: "ocr_1", note: "要样品<script>", tags: ["需求", "预算"], at: "2026-04-04T01:00:00.000Z", maskedNumber: "*******2333" },
  { callRecordId: "ocr_2", note: "", tags: [], at: "" }
]);
assert.match(timeline, /data-call-note="ocr_1"/);
assert.match(timeline, /通话纪要/);
assert.match(timeline, /要样品&lt;script&gt;/);
assert.match(timeline, /要点：需求、预算/);
assert.match(timeline, /\*\*\*\*\*\*\*2333/);
assert.equal(timeline.includes("ocr_2"), false);
assert.equal(renderCallNoteTimeline([]), "");
assert.equal(renderCallNoteTimeline(undefined), "");
assert.match(renderOutboundCallNoteFilterEmpty(), /data-note-filter-empty="1"/);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(page, /id="outboundCallRecordNote"/);
assert.match(page, /有纪要/);
assert.match(page, /无纪要/);
const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /data-call-note-form/);
assert.match(api, /outbound-call-records\/\$\{encodeURIComponent\(recordId\)\}\/note/);
assert.match(api, /renderCallNoteTimeline/);

console.log("call note frontend tests passed");
