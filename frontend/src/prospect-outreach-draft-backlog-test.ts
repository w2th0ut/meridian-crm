import assert from "node:assert/strict";
import {
  emptyOutreachDraftBacklog,
  outreachDraftBacklogCount,
  outreachDraftBacklogEntryLabel,
  outreachDraftBacklogLineLabel,
  outreachDraftBacklogMatchesFilter,
  outreachDraftBacklogSummary,
  outreachDraftBacklogUpdatedAt,
  presentOutreachDraftBacklog
} from "./prospect-outreach-draft-backlog.js";

const none = emptyOutreachDraftBacklog();
assert.equal(none.backlog, "none");
assert.equal(outreachDraftBacklogLineLabel(none), "无待发草稿");
assert.equal(outreachDraftBacklogEntryLabel(none), "");
assert.equal(outreachDraftBacklogCount(none), 0);
assert.match(outreachDraftBacklogSummary(none), /无待发草稿/);
assert.match(outreachDraftBacklogSummary(none), /这不是外联序列，也不是回复条，也不是打开或点击条，也不是失败条，也不是抑制条/);
assert.match(outreachDraftBacklogSummary(none), /不会放行批次，也不会发送/);
assert.doesNotMatch(outreachDraftBacklogSummary(none), /无序列|无回复|有回复|无打开|发送失败|已退信|原因未回传|解除抑制|进行中/);
assert.equal(outreachDraftBacklogMatchesFilter(none, "pending"), false);
assert.equal(outreachDraftBacklogMatchesFilter(none, "clear"), true);
assert.equal(outreachDraftBacklogMatchesFilter(none, "all"), true);

assert.equal(presentOutreachDraftBacklog(null).backlog, "none");
assert.equal(presentOutreachDraftBacklog({
  backlog: "pending",
  count: 2,
  subject: "不该把序列当草稿",
  batchId: "batch_1",
  progress: "active",
  statusLabel: "进行中",
  source: "plan"
}).backlog, "none");
assert.equal(presentOutreachDraftBacklog({
  backlog: "pending",
  count: 1,
  excerpt: "客户回了",
  at: "2026-10-18T08:00:00.000Z",
  batchId: "batch_1"
}).backlog, "none");
assert.equal(presentOutreachDraftBacklog({
  backlog: "pending",
  count: 1,
  open: { count: 1 },
  click: { count: 0 },
  batchId: "batch_1"
}).backlog, "none");
assert.equal(presentOutreachDraftBacklog({
  backlog: "pending",
  count: 1,
  kind: "send_failed",
  reason: "550",
  batchId: "batch_1"
}).backlog, "none");
assert.equal(presentOutreachDraftBacklog({ backlog: "pending", count: 1, batchId: "" }).backlog, "none");
assert.equal(presentOutreachDraftBacklog({ backlog: "pending", count: 0, batchId: "batch_1" }).backlog, "none");
assert.equal(presentOutreachDraftBacklog({ backlog: "none", count: 3, batchId: "batch_1" }).backlog, "none");

const pending = presentOutreachDraftBacklog({
  backlog: "pending",
  count: 3,
  subject: "  泰国台秤  ",
  batchId: "batch_1",
  updatedAt: "2026-10-18T08:00:00.000Z"
});
assert.equal(pending.backlog, "pending");
assert.equal(pending.subject, "泰国台秤");
assert.equal(outreachDraftBacklogLineLabel(pending), "待发 3 封 · 泰国台秤");
assert.equal(outreachDraftBacklogEntryLabel(pending), "查看发信批次");
assert.equal(outreachDraftBacklogCount(pending), 3);
assert.match(outreachDraftBacklogSummary(pending), /待发 3 封/);
assert.match(outreachDraftBacklogSummary(pending), /最近一份主题是 泰国台秤/);
assert.match(outreachDraftBacklogSummary(pending), /不会放行批次，也不会发送/);
assert.doesNotMatch(outreachDraftBacklogSummary(pending), /无序列|进行中|无回复|发送失败|已退订/);
assert.equal(outreachDraftBacklogMatchesFilter(pending, "pending"), true);
assert.equal(outreachDraftBacklogMatchesFilter(pending, "clear"), false);
assert.equal(outreachDraftBacklogUpdatedAt(pending), Date.parse("2026-10-18T08:00:00.000Z"));

const blankSubject = presentOutreachDraftBacklog({
  backlog: "pending",
  count: 1,
  subject: "   ",
  batchId: "batch_blank",
  updatedAt: "not-a-date"
});
assert.equal(outreachDraftBacklogLineLabel(blankSubject), "待发 1 封");
assert.equal(outreachDraftBacklogUpdatedAt(blankSubject), 0);
assert.doesNotMatch(outreachDraftBacklogSummary(blankSubject), /最近一份主题/);

const clipped = presentOutreachDraftBacklog({
  backlog: "pending",
  count: 1,
  subject: "乙".repeat(60),
  batchId: "batch_long"
});
assert.equal(clipped.subject, `${"乙".repeat(48)}…`);
assert.equal(outreachDraftBacklogLineLabel(clipped), `待发 1 封 · ${"乙".repeat(48)}…`);

console.log("prospect-outreach-draft-backlog-test: ok");
