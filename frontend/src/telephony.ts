/**
 * 话机 CRM 前端页面
 *
 * 四个视图：
 *  - phone-workspace  话机工作台：拨号、选择播出声音、实时状态、最近通话
 *  - phone-calls      通话记录：录音播放、逐句转写、标签、分类、人工结论
 *  - phone-strategies 回访策略：节奏（第几天回访）、筛选条件、话术、立即下发、下发记录
 *  - phone-config     话机配置：阿里云接入（密钥只写不读）、默认号码、录音保留、声音库
 */
type Api = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;

interface VoiceProfile {
  id: string; name: string; ownerId: string; teamId: string; ttsVoice: string;
  speechRate: number; volume: number; pitchRate: number; backgroundAudio: string;
  greeting: string; closing: string; isDefault: boolean;
}
interface CallTag { label: string; source: "manual" | "auto"; at: string; by: string }
interface CallSegment { seq: number; speaker: "agent" | "customer"; startSec: number; endSec: number; text: string }
interface CallRecord {
  id: string; provider: string; status: string; providerCallId: string; ownerId: string;
  customerId: string; customerName: string; toNumber: string; fromNumber: string;
  voiceProfileId: string; script: string; strategyId: string; strategyRound: number;
  startedAt: string; endedAt: string; durationSec: number; recordingUrl: string;
  recordingBytes: number; transcriptSource: string; transcript: CallSegment[];
  category: string; categoryScore: number; summary: string; tags: CallTag[];
  outcome: string; failureReason: string;
}
interface Strategy {
  id: string; name: string; cadenceDays: number[]; maxRounds: number;
  target: { grades: string[]; countries: string[]; categories: string[]; tags: string[]; idleDays: number; limit: number };
  voiceProfileId: string; script: string; enabled: boolean; nextRunAt: string; lastRunAt: string; generatedCount: number;
}
interface RunLog { id: string; strategyId: string; at: string; dispatched: number; skipped: string; callIds: string[]; round: number }
interface TelephonySettingsView {
  provider: "aliyun" | "simulator"; aliyunCccInstanceId: string; aliyunSkillGroupId: string;
  aliyunCallerNumber: string; aliyunRegionId: string; recordingEnabled: boolean;
  recordingRetentionDays: number; credentialsConfigured: boolean; categoryOptions: string[];
  updatedAt: string; updatedBy: string;
}
interface Snapshot {
  settingsView: TelephonySettingsView;
  voiceProfiles: VoiceProfile[];
  calls: CallRecord[];
  strategies: Strategy[];
  runs: RunLog[];
}

const VOICE_OPTIONS: Array<{ code: string; label: string }> = [
  { code: "xiaoyun", label: "小云 · 通用女声" },
  { code: "sitong", label: "思彤 · 温柔女声" },
  { code: "zhiyu", label: "知喻 · 稳重男声" },
  { code: "aixia", label: "艾夏 · 亲和女声" },
  { code: "ruoxi", label: "若兮 · 客服女声" },
  { code: "sijia", label: "思佳 · 商务女声" },
  { code: "zhiyan", label: "知燕 · 清晰女声" }
];

const STATUS_LABEL: Record<string, string> = {
  queued: "排队中", dialing: "呼叫中", connected: "通话中", completed: "已结束",
  no_answer: "未接听", busy: "占线", failed: "呼叫失败", cancelled: "已取消"
};

const CATEGORY_TONE: Record<string, string> = {
  报价咨询: "warn", 样品与打样: "ok", 交期与物流: "warn", 付款与账期: "warn",
  质量反馈: "danger", 合同与条款: "ok", 未接通: "muted", 一般沟通: "muted", 简短沟通: "muted", 重点商机: "ok"
};

let snapshot: Snapshot | null = null;
let selectedCallId = "";
let activeTab = "calls";
let pollTimer = 0;

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

