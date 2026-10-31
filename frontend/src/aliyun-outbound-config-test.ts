import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAliyunOutboundConfigBody,
  secretStatusText,
  showAliyunOutboundSettings
} from "./aliyun-outbound-config.js";

assert.equal(showAliyunOutboundSettings(false), false);
assert.equal(showAliyunOutboundSettings(true), true);

const secret = "LTAIsecretValue9999abcd";
assert.equal(secretStatusText({ configured: false, last4: "" }), "未配置");
assert.equal(secretStatusText({ configured: true, last4: "abcd" }), "已配置，末 4 位 abcd");
assert.equal(secretStatusText({ configured: true, last4: "abcd" }).includes(secret), false);

const kept = buildAliyunOutboundConfigBody({
  aliyunOutboundEnabled: false,
  instanceId: "ccc-demo",
  region: "cn-shanghai",
  callerNumber: "02100001111",
  accessKeyId: "",
  accessKeySecret: "   ",
  callbackPathToken: ""
});
assert.equal(kept.ok, true);
if (kept.ok) {
  assert.equal(kept.body.aliyunOutboundEnabled, false);
  assert.equal("accessKeyId" in kept.body, false);
  assert.equal("accessKeySecret" in kept.body, false);
  assert.equal("callbackPathToken" in kept.body, false);
  assert.equal(JSON.stringify(kept.body).includes(secret), false);
}

const shortSecret = buildAliyunOutboundConfigBody({
  aliyunOutboundEnabled: false,
  instanceId: "",
  region: "",
  callerNumber: "",
  accessKeyId: "",
  accessKeySecret: "abcd",
  callbackPathToken: ""
});
assert.equal(shortSecret.ok, false);
if (!shortSecret.ok) {
  assert.match(shortSecret.message, /AccessKeySecret/);
  assert.equal(shortSecret.message.includes("abcd"), false);
}

const illegalRegion = buildAliyunOutboundConfigBody({
  aliyunOutboundEnabled: true,
  instanceId: "ccc-demo",
  region: "cn-beijing",
  callerNumber: "",
  accessKeyId: "",
  accessKeySecret: "",
  callbackPathToken: ""
});
assert.equal(illegalRegion.ok, false);
if (!illegalRegion.ok) {
  assert.match(illegalRegion.message, /cn-shanghai/);
  assert.equal(illegalRegion.message.includes("cn-beijing"), false);
}

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sectionStart = page.indexOf('id="aliyunOutboundConfigSection"');
assert.ok(sectionStart > 0, "系统设置里要有阿里云外呼配置");
const section = page.slice(sectionStart, sectionStart + 2500);
assert.match(section, /hidden/);
assert.match(page, /id="aliyunOutboundEnabled"/);
assert.doesNotMatch(page.slice(sectionStart, sectionStart + 400), /aliyunOutboundEnabled"[\s\S]{0,80}checked/);
assert.match(page, /value="cn-shanghai"/);
assert.match(page, /value="cn-hangzhou"/);
assert.doesNotMatch(section, /拨打|MakeCall|aliyuncs\.com/);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /loadAliyunOutboundConfig/);
assert.match(api, /secretStatusText/);
assert.match(api, /aliyunOutboundAccessKeySecret"\)\.value = ""|setFieldValue\("#aliyunOutboundAccessKeySecret", ""\)/);
assert.doesNotMatch(api, /console\.(log|info|debug|warn|error)\([\s\S]{0,80}accessKeySecret/);

console.log("aliyun outbound config frontend tests passed");
