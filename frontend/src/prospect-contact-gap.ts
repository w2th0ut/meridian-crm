/**
 * 联系方式缺口的只读分类。
 * 只读候选上已经有的联系方式：contactInfo、contact，以及 extractedContacts 的 emails / phones。
 * 邮箱和电话沿用仓内已有的格式（与 contactChannelsFromText 同一套）。
 * 先去掉邮箱再认电话，避免邮箱里的长数字被当成电话。即时通讯号码数组不在这份输入里，不算电话。
 * 字段不在这条记录上时写「无联系字段」，不把缺项编出来。
 * 字段在、但空着：两项都空写「缺邮箱 · 缺电话」，只缺一项写「缺邮箱」或「缺电话」，两项都有写「完备」。
 * 不自动补齐，不发信，也不碰门禁。
 * 文案不和发信资格灯、覆盖池缺口、跟进记录空档、获客待办摘要、下次跟进逾期、转化阶段卡住、待记跟进、今日到期、待发草稿、外联序列、回复、打开或点击、失败或抑制、收信同步混用。
 */

export const CONTACT_GAP_LIMIT = 8;

export type ContactGapKind = "none" | "missing_both" | "missing_email" | "missing_phone" | "complete";
export type ContactGapListFilter = "all" | "email" | "phone";

export interface ContactGapInput {
  /**
   * 至少有一个联系方式字段在这条记录上。
   * 为 false 时不读下面的值，写成无联系字段。
   */
  fieldsPresent: boolean;
  /** 未提供表示这个字段不在。空字符串表示字段在、但没有内容。 */
  contactInfo?: string | null;
  contact?: string | null;
  /** 未提供表示没有结构化邮箱列表。空数组表示列表在、但没有邮箱。 */
  emails?: readonly string[] | null;
  phones?: readonly string[] | null;
}

export interface ContactGapView {
  kind: ContactGapKind;
  hasEmail: boolean;
  hasPhone: boolean;
}

export const CONTACT_GAP_BOUNDARY = "这里只按候选上已经有的联系方式判断邮箱和电话。邮箱按现有邮箱格式，电话按现有号码格式。两个都有算完备。缺了邮箱写缺邮箱，缺了电话写缺电话，两项都空写缺邮箱和缺电话。联系方式字段不在这条记录上时写无联系字段，不把缺项编出来。空着的字段仍算字段在。这不是发信资格灯，也不是覆盖池缺口，也不是跟进记录空档，也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住，也不是待记跟进或今日到期，也不是待发草稿、外联序列、回复、打开或点击、失败或抑制、收信同步。不会自动补齐联系方式，不会发信，也不会改 convert_to_lead 或 approved_contactable。";

const LINE_LABEL: Record<ContactGapKind, string> = {
  none: "无联系字段",
  missing_both: "缺邮箱 · 缺电话",
  missing_email: "缺邮箱",
  missing_phone: "缺电话",
  complete: "完备"
};

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizedPhone(value: string) {
  const prefix = value.trim().startsWith("+") ? "+" : "";
  const digits = value.replace(/\D/gu, "");
  return digits.length >= 7 ? `${prefix}${digits}` : "";
}

function readEmails(value: string) {
  return unique((value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu) || []).map((item) =>
    item.toLocaleLowerCase("en-US")
  ));
}

/** 先去掉邮箱，再按现有号码格式认电话。 */
function readPhones(value: string) {
  const withoutEmails = value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, " ");
  return unique((withoutEmails.match(/(?:\+|00)?\d[\d\s().-]{6,}\d/gu) || [])
    .map(normalizedPhone)
    .filter(Boolean));
}

export function emptyContactGap(): ContactGapView {
  return { kind: "none", hasEmail: false, hasPhone: false };
}

/**
 * 字段不在时不判断。字段在时，只认已经写着的邮箱和电话。
 */
export function presentContactGap(input: ContactGapInput): ContactGapView {
  if (!input.fieldsPresent) return emptyContactGap();
  const texts = [input.contactInfo, input.contact].filter((value): value is string => typeof value === "string");
  const emails = unique([
    ...texts.flatMap(readEmails),
    ...(input.emails || []).flatMap((value) => readEmails(String(value ?? "")))
  ]);
  const phones = unique([
    ...texts.flatMap(readPhones),
    ...(input.phones || []).flatMap((value) => readPhones(String(value ?? "")))
  ]);
  const hasEmail = emails.length > 0;
  const hasPhone = phones.length > 0;
  if (hasEmail && hasPhone) return { kind: "complete", hasEmail, hasPhone };
  if (!hasEmail && !hasPhone) return { kind: "missing_both", hasEmail, hasPhone };
  if (!hasEmail) return { kind: "missing_email", hasEmail, hasPhone };
  return { kind: "missing_phone", hasEmail, hasPhone };
}

export function contactGapMatchesFilter(view: ContactGapView, filter: ContactGapListFilter) {
  if (filter === "email") return view.kind === "missing_email" || view.kind === "missing_both";
  if (filter === "phone") return view.kind === "missing_phone" || view.kind === "missing_both";
  return true;
}

export function contactGapRank(view: ContactGapView) {
  if (view.kind === "missing_both") return 0;
  if (view.kind === "missing_email") return 1;
  if (view.kind === "missing_phone") return 2;
  if (view.kind === "complete") return 3;
  return 4;
}

export function contactGapIsGap(view: ContactGapView) {
  return view.kind === "missing_both" || view.kind === "missing_email" || view.kind === "missing_phone";
}

/** 从工作台打开时落到对应筛选。两项都缺仍属于缺邮箱，行上继续写两项。完备保持全部。 */
export function contactGapListFilterForOpen(view: ContactGapView): ContactGapListFilter {
  if (view.kind === "missing_phone") return "phone";
  if (view.kind === "missing_email" || view.kind === "missing_both") return "email";
  return "all";
}

export function contactGapLineLabel(view: ContactGapView) {
  return LINE_LABEL[view.kind];
}

export function contactGapStatusLabel(view: ContactGapView) {
  return LINE_LABEL[view.kind];
}

export function contactGapEntryLabel() {
  return "去联系方式";
}

export function contactGapSummary(view: ContactGapView) {
  return `${LINE_LABEL[view.kind]}。${CONTACT_GAP_BOUNDARY}`;
}

export function listContactGapQueue<T extends { id: string }>(
  rows: readonly T[],
  viewOf: (row: T) => ContactGapView,
  limit = CONTACT_GAP_LIMIT
) {
  const ranked = rows
    .map((row) => ({ row, view: viewOf(row) }))
    .filter((item) => item.view.kind !== "none")
    .sort((left, right) => {
      const rank = contactGapRank(left.view) - contactGapRank(right.view);
      if (rank) return rank;
      return left.row.id < right.row.id ? -1 : left.row.id > right.row.id ? 1 : 0;
    });
  const cap = Number.isFinite(limit) ? Math.max(0, limit) : ranked.length;
  return {
    total: ranked.length,
    rows: ranked.slice(0, cap).map((item) => item.row)
  };
}
