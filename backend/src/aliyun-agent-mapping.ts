import { randomUUID } from "node:crypto";
import { canManageAliyunOutboundConfig } from "./aliyun-outbound-config.js";
import { ALIYUN_CCC_REGION_IDS } from "./aliyun-outbound-config.js";
import { cccDirectoryFor, collectCccSeats, type CccSeat } from "./aliyun-ccc-directory.js";
import { decryptAliyunOutboundSecret } from "./credential-security.js";
import type { CrmStore } from "./store.js";
import type { AgentMappingAudit, AliyunAgentMapping, SessionUser } from "./types.js";

const USER_ID_PATTERN = /^[A-Za-z0-9_@.:-]{1,128}$/;

export interface AgentMappingResult {
  status: number;
  body: Record<string, unknown>;
}

function clip(value: string, max: number) {
  return value.trim().slice(0, max);
}

function configReady(store: CrmStore, teamId: string) {
  const current = store.aliyunOutboundConfigs.find((item) => item.teamId === teamId);
  if (!current) return null;
  const instanceId = current.instanceId.trim();
  const region = current.region.trim();
  if (!instanceId || !(ALIYUN_CCC_REGION_IDS as readonly string[]).includes(region)) return null;
  try {
    if (!decryptAliyunOutboundSecret(teamId, "accessKeyId", current.accessKeyIdEncrypted)) return null;
    if (!decryptAliyunOutboundSecret(teamId, "accessKeySecret", current.accessKeySecretEncrypted)) return null;
  } catch {
    return null;
  }
  return { instanceId, region };
}

function presentMapping(item: AliyunAgentMapping) {
  return {
    id: item.id,
    crmUserId: item.crmUserId,
    cccUserId: item.cccUserId,
    loginName: item.loginName,
    displayName: item.displayName,
    extension: item.extension,
    workMode: item.workMode,
    updatedAt: item.updatedAt
  };
}

function presentSeat(seat: CccSeat) {
  return {
    userId: seat.userId,
    loginName: seat.loginName,
    displayName: seat.displayName,
    extension: seat.extension,
    workMode: seat.workMode,
    roleId: seat.roleId
  };
}

async function audit(store: CrmStore, input: Omit<AgentMappingAudit, "id" | "at">) {
  store.agentMappingAudits.unshift({
    id: `ama_${randomUUID()}`,
    at: new Date().toISOString(),
    ...input
  });
  await store.persist();
}

function denied(status: number, reason: string, message: string): AgentMappingResult {
  return { status, body: { result: "rejected", reason, message } };
}

export function listAgentMappings(store: CrmStore, user: SessionUser | undefined): AgentMappingResult {
  if (!user?.id || !user.teamId) return denied(401, "forbidden", "未登录");
  if (!canManageAliyunOutboundConfig(user)) return denied(403, "forbidden", "只有管理员可以维护坐席映射");
  const users = store.users
    .filter((item) => item.teamId === user.teamId && item.status === "active")
    .map((item) => ({ id: item.id, name: item.name, role: item.role }));
  return {
    status: 200,
    body: {
      mappings: store.aliyunAgentMappings.filter((item) => item.teamId === user.teamId).map(presentMapping),
      users
    }
  };
}

export async function listAgentDirectory(store: CrmStore, user: SessionUser | undefined): Promise<AgentMappingResult> {
  if (!user?.id || !user.teamId) return denied(401, "forbidden", "未登录");
  if (!canManageAliyunOutboundConfig(user)) return denied(403, "forbidden", "只有管理员可以读取坐席");
  const ready = configReady(store, user.teamId);
  if (!ready) return denied(409, "config_incomplete", "阿里云外呼配置不完整");
  try {
    const seats = await collectCccSeats(cccDirectoryFor(ready.region), ready.instanceId);
    return { status: 200, body: { seats: seats.map(presentSeat) } };
  } catch {
    return denied(502, "directory_failed", "没有读到云联络中心坐席");
  }
}

function parsePair(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const crmUserId = typeof record.crmUserId === "string" ? record.crmUserId.trim() : "";
  const cccUserId = typeof record.cccUserId === "string" ? record.cccUserId.trim() : "";
  if (!crmUserId || crmUserId.length > 64 || !USER_ID_PATTERN.test(cccUserId)) return null;
  return { crmUserId, cccUserId };
}