function seconds(value: number): string {
  const total = Math.max(0, Math.round(value));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function clock(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function toneClass(tone: string | undefined): string {
  return tone ? ` is-${tone}` : "";
}

/** 通话状态 → 信号色：结束=玉、失败=印章红、进行中=琥珀 */
function statusTone(status: string): string {
  if (status === "completed") return "ok";
  if (status === "failed") return "danger";
  if (status === "dialing" || status === "connected" || status === "queued") return "warn";
  return "muted";
}

/* ── 工作台 ─────────────────────────────────────────── */
function renderWorkspace(root: HTMLElement) {
  const settings = snapshot?.settingsView;
  const voices = snapshot?.voiceProfiles || [];
  const recent = (snapshot?.calls || []).slice(0, 6);
  const inFlight = (snapshot?.calls || []).filter((call) => ["queued", "dialing", "connected"].includes(call.status));

  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1>话机工作台</h1>
        <p class="sub">拨号、选择播出声音、看实时状态；每次通话自动录音、转写、分类。</p>
      </div>
      <div class="head-actions">
        <span class="badge ${settings?.provider === "aliyun" ? "green" : "gray"}" id="phoneProviderBadge">
          ${settings?.provider === "aliyun" ? "阿里云话机" : "模拟器"}
        </span>
        <button class="btn" type="button" data-phone-refresh>刷新</button>
      </div>
    </header>

    <div class="kd-phone-grid">
      <section class="panel section kd-dialer">
        <div class="section-head"><div class="section-title"><div><h2>拨号</h2><p>未选客户也可直接拨号，通话会记入记录</p></div></div></div>
        <div class="kd-dialer-form">
          <label>被叫号码<input id="kdDialNumber" inputmode="tel" placeholder="+49 151 2345 678" autocomplete="off"></label>
          <label>客户名称<input id="kdDialName" placeholder="例如 Nordwind Handels GmbH" autocomplete="off"></label>
          <label>播出声音
            <select id="kdDialVoice">
              <option value="">默认声音</option>
              ${voices.map((voice) => `<option value="${esc(voice.id)}">${esc(voice.name)}${voice.isDefault ? " · 默认" : ""}</option>`).join("")}
            </select>
          </label>
          <label class="full">开场白<textarea id="kdDialScript" rows="3" placeholder="留空则使用所选声音的开场白">${esc(voices[0]?.greeting || "")}</textarea></label>
          <div class="kd-dialer-actions">
            <button class="btn primary" type="button" id="kdDialButton">呼叫</button>
            <button class="btn" type="button" id="kdDialToCustomer">从客户里选</button>
            <span class="kd-dialer-state" id="kdDialState"></span>
          </div>
        </div>
      </section>

      <section class="panel section">
        <div class="section-head">
          <div class="section-title"><div><h2>进行中</h2><p>呼叫中→接通→结束会自动推进</p></div></div>
          <span class="badge ${inFlight.length ? "amber" : "gray"}">${inFlight.length} 通</span>
        </div>
        <div class="kd-live-list">
          ${inFlight.length ? inFlight.map((call) => `
            <article class="kd-live" data-call="${esc(call.id)}">
              <div class="kd-live-head">
                <b>${esc(call.customerName || call.toNumber)}</b>
                <span class="kd-status${toneClass(call.status === "connected" ? "ok" : "warn")}">${esc(STATUS_LABEL[call.status] || call.status)}</span>
              </div>
              <p>${esc(call.toNumber)} · 第 ${call.strategyRound || 0} 轮 · ${esc(clock(call.startedAt))}</p>
              <button class="btn tiny" type="button" data-call-sync="${esc(call.id)}">同步状态</button>
            </article>`).join("") : `<div class="empty-cell">当前没有进行中的通话</div>`}
        </div>
      </section>

      <section class="panel section kd-recent">
        <div class="section-head">
          <div class="section-title"><div><h2>最近通话</h2><p>点一行进详情：录音、转写、标签</p></div></div>
          <button class="btn" type="button" data-phone-goto="phone-calls">全部记录</button>
        </div>
        <div class="kd-call-list">
          ${recent.length ? recent.map(callRow).join("") : `<div class="empty-cell">还没有通话记录。拨出第一通电话后，这里会出现录音与转写。</div>`}
        </div>
      </section>

      <section class="panel section">
        <div class="section-head"><div class="section-title"><div><h2>本周通话速览</h2></div></div></div>
        <div class="kd-stats" id="kdPhoneStats"></div>
      </section>
    </div>`;

  renderStats(root);
  bindWorkspace(root);
}

function renderStats(root: HTMLElement) {
  const host = root.querySelector<HTMLElement>("#kdPhoneStats");
  if (!host) return;
  const calls = snapshot?.calls || [];
  const finished = calls.filter((call) => call.status === "completed");
  const connected = finished.length;
  const talk = finished.reduce((sum, call) => sum + call.durationSec, 0);
  const tagged = calls.filter((call) => (call.tags || []).length > 0).length;
  const byCategory = new Map<string, number>();
  calls.forEach((call) => { if (call.category) byCategory.set(call.category, (byCategory.get(call.category) || 0) + 1); });
  const top = [...byCategory.entries()].sort((left, right) => right[1] - left[1]).slice(0, 4);
  host.innerHTML = `
    <div><span>通话总数</span><b>${calls.length}</b></div>
    <div><span>已接通</span><b>${connected}</b></div>
    <div><span>累计通话</span><b>${seconds(talk)}</b></div>
    <div><span>已打标签</span><b>${tagged}</b></div>
    <div class="kd-stats-wide">
      <span>分类分布</span>
      ${top.length ? top.map(([name, count]) => `<p class="kd-bar"><b>${esc(name)}</b><i style="--w:${Math.round((count / Math.max(1, calls.length)) * 100)}%"></i><em>${count}</em></p>`).join("") : `<p class="kd-muted">暂无分类数据</p>`}
    </div>`;
}

function callRow(call: CallRecord): string {
  const tags = (call.tags || []).slice(0, 3).map((tag) => `<span class="kd-tag${tag.source === "auto" ? " is-auto" : ""}">${esc(tag.label)}</span>`).join("");
  return `<button type="button" class="kd-call-row" data-call-open="${esc(call.id)}">
    <span class="kd-call-main">
      <b>${esc(call.customerName || call.toNumber)}</b>
      <small>${esc(call.toNumber)} · ${esc(clock(call.startedAt))} · ${seconds(call.durationSec)}</small>
    </span>
    <span class="kd-call-meta">
      ${call.category ? `<span class="kd-category${toneClass(CATEGORY_TONE[call.category])}">${esc(call.category)}</span>` : ""}
      ${tags}
    </span>
    <span class="kd-status${toneClass(call.status === "completed" ? "ok" : call.status === "failed" ? "danger" : "muted")}">${esc(STATUS_LABEL[call.status] || call.status)}</span>
  </button>`;
}

function bindWorkspace(root: HTMLElement) {
  const dial = root.querySelector<HTMLButtonElement>("#kdDialButton");
  dial?.addEventListener("click", async () => {
    const number = root.querySelector<HTMLInputElement>("#kdDialNumber")?.value.trim() || "";
    if (!number) { toast("请填写被叫号码", "error"); return; }
    const state = root.querySelector<HTMLElement>("#kdDialState");
    if (state) state.textContent = "正在呼叫…";
    dial.disabled = true;
    try {
      const result = await api<{ call: CallRecord }>("/api/telephony/calls", {
        method: "POST",
        body: {
          toNumber: number,
          customerName: root.querySelector<HTMLInputElement>("#kdDialName")?.value.trim() || "",
          voiceProfileId: root.querySelector<HTMLSelectElement>("#kdDialVoice")?.value || "",
          script: root.querySelector<HTMLTextAreaElement>("#kdDialScript")?.value.trim() || ""
        }
      });
      toast("已发起呼叫，正在建立通话");
      if (state) state.textContent = `${STATUS_LABEL[result.call.status] || result.call.status} · 录音与转写自动生成`;
      await loadPhone();
      selectedCallId = result.call.id;
      goView("phone-calls");
    } catch (error) {
      if (state) state.textContent = error instanceof Error ? error.message : "呼叫失败";
      toast(error instanceof Error ? error.message : "呼叫失败", "error");
    } finally {
      dial.disabled = false;
    }
  });

  root.querySelectorAll<HTMLElement>("[data-call-sync]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.callSync;
      if (!id) return;
      button.setAttribute("disabled", "true");
      try {
        await api(`/api/telephony/calls/${encodeURIComponent(id)}/sync`, { method: "POST" });
        await loadPhone();
      } catch (error) {
        toast(error instanceof Error ? error.message : "同步失败", "error");
      } finally {
        button.removeAttribute("disabled");
      }
    });
  });

  root.querySelectorAll<HTMLElement>("[data-call-open]").forEach((node) => {
    node.addEventListener("click", () => {
      selectedCallId = node.dataset.callOpen || "";
      goView("phone-calls");
    });
  });

  root.querySelector<HTMLElement>("[data-phone-refresh]")?.addEventListener("click", () => void loadPhone(true));
  root.querySelector<HTMLElement>("[data-phone-goto]")?.addEventListener("click", (event) => {
    const target = (event.currentTarget as HTMLElement).dataset.phoneGoto;
    if (target) goView(target);
  });
  root.querySelector<HTMLElement>("#kdDialToCustomer")?.addEventListener("click", async () => {
    try {
      const result = await api<{ customers: Array<{ company: string; phone?: string; whatsapp?: string }> }>("/api/customers?scope=team");
      const withPhone = result.customers.filter((customer) => (customer.phone || customer.whatsapp || "").trim());
      if (!withPhone.length) { toast("团队客户里还没有维护电话号码", "error"); return; }
      const first = withPhone[0];
      const numberInput = root.querySelector<HTMLInputElement>("#kdDialNumber");
      const nameInput = root.querySelector<HTMLInputElement>("#kdDialName");
      if (numberInput) numberInput.value = String(first.phone || first.whatsapp || "");
      if (nameInput) nameInput.value = first.company;
      toast(`已填入 ${first.company}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "读取客户失败", "error");
    }
  });
}

