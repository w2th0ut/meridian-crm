/**
 * 话机 CRM · HTTP 集成自测
 *
 * 起一个真实后端（内存存储），用真实登录会话走完：
 * 配置 → 声音 → 外呼 → 同步 → 打标 → 改分类 → 策略 → 下发 → 录音可下载
 * 并校验：未登录 401、密钥不回显、业务员看不到别人的通话。
 */
import { strict as assert } from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 4310 + Math.floor(Math.random() * 60);
const BASE = `http://127.0.0.1:${PORT}`;
const uploads = mkdtempSync(path.join(os.tmpdir(), "keduoduo-telephony-http-"));

let server: ChildProcess | null = null;

async function waitForHealth(timeoutMs = 40_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch { /* 还没起来 */ }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("后端未在预期时间内就绪");
}

interface Session { cookie: string; csrf: string }

async function login(email: string, password: string): Promise<Session> {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  assert.equal(response.status, 200, `登录失败 ${email}`);
  const cookies = response.headers.getSetCookie?.() || [];
  const jar = cookies.map((line) => line.split(";")[0]).join("; ");
  const csrf = cookies.find((line) => line.startsWith("gj_csrf="))?.split(";")[0].split("=").slice(1).join("=") || "";
  return { cookie: jar, csrf: decodeURIComponent(csrf) };
}

async function call<T>(session: Session, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; data: T }> {
  const response = await fetch(`${BASE}${path}`, {
    method: init.method || "GET",
    headers: {
      "content-type": "application/json",
      cookie: session.cookie,
      ...(init.method && init.method !== "GET" ? { "x-csrf-token": session.csrf } : {})
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });
  const text = await response.text();
  let data: unknown = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: response.status, data: data as T };
}