async function seatFromDirectory(store: CrmStore, teamId: string, cccUserId: string) {
  const ready = configReady(store, teamId);
  if (!ready) return { error: "config_incomplete" as const, seat: null };
  try {
    const seats = await collectCccSeats(cccDirectoryFor(ready.region), ready.instanceId);
    const seat = seats.find((item) => item.userId === cccUserId) || null;
    if (!seat) return { error: "not_in_directory" as const, seat: null };
    return { error: null, seat };
  } catch {
    return { error: "directory_failed" as const, seat: null };
  }
}

function conflict(store: CrmStore, teamId: string, crmUserId: string, cccUserId: string, exceptId: string) {
  return store.aliyunAgentMappings.find((item) =>
    item.teamId === teamId
    && item.id !== exceptId
    && (item.crmUserId === crmUserId || item.cccUserId === cccUserId)
  );
}

export async function createAgentMapping(store: CrmStore, user: SessionUser | undefined, body: unknown): Promise<AgentMappingResult> {
  if (!user?.id || !user.teamId) return denied(401, "forbidden", "未登录");
  const parsed = parsePair(body);
  if (!canManageAliyunOutboundConfig(user)) {
    await audit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "create",
      crmUserId: parsed?.crmUserId || "",
      cccUserId: parsed?.cccUserId || "",
      result: "rejected",
      reason: "forbidden"
    });
    return denied(403, "forbidden", "只有管理员可以维护坐席映射");
  }
  if (!parsed) {
    await audit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "create",
      crmUserId: "",
      cccUserId: "",
      result: "rejected",
      reason: "invalid_request"
    });
    return denied(400, "invalid_request", "参数格式错误");
  }
  const crmUser = store.users.find((item) => item.id === parsed.crmUserId && item.teamId === user.teamId && item.status === "active");
  if (!crmUser) {
    await audit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "create",
      crmUserId: parsed.crmUserId,
      cccUserId: parsed.cccUserId,
      result: "rejected",
      reason: "not_found"
    });
    return denied(404, "not_found", "用户不存在");
  }
  if (conflict(store, user.teamId, parsed.crmUserId, parsed.cccUserId, "")) {
    await audit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "create",
      crmUserId: parsed.crmUserId,
      cccUserId: parsed.cccUserId,
      result: "rejected",
      reason: "conflict"
    });
    return denied(409, "conflict", "同一租户内一个坐席只能对应一个用户");
  }
  const lookedUp = await seatFromDirectory(store, user.teamId, parsed.cccUserId);
  if (lookedUp.error || !lookedUp.seat) {
    const reason = lookedUp.error || "not_in_directory";
    await audit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "create",
      crmUserId: parsed.crmUserId,
      cccUserId: parsed.cccUserId,
      result: "rejected",
      reason
    });
    const status = reason === "config_incomplete" ? 409 : reason === "directory_failed" ? 502 : 409;
    const message = reason === "config_incomplete"
      ? "阿里云外呼配置不完整"
      : reason === "directory_failed"
        ? "没有读到云联络中心坐席"
        : "坐席不在云联络中心返回的列表里";
    return denied(status, reason, message);
  }
  const mapping: AliyunAgentMapping = {
    id: `aam_${randomUUID()}`,
    teamId: user.teamId,
    crmUserId: parsed.crmUserId,
    cccUserId: lookedUp.seat.userId,
    loginName: clip(lookedUp.seat.loginName, 128),
    displayName: clip(lookedUp.seat.displayName, 128),
    extension: clip(lookedUp.seat.extension, 64),
    workMode: clip(lookedUp.seat.workMode, 32),
    updatedBy: user.id,
    updatedAt: new Date().toISOString()
  };
  store.aliyunAgentMappings.unshift(mapping);
  await audit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "create",
    crmUserId: mapping.crmUserId,
    cccUserId: mapping.cccUserId,
    result: "allowed",
    reason: ""
  });
  return { status: 200, body: { result: "allowed", mapping: presentMapping(mapping) } };
}

