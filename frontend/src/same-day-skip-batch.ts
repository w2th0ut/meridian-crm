/** 工作台待跟进、未接通和今日待跟进名单上，勾选后一次记下今日不再拨。这里不发起外呼。 */

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

export function sameDaySkipBatchPick(targetType: string, targetId: string, canSkip: boolean) {
  if (!canSkip || !targetId) return "";
  if (targetType !== "customer" && targetType !== "lead" && targetType !== "prospect") return "";
  const value = `${targetType}:${targetId}`;
  return `<label><input type="checkbox" data-same-day-skip-batch-pick="1" value="${escapeHtml(value)}">今日不再拨</label>`;
}

export function sameDaySkipBatchForm(canSkip: boolean) {
  if (!canSkip) return "";
  const options = REASONS.map((item) => `<option value="${item.value}">${item.label}</option>`).join("");
  return `<form data-same-day-skip-batch="1"><label><input type="checkbox" data-same-day-skip-batch-all="1">全选这一页</label><label>原因<select data-same-day-skip-batch-reason="1"><option value="">请选择原因</option>${options}</select></label><label>恢复日<input type="date" data-same-day-skip-batch-resume="1"></label><input data-same-day-skip-batch-note="1" maxlength="200" placeholder="备注，可以不填"><button class="btn" type="submit" data-same-day-skip-batch-submit="1">今日不再拨</button><p data-same-day-skip-batch-hint="1">勾选最多 100 个，一次记下今日不再拨。恢复日可以不填。不会拨出。</p></form>`;
}

export function sameDaySkipBatchFormFor(
  rows: Array<{ targetType?: string; targetId?: string }> | undefined,
  canSkip: boolean
) {
  if (!canSkip) return "";
  const visible = (rows || []).some((row) => sameDaySkipBatchPick(row.targetType || "", row.targetId || "", true));
  if (!visible) return "";
  return sameDaySkipBatchForm(true);
}

export function sameDaySkipBatchBody(input: {
  targets: Array<{ targetType: string; targetId: string }>;
  reason: string;
  note?: string;
  resumeOn?: string;
}) {
  const note = (input.note || "").trim();
  const resumeOn = (input.resumeOn || "").trim();
  const body: {
    targets: Array<{ targetType: string; targetId: string }>;
    reason: string;
    note?: string;
    resumeOn?: string;
  } = {
    targets: input.targets,
    reason: input.reason.trim()
  };
  if (note) body.note = note;
  if (resumeOn) body.resumeOn = resumeOn;
  return body;
}