async function main() {
  server = spawn("npx", ["tsx", "src/server.ts"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      NODE_ENV: "e2e",
      CRM_STORE: "memory",
      PORT: String(PORT),
      KEDUODUO_UPLOADS_DIR: uploads,
      JWT_SECRET: "keduoduo-telephony-http-test-secret-at-least-32"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout?.on("data", () => undefined);
  server.stderr?.on("data", () => undefined);

  await waitForHealth();
  let checked = 0;
  const step = async (name: string, fn: () => Promise<void>) => {
    await fn();
    checked += 1;
    console.log(`  ✓ ${name}`);
  };

  console.log("\n话机 CRM HTTP 集成自测");

  const anonymous = await fetch(`${BASE}/api/telephony/snapshot`);
  await step("未登录访问话机接口返回 401", async () => {
    assert.equal(anonymous.status, 401);
  });

  const admin = await login("admin@keduoduo.com", "keduoduo123");

  await step("管理员可保存话机配置，且密钥不回显", async () => {
    const saved = await call<{ provider: string; credentialsConfigured: boolean; aliyunAccessKeySecret: string }>(admin, "/api/telephony/settings", {
      method: "PUT",
      body: {
        provider: "simulator",
        aliyunAccessKeyId: "LTAI-test-key",
        aliyunAccessKeySecret: "test-secret-value",
        aliyunCccInstanceId: "ccc-test",
        aliyunCallerNumber: "+864001234567",
        recordingRetentionDays: 30
      }
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.credentialsConfigured, true);
    assert.equal(saved.data.aliyunAccessKeySecret, "", "密钥必须不回显");
  });

  let voiceId = "";
  await step("声音配置全字段可写入并读回", async () => {
    const created = await call<{ voice: { id: string; ttsVoice: string; speechRate: number } }>(admin, "/api/telephony/voices", {
      method: "POST",
      body: {
        name: "测试-德语男声",
        ttsVoice: "zhiyu",
        speechRate: -60,
        volume: 80,
        pitchRate: 10,
        backgroundAudio: "office",
        greeting: "您好，这里是客多多。",
        closing: "明天再联系。",
        isDefault: true
      }
    });
    assert.equal(created.status, 200);
    voiceId = created.data.voice.id;
    const listed = await call<{ voices: Array<{ id: string; ttsVoice: string; speechRate: number; volume: number }> }>(admin, "/api/telephony/voices");
    const hit = listed.data.voices.find((item) => item.id === voiceId)!;
    assert.equal(hit.ttsVoice, "zhiyu");
    assert.equal(hit.speechRate, -60);
    assert.equal(hit.volume, 80);
  });

  let callId = "";
  await step("外呼返回 201，发起即呼叫中", async () => {
    const created = await call<{ call: { id: string; status: string; toNumber: string } }>(admin, "/api/telephony/calls", {
      method: "POST",
      body: { toNumber: "+49 151 9988 776", customerName: "HTTP 集成客户", voiceProfileId: voiceId, script: "您好，集成测试。" }
    });
    assert.equal(created.status, 201);
    callId = created.data.call.id;
    assert.equal(created.data.call.status, "dialing");
    assert.equal(created.data.call.toNumber, "+491519988776");
  });

  await step("同步推进到结束态，并生成录音、转写、分类与自动标签", async () => {
    await new Promise((resolve) => setTimeout(resolve, 7000));
    const synced = await call<{ call: { status: string; recordingUrl: string; transcript: unknown[]; category: string; tags: Array<{ label: string; source: string }> } }>(admin, `/api/telephony/calls/${callId}/sync`, { method: "POST" });
    assert.equal(synced.status, 200);
    const record = synced.data.call;
    assert.ok(["completed", "no_answer"].includes(record.status));
    if (record.status === "completed") {
      assert.ok(record.recordingUrl.startsWith("/uploads/telephony/"));
      assert.ok(record.transcript.length >= 2);
      assert.ok(record.category.length > 0);
      assert.ok(record.tags.some((tag) => tag.source === "auto"));
    }
  });

  await step("录音文件可通过 HTTP 下载，且是 WAV", async () => {
    const detail = await call<{ call: { recordingUrl: string } }>(admin, `/api/telephony/calls/${callId}`);
    if (!detail.data.call.recordingUrl) return; // 未接通场景没有录音
    const response = await fetch(`${BASE}${detail.data.call.recordingUrl}`);
    assert.equal(response.status, 200);
    const buffer = Buffer.from(await response.arrayBuffer());
    assert.equal(buffer.subarray(0, 4).toString(), "RIFF");
    assert.ok(buffer.length > 1000);
  });

  await step("打标签 / 去标签走 HTTP 生效", async () => {
    const tagged = await call<{ call: { tags: Array<{ label: string }> } }>(admin, `/api/telephony/calls/${callId}/tags`, { method: "POST", body: { label: "HTTP标签" } });
    assert.ok(tagged.data.call.tags.some((tag) => tag.label === "HTTP标签"));
    const removed = await call<{ call: { tags: Array<{ label: string }> } }>(admin, `/api/telephony/calls/${callId}/tags/${encodeURIComponent("HTTP标签")}`, { method: "DELETE" });
    assert.equal(removed.data.call.tags.some((tag) => tag.label === "HTTP标签"), false);
  });

  await step("人工改分类与结论不会被自动覆盖", async () => {
    const patched = await call<{ call: { category: string; outcome: string; categoryScore: number } }>(admin, `/api/telephony/calls/${callId}`, {
      method: "PATCH",
      body: { category: "重点商机", outcome: "HTTP 集成：客户要求寄样" }
    });
    assert.equal(patched.data.call.category, "重点商机");
    assert.equal(patched.data.call.outcome, "HTTP 集成：客户要求寄样");
    assert.equal(patched.data.call.categoryScore, 1);
    const synced = await call<{ call: { category: string } }>(admin, `/api/telephony/calls/${callId}/sync`, { method: "POST" });
    assert.equal(synced.data.call.category, "重点商机");
  });

  await step("策略可创建，立即下发能挑到团队客户并生成呼叫任务", async () => {
    const customer = await call<{ customer: { id: string } }>(admin, "/api/customers", {
      method: "POST",
      body: { company: "HTTP Pool GmbH", country: "Germany", contact: "Hans", phone: "+4930999888", stage: "询盘", amount: 0, health: 70, grade: "A" }
    });
    assert.equal(customer.status, 200);
    const strategy = await call<{ strategy: { id: string; cadenceDays: number[] } }>(admin, "/api/telephony/strategies", {
      method: "POST",
      body: { name: "HTTP 集成回访", cadenceDays: [2, 5], maxRounds: 2, target: { grades: ["A"], limit: 5 }, script: "您好，回访一下进度。" }
    });
    assert.deepEqual(strategy.data.strategy.cadenceDays, [2, 5]);
    const dispatched = await call<{ dispatched: number; callIds: string[]; round: number }>(admin, `/api/telephony/strategies/${strategy.data.strategy.id}/dispatch`, { method: "POST" });
    assert.ok(dispatched.data.dispatched >= 1, `应至少下发 1 通，实际 ${dispatched.data.dispatched}（skipped 见响应）`);
    assert.ok(dispatched.data.callIds.length >= 1);
    const runs = await call<{ runs: Array<{ dispatched: number }> }>(admin, "/api/telephony/runs");
    assert.ok(runs.data.runs.length >= 1);
  });

  await step("快照包含配置/声音/通话/策略/下发，且不含密钥", async () => {
    const snapshot = await call<{ settingsView: { aliyunAccessKeySecret: string; aliyunAccessKeyId: string }; calls: unknown[]; voices: unknown[] }>(admin, "/api/telephony/snapshot");
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.data.settingsView.aliyunAccessKeySecret, "");
    assert.equal(snapshot.data.settingsView.aliyunAccessKeyId, "");
    assert.ok((snapshot.data.calls as Array<unknown>).length >= 1);
  });

  await step("业务员看不到管理员的通话，但能打自己的", async () => {
    const sales = await login("shirley@keduoduo.com", "keduoduo123");
    const mine = await call<{ calls: Array<{ ownerId: string }> }>(sales, "/api/telephony/calls");
    assert.equal(mine.status, 200);
    assert.ok(mine.data.calls.every((item) => item.ownerId === "u_sales_shirley"), "业务员只能看到自己的通话");
    const created = await call<{ call: { id: string; ownerId: string } }>(sales, "/api/telephony/calls", {
      method: "POST",
      body: { toNumber: "+4915100000001", customerName: "业务员自拨" }
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.call.ownerId, "u_sales_shirley");
  });

  await step("业务员不能修改话机配置（403）", async () => {
    const sales = await login("shirley@keduoduo.com", "keduoduo123");
    const attempt = await call<{ message: string }>(sales, "/api/telephony/settings", { method: "PUT", body: { provider: "aliyun" } });
    assert.equal(attempt.status, 403);
  });

  await step("健康自检可用", async () => {
    const health = await call<{ ok: boolean; provider: string; store: string }>(admin, "/api/telephony/health");
    assert.equal(health.status, 200);
    assert.equal(health.data.ok, true);
    assert.equal(health.data.provider, "simulator");
  });

  console.log(JSON.stringify({ ok: true, checked }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    server?.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 400));
    rmSync(uploads, { recursive: true, force: true });
  });
