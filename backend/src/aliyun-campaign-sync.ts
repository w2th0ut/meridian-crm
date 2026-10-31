/**
 * 预测式外呼活动的只读同步。
 * 只调用 ListCampaigns 和 ListCases。不提供启动、恢复、提交或上传名单。
 * 开关默认关。关着时不请求云联络中心。
 * 由人点击触发，没有定时拉取。
 */

import { randomUUID } from "node:crypto";
import { canManageAliyunOutboundConfig, ALIYUN_CCC_REGION_IDS } from "./aliyun-outbound-config.js";
import { cccDirectoryFor, type CccCampaignSummary, type CccCaseSummary } from "./aliyun-ccc-directory.js";
import { decryptAliyunOutboundSecret } from "./credential-security.js";
import { maskOutboundNumber } from "./outbound-call.js";
import type { CrmStore } from "./store.js";
import type { AliyunCampaignSyncAudit, SessionUser } from "./types.js";

const PAGE_SIZE = 20;

function ready(store: CrmStore, teamId: string) {
  const current = store.aliyunOutboundConfigs.find((item) => item.teamId === teamId);
  if (!current) return { enabled: false, complete: false, instanceId: "", region: "" };
  const instanceId = current.instanceId.trim();
  const region = current.region.trim();
  let secrets = false;
  try {
    secrets = Boolean(decryptAliyunOutboundSecret(teamId, "accessKeyId", current.accessKeyIdEncrypted))
      && Boolean(decryptAliyunOutboundSecret(teamId, "accessKeySecret", current.accessKeySecretEncrypted));
  } catch {
    secrets = false;
  }
  const complete = Boolean(instanceId && (ALIYUN_CCC_REGION_IDS as readonly string[]).includes(region) && secrets);
  return { enabled: current.aliyunOutboundEnabled === true, complete, instanceId, region };
}

function readEnabled(store: CrmStore, teamId: string) {
  return store.aliyunCampaignReadSettings.find((item) => item.teamId === teamId)?.enabled === true;
}

async function audit(store: CrmStore, input: Omit<AliyunCampaignSyncAudit, "id" | "at">) {
  store.aliyunCampaignSyncAudits.unshift({
    id: `acsa_${randomUUID()}`,
    at: new Date().toISOString(),
    ...input
  });
  await store.persist();
}

function denied(status: number, reason: string, message: string) {
  return { status, body: { result: "rejected" as const, reason, message } };
}

export function readCampaignReadSetting(store: CrmStore, user: SessionUser | undefined) {
  if (!user?.id || !user.teamId) return denied(401, "forbidden", "未登录");
  if (!canManageAliyunOutboundConfig(user)) return denied(403, "forbidden", "只有管理员可以查看外呼任务");
  const snapshot = store.aliyunCampaignSnapshots.find((item) => item.teamId === user.teamId);
  let campaigns: unknown[] = [];
  if (snapshot?.payloadJson) {
    try {
      const parsed = JSON.parse(snapshot.payloadJson) as { campaigns?: unknown[] };
      campaigns = Array.isArray(parsed.campaigns) ? parsed.campaigns : [];
    } catch {
      campaigns = [];
    }
  }
  return {
    status: 200,
    body: {
      enabled: readEnabled(store, user.teamId),
      syncedAt: snapshot?.syncedAt || "",
      campaigns
    }
  };
}

export async function updateCampaignReadSetting(store: CrmStore, user: SessionUser | undefined, body: unknown) {
  if (!user?.id || !user.teamId) return denied(401, "forbidden", "未登录");
  if (!canManageAliyunOutboundConfig(user)) return denied(403, "forbidden", "只有管理员可以关闭或打开外呼任务同步");
  const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  if (!record || typeof record.enabled !== "boolean") return denied(400, "invalid_request", "参数格式错误");
  const current = store.aliyunCampaignReadSettings.find((item) => item.teamId === user.teamId);
  const next = {
    teamId: user.teamId,
    enabled: record.enabled,
    updatedBy: user.id,
    updatedAt: new Date().toISOString()
  };
  if (current) Object.assign(current, next);
  else store.aliyunCampaignReadSettings.unshift(next);
  await audit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: record.enabled ? "enable" : "disable",
    result: "allowed",
    reason: "",
    campaignCount: 0
  });
  return { status: 200, body: { result: "allowed" as const, enabled: record.enabled } };
}

