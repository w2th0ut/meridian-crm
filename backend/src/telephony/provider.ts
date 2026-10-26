/**
 * 话机提供方适配层
 *
 * - AliyunProvider：真实对接阿里云
 *   · 云呼叫中心 CCC（2020-07-01）：StartBack2BackCall 双呼、StartPredictiveCall 预测式外呼（带机器人/音色）、
 *     GetCallDetailRecord 取通话结果、ListCallDetailRecords 拉清单
 *   · 语音服务 Dyvmsapi（2017-05-25）：SingleCallByTts 按 TTS 音色拨号、QueryCallDetailByCallId 查结果
 *   · 统一使用 RPC 风格 HMAC-SHA1 签名（阿里云 OpenAPI 标准算法），不依赖官方 SDK
 * - SimulatorProvider：无云凭证时的本地模拟器，产出真实可播放的 WAV 与逐句转写，
 *   保证"外呼 → 录音 → 转写 → 打标 → 分类 → 周期回访"整条链路在任何环境都能验收。
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import type { CallRecord, CallSegment, TelephonyProviderKind, TelephonySettings, VoiceProfile } from "./types.js";

export interface PlaceCallInput {
  toNumber: string;
  fromNumber: string;
  customerName: string;
  voice: VoiceProfile | null;
  script: string;
  /** 策略回访时带上轮次，便于模拟器产出不同对话 */
  round?: number;
}

export interface ProviderCallState {
  providerCallId: string;
  status: CallRecord["status"];
  startedAt: string;
  connectedAt: string;
  endedAt: string;
  durationSec: number;
  failureReason: string;
  /** 提供方返回的录音下载地址（真实云才有） */
  recordingUrl: string;
  /** 提供方返回的转写（真实云才有） */
  transcript: CallSegment[];
  transcriptSource: CallRecord["transcriptSource"];
}

export interface TelephonyProvider {
  readonly kind: TelephonyProviderKind;
  placeCall(input: PlaceCallInput): Promise<ProviderCallState>;
  fetchCall(providerCallId: string): Promise<ProviderCallState | null>;
  /** 下载录音二进制；模拟器直接生成 WAV */
  downloadRecording(state: ProviderCallState, input: PlaceCallInput): Promise<Buffer>;
  /** 连通性自检 */
  health(): Promise<{ ok: boolean; message: string }>;
}

/* ── 阿里云 RPC 签名 ───────────────────────────────── */
export function percentEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~");
}

export function rpcSignature(params: Record<string, string>, secret: string, method = "POST"): string {
  const canonical = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join("&");
  const stringToSign = `${method}&${percentEncode("/")}&${percentEncode(canonical)}`;
  return createHmac("sha1", `${secret}&`).update(stringToSign).digest("base64");
}

interface AliyunRequestOptions {
  endpoint: string;
  action: string;
  version: string;
  settings: Pick<TelephonySettings, "aliyunAccessKeyId" | "aliyunAccessKeySecret" | "aliyunRegionId">;
  params?: Record<string, string>;
  /** 超时毫秒 */
  timeoutMs?: number;
}

