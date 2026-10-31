import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fromDateTimeLocal,
  renderOutboundCallRecordDetail,
  renderOutboundCallRecordList,
  toDateTimeLocal
} from "./outbound-call-records.js";

assert.equal(toDateTimeLocal("2026-11-02 09:00"), "2026-11-02T09:00");
assert.equal(fromDateTimeLocal("2026-11-02T09:00"), "2026-11-02 09:00");
assert.equal(fromDateTimeLocal("2026-11-02 09:00"), "");

const missed = renderOutboundCallRecordList([
  {
    id: "ocr_missed",
    localDate: "2026-10-30",
    maskedNumber: "*******2333",
    contactDisposition: "Success",
    established: false,
    targetType: "customer"
  }
]);
assert.match(missed, /data-open-missed-follow="ocr_missed"/);
assert.match(missed, /生成下次跟进/);
assert.equal(missed.includes("data-outbound-call"), false);
assert.equal(missed.includes(">外呼<"), false);
assert.equal(missed.includes("批量"), false);

const connected = renderOutboundCallRecordList([
  { id: "ocr_connected", established: true, contactDisposition: "Success" }
]);
assert.equal(connected.includes("data-open-missed-follow"), false);
assert.equal(connected.includes("生成下次跟进"), false);
assert.match(connected, />是</);

const detail = renderOutboundCallRecordDetail({
  record: { id: "ocr_missed", established: false, maskedNumber: "*******2333", contactDisposition: "NoAnswer" },
  suggestedNextFollowAt: "2026-11-02 09:00",
  suppressionNotice: "该对象在抑制或退订名单中。这次只记下下次跟进，不改变抑制状态。"
});
assert.match(detail, /data-generate-missed-follow="1"/);
assert.match(detail, /value="2026-11-02T09:00"/);
assert.match(detail, /data-follow-up-notice="1"/);
assert.match(detail, /不改变抑制状态/);
assert.equal(detail.includes("data-outbound-call"), false);
assert.equal(detail.includes("MakeCall"), false);

const establishedDetail = renderOutboundCallRecordDetail({
  record: { id: "ocr_connected", established: true }
});
assert.match(establishedDetail, /data-follow-up-established="1"/);
assert.equal(establishedDetail.includes("data-generate-missed-follow"), false);

const saved = renderOutboundCallRecordDetail({
  record: { id: "ocr_missed", established: false },
  followUp: { activityId: "ca_1", nextFollowAt: "2026-11-02 09:00" },
  suggestedNextFollowAt: "2026-11-04 10:30"
});
assert.match(saved, /已经生成过下次跟进/);
assert.match(saved, /disabled/);
assert.match(saved, /value="2026-11-02T09:00"/);

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const viewStart = html.indexOf('id="outbound-call-records"');
const viewEnd = html.indexOf('id="phone-strategies"', viewStart);
const view = html.slice(viewStart, viewEnd);
assert.match(view, /id="outboundCallRecordDetail"/);
assert.match(view, /不能拨号/);
assert.match(view, /不能批量生成/);
assert.equal(view.includes("data-outbound-call"), false);
assert.equal(view.includes(">外呼<"), false);
assert.equal(view.includes("MakeCall"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /\/api\/outbound-call-records\/\$\{encodeURIComponent\(recordId\)\}\/next-follow-up/);
assert.match(api, /data-open-missed-follow/);
assert.match(api, /data-generate-missed-follow/);
assert.doesNotMatch(api.slice(api.indexOf("async function submitMissedFollowUp"), api.indexOf("async function loadOutboundCallRecords")), /MakeCall|aliyuncs|records":|callRecordIds/);

console.log("outbound missed follow-up page tests passed");
