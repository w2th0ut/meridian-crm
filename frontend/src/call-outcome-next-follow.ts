/**
 * 单条通话结果表单上的下次跟进快选。
 * 无意向和号码错误默认不设。改结果时回到这一默认。
 * 未接通时多出 2 小时后和 4 小时后。已接通不出现。不请求下一位，不拨号。
 */

export const CALL_OUTCOME_NEXT_FOLLOW_CHOICES = [
  { value: "tomorrow", label: "明天" },
  { value: "plus3", label: "3 天后" },
  { value: "plus7", label: "1 周后" },
  { value: "none", label: "不设" }
] as const;

export type CallOutcomeNextFollowChoice = (typeof CALL_OUTCOME_NEXT_FOLLOW_CHOICES)[number]["value"];

export function defaultCallOutcomeNextFollow(outcome: string): CallOutcomeNextFollowChoice {
  const text = outcome.trim();
  return text === "无意向" || text === "号码错误" ? "none" : "tomorrow";
}

const SAME_DAY_FOLLOW_CHOICES = [
  { value: "plus2h", label: "2 小时后" },
  { value: "plus4h", label: "4 小时后" }
] as const;

export function renderCallOutcomeNextFollow(outcome: string, unanswered = false) {
  const selected = defaultCallOutcomeNextFollow(outcome);
  const choices = unanswered
    ? [...SAME_DAY_FOLLOW_CHOICES, ...CALL_OUTCOME_NEXT_FOLLOW_CHOICES]
    : CALL_OUTCOME_NEXT_FOLLOW_CHOICES;
  const options = choices.map((item) => {
    const picked = item.value === selected ? " selected" : "";
    return `<option value="${item.value}"${picked}>${item.label}</option>`;
  }).join("");
  const note = unanswered
    ? "2 小时后、4 小时后从现在算起，落在允许拨打时段外就顶到下一个允许时段的开始。明天、3 天后、1 周后仍按租户当地日，时刻是允许拨打的开始。无意向和号码错误默认不设。不设不改已有下次跟进。暂停外呼仍优先，也不拨号。"
    : "明天、3 天后、1 周后按租户当地日，时刻是允许拨打的开始。无意向和号码错误默认不设。不设不改已有下次跟进，也不拨号。";
  return `<label>下次跟进<select data-call-outcome-next-follow>${options}</select></label><p data-call-outcome-next-follow-note="1">${note}</p>`;
}

export function syncCallOutcomeNextFollow(form: ParentNode) {
  const outcome = form.querySelector("[data-call-outcome]");
  const follow = form.querySelector("[data-call-outcome-next-follow]");
  if (!(outcome instanceof HTMLSelectElement) || !(follow instanceof HTMLSelectElement)) return;
  follow.value = defaultCallOutcomeNextFollow(outcome.value);
}

export function bindCallOutcomeNextFollowDefaults(root: EventTarget & ParentNode) {
  root.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.matches("[data-call-outcome]")) return;
    const form = target.closest("[data-call-outcome-form]");
    if (form) syncCallOutcomeNextFollow(form);
  });
}
