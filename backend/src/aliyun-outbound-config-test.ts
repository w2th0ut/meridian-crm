import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decryptAliyunOutboundSecret,
  encryptAliyunOutboundSecret
} from "./credential-security.js";
import {
  ALIYUN_CCC_REGION_IDS,
  maskAliyunOutboundSecret,
  readAliyunOutboundConfig,
  updateAliyunOutboundConfig,
  type AliyunOutboundConfigStore
} from "./aliyun-outbound-config.js";
import type { AliyunOutboundConfig, AliyunOutboundConfigAudit } from "./types.js";

const secret = "SkSecretValue9999abcd";
const accessKeyId = "LTAI12345678abcd";
const callbackToken = "callbackTokenValue1234";

assert.deepEqual(maskAliyunOutboundSecret(""), { configured: false, last4: "" });
assert.deepEqual(maskAliyunOutboundSecret("abcd"), { configured: true, last4: "" });
assert.deepEqual(maskAliyunOutboundSecret(secret), { configured: true, last4: "abcd" });
assert.equal(JSON.stringify(maskAliyunOutboundSecret(secret)).includes(secret), false);

const encrypted = encryptAliyunOutboundSecret("europe", "accessKeySecret", secret);
assert.match(encrypted, /^aliyun-ccc-v1\./);
assert.equal(encrypted.includes(secret), false);
assert.equal(decryptAliyunOutboundSecret("europe", "accessKeySecret", encrypted), secret);
assert.throws(() => decryptAliyunOutboundSecret("middle-east", "accessKeySecret", encrypted));
assert.throws(() => decryptAliyunOutboundSecret("europe", "accessKeyId", encrypted));

function memoryStore(): AliyunOutboundConfigStore & {
  aliyunOutboundConfigs: AliyunOutboundConfig[];
  aliyunOutboundConfigAudits: AliyunOutboundConfigAudit[];
} {
  return {
    aliyunOutboundConfigs: [],
    aliyunOutboundConfigAudits: [],
    async persist() {}
  };
}

const admin = { id: "u_admin", teamId: "europe", role: "admin" as const };
const sales = { id: "u_sales", teamId: "europe", role: "sales" as const };
const store = memoryStore();

const initial = readAliyunOutboundConfig(store, admin);
assert.equal(initial.config.aliyunOutboundEnabled, false);
assert.equal(initial.config.accessKeySecret.configured, false);
assert.equal(initial.config.accessKeySecret.last4, "");
assert.deepEqual(initial.regions, [...ALIYUN_CCC_REGION_IDS]);
assert.equal(store.aliyunOutboundConfigs.length, 0);
assert.equal(store.aliyunOutboundConfigAudits.length, 0);

await assert.rejects(() => updateAliyunOutboundConfig(store, sales, { region: "cn-shanghai" }), (error: unknown) => {
  assert.equal((error as { status?: number }).status, 403);
  return true;
});
assert.equal(store.aliyunOutboundConfigAudits.length, 0);

await assert.rejects(() => updateAliyunOutboundConfig(store, admin, { region: "cn-beijing" }), (error: unknown) => {
  const rejected = error as { status?: number; message?: string };
  assert.equal(rejected.status, 400);
  assert.match(String(rejected.message), /cn-shanghai/);
  assert.equal(String(rejected.message).includes("cn-beijing"), false);
  return true;
});
assert.equal(store.aliyunOutboundConfigs.length, 0);
assert.equal(store.aliyunOutboundConfigAudits.length, 0);

const saved = await updateAliyunOutboundConfig(store, admin, {
  aliyunOutboundEnabled: false,
  instanceId: "ccc-demo",
  region: "cn-shanghai",
  callerNumber: "02100001111",
  accessKeyId,
  accessKeySecret: secret,
  callbackPathToken: callbackToken
});
assert.equal(saved.config.aliyunOutboundEnabled, false);
assert.equal(saved.config.instanceId, "ccc-demo");
assert.equal(saved.config.region, "cn-shanghai");
assert.equal(saved.config.accessKeySecret.configured, true);
assert.equal(saved.config.accessKeySecret.last4, "abcd");
assert.equal(saved.config.accessKeyId.last4, "abcd");
assert.equal(saved.config.callbackPathToken.last4, "1234");
const publicJson = JSON.stringify(saved);
assert.equal(publicJson.includes(secret), false);
assert.equal(publicJson.includes(accessKeyId), false);
assert.equal(publicJson.includes(callbackToken), false);
assert.equal(publicJson.includes("aliyun-ccc-v1"), false);

const stored = store.aliyunOutboundConfigs[0];
assert.equal(stored.accessKeySecretEncrypted.includes(secret), false);
assert.equal(stored.accessKeyIdEncrypted.includes(accessKeyId), false);
assert.equal(stored.callbackPathTokenEncrypted.includes(callbackToken), false);
assert.equal(store.aliyunOutboundConfigAudits.length, 1);
const auditJson = JSON.stringify(store.aliyunOutboundConfigAudits);
assert.equal(auditJson.includes(secret), false);
assert.equal(auditJson.includes(accessKeyId), false);
assert.equal(auditJson.includes(callbackToken), false);
assert.match(store.aliyunOutboundConfigAudits[0].summary, /accessKeySecret: 已配置/);
assert.match(store.aliyunOutboundConfigAudits[0].summary, /instanceId: （空） → ccc-demo/);
assert.equal(store.aliyunOutboundConfigAudits[0].summary.includes(secret), false);
assert.equal(store.aliyunOutboundConfigAudits[0].summary.includes("false → false"), false);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS aliyun_outbound_config_audits \(/);
assert.equal(schema.includes("CREATE TABLE aliyun_outbound_config_audits"), false);
assert.match(schema, /CREATE TABLE IF NOT EXISTS aliyun_outbound_configs \(/);
const source = readFileSync(new URL("./aliyun-outbound-config.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /aliyuncs\.com|MakeCall|fetch\(/);
assert.doesNotMatch(source, /console\.(log|info|debug|warn|error)/);

console.log("aliyun outbound config tests passed");
