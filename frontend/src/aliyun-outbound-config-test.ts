import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAliyunOutboundConfigBody,
  connectivityResultLines,
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

const windowed = buildAliyunOutboundConfigBody({
  aliyunOutboundEnabled: false,
  instanceId: "ccc-demo",
  region: "cn-shanghai",
  callerNumber: "02100001111",
  accessKeyId: "",
  accessKeySecret: "",
  callbackPathToken: "",
  callWindowStart: "10:00",
  callWindowEnd: "18:00",
  maxCallsPerNumberPerDay: 2,
  minIntervalMinutes: 45
});
assert.equal(windowed.ok, true);
if (windowed.ok) {
  assert.equal(windowed.body.aliyunOutboundEnabled, false);
  assert.equal(windowed.body.callWindowStart, "10:00");
  assert.equal(windowed.body.callWindowEnd, "18:00");
  assert.equal(windowed.body.maxCallsPerNumberPerDay, 2);
  assert.equal(windowed.body.minIntervalMinutes, 45);
}

const backwards = buildAliyunOutboundConfigBody({
  aliyunOutboundEnabled: false,
  instanceId: "",
  region: "",
  callerNumber: "",
  accessKeyId: "",
  accessKeySecret: "",
  callbackPathToken: "",
  callWindowStart: "20:00",
  callWindowEnd: "09:00",
  maxCallsPerNumberPerDay: 3,
  minIntervalMinutes: 30
});
assert.equal(backwards.ok, false);
if (!backwards.ok) assert.match(backwards.message, /开始必须早于结束/);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const sectionStart = page.indexOf('id="aliyunOutboundConfigSection"');
assert.ok(sectionStart > 0, "系统设置里要有阿里云外呼配置");
const section = page.slice(sectionStart, sectionStart + 3500);
assert.match(section, /hidden/);
assert.match(page, /id="aliyunOutboundEnabled"/);
assert.doesNotMatch(page.slice(sectionStart, sectionStart + 400), /aliyunOutboundEnabled"[\s\S]{0,80}checked/);
assert.match(page, /value="cn-shanghai"/);
assert.match(page, /value="cn-hangzhou"/);
assert.match(page, /id="aliyunOutboundCallWindowStart"/);
assert.match(page, /id="aliyunOutboundCallWindowEnd"/);
assert.match(page, /id="aliyunOutboundMaxCallsPerDay"/);
assert.match(page, /id="aliyunOutboundMinIntervalMinutes"/);
const windowInput = page.indexOf('id="aliyunOutboundCallWindowStart"');
assert.match(page.slice(windowInput, windowInput + 180), /value="09:00"/);
const endInput = page.indexOf('id="aliyunOutboundCallWindowEnd"');
assert.match(page.slice(endInput, endInput + 180), /value="20:00"/);
assert.match(page, /不会自动拨号/);
assert.match(page, /也不会把功能开关打开/);
assert.match(page, /id="aliyunOutboundConnectivityButton"/);
assert.match(page, /连通性自检/);
assert.doesNotMatch(section, /MakeCall|aliyuncs\.com|批量拨打/);
const lines = connectivityResultLines([
  { id: "config_complete", ok: true, detail: "实例、地域、主叫号码和访问密钥都已保存" },
  { id: "credentials", ok: false, detail: "访问凭证不可用" },
  { id: "instance", ok: false, detail: "凭证未通过，尚未确认实例" },
  { id: "agent_mapping", ok: true, detail: "本租户已保存坐席映射" },
  { id: "callback", ok: true, detail: "回调路径令牌已保存" }
]);
assert.match(lines[0], /配置是否完整：通过/);
assert.match(lines[1], /凭证是否可用：未通过/);
assert.match(lines[2], /实例是否可达：未通过/);
assert.match(lines[3], /坐席映射是否存在：通过/);
assert.match(lines[4], /回调地址是否已配置：通过/);
assert.equal(lines.join("\n").includes("LTAI"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /loadAliyunOutboundConfig/);
assert.match(api, /aliyunOutboundCallWindowStart/);
assert.match(api, /aliyunOutboundMaxCallsPerDay/);
assert.match(api, /aliyunOutboundMinIntervalMinutes/);
assert.match(api, /secretStatusText/);
assert.match(api, /aliyunOutboundAccessKeySecret"\)\.value = ""|setFieldValue\("#aliyunOutboundAccessKeySecret", ""\)/);
assert.doesNotMatch(api, /console\.(log|info|debug|warn|error)\([\s\S]{0,80}accessKeySecret/);
const checkStart = api.indexOf("async function runAliyunOutboundConnectivityCheck");
assert.ok(checkStart > 0);
const checkFn = api.slice(checkStart, checkStart + 900);
assert.match(checkFn, /\/api\/aliyun-outbound\/connectivity-check/);
assert.match(checkFn, /method: "POST"/);
assert.match(checkFn, /body: "\{\}"/);
assert.doesNotMatch(checkFn, /accessKeySecret|accessKeyId|callbackPathToken|aliyunOutboundEnabled/);

console.log("aliyun outbound config frontend tests passed");
