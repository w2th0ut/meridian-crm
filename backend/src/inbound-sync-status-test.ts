import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeInboundSyncStatus, emptyInboundSyncStatus } from "./inbound-sync-status.js";

const clear = emptyInboundSyncStatus();
assert.equal(clear.condition, "clear");
assert.equal(clear.label, "正常");
assert.equal(clear.error, "");

const ok = describeInboundSyncStatus({
  id: "user_1",
  name: "  王敏  ",
  lastInboundSyncStatus: "ok",
  lastInboundSyncError: "不该出现的发信失败",
  lastInboundSyncAt: "2026-10-18T08:00:00.000Z",
  imapPassword: "secret-imap",
  smtpPassword: "secret-smtp"
} as {
  id: string;
  name: string;
  lastInboundSyncStatus: string;
  lastInboundSyncError: string;
  lastInboundSyncAt: string;
});
assert.equal(ok.condition, "clear");
assert.equal(ok.label, "正常");
assert.equal(ok.error, "");
assert.equal(ok.accountName, "王敏");
assert.equal(ok.syncedAt, "2026-10-18T08:00:00.000Z");
assert.equal(JSON.stringify(ok).includes("secret"), false);
assert.equal(JSON.stringify(ok).includes("不该出现"), false);

for (const status of ["", "ok", "OK", "failed", "bounce", "pending"]) {
  const view = describeInboundSyncStatus({
    id: "user_1",
    name: "王敏",
    lastInboundSyncStatus: status,
    lastInboundSyncError: "550 mailbox"
  });
  assert.equal(view.condition, "clear", status);
  assert.equal(view.label, "正常", status);
  assert.equal(view.error, "", status);
}

const missing = describeInboundSyncStatus({ id: "user_1", name: "王敏" });
assert.equal(missing.condition, "clear");
assert.equal(missing.label, "正常");
assert.equal(missing.syncedAt, "");

const broken = describeInboundSyncStatus({
  id: "user_2",
  name: "李雷",
  lastInboundSyncStatus: " error ",
  lastInboundSyncError: "  IMAP 登录失败  ",
  lastInboundSyncAt: "不是时间",
  error: "这是别的失败字段"
} as {
  id: string;
  name: string;
  lastInboundSyncStatus: string;
  lastInboundSyncError: string;
  lastInboundSyncAt: string;
});
assert.equal(broken.condition, "error");
assert.equal(broken.label, "收信同步异常");
assert.equal(broken.error, "IMAP 登录失败");
assert.equal(broken.syncedAt, "");
assert.equal(JSON.stringify(broken).includes("别的失败字段"), false);

const blankError = describeInboundSyncStatus({
  id: "user_3",
  name: "赵乾",
  lastInboundSyncStatus: "error",
  lastInboundSyncError: "   "
});
assert.equal(blankError.condition, "error");
assert.equal(blankError.error, "");

const clipped = describeInboundSyncStatus({
  id: "user_4",
  name: "周宁",
  lastInboundSyncStatus: "error",
  lastInboundSyncError: "甲".repeat(90)
});
assert.equal(clipped.error, `${"甲".repeat(80)}…`);

const source = readFileSync(new URL("./inbound-sync-status.ts", import.meta.url), "utf8");
assert.match(source, /!== "error"/);
assert.doesNotMatch(source, /convert_to_lead|approved_contactable|synchronizeUser|inbound-mail\/sync|nodemailer|send-development-email/);

const authSource = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");
assert.match(authSource, /describeInboundSyncStatus\(/, "登录账号必须带回收信同步只读投影");
assert.match(authSource, /lastInboundSyncStatus/);
assert.match(authSource, /lastInboundSyncError/);

console.log("inbound-sync-status-test: ok");
