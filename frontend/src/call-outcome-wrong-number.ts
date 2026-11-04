/**
 * 单条通话结果表单上的「同时把这个号码标为无效」。
 * 只有号码错误时出现，默认勾选。改到别的结果就藏起来并取消勾选。
 * 再改回号码错误时重新勾上。不请求下一位，不拨号。
 */

export function callOutcomeMarkInvalidVisible(outcome: string) {
  return outcome.trim() === "号码错误";
}

export function renderCallOutcomeMarkInvalid(outcome: string) {
  const visible = callOutcomeMarkInvalidVisible(outcome);
  const hidden = visible ? "" : " hidden";
  const checked = visible ? " checked" : "";
  return `<div data-call-outcome-mark-invalid-wrap="1"${hidden}><label><input type="checkbox" data-call-outcome-mark-invalid="1"${checked}>同时把这个号码标为无效</label><p data-call-outcome-mark-invalid-note="1">保存时把这一通对上的号码标为无效。若首选正是它，并且还有别的有效号码，首选改到那一个。不会拨出。</p></div>`;
}

export function syncCallOutcomeMarkInvalid(form: ParentNode) {
  const outcome = form.querySelector("[data-call-outcome]");
  const wrap = form.querySelector("[data-call-outcome-mark-invalid-wrap]");
  const box = form.querySelector("[data-call-outcome-mark-invalid]");
  if (!(outcome instanceof HTMLSelectElement) || !(wrap instanceof HTMLElement) || !(box instanceof HTMLInputElement)) return;
  const visible = callOutcomeMarkInvalidVisible(outcome.value);
  wrap.hidden = !visible;
  box.checked = visible;
}

export function bindCallOutcomeMarkInvalid(root: EventTarget & ParentNode) {
  root.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.matches("[data-call-outcome]")) return;
    const form = target.closest("[data-call-outcome-form]");
    if (form) syncCallOutcomeMarkInvalid(form);
  });
}
