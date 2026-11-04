import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CALL_OUTCOME_PHRASE_SHORTCUT_MAX,
  CALL_OUTCOME_SHORTCUTS,
  planCallOutcomeShortcut,
  renderCallOutcomeKeyHint,
  type CallOutcomeShortcutInput
} from "./call-outcome-keys.js";
import { renderOutcomeNotePhrases } from "./call-outcome-note-phrase.js";
import { CALL_OUTCOMES, renderCallOutcomeForm, renderOutboundCallRecordDetail, renderOutboundCallRecordList } from "./outbound-call-records.js";

assert.deepEqual([...CALL_OUTCOME_SHORTCUTS], [...CALL_OUTCOMES]);
assert.equal(CALL_OUTCOME_PHRASE_SHORTCUT_MAX, 9);

const idle: CallOutcomeShortcutInput = {
  key: "1",
  insideForm: true,
  typing: false,
  activateOnEnter: true
};

assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "1" }), { action: "select", outcome: "有意向" });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "2", code: "Digit2" }), { action: "select", outcome: "需回访" });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "3", code: "Numpad3" }), { action: "select", outcome: "无意向" });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "4" }), { action: "select", outcome: "号码错误" });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "5" }), { action: "select", outcome: "其他" });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "6" }), { action: "none" });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "0", code: "Digit0" }), { action: "none" });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "¡", code: "Digit1", altKey: true }), { action: "insert-phrase", index: 0 });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "1", code: "Digit9", altKey: true }), { action: "insert-phrase", index: 8 });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "1", altKey: true }), { action: "insert-phrase", index: 0 });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "0", altKey: true }), { action: "none" });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "Enter" }), { action: "save" });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "Enter", code: "NumpadEnter" }), { action: "save" });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "Enter", activateOnEnter: false }), { action: "none" });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "Enter", typing: true }), { action: "none" });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "1", typing: true }), { action: "none" });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "1", insideForm: false }), { action: "none" });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "1", ctrlKey: true }), { action: "none" });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "1", metaKey: true }), { action: "none" });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "1", shiftKey: true }), { action: "none" });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "1", isComposing: true }), { action: "none" });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "1", repeat: true }), { action: "none" });
assert.deepEqual(planCallOutcomeShortcut({ ...idle, key: "Enter", altKey: true }), { action: "none" });

const hint = renderCallOutcomeKeyHint();
assert.match(hint, /data-call-outcome-key-hint="1"/);
assert.match(hint, /tabindex="0"/);
assert.match(hint, /1 有意向，2 需回访，3 无意向，4 号码错误，5 其他/);
assert.match(hint, /Alt\+1/);
assert.match(hint, /回车保存/);
assert.match(hint, /聚焦时不拦截/);
assert.equal(hint.includes("MakeCall"), false);
assert.equal(hint.includes(">外呼<"), false);
assert.equal(hint.includes("today-follow"), false);
assert.equal(hint.includes("today_follow_advance"), false);

const form = renderCallOutcomeForm({ id: "ocr_1", callOutcome: "无意向", callOutcomeNote: "先看看<script>", targetType: "customer", targetId: "c1" });
assert.match(form, /data-call-outcome-form="1"/);
assert.match(form, /data-target-type="customer"/);
assert.match(form, /data-target-id="c1"/);
assert.match(form, /data-call-outcome-key-hint="1"/);
assert.match(form, /data-call-outcome-note/);
assert.match(form, /data-outcome-note-phrase-load="1"/);
assert.match(form, /保存标注/);
assert.match(form, /value="先看看&lt;script&gt;"/);
assert.equal(form.includes("MakeCall"), false);
assert.equal(form.includes(">外呼<"), false);
assert.equal(form.includes("today-follow"), false);
assert.equal(form.includes("today_follow_advance"), false);
assert.equal(form.includes("/api/"), false);

const list = renderOutboundCallRecordList([{ id: "ocr_1", established: true, callOutcome: "有意向" }]);
assert.match(list, /data-call-outcome-key-hint="1"/);
assert.equal(list.includes(">外呼<"), false);
const detail = renderOutboundCallRecordDetail({
  record: { id: "ocr_1", established: true, maskedNumber: "*******2333", callOutcome: "其他" }
});
assert.match(detail, /data-call-outcome-panel="1"/);
assert.match(detail, /data-call-outcome-key-hint="1"/);
assert.equal(detail.includes("MakeCall"), false);

