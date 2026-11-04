import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CALL_OUTCOME_NOTE_PHRASE_MAX,
  applyOutcomeNotePhrase,
  renderOutcomeNotePhraseShell,
  renderOutcomeNotePhrases
} from "./call-outcome-note-phrase.js";
import { renderCallOutcomeForm, renderOutboundCallRecordDetail, renderOutboundCallRecordList } from "./outbound-call-records.js";

assert.equal(CALL_OUTCOME_NOTE_PHRASE_MAX, 200);
assert.deepEqual(applyOutcomeNotePhrase("", "  要样品  "), { value: "要样品", inserted: true });
assert.deepEqual(applyOutcomeNotePhrase("已有", "要样品"), { value: "已有 要样品", inserted: true });
assert.deepEqual(applyOutcomeNotePhrase("已有", "要样品"), { value: "已有 要样品", inserted: true });
assert.equal(applyOutcomeNotePhrase("文".repeat(200), "再").inserted, false);
assert.equal(applyOutcomeNotePhrase("已有", "要样品").value, "已有 要样品");
assert.equal(applyOutcomeNotePhrase("文".repeat(198), "样品").inserted, false);
assert.deepEqual(applyOutcomeNotePhrase("   ", "要样品"), { value: "要样品", inserted: true });
const kept = "已有备注";
assert.deepEqual(applyOutcomeNotePhrase(kept, "文".repeat(200)), { value: kept, inserted: false });

const shell = renderOutcomeNotePhraseShell();
assert.match(shell, /data-outcome-note-phrases="1"/);
assert.match(shell, /data-outcome-note-phrase-load="1"/);
assert.match(shell, /点常用短语后才读取/);
assert.equal(shell.includes("/api/"), false);
assert.equal(shell.includes("批量"), false);
assert.equal(shell.includes("MakeCall"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(shell), false);

const ready = renderOutcomeNotePhrases([
  { id: "csp_1", text: "要样品<script>", scope: "personal", enabled: true, canDisable: true },
  { id: "csp_2", text: "改日再打", scope: "team", enabled: true, canDisable: false },
  { id: "csp_3", text: "已停用", scope: "team", enabled: false, canDisable: true }
]);
assert.match(ready, /data-outcome-note-phrase="1"/);
assert.match(ready, /data-outcome-note-phrase-text="要样品&lt;script&gt;"/);
assert.match(ready, /要样品&lt;script&gt;/);
assert.match(ready, /自己/);
assert.match(ready, /团队/);
assert.match(ready, /data-outcome-note-phrase-save="1"/);
assert.match(ready, /data-outcome-note-phrase-disable="csp_1"/);
assert.equal(ready.includes("data-outcome-note-phrase-disable=\"csp_2\""), false);
assert.equal(ready.includes("已停用"), false);
assert.equal(ready.includes("/api/"), false);
assert.match(renderOutcomeNotePhrases([]), /data-outcome-note-phrase-empty="1"/);
assert.match(renderOutcomeNotePhrases([]), /保存短语/);

const form = renderCallOutcomeForm({ id: "ocr_1", callOutcome: "无意向", callOutcomeNote: "先看看" });
assert.match(form, /data-call-outcome-form="1"/);
assert.match(form, /data-outcome-note-phrases="1"/);
assert.match(form, /data-call-outcome-note/);
assert.match(form, /保存标注/);
assert.equal(form.includes("/api/"), false);
assert.equal(form.includes("批量"), false);
const list = renderOutboundCallRecordList([{ id: "ocr_1", established: true, callOutcome: "有意向" }]);
assert.match(list, /data-outcome-note-phrase-load="1"/);
assert.equal(list.includes("批量"), false);
const detail = renderOutboundCallRecordDetail({
  record: { id: "ocr_1", established: true, maskedNumber: "*******2333", callOutcome: "其他", callOutcomeNote: "" }
});
assert.match(detail, /data-outcome-note-phrases="1"/);
assert.equal(detail.includes("MakeCall"), false);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = page.indexOf('id="dashboardCallOutcomeBatch"');
const end = page.indexOf('id="dashboardAgentWorkStatusReport"', start);
const view = page.slice(start, end);
assert.match(view, /data-outcome-note-phrases="1"/);
assert.match(view, /data-outcome-note-phrase-load="1"/);
assert.match(view, /data-call-outcome-batch-note/);
assert.equal(view.includes("/api/call-outcome-note-phrases"), false);
assert.equal(/<button[^>]*>[^<]*外呼/.test(view), false);
const recordsStart = page.indexOf('id="outbound-call-records"');
const recordsEnd = page.indexOf('id="phone-strategies"', recordsStart);
assert.equal(page.slice(recordsStart, recordsEnd).includes("标注所选"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const refreshStart = api.indexOf("async function refreshDashboardOnly");
const refreshEnd = api.indexOf("function requestDashboardRefresh", refreshStart);
assert.equal(refreshStart > 0 && refreshEnd > refreshStart, true);
assert.equal(api.slice(refreshStart, refreshEnd).includes("/api/call-outcome-note-phrases"), false);
const loadStart = api.indexOf("async function loadOutcomeNotePhrases");
const loadEnd = api.indexOf("let agentWorkStatusReportAgentId", loadStart);
assert.equal(loadStart > 0 && loadEnd > loadStart, true);
const phraseFns = api.slice(loadStart, loadEnd);
assert.match(phraseFns, /\/api\/call-outcome-note-phrases"/);
assert.match(phraseFns, /\/api\/call-outcome-note-phrases\/disable/);
assert.match(phraseFns, /applyOutcomeNotePhrase/);
assert.equal(phraseFns.includes("/api/unlabeled-connected-calls/label"), false);
assert.equal(phraseFns.includes("/api/outbound-call-records/"), false);
assert.equal(phraseFns.includes("MakeCall"), false);
assert.equal(phraseFns.includes("aliyuncs.com"), false);
assert.match(api, /data-outcome-note-phrase-load/);
assert.match(api, /insertOutcomeNotePhrase/);

console.log("call outcome note phrase frontend tests passed");