export async function updateAgentMapping(store: CrmStore, user: SessionUser | undefined, mappingId: string, body: unknown): Promise<AgentMappingResult> {
  if (!user?.id || !user.teamId) return denied(401, "forbidden", "未登录");
  const parsed = parsePair(body);
  const current = store.aliyunAgentMappings.find((item) => item.id === mappingId && item.teamId === user.teamId);
  if (!canManageAliyunOutboundConfig(user)) {
    await audit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "update",
      crmUserId: parsed?.crmUserId || current?.crmUserId || "",
      cccUserId: parsed?.cccUserId || current?.cccUserId || "",
      result: "rejected",
      reason: "forbidden"
    });
    return denied(403, "forbidden", "只有管理员可以维护坐席映射");
  }
  if (!parsed) {
    await audit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "update",
      crmUserId: "",
      cccUserId: "",
      result: "rejected",
      reason: "invalid_request"
    });
    return denied(400, "invalid_request", "参数格式错误");
  }
  if (!current) {
    await audit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "update",
      crmUserId: parsed.crmUserId,
      cccUserId: parsed.cccUserId,
      result: "rejected",
      reason: "not_found"
    });
    return denied(404, "not_found", "坐席映射不存在");
  }
  const crmUser = store.users.find((item) => item.id === parsed.crmUserId && item.teamId === user.teamId && item.status === "active");
  if (!crmUser || conflict(store, user.teamId, parsed.crmUserId, parsed.cccUserId, current.id)) {
    const reason = crmUser ? "conflict" : "not_found";
    await audit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "update",
      crmUserId: parsed.crmUserId,
      cccUserId: parsed.cccUserId,
      result: "rejected",
      reason
    });
    return denied(reason === "conflict" ? 409 : 404, reason, reason === "conflict" ? "同一租户内一个坐席只能对应一个用户" : "用户不存在");
  }
  const lookedUp = await seatFromDirectory(store, user.teamId, parsed.cccUserId);
  if (lookedUp.error || !lookedUp.seat) {
    const reason = lookedUp.error || "not_in_directory";
    await audit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "update",
      crmUserId: parsed.crmUserId,
      cccUserId: parsed.cccUserId,
      result: "rejected",
      reason
    });
    return denied(reason === "directory_failed" ? 502 : 409, reason, "坐席不在云联络中心返回的列表里");
  }
  current.crmUserId = parsed.crmUserId;
  current.cccUserId = lookedUp.seat.userId;
  current.loginName = clip(lookedUp.seat.loginName, 128);
  current.displayName = clip(lookedUp.seat.displayName, 128);
  current.extension = clip(lookedUp.seat.extension, 64);
  current.workMode = clip(lookedUp.seat.workMode, 32);
  current.updatedBy = user.id;
  current.updatedAt = new Date().toISOString();
  await audit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "update",
    crmUserId: current.crmUserId,
    cccUserId: current.cccUserId,
    result: "allowed",
    reason: ""
  });
  return { status: 200, body: { result: "allowed", mapping: presentMapping(current) } };
}

export async function deleteAgentMapping(store: CrmStore, user: SessionUser | undefined, mappingId: string): Promise<AgentMappingResult> {
  if (!user?.id || !user.teamId) return denied(401, "forbidden", "未登录");
  const current = store.aliyunAgentMappings.find((item) => item.id === mappingId && item.teamId === user.teamId);
  if (!canManageAliyunOutboundConfig(user)) {
    await audit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "delete",
      crmUserId: current?.crmUserId || "",
      cccUserId: current?.cccUserId || "",
      result: "rejected",
      reason: "forbidden"
    });
    return denied(403, "forbidden", "只有管理员可以维护坐席映射");
  }
  if (!current) {
    await audit(store, {
      teamId: user.teamId,
      actorId: user.id,
      action: "delete",
      crmUserId: "",
      cccUserId: "",
      result: "rejected",
      reason: "not_found"
    });
    return denied(404, "not_found", "坐席映射不存在");
  }
  store.aliyunAgentMappings = store.aliyunAgentMappings.filter((item) => item.id !== current.id);
  await audit(store, {
    teamId: user.teamId,
    actorId: user.id,
    action: "delete",
    crmUserId: current.crmUserId,
    cccUserId: current.cccUserId,
    result: "allowed",
    reason: ""
  });
  return { status: 200, body: { result: "allowed", mapping: presentMapping(current) } };
}
