/** 工作台缺下次跟进的名单上，勾选后一次设置同一个时间和备注。这里不发起外呼。 */

export const MISSING_NEXT_FOLLOWUP_NOTE_MAX = 200;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function missingNextFollowupBatchForm() {
  return `<form data-missing-next-followup-batch="1"><label><input type="checkbox" data-missing-next-followup-all="1">全选这一页</label><label>下次跟进<input type="datetime-local" data-missing-next-follow-at></label><label>备注<input data-missing-next-follow-note maxlength="${MISSING_NEXT_FOLLOWUP_NOTE_MAX}"></label><button class="btn" type="submit" data-missing-next-followup-submit="1">批量设置下次跟进</button><p data-missing-next-followup-hint="1">勾选后一次写下同一个时间和同一条备注。不会拨出。</p></form>`;
}

export function missingNextFollowupPick(targetType: string, targetId: string) {
  const value = `${targetType}:${targetId}`;
  return `<label><input type="checkbox" data-missing-next-followup-pick="1" value="${escapeHtml(value)}">选择</label>`;
}

export function missingNextFollowupBatchBody(input: { targets: Array<{ targetType: string; targetId: string }>; nextFollowAt: string; note?: string }) {
  const note = (input.note || "").trim();
  const body: { targets: Array<{ targetType: string; targetId: string }>; nextFollowAt: string; note?: string } = {
    targets: input.targets,
    nextFollowAt: input.nextFollowAt
  };
  if (note) body.note = note;
  return body;
}
