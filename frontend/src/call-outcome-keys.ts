/**
 * 单条通话结果面板上的键盘操作。
 * 只决定选哪一项、插入哪一句已经显示的常用短语，或提交当前表单。
 * 不请求下一位，不读也不写 today_follow_advance_audits，不拨号。
 */

export const CALL_OUTCOME_SHORTCUTS = ["有意向", "需回访", "无意向", "号码错误", "其他"] as const;

export const CALL_OUTCOME_PHRASE_SHORTCUT_MAX = 9;

export interface CallOutcomeShortcutInput {
  key: string;
  code?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  repeat?: boolean;
  insideForm: boolean;
  typing: boolean;
  activateOnEnter: boolean;
}

export type CallOutcomeShortcutPlan =
  | { action: "none" }
  | { action: "select"; outcome: (typeof CALL_OUTCOME_SHORTCUTS)[number] }
  | { action: "insert-phrase"; index: number }
  | { action: "save" };

export function renderCallOutcomeKeyHint() {
  const labels = CALL_OUTCOME_SHORTCUTS.map((item, index) => `${index + 1} ${item}`).join("，");
  return `<p tabindex="0" data-call-outcome-key-hint="1">${labels}。已加载的常用短语按 Alt+1 起插入。回车保存。备注、短语输入和结果下拉聚焦时不拦截。</p>`;
}

function digitFrom(input: { key: string; code?: string }) {
  const code = input.code || "";
  const fromCode = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (fromCode) return Number(fromCode[1]);
  if (/^[0-9]$/.test(input.key)) return Number(input.key);
  return null;
}

export function planCallOutcomeShortcut(input: CallOutcomeShortcutInput): CallOutcomeShortcutPlan {
  if (!input.insideForm || input.typing || input.isComposing || input.repeat) return { action: "none" };
  if (input.ctrlKey || input.metaKey || input.shiftKey) return { action: "none" };
  if (input.key === "Enter") {
    if (input.altKey || !input.activateOnEnter) return { action: "none" };
    return { action: "save" };
  }
  const digit = digitFrom(input);
  if (digit === null) return { action: "none" };
  if (input.altKey) {
    if (digit < 1 || digit > CALL_OUTCOME_PHRASE_SHORTCUT_MAX) return { action: "none" };
    return { action: "insert-phrase", index: digit - 1 };
  }
  if (digit < 1 || digit > CALL_OUTCOME_SHORTCUTS.length) return { action: "none" };
  return { action: "select", outcome: CALL_OUTCOME_SHORTCUTS[digit - 1]! };
}
