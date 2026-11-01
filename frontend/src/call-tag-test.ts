import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  callTagAssignBody,
  callTagCreateBody,
  callTagDisableBody,
  callTagRenameBody,
  renderCallTagAdmin,
  renderCallTagPanel
} from "./call-tag.js";
import {
  outboundCallRecordQuery,
  renderOutboundCallRecordDetail,
  renderOutboundCallRecordList,
  renderOutboundCallTagOptions
} from "./outbound-call-records.js";

assert.deepEqual(callTagCreateBody(" 价格敏感 "), { name: "价格敏感" });
assert.deepEqual(callTagRenameBody("ctag_a", " 要样品 "), { id: "ctag_a", name: "要样品" });
assert.deepEqual(callTagDisableBody("ctag_a"), { id: "ctag_a" });
assert.deepEqual(callTagAssignBody("ctag_a"), { tagId: "ctag_a" });

const admin = renderCallTagAdmin([
  { id: "ctag_a", name: "=价格<script>", enabled: true },
  { id: "ctag_b", name: "要样品", enabled: false }
], true);
assert.match(admin, /data-call-tag-admin="1"/);
assert.match(admin, /data-call-tag-create="1"/);
assert.match(admin, /新增/);
assert.match(admin, /data-call-tag-rename="ctag_a"/);
assert.match(admin, /data-call-tag-disable="ctag_a"/);
assert.match(admin, /data-call-tag-enabled="0"/);
assert.equal(admin.includes('data-call-tag-disable="ctag_b"'), false);
assert.match(admin, /&lt;script&gt;/);
assert.equal(admin.includes("<script>"), false);
assert.equal(renderCallTagAdmin([{ id: "ctag_a", name: "价格敏感", enabled: true }], false), "");
assert.match(renderCallTagAdmin([], true), /data-call-tag-admin-empty/);

const panel = renderCallTagPanel(
  {
    id: "ocr_1",
    callTags: [
      { id: "ctag_a", name: "=价格<script>", enabled: true },
      { id: "ctag_b", name: "要样品", enabled: false }
    ]
  },
  [
    { id: "ctag_a", name: "=价格<script>", enabled: true },
    { id: "ctag_c", name: "新标签", enabled: true },
    { id: "ctag_b", name: "要样品", enabled: false }
  ]
);
assert.match(panel, /data-call-tag-panel="1"/);
assert.match(panel, /data-call-tag-add-form="1"/);
assert.match(panel, /data-record-id="ocr_1"/);
assert.match(panel, /添加标签/);
assert.match(panel, /data-call-tag-remove="ctag_a"/);
assert.match(panel, /data-call-tag-disabled="1"/);
assert.equal(panel.includes('data-call-tag-remove="ctag_b"'), false);
assert.match(panel, /value="ctag_c"/);
assert.equal(panel.includes('value="ctag_b"'), false);
assert.equal(panel.includes('value="ctag_a"'), false);
assert.match(panel, /&lt;script&gt;/);
assert.equal(panel.includes("<script>"), false);
assert.equal(panel.includes(">外呼<"), false);
assert.equal(panel.includes("aliyuncs.com"), false);

const list = renderOutboundCallRecordList([
  { id: "ocr_1", callScriptTitle: "开场", established: true, callTags: [{ id: "ctag_b", name: "要样品<script>", enabled: false }] },
  { id: "ocr_2" }
]);
assert.match(list, /通话标签/);
assert.match(list, /data-call-tag-cell="ocr_1"/);
assert.match(list, /data-call-tag-disabled="1"/);
assert.match(list, /&lt;script&gt;/);
assert.match(list, /data-call-tag-empty="1"/);
assert.equal(list.includes("data-call-tag-remove"), false);
assert.equal(list.includes("data-call-tag-add-form"), false);
assert.equal(list.includes("<script>"), false);
assert.match(list, />未选用</);

const detail = renderOutboundCallRecordDetail({
  record: { id: "ocr_1", established: true, maskedNumber: "*******2333", callTags: [{ id: "ctag_b", name: "要样品", enabled: false }] },
  tagChoices: [{ id: "ctag_c", name: "新标签", enabled: true }]
});
assert.match(detail, /data-call-tag-panel="1"/);
assert.match(detail, /data-call-tag-disabled="1"/);
assert.equal(detail.includes('data-call-tag-remove="ctag_b"'), false);
assert.equal(detail.includes(">外呼<"), false);

const options = renderOutboundCallTagOptions([{ id: "ctag_a", name: "价格敏感", enabled: true }, { id: "ctag_b", name: "要样品", enabled: false }], "none");
assert.match(options, /全部/);
assert.match(options, /无标签/);
assert.match(options, /价格敏感/);
assert.match(options, /要样品（已停用）/);
assert.match(outboundCallRecordQuery({ tag: "ctag_a", script: "cst_a" }), /tag=ctag_a/);
assert.equal(outboundCallRecordQuery({}).includes("tag"), false);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const viewStart = page.indexOf('id="outbound-call-records"');
const viewEnd = page.indexOf('id="intent-followup-queue"');
const view = page.slice(viewStart, viewEnd);
assert.match(view, /id="outboundCallRecordTag"/);
assert.match(view, /通话标签/);
assert.match(view, /无标签/);
assert.match(view, /id="outboundCallTagAdmin"/);
assert.equal(view.includes(">外呼<"), false);
assert.equal(view.includes("MakeCall"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/call-tags/);
assert.match(api, /\/tags\/remove/);
assert.match(api, /callTagAssignBody/);
assert.match(api, /renderCallTagAdmin/);

console.log("call tag frontend tests passed");
