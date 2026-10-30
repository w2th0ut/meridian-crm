import assert from "node:assert/strict";
import {
  CONTACT_GAP_LIMIT,
  contactGapEntryLabel,
  contactGapIsGap,
  contactGapLineLabel,
  contactGapListFilterForOpen,
  contactGapMatchesFilter,
  contactGapRank,
  contactGapStatusLabel,
  contactGapSummary,
  listContactGapQueue,
  presentContactGap,
  type ContactGapInput
} from "./prospect-contact-gap.js";

function input(partial: Partial<ContactGapInput> & { fieldsPresent?: boolean } = {}): ContactGapInput {
  return {
    fieldsPresent: partial.fieldsPresent ?? true,
    contactInfo: partial.contactInfo ?? "",
    contact: partial.contact ?? "",
    emails: partial.emails ?? null,
    phones: partial.phones ?? null
  };
}

const absent = presentContactGap(input({
  fieldsPresent: false,
  contactInfo: "sales@acme.example",
  phones: ["+14155550123"]
}));
assert.equal(absent.kind, "none");
assert.equal(absent.hasEmail, false);
assert.equal(absent.hasPhone, false);
assert.equal(contactGapLineLabel(absent), "无联系字段");
assert.equal(contactGapStatusLabel(absent), "无联系字段");
assert.equal(contactGapEntryLabel(), "去联系方式");
assert.match(contactGapSummary(absent), /^无联系字段。/);
assert.match(contactGapSummary(absent), /这不是发信资格灯，也不是覆盖池缺口，也不是跟进记录空档/);
assert.match(contactGapSummary(absent), /也不是获客待办摘要，也不是下次跟进逾期，也不是转化阶段卡住/);
assert.match(contactGapSummary(absent), /也不是待记跟进或今日到期，也不是待发草稿、外联序列、回复、打开或点击、失败或抑制、收信同步/);
assert.match(contactGapSummary(absent), /不会自动补齐联系方式，不会发信，也不会改 convert_to_lead 或 approved_contactable/);
assert.match(contactGapSummary(absent), /空着的字段仍算字段在/);
assert.doesNotMatch(contactGapLineLabel(absent), /逾期|今日到期|无下次跟进|卡住|推进中|无阶段|获客待办|空档|无记录|覆盖池|暂无跟进|已逾期|未设下次跟进|发信资格|已抑制|可发信/);
assert.equal(contactGapMatchesFilter(absent, "email"), false);
assert.equal(contactGapMatchesFilter(absent, "phone"), false);
assert.equal(contactGapMatchesFilter(absent, "all"), true);
assert.equal(contactGapIsGap(absent), false);
assert.equal(contactGapRank(absent), 4);
assert.equal(contactGapListFilterForOpen(absent), "all");

const blank = presentContactGap(input({ contactInfo: "  ", contact: "待维护" }));
assert.equal(blank.kind, "missing_both");
assert.equal(contactGapLineLabel(blank), "缺邮箱 · 缺电话");
assert.equal(contactGapStatusLabel(blank), "缺邮箱 · 缺电话");
assert.match(contactGapSummary(blank), /^缺邮箱 · 缺电话。/);
assert.equal(contactGapMatchesFilter(blank, "email"), true);
assert.equal(contactGapMatchesFilter(blank, "phone"), true);
assert.equal(contactGapIsGap(blank), true);
assert.equal(contactGapRank(blank), 0);
assert.equal(contactGapListFilterForOpen(blank), "email");
assert.doesNotMatch(contactGapLineLabel(blank), /逾期|空档|卡住|覆盖池|无记录|无阶段|获客待办|发信资格/);

const emailOnly = presentContactGap(input({ contactInfo: "sales@acme.example" }));
assert.equal(emailOnly.kind, "missing_phone");
assert.equal(emailOnly.hasEmail, true);
assert.equal(emailOnly.hasPhone, false);
assert.equal(contactGapLineLabel(emailOnly), "缺电话");
assert.equal(contactGapMatchesFilter(emailOnly, "phone"), true);
assert.equal(contactGapMatchesFilter(emailOnly, "email"), false);
assert.equal(contactGapRank(emailOnly), 2);
assert.equal(contactGapListFilterForOpen(emailOnly), "phone");
assert.equal(contactGapIsGap(emailOnly), true);

const phoneOnly = presentContactGap(input({ contactInfo: "+1 (415) 555-0123" }));
assert.equal(phoneOnly.kind, "missing_email");
assert.equal(phoneOnly.hasEmail, false);
assert.equal(phoneOnly.hasPhone, true);
assert.equal(contactGapLineLabel(phoneOnly), "缺邮箱");
assert.equal(contactGapMatchesFilter(phoneOnly, "email"), true);
assert.equal(contactGapMatchesFilter(phoneOnly, "phone"), false);
assert.equal(contactGapRank(phoneOnly), 1);
assert.equal(contactGapListFilterForOpen(phoneOnly), "email");