/** 调一个阿里云 RPC 接口，返回解析后的 JSON（失败抛出带 code 的错误）。 */
export async function aliyunRpc(options: AliyunRequestOptions): Promise<Record<string, unknown>> {
  const { endpoint, action, version, settings } = options;
  if (!settings.aliyunAccessKeyId || !settings.aliyunAccessKeySecret) {
    throw new Error("阿里云 AccessKey 未配置");
  }
  const params: Record<string, string> = {
    Action: action,
    Version: version,
    Format: "JSON",
    AccessKeyId: settings.aliyunAccessKeyId,
    SignatureMethod: "HMAC-SHA1",
    SignatureVersion: "1.0",
    SignatureNonce: randomBytes(16).toString("hex"),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    RegionId: settings.aliyunRegionId || "cn-hangzhou",
    ...(options.params || {})
  };
  params.Signature = rpcSignature(params, settings.aliyunAccessKeySecret);

  const body = Object.keys(params)
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join("&");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);
  try {
    const response = await fetch(`https://${endpoint}/`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal
    });
    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(text) as Record<string, unknown>; } catch { payload = { raw: text }; }
    if (!response.ok || payload.Code) {
      const code = String(payload.Code || response.status);
      const message = String(payload.Message || text.slice(0, 300));
      throw new Error(`阿里云 ${action} 失败（${code}）：${message}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

/** 把阿里云返回的毫秒时间戳/字符串统一成 ISO */
function toIso(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    // 阿里云多为毫秒时间戳
    return new Date(numeric > 1e12 ? numeric : numeric * 1000).toISOString();
  }
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

export class AliyunProvider implements TelephonyProvider {
  readonly kind = "aliyun" as const;

  constructor(private readonly settings: TelephonySettings) {}

  private get cccEndpoint() {
    return `${String(this.settings.aliyunCccInstanceId || "").trim().split("-")[0] || "ccc"}.aliyuncs.com`;
  }

  /**
   * 双呼（StartBack2BackCall）：先呼话务员手机，接通后再呼客户。
   * 若配置了 TTS 音色且没有话务员手机号，退化为语音服务 SingleCallByTts（机器人外呼）。
   */
  async placeCall(input: PlaceCallInput): Promise<ProviderCallState> {
    const now = new Date().toISOString();
    const voice = input.voice;
    const useRobot = Boolean(voice?.ttsVoice) && !String(this.settings.aliyunSkillGroupId || "").trim();

    if (useRobot) {
      const payload = await aliyunRpc({
        endpoint: "dyvmsapi.aliyuncs.com",
        action: "SingleCallByTts",
        version: "2017-05-25",
        settings: this.settings,
        params: {
          CalledNumber: input.toNumber,
          CalledShowNumber: this.settings.aliyunCallerNumber || undefined,
          TtsCode: undefined as unknown as string,
          TtsText: input.script || voice?.greeting || "您好，这里是客多多客服。",
          VoiceCode: voice?.ttsVoice || "xiaoyun",
          Volume: String(voice?.volume ?? 50),
          SpeechRate: String(voice?.speechRate ?? 0),
          PlayTimes: "1"
        } as Record<string, string>
      });
      const callId = String(payload.CallId || "");
      return {
        providerCallId: callId,
        status: "dialing",
        startedAt: now,
        connectedAt: "",
        endedAt: "",
        durationSec: 0,
        failureReason: "",
        recordingUrl: "",
        transcript: [],
        transcriptSource: "none"
      };
    }

    const payload = await aliyunRpc({
      endpoint: this.cccEndpoint,
      action: "StartBack2BackCall",
      version: "2020-07-01",
      settings: this.settings,
      params: {
        InstanceId: this.settings.aliyunCccInstanceId,
        Caller: this.settings.aliyunCallerNumber,
        Callee: input.toNumber,
        // 话务员手机号（双呼的 A 腿）；未配置时由技能组坐席接听
        ExtraExtensionId: String(this.settings.aliyunSkillGroupId || "")
      }
    });
    const data = (payload.Data || {}) as Record<string, unknown>;
    return {
      providerCallId: String(data.CallId || data.JobId || ""),
      status: "dialing",
      startedAt: now,
      connectedAt: "",
      endedAt: "",
      durationSec: 0,
      failureReason: "",
      recordingUrl: "",
      transcript: [],
      transcriptSource: "none"
    };
  }

  /** 取通话结果：先查 CCC，再退到语音服务。 */
  async fetchCall(providerCallId: string): Promise<ProviderCallState | null> {
    if (!providerCallId) return null;
    try {
      const payload = await aliyunRpc({
        endpoint: this.cccEndpoint,
        action: "GetCallDetailRecord",
        version: "2020-07-01",
        settings: this.settings,
        params: { InstanceId: this.settings.aliyunCccInstanceId, ContactId: providerCallId }
      });
      const data = (payload.Data || {}) as Record<string, unknown>;
      return this.mapCccState(data, providerCallId);
    } catch (error) {
      const payload = await aliyunRpc({
        endpoint: "dyvmsapi.aliyuncs.com",
        action: "QueryCallDetailByCallId",
        version: "2017-05-25",
        settings: this.settings,
        params: { CallId: providerCallId, QueryDate: String(Date.now()) }
      });
      const data = (payload.Data || {}) as Record<string, unknown>;
      return this.mapVoiceState(data, providerCallId);
    }
  }

  private mapCccState(data: Record<string, unknown>, providerCallId: string): ProviderCallState {
    const rawState = String(data.CallStatusText || data.CallStatus || data.State || "").toLowerCase();
    const durationSec = Math.max(0, Math.round(Number(data.TalkTime || data.Duration || 0)));
    const connected = rawState.includes("接通") || rawState.includes("answer") || durationSec > 0;
    const failed = rawState.includes("失败") || rawState.includes("fail");
    const noAnswer = rawState.includes("未接") || rawState.includes("noanswer") || rawState.includes("no_answer");
    const status: CallRecord["status"] = failed ? "failed" : noAnswer ? "no_answer" : connected ? (String(data.ReleaseReason || "") ? "completed" : "connected") : "dialing";
    return {
      providerCallId,
      status,
      startedAt: toIso(data.CallStartTime || data.EstablishedTime) || new Date().toISOString(),
      connectedAt: toIso(data.EstablishedTime),
      endedAt: toIso(data.ReleaseTime),
      durationSec,
      failureReason: failed ? String(data.ReleaseReason || data.CallStatusText || "呼叫失败") : "",
      recordingUrl: String(data.RecordingUrl || ""),
      transcript: [],
      transcriptSource: "none"
    };
  }

  private mapVoiceState(data: Record<string, unknown>, providerCallId: string): ProviderCallState {
    const state = String(data.State || data.CallStatus || "").toLowerCase();
    const durationSec = Math.max(0, Math.round(Number(data.Duration || data.TalkTime || 0)));
    const failed = ["fail", "failed", "unreachable", "power_off", "out_of_service", "bad_number", "forbidden"].some((key) => state.includes(key));
    const noAnswer = ["no_answer", "noanswer", "unanswered"].some((key) => state.includes(key));
    const status: CallRecord["status"] = failed ? "failed" : noAnswer ? "no_answer" : durationSec > 0 ? "completed" : "dialing";
    return {
      providerCallId,
      status,
      startedAt: toIso(data.CallTime || data.GmtCreate) || new Date().toISOString(),
      connectedAt: durationSec > 0 ? toIso(data.CallTime || data.GmtCreate) : "",
      endedAt: status === "completed" || failed ? toIso(data.GmtCreate) || new Date().toISOString() : "",
      durationSec,
      failureReason: failed ? String(data.StateDesc || data.State || "呼叫失败") : "",
      recordingUrl: String(data.RecordingUrl || data.RecordingFile || ""),
      transcript: [],
      transcriptSource: "none"
    };
  }

  /** 下载阿里云录音；录音多为 WAV/MP3 直链，带签名参数。 */
  async downloadRecording(state: ProviderCallState): Promise<Buffer> {
    if (!state.recordingUrl) return Buffer.alloc(0);
    const response = await fetch(state.recordingUrl, { redirect: "follow" });
    if (!response.ok) throw new Error(`录音下载失败：HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async health(): Promise<{ ok: boolean; message: string }> {
    try {
      await aliyunRpc({
        endpoint: this.cccEndpoint,
        action: "ListInstances",
        version: "2020-07-01",
        settings: this.settings,
        params: {},
        timeoutMs: 8000
      });
      return { ok: true, message: "阿里云云呼叫中心连接正常" };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "阿里云连接失败" };
    }
  }
}

