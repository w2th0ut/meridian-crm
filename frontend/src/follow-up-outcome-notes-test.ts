import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  renderFollowUpOutcomeNotes,
  renderFollowUpOutcomeNotesEmpty,
  renderFollowUpOutcomeNotesShell
} from "./follow-up-outcome-notes.js";

const customerShell = renderFollowUpOutcomeNotesShell("customer", "c1");
assert.match(customerShell, /data-follow-up-outcome-notes="1"/);
assert.match(customerShell, /data-target-type="customer"/);
assert.match(customerShell, /data-target-id="c1"/);
assert.match(customerShell, /data-follow-up-outcome-notes-load="1"/);
assert.match(customerShell, /点查看后才读取这个客户的通话结果备注/);
assert.doesNotMatch(customerShell, /\/api\/follow-up-outcome-notes/);
assert.doesNotMatch(customerShell, /外呼|拨打|拨号/);

const leadShell = renderFollowUpOutcomeNotesShell("lead", "l1");
assert.match(leadShell, /data-target-type="lead"/);
assert.match(leadShell, /这条线索/);
assert.doesNotMatch(leadShell, /外呼|拨打|拨号/);

const empty = renderFollowUpOutcomeNotesEmpty();
assert.match(empty, /还没有通话结果备注/);
assert.doesNotMatch(empty, />0</);

const html = renderFollowUpOutcomeNotes({
  targetType: "customer",
  targetId: "c1",
  items: [
    {
      callRecordId: "ocr_1",
      outcomeLabel: "有意向",
      note: "要样品<script>",
      at: "2026-11-01T01:00:00.000Z",
      maskedNumber: "****8000"
    },
    {
      callRecordId: "ocr_2",
      outcomeLabel: "未标注",
      note: "先记着",
      at: "",
      maskedNumber: ""
    }
  ]
});
assert.match(html, /data-follow-up-outcome-note="1"/);
assert.match(html, /data-follow-up-outcome-note-open="1"/);
assert.match(html, /data-follow-up-outcome-label="1">有意向</);
assert.match(html, /data-follow-up-outcome-label="1">未标注</);
assert.match(html, /要样品&lt;script&gt;/);
assert.match(html, /\*\*\*\*8000/);
assert.match(html, /data-follow-up-outcome-note-at="1">—</);
assert.doesNotMatch(html, /<script>/);
assert.doesNotMatch(html, /外呼|拨打|拨号/);
assert.equal(renderFollowUpOutcomeNotes({ items: [] }), empty);
assert.equal(renderFollowUpOutcomeNotes(undefined), empty);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");

function sliceFn(name: string) {
  const start = api.indexOf(`function ${name}`);
  assert.ok(start >= 0, name);
  const next = api.indexOf("\nfunction ", start + 1);
  return api.slice(start, next === -1 ? undefined : next);
}

const pageFn = sliceFn("renderCustomerDetailPage");
const drawerFn = sliceFn("renderCustomerDrawer");
const leadFn = sliceFn("renderLeadDrawer");
const loadFn = sliceFn("loadFollowUpOutcomeNotes");
const bindFn = sliceFn("bindFollowUpOutcomeNotes");
assert.match(pageFn, /renderFollowUpOutcomeNotesShell\("customer", current\.id\)/);
assert.match(drawerFn, /renderFollowUpOutcomeNotesShell\("customer", customer\.id\)/);
assert.match(leadFn, /inTrash \? "" : renderFollowUpOutcomeNotesShell\("lead", lead\.id\)/);
assert.doesNotMatch(pageFn, /loadFollowUpOutcomeNotes|\/api\/follow-up-outcome-notes/);
assert.doesNotMatch(drawerFn, /loadFollowUpOutcomeNotes|\/api\/follow-up-outcome-notes/);
assert.doesNotMatch(leadFn, /loadFollowUpOutcomeNotes|\/api\/follow-up-outcome-notes/);
assert.match(loadFn, /\/api\/follow-up-outcome-notes\?targetType=/);
assert.doesNotMatch(loadFn, /convert_to_lead|approved_contactable|aliyuncs/);
assert.match(bindFn, /data-follow-up-outcome-note-open/);
assert.match(bindFn, /activateNavView\("outbound-call-records"\)/);
assert.match(bindFn, /loadFollowUpOutcomeNotes/);

console.log("follow-up outcome note frontend tests passed");