const both = presentContactGap(input({ contactInfo: "sales@acme.example / +1 (415) 555-0123" }));
assert.equal(both.kind, "complete");
assert.equal(both.hasEmail, true);
assert.equal(both.hasPhone, true);
assert.equal(contactGapLineLabel(both), "完备");
assert.equal(contactGapStatusLabel(both), "完备");
assert.match(contactGapSummary(both), /^完备。/);
assert.equal(contactGapMatchesFilter(both, "email"), false);
assert.equal(contactGapMatchesFilter(both, "phone"), false);
assert.equal(contactGapIsGap(both), false);
assert.equal(contactGapRank(both), 3);
assert.equal(contactGapListFilterForOpen(both), "all");
assert.doesNotMatch(contactGapLineLabel(both), /缺邮箱|缺电话|无联系字段|逾期|空档|卡住/);

const emailDigits = presentContactGap(input({ contactInfo: "user12345678@acme.example" }));
assert.equal(emailDigits.kind, "missing_phone", "邮箱里的长数字不是电话");
assert.equal(emailDigits.hasEmail, true);
assert.equal(emailDigits.hasPhone, false);

const shortPhone = presentContactGap(input({ contactInfo: "1234567" }));
assert.equal(shortPhone.kind, "missing_both", "不足现有号码格式的数字不算电话");

const plusShort = presentContactGap(input({ phones: ["+1234567"] }));
assert.equal(plusShort.kind, "missing_both", "现有号码格式至少要 8 位数字");

const plusOk = presentContactGap(input({ phones: ["+12345678"] }));
assert.equal(plusOk.kind, "missing_email");
assert.equal(plusOk.hasPhone, true);

const structured = presentContactGap(input({
  contactInfo: "",
  contact: "Ada",
  emails: ["Ada@Buyer.Example"],
  phones: ["415-555-0198"]
}));
assert.equal(structured.kind, "complete");
assert.equal(structured.hasEmail, true);

const emailInName = presentContactGap(input({ contact: "Ada <ada@buyer.example>", contactInfo: "" }));
assert.equal(emailInName.kind, "missing_phone");

const invalidExtracted = presentContactGap(input({
  emails: ["not-an-email"],
  phones: ["123"]
}));
assert.equal(invalidExtracted.kind, "missing_both");

const frozenEmails = Object.freeze(["sales@acme.example"]);
const frozen = Object.freeze(input({ emails: frozenEmails, phones: Object.freeze(["+14155550123"]) }));
presentContactGap(frozen);
assert.deepEqual(frozen.emails, ["sales@acme.example"]);
assert.equal(presentContactGap(frozen).kind, "complete");

const rows: Array<{ id: string; fieldsPresent: boolean; contactInfo: string }> = [
  { id: "complete", fieldsPresent: true, contactInfo: "a@b.co / +14155550111" },
  { id: "phone", fieldsPresent: true, contactInfo: "+49 30 123456" },
  { id: "email-b", fieldsPresent: true, contactInfo: "b@buyer.example" },
  { id: "email-a", fieldsPresent: true, contactInfo: "a@buyer.example" },
  { id: "both", fieldsPresent: true, contactInfo: "" },
  { id: "none", fieldsPresent: false, contactInfo: "hidden@buyer.example" }
];
const queue = listContactGapQueue(rows, (row) => presentContactGap(input({
  fieldsPresent: row.fieldsPresent,
  contactInfo: row.contactInfo
})));
assert.deepEqual(queue.rows.map((row) => row.id), ["both", "phone", "email-a", "email-b", "complete"]);
assert.equal(queue.total, 5);
assert.equal(CONTACT_GAP_LIMIT, 8);

const many = Array.from({ length: 9 }, (_, index) => ({
  id: `g${index}`,
  contactInfo: ""
}));
const capped = listContactGapQueue(many, (row) => presentContactGap(input({ contactInfo: row.contactInfo })));
assert.equal(capped.total, 9);
assert.equal(capped.rows.length, 8);
assert.deepEqual(capped.rows.map((row) => row.id), ["g0", "g1", "g2", "g3", "g4", "g5", "g6", "g7"]);
assert.equal(presentContactGap(input({ contactInfo: "" })).kind, "missing_both");

const tied = listContactGapQueue(
  [
    { id: "b", contactInfo: "b@buyer.example" },
    { id: "a", contactInfo: "a@buyer.example" }
  ],
  (row) => presentContactGap(input({ contactInfo: row.contactInfo }))
);
assert.deepEqual(tied.rows.map((row) => row.id), ["a", "b"]);

const gapFirst = listContactGapQueue(
  [
    { id: "a-complete", contactInfo: "a@b.co / +14155550111" },
    { id: "z-gap", contactInfo: "+14155550199" }
  ],
  (row) => presentContactGap(input({ contactInfo: row.contactInfo }))
);
assert.deepEqual(gapFirst.rows.map((row) => row.id), ["z-gap", "a-complete"]);

console.log("prospect-contact-gap-test: ok");