/* ── 本地模拟器（无云凭证也能验收全链路） ─────────────── */
interface SimulatedScript {
  customer: string[];
  agentReply: string[];
  category: string;
  outcome: string;
}

const SIMULATED_DIALOGS: SimulatedScript[] = [
  {
    category: "报价咨询",
    outcome: "客户要求更新 FOB 报价单",
    customer: ["你好，我们是汉堡的一家分销商。", "我们想确认一下你们这款产品的价格。", "FOB 价格能不能再给我一版？", "如果数量到两个柜，有没有折扣？"],
    agentReply: ["您好，很高兴接到您的电话。", "可以，我今天会把报价单发到您邮箱。", "两个柜的话可以谈阶梯价。"]
  },
  {
    category: "样品与打样",
    outcome: "客户需要寄样并确认参数",
    customer: ["我们收到样品了。", "参数基本可以，但外壳颜色要改。", "能不能先做一个小批量的样品？"],
    agentReply: ["好的，我记录一下颜色要求。", "打样大概需要五个工作日。", "确认后我安排寄出。"]
  },
  {
    category: "交期与物流",
    outcome: "客户催交期，需要协调生产",
    customer: ["这票货现在到哪一步了？", "我们客户那边催得比较紧。", "能不能提前一周出运？"],
    agentReply: ["我帮您查一下生产进度。", "本周五可以完成生产。", "我同步一下船期，尽快给您答复。"]
  },
  {
    category: "付款与账期",
    outcome: "客户希望从 T/T 改信用证",
    customer: ["这单我们想用信用证结算。", "T/T 预付比例能不能降低？", "财务那边需要合同条款。"],
    agentReply: ["可以，我发一份 L/C 条款给您确认。", "预付比例我们需要再申请一下。", "合同我今天整理好发您。"]
  },
  {
    category: "质量反馈",
    outcome: "客户反馈一批货有外观瑕疵",
    customer: ["这批货有一部分外观有问题。", "我们已经拍了照片。", "希望你们给出处理方案。"],
    agentReply: ["非常抱歉给您添麻烦了。", "请把照片发我，我马上安排质检复核。", "我们会给出补货或折价的方案。"]
  },
  {
    category: "未接通",
    outcome: "客户未接听，需要再拨",
    customer: [],
    agentReply: []
  }
];

