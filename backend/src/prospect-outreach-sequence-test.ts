import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeProspectOutreachSequence } from "./prospect-outreach-sequence.js";

const candidate = { id: "cand_1", teamId: "team", leadId: "lead_1", customerId: "cust_1" };

const none = describeProspectOutreachSequence({ candidate });
assert.equal(none.progress, "none");
assert.equal(none.name, "");
assert.equal(none.stepName, "");
assert.equal(none.source, "none");
assert.equal(none.sourceId, "");
assert.equal(none.scheduledAt, "");

const running = describeProspectOutreachSequence({
  candidate,
  plans: [{
    id: "plan_1",
    teamId: "team",
    name: "泰国台秤客户开发",
    status: "running",
    updatedAt: "2026-10-04T08:00:00.000Z",
    items: [{
      candidateId: "cand_1",
      status: "ready",
      steps: [
        { status: "sent", subject: "第一封" },
        { status: "pending", subject: "第二次跟进" }
      ]
    }]
  }]
});
assert.equal(running.progress, "active");
assert.equal(running.statusLabel, "进行中");
assert.equal(running.name, "泰国台秤客户开发");
assert.equal(running.stepName, "第二次跟进");
assert.equal(running.source, "plan");
assert.equal(running.sourceId, "plan_1");
assert.doesNotMatch(JSON.stringify(running), /发送失败|已退信|无回复|无打开|已抑制/);

const paused = describeProspectOutreachSequence({
  candidate,
  plans: [{
    id: "plan_pause",
    teamId: "team",
    name: "已暂停方案",
    status: "paused",
    updatedAt: "2026-10-05T08:00:00.000Z",
    items: [{
      candidateId: "cand_1",
      status: "ready",
      steps: [{ status: "pending", subject: "还没发的第二封" }]
    }]
  }]
});
assert.equal(paused.progress, "stopped");
assert.equal(paused.statusLabel, "已暂停");

const stoppedItem = describeProspectOutreachSequence({
  candidate,
  plans: [{
    id: "plan_stop",
    teamId: "team",
    name: "回复即停",
    status: "running",
    updatedAt: "2026-10-05T09:00:00.000Z",
    items: [{
      candidateId: "cand_1",
      status: "stopped",
      steps: [{ status: "sent", subject: "已经发出" }]
    }]
  }]
});
assert.equal(stoppedItem.progress, "stopped");
assert.equal(stoppedItem.statusLabel, "已停止");

const failed = describeProspectOutreachSequence({
  candidate,
  batches: [{
    id: "batch_fail",
    teamId: "team",
    status: "approved",
    updatedAt: "2026-10-03T08:00:00.000Z",
    items: [{
      candidateId: "cand_1",
      status: "failed",
      steps: [{ status: "failed", subject: "报价跟进", error: "550 user unknown" }]
    }]
  }]
});
assert.equal(failed.progress, "stopped");
assert.equal(failed.statusLabel, "发送受阻");
assert.equal(failed.name, "");
assert.equal(failed.stepName, "报价跟进");
assert.equal(failed.source, "batch");
assert.doesNotMatch(JSON.stringify(failed), /550|user unknown|发送失败/);

const stepOnly = describeProspectOutreachSequence({
  candidate,
  batches: [{
    id: "batch_1",
    teamId: "team",
    status: "approved",
    updatedAt: "2026-10-02T08:00:00.000Z",
    items: [{
      candidateId: "cand_1",
      status: "sending",
      steps: [{ status: "sending", subject: `  ${"甲".repeat(60)}  ` }]
    }]
  }]
});
assert.equal(stepOnly.progress, "active");
assert.equal(stepOnly.name, "");
assert.equal(stepOnly.stepName, `${"甲".repeat(48)}…`);
assert.equal(stepOnly.source, "batch");

const failedStepsStillReady = describeProspectOutreachSequence({
  candidate,
  batches: [{
    id: "batch_step_failed",
    teamId: "team",
    status: "approved",
    updatedAt: "2026-10-02T02:00:00.000Z",
    items: [{
      candidateId: "cand_1",
      status: "ready",
      steps: [{ status: "failed", subject: "第一步失败", error: "mailbox rejected" }]
    }]
  }]
});
assert.equal(failedStepsStillReady.progress, "stopped");
assert.equal(failedStepsStillReady.statusLabel, "发送受阻");
assert.equal(failedStepsStillReady.stepName, "第一步失败");
assert.doesNotMatch(JSON.stringify(failedStepsStillReady), /mailbox rejected/);