/* ── 通话记录 ───────────────────────────────────────── */
function renderCalls(root: HTMLElement) {
  const calls = snapshot?.calls || [];
  const selected = calls.find((call) => call.id === selectedCallId) || calls[0] || null;
  const tabs = [
    ["calls", "全部"],
    ["completed", "已接通"],
    ["no_answer", "未接听"],
    ["strategy", "回访任务"]
  ];
  const filtered = activeTab === "strategy"
    ? calls.filter((call) => Boolean(call.strategyId))
    : activeTab === "calls" ? calls : calls.filter((call) => call.status === activeTab);

  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1>通话记录</h1>
        <p class="sub">每段对话都可播放、逐句查看、打标签并分类；转写可人工修正。</p>
      </div>
      <div class="head-actions">
        <button class="btn" type="button" data-phone-refresh>刷新</button>
        <button class="btn primary" type="button" data-phone-goto="phone-workspace">去拨号</button>
      </div>
    </header>

    <div class="kd-calls-layout">
      <section class="panel section kd-calls-pane">
        <div class="kd-calls-tabs" role="tablist">
          ${tabs.map(([key, label]) => `<button type="button" role="tab" class="${activeTab === key ? "active" : ""}" data-phone-tab="${key}">${label}<b>${key === "strategy" ? calls.filter((c) => c.strategyId).length : key === "calls" ? calls.length : calls.filter((c) => c.status === key).length}</b></button>`).join("")}
        </div>
        <div class="kd-call-list kd-call-list-tall">
          ${filtered.length ? filtered.map(callRow).join("") : `<div class="empty-cell">没有符合条件的通话</div>`}
        </div>
      </section>
      <section class="panel section kd-call-detail" id="kdCallDetail">
        ${selected ? callDetail(selected, snapshot?.voiceProfiles || []) : `<div class="empty-cell">选择一条通话查看录音与转写</div>`}
      </section>
    </div>`;

  bindCalls(root);
}

function callDetail(call: CallRecord, voices: VoiceProfile[]): string {
  const voice = voices.find((item) => item.id === call.voiceProfileId);
  const tags = call.tags || [];
  const segments = call.transcript || [];
  return `
    <div class="section-head">
      <div class="section-title"><div>
        <h2>${esc(call.customerName || call.toNumber)} <span class="kd-status${toneClass(statusTone(call.status))}">${esc(STATUS_LABEL[call.status] || call.status)}</span></h2>
        <p>${esc(call.toNumber)} · ${esc(clock(call.startedAt))} · ${seconds(call.durationSec)} · ${esc(call.provider)}</p>
      </div></div>
      <div class="head-actions">
        <button class="btn danger" type="button" data-call-delete="${esc(call.id)}">删除</button>
      </div>
    </div>

    <div class="kd-detail-facts">
      <div><span>分类</span><b>${call.category ? `${esc(call.category)} <small>${Math.round(call.categoryScore * 100)}%</small>` : "—"}</b></div>
      <div><span>播出声音</span><b>${esc(voice?.name || "默认声音")}</b></div>
      <div><span>回访轮次</span><b>${call.strategyRound ? `第 ${call.strategyRound} 轮` : "手动外呼"}</b></div>
      <div><span>转写来源</span><b>${esc(call.transcriptSource)}</b></div>
    </div>

    ${call.recordingUrl
      ? `<div class="kd-recorder">
           <audio controls preload="metadata" src="${esc(call.recordingUrl)}"></audio>
           <p>录音 ${esc((call.recordingBytes / 1024).toFixed(0))} KB · ${seconds(call.durationSec)}</p>
         </div>`
      : `<div class="kd-recorder is-empty">${call.status === "no_answer" ? "客户未接听，无录音" : "本次通话没有录音文件"}</div>`}

    <div class="kd-summary">
      <b>一句话摘要</b>
      <p>${esc(call.summary || "尚未生成摘要")}</p>
      ${call.failureReason ? `<small>失败原因：${esc(call.failureReason)}</small>` : ""}
    </div>

    <div class="kd-tags-block">
      <div class="kd-block-head"><b>标签</b><span>${tags.length} 个</span></div>
      <div class="kd-tag-list">
        ${tags.map((tag) => `<span class="kd-tag${tag.source === "auto" ? " is-auto" : ""}">${esc(tag.label)}<button type="button" data-tag-remove="${esc(tag.label)}" aria-label="移除 ${esc(tag.label)}">×</button></span>`).join("") || `<span class="kd-muted">还没有标签</span>`}
      </div>
      <div class="kd-tag-add">
        <input id="kdTagInput" placeholder="输入标签，例如 价格敏感" maxlength="40">
        <button class="btn" type="button" data-tag-add>打标签</button>
      </div>
    </div>

    <div class="kd-transcript-block">
      <div class="kd-block-head"><b>对话转写</b><span>${segments.length} 句</span></div>
      <div class="kd-transcript">
        ${segments.length ? segments.map((segment) => `
          <div class="kd-line is-${segment.speaker}">
            <time>${seconds(segment.startSec)}</time>
            <b>${segment.speaker === "agent" ? "话务员" : "客户"}</b>
            <p>${esc(segment.text)}</p>
          </div>`).join("") : `<div class="empty-cell">没有可用的转写</div>`}
      </div>
    </div>

    <div class="kd-outcome-block">
      <div class="kd-block-head"><b>跟进结论</b><span>人工填写会覆盖自动摘要</span></div>
      <textarea id="kdOutcomeInput" rows="3" placeholder="例如：客户要求两周内寄样并给阶梯价">${esc(call.outcome)}</textarea>
      <div class="kd-outcome-actions">
        <select id="kdCategoryInput">
          ${(snapshot?.settingsView.categoryOptions || []).map((name) => `<option value="${esc(name)}" ${name === call.category ? "selected" : ""}>${esc(name)}</option>`).join("")}
          <option value="重点商机" ${call.category === "重点商机" ? "selected" : ""}>重点商机</option>
        </select>
        <button class="btn primary" type="button" data-outcome-save="${esc(call.id)}">保存结论</button>
      </div>
    </div>`;
}

function bindCalls(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("[data-phone-tab]").forEach((button) => {
    button.addEventListener("click", () => { activeTab = button.dataset.phoneTab || "calls"; renderCalls(root); });
  });
  root.querySelectorAll<HTMLElement>("[data-call-open]").forEach((node) => {
    node.addEventListener("click", () => { selectedCallId = node.dataset.callOpen || ""; renderCalls(root); });
  });
  root.querySelector<HTMLElement>("[data-phone-refresh]")?.addEventListener("click", () => void loadPhone(true));
  root.querySelector<HTMLElement>("[data-phone-goto]")?.addEventListener("click", (event) => {
    const target = (event.currentTarget as HTMLElement).dataset.phoneGoto;
    if (target) goView(target);
  });

  const detail = root.querySelector<HTMLElement>("#kdCallDetail");
  if (!detail) return;

  detail.querySelector<HTMLElement>("[data-call-delete]")?.addEventListener("click", async (event) => {
    const id = (event.currentTarget as HTMLElement).dataset.callDelete;
    if (!id) return;
    try {
      await api(`/api/telephony/calls/${encodeURIComponent(id)}`, { method: "DELETE" });
      selectedCallId = "";
      toast("通话记录与录音已删除");
      await loadPhone(true);
    } catch (error) {
      toast(error instanceof Error ? error.message : "删除失败", "error");
    }
  });

  detail.querySelector<HTMLElement>("[data-tag-add]")?.addEventListener("click", async () => {
    const input = detail.querySelector<HTMLInputElement>("#kdTagInput");
    const label = input?.value.trim() || "";
    if (!label) { toast("请输入标签", "error"); return; }
    try {
      await api(`/api/telephony/calls/${encodeURIComponent(selectedCallId)}/tags`, { method: "POST", body: { label } });
      toast(`已添加标签「${label}」`);
      await loadPhone(true);
    } catch (error) {
      toast(error instanceof Error ? error.message : "打标签失败", "error");
    }
  });

  detail.querySelectorAll<HTMLElement>("[data-tag-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      const label = button.dataset.tagRemove || "";
      try {
        await api(`/api/telephony/calls/${encodeURIComponent(selectedCallId)}/tags/${encodeURIComponent(label)}`, { method: "DELETE" });
        await loadPhone(true);
      } catch (error) {
        toast(error instanceof Error ? error.message : "移除标签失败", "error");
      }
    });
  });

  detail.querySelector<HTMLElement>("[data-outcome-save]")?.addEventListener("click", async () => {
    const outcome = detail.querySelector<HTMLTextAreaElement>("#kdOutcomeInput")?.value.trim() || "";
    const category = detail.querySelector<HTMLSelectElement>("#kdCategoryInput")?.value || "";
    try {
      await api(`/api/telephony/calls/${encodeURIComponent(selectedCallId)}`, { method: "PATCH", body: { outcome, category } });
      toast("结论已保存");
      await loadPhone(true);
    } catch (error) {
      toast(error instanceof Error ? error.message : "保存失败", "error");
    }
  });
}

/* ── 回访策略 ───────────────────────────────────────── */
function renderStrategies(root: HTMLElement) {
  const strategies = snapshot?.strategies || [];
  const runs = snapshot?.runs || [];
  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1>回访策略</h1>
        <p class="sub">按「第几天回访」下发周期任务：到点自动挑客户、生成呼叫任务并占用话术与声音配置。</p>
      </div>
      <div class="head-actions">
        <button class="btn" type="button" data-phone-refresh>刷新</button>
        <button class="btn primary" type="button" id="kdStrategyNew">新建策略</button>
      </div>
    </header>

    <div class="kd-strategy-layout">
      <section class="panel section">
        <div class="section-head"><div class="section-title"><div><h2>策略列表</h2><p>${strategies.length} 个</p></div></div></div>
        <div class="kd-strategy-list">
          ${strategies.length ? strategies.map(strategyCard).join("") : `<div class="empty-cell">还没有策略。新建一个「3/7/15 天回访」试试。</div>`}
        </div>
      </section>

      <section class="panel section" id="kdStrategyEditor">
        <div class="section-head"><div class="section-title"><div><h2>策略编辑</h2><p>选择一条策略，或新建</p></div></div></div>
        <div id="kdStrategyFormHost"><div class="empty-cell">选择左侧策略开始编辑</div></div>
      </section>
    </div>

    <section class="panel section">
      <div class="section-head"><div class="section-title"><div><h2>下发记录</h2><p>每轮下发多少、跳过了谁、为什么</p></div></div></div>
      <div class="kd-run-list">
        ${runs.length ? runs.slice(0, 12).map((run) => `
          <article class="kd-run">
            <div><b>${esc(clock(run.at))}</b><span>第 ${run.round || 0} 轮</span></div>
            <div><b>${run.dispatched}</b><span>下发</span></div>
            <p>${esc(run.skipped || "全部符合条件")}</p>
          </article>`).join("") : `<div class="empty-cell">还没有下发记录</div>`}
      </div>
    </section>`;

  bindStrategies(root);
}

