/**
 * 话机 CRM · 存储层
 *
 * 独立于主 Store：自带 MySQL 表；未配置 MySQL（本地开发 / E2E）时退化为进程内存，
 * 这样"无云凭证、无数据库"也能把外呼 → 录音 → 转写 → 打标 → 分类 → 周期回访整条链路跑通。
 */
import mysql from "mysql2/promise";
import type {
  CallRecord,
  CallbackStrategy,
  StrategyRunLog,
  TelephonySettings,
  TelephonySnapshot,
  VoiceProfile
} from "./types.js";

const SETTINGS_ROW_ID = "default";

export function defaultTelephonySettings(): TelephonySettings {
  return {
    provider: "simulator",
    aliyunAccessKeyId: "",
    aliyunAccessKeySecret: "",
    aliyunCccInstanceId: "",
    aliyunSkillGroupId: "",
    aliyunCallerNumber: "",
    aliyunRegionId: "cn-hangzhou",
    recordingEnabled: true,
    recordingRetentionDays: 90,
    updatedAt: new Date().toISOString(),
    updatedBy: ""
  };
}

export interface TelephonyStore {
  readonly kind: "mysql" | "memory";
  init(): Promise<void>;
  readSettings(): Promise<TelephonySettings>;
  writeSettings(value: TelephonySettings): Promise<void>;
  listVoiceProfiles(): Promise<VoiceProfile[]>;
  saveVoiceProfile(profile: VoiceProfile): Promise<void>;
  deleteVoiceProfile(id: string): Promise<void>;
  listCalls(filter?: { ownerId?: string; teamId?: string; limit?: number }): Promise<CallRecord[]>;
  getCall(id: string): Promise<CallRecord | null>;
  saveCall(record: CallRecord): Promise<void>;
  deleteCall(id: string): Promise<void>;
  listStrategies(): Promise<CallbackStrategy[]>;
  getStrategy(id: string): Promise<CallbackStrategy | null>;
  saveStrategy(strategy: CallbackStrategy): Promise<void>;
  deleteStrategy(id: string): Promise<void>;
  listRuns(strategyId?: string): Promise<StrategyRunLog[]>;
  appendRun(run: StrategyRunLog): Promise<void>;
  snapshot(filter?: { ownerId?: string; teamId?: string; limit?: number }): Promise<TelephonySnapshot>;
}

function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

