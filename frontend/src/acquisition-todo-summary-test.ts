import assert from "node:assert/strict";
import {
  ACQUISITION_TODO_CATEGORY_ORDER,
  ACQUISITION_TODO_SUMMARY_LIMIT,
  ACQUISITION_TODO_SUMMARY_NOTE,
  ACQUISITION_TODO_SUMMARY_PER_CATEGORY,
  buildAcquisitionTodoSummary,
  type AcquisitionTodoProspectInput
} from "./acquisition-todo-summary.js";

assert.equal(ACQUISITION_TODO_SUMMARY_LIMIT, 8);
assert.equal(ACQUISITION_TODO_SUMMARY_PER_CATEGORY, 2);
assert.deepEqual([...ACQUISITION_TODO_CATEGORY_ORDER], [
  "contactable_approval",
  "draft_backlog",
  "sequence_stopped",
  "reply_pending",
  "outreach_failure",
  "inbound_sync"
]);
assert.match(ACQUISITION_TODO_SUMMARY_NOTE, /摘要聚合/);
assert.match(ACQUISITION_TODO_SUMMARY_NOTE, /不替代各类原条/);
assert.match(ACQUISITION_TODO_SUMMARY_NOTE, /文案不混用/);
assert.match(ACQUISITION_TODO_SUMMARY_NOTE, /不会推进，不会放行，不会发信，不会改授权，不会触发同步/);
assert.match(ACQUISITION_TODO_SUMMARY_NOTE, /convert_to_lead/);
assert.match(ACQUISITION_TODO_SUMMARY_NOTE, /approved_contactable/);

function prospect(partial: Partial<AcquisitionTodoProspectInput> & { id: string }): AcquisitionTodoProspectInput {
  return {
    company: partial.company || partial.id,
    shortlisted: true,
    approvalPending: false,
    approvalDetail: "",
    ...partial
  };
}

const empty = buildAcquisitionTodoSummary([], [], "");
assert.equal(empty.total, 0);
assert.equal(empty.shown, 0);
assert.deepEqual(empty.rows, []);

const ignored = buildAcquisitionTodoSummary([
  prospect({
    id: "not_shortlisted",
    shortlisted: false,
    approvalPending: true,
    approvalDetail: "还缺当前业务员的人工可联系批准",
    draft: { backlog: "pending", count: 2, subject: "草稿", batchId: "batch_x" },
    sequence: { progress: "stopped", statusLabel: "已停止", name: "方案", source: "plan", sourceId: "plan_x" },
    reply: { status: "hit", at: "2026-10-18T08:00:00.000Z", excerpt: "回了" },
    failure: { status: "hit", kind: "bounced", reason: "550", at: "2026-10-18T08:00:00.000Z" }
  }),
  prospect({
    id: "active_sequence",
    sequence: { progress: "active", statusLabel: "进行中", name: "进行中方案", source: "plan", sourceId: "plan_a" }
  }),
  prospect({
    id: "done_sequence",
    sequence: { progress: "done", statusLabel: "已完成", name: "完成方案", source: "plan", sourceId: "plan_d" }
  }),
  prospect({
    id: "approval_without_phrase",
    approvalPending: true,
    approvalDetail: "尚未进入正式企业覆盖池"
  }),
  prospect({
    id: "approval_flag_off",
    approvalPending: false,
    approvalDetail: "还缺当前业务员的人工可联系批准"
  }),
  prospect({
    id: "mixed_draft",
    draft: { backlog: "pending", count: 1, subject: "不该算", batchId: "batch_m", progress: "active", statusLabel: "进行中" }
  }),
  prospect({
    id: "engagement_as_reply",
    reply: { status: "hit", at: "2026-10-18T08:00:00.000Z", excerpt: "打开了", open: { count: 1 }, click: { count: 1 } }
  }),
  prospect({
    id: "suppressed_as_failure",
    failure: { status: "hit", kind: "suppressed", reason: "暂停外发", at: "2026-10-18T08:00:00.000Z" }
  })
], [
  { id: "user_ok", name: "正常账号", lastInboundSyncStatus: "ok", lastInboundSyncAt: "2026-10-18T08:00:00.000Z" }
], "user_ok");
assert.equal(ignored.total, 0, "未入清单、进行中、已完成、打开点击、抑制和正常收信都不进摘要");