function strategyCard(strategy: Strategy): string {
  return `<article class="kd-strategy${strategy.enabled ? "" : " is-off"}" data-strategy="${esc(strategy.id)}">
    <div class="kd-strategy-head">
      <b>${esc(strategy.name)}</b>
      <span class="kd-status${toneClass(strategy.enabled ? "ok" : "muted")}">${strategy.enabled ? "启用" : "停用"}</span>
    </div>
    <p class="kd-strategy-cadence">${strategy.cadenceDays.map((day) => `第 ${day} 天`).join(" → ")} · 最多 ${strategy.maxRounds} 轮</p>
    <p class="kd-strategy-meta">下次下发 ${esc(clock(strategy.nextRunAt))} · 已下发 ${strategy.generatedCount} 通</p>
    <div class="kd-strategy-actions">
      <button class="btn tiny" type="button" data-strategy-edit="${esc(strategy.id)}">编辑</button>
      <button class="btn tiny primary" type="button" data-strategy-dispatch="${esc(strategy.id)}">立即下发</button>
    </div>
  </article>`;
}

function strategyForm(strategy: Strategy | null): string {
  const voices = snapshot?.voiceProfiles || [];
  const s = strategy;
  return `
    <div class="kd-form-grid">
      <label class="full">策略名称<input id="kdStrategyName" value="${esc(s?.name || "A 级客户 3/7/15 天回访")}" maxlength="160"></label>
      <label>回访节奏（天）<input id="kdStrategyCadence" value="${esc((s?.cadenceDays || [3, 7, 15]).join(","))}" placeholder="3,7,15"></label>
      <label>最多轮次<input id="kdStrategyRounds" type="number" min="1" max="24" value="${s?.maxRounds || 3}"></label>
      <label>客户分级<input id="kdStrategyGrades" value="${esc((s?.target.grades || ["A"]).join(","))}" placeholder="A,B（留空不限）"></label>
      <label>国家关键词<input id="kdStrategyCountries" value="${esc((s?.target.countries || []).join(","))}" placeholder="Germany,Germany（留空不限）"></label>
      <label>只挑分类<input id="kdStrategyCategories" value="${esc((s?.target.categories || []).join(","))}" placeholder="报价咨询,交期与物流"></label>
      <label>只挑标签<input id="kdStrategyTags" value="${esc((s?.target.tags || []).join(","))}" placeholder="意向明确"></label>
      <label>距上次联系（天）<input id="kdStrategyIdle" type="number" min="0" value="${s?.target.idleDays ?? 0}"></label>
      <label>每轮最多<input id="kdStrategyLimit" type="number" min="1" max="200" value="${s?.target.limit ?? 20}"></label>
      <label>使用声音
        <select id="kdStrategyVoice">
          <option value="">默认声音</option>
          ${voices.map((voice) => `<option value="${esc(voice.id)}" ${s?.voiceProfileId === voice.id ? "selected" : ""}>${esc(voice.name)}</option>`).join("")}
        </select>
      </label>
      <label class="full">回访话术<textarea id="kdStrategyScript" rows="3" placeholder="例如：您好，上次沟通后我再跟您确认一下进度。">${esc(s?.script || "")}</textarea></label>
      <label class="kd-inline"><input type="checkbox" id="kdStrategyEnabled" ${s?.enabled ?? true ? "checked" : ""}> 启用（到期自动下发）</label>
    </div>
    <div class="kd-form-actions">
      <button class="btn primary" type="button" data-strategy-save="${esc(s?.id || "")}">保存策略</button>
      ${s ? `<button class="btn danger" type="button" data-strategy-delete="${esc(s.id)}">删除</button>` : ""}
    </div>`;
}

