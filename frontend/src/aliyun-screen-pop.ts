export interface ScreenPopMatchView {
  targetType: "customer" | "lead" | "prospect";
  targetId: string;
  title: string;
  view: "customers" | "leads" | "lead-finder";
}

export interface ScreenPopCardView {
  id?: string;
  maskedNumber?: string;
  unknown?: boolean;
  label?: string;
  matches?: ScreenPopMatchView[];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function screenPopHeading(card: ScreenPopCardView) {
  if (!card.matches?.length || card.unknown) return "未知来电";
  return card.label || "来电";
}

/** 只生成跳转。没有新建、保存或外呼按钮。 */
export function renderScreenPopCard(card: ScreenPopCardView) {
  const heading = screenPopHeading(card);
  const masked = escapeHtml(card.maskedNumber || "");
  const links = (card.matches || []).map((match) => {
    const title = escapeHtml(match.title || "打开");
    const view = escapeHtml(match.view);
    const id = escapeHtml(match.targetId);
    return `<a href="#${view}" data-screen-pop-view="${view}" data-screen-pop-id="${id}">${title}</a>`;
  }).join("");
  return `<article class="ccc-screen-pop" data-screen-pop="${escapeHtml(card.id || "")}"><h3>${escapeHtml(heading)}</h3><p>${masked}</p><div>${links}</div></article>`;
}

export function renderScreenPopStack(cards: ScreenPopCardView[]) {
  return cards.map(renderScreenPopCard).join("");
}