const approval = buildAcquisitionTodoSummary([
  prospect({
    id: "p_approval",
    company: "批准公司",
    approvalPending: true,
    approvalDetail: "可联系检查已完成，还缺当前业务员的人工可联系批准"
  })
], [], "");
assert.equal(approval.rows.length, 1);
assert.equal(approval.rows[0]?.category, "contactable_approval");
assert.equal(approval.rows[0]?.categoryLabel, "可联系批准待办");
assert.equal(approval.rows[0]?.jump, "approval");
assert.equal(approval.rows[0]?.jumpLabel, "去申请可联系批准");
assert.match(approval.rows[0]?.detail || "", /人工可联系批准/);

const draft = buildAcquisitionTodoSummary([
  prospect({
    id: "p_draft",
    company: "草稿公司",
    draft: { backlog: "pending", count: 3, subject: "泰国台秤", batchId: "batch_1", updatedAt: "2026-10-18T08:00:00.000Z" }
  })
], [], "");
assert.equal(draft.rows[0]?.category, "draft_backlog");
assert.equal(draft.rows[0]?.jump, "batch");
assert.equal(draft.rows[0]?.jumpLabel, "查看发信批次");
assert.equal(draft.rows[0]?.batchId, "batch_1");
assert.match(draft.rows[0]?.detail || "", /待发 3 封/);
assert.match(draft.rows[0]?.detail || "", /泰国台秤/);

const stopped = buildAcquisitionTodoSummary([
  prospect({
    id: "p_stopped",
    company: "已停公司",
    sequence: { progress: "stopped", statusLabel: "已暂停", name: "三封方案", source: "batch", sourceId: "batch_9", updatedAt: "2026-10-18T08:00:00.000Z" }
  })
], [], "");
assert.equal(stopped.rows[0]?.category, "sequence_stopped");
assert.equal(stopped.rows[0]?.jump, "prospect");
assert.equal(stopped.rows[0]?.jumpLabel, "候选详情");
assert.equal(stopped.rows[0]?.batchId, "");
assert.match(stopped.rows[0]?.detail || "", /三封方案/);
assert.match(stopped.rows[0]?.detail || "", /已暂停/);

const reply = buildAcquisitionTodoSummary([
  prospect({
    id: "p_reply",
    company: "回复公司",
    reply: { status: "hit", at: "2026-10-18T08:00:00.000Z", excerpt: "请发报价" },
    replyWhen: "10-18 16:00"
  })
], [], "");
assert.equal(reply.rows[0]?.category, "reply_pending");
assert.equal(reply.rows[0]?.categoryLabel, "有回复待看");
assert.equal(reply.rows[0]?.jump, "prospect");
assert.match(reply.rows[0]?.detail || "", /请发报价/);
assert.match(reply.rows[0]?.detail || "", /10-18 16:00/);
assert.doesNotMatch(reply.rows[0]?.detail || "", /未读/);

const failure = buildAcquisitionTodoSummary([
  prospect({
    id: "p_failure",
    company: "退信公司",
    failure: { status: "hit", kind: "bounced", reason: "550 user unknown", at: "2026-10-03T08:00:00.000Z" },
    failureWhen: "10-03 16:00"
  })
], [], "");
assert.equal(failure.rows[0]?.category, "outreach_failure");
assert.equal(failure.rows[0]?.jump, "prospect");
assert.match(failure.rows[0]?.detail || "", /开发信退信/);
assert.match(failure.rows[0]?.detail || "", /550 user unknown/);

const inbound = buildAcquisitionTodoSummary([], [
  { id: "user_other", name: "别的账号", lastInboundSyncStatus: "error", lastInboundSyncError: "认证失败", lastInboundSyncAt: "2026-10-19T08:00:00.000Z" },
  { id: "user_me", name: "我的账号", lastInboundSyncStatus: "error", lastInboundSyncError: "连接超时", lastInboundSyncAt: "2026-10-18T08:00:00.000Z" },
  { id: "user_ok", name: "正常账号", lastInboundSyncStatus: "ok" }
], "user_me");
assert.equal(inbound.total, 2);
assert.equal(inbound.rows[0]?.accountId, "user_me");
assert.equal(inbound.rows[0]?.jump, "inbound_settings");
assert.equal(inbound.rows[0]?.jumpLabel, "收信设置");
assert.match(inbound.rows[0]?.detail || "", /连接超时/);
assert.equal(inbound.rows[1]?.accountId, "user_other");
assert.equal(inbound.rows[1]?.jump, "none");
assert.equal(inbound.rows[1]?.jumpLabel, "收信，不是发件");
assert.equal(inbound.rows.some((row) => row.accountId === "user_ok"), false);

