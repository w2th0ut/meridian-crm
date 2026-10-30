import assert from "node:assert/strict";
import {
  emptyOutreachSequence,
  outreachSequenceEntryLabel,
  outreachSequenceLineLabel,
  outreachSequenceMatchesFilter,
  outreachSequenceRank,
  outreachSequenceSummary,
  outreachSequenceUpdatedAt,
  presentOutreachSequence
} from "./prospect-outreach-sequence.js";

const none = emptyOutreachSequence();
assert.equal(none.progress, "none");
assert.equal(outreachSequenceLineLabel(none), "无序列");
assert.equal(outreachSequenceEntryLabel(none), "");
assert.match(outreachSequenceSummary(none), /无序列/);
assert.match(outreachSequenceSummary(none), /这不是回复条，也不是打开或点击条，也不是失败条，也不是抑制条/);
assert.match(outreachSequenceSummary(none), /不会推进序列，也不会自动发下一封/);
assert.doesNotMatch(outreachSequenceSummary(none), /无回复|有回复|无打开|发送失败|已退信|原因未回传|解除抑制/);
assert.equal(outreachSequenceMatchesFilter(none, "active"), false);
assert.equal(outreachSequenceMatchesFilter(none, "stopped"), false);
assert.equal(outreachSequenceMatchesFilter(none, "all"), true);

assert.equal(presentOutreachSequence(null).progress, "none");
assert.equal(presentOutreachSequence({
  progress: "active",
  statusLabel: "进行中",
  name: "不该把回复当序列",
  excerpt: "客户回了",
  at: "2026-10-04T08:00:00.000Z",
  source: "plan",
  sourceId: "plan_1"
}).progress, "none");
assert.equal(presentOutreachSequence({
  progress: "active",
  statusLabel: "进行中",
  open: { count: 1, at: "" },
  source: "plan",
  sourceId: "plan_1"
}).progress, "none");
assert.equal(presentOutreachSequence({
  progress: "stopped",
  statusLabel: "发送受阻",
  kind: "send_failed",
  reason: "550 user unknown",
  source: "batch",
  sourceId: "batch_1"
}).progress, "none");
assert.equal(presentOutreachSequence({
  progress: "active",
  statusLabel: "进行中",
  source: "plan",
  sourceId: ""
}).progress, "none");
assert.equal(presentOutreachSequence({
  progress: "active",
  statusLabel: "已暂停",
  source: "plan",
  sourceId: "plan_1"
}).progress, "none");

const active = presentOutreachSequence({
  progress: "active",
  statusLabel: "进行中",
  name: "  泰国台秤  ",
  stepName: "第二次跟进",
  source: "plan",
  sourceId: "plan_1",
  updatedAt: "2026-10-04T08:00:00.000Z"
});
assert.equal(active.progress, "active");
assert.equal(active.name, "泰国台秤");
assert.equal(outreachSequenceLineLabel(active), "泰国台秤 · 进行中");
assert.equal(outreachSequenceEntryLabel(active), "查看方案");
assert.match(outreachSequenceSummary(active), /序列 泰国台秤/);
assert.match(outreachSequenceSummary(active), /当前步骤 第二次跟进/);
assert.match(outreachSequenceSummary(active), /不会推进序列，也不会自动发下一封/);
assert.doesNotMatch(outreachSequenceSummary(active), /无回复|发送失败|已退订/);
assert.equal(outreachSequenceMatchesFilter(active, "active"), true);
assert.equal(outreachSequenceMatchesFilter(active, "stopped"), false);
assert.equal(outreachSequenceRank(active), 3);
assert.equal(outreachSequenceUpdatedAt(active), Date.parse("2026-10-04T08:00:00.000Z"));
assert.equal(active.scheduledAt, "");
assert.equal(none.scheduledAt, "");

const withDue = presentOutreachSequence({
  progress: "active",
  statusLabel: "进行中",
  name: "泰国台秤",
  stepName: "下一封",
  source: "plan",
  sourceId: "plan_due",
  updatedAt: "2026-10-01T00:00:00.000Z",
  scheduledAt: "  2026-10-20T08:30:00.000Z  "
});
assert.equal(withDue.scheduledAt, "2026-10-20T08:30:00.000Z");
assert.equal(withDue.updatedAt, "2026-10-01T00:00:00.000Z");
assert.notEqual(withDue.scheduledAt, withDue.updatedAt);

const wallDue = presentOutreachSequence({
  progress: "active",
  statusLabel: "进行中",
  source: "batch",
  sourceId: "batch_wall",
  scheduledAt: "2026-10-20 08:30"
});
assert.equal(wallDue.progress, "active");
assert.equal(wallDue.scheduledAt, "");

const stopped = presentOutreachSequence({
  progress: "stopped",
  statusLabel: "已暂停",
  name: "",
  stepName: "报价跟进",
  source: "batch",
  sourceId: "batch_1",
  updatedAt: "not-a-date"
});
assert.equal(outreachSequenceLineLabel(stopped), "报价跟进 · 已暂停");
assert.equal(outreachSequenceEntryLabel(stopped), "查看发信批次");
assert.equal(outreachSequenceMatchesFilter(stopped, "stopped"), true);
assert.equal(outreachSequenceMatchesFilter(stopped, "active"), false);
assert.equal(outreachSequenceUpdatedAt(stopped), 0);
assert.match(outreachSequenceSummary(stopped), /当前步骤 报价跟进/);
assert.doesNotMatch(outreachSequenceSummary(stopped), /序列 /);

const done = presentOutreachSequence({
  progress: "done",
  statusLabel: "已完成",
  stepName: "最后一封",
  source: "sequence",
  sourceId: "seq_1"
});
assert.equal(outreachSequenceLineLabel(done), "最后一封 · 已完成");
assert.equal(outreachSequenceEntryLabel(done), "查看触达序列");
assert.equal(outreachSequenceMatchesFilter(done, "active"), false);
assert.equal(outreachSequenceMatchesFilter(done, "stopped"), false);
assert.equal(outreachSequenceMatchesFilter(done, "all"), true);

const clipped = presentOutreachSequence({
  progress: "active",
  statusLabel: "进行中",
  name: "乙".repeat(60),
  source: "plan",
  sourceId: "plan_long"
});
assert.equal(clipped.name, `${"乙".repeat(48)}…`);
assert.equal(outreachSequenceLineLabel(clipped), `${"乙".repeat(48)}… · 进行中`);

const statusOnly = presentOutreachSequence({
  progress: "stopped",
  statusLabel: "已取消",
  source: "batch",
  sourceId: "batch_blank"
});
assert.equal(outreachSequenceLineLabel(statusOnly), "已取消");
assert.match(outreachSequenceSummary(statusOnly), /已取消/);

console.log("prospect-outreach-sequence-test: ok");
