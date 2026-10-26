/**
 * 话机 CRM REST 路由
 *
 * GET    /api/telephony/snapshot            工作台一次性快照（配置/声音/通话/策略/下发记录）
 * GET    /api/telephony/health              提供方自检（阿里云 / 模拟器）
 * PUT    /api/telephony/settings            保存阿里云凭证与外呼设置（密钥只写不读）
 * GET    /api/telephony/voices              声音配置列表
 * POST   /api/telephony/voices              新建/更新声音配置
 * DELETE /api/telephony/voices/:id
 * POST   /api/telephony/calls               发起外呼
 * GET    /api/telephony/calls               通话记录（按可见范围）
 * GET    /api/telephony/calls/:id           单条通话
 * POST   /api/telephony/calls/:id/sync      拉取最新状态（接通/结束/录音）
 * PATCH  /api/telephony/calls/:id           人工改结论/分类/转写
 * POST   /api/telephony/calls/:id/tags      打标签
 * DELETE /api/telephony/calls/:id/tags/:tag 去标签
 * DELETE /api/telephony/calls/:id
 * GET    /api/telephony/strategies          回访策略
 * POST   /api/telephony/strategies          新建/更新策略
 * DELETE /api/telephony/strategies/:id
 * POST   /api/telephony/strategies/:id/dispatch  立即下发一轮
 * GET    /api/telephony/runs                下发记录
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { telephonyService } from "./service.js";
import type { TelephonySettings } from "./types.js";

export interface TelephonyRouterDeps {
  /** 取当前可见客户（用于策略挑人），由主服务注入 */
  listCustomers: (request: Request) => Promise<Array<{ id: string; company: string; country?: string; grade?: string; phone?: string; whatsapp?: string }>>;
  requireAuth: (request: Request, response: Response, next: () => void) => unknown;
  currentUser: (request: Request) => { id: string; role: string; teamId: string } | null;
}

const settingsSchema = z.object({
  provider: z.enum(["aliyun", "simulator"]).optional(),
  aliyunAccessKeyId: z.string().max(200).optional(),
  aliyunAccessKeySecret: z.string().max(400).optional(),
  aliyunCccInstanceId: z.string().max(120).optional(),
  aliyunSkillGroupId: z.string().max(120).optional(),
  aliyunCallerNumber: z.string().max(40).optional(),
  aliyunRegionId: z.string().max(60).optional(),
  recordingEnabled: z.boolean().optional(),
  recordingRetentionDays: z.number().int().min(0).max(3650).optional()
});

const voiceSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().min(1).max(120),
  ownerId: z.string().max(64).optional(),
  ttsVoice: z.string().max(80).optional(),
  speechRate: z.number().int().min(-500).max(500).optional(),
  volume: z.number().int().min(0).max(100).optional(),
  pitchRate: z.number().int().min(-500).max(500).optional(),
  backgroundAudio: z.string().max(80).optional(),
  greeting: z.string().max(2000).optional(),
  closing: z.string().max(2000).optional(),
  isDefault: z.boolean().optional()
});

const callSchema = z.object({
  toNumber: z.string().min(3).max(40),
  customerId: z.string().max(64).optional(),
  customerName: z.string().max(200).optional(),
  voiceProfileId: z.string().max(64).optional(),
  script: z.string().max(2000).optional(),
  dealId: z.string().max(64).optional(),
  leadId: z.string().max(64).optional()
});

const strategySchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().min(1).max(160),
  ownerId: z.string().max(64).optional(),
  cadenceDays: z.array(z.number().int().min(1).max(365)).max(12).optional(),
  maxRounds: z.number().int().min(1).max(24).optional(),
  target: z.object({
    grades: z.array(z.string().max(20)).max(10).optional(),
    countries: z.array(z.string().max(60)).max(20).optional(),
    categories: z.array(z.string().max(60)).max(20).optional(),
    tags: z.array(z.string().max(40)).max(20).optional(),
    idleDays: z.number().int().min(0).max(3650).optional(),
    limit: z.number().int().min(1).max(200).optional()
  }).partial().optional(),
  voiceProfileId: z.string().max(64).optional(),
  script: z.string().max(2000).optional(),
  enabled: z.boolean().optional(),
  nextRunAt: z.string().max(40).optional()
});

function asyncRoute(handler: (request: Request, response: Response) => Promise<unknown>) {
  return (request: Request, response: Response, next: (error?: unknown) => void) => {
    handler(request, response).catch(next);
  };
}