function maskCase(item: CccCaseSummary) {
  return {
    caseId: item.caseId,
    state: item.state,
    attemptCount: item.attemptCount,
    failureReason: item.failureReason,
    maskedNumber: maskOutboundNumber(item.maskedNumber)
  };
}

function presentCampaign(campaign: CccCampaignSummary, cases: ReturnType<typeof maskCase>[], totalCount: number) {
  return {
    campaignId: campaign.campaignId,
    name: campaign.name,
    state: campaign.state,
    totalCases: campaign.totalCases,
    casesConnected: campaign.casesConnected,
    casesUncompleted: campaign.casesUncompleted,
    casesAborted: campaign.casesAborted,
    queueName: campaign.queueName,
    cases,
    casesTruncated: totalCount > cases.length
  };
}

export async function syncCampaignRoster(store: CrmStore, user: SessionUser | undefined) {
  if (!user?.id || !user.teamId) return denied(401, "forbidden", "未登录");
  if (!canManageAliyunOutboundConfig(user)) {
    await audit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "sync",
      result: "rejected",
      reason: "forbidden",
      campaignCount: 0
    });
    return denied(403, "forbidden", "只有管理员可以同步外呼任务");
  }
  const config = ready(store, user.teamId);
  if (!config.enabled) {
    await audit(store, { teamId: user.teamId, actorId: user.id, action: "sync", result: "rejected", reason: "disabled", campaignCount: 0 });
    return denied(403, "disabled", "外呼功能未开启");
  }
  if (!readEnabled(store, user.teamId)) {
    await audit(store, { teamId: user.teamId, actorId: user.id, action: "sync", result: "rejected", reason: "campaign_disabled", campaignCount: 0 });
    return denied(403, "campaign_disabled", "外呼任务只读同步未开启");
  }
  if (!config.complete) {
    await audit(store, { teamId: user.teamId, actorId: user.id, action: "sync", result: "rejected", reason: "config_incomplete", campaignCount: 0 });
    return denied(409, "config_incomplete", "阿里云外呼配置不完整");
  }
  try {
    const directory = cccDirectoryFor(config.region);
    const page = await directory.listCampaigns({ instanceId: config.instanceId, pageNumber: 1, pageSize: PAGE_SIZE });
    const campaigns = [];
    for (const campaign of page.campaigns) {
      const cases = await directory.listCases({
        instanceId: config.instanceId,
        campaignId: campaign.campaignId,
        pageNumber: 1,
        pageSize: PAGE_SIZE
      });
      campaigns.push(presentCampaign(campaign, cases.cases.map(maskCase), cases.totalCount));
    }
    const payload = { campaigns, truncated: page.totalCount > campaigns.length };
    const snapshot = {
      id: `acs_${randomUUID()}`,
      teamId: user.teamId,
      syncedAt: new Date().toISOString(),
      syncedBy: user.id,
      payloadJson: JSON.stringify(payload)
    };
    store.aliyunCampaignSnapshots = [
      snapshot,
      ...store.aliyunCampaignSnapshots.filter((item) => item.teamId !== user.teamId)
    ].slice(0, 20);
    await audit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "sync",
      result: "allowed",
      reason: "",
      campaignCount: campaigns.length
    });
    return { status: 200, body: { result: "allowed" as const, ...payload, syncedAt: snapshot.syncedAt } };
  } catch {
    await audit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "sync",
      result: "rejected",
      reason: "sync_failed",
      campaignCount: 0
    });
    return denied(502, "sync_failed", "没有读到云联络中心的外呼任务");
  }
}
