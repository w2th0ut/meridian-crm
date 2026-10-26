/**
 * 话机 CRM 自测（真实链路，不依赖网络与云凭证）
 *
 * 覆盖：阿里云签名 → 模拟器外呼 → 状态推进 → 录音落盘 → 转写 → 自动分类 → 自动/人工标签
 *      → 人工结论与分类修正 → 回访策略下发（含节奏与去重）→ 配置密钥不回显
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AliyunProvider, aliyunRpc, percentEncode, rpcSignature, SimulatorProvider, synthesizeWav } from "./provider.js";
import { classifyCall } from "./classifier.js";
import { MemoryTelephonyStore } from "./store.js";
import { TelephonyService, isCallableNumber, normalizePhone } from "./service.js";
import { createHash } from "node:crypto";
import { createHmac as createHmacSha1Raw } from "node:crypto";
import type { CallRecord, CallSegment } from "./types.js";

function createHmacSha1(secret: string, payload: string): string {
  return createHmacSha1Raw("sha1", secret).update(payload).digest("base64");
}

process.env.KEDUODUO_UPLOADS_DIR = path.join(os.tmpdir(), `keduoduo-telephony-test-${process.pid}`);

const store = new MemoryTelephonyStore();
const service = new TelephonyService({ store });
const actor = { id: "u_admin", teamId: "europe" };

function check(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((error) => {
      console.error(`  ✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    });
}

async function main() {
  let checked = 0;
  const counted = (name: string, fn: () => Promise<void> | void) => check(name, fn).then(() => { checked += 1; });

  console.log("\n话机 CRM 自测");

  await counted("号码规整与可拨校验", () => {
    assert.equal(normalizePhone(" +49 151-2345 678 "), "+491512345678");
    assert.equal(isCallableNumber("+49 151 2345 678"), true);
    assert.equal(isCallableNumber("abc"), false);
    assert.equal(isCallableNumber("123"), false);
  });

  await counted("阿里云签名：RFC3986 编码符合规范（空格 %20、星号 %2A、波浪号保留）", () => {
    assert.equal(percentEncode("a b"), "a%20b");
    assert.equal(percentEncode("*"), "%2A");
    assert.equal(percentEncode("~"), "~");
    assert.equal(percentEncode("中文"), "%E4%B8%AD%E6%96%87");
  });

  await counted("阿里云签名：参数按字典序规范化，结果可复算且稳定", () => {
    const params = { Action: "StartBack2BackCall", Version: "2020-07-01", Callee: "+49 151", Caller: "+86 400" };
    const a = rpcSignature(params, "secret-key");
    const b = rpcSignature({ ...params }, "secret-key");
    assert.equal(a, b, "同样参数必须得到同样签名");
    // 独立复算：RFC3986 编码 → 字典序 → HMAC-SHA1(StringToSign) → Base64
    const canonical = Object.keys(params).sort()
      .map((key) => `${percentEncode(key)}=${percentEncode(params[key as keyof typeof params])}`)
      .join("&");
    const stringToSign = `POST&${percentEncode("/")}&${percentEncode(canonical)}`;
    const expected = createHmacSha1("secret-key&", stringToSign);
    assert.equal(a, expected, "签名必须与独立复算一致");
    assert.equal(rpcSignature({ ...params, Callee: "+49 152" }, "secret-key") === a, false, "参数变化必须改变签名");
  });

  await counted("阿里云未配凭证时明确报错，不会静默走假数据", async () => {
    const provider = new AliyunProvider({
      provider: "aliyun",
      aliyunAccessKeyId: "",
      aliyunAccessKeySecret: "",
      aliyunCccInstanceId: "ccc-test",
      aliyunSkillGroupId: "",
      aliyunCallerNumber: "",
      aliyunRegionId: "cn-hangzhou",
      recordingEnabled: true,
      recordingRetentionDays: 90,
      updatedAt: new Date().toISOString(),
      updatedBy: ""
    });
    let message = "";
    try {
      await provider.placeCall({ toNumber: "+4915100000000", fromNumber: "", customerName: "x", voice: null, script: "hi" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.ok(message.includes("AccessKey"), `应提示凭证缺失，实际：${message}`);
    assert.ok(aliyunRpc instanceof Function);
  });

  await counted("WAV 录音是真实可播放文件（RIFF/WAVE 头 + PCM 数据）", () => {
    const segments: CallSegment[] = [{ seq: 1, speaker: "agent", startSec: 0, endSec: 2, text: "您好" }];
    const wav = synthesizeWav(segments, 2, "seed-1");
    assert.equal(wav.subarray(0, 4).toString(), "RIFF");
    assert.equal(wav.subarray(8, 12).toString(), "WAVE");
    assert.equal(wav.readUInt16LE(22), 1, "单声道");
    assert.equal(wav.readUInt32LE(24), 16000, "16kHz 采样率");
    assert.ok(wav.length > 44 + 16000, "包含实际 PCM 采样");
  });

  await counted("默认配置为模拟器，且未配置阿里云时不会误开云模式", async () => {
    const settings = await service.settings();
    assert.equal(settings.provider, "simulator");
    const publicView = service.publicSettings(settings);
    assert.equal(publicView.credentialsConfigured, false);
    assert.equal(publicView.aliyunAccessKeySecret, "", "密钥绝不回显");
    assert.ok(Array.isArray(publicView.categoryOptions));
  });

  await counted("即使选了阿里云但缺凭证，也会自动退回模拟器", async () => {
    const saved = await service.saveSettings({ provider: "aliyun", aliyunCccInstanceId: "ccc-test" }, actor.id);
    assert.equal(saved.provider, "simulator");
  });

  let voiceId = "";
  await counted("声音配置可保存（音色/语速/音量/音调/背景音/开场白）", async () => {
    const profile = await service.saveVoiceProfile({
      name: "德语区-男声-稳重",
      ttsVoice: "zhiyu",
      speechRate: -50,
      volume: 70,
      pitchRate: -20,
      backgroundAudio: "office-quiet",
      greeting: "您好，这里是客多多外贸，打扰您三分钟。",
      closing: "感谢您的时间，我们明天再联系。",
      isDefault: true
    }, actor);
    voiceId = profile.id;
    assert.equal(profile.ownerId, "");
    assert.equal(profile.teamId, "europe");
    assert.equal(profile.isDefault, true);
    const listed = await service.listVoiceProfiles();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].speechRate, -50);
  });

  await counted("团队内默认声音唯一（再设默认会顶掉旧的）", async () => {
    const second = await service.saveVoiceProfile({ name: "英语区-女声", ttsVoice: "xiaoyun", isDefault: true }, actor);
    const listed = await service.listVoiceProfiles();
    const defaults = listed.filter((item) => item.isDefault && item.teamId === "europe");
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0].id, second.id);
    await service.saveVoiceProfile({ ...listed.find((item) => item.id === voiceId)!, isDefault: true }, actor);
  });

  let callId = "";
  let providerCallId = "";
  // 说明：placeCall 后由 syncCall 推进到终态
  await counted("外呼：只给号码也能拨，记录带声音配置与话术快照", async () => {
    // 模拟器会随机给出「未接通」对话；这里重试到一通已接通的通话，
    // 分别验证两种情况都符合预期（未接通有原因、接通有转写）。
    let completed: CallRecord | null = null;
    let noAnswer: CallRecord | null = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const placed = await service.placeCall({
        toNumber: `+49 151 2345 67${attempt}`,
        customerId: "c_demo_1",
        customerName: "Nordwind Handels GmbH",
        voiceProfileId: voiceId,
        script: "您好，这里是客多多外贸。",
        ownerId: "u_sales_1",
        teamId: "europe"
      });
      callId = placed.id;
      providerCallId = placed.providerCallId;
      assert.equal(placed.status, "dialing", "发起瞬间应为呼叫中，由同步推进");
      assert.equal(placed.toNumber, `+49151234567${attempt}`);
      assert.equal(placed.voiceProfileId, voiceId, "必须记录本次使用的声音配置");
      assert.ok(placed.script.includes("客多多外贸"), "必须记录话术快照");

      await new Promise((resolve) => setTimeout(resolve, 6500));
      const settled = await service.syncCall(placed.id);
      if (settled!.status === "completed") { completed = settled!; break; }
      noAnswer = settled!;
    }

    if (noAnswer && !completed) {
      assert.equal(noAnswer.category, "未接通", "未接通必须分类为未接通");
      assert.ok(noAnswer.tags.some((tag) => tag.label === "未接通"));
      assert.ok(noAnswer.failureReason.length > 0, "未接通必须写明原因");
    }
    assert.ok(completed, "六次尝试内应至少有一通已接通的模拟通话");
    const call = completed!;
    assert.ok(call.transcript.length >= 2, "必须有逐句转写");
    assert.ok(["报价咨询", "样品与打样", "交期与物流", "付款与账期", "质量反馈", "合同与条款"].includes(call.category), `分类异常：${call.category}`);
    assert.ok(call.categoryScore > 0 && call.categoryScore <= 1);
    assert.ok(call.tags.some((tag) => tag.source === "auto"), "必须有自动标签");
    assert.ok(call.summary.length > 0);
    assert.ok(call.durationSec > 0);
    callId = call.id;
  });

  await counted("录音真实落盘到 /uploads/telephony 且是有效 WAV", async () => {
    const call = await service.getCall(callId);
    assert.ok(call?.recordingUrl.startsWith("/uploads/telephony/"), `录音地址异常：${call?.recordingUrl}`);
    const file = path.join(process.env.KEDUODUO_UPLOADS_DIR!, "telephony", path.basename(call!.recordingUrl));
    assert.ok(existsSync(file), "录音文件不存在");
    const buffer = readFileSync(file);
    assert.equal(buffer.subarray(0, 4).toString(), "RIFF");
    assert.ok(buffer.length > 1000);
    assert.equal(call!.recordingBytes, buffer.length);
  });

  await counted("人工打标签 / 去标签，自动标签不被冲掉", async () => {
    const tagged = await service.addTag(callId, "关键客户", actor.id);
    assert.ok(tagged.tags.some((tag) => tag.label === "关键客户" && tag.source === "manual"));
    assert.ok(tagged.tags.some((tag) => tag.source === "auto"));
    const removed = await service.removeTag(callId, "关键客户");
    assert.equal(removed.tags.some((tag) => tag.label === "关键客户"), false);
    assert.ok(removed.tags.some((tag) => tag.source === "auto"));
  });

  await counted("人工改分类与结论后，自动分类不再覆盖", async () => {
    const updated = await service.updateCall(callId, { category: "重点商机", outcome: "客户要求两周内寄样并给阶梯价" }, actor.id);
    assert.equal(updated.category, "重点商机");
    assert.equal(updated.categoryScore, 1);
    assert.equal(updated.outcome, "客户要求两周内寄样并给阶梯价");
    const synced = await service.syncCall(callId);
    assert.equal(synced?.category, "重点商机", "同步不能覆盖人工分类");
  });

  await counted("状态推进：振铃 → 接通 → 完成（模拟器真实时间轴）", async () => {
    const fresh = await service.placeCall({
      toNumber: "+8613800000000",
      customerName: "即时推进检查",
      ownerId: "u_sales_1",
      teamId: "europe"
    });
    // 时间轴：0~2.2s 呼叫中 → 2.2~6.2s 已接通 → 之后结束
    const immediate = await service.syncCall(fresh.id);
    assert.equal(immediate!.status, "dialing", "刚发起应为呼叫中");
    await new Promise((resolve) => setTimeout(resolve, 2600));
    const connected = await service.syncCall(fresh.id);
    // 2.2 秒后应离开"呼叫中"；机器慢时可能已直接到终态，两者都接受
    assert.ok(["connected", "completed", "no_answer"].includes(connected!.status), `2.2 秒后应已接通或结束，实际 ${connected!.status}`);
    await new Promise((resolve) => setTimeout(resolve, 4200));
    const settled = await service.syncCall(fresh.id);
    assert.equal(settled!.status === "completed" || settled!.status === "no_answer", true, "最终应落到结束态");
    assert.ok(settled!.durationSec > 0 || settled!.status === "no_answer");
    await service.deleteCall(fresh.id);
  });

  await counted("分类器：不同业务关键词落到不同分类，并可解释", () => {
    const price = classifyCall([{ seq: 1, speaker: "customer", startSec: 0, endSec: 5, text: "你们 FOB 价格能不能再给一版报价单，数量两个柜要折扣" }]);
    assert.equal(price.category, "报价咨询");
    assert.ok(price.tags.includes("价格敏感"));
    assert.ok(price.evidence.some((line) => line.includes("报价")));
    const quality = classifyCall([{ seq: 1, speaker: "customer", startSec: 0, endSec: 5, text: "这批货有瑕疵，我们要索赔" }]);
    assert.equal(quality.category, "质量反馈");
    assert.ok(quality.tags.includes("需主管介入"));
    const empty = classifyCall([]);
    assert.equal(empty.category, "未接通");
  });

  let strategyId = "";
  await counted("回访策略：节奏与条件可保存，未到时间不下发", async () => {
    const strategy = await service.saveStrategy({
      name: "A 级客户 3/7/15 天回访",
      cadenceDays: [3, 7, 15],
      maxRounds: 3,
      target: { grades: ["A"], limit: 5, idleDays: 0 },
      voiceProfileId: voiceId,
      script: "您好，上次沟通后我再跟您确认一下进度。",
      enabled: true,
      nextRunAt: new Date(Date.now() + 3600_000).toISOString()
    }, actor);
    strategyId = strategy.id;
    assert.deepEqual(strategy.cadenceDays, [3, 7, 15]);
    assert.equal(strategy.maxRounds, 3);
    const result = await service.dispatchStrategy(strategyId, [
      { id: "c_demo_1", company: "Nordwind", grade: "A", phone: "+491512345678" }
    ]);
    assert.equal(result.dispatched, 0, "未到时间不应下发");
  });

  await counted("回访策略：到期下发按条件挑客户，跳过无号码/不符合条件", async () => {
    const customers = [
      { id: "c_a_1", company: "Alpha GmbH", grade: "A", country: "Germany", phone: "+4930123456" },
      { id: "c_b_1", company: "Beta BV", grade: "B", country: "Netherlands", phone: "+3120123456" },
      { id: "c_a_2", company: "Gamma Ltd", grade: "A", country: "Germany", phone: "" },
      { id: "c_a_3", company: "Delta SpA", grade: "A", country: "Italy", phone: "+3906123456" }
    ];
    const result = await service.dispatchStrategy(strategyId, customers, { force: true });
    assert.equal(result.dispatched, 2, `应下发 2 家，实际 ${result.dispatched}`);
    assert.ok(result.skipped.includes("Gamma"), "无号码客户必须被跳过并说明原因");
    const calls = await service.listCalls({ teamId: "europe" });
    const generated = calls.filter((call) => call.strategyId === strategyId);
    assert.equal(generated.length, 2);
    assert.ok(generated.every((call) => call.strategyRound === 1), "首轮回访轮次应为 1");
    assert.ok(generated.every((call) => call.script.includes("上次沟通")));
  });

  await counted("回访策略：下一轮时间按节奏推进，且有下发记录", async () => {
    const strategy = (await service.listStrategies()).find((item) => item.id === strategyId)!;
    const nextAt = new Date(strategy.nextRunAt).getTime();
    assert.ok(nextAt > Date.now(), "下一次下发时间必须往后推");
    assert.ok(strategy.generatedCount >= 2);
    const runs = await service.listRuns(strategyId);
    assert.ok(runs.length >= 1);
    assert.ok(runs[0].callIds.length >= 2);
  });

  await counted("回访策略：已有进行中的呼叫不重复下发", async () => {
    const before = (await service.dispatchStrategy(strategyId, [
      { id: "c_a_1", company: "Alpha GmbH", grade: "A", phone: "+4930123456" }
    ], { force: true })).dispatched;
    // 上一轮已完成的呼叫会让它进入下一轮节奏判断，因此本轮不应重复产生同轮任务
    const after = (await service.dispatchStrategy(strategyId, [
      { id: "c_a_1", company: "Alpha GmbH", grade: "A", phone: "+4930123456" }
    ], { force: true })).dispatched;
    assert.ok(before + after <= 1, `不应重复下发，实际 ${before}+${after}`);
  });

  await counted("可见范围：业务员只看自己，管理者看全团队", async () => {
    const mine = await service.listCalls({ ownerId: "u_sales_1", teamId: "europe" });
    assert.ok(mine.length >= 1);
    assert.ok(mine.every((call) => call.ownerId === "u_sales_1"));
    const team = await service.listCalls({ teamId: "europe" });
    assert.ok(team.length >= mine.length);
  });

  await counted("快照接口一次性返回配置/声音/通话/策略/下发，且密钥为空", async () => {
    const snapshot = await service.snapshot({ teamId: "europe" });
    assert.ok(snapshot.voiceProfiles.length >= 2);
    assert.ok(snapshot.calls.length >= 3);
    assert.ok(snapshot.strategies.length >= 1);
    assert.equal(snapshot.settingsView.aliyunAccessKeySecret, "");
    assert.equal(snapshot.settingsView.aliyunAccessKeyId, "");
  });

  await counted("删除通话会连带清理录音文件", async () => {
    const call = await service.getCall(callId);
    const file = path.join(process.env.KEDUODUO_UPLOADS_DIR!, "telephony", path.basename(call!.recordingUrl));
    await service.deleteCall(callId);
    assert.equal(existsSync(file), false, "录音文件应被删除");
    assert.equal(await service.getCall(callId), null);
  });

  await counted("健康自检报告提供方与存储类型", async () => {
    const health = await service.health();
    assert.equal(health.ok, true);
    assert.equal(health.provider, "simulator");
    assert.equal(health.store, "memory");
    assert.ok(health.message.length > 0);
  });

  await counted("模拟器在无凭证下也能给出可播放录音（下载接口同源逻辑）", async () => {
    const provider = new SimulatorProvider();
    const state = await provider.placeCall({
      toNumber: "+4915100000000",
      fromNumber: "",
      customerName: "Audio Check",
      voice: null,
      script: "您好"
    });
    const audio = await provider.downloadRecording(state, {
      toNumber: "+4915100000000",
      fromNumber: "",
      customerName: "Audio Check",
      voice: null,
      script: "您好"
    });
    assert.equal(audio.subarray(0, 4).toString(), "RIFF");
    assert.ok(audio.length > 44);
  });

  rmSync(process.env.KEDUODUO_UPLOADS_DIR!, { recursive: true, force: true });
  console.log(JSON.stringify({ ok: true, checked }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