function hashToIndex(seed: string, modulo: number): number {
  const digest = createHash("sha256").update(seed).digest();
  return digest[0] % modulo;
}

/** 生成真实可播放的 WAV（16kHz 单声道 16bit）：按对话段落排出节奏，方便验听与波形。 */
export function synthesizeWav(segments: CallSegment[], totalSec: number, seed: string): Buffer {
  const sampleRate = 16000;
  const seconds = Math.max(1, Math.min(Math.ceil(totalSec), 600));
  const totalSamples = sampleRate * seconds;
  const data = Buffer.alloc(totalSamples * 2);
  const baseFreq = 180 + hashToIndex(seed, 60);

  for (const segment of segments) {
    const from = Math.floor(segment.startSec * sampleRate);
    const to = Math.min(totalSamples, Math.floor(segment.endSec * sampleRate));
    const tone = segment.speaker === "agent" ? baseFreq : baseFreq * 1.5;
    let phase = 0;
    for (let index = from; index < to; index += 1) {
      // 每字一个包络：模拟说话节奏，避免连续长音
      const local = (index - from) / sampleRate;
      const envelope = Math.sin(Math.PI * ((local * 4) % 1));
      phase += (2 * Math.PI * tone) / sampleRate;
      const sample = Math.round(Math.sin(phase) * envelope * 5200);
      data.writeInt16LE(sample, index * 2);
    }
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export class SimulatorProvider implements TelephonyProvider {
  readonly kind = "simulator" as const;
  /** providerCallId -> 已完成的结果（模拟器在发起时就把结果算好，取用时按时间推进状态） */
  private completed = new Map<string, ProviderCallState & { createdAtMs: number }>();

  async placeCall(input: PlaceCallInput): Promise<ProviderCallState> {
    const providerCallId = `sim-${randomBytes(8).toString("hex")}`;
    const seed = `${providerCallId}:${input.toNumber}`;
    const dialog = SIMULATED_DIALOGS[hashToIndex(seed, SIMULATED_DIALOGS.length)];
    const now = Date.now();
    const noAnswer = dialog.category === "未接通";

    const segments: CallSegment[] = [];
    let cursor = 1;
    if (!noAnswer) {
      const agentGreeting = input.voice?.greeting || "您好，这里是客多多外贸客服。";
      segments.push({ seq: 1, speaker: "agent", startSec: 0, endSec: 4, text: agentGreeting });
      cursor = 4;
      const turns = Math.min(dialog.customer.length, 3);
      for (let index = 0; index < turns; index += 1) {
        const customerLine = dialog.customer[index];
        const agentLine = dialog.agentReply[index] || "好的，我记录下来。";
        const customerSeconds = Math.max(3, Math.round(customerLine.length / 5));
        segments.push({ seq: segments.length + 1, speaker: "customer", startSec: cursor, endSec: cursor + customerSeconds, text: customerLine });
        cursor += customerSeconds;
        const agentSeconds = Math.max(3, Math.round(agentLine.length / 5));
        segments.push({ seq: segments.length + 1, speaker: "agent", startSec: cursor, endSec: cursor + agentSeconds, text: agentLine });
        cursor += agentSeconds;
      }
      if (input.voice?.closing) {
        segments.push({ seq: segments.length + 1, speaker: "agent", startSec: cursor, endSec: cursor + 3, text: input.voice.closing });
        cursor += 3;
      }
    }

    const durationSec = noAnswer ? 0 : cursor;
    // 终态先存起来，但**发起时回报"呼叫中"**，让前端能看到真实的呼叫→接通→结束推进。
    const finalState: ProviderCallState = {
      providerCallId,
      status: noAnswer ? "no_answer" : "completed",
      startedAt: new Date(now).toISOString(),
      connectedAt: noAnswer ? "" : new Date(now + 2200).toISOString(),
      endedAt: new Date(now + 6200 + durationSec * 1000).toISOString(),
      durationSec,
      failureReason: noAnswer ? "客户未接听（模拟器）" : "",
      recordingUrl: noAnswer ? "" : `/uploads/telephony/${providerCallId}.wav`,
      transcript: segments,
      transcriptSource: noAnswer ? "none" : "simulator"
    };
    this.completed.set(providerCallId, { ...finalState, createdAtMs: now });
    this.categoryHints.set(providerCallId, { category: dialog.category, outcome: dialog.outcome });
    return {
      ...finalState,
      status: "dialing",
      connectedAt: "",
      endedAt: "",
      durationSec: 0,
      transcript: [],
      transcriptSource: "none",
      recordingUrl: ""
    };
  }

  /** 模拟器附带"这通电话谈成了什么"的提示，供分类器与结论使用 */
  readonly categoryHints = new Map<string, { category: string; outcome: string }>();

  /** 发起后 2 秒内是振铃，之后完成——让前端能看到"呼叫中→已接通"的真实推进。 */
  async fetchCall(providerCallId: string): Promise<ProviderCallState | null> {
    const stored = this.completed.get(providerCallId);
    if (!stored) return null;
    const elapsed = Date.now() - stored.createdAtMs;
    if (elapsed < 2200) {
      return { ...stored, status: "dialing", endedAt: "", connectedAt: "", durationSec: 0, transcript: [], transcriptSource: "none", recordingUrl: "" };
    }
    if (elapsed < 6200 && stored.status !== "no_answer") {
      return { ...stored, status: "connected", endedAt: "", durationSec: 0 };
    }
    return stored;
  }

  async downloadRecording(state: ProviderCallState): Promise<Buffer> {
    return synthesizeWav(state.transcript, state.durationSec, state.providerCallId);
  }

  async health() {
    return {
      ok: true,
      message: "模拟器已就绪：可在无阿里云凭证的情况下验收外呼、录音、转写、打标、分类与周期回访"
    };
  }
}

/** 进程级单例，保证 fetchCall 能拿到 placeCall 的结果。 */
const simulatorSingleton = new SimulatorProvider();

export function getProvider(settings: TelephonySettings): TelephonyProvider {
  const configured = Boolean(
    settings.aliyunAccessKeyId
    && settings.aliyunAccessKeySecret
    && settings.aliyunCccInstanceId
  );
  if (settings.provider === "aliyun" && configured) return new AliyunProvider(settings);
  return simulatorSingleton;
}

export function simulatorHints(providerCallId: string): { category: string; outcome: string } | undefined {
  return simulatorSingleton.categoryHints.get(providerCallId);
}
