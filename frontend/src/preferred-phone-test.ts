import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  preferredChooserActions,
  preferredPhoneClearBody,
  preferredPhoneListMark,
  preferredPhoneSetBody,
  renderPreferredPhoneChooser,
  selectPreferredPhoneId
} from "./preferred-phone.js";

assert.equal(selectPreferredPhoneId(["a", "b"], "b", new Set()), "b");
assert.equal(selectPreferredPhoneId(["a", "b"], "b", new Set(["b"])), "a");
assert.equal(selectPreferredPhoneId(["b"], "b", new Set(["b"])), "b");
assert.equal(selectPreferredPhoneId(["a", "b"], "missing", []), "a");
assert.equal(selectPreferredPhoneId([], "a", new Set()), "");

const change = preferredChooserActions({
  selectedPhoneId: "a",
  preferredPhoneId: "b",
  selectedInvalid: false,
  canWrite: true
});
assert.equal(change.saveLabel, "更换首选");
assert.equal(change.showSave, true);
assert.equal(change.showClear, true);
const same = preferredChooserActions({
  selectedPhoneId: "b",
  preferredPhoneId: "b",
  selectedInvalid: false,
  canWrite: true
});
assert.equal(same.showSave, false);
assert.equal(same.showClear, true);
const invalid = preferredChooserActions({
  selectedPhoneId: "a",
  preferredPhoneId: "",
  selectedInvalid: true,
  canWrite: true
});
assert.equal(invalid.showSave, false);
assert.equal(invalid.saveLabel, "设为首选");
assert.equal(preferredChooserActions({
  selectedPhoneId: "a",
  preferredPhoneId: "",
  selectedInvalid: false,
  canWrite: false
}).showSave, false);

assert.deepEqual(preferredPhoneSetBody({ targetType: "lead", targetId: "l1", phoneId: "lead-phone:l1" }), {
  targetType: "lead",
  targetId: "l1",
  phoneId: "lead-phone:l1"
});
assert.equal("phones" in preferredPhoneSetBody({ targetType: "customer", targetId: "c1", phoneId: "customer-phone:c1" }), false);
assert.deepEqual(preferredPhoneClearBody({ targetType: "customer", targetId: "c1" }), {
  targetType: "customer",
  targetId: "c1"
});
assert.match(preferredPhoneListMark(true), /data-preferred-phone="1"/);
assert.equal(preferredPhoneListMark(false), "");

const html = renderPreferredPhoneChooser({
  targetType: "prospect",
  targetId: "cand-1",
  phones: [
    { phoneId: "a", label: "+100", invalid: false },
    { phoneId: "b", label: "+200", invalid: false }
  ],
  preferredPhoneId: "b",
  canWrite: true,
  dialButtonHtml: `<button data-outbound-call="1" data-outbound-phone-id="b">外呼</button>`,
  validityHtml: "",
  invalidHintHtml: ""
});
assert.match(html, /data-preferred-phone-select/);
assert.match(html, /value="b" selected/);
assert.match(html, /data-preferred-option="1"/);
assert.match(html, /data-preferred-manual="1"/);
assert.match(html, /改选不会拨出/);
assert.match(html, /data-outbound-call="1"/);
assert.equal(html.includes("/api/outbound-calls"), false);
assert.equal(html.includes("fetch("), false);

const skipped = renderPreferredPhoneChooser({
  targetType: "prospect",
  targetId: "cand-1",
  phones: [
    { phoneId: "a", label: "+100", invalid: false },
    { phoneId: "b", label: "+200", invalid: true }
  ],
  preferredPhoneId: "b",
  canWrite: true,
  dialButtonHtml: `<button data-outbound-call="1" data-outbound-phone-id="a" disabled>外呼</button>`,
  validityHtml: "",
  invalidHintHtml: ""
});
assert.match(skipped, /value="a" selected/);
assert.doesNotMatch(skipped, /value="b" selected/);
assert.match(skipped, /更换首选/);

const single = renderPreferredPhoneChooser({
  targetType: "customer",
  targetId: "c1",
  phones: [{ phoneId: "customer-phone:c1", label: "+100", invalid: false }],
  preferredPhoneId: "customer-phone:c1",
  canWrite: true,
  dialButtonHtml: `<button data-outbound-call="1">外呼</button>`,
  validityHtml: "",
  invalidHintHtml: ""
});
assert.equal(single.includes("data-preferred-phone-select"), false);
assert.match(single, /data-preferred-phone="1"/);
assert.match(single, /清除首选/);
assert.equal(single.includes("设为首选"), false);

const page = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(page, /\/api\/preferred-phones/);
assert.match(page, /selectPreferredPhoneId/);
assert.match(page, /preferredPhoneListMark/);
assert.match(page, /renderProspectOutboundCalls/);
assert.doesNotMatch(page, /批量设为首选|全部设为首选|自动拨打首选/);
const syncStart = page.indexOf("function syncPreferredPhoneChooser");
const syncEnd = page.indexOf("let preferredPhonePending", syncStart);
assert.ok(syncStart > 0 && syncEnd > syncStart);
assert.doesNotMatch(page.slice(syncStart, syncEnd), /startOutboundCall|\/api\/outbound-calls/);
assert.match(style, /\.preferred-phone-mark/);

const server = readFileSync(new URL("../../backend/src/preferred-phone.ts", import.meta.url), "utf8");
assert.doesNotMatch(server, /MakeCall|aliyuncs\.com|convert_to_lead|approved_contactable/);

console.log("preferred phone frontend tests passed");
