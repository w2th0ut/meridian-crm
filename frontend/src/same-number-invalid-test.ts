import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderMarkPhoneInvalid } from "./outbound-call-records.js";
import { renderSameNumberInvalidLink, sameNumberInvalidRequest } from "./same-number-invalid.js";

assert.equal(renderSameNumberInvalidLink({
  count: 0,
  targetType: "customer",
  targetId: "c1",
  phoneId: "customer-phone:c1"
}), "");
assert.equal(renderSameNumberInvalidLink({
  count: 2,
  targetType: "vendor",
  targetId: "c1",
  phoneId: "customer-phone:c1"
}), "");

const link = renderSameNumberInvalidLink({
  count: 2,
  targetType: "lead",
  targetId: "l<1>",
  phoneId: "lead-phone:l1"
});
assert.match(link, /另有 2 个对象也用这个号码/);
assert.match(link, /data-same-number-invalid="1"/);
assert.match(link, /data-same-number-type="lead"/);
assert.match(link, /data-same-number-id="l&lt;1&gt;"/);
assert.match(link, /把其他对象上的这个号码也标为无效/);
assert.match(link, /不会拨出，也不会自动拨打/);
assert.equal(link.includes("外呼"), false);
assert.equal(link.includes("MakeCall"), false);
assert.equal(link.includes("批量"), false);
assert.deepEqual(sameNumberInvalidRequest({
  targetType: "customer",
  targetId: "c1",
  phoneId: "customer-phone:c1"
}), {
  targetType: "customer",
  targetId: "c1",
  phoneId: "customer-phone:c1"
});
assert.equal("targets" in sameNumberInvalidRequest({
  targetType: "customer",
  targetId: "c1",
  phoneId: "customer-phone:c1"
}), false);

const waiting = renderMarkPhoneInvalid({
  id: "ocr_1",
  callOutcome: "号码错误",
  phoneId: "customer-phone:c1",
  phoneInvalid: false,
  targetType: "customer",
  targetId: "c1",
  sameNumberCount: 3
});
assert.equal(waiting.includes("data-same-number-invalid"), false);
assert.match(waiting, /data-mark-phone-invalid="ocr_1"/);

const marked = renderMarkPhoneInvalid({
  id: "ocr_1",
  callOutcome: "号码错误",
  phoneId: "customer-phone:c1",
  phoneInvalid: true,
  targetType: "customer",
  targetId: "c1",
  sameNumberCount: 3
});
assert.match(marked, /另有 3 个对象也用这个号码/);
assert.equal(marked.includes("data-mark-phone-invalid"), false);
assert.equal(marked.includes(">外呼<"), false);

const quiet = renderMarkPhoneInvalid({
  id: "ocr_1",
  callOutcome: "号码错误",
  phoneId: "customer-phone:c1",
  phoneInvalid: true
});
assert.equal(quiet.includes("另有"), false);

const page = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(page, /\/api\/phone-validity\/same-number/);
assert.match(page, /submitSameNumberInvalid/);
assert.match(page, /sameNumberInvalidRequest/);
assert.equal(page.includes("批量标记号码"), false);
const moduleSource = readFileSync(new URL("./same-number-invalid.ts", import.meta.url), "utf8");
assert.doesNotMatch(moduleSource, /makeCall|MakeCall|aliyuncs|fetch\(/i);

console.log("same number invalid frontend tests passed");
