import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CALL_EXPORT_HEADERS,
  CALL_EXPORT_ROW_LIMIT,
  buildCallExportCsv,
  callExportFiltersText,
  callExportLocalTime,
  canExportPlaintext,
  escapeCsvCell,
  exportNumberForCall,
  maskPhoneMiddle,
  parseCallExportPlaintext
} from "./call-export.js";
import { customerPhoneId, maskOutboundNumber } from "./outbound-call.js";
import { parseOutboundCallRecordQuery } from "./outbound-call-records.js";
import type { CrmStore } from "./store.js";

assert.equal(CALL_EXPORT_ROW_LIMIT, 10000);
assert.equal(10000 > CALL_EXPORT_ROW_LIMIT, false);
assert.equal(10001 > CALL_EXPORT_ROW_LIMIT, true);
assert.deepEqual([...CALL_EXPORT_HEADERS], ["时间", "坐席", "对象名", "号码", "接通与否", "时长秒", "人工结果标注", "纪要", "回拨预约"]);

assert.equal(canExportPlaintext("admin"), true);
assert.equal(canExportPlaintext("super_admin"), true);
assert.equal(canExportPlaintext("manager"), false);
assert.equal(canExportPlaintext("sales"), false);

assert.equal(parseCallExportPlaintext(undefined), false);
assert.equal(parseCallExportPlaintext(""), false);
assert.equal(parseCallExportPlaintext("0"), false);
assert.equal(parseCallExportPlaintext(" 1 "), true);
assert.equal(parseCallExportPlaintext("true"), null);
assert.equal(parseCallExportPlaintext(["1"]), null);

assert.equal(maskPhoneMiddle(""), "");
assert.equal(maskPhoneMiddle("abc"), "");
assert.equal(maskPhoneMiddle("1234"), "****");
assert.equal(maskPhoneMiddle("12-34"), "****");
assert.equal(maskPhoneMiddle("12345"), "1**45");
assert.equal(maskPhoneMiddle("1234567"), "1****67");
assert.equal(maskPhoneMiddle("12345678"), "123*5678");
assert.equal(maskPhoneMiddle("13812345678"), "138****5678");
assert.equal(maskPhoneMiddle("021-8888-1234"), "021****1234");
assert.equal(maskPhoneMiddle("+86 138 1234 5678"), "861******5678");

assert.equal(escapeCsvCell("北欧"), "北欧");
assert.equal(escapeCsvCell("=1+1"), "'=1+1");
assert.equal(escapeCsvCell("+1"), "'+1");
assert.equal(escapeCsvCell("-1"), "'-1");
assert.equal(escapeCsvCell("@x"), "'@x");
assert.equal(escapeCsvCell("=1,2"), `"'=1,2"`);
assert.equal(escapeCsvCell(`say "hi"`), `"say ""hi"""`);
assert.equal(escapeCsvCell("你好,世界"), `"你好,世界"`);
assert.equal(escapeCsvCell("第一行\n第二行"), `"第一行\n第二行"`);

