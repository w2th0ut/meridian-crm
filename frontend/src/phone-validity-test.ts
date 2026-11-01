import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  outboundCallButtonDisabled,
  outboundCallButtonTitle,
  showOutboundCallButton
} from "./outbound-call.js";
import { renderMarkPhoneInvalid, renderOutboundCallRecordDetail, renderOutboundCallRecordList } from "./outbound-call-records.js";
import { phoneValidityButtonLabel, phoneValidityRequest, renderPhoneValidityControl } from "./phone-validity.js";

assert.equal(outboundCallButtonDisabled(true), true);
assert.equal(outboundCallButtonDisabled(false), false);
assert.equal(outboundCallButtonTitle(true), "该号码已标记无效");
assert.equal(outboundCallButtonTitle(false), "只拨这一个号码");
assert.equal(showOutboundCallButton({ enabled: true, permitted: true, phone: "+46111222333" }), true);

assert.equal(phoneValidityButtonLabel(false), "标记该号码无效");
assert.equal(phoneValidityButtonLabel(true), "取消标记该号码无效");
assert.deepEqual(phoneValidityRequest({
  targetType: "lead",
  targetId: "l1",
  phoneId: "lead-phone:l1",
  invalid: true
}), {
  targetType: "lead",
  targetId: "l1",
  phoneId: "lead-phone:l1",
  invalid: true
});
assert.equal("phones" in phoneValidityRequest({
  targetType: "customer",
  targetId: "c1",
  phoneId: "customer-phone:c1",
  invalid: false
}), false);

const hidden = renderMarkPhoneInvalid({ id: "ocr_1", callOutcome: "有意向", phoneId: "customer-phone:c1" });
assert.equal(hidden, "");
const missingPhone = renderMarkPhoneInvalid({ id: "ocr_1", callOutcome: "号码错误" });
assert.equal(missingPhone, "");
const mark = renderMarkPhoneInvalid({ id: "ocr_1", callOutcome: "号码错误", phoneId: "customer-phone:c1", phoneInvalid: false });
assert.match(mark, /data-mark-phone-invalid="ocr_1"/);
assert.match(mark, /标记该号码无效/);
assert.equal(mark.includes("取消标记"), false);
assert.equal(mark.includes("批量"), false);
const marked = renderMarkPhoneInvalid({ id: "ocr_1", callOutcome: "号码错误", phoneId: "customer-phone:c1", phoneInvalid: true });
assert.match(marked, /data-phone-invalid="1"/);
assert.match(marked, /该号码已标记无效/);
assert.equal(marked.includes("data-mark-phone-invalid"), false);

const list = renderOutboundCallRecordList([
  { id: "ocr_1", callOutcome: "号码错误", phoneId: "customer-phone:c1", phoneInvalid: false }
]);
assert.match(list, /data-mark-phone-invalid="ocr_1"/);
assert.equal(list.includes("批量标记"), false);
assert.equal(list.includes(">外呼<"), false);

const detail = renderOutboundCallRecordDetail({
  record: { id: "ocr_2", established: false, callOutcome: "号码错误", phoneId: "lead-phone:l1", phoneInvalid: true, maskedNumber: "*******2333" }
});
assert.match(detail, /data-phone-invalid="1"/);
assert.equal(detail.includes("data-mark-phone-invalid"), false);
assert.equal(detail.includes("MakeCall"), false);

const control = renderPhoneValidityControl({
  targetType: "prospect",
  targetId: "cand-1",
  phoneId: "ch-phone",
  invalid: false,
  canWrite: true
});
assert.match(control, /data-phone-validity="1"/);
assert.match(control, /data-phone-validity-type="prospect"/);
assert.match(control, /data-phone-validity-phone="ch-phone"/);
assert.match(control, /标记该号码无效/);
assert.equal(control.includes("批量"), false);
const unmark = renderPhoneValidityControl({
  targetType: "customer",
  targetId: "c1",
  phoneId: "customer-phone:c1",
  invalid: true,
  canWrite: true
});
assert.match(unmark, /取消标记该号码无效/);
assert.match(unmark, /data-phone-invalid="1"/);
const readonly = renderPhoneValidityControl({
  targetType: "customer",
  targetId: "c1",
  phoneId: "customer-phone:c1",
  invalid: true,
  canWrite: false
});
assert.equal(readonly.includes("data-phone-validity="), false);
assert.match(readonly, /该号码已标记无效/);
assert.equal(renderPhoneValidityControl({
  targetType: "customer",
  targetId: "c1",
  phoneId: "customer-phone:c1",
  invalid: false,
  canWrite: false
}), "");

const gap = readFileSync(new URL("./prospect-contact-gap.ts", import.meta.url), "utf8");
assert.equal(gap.includes("号码无效"), false);
assert.equal(gap.includes("phoneInvalid"), false);
assert.equal(gap.includes("phone-validity"), false);

const page = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(page, /outboundCallButtonDisabled/);
assert.match(page, /data-outbound-invalid="1"/);
assert.match(page, /submitPhoneValidity/);
assert.match(page, /\/api\/phone-validity/);
assert.match(page, /phone-validity/);
assert.doesNotMatch(page, /批量标记号码|全部标记无效/);

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /\.outbound-call-button:disabled/);
assert.match(html, /标记该号码无效/);
assert.match(html, /不能批量标记/);

console.log("phone validity frontend tests passed");
