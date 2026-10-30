import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeProspectOutreachDraftBacklog } from "./prospect-outreach-draft-backlog.js";

const candidate = { id: "cand_1", teamId: "team", leadId: "lead_1", customerId: "cust_1" };
const ownerId = "owner_1";

const none = describeProspectOutreachDraftBacklog({ candidate, ownerId });
assert.equal(none.backlog, "none");
assert.equal(none.count, 0);
assert.equal(none.batchId, "");
assert.equal(JSON.stringify(none).includes("error"), false);

const pending = describeProspectOutreachDraftBacklog({
  candidate,
  ownerId,
  batches: [{
    id: "batch_draft",
    teamId: "team",
    ownerId,
    status: "draft",
    updatedAt: "2026-10-18T08:00:00.000Z",
    items: [{
      candidateId: "cand_1",
      status: "ready",
      steps: [
        { status: "pending", subject: "  第一次开发信  ", error: "不该出现的失败原因" },
        { status: "pending", subject: "第二次" },
        { status: "sent", subject: "已经发出" },
        { status: "failed", subject: "失败步骤", error: "550" }
      ]
    }]
  }]
});
assert.equal(pending.backlog, "pending");
assert.equal(pending.count, 2);
assert.equal(pending.subject, "第一次开发信");
assert.equal(pending.batchId, "batch_draft");
assert.equal(pending.updatedAt, "2026-10-18T08:00:00.000Z");
assert.equal(JSON.stringify(pending).includes("不该出现"), false);
assert.equal(JSON.stringify(pending).includes("550"), false);

const released = describeProspectOutreachDraftBacklog({
  candidate,
  ownerId,
  batches: [{
    id: "batch_approved",
    teamId: "team",
    ownerId,
    status: "approved",
    updatedAt: "2026-10-18T09:00:00.000Z",
    items: [{
      candidateId: "cand_1",
      status: "ready",
      steps: [{ status: "pending", subject: "已放行不算草稿" }]
    }]
  }]
});
assert.equal(released.backlog, "none");

for (const status of ["paused", "completed", "cancelled", "running"]) {
  const view = describeProspectOutreachDraftBacklog({
    candidate,
    ownerId,
    batches: [{
      id: `batch_${status}`,
      teamId: "team",
      ownerId,
      status,
      items: [{ candidateId: "cand_1", status: "ready", steps: [{ status: "pending", subject: "不算" }] }]
    }]
  });
  assert.equal(view.backlog, "none", status);
}

const skipped = describeProspectOutreachDraftBacklog({
  candidate,
  ownerId,
  batches: [{
    id: "batch_skip",
    teamId: "team",
    ownerId,
    status: "draft",
    items: [{ candidateId: "cand_1", status: "skipped", steps: [{ status: "pending", subject: "跳过" }] }]
  }]
});
assert.equal(skipped.backlog, "none");

const otherTeam = describeProspectOutreachDraftBacklog({
  candidate,
  ownerId,
  batches: [{
    id: "batch_other",
    teamId: "other",
    ownerId,
    status: "draft",
    items: [{ candidateId: "cand_1", status: "ready", steps: [{ status: "pending", subject: "别的团队" }] }]
  }]
});
assert.equal(otherTeam.backlog, "none");

const summed = describeProspectOutreachDraftBacklog({
  candidate,
  ownerId,
  batches: [
    {
      id: "batch_old",
      teamId: "team",
      ownerId,
      status: "draft",
      updatedAt: "2026-10-01T08:00:00.000Z",
      items: [{ candidateId: "cand_1", status: "ready", steps: [{ status: "pending", subject: "旧主题" }] }]
    },
    {
      id: "batch_new",
      teamId: "team",
      ownerId,
      status: "draft",
      updatedAt: "2026-10-18T08:00:00.000Z",
      items: [{
        candidateId: "cand_1",
        status: "ready",
        steps: [{ status: "pending", subject: "新主题" }, { status: "", subject: "" }]
      }]
    }
  ]
});
assert.equal(summed.count, 3);
assert.equal(summed.batchId, "batch_new");
assert.equal(summed.subject, "新主题");

