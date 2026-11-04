/**
 * 暂停外呼直到指定日。号码旁提交一次，工作台只在点查看后列出还没到恢复日的对象。
 * 这里不发起外呼。
 */

export interface OutboundCallHoldItem {
  targetType: "customer" | "lead" | "prospect";
  targetId: string;
  targetLabel?: string;
  name?: string;
  reason?: string;
  reasonLabel?: string;
  note?: string;
  untilOn?: string;
  actorLabel?: string;
  updatedAt?: string;
}

export interface OutboundCallHoldResponse {
  scope?: "mine" | "team";
  empty?: boolean;
  items?: OutboundCallHoldItem[];
}

const REASONS: Array<{ value: string; label: string }> = [
  { value: "asked_later", label: "约了以后再联系" },
  { value: "other_channel", label: "先走别的渠道" },
  { value: "colleague", label: "同事正在跟" },
  { value: "other", label: "其他" }
];

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textOrDash(value: string | undefined) {
  const text = (value || "").trim();
  return text || "—";
}

function untilText(value: string | undefined) {
  const text = (value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "—";
}

function whenText(value: string | undefined) {
  const text = (value || "").trim();
  if (!text) return "—";
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

export function outboundCallHoldQuery(input: { scope: "mine" | "team" }) {
  return `?scope=${encodeURIComponent(input.scope)}`;
}

export function renderOutboundCallHoldControl(targetType: string, targetId: string) {
  const options = REASONS.map((item) => `<option value="${item.value}">${item.label}</option>`).join("");
  return `<form data-call-hold="1" data-target-type="${escapeHtml(targetType)}" data-target-id="${escapeHtml(targetId)}"><label>暂停到<input data-call-hold-until="1" type="date"></label><label>原因<select data-call-hold-reason="1">${options}</select></label><input data-call-hold-note="1" maxlength="200" placeholder="备注，可以不填"><button class="btn" type="submit" data-call-hold-set="1">记下暂停</button></form>`;
}

export function renderOutboundCallHoldEmpty() {
  return `<p data-call-hold-empty="1">这个范围内没有还在生效的暂停外呼。</p>`;
}

export function renderOutboundCallHoldFailure(message: string) {
  const text = message.trim() || "暂停外呼没有加载";
  return `<p data-call-hold-error="1">${escapeHtml(text)}</p>`;
}

export function renderOutboundCallHolds(data: OutboundCallHoldResponse | undefined) {
  const rows = data?.items || [];
  if (!rows.length) return renderOutboundCallHoldEmpty();
  const scope = data?.scope === "team" ? "团队" : "我的";
  const body = rows.map((item) => {
    const note = (item.note || "").trim();
    return `<li data-call-hold-row="1" data-target-type="${escapeHtml(item.targetType)}" data-target-id="${escapeHtml(item.targetId)}"><button type="button" class="btn" data-call-hold-open="1">${escapeHtml(item.name || item.targetId)}</button><span>${escapeHtml(item.targetLabel || item.targetType)}</span><span data-call-hold-until="1">${escapeHtml(untilText(item.untilOn))}</span><span data-call-hold-reason="1">${escapeHtml(textOrDash(item.reasonLabel))}</span><span data-call-hold-note="1">${escapeHtml(textOrDash(note))}</span><time data-call-hold-at="1">${escapeHtml(whenText(item.updatedAt))}</time><span data-call-hold-actor="1">${escapeHtml(textOrDash(item.actorLabel))}</span><button type="button" class="btn" data-call-hold-clear="1" data-target-type="${escapeHtml(item.targetType)}" data-target-id="${escapeHtml(item.targetId)}">撤销</button></li>`;
  }).join("");
  return `<div data-call-hold-list="1"><p data-call-hold-scope="${escapeHtml(data?.scope || "mine")}">${escapeHtml(scope)}</p><ul>${body}</ul></div>`;
}
