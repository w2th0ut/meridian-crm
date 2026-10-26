import { expect, test, type Page } from "@playwright/test";
import { openView } from "./navigation";

/**
 * 话机 CRM 端到端：
 * 声音配置 → 拨号（呼叫中→通话中→已结束）→ 录音/转写/分类/标签 → 结论 → 回访策略下发
 */

async function loginAsAdmin(page: Page) {
  await page.goto("/");
  await page.locator("#loginEmail").fill("admin@keduoduo.com");
  await page.locator("#loginPassword").fill("keduoduo123");
  await page.locator("#loginButton").click();
  await expect(page.locator("body")).toHaveClass(/is-authenticated/);
}

test.describe("话机 CRM", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("话机四个视图与导航入口都在，且切页不报错", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await openView(page, "phone-workspace");
    await expect(page.locator("#phone-workspace h1")).toHaveText("话机工作台");
    await expect(page.locator("#kdDialButton")).toBeVisible();

    await openView(page, "phone-calls");
    await expect(page.locator("#phone-calls h1")).toHaveText("通话记录");
    await expect(page.locator("#phone-calls .kd-calls-tabs")).toBeVisible();

    await openView(page, "phone-strategies");
    await expect(page.locator("#phone-strategies h1")).toHaveText("回访策略");
    await expect(page.locator("#kdStrategyNew")).toBeVisible();

    await openView(page, "phone-config");
    await expect(page.locator("#phone-config h1")).toHaveText("话机配置");
    await expect(page.locator("#kdProvider")).toBeVisible();
    await expect(page.locator("#kdPhoneHealth")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("声音配置：可保存音色/语速/音量/开场白并出现在列表", async ({ page }) => {
    await openView(page, "phone-config");
    await page.locator("#kdVoiceNew").click();
    const name = `E2E 德语男声 ${Date.now()}`;
    await page.locator("#kdVoiceName").fill(name);
    await page.locator("#kdVoiceTts").selectOption("zhiyu");
    await page.locator("#kdVoiceRate").fill("-80");
    await page.locator("#kdVoiceVolume").fill("75");
    await page.locator("#kdVoiceGreeting").fill("您好，这里是客多多外贸。");
    await page.locator("#kdVoiceClosing").fill("感谢您的时间。");
    await page.locator("#kdVoiceDefault").check();
    await page.locator("[data-voice-save]").click();
    await expect(page.locator(".toast").last()).toContainText(/已保存|声音|刷新/);

    const card = page.locator("#phone-config .kd-voice", { hasText: name }).first();
    await expect(card).toBeVisible();
    await expect(card).toContainText("语速 -80");
    await expect(card).toContainText("音量 75");
    await expect(card).toContainText("默认");
  });

  test("拨号后能看到呼叫状态推进，最终产出录音、转写、分类与自动标签", async ({ page }) => {
    test.setTimeout(90_000);
    await openView(page, "phone-workspace");
    const customer = `E2E Phone ${Date.now()}`;
    await page.locator("#kdDialNumber").fill("+49 151 3344 556");
    await page.locator("#kdDialName").fill(customer);
    await page.locator("#kdDialScript").fill("您好，这里是客多多外贸，想跟您确认一下订单进度。");
    await page.locator("#kdDialButton").click();

    // 拨完自动跳到通话记录
    await expect(page.locator("#phone-calls")).toHaveClass(/active/);
    const detail = page.locator("#kdCallDetail");
    await expect(detail).toContainText(customer);

    // 状态会从呼叫中/通话中走到已结束
    await expect
      .poll(async () => (await detail.locator(".kd-status").first().textContent())?.trim() || "", { timeout: 40_000 })
      .toMatch(/已结束|未接听/);

    const settled = (await detail.locator(".kd-status").first().textContent())?.trim();
    if (settled === "已结束") {
      // 录音可播放
      const audio = detail.locator("audio");
      await expect(audio).toBeVisible();
      const src = await audio.getAttribute("src");
      expect(src).toContain("/uploads/telephony/");
      // 真实音频：拿到时长
      const duration = await audio.evaluate(async (node: HTMLAudioElement) => {
        if (Number.isFinite(node.duration) && node.duration > 0) return node.duration;
        await new Promise((resolve) => {
          node.addEventListener("loadedmetadata", resolve, { once: true });
          setTimeout(resolve, 4000);
        });
        return node.duration;
      });
      expect(duration).toBeGreaterThan(1);
      // 逐句转写
      expect(await detail.locator(".kd-line").count()).toBeGreaterThanOrEqual(2);
      // 自动分类与自动标签
      await expect(detail.locator(".kd-detail-facts b").first()).not.toHaveText("—");
      expect(await detail.locator(".kd-tag").count()).toBeGreaterThanOrEqual(1);
    }
  });

  test("人工打标签、改结论与分类后立即生效", async ({ page }) => {
    test.setTimeout(90_000);
    await openView(page, "phone-workspace");
    await page.locator("#kdDialNumber").fill("+49 151 7788 990");
    await page.locator("#kdDialName").fill(`E2E Tag ${Date.now()}`);
    await page.locator("#kdDialButton").click();
    const detail = page.locator("#kdCallDetail");
    await expect(detail.locator(".kd-status").first()).toContainText(/已结束|未接听/, { timeout: 40_000 });

    const label = `E2E标签${Date.now() % 10000}`;
    await page.locator("#kdTagInput").fill(label);
    await page.locator("[data-tag-add]").click();
    await expect(detail.locator(".kd-tag", { hasText: label })).toBeVisible();

    await page.locator("#kdOutcomeInput").fill("E2E：客户要求下周寄样");
    await page.locator("#kdCategoryInput").selectOption("重点商机");
    await page.locator("[data-outcome-save]").click();
    await expect(detail.locator(".kd-detail-facts b").first()).toContainText("重点商机");
    await expect(page.locator("#kdOutcomeInput")).toHaveValue("E2E：客户要求下周寄样");
    // 自动标签仍在（人体标签不覆盖自动标签）
    expect(await detail.locator(".kd-tag").count()).toBeGreaterThanOrEqual(2);
  });

  test("按对象查看：同一客户的通话聚合成一条，点开可筛选", async ({ page }) => {
    test.setTimeout(90_000);
    const customer = `E2E 对象 ${Date.now()}`;
    for (let index = 0; index < 2; index += 1) {
      await openView(page, "phone-workspace");
      await page.locator("#kdDialNumber").fill("+492119900055");
      await page.locator("#kdDialName").fill(customer);
      await page.locator("#kdDialButton").click();
      await expect(page.locator("#phone-calls")).toHaveClass(/active/);
      await page.waitForTimeout(1500);
    }
    await expect
      .poll(async () => page.locator("#phone-calls .kd-call-list .kd-call-row").count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(2);

    await page.locator('[data-phone-tab="contacts"]').click();
    const row = page.locator("#phone-calls .kd-contact-list .kd-call-row", { hasText: customer }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("通");
    await row.click();
    await expect(page.locator(".kd-contact-filter")).toContainText(customer);
    await expect(page.locator('[data-phone-tab="contacts"]')).not.toHaveClass(/active/);
    expect(await page.locator("#phone-calls .kd-call-list .kd-call-row").count()).toBeGreaterThanOrEqual(2);
    await page.locator("[data-contact-clear]").click();
    await expect(page.locator(".kd-contact-filter")).toHaveCount(0);
  });

  test("回访策略：可建、可立即下发，并留下下发记录", async ({ page }) => {
    test.setTimeout(90_000);
    // 先造一个有号码的 A 级客户，保证有可下发对象
    const company = `E2E Strategy ${Date.now()}`;
    await page.evaluate(async (name) => {
      const csrf = document.cookie.split("; ").find((part) => part.startsWith("gj_csrf="))?.split("=").slice(1).join("=");
      await fetch("/api/customers", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": decodeURIComponent(csrf || "") },
        body: JSON.stringify({ company: name, country: "Germany", contact: "E2E", phone: "+4930111222", stage: "询盘", amount: 0, health: 80, grade: "A" })
      });
    }, company);

    await openView(page, "phone-strategies");
    await page.locator("#kdStrategyNew").click();
    const name = `E2E 回访 ${Date.now()}`;
    await page.locator("#kdStrategyName").fill(name);
    await page.locator("#kdStrategyCadence").fill("2,6,12");
    await page.locator("#kdStrategyRounds").fill("3");
    await page.locator("#kdStrategyGrades").fill("A");
    await page.locator("#kdStrategyLimit").fill("10");
    await page.locator("#kdStrategyScript").fill("E2E：您好，回访一下上次的进度。");
    await page.locator("[data-strategy-save]").click();

    const card = page.locator("#phone-strategies .kd-strategy", { hasText: name }).first();
    await expect(card).toBeVisible();
    await expect(card).toContainText("第 2 天");
    await expect(card).toContainText("第 6 天");
    await expect(card).toContainText("最多 3 轮");

    await card.locator("[data-strategy-dispatch]").click();
    await expect(page.locator("#phone-strategies .kd-run").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#phone-strategies .kd-run").first()).toContainText(/第 \d+ 轮|下发/);

    // 下发出来的通话带轮次
    await openView(page, "phone-calls");
    await page.locator('[data-phone-tab="strategy"]').click();
    await expect(page.locator("#phone-calls .kd-call-row").first()).toBeVisible();
  });

  test("未配置阿里云时显示模拟器模式，健康自检可用", async ({ page }) => {
    await openView(page, "phone-config");
    await page.locator("#kdPhoneHealth").click();
    await expect(page.locator("#kdHealthResult")).toContainText(/模拟器|正常|已就绪/, { timeout: 20_000 });
    // 密钥输入框永远不显示已保存的值
    await expect(page.locator("#kdAkSecret")).toHaveValue("");
    await expect(page.locator("#kdAkId")).toHaveValue("");
  });

  test("手机端话机页面无横向溢出", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const view of ["phone-workspace", "phone-calls", "phone-strategies", "phone-config"]) {
      await openView(page, view);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(overflow, `${view} 不应横向溢出`).toBe(false);
    }
  });
});