function iso(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

const numberOr = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/* ── 内存实现（开发 / E2E） ─────────────────────────── */
export class MemoryTelephonyStore implements TelephonyStore {
  readonly kind = "memory" as const;
  private settings: TelephonySettings = defaultTelephonySettings();
  private voices = new Map<string, VoiceProfile>();
  private calls = new Map<string, CallRecord>();
  private strategies = new Map<string, CallbackStrategy>();
  private runs: StrategyRunLog[] = [];

  async init(): Promise<void> {}

  async readSettings() { return { ...this.settings }; }
  async writeSettings(value: TelephonySettings) { this.settings = { ...value }; }

  async listVoiceProfiles() {
    return [...this.voices.values()].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
  }
  async saveVoiceProfile(profile: VoiceProfile) { this.voices.set(profile.id, { ...profile }); }
  async deleteVoiceProfile(id: string) { this.voices.delete(id); }

  async listCalls(filter: { ownerId?: string; teamId?: string; limit?: number } = {}) {
    let rows = [...this.calls.values()];
    if (filter.ownerId) rows = rows.filter((row) => row.ownerId === filter.ownerId);
    if (filter.teamId) rows = rows.filter((row) => row.teamId === filter.teamId);
    rows.sort((a, b) => (b.startedAt || b.createdAt).localeCompare(a.startedAt || a.createdAt));
    return filter.limit ? rows.slice(0, filter.limit) : rows;
  }
  async getCall(id: string) { return this.calls.get(id) ? { ...this.calls.get(id)! } : null; }
  async saveCall(record: CallRecord) { this.calls.set(record.id, { ...record }); }
  async deleteCall(id: string) { this.calls.delete(id); }

  async listStrategies() { return [...this.strategies.values()]; }
  async getStrategy(id: string) { return this.strategies.get(id) ? { ...this.strategies.get(id)! } : null; }
  async saveStrategy(strategy: CallbackStrategy) { this.strategies.set(strategy.id, { ...strategy }); }
  async deleteStrategy(id: string) { this.strategies.delete(id); }

  async listRuns(strategyId?: string) {
    const rows = strategyId ? this.runs.filter((run) => run.strategyId === strategyId) : this.runs;
    return rows.slice().sort((a, b) => b.at.localeCompare(a.at));
  }
  async appendRun(run: StrategyRunLog) { this.runs.push({ ...run }); }

  async snapshot(filter: { ownerId?: string; teamId?: string; limit?: number } = {}): Promise<TelephonySnapshot> {
    return {
      settings: await this.readSettings(),
      voiceProfiles: await this.listVoiceProfiles(),
      calls: await this.listCalls(filter),
      strategies: await this.listStrategies(),
      runs: (await this.listRuns()).slice(0, 50)
    };
  }
}

/* ── MySQL 实现 ────────────────────────────────────── */
export class MysqlTelephonyStore implements TelephonyStore {
  readonly kind = "mysql" as const;
  private pool: mysql.Pool;

  constructor(databaseUrl: string) {
    this.pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4, namedPlaceholders: true });
  }

  async init(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS telephony_settings (
      id VARCHAR(32) PRIMARY KEY,
      payload JSON,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS telephony_voice_profiles (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(120) NOT NULL DEFAULT '',
      owner_id VARCHAR(64) NOT NULL DEFAULT '',
      team_id VARCHAR(64) NOT NULL DEFAULT '',
      tts_voice VARCHAR(80) NOT NULL DEFAULT '',
      speech_rate INT NOT NULL DEFAULT 0,
      volume INT NOT NULL DEFAULT 50,
      pitch_rate INT NOT NULL DEFAULT 0,
      background_audio VARCHAR(80) NOT NULL DEFAULT '',
      greeting TEXT,
      closing TEXT,
      is_default TINYINT NOT NULL DEFAULT 0,
      created_at VARCHAR(40) NOT NULL DEFAULT '',
      updated_at VARCHAR(40) NOT NULL DEFAULT '',
      INDEX idx_tvp_owner(owner_id)
    )`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS telephony_calls (
      id VARCHAR(64) PRIMARY KEY,
      provider VARCHAR(20) NOT NULL DEFAULT 'simulator',
      direction VARCHAR(20) NOT NULL DEFAULT 'outbound',
      status VARCHAR(20) NOT NULL DEFAULT 'queued',
      provider_call_id VARCHAR(120) NOT NULL DEFAULT '',
      owner_id VARCHAR(64) NOT NULL DEFAULT '',
      team_id VARCHAR(64) NOT NULL DEFAULT '',
      customer_id VARCHAR(64) NOT NULL DEFAULT '',
      customer_name VARCHAR(200) NOT NULL DEFAULT '',
      to_number VARCHAR(40) NOT NULL DEFAULT '',
      from_number VARCHAR(40) NOT NULL DEFAULT '',
      voice_profile_id VARCHAR(64) NOT NULL DEFAULT '',
      script TEXT,
      deal_id VARCHAR(64) NOT NULL DEFAULT '',
      lead_id VARCHAR(64) NOT NULL DEFAULT '',
      strategy_id VARCHAR(64) NOT NULL DEFAULT '',
      strategy_round INT NOT NULL DEFAULT 0,
      started_at VARCHAR(40) NOT NULL DEFAULT '',
      connected_at VARCHAR(40) NOT NULL DEFAULT '',
      ended_at VARCHAR(40) NOT NULL DEFAULT '',
      duration_sec INT NOT NULL DEFAULT 0,
      recording_url VARCHAR(512) NOT NULL DEFAULT '',
      recording_bytes INT NOT NULL DEFAULT 0,
      transcript_source VARCHAR(20) NOT NULL DEFAULT 'none',
      transcript JSON,
      category VARCHAR(80) NOT NULL DEFAULT '',
      category_score DECIMAL(4,3) NOT NULL DEFAULT 0,
      summary TEXT,
      tags JSON,
      outcome TEXT,
      failure_reason VARCHAR(500) NOT NULL DEFAULT '',
      created_at VARCHAR(40) NOT NULL DEFAULT '',
      updated_at VARCHAR(40) NOT NULL DEFAULT '',
      INDEX idx_tc_owner(owner_id),
      INDEX idx_tc_team(team_id),
      INDEX idx_tc_status(status),
      INDEX idx_tc_customer(customer_id)
    )`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS telephony_strategies (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(160) NOT NULL DEFAULT '',
      team_id VARCHAR(64) NOT NULL DEFAULT '',
      owner_id VARCHAR(64) NOT NULL DEFAULT '',
      cadence_days JSON,
      max_rounds INT NOT NULL DEFAULT 1,
      target JSON,
      voice_profile_id VARCHAR(64) NOT NULL DEFAULT '',
      script TEXT,
      enabled TINYINT NOT NULL DEFAULT 1,
      next_run_at VARCHAR(40) NOT NULL DEFAULT '',
      last_run_at VARCHAR(40) NOT NULL DEFAULT '',
      generated_count INT NOT NULL DEFAULT 0,
      created_at VARCHAR(40) NOT NULL DEFAULT '',
      updated_at VARCHAR(40) NOT NULL DEFAULT '',
      INDEX idx_ts_team(team_id),
      INDEX idx_ts_next(next_run_at)
    )`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS telephony_strategy_runs (
      id VARCHAR(64) PRIMARY KEY,
      strategy_id VARCHAR(64) NOT NULL,
      at VARCHAR(40) NOT NULL DEFAULT '',
      dispatched INT NOT NULL DEFAULT 0,
      skipped VARCHAR(500) NOT NULL DEFAULT '',
      call_ids JSON,
      round INT NOT NULL DEFAULT 0,
      INDEX idx_tsr_strategy(strategy_id)
    )`);
  }

  async readSettings(): Promise<TelephonySettings> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT payload FROM telephony_settings WHERE id = ? LIMIT 1",
      [SETTINGS_ROW_ID]
    );
    if (!rows.length) return defaultTelephonySettings();
    return { ...defaultTelephonySettings(), ...json<Partial<TelephonySettings>>(rows[0].payload, {}) };
  }

  async writeSettings(value: TelephonySettings): Promise<void> {
    await this.pool.query(
      `INSERT INTO telephony_settings (id, payload, updated_at) VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = NOW()`,
      [SETTINGS_ROW_ID, JSON.stringify(value)]
    );
  }

  async listVoiceProfiles(): Promise<VoiceProfile[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM telephony_voice_profiles ORDER BY is_default DESC, name ASC"
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name || "",
      ownerId: row.owner_id || "",
      teamId: row.team_id || "",
      ttsVoice: row.tts_voice || "",
      speechRate: numberOr(row.speech_rate),
      volume: numberOr(row.volume, 50),
      pitchRate: numberOr(row.pitch_rate),
      backgroundAudio: row.background_audio || "",
      greeting: row.greeting || "",
      closing: row.closing || "",
      isDefault: Boolean(row.is_default),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at)
    }));
  }

  async saveVoiceProfile(profile: VoiceProfile): Promise<void> {
    await this.pool.query(
      `INSERT INTO telephony_voice_profiles
        (id,name,owner_id,team_id,tts_voice,speech_rate,volume,pitch_rate,background_audio,greeting,closing,is_default,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
        name=VALUES(name), owner_id=VALUES(owner_id), team_id=VALUES(team_id), tts_voice=VALUES(tts_voice),
        speech_rate=VALUES(speech_rate), volume=VALUES(volume), pitch_rate=VALUES(pitch_rate),
        background_audio=VALUES(background_audio), greeting=VALUES(greeting), closing=VALUES(closing),
        is_default=VALUES(is_default), updated_at=VALUES(updated_at)`,
      [
        profile.id, profile.name, profile.ownerId, profile.teamId, profile.ttsVoice,
        profile.speechRate, profile.volume, profile.pitchRate, profile.backgroundAudio,
        profile.greeting, profile.closing, profile.isDefault ? 1 : 0,
        profile.createdAt, profile.updatedAt
      ]
    );
  }

  async deleteVoiceProfile(id: string): Promise<void> {
    await this.pool.query("DELETE FROM telephony_voice_profiles WHERE id = ?", [id]);
    await this.pool.query("UPDATE telephony_voice_profiles SET is_default = 0 WHERE id = ?", [id]);
  }

  async listCalls(filter: { ownerId?: string; teamId?: string; limit?: number } = {}): Promise<CallRecord[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.ownerId) { where.push("owner_id = ?"); params.push(filter.ownerId); }
    if (filter.teamId) { where.push("team_id = ?"); params.push(filter.teamId); }
    const limit = filter.limit && filter.limit > 0 ? Math.min(filter.limit, 500) : 200;
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      `SELECT * FROM telephony_calls ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY started_at DESC LIMIT ${limit}`,
      params
    );
    return rows.map((row) => this.mapCall(row));
  }

  async getCall(id: string): Promise<CallRecord | null> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM telephony_calls WHERE id = ? LIMIT 1", [id]);
    return rows.length ? this.mapCall(rows[0]) : null;
  }

  private mapCall(row: mysql.RowDataPacket): CallRecord {
    return {
      id: row.id,
      provider: (row.provider || "simulator") as CallRecord["provider"],
      direction: (row.direction || "outbound") as CallRecord["direction"],
      status: (row.status || "queued") as CallRecord["status"],
      providerCallId: row.provider_call_id || "",
      ownerId: row.owner_id || "",
      teamId: row.team_id || "",
      customerId: row.customer_id || "",
      customerName: row.customer_name || "",
      toNumber: row.to_number || "",
      fromNumber: row.from_number || "",
      voiceProfileId: row.voice_profile_id || "",
      script: row.script || "",
      dealId: row.deal_id || "",
      leadId: row.lead_id || "",
      strategyId: row.strategy_id || "",
      strategyRound: numberOr(row.strategy_round),
      startedAt: iso(row.started_at),
      connectedAt: iso(row.connected_at),
      endedAt: iso(row.ended_at),
      durationSec: numberOr(row.duration_sec),
      recordingUrl: row.recording_url || "",
      recordingBytes: numberOr(row.recording_bytes),
      transcriptSource: (row.transcript_source || "none") as CallRecord["transcriptSource"],
      transcript: json<CallRecord["transcript"]>(row.transcript, []),
      category: row.category || "",
      categoryScore: Number(row.category_score || 0),
      summary: row.summary || "",
      tags: json<CallRecord["tags"]>(row.tags, []),
      outcome: row.outcome || "",
      failureReason: row.failure_reason || "",
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at)
    };
  }

  async saveCall(record: CallRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO telephony_calls
        (id,provider,direction,status,provider_call_id,owner_id,team_id,customer_id,customer_name,to_number,from_number,
         voice_profile_id,script,deal_id,lead_id,strategy_id,strategy_round,started_at,connected_at,ended_at,duration_sec,
         recording_url,recording_bytes,transcript_source,transcript,category,category_score,summary,tags,outcome,failure_reason,
         created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
        status=VALUES(status), provider_call_id=VALUES(provider_call_id), started_at=VALUES(started_at),
        connected_at=VALUES(connected_at), ended_at=VALUES(ended_at), duration_sec=VALUES(duration_sec),
        recording_url=VALUES(recording_url), recording_bytes=VALUES(recording_bytes),
        transcript_source=VALUES(transcript_source), transcript=VALUES(transcript),
        category=VALUES(category), category_score=VALUES(category_score), summary=VALUES(summary),
        tags=VALUES(tags), outcome=VALUES(outcome), failure_reason=VALUES(failure_reason), updated_at=VALUES(updated_at)`,
      [
        record.id, record.provider, record.direction, record.status, record.providerCallId,
        record.ownerId, record.teamId, record.customerId, record.customerName, record.toNumber, record.fromNumber,
        record.voiceProfileId, record.script, record.dealId, record.leadId, record.strategyId, record.strategyRound,
        record.startedAt, record.connectedAt, record.endedAt, record.durationSec,
        record.recordingUrl, record.recordingBytes, record.transcriptSource, JSON.stringify(record.transcript || []),
        record.category, record.categoryScore, record.summary, JSON.stringify(record.tags || []),
        record.outcome, record.failureReason, record.createdAt, record.updatedAt
      ]
    );
  }

  async deleteCall(id: string): Promise<void> {
    await this.pool.query("DELETE FROM telephony_calls WHERE id = ?", [id]);
  }

  async listStrategies(): Promise<CallbackStrategy[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>("SELECT * FROM telephony_strategies ORDER BY created_at DESC");
    return rows.map((row) => ({
      id: row.id,
      name: row.name || "",
      teamId: row.team_id || "",
      ownerId: row.owner_id || "",
      cadenceDays: json<number[]>(row.cadence_days, [3, 7, 15]),
      maxRounds: numberOr(row.max_rounds, 1),
      target: json<CallbackStrategy["target"]>(row.target, {
        grades: [], countries: [], categories: [], tags: [], idleDays: 0, limit: 20
      }),
      voiceProfileId: row.voice_profile_id || "",
      script: row.script || "",
      enabled: Boolean(row.enabled),
      nextRunAt: iso(row.next_run_at),
      lastRunAt: iso(row.last_run_at),
      generatedCount: numberOr(row.generated_count),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at)
    }));
  }

  async getStrategy(id: string): Promise<CallbackStrategy | null> {
    const rows = await this.listStrategies();
    return rows.find((row) => row.id === id) || null;
  }

  async saveStrategy(strategy: CallbackStrategy): Promise<void> {
    await this.pool.query(
      `INSERT INTO telephony_strategies
        (id,name,team_id,owner_id,cadence_days,max_rounds,target,voice_profile_id,script,enabled,next_run_at,last_run_at,generated_count,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
        name=VALUES(name), cadence_days=VALUES(cadence_days), max_rounds=VALUES(max_rounds), target=VALUES(target),
        voice_profile_id=VALUES(voice_profile_id), script=VALUES(script), enabled=VALUES(enabled),
        next_run_at=VALUES(next_run_at), last_run_at=VALUES(last_run_at), generated_count=VALUES(generated_count),
        updated_at=VALUES(updated_at)`,
      [
        strategy.id, strategy.name, strategy.teamId, strategy.ownerId, JSON.stringify(strategy.cadenceDays),
        strategy.maxRounds, JSON.stringify(strategy.target), strategy.voiceProfileId, strategy.script,
        strategy.enabled ? 1 : 0, strategy.nextRunAt, strategy.lastRunAt, strategy.generatedCount,
        strategy.createdAt, strategy.updatedAt
      ]
    );
  }

  async deleteStrategy(id: string): Promise<void> {
    await this.pool.query("DELETE FROM telephony_strategies WHERE id = ?", [id]);
  }

  async listRuns(strategyId?: string): Promise<StrategyRunLog[]> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      strategyId
        ? "SELECT * FROM telephony_strategy_runs WHERE strategy_id = ? ORDER BY at DESC LIMIT 50"
        : "SELECT * FROM telephony_strategy_runs ORDER BY at DESC LIMIT 50",
      strategyId ? [strategyId] : []
    );
    return rows.map((row) => ({
      id: row.id,
      strategyId: row.strategy_id,
      at: iso(row.at),
      dispatched: numberOr(row.dispatched),
      skipped: row.skipped || "",
      callIds: json<string[]>(row.call_ids, []),
      round: numberOr(row.round)
    }));
  }

  async appendRun(run: StrategyRunLog): Promise<void> {
    await this.pool.query(
      `INSERT INTO telephony_strategy_runs (id,strategy_id,at,dispatched,skipped,call_ids,round)
       VALUES (?,?,?,?,?,?,?)`,
      [run.id, run.strategyId, run.at, run.dispatched, run.skipped, JSON.stringify(run.callIds), run.round]
    );
  }

  async snapshot(filter: { ownerId?: string; teamId?: string; limit?: number } = {}): Promise<TelephonySnapshot> {
    return {
      settings: await this.readSettings(),
      voiceProfiles: await this.listVoiceProfiles(),
      calls: await this.listCalls(filter),
      strategies: await this.listStrategies(),
      runs: await this.listRuns()
    };
  }
}

let activeStore: TelephonyStore | null = null;

export function telephonyDatabaseUrl(): string {
  return String(process.env.DATABASE_URL || process.env.MYSQL_URL || "").trim();
}

/** 有 MySQL 就用 MySQL；否则进程内存（开发/E2E 也能跑通全链路）。 */
export async function getTelephonyStore(): Promise<TelephonyStore> {
  if (activeStore) return activeStore;
  const url = telephonyDatabaseUrl();
  const forceMemory = String(process.env.CRM_STORE || "").trim() === "memory";
  if (url && !forceMemory) {
    const store = new MysqlTelephonyStore(url);
    await store.init();
    activeStore = store;
    return store;
  }
  const store = new MemoryTelephonyStore();
  await store.init();
  activeStore = store;
  return store;
}

/** 仅测试使用：重置单例 */
export function resetTelephonyStoreForTest(store: TelephonyStore | null): void {
  activeStore = store;
}