const plain = renderOutcomeNotePhrases([
  { id: "csp_1", text: "要样品<script>", scope: "personal", enabled: true },
  { id: "csp_2", text: "改日再打", scope: "team", enabled: true }
]);
assert.equal(plain.includes("data-outcome-note-phrase-key"), false);
assert.equal(plain.includes("<kbd"), false);

const keyed = renderOutcomeNotePhrases([
  { id: "off", text: "已停用", enabled: false },
  ...Array.from({ length: 10 }, (_, index) => ({ id: `csp_${index}`, text: `短语${index + 1}`, enabled: true }))
], { shortcut: true });
assert.match(keyed, /data-outcome-note-phrase-key="1">Alt\+1/);
assert.match(keyed, /data-outcome-note-phrase-key="9">Alt\+9/);
assert.match(keyed, /短语1/);
assert.equal(keyed.includes("已停用"), false);
assert.equal(keyed.includes("data-outcome-note-phrase-key=\"10\""), false);
assert.equal((keyed.match(/data-outcome-note-phrase-key="/g) || []).length, 9);
assert.equal(keyed.includes(">外呼<"), false);
assert.equal(keyed.includes("/api/"), false);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const recordsStart = page.indexOf('id="outbound-call-records"');
const recordsEnd = page.indexOf('id="phone-strategies"', recordsStart);
const records = page.slice(recordsStart, recordsEnd);
assert.match(records, /1 到 5 选结果/);
assert.match(records, /输入框聚焦时不拦截/);
assert.match(records, /不能拨号/);
assert.match(records, /不能批量标注/);
assert.equal(records.includes("MakeCall"), false);
assert.equal(records.includes(">外呼<"), false);
const batchStart = page.indexOf('id="dashboardCallOutcomeBatch"');
const batchEnd = page.indexOf('id="dashboardTodayFollowNext"', batchStart);
const batch = page.slice(batchStart, batchEnd);
assert.equal(batch.includes("data-outcome-note-phrase-key"), false);
assert.equal(batch.includes("data-call-outcome-key-hint"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const fnStart = api.indexOf("function applyCallOutcomeShortcut");
const fnEnd = api.indexOf("async function saveOutcomeNotePhrase", fnStart);
assert.ok(fnStart > 0 && fnEnd > fnStart);
const fn = api.slice(fnStart, fnEnd);
assert.match(fn, /data-call-outcome-form/);
assert.match(fn, /planCallOutcomeShortcut/);
assert.match(fn, /insertOutcomeNotePhrase/);
assert.match(fn, /requestSubmit\(\)/);
assert.match(fn, /tag === "INPUT"/);
assert.doesNotMatch(fn, /MakeCall|aliyuncs|today-follow|today_follow_advance|\/api\/outbound-calls|convert_to_lead|approved_contactable|fetch\(/);
const submitStart = api.indexOf("async function submitCallOutcome");
const submitEnd = api.indexOf("async function loadOutboundCallRecords", submitStart);
assert.ok(submitStart > 0 && submitEnd > submitStart);
const submit = api.slice(submitStart, submitEnd);
assert.match(submit, /\/api\/outbound-call-records\/\$\{encodeURIComponent\(recordId\)\}\/outcome/);
assert.match(submit, /JSON\.stringify\(body\)/);
assert.doesNotMatch(submit, /MakeCall|aliyuncs|today_follow_advance|callRecordIds/);
const loadStart = api.indexOf("async function loadOutcomeNotePhrases");
const loadEnd = api.indexOf("function insertOutcomeNotePhrase", loadStart);
assert.ok(loadStart > 0 && loadEnd > loadStart);
const load = api.slice(loadStart, loadEnd);
assert.match(load, /shortcut: Boolean\(shell\.closest\("\[data-call-outcome-form\]"\)\)/);
assert.equal(load.includes("/api/outbound-call-records/"), false);
assert.match(api, /applyCallOutcomeShortcut\(event\)/);

console.log("call outcome key tests passed");
