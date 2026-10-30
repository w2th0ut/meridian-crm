/**
 * 开发信失败 / 退信的只读展示。
 * 只消费清单接口带回的最近一次发送失败或退信，不另写匹配，也不把抑制条说成失败。
 */

export type OutreachFailureKind = "none" | "send_failed" | "bounced";

export type OutreachFailureListFilter = "all" | "hit" | "clear";

export interface OutreachFailureView {
  status: "none" | "hit";
  kind: OutreachFailureKind;
  label: "无失败记录" | "发送失败" | "开发信退信";
  reason: string;
  at: string;
}

const SEND_REASON_MISSING = "发送失败说明未写入";
const BOUNCE_REASON_MISSING = "退信说明未写入";

const LABELS = {
  none: "无失败记录",
  send_failed: "发送失败",
  bounced: "开发信退信"
} as const;

export function emptyOutreachFailure(): OutreachFailureView {
  return {
    status: "none",
    kind: "none",
    label: "无失败记录",
    reason: "",
    at: ""
  };
}

function text(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** 只接受接口带回的发送失败或退信。别的状态，包括抑制，都当成没有失败记录。 */
export function presentOutreachFailure(raw: unknown): OutreachFailureView {
  if (!raw || typeof raw !== "object") return emptyOutreachFailure();
  const record = raw as Record<string, unknown>;
  if (record.status !== "hit") return emptyOutreachFailure();
  const kind = record.kind;
  if (kind !== "send_failed" && kind !== "bounced") return emptyOutreachFailure();
  const at = text(record.at);
  const fallback = kind === "bounced" ? BOUNCE_REASON_MISSING : SEND_REASON_MISSING;
  return {
    status: "hit",
    kind,
    label: LABELS[kind],
    reason: text(record.reason).slice(0, 160) || fallback,
    at: at && !Number.isNaN(Date.parse(at)) ? at : ""
  };
}

export function outreachFailureMatchesFilter(
  view: OutreachFailureView,
  filter: OutreachFailureListFilter
) {
  if (filter === "hit") return view.status === "hit";
  if (filter === "clear") return view.status === "none";
  return true;
}

export function outreachFailureRewriteLabel(view: OutreachFailureView, canRewrite: boolean) {
  if (view.status !== "hit" || !canRewrite) return "";
  return "去重写开发信草稿";
}

export function outreachFailureSummary(
  view: OutreachFailureView,
  formattedAt = "",
  canRewrite = false
) {
  if (view.status === "none") {
    return "无失败记录。这里只看开发信发送失败和退信，不是抑制或退订，也不会自动重发。";
  }
  const when = formattedAt ? `时间 ${formattedAt}。` : "";
  const rewrite = canRewrite
    ? "可以打开现有开发信草稿重写。"
    : "当前不能从这里重写草稿。";
  return `${view.label}：${view.reason}。${when}${rewrite}不会自动重发，也不会解除抑制。`;
}
