import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  matchesOutboundOwnerList,
  outboundOwnerFilterEmptyText,
  renderOutboundOwnerFilterOptions,
  renderOutboundOwnerListCell
} from "./outbound-owner.js";

assert.equal(matchesOutboundOwnerList("agent@ccc-a", "", ["agent@ccc-a"]), true);
assert.equal(matchesOutboundOwnerList("agent@ccc-a", "mine", ["agent@ccc-a"]), true);
assert.equal(matchesOutboundOwnerList("agent@ccc-b", "mine", ["agent@ccc-a"]), false);
assert.equal(matchesOutboundOwnerList("", "mine", []), false);
assert.equal(matchesOutboundOwnerList("", "unassigned", ["agent@ccc-a"]), true);
assert.equal(matchesOutboundOwnerList("agent@ccc-a", "unassigned", ["agent@ccc-a"]), false);
assert.equal(matchesOutboundOwnerList("agent@ccc-b", "agent@ccc-b", ["agent@ccc-a"]), true);

const empty = outboundOwnerFilterEmptyText("客户");
assert.match(empty, /没有符合外呼负责坐席筛选的客户/);
assert.equal(empty.includes("0"), false);
assert.equal(outboundOwnerFilterEmptyText("线索").includes("0"), false);
assert.equal(outboundOwnerFilterEmptyText("候选").includes("0"), false);

const options = renderOutboundOwnerFilterOptions([{ agentId: "agent@ccc-a", displayName: "Shirley坐席" }], "mine");
assert.match(options, /全部负责坐席/);
assert.match(options, /我负责的/);
assert.match(options, /待指派/);
assert.match(options, /Shirley坐席/);
assert.match(options, /value="mine" selected/);

const shown = renderOutboundOwnerListCell({
  targetType: "customer",
  targetId: "c1",
  ownerAgentId: "agent@ccc-a",
  ownerAgentLabel: "Shirley坐席",
  canManage: false
});
assert.match(shown, /外呼负责坐席：Shirley坐席/);
assert.match(shown, /data-outbound-owner-cell="1"/);
assert.match(shown, /data-owner-agent="agent@ccc-a"/);
assert.equal(shown.includes("保存"), false);
assert.equal(shown.includes("拨号"), false);
assert.equal(shown.includes("批量"), false);

const form = renderOutboundOwnerListCell({
  targetType: "prospect",
  targetId: "web_seed_1",
  ownerAgentId: "",
  canManage: true,
  agents: [{ agentId: "agent@ccc-a", displayName: "Shirley坐席" }],
  tag: "div"
});
assert.match(form, /data-outbound-owner-row="1"/);
assert.match(form, /data-target-type="prospect"/);
assert.match(form, /未指派/);
assert.match(form, /不会拨号/);
assert.equal(form.includes("批量"), false);
assert.equal(form.includes("MakeCall"), false);
assert.equal(form.includes("/api/outbound-calls"), false);
assert.match(renderOutboundOwnerListCell({ targetType: "lead", targetId: "l1" }), /外呼负责坐席：未指派/);

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /id="customerOutboundOwnerFilter"/);
assert.match(html, /id="leadOutboundOwnerFilter"/);
assert.match(html, /id="prospectOutboundOwnerFilter"/);
for (const id of ["customerOutboundOwnerFilter", "leadOutboundOwnerFilter", "prospectOutboundOwnerFilter"]) {
  const start = html.indexOf(`id="${id}"`);
  assert.ok(start > 0);
  const select = html.slice(start, html.indexOf("</select>", start));
  assert.match(select, /我负责的/);
  assert.match(select, /待指派/);
  assert.equal(select.includes("批量"), false);
}
const customerTable = html.slice(html.indexOf('id="customers"'), html.indexOf('id="customer-detail"'));
assert.match(customerTable, /<th>外呼负责坐席<\/th>/);
const leadTable = html.slice(html.indexOf('id="leads"'), html.indexOf('id="customers"'));
assert.match(leadTable, /<th>外呼负责坐席<\/th>/);
const prospect = html.slice(html.indexOf('id="prospect-list"'), html.indexOf('id="leads"'));
assert.match(prospect, /外呼负责坐席/);
assert.equal(prospect.includes("批量指派"), false);
assert.equal(customerTable.includes("批量指派"), false);

const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /renderOutboundOwnerListCell/);
assert.match(api, /matchesOutboundOwnerList/);
assert.match(api, /customerOutboundOwnerFilter/);
assert.match(api, /leadOutboundOwnerFilter/);
assert.match(api, /prospectOutboundOwnerFilter/);
assert.match(api, /saveOutboundOwnerFromList/);
const saveStart = api.indexOf("async function saveOutboundOwnerFromList");
const saveEnd = api.indexOf("async function loadCallbackReminders", saveStart);
assert.ok(saveStart > 0 && saveEnd > saveStart);
const save = api.slice(saveStart, saveEnd);
assert.match(save, /\/api\/outbound-owners\/clear/);
assert.match(save, /\/api\/outbound-owners/);
assert.match(save, /outboundOwnerAssignBody/);
assert.doesNotMatch(save, /\/api\/outbound-calls|MakeCall|aliyuncs|records|agentIds|targetIds/);
assert.equal(api.includes("批量指派外呼"), false);

console.log("outbound owner list frontend tests passed");
