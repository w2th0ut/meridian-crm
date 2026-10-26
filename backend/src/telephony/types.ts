/**
 * 话机 CRM · 领域类型
 *
 * 目标能力：
 * 1) 接入阿里云话机（云呼叫中心 CCC / 语音服务 Dyvmsapi）
 * 2) 电话播出人的声音配置（TTS 音色、语速、音量、背景音、开场白）
 * 3) 每段对话与对象的录音保存、转写、打标签、自动分类
 * 4) 下发回访策略（周期回访：隔几天、回访几轮、按什么条件挑客户）
 */

export type TelephonyProviderKind = "aliyun" | "simulator";

export type CallDirection = "outbound" | "inbound";

export type CallStatus =
  | "queued"      // 已排入外呼队列，尚未发起
  | "dialing"     // 正在呼叫（客户振铃中）
  | "connected"   // 已接通，通话中
  | "completed"   // 正常结束
  | "no_answer"   // 未接听
  | "busy"        // 占线
  | "failed"      // 呼叫失败
  | "cancelled";  // 人工取消

export interface TelephonySettings {
  /** 当前生效的话机提供方；未配置阿里云时为 simulator */
  provider: TelephonyProviderKind;
  /** 阿里云 AccessKey（加密存储，接口只回是否已配置） */
  aliyunAccessKeyId: string;
  aliyunAccessKeySecret: string;
  /** 云呼叫中心实例 ID，例如 ccc-xxxx */
  aliyunCccInstanceId: string;
  /** 云呼叫中心技能组 ID */
  aliyunSkillGroupId: string;
  /** 主叫号码（话机号 / 400 号 / 外显号） */
  aliyunCallerNumber: string;
  /** 语音服务（Dyvmsapi）区域，默认 cn-hangzhou */
  aliyunRegionId: string;
  /** 是否启用录音下载 */
  recordingEnabled: boolean;
  /** 录音存放时长（天），0 表示不自动清理 */
  recordingRetentionDays: number;
  updatedAt: string;
  updatedBy: string;
}

export interface VoiceProfile {
  id: string;
  /** 声音配置名称，例如「德语区-男声-稳重」 */
  name: string;
  /** 绑定的话务员（空字符串表示团队共用） */
  ownerId: string;
  teamId: string;
  /** 阿里云语音合成音色，例如 xiaoyun / sitong / zhiyu */
  ttsVoice: string;
  /** 语速 -500 ~ 500 */
  speechRate: number;
  /** 音量 0 ~ 100 */
  volume: number;
  /** 音调 -500 ~ 500 */
  pitchRate: number;
  /** 背景音标识（空表示无） */
  backgroundAudio: string;
  /** 开场白（TTS 文本，支持 {customer} {company} 占位） */
  greeting: string;
  /** 挂机语 */
  closing: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CallTag {
  /** 标签名，例如「价格敏感」「需要样品」 */
  label: string;
  /** manual 人工添加 / auto 自动识别 */
  source: "manual" | "auto";
  at: string;
  by: string;
}

export interface CallSegment {
  /** 段序号，从 1 开始 */
  seq: number;
  /** agent 话务员 / customer 客户 */
  speaker: "agent" | "customer";
  /** 相对通话开始的秒数 */
  startSec: number;
  endSec: number;
  text: string;
}

export interface CallRecord {
  id: string;
  provider: TelephonyProviderKind;
  direction: CallDirection;
  status: CallStatus;
  /** 提供方通话 ID（阿里云 CallId / 模拟器 sim-xxx） */
  providerCallId: string;
  /** 话务员 */
  ownerId: string;
  teamId: string;
  /** 通话对象 */
  customerId: string;
  customerName: string;
  /** 被叫号码 */
  toNumber: string;
  /** 主叫号码 */
  fromNumber: string;
  /** 使用的声音配置 */
  voiceProfileId: string;
  /** 本次通话使用的开场白（快照，便于复盘） */
  script: string;
  /** 关联的商机 / 线索（可选） */
  dealId: string;
  leadId: string;
  /** 回访策略来源（空表示手动外呼） */
  strategyId: string;
  /** 第几轮回访（0 表示非策略） */
  strategyRound: number;
  startedAt: string;
  connectedAt: string;
  endedAt: string;
  durationSec: number;
  /** 录音文件相对路径，例如 /uploads/telephony/xxx.wav */
  recordingUrl: string;
  /** 录音文件大小（字节） */
  recordingBytes: number;
  /** 转写来源：aliyun / simulator / manual / none */
  transcriptSource: "aliyun" | "simulator" | "manual" | "none";
  transcript: CallSegment[];
  /** 自动分类结果 */
  category: string;
  /** 分类置信度 0~1 */
  categoryScore: number;
  /** 客户意图摘要（一句话） */
  summary: string;
  tags: CallTag[];
  /** 话务员手填的跟进结论 */
  outcome: string;
  /** 失败原因 */
  failureReason: string;
  createdAt: string;
  updatedAt: string;
}

export interface CallbackStrategy {
  id: string;
  name: string;
  teamId: string;
  ownerId: string;
  /** 启用的回访节奏（天），例如 [3, 7, 15] 表示第 3/7/15 天各回访一次 */
  cadenceDays: number[];
  /** 最多回访轮次，取 cadenceDays 长度与它的较小值 */
  maxRounds: number;
  /** 挑选对象的条件 */
  target: {
    /** 客户分级，空表示不限 */
    grades: string[];
    /** 国家关键词 */
    countries: string[];
    /** 只挑这些分类的上次通话结果 */
    categories: string[];
    /** 只挑带这些标签的客户 */
    tags: string[];
    /** 距上次联系超过多少天 */
    idleDays: number;
    /** 最多挑多少家 */
    limit: number;
  };
  /** 回访时使用的声音配置（空则用默认） */
  voiceProfileId: string;
  /** 回访话术 */
  script: string;
  enabled: boolean;
  /** 下一次下发时间 */
  nextRunAt: string;
  lastRunAt: string;
  /** 累计生成的呼叫任务数 */
  generatedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface StrategyRunLog {
  id: string;
  strategyId: string;
  at: string;
  /** 本轮下发的客户数 */
  dispatched: number;
  /** 跳过原因摘要 */
  skipped: string;
  /** 生成的通话记录 id */
  callIds: string[];
  round: number;
}

export interface TelephonySnapshot {
  settings: TelephonySettings;
  voiceProfiles: VoiceProfile[];
  calls: CallRecord[];
  strategies: CallbackStrategy[];
  runs: StrategyRunLog[];
}
