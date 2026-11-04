/**
 * 同一对象今日不再拨。号码旁提交一次，工作台只在点查看后列出今天已经记下的对象。
 * 这里不发起外呼。
 */

export interface SameDayCallSkipItem {
  targetType: "customer" | "lead" | "prospect";
  targetId: string;
  targetLabel?: string;
  name?: string;
  reason?: string;
  reasonLabel?: string;
  note?: string;
  skipOn?: string;
  actorLabel?: string;
  updatedAt?: string;
}

export interface SameDayCallSkipResponse {
  scope?: "mine" | "team";
  empty?: boolean;
  items?: SameDayCallSkipItem[];
}

const REASONS: Array<{ value: string; label: string }> = [
  { value: "reached", label: "今天已经联系上" },
  { value: "asked_later", label: "对方要求改日再打" },
  { value: "wrong_time", label: "现在不方便" },
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

function whenText(value: string | undefined) {
  const text = (value || "").trim();
  if (!text) return "—";
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("zh-CN", { hour12: false });
}

export function sameDayCallSkipQuery(input: { scope: "mine" | "team" }) {
  return `?scope=${encodeURIComponent(input.scope)}`;
}

export function renderSameDayCallSkipControl(targetType: string, targetId: string) {
  const options = REASONS.map((item) => `<option value="${item.value}">${item.label}</option>`).join("");
  return `<form data-same-day-call-skip="1" data-target-type="${escapeHtml(targetType)}" data-target-id="${escapeHtml(targetId)}"><label>今日不再拨<select data-same-day-skip-reason="1">${options}</select></label><input data-same-day-skip-note="1" maxlength="200" placeholder="备注，可以不填"><button class="btn" type="submit" data-same-day-skip-set="1">今日不再拨</button></form>`;
}

export function renderSameDayCallSkipEmpty() {
  return `<p data-same-day-call-skip-empty="1">这个范围内今天没有不再拨的对象。</p>`;
}

export function renderSameDayCallSkipFailure(message: string) {
  const text = message.trim() || "今日不再拨没有加载";
  return `<p data-same-day-call-skip-error="1">${escapeHtml(text)}</p>`;
}

export function renderSameDayCallSkips(data: SameDayCallSkipResponse | undefined) {
  const rows = data?.items || [];
  if (!rows.length) return renderSameDayCallSkipEmpty();
  const scope = data?.scope === "team" ? "团队" : "我的";
  const body = rows.map((item) => {
    const note = (item.note || "").trim();
    return `<li data-same-day-call-skip-row="1" data-target-type="${escapeHtml(item.targetType)}" data-target-id="${escapeHtml(item.targetId)}"><button type="button" class="btn" data-same-day-call-skip-open="1">${escapeHtml(item.name || item.targetId)}</button><span>${escapeHtml(item.targetLabel || item.targetType)}</span><span data-same-day-call-skip-reason="1">${escapeHtml(textOrDash(item.reasonLabel))}</span><span data-same-day-call-skip-note="1">${escapeHtml(textOrDash(note))}</span><time data-same-day-call-skip-at="1">${escapeHtml(whenText(item.updatedAt))}</time><span data-same-day-call-skip-actor="1">${escapeHtml(textOrDash(item.actorLabel))}</span><button type="button" class="btn" data-same-day-call-skip-clear="1" data-target-type="${escapeHtml(item.targetType)}" data-target-id="${escapeHtml(item.targetId)}">撤销</button></li>`;
  }).join("");
  return `<div data-same-day-call-skip-list="1"><p data-same-day-call-skip-scope="${escapeHtml(data?.scope || "mine")}">${escapeHtml(scope)}</p><ul>${body}</ul></div>`;
}
