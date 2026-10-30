/**
 * 工作台获客待办摘要。只聚合已经投影好的信号，不新建待办，也不新造未读或健康检查。
 * 没有的类别不出行。每类最多几条，合计不超过上限。文案按类别分开，不替代各类原条。
 */

import {
  inboundSyncLineLabel,
  listInboundSyncRows,
  presentInboundSyncStatus
} from "./inbound-sync-status.js";
import {
  outreachDraftBacklogCount,
  outreachDraftBacklogLineLabel,
  outreachDraftBacklogUpdatedAt,
  presentOutreachDraftBacklog
} from "./prospect-outreach-draft-backlog.js";
import { presentOutreachFailure } from "./prospect-outreach-failure.js";
import {
  outreachReplyLatestAt,
  outreachReplyLineLabel,
  presentOutreachReply
} from "./prospect-outreach-reply.js";
import {
  outreachSequenceLineLabel,
  outreachSequenceUpdatedAt,
  presentOutreachSequence
} from "./prospect-outreach-sequence.js";

export const ACQUISITION_TODO_SUMMARY_LIMIT = 8;
export const ACQUISITION_TODO_SUMMARY_PER_CATEGORY = 2;

export const ACQUISITION_TODO_SUMMARY_NOTE = "这是已上线信号的摘要聚合，不替代各类原条。原条仍各自保留，可以同时看到，文案不混用。点一行只打开现有入口。不会推进，不会放行，不会发信，不会改授权，不会触发同步，也不会改 convert_to_lead 或 approved_contactable。";

const APPROVAL_MARK = "人工可联系批准";

export const ACQUISITION_TODO_CATEGORY_ORDER = [
  "contactable_approval",
  "draft_backlog",
  "sequence_stopped",
  "reply_pending",
  "outreach_failure",
  "inbound_sync"
] as const;

export type AcquisitionTodoCategory = typeof ACQUISITION_TODO_CATEGORY_ORDER[number];

export type AcquisitionTodoJump =
  | "approval"
  | "batch"
  | "prospect"
  | "inbound_settings"
  | "none";

export interface AcquisitionTodoProspectInput {
  id: string;
  company: string;
  shortlisted: boolean;
  approvalPending: boolean;
  approvalDetail: string;
  replyWhen?: string;
  failureWhen?: string;
  draft?: unknown;
  sequence?: unknown;
  reply?: unknown;
  failure?: unknown;
}

export interface AcquisitionTodoSummaryRow {
  category: AcquisitionTodoCategory;
  categoryLabel: string;
  title: string;
  detail: string;
  jump: AcquisitionTodoJump;
  jumpLabel: string;
  prospectId: string;
  accountId: string;
  batchId: string;
}

export interface AcquisitionTodoSummaryResult {
  rows: AcquisitionTodoSummaryRow[];
  total: number;
  shown: number;
}

const CATEGORY_LABEL: Record<AcquisitionTodoCategory, string> = {
  contactable_approval: "可联系批准待办",
  draft_backlog: "待发草稿积压",
  sequence_stopped: "外联序列已停",
  reply_pending: "有回复待看",
  outreach_failure: "开发信失败/退信",
  inbound_sync: "收信同步异常"
};