export function createTelephonyRouter(deps: TelephonyRouterDeps): Router {
  const router = Router();
  router.use(deps.requireAuth as never);

  const actor = (request: Request) => {
    const user = deps.currentUser(request);
    if (!user) throw new Error("未登录");
    return user;
  };

  /** 通话可见范围：super_admin/admin/manager 看全团队，业务员只看本人 */
  const scope = (request: Request) => {
    const user = actor(request);
    const wide = ["admin", "super_admin", "manager"].includes(user.role);
    return wide ? { teamId: user.teamId } : { ownerId: user.id, teamId: user.teamId };
  };

  router.get("/health", asyncRoute(async (_request, response) => {
    response.json(await telephonyService.health());
  }));

  router.get("/snapshot", asyncRoute(async (request, response) => {
    actor(request);
    const snapshot = await telephonyService.snapshot({ ...scope(request), limit: 200 });
    response.json(snapshot);
  }));

  router.put("/settings", asyncRoute(async (request, response) => {
    const user = actor(request);
    if (!["admin", "super_admin", "manager"].includes(user.role)) {
      response.status(403).json({ message: "只有管理员可以修改话机配置" });
      return;
    }
    const patch = settingsSchema.parse(request.body ?? {}) as Partial<TelephonySettings>;
    const settings = await telephonyService.saveSettings(patch, user.id);
    response.json(telephonyService.publicSettings(settings));
  }));

  router.get("/voices", asyncRoute(async (request, response) => {
    actor(request);
    response.json({ voices: await telephonyService.listVoiceProfiles() });
  }));

  router.post("/voices", asyncRoute(async (request, response) => {
    const user = actor(request);
    const input = voiceSchema.parse(request.body ?? {});
    const profile = await telephonyService.saveVoiceProfile(input, { id: user.id, teamId: user.teamId });
    response.json({ voice: profile });
  }));

  router.delete("/voices/:id", asyncRoute(async (request, response) => {
    actor(request);
    await telephonyService.deleteVoiceProfile(request.params.id);
    response.json({ ok: true });
  }));

  router.get("/contacts", asyncRoute(async (request, response) => {
    actor(request);
    response.json({ contacts: await telephonyService.listContacts({ ...scope(request), limit: 500 }) });
  }));

  router.get("/calls", asyncRoute(async (request, response) => {
    const calls = await telephonyService.listCalls({ ...scope(request), limit: Number(request.query.limit || 100) });
    response.json({ calls });
  }));

  router.get("/calls/:id", asyncRoute(async (request, response) => {
    const call = await telephonyService.getCall(request.params.id);
    if (!call) {
      response.status(404).json({ message: "通话记录不存在" });
      return;
    }
    actor(request);
    response.json({ call });
  }));

  router.post("/calls", asyncRoute(async (request, response) => {
    const user = actor(request);
    const input = callSchema.parse(request.body ?? {});
    const call = await telephonyService.placeCall({
      ...input,
      ownerId: user.id,
      teamId: user.teamId
    });
    response.status(201).json({ call });
  }));

  router.post("/calls/:id/sync", asyncRoute(async (request, response) => {
    actor(request);
    const call = await telephonyService.syncCall(request.params.id);
    if (!call) {
      response.status(404).json({ message: "通话记录不存在" });
      return;
    }
    response.json({ call });
  }));

  router.patch("/calls/:id", asyncRoute(async (request, response) => {
    const user = actor(request);
    const body = z.object({
      outcome: z.string().max(2000).optional(),
      category: z.string().max(80).optional(),
      transcript: z.array(z.object({
        seq: z.number().int().min(1),
        speaker: z.enum(["agent", "customer"]),
        startSec: z.number().min(0),
        endSec: z.number().min(0),
        text: z.string().max(4000)
      })).max(500).optional()
    }).parse(request.body ?? {});
    const call = await telephonyService.updateCall(request.params.id, body, user.id);
    response.json({ call });
  }));

  router.post("/calls/:id/tags", asyncRoute(async (request, response) => {
    const user = actor(request);
    const body = z.object({ label: z.string().min(1).max(40) }).parse(request.body ?? {});
    const call = await telephonyService.addTag(request.params.id, body.label, user.id);
    response.json({ call });
  }));

  router.delete("/calls/:id/tags/:label", asyncRoute(async (request, response) => {
    actor(request);
    const call = await telephonyService.removeTag(request.params.id, decodeURIComponent(request.params.label));
    response.json({ call });
  }));

  router.delete("/calls/:id", asyncRoute(async (request, response) => {
    actor(request);
    await telephonyService.deleteCall(request.params.id);
    response.json({ ok: true });
  }));

  router.get("/strategies", asyncRoute(async (request, response) => {
    actor(request);
    response.json({
      strategies: await telephonyService.listStrategies(),
      runs: await telephonyService.listRuns()
    });
  }));

  router.post("/strategies", asyncRoute(async (request, response) => {
    const user = actor(request);
    const input = strategySchema.parse(request.body ?? {});
    const strategy = await telephonyService.saveStrategy(input as Parameters<typeof telephonyService.saveStrategy>[0], { id: user.id, teamId: user.teamId });
    response.json({ strategy });
  }));

  router.delete("/strategies/:id", asyncRoute(async (request, response) => {
    actor(request);
    await telephonyService.deleteStrategy(request.params.id);
    response.json({ ok: true });
  }));

  router.post("/strategies/:id/dispatch", asyncRoute(async (request, response) => {
    const user = actor(request);
    const customers = await deps.listCustomers(request);
    const result = await telephonyService.dispatchStrategy(request.params.id, customers, { force: true, actorId: user.id });
    response.json(result);
  }));

  router.get("/runs", asyncRoute(async (request, response) => {
    actor(request);
    const strategyId = typeof request.query.strategyId === "string" ? request.query.strategyId : undefined;
    response.json({ runs: await telephonyService.listRuns(strategyId) });
  }));

  return router;
}
