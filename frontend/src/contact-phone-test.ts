import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  contactPhoneChoiceLabel,
  contactPhoneCreateBody,
  contactPhoneDeleteBody,
  contactPhoneUpdateBody,
  renderContactPhoneEditor
} from "./contact-phones.js";

assert.equal(contactPhoneChoiceLabel("主号", "+46111"), "主号 +46111");
assert.equal(contactPhoneChoiceLabel("", "+46111"), "+46111");
assert.deepEqual(contactPhoneCreateBody({
  targetType: "customer",
  targetId: "c1",
  label: "手机",
  phone: "+46111"
}), {
  targetType: "customer",
  targetId: "c1",
  label: "手机",
  phone: "+46111"
});
assert.equal("phones" in contactPhoneCreateBody({ targetType: "customer", targetId: "c1", label: "手机", phone: "+46111" }), false);
assert.deepEqual(contactPhoneUpdateBody({
  targetType: "lead",
  targetId: "l1",
  phoneId: "contact-phone:1",
  label: "座机",
  phone: "+46222"
}), {
  targetType: "lead",
  targetId: "l1",
  phoneId: "contact-phone:1",
  label: "座机",
  phone: "+46222"
});
assert.deepEqual(contactPhoneDeleteBody({ targetType: "customer", targetId: "c1", phoneId: "contact-phone:1" }), {
  targetType: "customer",
  targetId: "c1",
  phoneId: "contact-phone:1"
});

const editor = renderContactPhoneEditor({
  targetType: "customer",
  targetId: "c1",
  extras: [{ phoneId: "contact-phone:1", label: "手机", phone: "+46700001111" }],
  canWrite: true
});
assert.match(editor, /data-contact-phone-add="1"/);
assert.equal(editor.match(/data-contact-phone-add/g)?.length, 1);
assert.match(editor, /data-contact-phone-save="1"/);
assert.match(editor, /data-contact-phone-delete="1"/);
assert.match(editor, /添加号码/);
assert.equal(editor.includes("data-outbound-call"), false);
assert.equal(editor.includes("data-contact-phone-batch"), false);
assert.equal(editor.includes("批量"), false);
assert.match(editor, /不会拨出/);
assert.equal(renderContactPhoneEditor({
  targetType: "customer",
  targetId: "c1",
  extras: [],
  canWrite: false
}), "");

const page = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(page, /\/api\/contact-phones/);
assert.match(page, /data-contact-phone-add/);
assert.equal(page.includes("data-contact-phone-batch"), false);
const source = readFileSync(new URL("./contact-phones.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /\/api\/outbound-calls|aliyuncs\.com|MakeCall/);

console.log("contact phone frontend tests passed");