const tie = describeProspectOutreachDraftBacklog({
  candidate,
  ownerId,
  batches: [
    {
      id: "batch_b",
      teamId: "team",
      ownerId,
      status: "draft",
      updatedAt: "2026-10-18T08:00:00.000Z",
      items: [{ candidateId: "cand_1", status: "ready", steps: [{ status: "pending", subject: "后" }] }]
    },
    {
      id: "batch_a",
      teamId: "team",
      ownerId,
      status: "draft",
      updatedAt: "2026-10-18T08:00:00.000Z",
      items: [{ candidateId: "cand_1", status: "ready", steps: [{ status: "pending", subject: "先" }] }]
    }
  ]
});
assert.equal(tie.batchId, "batch_a");
assert.equal(tie.subject, "先");
assert.equal(tie.count, 2);

const byLead = describeProspectOutreachDraftBacklog({
  candidate,
  ownerId,
  batches: [{
    id: "batch_lead",
    teamId: "team",
    ownerId,
    status: "draft",
    items: [{
      entityType: "lead",
      leadId: "lead_1",
      status: "ready",
      steps: [{ status: "pending", subject: "线索草稿" }]
    }]
  }]
});
assert.equal(byLead.backlog, "pending");
assert.equal(byLead.subject, "线索草稿");

const otherLead = describeProspectOutreachDraftBacklog({
  candidate: { id: "cand_1", teamId: "team" },
  ownerId,
  batches: [{
    id: "batch_lead_miss",
    teamId: "team",
    ownerId,
    status: "draft",
    items: [{ entityType: "lead", leadId: "lead_1", status: "ready", steps: [{ status: "pending", subject: "不该命中" }] }]
  }]
});
assert.equal(otherLead.backlog, "none");

const byCustomer = describeProspectOutreachDraftBacklog({
  candidate,
  ownerId,
  batches: [{
    id: "batch_customer",
    teamId: "team",
    ownerId,
    status: "draft",
    items: [{
      entityType: "customer",
      candidateId: "cust_1",
      status: "ready",
      steps: [{ status: "pending", subject: "客户草稿" }]
    }]
  }]
});
assert.equal(byCustomer.subject, "客户草稿");

const sentOnly = describeProspectOutreachDraftBacklog({
  candidate,
  ownerId,
  batches: [{
    id: "batch_sent",
    teamId: "team",
    ownerId,
    status: "draft",
    items: [{
      candidateId: "cand_1",
      status: "ready",
      steps: [{ status: "sent", subject: "已发" }, { status: "skipped", subject: "跳过" }]
    }]
  }]
});
assert.equal(sentOnly.backlog, "none");

const clipped = describeProspectOutreachDraftBacklog({
  candidate,
  ownerId,
  batches: [{
    id: "batch_long",
    teamId: "team",
    ownerId,
    status: "draft",
    items: [{
      candidateId: "cand_1",
      status: "ready",
      steps: [{ status: "pending", subject: "甲".repeat(60) }]
    }]
  }]
});
assert.equal(clipped.subject, `${"甲".repeat(48)}…`);

const otherOwner = describeProspectOutreachDraftBacklog({
  candidate,
  ownerId,
  batches: [{
    id: "batch_other_owner",
    teamId: "team",
    ownerId: "owner_2",
    status: "draft",
    items: [{ candidateId: "cand_1", status: "ready", steps: [{ status: "pending", subject: "别人的草稿" }] }]
  }]
});
assert.equal(otherOwner.backlog, "none");

const source = readFileSync(new URL("./prospect-outreach-draft-backlog.ts", import.meta.url), "utf8");
assert.match(source, /status\) !== "draft"/);
assert.match(source, /status\) !== "ready"/);
assert.doesNotMatch(source, /convert_to_lead|approved_contactable|approveProspectOutreachBatch|send-development-email|createProspectOutreachBatch|nodemailer/);

const serverSource = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
assert.match(serverSource, /from "\.\/prospect-outreach-draft-backlog\.js"/);
assert.match(
  serverSource,
  /outreachDraftBacklog: describeProspectOutreachDraftBacklog\(/,
  "搜客清单接口必须带回待发草稿积压"
);

console.log("prospect-outreach-draft-backlog-test: ok");
