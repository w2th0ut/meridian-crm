/**
 * 云联络中心 2020-07-01 的只读与工作台转发。
 *
 * 传输由调用方注入。默认传输直接拒绝，不访问 aliyuncs.com。
 * 官方 3.x 工作台写明服务端用 AK/SK 或 OAuth2 转发。OAuth2 地址和 scope 待核实。
 * STS 临时凭证的签发端点待核实。这里不下发 AccessKey。
 */

import { CCC_MAKE_CALL_VERSION, cccPublicEndpoint, type CccRpcRequest } from "./aliyun-ccc-make-call.js";

export const CCC_LIST_USERS_ACTION = "ListUsers" as const;
export const CCC_LIST_CAMPAIGNS_ACTION = "ListCampaigns" as const;
export const CCC_LIST_CASES_ACTION = "ListCases" as const;

export interface CccSeat {
  userId: string;
  loginName: string;
  displayName: string;
  extension: string;
  workMode: string;
  roleId: string;
}

export interface CccCampaignSummary {
  campaignId: string;
  name: string;
  state: string;
  totalCases: number | null;
  casesConnected: number | null;
  casesUncompleted: number | null;
  casesAborted: number | null;
  queueName: string;
}

export interface CccCaseSummary {
  caseId: string;
  state: string;
  attemptCount: number | null;
  failureReason: string;
  maskedNumber: string;
}

export interface CccDirectory {
  listUsers(input: { instanceId: string; pageNumber: number; pageSize: number }): Promise<{
    seats: CccSeat[];
    pageNumber: number;
    pageSize: number;
    totalCount: number;
  }>;
  listCampaigns(input: { instanceId: string; pageNumber: number; pageSize: number }): Promise<{
    campaigns: CccCampaignSummary[];
    pageNumber: number;
    pageSize: number;
    totalCount: number;
  }>;
  listCases(input: { instanceId: string; campaignId: string; pageNumber: number; pageSize: number }): Promise<{
    cases: CccCaseSummary[];
    pageNumber: number;
    pageSize: number;
    totalCount: number;
  }>;
  invoke(action: string, params: Record<string, string | number>): Promise<unknown>;
}

let directoryOverride: CccDirectory | undefined;

export function setCccDirectoryForTests(directory: CccDirectory | undefined) {
  directoryOverride = directory;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readData(body: unknown) {
  const record = asRecord(body);
  if (!record) throw new Error("云联络中心响应无效");
  if (typeof record.Code === "string" && record.Code && record.Code !== "OK") {
    throw new Error("云联络中心响应未成功");
  }
  const data = asRecord(record.Data);
  if (!data) throw new Error("云联络中心响应没有数据");
  return data;
}

function readList(body: unknown) {
  const data = readData(body);
  const list = Array.isArray(data.List) ? data.List : [];
  return {
    rows: list.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item)),
    pageNumber: numberOrNull(data.PageNumber) || 0,
    pageSize: numberOrNull(data.PageSize) || 0,
    totalCount: numberOrNull(data.TotalCount) || 0
  };
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function readCccSeats(body: unknown): CccSeat[] {
  return readList(body).rows.flatMap((row) => {
    const userId = text(row.UserId);
    if (!userId) return [];
    return [{
      userId,
      loginName: text(row.LoginName),
      displayName: text(row.DisplayName),
      extension: text(row.Extension),
      workMode: text(row.WorkMode),
      roleId: text(row.RoleId)
    }];
  });
}

/**
 * 活动字段按 ListCampaigns 返回表读取。
 * CompletionRate 已废弃，且公式写成 CasesUnCompleted，和返回字段 CasesUncompleted 拼写不一致，待核实。这里不计算完成率。
 * TotalCount 是否只在第一页有值，该页没写，待核实。本同步只取第一页。
 */