const csv = buildCallExportCsv([
  ["2026-04-05 09:00", "Shirley坐席", "=导出公司", "138****5678", "是", "15", "有意向", "@纪要", "2026-04-06 09:00 你好,世界"]
]);
assert.equal(csv.charCodeAt(0), 0xfeff);
assert.equal(csv.includes("\r\n"), true);
assert.match(csv, /时间,坐席,对象名,号码,接通与否,时长秒,人工结果标注,纪要,回拨预约/);
assert.match(csv, /'=导出公司/);
assert.match(csv, /'@纪要/);
assert.match(csv, /"2026-04-06 09:00 你好,世界"/);
assert.equal(csv.includes("13812345678"), false);

const shanghai = String(Date.parse("2026-04-04T04:00:00.000Z"));
assert.equal(callExportLocalTime(shanghai, "Asia/Shanghai"), "2026-04-04 12:00");
assert.equal(callExportLocalTime(shanghai, "America/New_York"), "2026-04-04 00:00");
assert.equal(callExportLocalTime("  ", "Asia/Shanghai"), "");
assert.equal(callExportLocalTime("nope", "Asia/Shanghai"), "");

const parsed = parseOutboundCallRecordQuery({ agentId: "agent-a", from: "2026-04-01", to: "2026-04-02", outcome: "有意向", note: "has" });
assert.ok(parsed);
assert.equal(callExportFiltersText(parsed).includes("138"), false);
assert.match(callExportFiltersText(parsed), /"agentId":"agent-a"/);
assert.match(callExportFiltersText(parsed), /"note":"has"/);

const store = {
  phoneValidities: [],
  outboundCallAudits: [{ id: "a1", teamId: "europe", phoneId: "extra-1", targetType: "customer", targetId: "c1" }],
  customers: [{ id: "c1", teamId: "europe", ownerId: "u1", phone: "13800001111" }],
  leads: [],
  websiteOpportunities: [],
  prospectContactChannels: [],
  contactPhones: [{ teamId: "europe", targetType: "customer", targetId: "c1", phoneId: "extra-1", phone: "021-8888-1234" }]
} as unknown as CrmStore;

const extraRecord = {
  teamId: "europe",
  targetType: "customer" as const,
  targetId: "c1",
  maskedNumber: maskOutboundNumber("02188881234"),
  outboundCallAuditId: "a1"
};
assert.equal(exportNumberForCall(store, extraRecord, false), "021****1234");
assert.equal(exportNumberForCall(store, extraRecord, true), "021-8888-1234");

const primaryRecord = {
  ...extraRecord,
  outboundCallAuditId: "",
  maskedNumber: maskOutboundNumber("13800001111")
};
assert.equal(exportNumberForCall(store, primaryRecord, false), "138****1111");
assert.equal(exportNumberForCall(store, primaryRecord, true), "13800001111");

const unmatched = {
  ...extraRecord,
  outboundCallAuditId: "",
  maskedNumber: maskOutboundNumber("02188881234")
};
assert.equal(exportNumberForCall(store, unmatched, true), maskOutboundNumber("02188881234"));
assert.equal(exportNumberForCall(store, unmatched, true).includes("02188881234"), false);
assert.equal(exportNumberForCall(store, unmatched, true).includes("13800001111"), false);

const prospect = {
  phoneValidities: [],
  outboundCallAudits: [],
  customers: [],
  leads: [],
  websiteOpportunities: [{ id: "p1", teamId: "europe", ownerId: "u1", tenantProspectId: "tp1" }],
  prospectContactChannels: [
    { id: "ch-a", teamId: "europe", ownerId: "u1", prospectId: "tp1", channelType: "phone", value: "01066661234" },
    { id: "ch-b", teamId: "europe", ownerId: "u1", prospectId: "tp1", channelType: "phone", value: "02177771234" }
  ],
  contactPhones: []
} as unknown as CrmStore;
const ambiguous = {
  teamId: "europe",
  targetType: "prospect" as const,
  targetId: "p1",
  maskedNumber: maskOutboundNumber("01066661234"),
  outboundCallAuditId: ""
};
assert.equal(exportNumberForCall(prospect, ambiguous, true), ambiguous.maskedNumber);
assert.equal(exportNumberForCall(prospect, ambiguous, true).includes("01066661234"), false);
assert.equal(exportNumberForCall(prospect, ambiguous, true).includes("02177771234"), false);

const picked = {
  ...prospect,
  outboundCallAudits: [{ id: "ap", teamId: "europe", phoneId: "ch-b", targetType: "prospect", targetId: "p1" }]
} as unknown as CrmStore;
assert.equal(exportNumberForCall(picked, { ...ambiguous, outboundCallAuditId: "ap" }, true), "02177771234");
assert.equal(exportNumberForCall(picked, { ...ambiguous, outboundCallAuditId: "ap" }, false), "021****1234");

assert.equal(customerPhoneId("c1"), "customer-phone:c1");

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS call_export_audits \(/);
assert.equal(schema.includes("CREATE TABLE call_export_audits"), false);
assert.equal(schema.includes("DROP TABLE call_export_audits"), false);
assert.match(schema, /filters_json VARCHAR\(1000\) NOT NULL DEFAULT ''/);
assert.match(schema, /row_count INT NOT NULL DEFAULT 0/);
assert.match(schema, /plaintext TINYINT NOT NULL DEFAULT 0/);
assert.match(schema, /actor_id VARCHAR\(64\) NOT NULL/);
assert.match(schema, /occurred_at DATETIME NULL/);
const created = schema.match(/CREATE TABLE IF NOT EXISTS call_export_audits \(/g) || [];
assert.equal(created.length, 1);

const source = readFileSync(new URL("./call-export.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /makeCall|MakeCall|aliyuncs|convert_to_lead|convertProspect|approved_contactable|unsuppress|mailto|nodemailer|fetch\(/i);
assert.match(source, /maskPhoneMiddle/);
assert.match(source, /resolveCallRecordPhone/);
assert.match(source, /call_export_audits|callExportAudits/);

console.log("call export tests passed");
