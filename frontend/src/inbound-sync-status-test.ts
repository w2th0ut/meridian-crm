import assert from "node:assert/strict";
import {
  INBOUND_SYNC_BOUNDARY,
  INBOUND_SYNC_LIMIT,
  emptyInboundSyncStatus,
  inboundSyncEntryLabel,
  inboundSyncLineLabel,
  inboundSyncMatchesFilter,
  inboundSyncSummary,
  listInboundSyncRows,
  presentInboundSyncStatus
} from "./inbound-sync-status.js";

assert.equal(INBOUND_SYNC_LIMIT, 8);

const none = emptyInboundSyncStatus();
assert.equal(none.condition, "clear");
assert.equal(inboundSyncLineLabel(none), "正常");
assert.equal(inboundSyncEntryLabel(none, "user_1"), "");
assert.match(inboundSyncSummary(none), /^正常。/);
assert.match(inboundSyncSummary(none), /这是收信同步，不是发件/);
assert.match(inboundSyncSummary(none), /不是待发草稿，也不是外联序列，也不是回复条，也不是打开或点击条，也不是失败条，也不是抑制条/);
assert.match(inboundSyncSummary(none), /不会改授权，不会重连，不会触发同步，也不会发信/);
assert.equal(inboundSyncSummary(none).includes(INBOUND_SYNC_BOUNDARY), true);
assert.doesNotMatch(inboundSyncSummary(none), /无待发草稿|无序列|无回复|无打开|发送失败|已退信|原因未回传|解除抑制|进行中/);
assert.equal(inboundSyncMatchesFilter(none, "error"), false);
assert.equal(inboundSyncMatchesFilter(none, "all"), true);

assert.equal(presentInboundSyncStatus(null).condition, "clear");
assert.equal(presentInboundSyncStatus({
  lastInboundSyncStatus: "error",
  lastInboundSyncError: "不该把草稿当收信异常",
  backlog: "pending",
  id: "user_1"
}).condition, "error");
assert.equal(presentInboundSyncStatus({
  condition: "error",
  label: "收信同步异常",
  error: "客户回了",
  excerpt: "客户回了",
  accountId: "user_1"
}).condition, "clear");
assert.equal(presentInboundSyncStatus({
  condition: "error",
  label: "收信同步异常",
  error: "打开了",
  open: { count: 1 },
  click: { count: 0 },
  accountId: "user_1"
}).condition, "clear");
assert.equal(presentInboundSyncStatus({
  condition: "error",
  label: "收信同步异常",
  kind: "send_failed",
  reason: "550",
  accountId: "user_1"
}).condition, "clear");
assert.equal(presentInboundSyncStatus({
  condition: "error",
  label: "待发草稿",
  error: "主题",
  accountId: "user_1"
}).label, "正常");

const ok = presentInboundSyncStatus({
  id: "user_1",
  name: "  王敏  ",
  lastInboundSyncStatus: "ok",
  lastInboundSyncError: "550",
  lastInboundSyncAt: "2026-10-18T08:00:00.000Z",
  imapPassword: "secret-imap",
  smtpPassword: "secret-smtp"
});
assert.equal(ok.condition, "clear");
assert.equal(ok.label, "正常");
assert.equal(ok.error, "");
assert.equal(ok.accountName, "王敏");
assert.equal(inboundSyncLineLabel(ok), "正常");
assert.equal(inboundSyncEntryLabel(ok, "user_1"), "收信设置");
assert.equal(inboundSyncEntryLabel(ok, "user_2"), "");
assert.equal(JSON.stringify(ok).includes("secret"), false);
assert.equal(JSON.stringify(ok).includes("550"), false);
assert.match(inboundSyncSummary(ok), /^正常。这是收信同步，不是发件/);
assert.match(inboundSyncSummary(ok), /不是待发草稿/);
assert.doesNotMatch(inboundSyncSummary(ok), /无待发草稿|无序列|原因未回传|解除抑制|自动发下一封|放行批次/);

for (const status of ["", "ok", "failed", "bounce"]) {
  const view = presentInboundSyncStatus({
    id: "user_1",
    name: "王敏",
    lastInboundSyncStatus: status,
    lastInboundSyncError: "不该算异常"
  });
  assert.equal(view.condition, "clear", status);
  assert.equal(view.error, "", status);
}

const broken = presentInboundSyncStatus({
  id: "user_2",
  name: "李雷",
  lastInboundSyncStatus: "error",
  lastInboundSyncError: "  IMAP 登录失败  ",
  lastInboundSyncAt: "2026-10-19T01:02:03.000Z"
});
assert.equal(broken.condition, "error");
assert.equal(inboundSyncLineLabel(broken), "收信同步异常 · IMAP 登录失败");
assert.match(inboundSyncSummary(broken), /^收信同步异常。IMAP 登录失败。/);
assert.match(inboundSyncSummary(broken), /不是发件/);
assert.doesNotMatch(inboundSyncSummary(broken), /无待发草稿|原因未回传|解除抑制|自动发下一封|放行批次/);
assert.equal(inboundSyncMatchesFilter(broken, "error"), true);
assert.equal(inboundSyncMatchesFilter(broken, "all"), true);
assert.equal(inboundSyncEntryLabel(broken, "user_2"), "收信设置");

const blank = presentInboundSyncStatus({
  id: "user_3",
  name: "赵乾",
  lastInboundSyncStatus: "error",
  lastInboundSyncError: "  "
});
assert.equal(inboundSyncLineLabel(blank), "收信同步异常");
assert.match(inboundSyncSummary(blank), /^收信同步异常。这是收信同步/);

const clipped = presentInboundSyncStatus({
  id: "user_4",
  name: "周宁",
  lastInboundSyncStatus: "error",
  lastInboundSyncError: "乙".repeat(90)
});
assert.equal(clipped.error, `${"乙".repeat(80)}…`);

const current = presentInboundSyncStatus({ id: "me", name: "当前", lastInboundSyncStatus: "ok" });
const errors = Array.from({ length: 9 }, (_, index) => presentInboundSyncStatus({
  id: `err_${index}`,
  name: `异常${index}`,
  lastInboundSyncStatus: "error",
  lastInboundSyncError: `失败${index}`,
  lastInboundSyncAt: `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
}));
const listed = listInboundSyncRows([errors[3], current, ...errors], "all", INBOUND_SYNC_LIMIT, "me");
assert.equal(listed.total, 10);
assert.equal(listed.shown.length, 8);
assert.equal(listed.shown[0]?.accountId, "me");
assert.equal(listed.shown[0]?.label, "正常");
assert.equal(listed.shown.slice(1).every((view) => view.condition === "error"), true);
assert.equal(listed.shown[1]?.accountId, "err_8");

const onlyErrors = listInboundSyncRows([current, ...errors], "error", INBOUND_SYNC_LIMIT, "me");
assert.equal(onlyErrors.total, 9);
assert.equal(onlyErrors.shown.length, 8);
assert.equal(onlyErrors.shown.every((view) => view.condition === "error"), true);
assert.equal(onlyErrors.shown.some((view) => view.accountId === "me"), false);

const alone = listInboundSyncRows([current], "all", INBOUND_SYNC_LIMIT, "me");
assert.equal(alone.shown.length, 1);
assert.equal(alone.shown[0]?.label, "正常");
assert.equal(listInboundSyncRows([current], "error", INBOUND_SYNC_LIMIT, "me").shown.length, 0);

console.log("inbound-sync-status-test: ok");