export function readCccCampaigns(body: unknown): CccCampaignSummary[] {
  return readList(body).rows.flatMap((row) => {
    const campaignId = text(row.CampaignId);
    if (!campaignId) return [];
    return [{
      campaignId,
      name: text(row.Name),
      state: text(row.State),
      totalCases: numberOrNull(row.TotalCases),
      casesConnected: numberOrNull(row.CasesConnected),
      casesUncompleted: numberOrNull(row.CasesUncompleted),
      casesAborted: numberOrNull(row.CasesAborted),
      queueName: text(row.QueueName)
    }];
  });
}

/** ListCases 请求枚举有 Forbidden，返回枚举没有。未知状态原样保留，待核实。不回传 CustomVariables。 */
export function readCccCases(body: unknown, mask: (value: string) => string): CccCaseSummary[] {
  return readList(body).rows.flatMap((row) => {
    const caseId = text(row.CaseId);
    if (!caseId) return [];
    return [{
      caseId,
      state: text(row.State),
      attemptCount: numberOrNull(row.AttemptCount),
      failureReason: text(row.FailureReason),
      maskedNumber: mask(text(row.PhoneNumber))
    }];
  });
}

export function createAliyunCccDirectory(options: {
  region: string;
  transport: (request: CccRpcRequest) => Promise<unknown>;
}): CccDirectory {
  const host = cccPublicEndpoint(options.region);
  if (!host) throw new Error("地域不在云联络中心已列出的接入点中");
  const call = async (action: string, params: Record<string, string | number>) => options.transport({
    action,
    version: CCC_MAKE_CALL_VERSION,
    host,
    params
  });
  return {
    async listUsers(input) {
      const body = await call(CCC_LIST_USERS_ACTION, {
        InstanceId: input.instanceId,
        PageNumber: input.pageNumber,
        PageSize: input.pageSize
      });
      const page = readList(body);
      return { seats: readCccSeats(body), pageNumber: page.pageNumber, pageSize: page.pageSize, totalCount: page.totalCount };
    },
    async listCampaigns(input) {
      const body = await call(CCC_LIST_CAMPAIGNS_ACTION, {
        InstanceId: input.instanceId,
        PageNumber: input.pageNumber,
        PageSize: input.pageSize
      });
      const page = readList(body);
      return { campaigns: readCccCampaigns(body), pageNumber: page.pageNumber, pageSize: page.pageSize, totalCount: page.totalCount };
    },
    async listCases(input) {
      const body = await call(CCC_LIST_CASES_ACTION, {
        InstanceId: input.instanceId,
        CampaignId: input.campaignId,
        PageNumber: input.pageNumber,
        PageSize: input.pageSize
      });
      const page = readList(body);
      return {
        cases: readCccCases(body, (value) => value),
        pageNumber: page.pageNumber,
        pageSize: page.pageSize,
        totalCount: page.totalCount
      };
    },
    invoke(action, params) {
      return call(action, params);
    }
  };
}

export function cccDirectoryFor(region: string) {
  if (directoryOverride) return directoryOverride;
  return createAliyunCccDirectory({
    region,
    transport: async () => {
      throw new Error("云联络中心传输未注入");
    }
  });
}

/** 官方 PageNumber、PageSize 都是 1–100。超过 100 页仍没找到的坐席不接受手填，待核实是否还要继续翻。 */
export async function collectCccSeats(directory: CccDirectory, instanceId: string) {
  const seats: CccSeat[] = [];
  const pageSize = 100;
  for (let pageNumber = 1; pageNumber <= 100; pageNumber += 1) {
    const page = await directory.listUsers({ instanceId, pageNumber, pageSize });
    seats.push(...page.seats);
    if (page.seats.length < pageSize) break;
    if (page.totalCount > 0 && seats.length >= page.totalCount) break;
  }
  const seen = new Set<string>();
  return seats.filter((seat) => {
    if (seen.has(seat.userId)) return false;
    seen.add(seat.userId);
    return true;
  });
}