function text(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function clip(value: string, max = 160) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function titleOf(company: string) {
  return text(company) || "名称不展示";
}

function blankRow(category: AcquisitionTodoCategory): AcquisitionTodoSummaryRow {
  return {
    category,
    categoryLabel: CATEGORY_LABEL[category],
    title: "",
    detail: "",
    jump: "none",
    jumpLabel: "",
    prospectId: "",
    accountId: "",
    batchId: ""
  };
}

function uniqueProspects(prospects: AcquisitionTodoProspectInput[]) {
  const seen = new Set<string>();
  const unique: AcquisitionTodoProspectInput[] = [];
  for (const item of prospects) {
    if (!item || typeof item !== "object") continue;
    const id = text(item.id);
    if (!id || seen.has(id) || item.shortlisted !== true) continue;
    seen.add(id);
    unique.push(item);
  }
  return unique;
}

/** 只消费调用方已经判定的可联系批准缺项，和各类 present* 投影。 */
export function buildAcquisitionTodoSummary(
  prospects: AcquisitionTodoProspectInput[],
  accounts: unknown[],
  currentAccountId = ""
): AcquisitionTodoSummaryResult {
  const buckets: Record<AcquisitionTodoCategory, AcquisitionTodoSummaryRow[]> = {
    contactable_approval: [],
    draft_backlog: [],
    sequence_stopped: [],
    reply_pending: [],
    outreach_failure: [],
    inbound_sync: []
  };

  const draftRank = new Map<string, { count: number; updatedAt: number }>();
  const stampRank = new Map<string, number>();

  for (const item of uniqueProspects(prospects)) {
    const id = text(item.id);
    const title = titleOf(item.company);
    if (item.approvalPending === true && text(item.approvalDetail).includes(APPROVAL_MARK)) {
      buckets.contactable_approval.push({
        ...blankRow("contactable_approval"),
        title,
        detail: clip(text(item.approvalDetail)),
        jump: "approval",
        jumpLabel: "去申请可联系批准",
        prospectId: id
      });
    }

    const draft = presentOutreachDraftBacklog(item.draft);
    if (draft.backlog === "pending" && draft.batchId) {
      draftRank.set(id, {
        count: outreachDraftBacklogCount(draft),
        updatedAt: outreachDraftBacklogUpdatedAt(draft)
      });
      buckets.draft_backlog.push({
        ...blankRow("draft_backlog"),
        title,
        detail: outreachDraftBacklogLineLabel(draft),
        jump: "batch",
        jumpLabel: "查看发信批次",
        prospectId: id,
        batchId: draft.batchId
      });
    }

    const sequence = presentOutreachSequence(item.sequence);
    if (sequence.progress === "stopped") {
      stampRank.set(`sequence_stopped:${id}`, outreachSequenceUpdatedAt(sequence));
      buckets.sequence_stopped.push({
        ...blankRow("sequence_stopped"),
        title,
        detail: outreachSequenceLineLabel(sequence),
        jump: "prospect",
        jumpLabel: "候选详情",
        prospectId: id
      });
    }

    const reply = presentOutreachReply(item.reply);
    if (reply.status === "hit") {
      stampRank.set(`reply_pending:${id}`, outreachReplyLatestAt(reply));
      buckets.reply_pending.push({
        ...blankRow("reply_pending"),
        title,
        detail: outreachReplyLineLabel(reply, text(item.replyWhen)),
        jump: "prospect",
        jumpLabel: "候选详情",
        prospectId: id
      });
    }

    const failure = presentOutreachFailure(item.failure);
    if (failure.status === "hit") {
      const when = text(item.failureWhen);
      const parsed = Date.parse(failure.at);
      stampRank.set(`outreach_failure:${id}`, Number.isFinite(parsed) ? parsed : 0);
      buckets.outreach_failure.push({
        ...blankRow("outreach_failure"),
        title,
        detail: when ? `${failure.label} · ${failure.reason} · ${when}` : `${failure.label} · ${failure.reason}`,
        jump: "prospect",
        jumpLabel: "候选详情",
        prospectId: id
      });
    }
  }

  const sortByStamp = (category: AcquisitionTodoCategory, rows: AcquisitionTodoSummaryRow[]) => {
    rows.sort((left, right) => {
      const stamp = (stampRank.get(`${category}:${right.prospectId}`) || 0) - (stampRank.get(`${category}:${left.prospectId}`) || 0);
      return stamp || compareText(left.prospectId, right.prospectId);
    });
  };
  buckets.contactable_approval.sort((left, right) => compareText(left.title, right.title) || compareText(left.prospectId, right.prospectId));
  buckets.draft_backlog.sort((left, right) => {
    const leftRank = draftRank.get(left.prospectId);
    const rightRank = draftRank.get(right.prospectId);
    const count = (rightRank?.count || 0) - (leftRank?.count || 0);
    if (count) return count;
    const stamp = (rightRank?.updatedAt || 0) - (leftRank?.updatedAt || 0);
    return stamp || compareText(left.prospectId, right.prospectId);
  });
  sortByStamp("sequence_stopped", buckets.sequence_stopped);
  sortByStamp("reply_pending", buckets.reply_pending);
  sortByStamp("outreach_failure", buckets.outreach_failure);

  const currentId = text(currentAccountId);
  const inbound = listInboundSyncRows(
    (Array.isArray(accounts) ? accounts : []).map((account) => presentInboundSyncStatus(account)),
    "error",
    Math.max(Array.isArray(accounts) ? accounts.length : 0, 1),
    currentId
  );
  for (const view of inbound.shown) {
    if (view.condition !== "error" || !view.accountId) continue;
    const current = Boolean(currentId) && view.accountId === currentId;
    buckets.inbound_sync.push({
      ...blankRow("inbound_sync"),
      title: text(view.accountName) || "当前账号",
      detail: inboundSyncLineLabel(view),
      jump: current ? "inbound_settings" : "none",
      jumpLabel: current ? "收信设置" : "收信，不是发件",
      accountId: view.accountId
    });
  }

  const rows: AcquisitionTodoSummaryRow[] = [];
  let total = 0;
  let budget = ACQUISITION_TODO_SUMMARY_LIMIT;
  for (const category of ACQUISITION_TODO_CATEGORY_ORDER) {
    const bucket = buckets[category];
    total += bucket.length;
    if (budget <= 0 || !bucket.length) continue;
    const take = bucket.slice(0, Math.min(ACQUISITION_TODO_SUMMARY_PER_CATEGORY, budget));
    rows.push(...take);
    budget -= take.length;
  }
  return { rows, total, shown: rows.length };
}