function bindStrategies(root: HTMLElement) {
  const host = root.querySelector<HTMLElement>("#kdStrategyFormHost");
  root.querySelector<HTMLElement>("[data-phone-refresh]")?.addEventListener("click", () => void loadPhone(true));

  const openEditor = (strategy: Strategy | null) => {
    if (!host) return;
    host.innerHTML = strategyForm(strategy);
    bindEditor(root, host);
  };

  root.querySelector<HTMLElement>("#kdStrategyNew")?.addEventListener("click", () => openEditor(null));
  root.querySelectorAll<HTMLElement>("[data-strategy-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.strategyEdit;
      const strategy = (snapshot?.strategies || []).find((item) => item.id === id) || null;
      openEditor(strategy);
    });
  });
  root.querySelectorAll<HTMLElement>("[data-strategy-dispatch]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.strategyDispatch;
      if (!id) return;
      button.setAttribute("disabled", "true");
      try {
        const result = await api<{ dispatched: number; skipped: string; round: number }>(
          `/api/telephony/strategies/${encodeURIComponent(id)}/dispatch`,
          { method: "POST" }
        );
        toast(result.dispatched ? `已下发 ${result.dispatched} 通（第 ${result.round} 轮）` : `本次没有可下发对象${result.skipped ? `：${result.skipped}` : ""}`);
        await loadPhone(true);
      } catch (error) {
        toast(error instanceof Error ? error.message : "下发失败", "error");
      } finally {
        button.removeAttribute("disabled");
      }
    });
  });
}

