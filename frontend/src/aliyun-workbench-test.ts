import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderAgentMappingTable, renderCampaignRoster } from "./aliyun-agent-mapping.js";
import { renderScreenPopCard, screenPopHeading } from "./aliyun-screen-pop.js";
import {
  buildCccWorkbenchOptions,
  cccWorkbenchAssetUrls,
  gateBeforeCallDialing,
  shouldLoadCccWorkbench,
  CCC_WORKBENCH_VERSION
} from "./aliyun-workbench.js";

assert.equal(shouldLoadCccWorkbench({ load: false, instanceId: "ccc-demo", regionId: "cn-shanghai" }), false);
assert.equal(shouldLoadCccWorkbench({ load: true, mapped: true }), false);
assert.equal(shouldLoadCccWorkbench({ load: true, instanceId: "ccc-demo", regionId: "cn-shanghai" }), true);

const assets = cccWorkbenchAssetUrls();
assert.match(assets.scriptSrc, new RegExp(CCC_WORKBENCH_VERSION));
assert.match(assets.styleHref, /ui\.min\.css/);
assert.doesNotMatch(`${assets.scriptSrc} ${assets.styleHref}`, /cc-im-sdk|core\.min\.js/);

const options = buildCccWorkbenchOptions({
  instanceId: "ccc-demo",
  regionId: "cn-shanghai",
  ajaxPath: "/api/aliyun-outbound/workbench/api",
  onCallComing() {},
  onBeforeCallDialing() {}
});
assert.equal(options.dom, "ccc-workbench-container");
assert.equal(options.instanceId, "ccc-demo");
assert.equal(JSON.stringify(options).includes("AccessKey"), false);
assert.equal("imConfig" in options, false);

let called = 0;
await gateBeforeCallDialing({ callee: "10086", callback: () => { called += 1; } }, async () => ({ allowed: false }));
assert.equal(called, 0);
await gateBeforeCallDialing({ callee: "10086", callback: () => { called += 1; } }, async () => ({ allowed: true }));
assert.equal(called, 1);

assert.equal(screenPopHeading({ unknown: true, matches: [] }), "未知来电");
const card = renderScreenPopCard({
  id: "pop-1",
  maskedNumber: "*******2333",
  matches: [{ targetType: "customer", targetId: "c1", title: "Nordic <Tools>", view: "customers" }]
});
assert.match(card, /Nordic &lt;Tools&gt;/);
assert.match(card, /data-screen-pop-view="customers"/);
assert.match(card, /data-screen-pop-id="c1"/);
assert.doesNotMatch(card, /新建|保存|外呼|convert/i);
const unknown = renderScreenPopCard({ unknown: true, maskedNumber: "*******0000", matches: [] });
assert.match(unknown, /未知来电/);

const table = renderAgentMappingTable({
  seats: [{ userId: "agent@ccc-demo", displayName: "坐席小王" }],
  users: [{ id: "u1", name: "Shirley" }],
  mappings: []
});
assert.match(table, /agent@ccc-demo/);
assert.match(table, /data-agent-save="agent@ccc-demo"/);
assert.doesNotMatch(table, /CreateUser|AccessKey/);

const roster = renderCampaignRoster([{
  campaignId: "camp-1",
  name: "测试活动",
  state: "Paused",
  totalCases: 2,
  casesConnected: 1,
  casesUncompleted: 1,
  casesAborted: 0,
  cases: [{ caseId: "case-1", state: "Pending", maskedNumber: "*******1111" }]
}]);
assert.match(roster, /测试活动/);
assert.match(roster, /Paused/);
assert.doesNotMatch(roster, /启动|上传|恢复|提交|SubmitCampaign|ResumeCampaign/);

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(page, /id="cccSoftphone"/);
assert.match(page, /id="cccSoftphoneToggle"/);
assert.match(page, /id="ccc-workbench-container"/);
assert.match(page, /id="cccScreenPopStack"/);
assert.match(page, /id="aliyunAgentDirectoryButton"/);
assert.match(page, /id="aliyunCampaignSyncButton"/);
assert.match(page, /id="aliyunCampaignReadEnabled"/);
assert.doesNotMatch(page, /<script[^>]+g\.alicdn\.com/);
const campaignBlock = page.slice(page.indexOf('id="aliyunCampaignBlock"'), page.indexOf('id="aliyunCampaignBlock"') + 900);
assert.match(campaignBlock, /也不能启动任务或上传名单/);
assert.doesNotMatch(campaignBlock, /<button[^>]*>[^<]*(启动|上传|恢复|提交)/);
const softphone = readFileSync(new URL("./aliyun-workbench.ts", import.meta.url), "utf8");
assert.match(softphone, /3\.8\.1/);
assert.doesNotMatch(softphone, /setInterval/);
const api = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
assert.match(api, /shouldLoadCccWorkbench/);
assert.match(api, /gateBeforeCallDialing/);
assert.doesNotMatch(api, /setInterval\(\(\) => \{\s*void refreshCccSoftphone/);

console.log("aliyun workbench frontend tests passed");