const skipped = describeProspectOutreachSequence({
  candidate,
  plans: [{
    id: "plan_skip",
    teamId: "team",
    name: "不该出现",
    status: "running",
    items: [{ candidateId: "cand_1", status: "skipped", steps: [{ status: "pending", subject: "跳过" }] }]
  }],
  batches: [{
    id: "batch_draft",
    teamId: "team",
    status: "draft",
    items: [{ candidateId: "cand_1", status: "ready", steps: [{ status: "pending", subject: "草稿" }] }]
  }]
});
assert.equal(skipped.progress, "none");

const otherTeam = describeProspectOutreachSequence({
  candidate,
  plans: [{
    id: "plan_other",
    teamId: "other",
    name: "别的团队",
    status: "running",
    items: [{ candidateId: "cand_1", status: "sending", steps: [{ status: "sending", subject: "不该看见" }] }]
  }]
});
assert.equal(otherTeam.progress, "none");

const prefersActive = describeProspectOutreachSequence({
  candidate,
  plans: [{
    id: "plan_old",
    teamId: "team",
    name: "已经发完",
    status: "completed",
    updatedAt: "2026-10-06T08:00:00.000Z",
    items: [{ candidateId: "cand_1", status: "sent", steps: [{ status: "sent", subject: "结束" }] }]
  }],
  batches: [{
    id: "batch_now",
    teamId: "team",
    status: "approved",
    updatedAt: "2026-10-01T08:00:00.000Z",
    items: [{ candidateId: "cand_1", status: "ready", steps: [{ status: "pending", subject: "还在发" }] }]
  }]
});
assert.equal(prefersActive.progress, "active");
assert.equal(prefersActive.stepName, "还在发");
assert.equal(prefersActive.source, "batch");

const done = describeProspectOutreachSequence({
  candidate,
  plans: [{
    id: "plan_done",
    teamId: "team",
    name: "发完的方案",
    status: "completed",
    updatedAt: "2026-10-01T08:00:00.000Z",
    items: [{ candidateId: "cand_1", status: "sent", steps: [{ status: "sent", subject: "最后一封" }] }]
  }]
});
assert.equal(done.progress, "done");
assert.equal(done.statusLabel, "已完成");
assert.equal(done.name, "发完的方案");

const byLead = describeProspectOutreachSequence({
  candidate,
  sequences: [{
    id: "seq_lead",
    teamId: "team",
    entityType: "lead",
    entityId: "lead_1",
    channel: "email",
    status: "active",
    updatedAt: "2026-10-04T01:00:00.000Z",
    steps: [{ status: "pending", subject: "线索上的下一封" }]
  }]
});
assert.equal(byLead.progress, "active");
assert.equal(byLead.source, "sequence");
assert.equal(byLead.sourceId, "seq_lead");
assert.equal(byLead.stepName, "线索上的下一封");

const byLog = describeProspectOutreachSequence({
  candidate: { id: "cand_1", teamId: "team" },
  sequences: [{
    id: "seq_log",
    teamId: "team",
    entityType: "lead",
    entityId: "someone_else",
    channel: "email",
    status: "paused",
    updatedAt: "not-a-date",
    steps: [{ status: "pending", subject: "台账指向的序列" }]
  }],
  emailLogs: [{
    teamId: "team",
    entityType: "prospect_candidate",
    entityId: "cand_1",
    sequenceId: "seq_log"
  }]
});
assert.equal(byLog.progress, "stopped");
assert.equal(byLog.statusLabel, "已暂停");
assert.equal(byLog.updatedAt, "");
assert.equal(byLog.sourceId, "seq_log");

const whatsapp = describeProspectOutreachSequence({
  candidate,
  sequences: [{
    id: "seq_wa",
    teamId: "team",
    entityType: "customer",
    entityId: "cust_1",
    channel: "communication",
    status: "active",
    steps: [{ status: "pending", subject: "不展示即时沟通" }]
  }]
});
assert.equal(whatsapp.progress, "none");

const otherLead = describeProspectOutreachSequence({
  candidate,
  sequences: [{
    id: "seq_other",
    teamId: "team",
    entityType: "lead",
    entityId: "lead_other",
    channel: "email",
    status: "active",
    steps: [{ status: "pending", subject: "别人的线索" }]
  }]
});
assert.equal(otherLead.progress, "none");