function bindEditor(root: HTMLElement, host: HTMLElement) {
  host.querySelector<HTMLElement>("[data-strategy-save]")?.addEventListener("click", async () => {
    const id = (host.querySelector<HTMLElement>("[data-strategy-save]")?.dataset.strategySave) || "";
    const cadence = (host.querySelector<HTMLInputElement>("#kdStrategyCadence")?.value || "")
      .split(/[,，\s]+/u).map((part) => Number(part.trim())).filter((value) => Number.isFinite(value) && value > 0);
    const list = (selector: string) => (host.querySelector<HTMLInputElement>(selector)?.value || "")
      .split(/[,，]/u).map((part) => part.trim()).filter(Boolean);
    const body = {
      id: id || undefined,
      name: host.querySelector<HTMLInputElement>("#kdStrategyName")?.value.trim() || "",
      cadenceDays: cadence,
      maxRounds: Number(host.querySelector<HTMLInputElement>("#kdStrategyRounds")?.value || 3),
      target: {
        grades: list("#kdStrategyGrades"),
        countries: list("#kdStrategyCountries"),
        categories: list("#kdStrategyCategories"),
        tags: list("#kdStrategyTags"),
        idleDays: Number(host.querySelector<HTMLInputElement>("#kdStrategyIdle")?.value || 0),
        limit: Number(host.querySelector<HTMLInputElement>("#kdStrategyLimit")?.value || 20)
      },
      voiceProfileId: host.querySelector<HTMLSelectElement>("#kdStrategyVoice")?.value || "",
      script: host.querySelector<HTMLTextAreaElement>("#kdStrategyScript")?.value.trim() || "",
      enabled: Boolean(host.querySelector<HTMLInputElement>("#kdStrategyEnabled")?.checked)
    };
    if (!body.name) { toast("请填写策略名称", "error"); return; }
    if (!body.cadenceDays.length) { toast("请填写回访节奏，例如 3,7,15", "error"); return; }
    try {
      await api("/api/telephony/strategies", { method: "POST", body });
      toast("策略已保存");
      await loadPhone(true);
      const saved = (snapshot?.strategies || []).find((item) => item.name === body.name);
      if (saved) host.innerHTML = strategyForm(saved), bindEditor(root, host);
    } catch (error) {
      toast(error instanceof Error ? error.message : "保存失败", "error");
    }
  });

  host.querySelector<HTMLElement>("[data-strategy-delete]")?.addEventListener("click", async () => {
    const id = host.querySelector<HTMLElement>("[data-strategy-delete]")?.dataset.strategyDelete;
    if (!id) return;
    try {
      await api(`/api/telephony/strategies/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast("策略已删除");
      await loadPhone(true);
      host.innerHTML = `<div class="empty-cell">选择左侧策略开始编辑</div>`;
    } catch (error) {
      toast(error instanceof Error ? error.message : "删除失败", "error");
    }
  });
}

/* ── 话机配置 ───────────────────────────────────────── */
function renderConfig(root: HTMLElement) {
  const settings = snapshot?.settingsView;
  const voices = snapshot?.voiceProfiles || [];
  root.innerHTML = `
    <header class="page-head">
      <div>
        <h1>话机配置</h1>
        <p class="sub">接入阿里云云呼叫中心 / 语音服务；配置播出声音；设置录音保留策略。密钥保存后不再回显。</p>
      </div>
      <div class="head-actions">
        <button class="btn" type="button" id="kdPhoneHealth">连通性自检</button>
        <button class="btn" type="button" data-phone-refresh>刷新</button>
      </div>
    </header>

    <div class="kd-config-grid">
      <section class="panel section">
        <div class="section-head">
          <div class="section-title"><div><h2>阿里云接入</h2><p>${settings?.credentialsConfigured ? "凭证已保存" : "尚未配置凭证，当前使用模拟器"}</p></div></div>
          <span class="badge ${settings?.provider === "aliyun" ? "green" : "gray"}">${settings?.provider === "aliyun" ? "阿里云模式" : "模拟器模式"}</span>
        </div>
        <div class="kd-form-grid">
          <label>提供方
            <select id="kdProvider">
              <option value="simulator" ${settings?.provider === "simulator" ? "selected" : ""}>模拟器（无凭证可用）</option>
              <option value="aliyun" ${settings?.provider === "aliyun" ? "selected" : ""}>阿里云话机</option>
            </select>
          </label>
          <label>地域<input id="kdRegion" value="${esc(settings?.aliyunRegionId || "cn-hangzhou")}" placeholder="cn-hangzhou"></label>
          <label>AccessKeyId<input id="kdAkId" placeholder="${settings?.credentialsConfigured ? "已保存，留空则不修改" : "LTAI..."}" autocomplete="off"></label>
          <label>AccessKeySecret<input id="kdAkSecret" type="password" placeholder="${settings?.credentialsConfigured ? "已保存，留空则不修改" : "输入 AccessKeySecret"}" autocomplete="new-password"></label>
          <label>CCC 实例 ID<input id="kdInstance" value="${esc(settings?.aliyunCccInstanceId || "")}" placeholder="ccc-xxxx"></label>
          <label>技能组 ID<input id="kdSkillGroup" value="${esc(settings?.aliyunSkillGroupId || "")}" placeholder="skill-group-xxxx"></label>
          <label>外显主叫号码<input id="kdCaller" value="${esc(settings?.aliyunCallerNumber || "")}" placeholder="+86400..."></label>
          <label>录音保留（天）<input id="kdRetention" type="number" min="0" max="3650" value="${settings?.recordingRetentionDays ?? 90}"></label>
          <label class="kd-inline"><input type="checkbox" id="kdRecording" ${settings?.recordingEnabled ? "checked" : ""}> 保存通话录音</label>
        </div>
        <div class="kd-form-actions"><button class="btn primary" type="button" id="kdSaveSettings">保存配置</button></div>
        <p class="kd-hint" id="kdHealthResult">${settings?.updatedAt ? `上次保存：${esc(clock(settings.updatedAt))}` : ""}</p>
      </section>

      <section class="panel section">
        <div class="section-head">
          <div class="section-title"><div><h2>播出声音</h2><p>话务员外呼时使用的音色与话术</p></div></div>
          <button class="btn primary" type="button" id="kdVoiceNew">新增声音</button>
        </div>
        <div class="kd-voice-list">
          ${voices.length ? voices.map((voice) => `
            <article class="kd-voice" data-voice="${esc(voice.id)}">
              <div class="kd-voice-head">
                <b>${esc(voice.name)}</b>
                ${voice.isDefault ? `<span class="kd-status is-ok">默认</span>` : ""}
              </div>
              <p>${esc(VOICE_OPTIONS.find((option) => option.code === voice.ttsVoice)?.label || voice.ttsVoice)} · 语速 ${voice.speechRate} · 音量 ${voice.volume} · 音调 ${voice.pitchRate}</p>
              <p class="kd-voice-greeting">${esc(voice.greeting || "未设置开场白")}</p>
              <div class="kd-strategy-actions">
                <button class="btn tiny" type="button" data-voice-edit="${esc(voice.id)}">编辑</button>
                <button class="btn tiny danger" type="button" data-voice-delete="${esc(voice.id)}">删除</button>
              </div>
            </article>`).join("") : `<div class="empty-cell">还没有声音配置</div>`}
        </div>
      </section>

      <section class="panel section" id="kdVoiceFormPanel">
        <div class="section-head"><div class="section-title"><div><h2>声音配置</h2><p>音色、语速、音量、背景音与开场白</p></div></div></div>
        <div id="kdVoiceFormHost"><div class="empty-cell">点「新增声音」或选择左侧声音</div></div>
      </section>
    </div>`;

  bindConfig(root);
}

function voiceForm(voice: VoiceProfile | null): string {
  return `
    <div class="kd-form-grid">
      <label class="full">配置名称<input id="kdVoiceName" value="${esc(voice?.name || "")}" placeholder="例如 德语区-男声-稳重"></label>
      <label>音色
        <select id="kdVoiceTts">
          ${VOICE_OPTIONS.map((option) => `<option value="${option.code}" ${voice?.ttsVoice === option.code ? "selected" : ""}>${option.label}</option>`).join("")}
        </select>
      </label>
      <label>语速（-500~500）<input id="kdVoiceRate" type="number" min="-500" max="500" value="${voice?.speechRate ?? 0}"></label>
      <label>音量（0~100）<input id="kdVoiceVolume" type="number" min="0" max="100" value="${voice?.volume ?? 50}"></label>
      <label>音调（-500~500）<input id="kdVoicePitch" type="number" min="-500" max="500" value="${voice?.pitchRate ?? 0}"></label>
      <label>背景音<input id="kdVoiceBg" value="${esc(voice?.backgroundAudio || "")}" placeholder="例如 office-quiet（留空无）"></label>
      <label class="kd-inline"><input type="checkbox" id="kdVoiceDefault" ${voice?.isDefault ? "checked" : ""}> 设为团队默认声音</label>
      <label class="full">开场白<textarea id="kdVoiceGreeting" rows="3" placeholder="您好，这里是客多多外贸，打扰您三分钟。">${esc(voice?.greeting || "")}</textarea></label>
      <label class="full">挂机语<textarea id="kdVoiceClosing" rows="2" placeholder="感谢您的时间，我们明天再联系。">${esc(voice?.closing || "")}</textarea></label>
    </div>
    <div class="kd-form-actions"><button class="btn primary" type="button" data-voice-save="${esc(voice?.id || "")}">保存声音</button></div>`;
}

function bindConfig(root: HTMLElement) {
  root.querySelector<HTMLElement>("[data-phone-refresh]")?.addEventListener("click", () => void loadPhone(true));

  root.querySelector<HTMLElement>("#kdPhoneHealth")?.addEventListener("click", async () => {
    const out = root.querySelector<HTMLElement>("#kdHealthResult");
    if (out) out.textContent = "正在自检…";
    try {
      const health = await api<{ ok: boolean; message: string; provider: string; store: string }>("/api/telephony/health");
      if (out) out.textContent = `${health.ok ? "✓" : "✗"} ${health.message}（提供方 ${health.provider}，存储 ${health.store}）`;
    } catch (error) {
      if (out) out.textContent = error instanceof Error ? error.message : "自检失败";
    }
  });

  root.querySelector<HTMLElement>("#kdSaveSettings")?.addEventListener("click", async () => {
    const value = (selector: string) => root.querySelector<HTMLInputElement>(selector)?.value.trim() || "";
    const body: Record<string, unknown> = {
      provider: root.querySelector<HTMLSelectElement>("#kdProvider")?.value || "simulator",
      aliyunRegionId: value("#kdRegion"),
      aliyunCccInstanceId: value("#kdInstance"),
      aliyunSkillGroupId: value("#kdSkillGroup"),
      aliyunCallerNumber: value("#kdCaller"),
      recordingEnabled: Boolean(root.querySelector<HTMLInputElement>("#kdRecording")?.checked),
      recordingRetentionDays: Number(value("#kdRetention") || 90)
    };
    const akId = value("#kdAkId");
    const akSecret = value("#kdAkSecret");
    if (akId) body.aliyunAccessKeyId = akId;
    if (akSecret) body.aliyunAccessKeySecret = akSecret;
    try {
      await api("/api/telephony/settings", { method: "PUT", body });
      toast("话机配置已保存");
      await loadPhone(true);
    } catch (error) {
      toast(error instanceof Error ? error.message : "保存失败", "error");
    }
  });

  const host = root.querySelector<HTMLElement>("#kdVoiceFormHost");
  const openVoice = (voice: VoiceProfile | null) => {
    if (!host) return;
    host.innerHTML = voiceForm(voice);
    host.querySelector<HTMLElement>("[data-voice-save]")?.addEventListener("click", async () => {
      const id = host.querySelector<HTMLElement>("[data-voice-save]")?.dataset.voiceSave || "";
      const payload = {
        id: id || undefined,
        name: host.querySelector<HTMLInputElement>("#kdVoiceName")?.value.trim() || "",
        ttsVoice: host.querySelector<HTMLSelectElement>("#kdVoiceTts")?.value || "xiaoyun",
        speechRate: Number(host.querySelector<HTMLInputElement>("#kdVoiceRate")?.value || 0),
        volume: Number(host.querySelector<HTMLInputElement>("#kdVoiceVolume")?.value || 50),
        pitchRate: Number(host.querySelector<HTMLInputElement>("#kdVoicePitch")?.value || 0),
        backgroundAudio: host.querySelector<HTMLInputElement>("#kdVoiceBg")?.value.trim() || "",
        greeting: host.querySelector<HTMLTextAreaElement>("#kdVoiceGreeting")?.value.trim() || "",
        closing: host.querySelector<HTMLTextAreaElement>("#kdVoiceClosing")?.value.trim() || "",
        isDefault: Boolean(host.querySelector<HTMLInputElement>("#kdVoiceDefault")?.checked)
      };
      if (!payload.name) { toast("请填写配置名称", "error"); return; }
      try {
        await api("/api/telephony/voices", { method: "POST", body: payload });
        toast("声音配置已保存");
        await loadPhone(true);
      } catch (error) {
        toast(error instanceof Error ? error.message : "保存失败", "error");
      }
    });
  };

  root.querySelector<HTMLElement>("#kdVoiceNew")?.addEventListener("click", () => openVoice(null));
  root.querySelectorAll<HTMLElement>("[data-voice-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const voice = (snapshot?.voiceProfiles || []).find((item) => item.id === button.dataset.voiceEdit) || null;
      openVoice(voice);
    });
  });
  root.querySelectorAll<HTMLElement>("[data-voice-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.voiceDelete;
      if (!id) return;
      try {
        await api(`/api/telephony/voices/${encodeURIComponent(id)}`, { method: "DELETE" });
        toast("声音配置已删除");
        await loadPhone(true);
        if (host) host.innerHTML = `<div class="empty-cell">点「新增声音」或选择左侧声音</div>`;
      } catch (error) {
        toast(error instanceof Error ? error.message : "删除失败", "error");
      }
    });
  });
}

/* ── 加载与路由 ─────────────────────────────────────── */
let apiRef: Api | null = null;
let toastRef: (message: string, tone?: "ok" | "error") => void = () => undefined;

function toast(message: string, tone?: "ok" | "error") { toastRef(message, tone); }

function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  if (!apiRef) throw new Error("话机模块尚未初始化");
  return apiRef<T>(path, init);
}

function goView(view: string) {
  document.querySelector<HTMLButtonElement>(`.sidebar button[data-view="${view}"]`)?.click();
}

const VIEW_RENDERERS: Record<string, (root: HTMLElement) => void> = {
  "phone-workspace": renderWorkspace,
  "phone-calls": renderCalls,
  "phone-strategies": renderStrategies,
  "phone-config": renderConfig
};

export async function loadPhone(showToast = false): Promise<void> {
  try {
    snapshot = await api<Snapshot>("/api/telephony/snapshot");
    if (showToast) toast("话机数据已刷新");
    renderActiveView();
  } catch (error) {
    toast(error instanceof Error ? error.message : "话机数据加载失败", "error");
  }
}

function phoneRoot(view: HTMLElement): HTMLElement {
  return view.querySelector<HTMLElement>(".kd-phone-root") || view;
}

function renderActiveView() {
  const active = document.querySelector<HTMLElement>(".main > .workspace > .view.active, .main > .view.active");
  if (!active) return;
  const render = VIEW_RENDERERS[active.id];
  if (!render) return;
  render(phoneRoot(active));
}

export function initTelephony(options: {
  api: Api;
  toast: (message: string, tone?: "ok" | "error") => void;
}): void {
  apiRef = options.api;
  toastRef = options.toast;
}

export function isPhoneView(view: string): boolean {
  return Boolean(VIEW_RENDERERS[view]);
}

export function currentPhoneView(): string | null {
  const active = document.querySelector<HTMLElement>(".main > .workspace > .view.active, .main > .view.active");
  if (!active) return null;
  return VIEW_RENDERERS[active.id] ? active.id : null;
}

export function stopPhonePolling(): void {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = 0;
  }
}

/** 来电/去电状态推进：视图内的通话每 3 秒同步一次 */
export function startPhonePolling(): void {
  stopPhonePolling();
  pollTimer = window.setInterval(async () => {
    if (document.visibilityState !== "visible") return;
    const view = currentPhoneView();
    if (!view) return;
    const inFlight = (snapshot?.calls || []).filter((call) => ["queued", "dialing", "connected"].includes(call.status));
    if (!inFlight.length) return;
    await Promise.all(inFlight.map((call) => api(`/api/telephony/calls/${encodeURIComponent(call.id)}/sync`, { method: "POST" }).catch(() => undefined)));
    snapshot = await api<Snapshot>("/api/telephony/snapshot").catch(() => snapshot);
    renderActiveView();
  }, 3000);
}