const both = buildAcquisitionTodoSummary([
  prospect({
    id: "p_both",
    company: "同时有",
    reply: { status: "hit", at: "2026-10-18T08:00:00.000Z", excerpt: "有兴趣" },
    failure: { status: "hit", kind: "send_failed", reason: "smtp down", at: "2026-10-17T08:00:00.000Z" }
  })
], [], "");
assert.deepEqual(both.rows.map((row) => row.category), ["reply_pending", "outreach_failure"]);
assert.notEqual(both.rows[0]?.detail, both.rows[1]?.detail);

const drafts = buildAcquisitionTodoSummary([
  prospect({ id: "d1", draft: { backlog: "pending", count: 1, subject: "少", batchId: "b1", updatedAt: "2026-10-18T08:00:00.000Z" } }),
  prospect({ id: "d9", draft: { backlog: "pending", count: 9, subject: "多", batchId: "b9", updatedAt: "2026-10-01T08:00:00.000Z" } }),
  prospect({ id: "d3", draft: { backlog: "pending", count: 3, subject: "中", batchId: "b3", updatedAt: "2026-10-20T08:00:00.000Z" } })
], [], "");
assert.deepEqual(drafts.rows.map((row) => row.prospectId), ["d9", "d3"]);
assert.equal(drafts.total, 3);
assert.equal(drafts.shown, 2);

const replies = buildAcquisitionTodoSummary([
  prospect({ id: "old", reply: { status: "hit", at: "2026-10-01T08:00:00.000Z", excerpt: "旧" } }),
  prospect({ id: "mid", reply: { status: "hit", at: "2026-10-10T08:00:00.000Z", excerpt: "中" } }),
  prospect({ id: "new", reply: { status: "hit", at: "2026-10-20T08:00:00.000Z", excerpt: "新" } })
], [], "");
assert.deepEqual(replies.rows.map((row) => row.prospectId), ["new", "mid"]);

function fill(prefix: string, count: number, field: Partial<AcquisitionTodoProspectInput>) {
  return Array.from({ length: count }, (_, index) => prospect({
    id: `${prefix}_${index}`,
    company: `${prefix}${index}`,
    ...field
  }));
}

const capped = buildAcquisitionTodoSummary([
  ...fill("ap", 3, { approvalPending: true, approvalDetail: "还缺当前业务员的人工可联系批准" }),
  ...fill("dr", 3, { draft: { backlog: "pending", count: 1, subject: "草稿", batchId: "batch_cap", updatedAt: "2026-10-18T08:00:00.000Z" } }),
  ...fill("sq", 3, { sequence: { progress: "stopped", statusLabel: "已停止", name: "方案", source: "plan", sourceId: "plan_cap" } }),
  ...fill("rp", 3, { reply: { status: "hit", at: "2026-10-18T08:00:00.000Z", excerpt: "回了" } }),
  ...fill("fl", 3, { failure: { status: "hit", kind: "send_failed", reason: "失败", at: "2026-10-18T08:00:00.000Z" } })
], [
  { id: "sync_1", name: "甲", lastInboundSyncStatus: "error", lastInboundSyncError: "一" },
  { id: "sync_2", name: "乙", lastInboundSyncStatus: "error", lastInboundSyncError: "二" }
], "sync_1");
assert.equal(capped.total, 17);
assert.equal(capped.shown, 8);
assert.equal(capped.rows.length, 8);
assert.deepEqual(capped.rows.map((row) => row.category), [
  "contactable_approval",
  "contactable_approval",
  "draft_backlog",
  "draft_backlog",
  "sequence_stopped",
  "sequence_stopped",
  "reply_pending",
  "reply_pending"
]);
assert.equal(capped.rows.some((row) => row.category === "outreach_failure" || row.category === "inbound_sync"), false);

const later = buildAcquisitionTodoSummary(
  fill("fl", 3, { failure: { status: "hit", kind: "bounced", reason: "退信", at: "2026-10-18T08:00:00.000Z" } }),
  [{ id: "sync_me", name: "我", lastInboundSyncStatus: "error", lastInboundSyncError: "超时" }],
  "sync_me"
);
assert.deepEqual(later.rows.map((row) => row.category), ["outreach_failure", "outreach_failure", "inbound_sync"]);
assert.equal(later.total, 4);
assert.equal(later.shown, 3);

const blankName = buildAcquisitionTodoSummary([
  prospect({ id: "blank", company: "  ", approvalPending: true, approvalDetail: "还缺当前业务员的人工可联系批准" })
], [], "");
assert.equal(blankName.rows[0]?.title, "名称不展示");

console.log("acquisition-todo-summary-test: ok");
