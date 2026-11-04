import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  renderProspectCallNotes,
  renderProspectCallNotesEmpty,
  renderProspectCallNotesShell
} from "./prospect-call-notes.js";

const shell = renderProspectCallNotesShell("p_1");
assert.match(shell, /data-prospect-call-notes="1"/);
assert.match(shell, /data-candidate-id="p_1"/);
assert.match(shell, /data-prospect-call-notes-load="1"/);
assert.match(shell, /点查看后才读取/);
assert.doesNotMatch(shell, /\/api\/prospect-call-notes/);
assert.doesNotMatch(shell, /外呼|拨打|拨号/);

const empty = renderProspectCallNotesEmpty();
assert.match(empty, /还没有通话纪要/);
assert.doesNotMatch(empty, />0</);

const html = renderProspectCallNotes({
  candidateId: "p_1",
  items: [
    {
      callRecordId: "ocr_1",
      note: "要样品<script>",
      tags: ["需求", "预算"],
      at: "2026-11-01T01:00:00.000Z",
      maskedNumber: "****8000"
    },
    {
      callRecordId: "ocr_2",
      note: "",
      tags: [],
      at: "",
      maskedNumber: ""
    }
  ]
});
assert.match(html, /data-prospect-call-note="1"/);
assert.match(html, /data-prospect-call-note-open="1"/);
assert.match(html, /要样品&lt;script&gt;/);
assert.match(html, /要点：需求、预算/);
assert.match(html, /\*\*\*\*8000/);
assert.match(html, /未选要点/);
assert.match(html, /data-prospect-call-note-at="1">—</);
assert.doesNotMatch(html, /<script>/);
assert.doesNotMatch(html, /外呼|拨打|拨号/);
assert.equal(renderProspectCallNotes({ items: [] }), empty);
assert.equal(renderProspectCallNotes(undefined), empty);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const followEntry = api.slice(api.indexOf("function renderProspectFollowUpEntry"), api.indexOf("function focusProspectFollowUpInput"));
assert.match(followEntry, /renderProspectCallNotesShell\(item\.id\)/);
assert.doesNotMatch(followEntry, /\/api\/prospect-call-notes/);
assert.match(api, /\/api\/prospect-call-notes\?candidateId=/);
assert.match(api, /data-prospect-call-note-open/);
assert.match(api, /activateNavView\("outbound-call-records"\)/);
assert.doesNotMatch(api.slice(api.indexOf("async function loadProspectCallNotes"), api.indexOf("async function saveProspectFollowUp")), /convert_to_lead|approved_contactable|send-development-email/);

console.log("prospect call note frontend tests passed");
