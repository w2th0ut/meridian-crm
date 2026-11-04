import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { missedNumberSwitchBody, showMissedNumberSwitch } from "./missed-number-switch.js";
import { renderPreferredPhoneChooser } from "./preferred-phone.js";

assert.deepEqual(missedNumberSwitchBody({ targetType: "customer", targetId: "c1" }), {
  targetType: "customer",
  targetId: "c1"
});
assert.equal("phoneId" in missedNumberSwitchBody({ targetType: "lead", targetId: "l1" }), false);
assert.equal(showMissedNumberSwitch({ phoneCount: 2, canWrite: true }), true);
assert.equal(showMissedNumberSwitch({ phoneCount: 1, canWrite: true }), false);
assert.equal(showMissedNumberSwitch({ phoneCount: 2, canWrite: false }), false);

const html = renderPreferredPhoneChooser({
  targetType: "customer",
  targetId: "c1",
  phones: [
    { phoneId: "customer-phone:c1", label: "+100", invalid: false },
    { phoneId: "contact-phone:extra", label: "+200", invalid: false }
  ],
  preferredPhoneId: "customer-phone:c1",
  canWrite: true,
  dialButtonHtml: `<button data-outbound-call="1" data-outbound-phone-id="customer-phone:c1">外呼</button>`,
  validityHtml: "",
  invalidHintHtml: ""
});
assert.match(html, /data-missed-number-switch="1"/);
assert.match(html, /首选改到另一个号码/);
assert.match(html, /只改首选，不会拨出/);
assert.equal(html.includes("/api/outbound-calls"), false);
assert.equal(html.includes("fetch("), false);
const switchButton = html.slice(html.indexOf("data-missed-number-switch"), html.indexOf("</button>", html.indexOf("data-missed-number-switch")));
assert.equal(switchButton.includes("data-outbound-call"), false);

const single = renderPreferredPhoneChooser({
  targetType: "customer",
  targetId: "c1",
  phones: [{ phoneId: "customer-phone:c1", label: "+100", invalid: false }],
  preferredPhoneId: "",
  canWrite: true,
  dialButtonHtml: `<button data-outbound-call="1">外呼</button>`,
  validityHtml: "",
  invalidHintHtml: ""
});
assert.equal(single.includes("data-missed-number-switch"), false);

const readonly = renderPreferredPhoneChooser({
  targetType: "prospect",
  targetId: "cand-1",
  phones: [
    { phoneId: "a", label: "+100", invalid: false },
    { phoneId: "b", label: "+200", invalid: false }
  ],
  preferredPhoneId: "",
  canWrite: false,
  dialButtonHtml: "",
  validityHtml: "",
  invalidHintHtml: ""
});
assert.equal(readonly.includes("data-missed-number-switch"), false);

const page = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const start = page.indexOf("async function submitMissedNumberSwitch");
const end = page.indexOf("function redrawPhoneValidity", start);
assert.ok(start > 0 && end > start);
const submit = page.slice(start, end);
assert.match(submit, /\/api\/preferred-phones\/switch-after-miss/);
assert.match(submit, /missedNumberSwitchBody/);
assert.doesNotMatch(submit, /startOutboundCall|\/api\/outbound-calls/);
const server = readFileSync(new URL("../../backend/src/missed-number-switch.ts", import.meta.url), "utf8");
assert.doesNotMatch(server, /MakeCall|aliyuncs\.com|convert_to_lead|approved_contactable|outbound_call_holds|same_day_call_skips/);

console.log("missed number switch frontend tests passed");
