/**
 * 话机服务编排
 *
 * 外呼 → 状态推进 → 录音落盘 → 转写 → 自动分类/打标 → 人工补结论
 * 以及周期回访策略的下发（到期即按条件挑客户生成呼叫任务）。
 */
import { randomBytes } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { classifyCall, CALL_CATEGORIES } from "./classifier.js";
import { getProvider, simulatorHints, type PlaceCallInput, type TelephonyProvider } from "./provider.js";
import { getTelephonyStore, type TelephonyStore } from "./store.js";
import type {
  CallRecord,
  CallbackStrategy,
  CallSegment,
  CallStatus,
  StrategyRunLog,
  TelephonySettings,
  TelephonySnapshot,
  VoiceProfile
} from "./types.js";

const ANONYMOUS_PHONE = /^\+?[0-9][0-9\-\s()]{5,24}$/;

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
}

export function normalizePhone(value: string): string {
  return String(value || "").replace(/[\s\-()]/g, "").trim();
}

export function isCallableNumber(value: string): boolean {
  return ANONYMOUS_PHONE.test(String(value || "").trim()) && normalizePhone(value).replace(/\D/g, "").length >= 6;
}

export function uploadsRoot(): string {
  return path.resolve(process.env.KEDUODUO_UPLOADS_DIR?.trim() || path.resolve(process.cwd(), "uploads"));
}

function telephonyDir(): string {
  return path.join(uploadsRoot(), "telephony");
}