const namedWinsTie = describeProspectOutreachSequence({
  candidate,
  plans: [{
    id: "plan_named",
    teamId: "team",
    name: "有名字的方案",
    status: "running",
    updatedAt: "2026-10-04T08:00:00.000Z",
    items: [{ candidateId: "cand_1", status: "sending", steps: [{ status: "sending", subject: "方案步骤" }] }]
  }],
  batches: [{
    id: "batch_same_time",
    teamId: "team",
    status: "approved",
    updatedAt: "2026-10-04T08:00:00.000Z",
    items: [{ candidateId: "cand_1", status: "sending", steps: [{ status: "sending", subject: "批次步骤" }] }]
  }]
});
assert.equal(namedWinsTie.name, "有名字的方案");
assert.equal(namedWinsTie.source, "plan");

const nextDue = describeProspectOutreachSequence({
  candidate,
  plans: [{
    id: "plan_due",
    teamId: "team",
    name: "有下一步",
    status: "running",
    updatedAt: "2026-10-01T00:00:00.000Z",
    items: [{
      candidateId: "cand_1",
      status: "ready",
      steps: [
        { status: "sent", subject: "第一封", scheduledAt: "2026-09-01T00:00:00.000Z" },
        { status: "pending", subject: "下一封", scheduledAt: "2026-10-20T08:30:00.000Z" },
        { status: "pending", subject: "更后", scheduledAt: "2026-12-01T00:00:00.000Z" }
      ]
    }]
  }]
});
assert.equal(nextDue.progress, "active");
assert.equal(nextDue.stepName, "下一封");
assert.equal(nextDue.scheduledAt, "2026-10-20T08:30:00.000Z");
assert.notEqual(nextDue.scheduledAt, nextDue.updatedAt);

const sendingWins = describeProspectOutreachSequence({
  candidate,
  batches: [{
    id: "batch_sending",
    teamId: "team",
    status: "approved",
    updatedAt: "2026-10-04T08:00:00.000Z",
    items: [{
      candidateId: "cand_1",
      status: "sending",
      steps: [
        { status: "pending", subject: "还在后面", scheduledAt: "2026-12-01T00:00:00.000Z" },
        { status: "sending", subject: "正在发", scheduledAt: "2026-10-02T00:00:00.000Z" }
      ]
    }]
  }]
});
assert.equal(sendingWins.scheduledAt, "2026-10-02T00:00:00.000Z");
assert.equal(sendingWins.stepName, "正在发");

const badDue = describeProspectOutreachSequence({
  candidate,
  plans: [{
    id: "plan_bad_due",
    teamId: "team",
    name: "时间不对",
    status: "running",
    updatedAt: "2026-10-08T00:00:00.000Z",
    items: [{
      candidateId: "cand_1",
      status: "ready",
      steps: [{ status: "sending", subject: "正在发但时间坏了", scheduledAt: "2026-10-20 08:30" }]
    }]
  }]
});
assert.equal(badDue.progress, "active");
assert.equal(badDue.scheduledAt, "");

const finished = describeProspectOutreachSequence({
  candidate,
  sequences: [{
    id: "seq_finished",
    teamId: "team",
    entityType: "lead",
    entityId: "lead_1",
    channel: "email",
    status: "completed",
    updatedAt: "2026-10-09T00:00:00.000Z",
    steps: [{ status: "sent", subject: "已经发完", scheduledAt: "2026-10-01T00:00:00.000Z" }]
  }]
});
assert.equal(finished.progress, "done");
assert.equal(finished.scheduledAt, "");

const sequenceDue = describeProspectOutreachSequence({
  candidate,
  sequences: [{
    id: "seq_due",
    teamId: "team",
    entityType: "lead",
    entityId: "lead_1",
    channel: "email",
    status: "active",
    updatedAt: "2026-10-01T00:00:00.000Z",
    steps: [{ status: "pending", subject: "线索下一封", scheduledAt: "2026-10-28T01:00:00.000Z" }]
  }]
});
assert.equal(sequenceDue.scheduledAt, "2026-10-28T01:00:00.000Z");
assert.equal(sequenceDue.updatedAt, "2026-10-01T00:00:00.000Z");

const source = readFileSync(new URL("./prospect-outreach-sequence.ts", import.meta.url), "utf8");
assert.match(source, /scheduledAt/);
assert.doesNotMatch(source, /nextRunAt|nextSendAt|nextExecutionAt/);
assert.match(source, /status === "running"/);
assert.match(source, /channel\) !== "email"/);
assert.doesNotMatch(source, /convert_to_lead|approved_contactable|controlOutreachSequence|send-development-email|createOutreachSequence/);

const serverSource = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
assert.match(serverSource, /from "\.\/prospect-outreach-sequence\.js"/);
assert.match(
  serverSource,
  /outreachSequence: describeProspectOutreachSequence\(/,
  "搜客清单接口必须带回外联序列进度"
);

console.log("prospect-outreach-sequence-test: ok");
