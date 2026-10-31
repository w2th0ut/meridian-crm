import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readCccCampaigns, readCccCases, readCccSeats } from "./aliyun-ccc-directory.js";
import { noteInboundScreenPop } from "./aliyun-screen-pop.js";
import { stripSecretFields, toWorkbenchApiBody } from "./aliyun-workbench.js";
import { getStore } from "./store.js";

const seatBody = {
  Code: "OK",
  Data: {
    List: [{
      UserId: "agent@ccc-demo",
      LoginName: "agent",
      DisplayName: "坐席小王",
      Extension: "8001",
      WorkMode: "ON_SITE",
      RoleId: "Agent@ccc-demo",
      Email: "secret-agent@example.com",
      Mobile: "13800001111"
    }],
    PageNumber: 1,
    PageSize: 10,
    TotalCount: 1
  }
};
const seats = readCccSeats(seatBody);
assert.equal(seats.length, 1);
assert.equal(seats[0].userId, "agent@ccc-demo");
assert.equal(JSON.stringify(seats).includes("secret-agent@example.com"), false);
assert.equal(JSON.stringify(seats).includes("13800001111"), false);

const campaigns = readCccCampaigns({
  Code: "OK",
  Data: {
    List: [{
      CampaignId: "camp-1",
      Name: "测试活动",
      State: "Paused",
      TotalCases: 3,
      CasesConnected: 1,
      CasesUncompleted: 2,
      CasesAborted: 0,
      QueueName: "组"
    }]
  }
});
assert.equal(campaigns[0].state, "Paused");
assert.equal(campaigns[0].casesUncompleted, 2);
assert.equal("completionRate" in campaigns[0], false);

const cases = readCccCases({
  Code: "OK",
  Data: { List: [{ CaseId: "case-1", State: "Forbidden", PhoneNumber: "18800001111", CustomVariables: "{\"name\":\"hidden\"}" }] }
}, (value) => value);
assert.equal(cases[0].state, "Forbidden");
assert.equal(JSON.stringify(cases).includes("hidden"), false);

const wrapped = toWorkbenchApiBody({
  Code: "OK",
  Data: { AccessKeySecret: "SkSecretValue9999wxyz", UserId: "agent@ccc-demo" },
  HttpStatusCode: 200,
  RequestId: "req-1"
});
assert.equal(JSON.stringify(wrapped).includes("SkSecretValue9999wxyz"), false);
assert.equal(JSON.stringify(stripSecretFields({ AccessKeyId: "LTAI12345678wxyz", ok: 1 })).includes("LTAI"), false);

const store = getStore();
const customersBefore = store.customers.length;
const leadsBefore = store.leads.length;
noteInboundScreenPop(store, "europe", {
  eventType: "Ringing",
  eventTime: "2026-10-31T00:00:00.000Z",
  callType: "INBOUND",
  agentId: "missing-agent",
  caller: "+46111222333",
  contactId: "job-x"
});
assert.equal(store.aliyunScreenPops.length, 0);
assert.equal(store.customers.length, customersBefore);
assert.equal(store.leads.length, leadsBefore);

const schema = readFileSync(new URL("./mysql-store.ts", import.meta.url), "utf8");
for (const table of [
  "aliyun_agent_mappings",
  "agent_mapping_audits",
  "aliyun_screen_pops",
  "aliyun_campaign_read_settings",
  "aliyun_campaign_snapshots",
  "aliyun_campaign_sync_audits"
]) {
  assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`));
  assert.equal(schema.includes(`CREATE TABLE ${table}`), false);
}
const campaign = readFileSync(new URL("./aliyun-campaign-sync.ts", import.meta.url), "utf8");
assert.match(campaign, /ListCampaigns|listCampaigns/);
assert.match(campaign, /listCases/);
assert.doesNotMatch(campaign, /SubmitCampaign|ResumeCampaign|AddCases|CreateCampaign|ImportDoNotCallNumbers|AssignJobs|CreateUser|setInterval|fetch\(/);
const workbench = readFileSync(new URL("./aliyun-workbench.ts", import.meta.url), "utf8");
assert.doesNotMatch(workbench, /accessKeySecret|AccessKeySecret\s*:/);
assert.match(workbench, /待核实/);
const screen = readFileSync(new URL("./aliyun-screen-pop.ts", import.meta.url), "utf8");
assert.doesNotMatch(screen, /customers\.push|leads\.push|websiteOpportunities\.push|convertProspectToLead|convert_to_lead|approved_contactable|setProspectSuppression/);

console.log("aliyun agent workbench unit tests passed");