async function ensureTelephonyDir(): Promise<string> {
  const dir = telephonyDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

export interface PlaceCallRequest {
  toNumber: string;
  customerId?: string;
  customerName?: string;
  voiceProfileId?: string;
  script?: string;
  ownerId: string;
  teamId: string;
  dealId?: string;
  leadId?: string;
  strategyId?: string;
  strategyRound?: number;
}

export interface TelephonyServiceOptions {
  store?: TelephonyStore;
  now?: () => number;
}

export class TelephonyService {
  constructor(private readonly options: TelephonyServiceOptions = {}) {}

  private async store(): Promise<TelephonyStore> {
    return this.options.store || getTelephonyStore();
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  async settings(): Promise<TelephonySettings> {
    return (await this.store()).readSettings();
  }

  async saveSettings(patch: Partial<TelephonySettings>, actorId: string): Promise<TelephonySettings> {
    const store = await this.store();
    const current = await store.readSettings();
    const next: TelephonySettings = {
      ...current,
      ...patch,
      // 凭证只做"覆盖式"更新：传空字符串表示清除
      aliyunAccessKeyId: patch.aliyunAccessKeyId ?? current.aliyunAccessKeyId,
      aliyunAccessKeySecret: patch.aliyunAccessKeySecret ?? current.aliyunAccessKeySecret,
      updatedAt: new Date(this.now()).toISOString(),
      updatedBy: actorId
    };
    // 没有实例号就不可能是阿里云模式
    if (next.provider === "aliyun" && !(next.aliyunAccessKeyId && next.aliyunAccessKeySecret && next.aliyunCccInstanceId)) {
      next.provider = "simulator";
    }
    await store.writeSettings(next);
    return next;
  }

  /** 对外只暴露"是否已配置"，绝不回显密钥 */
  publicSettings(settings: TelephonySettings) {
    return {
      ...settings,
      aliyunAccessKeyId: "",
      aliyunAccessKeySecret: "",
      credentialsConfigured: Boolean(settings.aliyunAccessKeyId && settings.aliyunAccessKeySecret),
      categoryOptions: CALL_CATEGORIES
    };
  }

  async provider(settings?: TelephonySettings): Promise<TelephonyProvider> {
    return getProvider(settings || await this.settings());
  }

  async health() {
    const settings = await this.settings();
    const provider = await this.provider(settings);
    const result = await provider.health();
    return { ...result, provider: provider.kind, store: (await this.store()).kind };
  }

  /* ── 声音配置 ───────────────────────────────────── */
  async listVoiceProfiles(): Promise<VoiceProfile[]> {
    return (await this.store()).listVoiceProfiles();
  }

  async saveVoiceProfile(input: Partial<VoiceProfile> & { id?: string }, actor: { id: string; teamId: string }): Promise<VoiceProfile> {
    const store = await this.store();
    const now = new Date(this.now()).toISOString();
    const existing = input.id ? (await store.listVoiceProfiles()).find((item) => item.id === input.id) : undefined;
    const profile: VoiceProfile = {
      id: existing?.id || input.id || newId("voice"),
      name: String(input.name || existing?.name || "未命名声音").slice(0, 120),
      ownerId: String(input.ownerId ?? existing?.ownerId ?? ""),
      teamId: String(input.teamId || existing?.teamId || actor.teamId),
      ttsVoice: String(input.ttsVoice ?? existing?.ttsVoice ?? "xiaoyun"),
      speechRate: clampNumber(input.speechRate ?? existing?.speechRate, -500, 500, 0),
      volume: clampNumber(input.volume ?? existing?.volume, 0, 100, 50),
      pitchRate: clampNumber(input.pitchRate ?? existing?.pitchRate, -500, 500, 0),
      backgroundAudio: String(input.backgroundAudio ?? existing?.backgroundAudio ?? ""),
      greeting: String(input.greeting ?? existing?.greeting ?? ""),
      closing: String(input.closing ?? existing?.closing ?? ""),
      isDefault: Boolean(input.isDefault ?? existing?.isDefault ?? false),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    // 默认声音全团队唯一
    if (profile.isDefault) {
      for (const other of await store.listVoiceProfiles()) {
        if (other.id !== profile.id && other.isDefault && other.teamId === profile.teamId) {
          await store.saveVoiceProfile({ ...other, isDefault: false, updatedAt: now });
        }
      }
    }
    await store.saveVoiceProfile(profile);
    return profile;
  }

  async deleteVoiceProfile(id: string): Promise<void> {
    await (await this.store()).deleteVoiceProfile(id);
  }

  /** 解析本次外呼该用哪套声音：指定 > 话务员本人默认 > 团队默认 */
  async resolveVoiceProfile(voiceProfileId: string, ownerId: string): Promise<VoiceProfile | null> {
    const profiles = await this.listVoiceProfiles();
    if (voiceProfileId) {
      const hit = profiles.find((item) => item.id === voiceProfileId);
      if (hit) return hit;
    }
    const own = profiles.find((item) => item.isDefault && item.ownerId === ownerId);
    if (own) return own;
    const shared = profiles.find((item) => item.isDefault && !item.ownerId);
    if (shared) return shared;
    return profiles.find((item) => !item.ownerId) || profiles[0] || null;
  }

  /* ── 外呼 ──────────────────────────────────────── */
  async placeCall(request: PlaceCallRequest): Promise<CallRecord> {
    const toNumber = normalizePhone(request.toNumber);
    if (!isCallableNumber(toNumber)) throw new Error("被叫号码格式不正确");
    const store = await this.store();
    const settings = await this.settings();
    const voice = await this.resolveVoiceProfile(String(request.voiceProfileId || ""), request.ownerId);
    const script = String(request.script || voice?.greeting || "").slice(0, 2000);
    const provider = await this.provider(settings);
    const now = new Date(this.now()).toISOString();

    const input: PlaceCallInput = {
      toNumber,
      fromNumber: settings.aliyunCallerNumber,
      customerName: request.customerName || "",
      voice,
      script,
      round: request.strategyRound
    };
    const placed = await provider.placeCall(input);

    const record: CallRecord = {
      id: newId("call"),
      provider: provider.kind,
      direction: "outbound",
      status: placed.status,
      providerCallId: placed.providerCallId,
      ownerId: request.ownerId,
      teamId: request.teamId,
      customerId: String(request.customerId || ""),
      customerName: String(request.customerName || ""),
      toNumber,
      fromNumber: settings.aliyunCallerNumber || "",
      voiceProfileId: voice?.id || "",
      script,
      dealId: String(request.dealId || ""),
      leadId: String(request.leadId || ""),
      strategyId: String(request.strategyId || ""),
      strategyRound: Number(request.strategyRound || 0),
      startedAt: placed.startedAt || now,
      connectedAt: placed.connectedAt || "",
      endedAt: placed.endedAt || "",
      durationSec: placed.durationSec || 0,
      recordingUrl: "",
      recordingBytes: 0,
      transcriptSource: placed.transcriptSource || "none",
      transcript: placed.transcript || [],
      category: "",
      categoryScore: 0,
      summary: "",
      tags: [],
      outcome: "",
      failureReason: placed.failureReason || "",
      createdAt: now,
      updatedAt: now
    };
    await store.saveCall(record);
    // 模拟器：立刻把对话结果转写落库（真实云要等同步）
    if (record.transcript.length) await this.finalizeCall(record, input);
    return (await store.getCall(record.id)) || record;
  }

  /** 拉取一次状态；完成时触发录音落盘 + 分类 */
  async syncCall(id: string): Promise<CallRecord | null> {
    const store = await this.store();
    const record = await store.getCall(id);
    if (!record) return null;
    if (["completed", "no_answer", "busy", "failed", "cancelled"].includes(record.status)) return record;

    const settings = await this.settings();
    const provider = await this.provider(settings);
    const remote = await provider.fetchCall(record.providerCallId);
    if (!remote) return record;

    const patched: CallRecord = {
      ...record,
      status: remote.status,
      connectedAt: remote.connectedAt || record.connectedAt,
      endedAt: remote.endedAt || record.endedAt,
      durationSec: remote.durationSec || record.durationSec,
      failureReason: remote.failureReason || record.failureReason,
      transcript: remote.transcript.length ? remote.transcript : record.transcript,
      transcriptSource: remote.transcript.length ? remote.transcriptSource : record.transcriptSource,
      updatedAt: new Date(this.now()).toISOString()
    };
    await store.saveCall(patched);

    if (["completed", "no_answer", "busy", "failed"].includes(patched.status)) {
      const voice = patched.voiceProfileId
        ? (await this.listVoiceProfiles()).find((item) => item.id === patched.voiceProfileId) || null
        : null;
      return this.finalizeCall(patched, {
        toNumber: patched.toNumber,
        fromNumber: patched.fromNumber,
        customerName: patched.customerName,
        voice,
        script: patched.script,
        round: patched.strategyRound
      }, remote);
    }
    return patched;
  }

  /** 结束态收尾：录音写入 /uploads/telephony，转写 + 自动分类 + 自动标签 */
  private async finalizeCall(record: CallRecord, input: PlaceCallInput, remote?: Awaited<ReturnType<TelephonyProvider["fetchCall"]>>): Promise<CallRecord> {
    const store = await this.store();
    const settings = await this.settings();
    const provider = await this.provider(settings);
    let recordingUrl = record.recordingUrl;
    let recordingBytes = record.recordingBytes;

    if (settings.recordingEnabled && record.status === "completed" && record.providerCallId) {
      try {
        const buffer = await provider.downloadRecording({
          providerCallId: record.providerCallId,
          status: record.status,
          startedAt: record.startedAt,
          connectedAt: record.connectedAt,
          endedAt: record.endedAt,
          durationSec: record.durationSec,
          failureReason: record.failureReason,
          recordingUrl: remote?.recordingUrl || "",
          transcript: record.transcript,
          transcriptSource: record.transcriptSource
        }, input);
        if (buffer.length) {
          const dir = await ensureTelephonyDir();
          const fileName = `${record.id}.wav`;
          await writeFile(path.join(dir, fileName), buffer);
          recordingUrl = `/uploads/telephony/${fileName}`;
          recordingBytes = buffer.length;
        }
      } catch (error) {
        console.error(`话机录音保存失败 ${record.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const hint = simulatorHints(record.providerCallId);
    const classification = classifyCall(record.transcript, {
      category: hint?.category,
      outcome: hint?.outcome
    });
    const autoTags = classification.tags.map((label) => ({ label, source: "auto" as const, at: new Date(this.now()).toISOString(), by: "system" }));
    const manualTags = (record.tags || []).filter((tag) => tag.source === "manual");

    const finished: CallRecord = {
      ...record,
      recordingUrl,
      recordingBytes,
      category: record.category || classification.category,
      categoryScore: record.categoryScore || classification.score,
      summary: record.summary || classification.summary,
      tags: [...manualTags, ...autoTags],
      outcome: record.outcome || hint?.outcome || "",
      updatedAt: new Date(this.now()).toISOString()
    };
    await store.saveCall(finished);
    return finished;
  }

  async listCalls(filter: { ownerId?: string; teamId?: string; limit?: number }): Promise<CallRecord[]> {
    return (await this.store()).listCalls(filter);
  }

  async getCall(id: string): Promise<CallRecord | null> {
    return (await this.store()).getCall(id);
  }

  async updateCall(id: string, patch: { outcome?: string; category?: string; transcript?: CallSegment[] }, actorId: string): Promise<CallRecord> {
    const store = await this.store();
    const record = await store.getCall(id);
    if (!record) throw new Error("通话记录不存在");
    const now = new Date(this.now()).toISOString();
    const next: CallRecord = {
      ...record,
      outcome: patch.outcome !== undefined ? String(patch.outcome).slice(0, 2000) : record.outcome,
      category: patch.category ? String(patch.category).slice(0, 80) : record.category,
      transcript: Array.isArray(patch.transcript) && patch.transcript.length ? patch.transcript : record.transcript,
      transcriptSource: Array.isArray(patch.transcript) && patch.transcript.length ? "manual" : record.transcriptSource,
      updatedAt: now
    };
    // 人工改过分类后，不再让自动分类覆盖
    if (patch.category) next.categoryScore = 1;
    if (Array.isArray(patch.transcript) && patch.transcript.length) {
      const reclassified = classifyCall(next.transcript);
      if (!patch.category) {
        next.category = reclassified.category;
        next.categoryScore = reclassified.score;
        next.summary = reclassified.summary;
      }
    }
    await store.saveCall(next);
    return next;
  }

  async addTag(id: string, label: string, actorId: string): Promise<CallRecord> {
    const store = await this.store();
    const record = await store.getCall(id);
    if (!record) throw new Error("通话记录不存在");
    const clean = String(label || "").trim().slice(0, 40);
    if (!clean) throw new Error("标签不能为空");
    if ((record.tags || []).some((tag) => tag.label === clean)) return record;
    const next: CallRecord = {
      ...record,
      tags: [...(record.tags || []), { label: clean, source: "manual", at: new Date(this.now()).toISOString(), by: actorId }],
      updatedAt: new Date(this.now()).toISOString()
    };
    await store.saveCall(next);
    return next;
  }

  async removeTag(id: string, label: string): Promise<CallRecord> {
    const store = await this.store();
    const record = await store.getCall(id);
    if (!record) throw new Error("通话记录不存在");
    const next: CallRecord = {
      ...record,
      tags: (record.tags || []).filter((tag) => tag.label !== label),
      updatedAt: new Date(this.now()).toISOString()
    };
    await store.saveCall(next);
    return next;
  }

  async deleteCall(id: string): Promise<void> {
    const store = await this.store();
    const record = await store.getCall(id);
    if (record?.recordingUrl) {
      const fileName = path.basename(record.recordingUrl);
      await rm(path.join(telephonyDir(), fileName), { force: true }).catch(() => undefined);
    }
    await store.deleteCall(id);
  }

  /* ── 回访策略 ───────────────────────────────────── */
  async listStrategies(): Promise<CallbackStrategy[]> {
    return (await this.store()).listStrategies();
  }

  async saveStrategy(input: Partial<CallbackStrategy> & { id?: string }, actor: { id: string; teamId: string }): Promise<CallbackStrategy> {
    const store = await this.store();
    const existing = input.id ? await store.getStrategy(input.id) : null;
    const now = new Date(this.now());
    const cadence = (input.cadenceDays ?? existing?.cadenceDays ?? [3, 7, 15])
      .map((day) => Math.max(1, Math.min(365, Math.round(Number(day)))))
      .filter((day, index, all) => Number.isFinite(day) && all.indexOf(day) === index)
      .sort((left, right) => left - right);
    const maxRounds = clampNumber(input.maxRounds ?? existing?.maxRounds, 1, 24, cadence.length);
    const strategy: CallbackStrategy = {
      id: existing?.id || input.id || newId("strategy"),
      name: String(input.name || existing?.name || "未命名回访策略").slice(0, 160),
      teamId: String(input.teamId || existing?.teamId || actor.teamId),
      ownerId: String(input.ownerId ?? existing?.ownerId ?? ""),
      cadenceDays: cadence.length ? cadence : [3, 7, 15],
      maxRounds: Math.min(maxRounds, cadence.length || 1),
      target: {
        grades: normalizeList(input.target?.grades ?? existing?.target?.grades),
        countries: normalizeList(input.target?.countries ?? existing?.target?.countries),
        categories: normalizeList(input.target?.categories ?? existing?.target?.categories),
        tags: normalizeList(input.target?.tags ?? existing?.target?.tags),
        idleDays: clampNumber(input.target?.idleDays ?? existing?.target?.idleDays, 0, 3650, 0),
        limit: clampNumber(input.target?.limit ?? existing?.target?.limit, 1, 200, 20)
      },
      voiceProfileId: String(input.voiceProfileId ?? existing?.voiceProfileId ?? ""),
      script: String(input.script ?? existing?.script ?? "").slice(0, 2000),
      enabled: Boolean(input.enabled ?? existing?.enabled ?? true),
      nextRunAt: String(input.nextRunAt || existing?.nextRunAt || new Date(now.getTime() + 60_000).toISOString()),
      lastRunAt: existing?.lastRunAt || "",
      generatedCount: existing?.generatedCount || 0,
      createdAt: existing?.createdAt || now.toISOString(),
      updatedAt: now.toISOString()
    };
    await store.saveStrategy(strategy);
    return strategy;
  }

  async deleteStrategy(id: string): Promise<void> {
    await (await this.store()).deleteStrategy(id);
  }

  async listRuns(strategyId?: string): Promise<StrategyRunLog[]> {
    return (await this.store()).listRuns(strategyId);
  }

  /**
   * 下发一轮回访：按条件挑客户，生成 queued 呼叫任务。
   * `customers` 由调用方传入（服务层不直接依赖主 Store），便于测试与复用。
   */
  async dispatchStrategy(
    strategyId: string,
    customers: Array<{ id: string; company: string; country?: string; grade?: string; phone?: string; whatsapp?: string }>,
    options: { force?: boolean; actorId?: string } = {}
  ): Promise<{ dispatched: number; skipped: string; callIds: string[]; round: number }> {
    const store = await this.store();
    const strategy = await store.getStrategy(strategyId);
    if (!strategy) throw new Error("回访策略不存在");
    const nowMs = this.now();
    if (!options.force && strategy.nextRunAt && new Date(strategy.nextRunAt).getTime() > nowMs) {
      return { dispatched: 0, skipped: "未到下发时间", callIds: [], round: 0 };
    }

    const history = await store.listCalls({ teamId: strategy.teamId, limit: 500 });
    const lastCallByCustomer = new Map<string, CallRecord>();
    for (const call of history) {
      if (!call.customerId) continue;
      const current = lastCallByCustomer.get(call.customerId);
      if (!current || (call.startedAt || call.createdAt) > (current.startedAt || current.createdAt)) {
        lastCallByCustomer.set(call.customerId, call);
      }
    }

    const candidateRound = (call: CallRecord | undefined) => (call?.strategyRound || 0) + 1;
    const skippedReasons: string[] = [];
    const picked: Array<{ customer: typeof customers[number]; round: number }> = [];

    for (const customer of customers) {
      if (picked.length >= strategy.target.limit) break;
      if (strategy.target.grades.length && !strategy.target.grades.includes(String(customer.grade || ""))) continue;
      if (strategy.target.countries.length
        && !strategy.target.countries.some((keyword) => String(customer.country || "").toLowerCase().includes(keyword.toLowerCase()))) continue;

      const last = lastCallByCustomer.get(customer.id);
      if (last) {
        if (strategy.target.categories.length && !strategy.target.categories.includes(last.category)) continue;
        if (strategy.target.tags.length && !strategy.target.tags.some((tag) => (last.tags || []).some((item) => item.label === tag))) continue;
        if (strategy.target.idleDays > 0) {
          const lastTs = new Date(last.endedAt || last.startedAt || last.createdAt).getTime();
          if (Number.isFinite(lastTs) && nowMs - lastTs < strategy.target.idleDays * 86_400_000) continue;
        }
        // 已在回访中（还有未完成的呼叫任务）就跳过，避免重复下发
        if (["queued", "dialing", "connected"].includes(last.status)) {
          skippedReasons.push(`${customer.company}：已有进行中的呼叫`);
          continue;
        }
      }

      const round = candidateRound(last);
      // 轮次节奏：第 N 轮需距上次通话达到 cadenceDays[N-1] 天
      if (last && round <= strategy.maxRounds) {
        const requiredDays = strategy.cadenceDays[Math.min(round - 1, strategy.cadenceDays.length - 1)];
        const lastTs = new Date(last.endedAt || last.startedAt || last.createdAt).getTime();
        if (Number.isFinite(lastTs) && nowMs - lastTs < requiredDays * 86_400_000) {
          const daysLeft = Math.ceil((requiredDays * 86_400_000 - (nowMs - lastTs)) / 86_400_000);
          skippedReasons.push(`${customer.company}：未到回访节奏（第 ${round} 轮还需 ${daysLeft} 天）`);
          continue;
        }
      }
      if (round > strategy.maxRounds) {
        skippedReasons.push(`${customer.company}：已完成 ${strategy.maxRounds} 轮回访`);
        continue;
      }

      const phone = normalizePhone(customer.phone || customer.whatsapp || "");
      if (!isCallableNumber(phone)) {
        skippedReasons.push(`${customer.company}：没有可拨号码`);
        continue;
      }
      picked.push({ customer, round });
    }

    const callIds: string[] = [];
    for (const item of picked) {
      try {
        const call = await this.placeCall({
          toNumber: customerPhone(item.customer),
          customerId: item.customer.id,
          customerName: item.customer.company,
          voiceProfileId: strategy.voiceProfileId,
          script: strategy.script,
          ownerId: strategy.ownerId || options.actorId || (await this.settings()).updatedBy || "",
          teamId: strategy.teamId,
          strategyId: strategy.id,
          strategyRound: item.round
        });
        callIds.push(call.id);
      } catch (error) {
        skippedReasons.push(`${item.customer.company}：${error instanceof Error ? error.message : "外呼失败"}`);
      }
    }

    const nextCadenceIndex = Math.min(picked.length ? Math.max(...picked.map((item) => item.round)) : 1, strategy.cadenceDays.length) - 1;
    const nextDelayDays = strategy.cadenceDays[nextCadenceIndex] ?? strategy.cadenceDays[strategy.cadenceDays.length - 1] ?? 3;
    const nextRunAt = new Date(nowMs + nextDelayDays * 86_400_000).toISOString();

    await store.saveStrategy({
      ...strategy,
      lastRunAt: new Date(nowMs).toISOString(),
      nextRunAt,
      generatedCount: strategy.generatedCount + callIds.length,
      updatedAt: new Date(nowMs).toISOString()
    });
    await store.appendRun({
      id: newId("run"),
      strategyId: strategy.id,
      at: new Date(nowMs).toISOString(),
      dispatched: callIds.length,
      skipped: skippedReasons.slice(0, 8).join("；").slice(0, 500),
      callIds,
      round: picked.length ? Math.max(...picked.map((item) => item.round)) : 0
    });

    return {
      dispatched: callIds.length,
      skipped: skippedReasons.slice(0, 8).join("；"),
      callIds,
      round: picked.length ? Math.max(...picked.map((item) => item.round)) : 0
    };
  }

  /** 定时器：把所有到期的策略各下发一轮 */
  async tickStrategies(customers: Array<{ id: string; company: string; country?: string; grade?: string; phone?: string; whatsapp?: string }>): Promise<number> {
    const store = await this.store();
    const nowMs = this.now();
    let dispatched = 0;
    for (const strategy of await store.listStrategies()) {
      if (!strategy.enabled) continue;
      if (strategy.nextRunAt && new Date(strategy.nextRunAt).getTime() > nowMs) continue;
      try {
        const result = await this.dispatchStrategy(strategy.id, customers, { force: false });
        dispatched += result.dispatched;
      } catch (error) {
        console.error(`回访策略下发失败 ${strategy.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return dispatched;
  }

  /** 清理超期录音文件 */
  async pruneRecordings(): Promise<number> {
    const settings = await this.settings();
    if (!settings.recordingRetentionDays || settings.recordingRetentionDays <= 0) return 0;
    const dir = telephonyDir();
    let removed = 0;
    let files: string[] = [];
    try { files = await readdir(dir); } catch { return 0; }
    const deadline = this.now() - settings.recordingRetentionDays * 86_400_000;
    for (const file of files) {
      const full = path.join(dir, file);
      try {
        const info = await stat(full);
        if (info.mtimeMs < deadline) {
          await rm(full, { force: true });
          removed += 1;
        }
      } catch { /* 忽略单个文件错误 */ }
    }
    return removed;
  }

  async snapshot(filter: { ownerId?: string; teamId?: string; limit?: number } = {}): Promise<TelephonySnapshot & { settingsView: ReturnType<TelephonyService["publicSettings"]> }> {
    const snapshot = await (await this.store()).snapshot(filter);
    return { ...snapshot, settingsView: this.publicSettings(snapshot.settings) };
  }
}

function customerPhone(customer: { phone?: string; whatsapp?: string }): string {
  return normalizePhone(customer.phone || customer.whatsapp || "");
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 20);
  if (typeof value === "string") {
    return value.split(/[,，\n]/u).map((item) => item.trim()).filter(Boolean).slice(0, 20);
  }
  return [];
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export const telephonyService = new TelephonyService();
