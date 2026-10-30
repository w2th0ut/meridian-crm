import assert from "node:assert/strict";
import {
  emptyOutreachFailure,
  outreachFailureMatchesFilter,
  outreachFailureRewriteLabel,
  outreachFailureSummary,
  presentOutreachFailure
} from "./prospect-outreach-failure.js";

const none = emptyOutreachFailure();
assert.equal(none.label, "无失败记录");
assert.equal(none.status, "none");
assert.match(outreachFailureSummary(none), /不是抑制或退订/);
assert.match(outreachFailureSummary(none), /不会自动重发/);
assert.doesNotMatch(outreachFailureSummary(none), /原因未回传|已退信|解除抑制/);
assert.equal(outreachFailureMatchesFilter(none, "clear"), true);
assert.equal(outreachFailureMatchesFilter(none, "hit"), false);
assert.equal(outreachFailureRewriteLabel(none, true), "");

assert.equal(presentOutreachFailure(null).status, "none");
assert.equal(presentOutreachFailure({ status: "hit", kind: "suppressed", reason: "暂停外发" }).status, "none");
assert.equal(presentOutreachFailure({ status: "none", reason: "Secret", label: "已退信" }).label, "无失败记录");

const bounced = presentOutreachFailure({
  status: "hit",
  kind: "bounced",
  label: "已退信",
  reason: "550 user unknown",
  at: "2026-10-03T08:00:00.000Z"
});
assert.equal(bounced.kind, "bounced");
assert.equal(bounced.label, "开发信退信");
assert.equal(bounced.reason, "550 user unknown");
assert.equal(outreachFailureRewriteLabel(bounced, true), "去重写开发信草稿");
assert.equal(outreachFailureRewriteLabel(bounced, false), "");
assert.match(outreachFailureSummary(bounced, "2026-10-03 16:00", true), /可以打开现有开发信草稿重写/);
assert.match(outreachFailureSummary(bounced, "2026-10-03 16:00", true), /不会自动重发，也不会解除抑制/);
assert.doesNotMatch(outreachFailureSummary(bounced, "", false), /已退信|原因未回传/);
assert.match(outreachFailureSummary(bounced, "", false), /当前不能从这里重写草稿/);
assert.equal(outreachFailureMatchesFilter(bounced, "hit"), true);
assert.equal(outreachFailureMatchesFilter(bounced, "all"), true);

const missingReason = presentOutreachFailure({
  status: "hit",
  kind: "send_failed",
  reason: "  ",
  at: "not-a-date"
});
assert.equal(missingReason.label, "发送失败");
assert.equal(missingReason.reason, "发送失败说明未写入");
assert.equal(missingReason.at, "");

console.log("prospect-outreach-failure-test: ok");
