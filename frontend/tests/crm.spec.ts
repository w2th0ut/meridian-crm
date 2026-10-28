import { expect, test } from "@playwright/test";
import * as XLSX from "xlsx";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { openView } from "./navigation";

async function loginWithCredentials(page: import("@playwright/test").Page, email: string, password: string, expectedName: string) {
  await page.goto("/");
  await page.locator("#loginEmail").fill(email);
  await page.locator("#loginPassword").fill(password);
  await page.locator("#loginButton").click();
  await expect(page.locator("body")).toHaveClass(/is-authenticated/);
  await expect(page.locator("#scopeUser")).toContainText(expectedName);
}

async function loginAsManager(page: import("@playwright/test").Page) {
  await loginWithCredentials(page, "alex@keduoduo.com", "keduoduo123", "Alex");
}

async function loginAsSales(page: import("@playwright/test").Page) {
  await loginWithCredentials(page, "shirley@keduoduo.com", "keduoduo123", "Shirley");
}

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await loginWithCredentials(page, "admin@keduoduo.com", "keduoduo123", "Admin");
}

async function apiFromPage<T>(
  page: import("@playwright/test").Page,
  path: string,
  init: { method?: string; body?: unknown } = {}
) {
  return page.evaluate(async ({ requestPath, requestInit }) => {
    const method = requestInit.method || "GET";
    const csrfToken = document.cookie
      .split("; ")
      .find((part) => part.startsWith("gj_csrf="))
      ?.split("=")
      .slice(1)
      .join("=");
    const response = await fetch(requestPath, {
      method,
      headers: {
        "content-type": "application/json",
        ...(!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) && csrfToken
          ? { "x-csrf-token": decodeURIComponent(csrfToken) }
          : {})
      },
      body: requestInit.body === undefined ? undefined : JSON.stringify(requestInit.body)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `Request failed: ${response.status}`);
    return result;
  }, { requestPath: path, requestInit: init }) as Promise<T>;
}

async function mockFormalLeadFinderRun(
  page: import("@playwright/test").Page,
  input: {
    suffix: string;
    status: "running" | "succeeded" | "partial_success";
    failSecondLaunch?: boolean;
    superSearch?: boolean;
  }
) {
  const now = new Date().toISOString();
  const campaignId = `campaign_ui_${input.suffix}`;
  const strategyId = `strategy_ui_${input.suffix}`;
  const runId = `run_ui_${input.suffix}`;
  let campaignCreates = 0;
  const running = input.status === "running";
  const failedSource = input.status === "partial_success";
  const failure = {
    stage: "provider_request",
    errorCode: "PROVIDER_RATE_LIMITED",
    errorMessage: "请求频率过高",
    httpStatus: 429,
    providerOutcomeCode: "rate_limited",
    retryable: true,
    retryAfterAt: new Date(Date.now() + 60_000).toISOString(),
    occurredAt: now
  };
  const shards = [{
    id: `shard_gleif_${input.suffix}`,
    providerCode: "gleif",
    status: running ? "running" : "succeeded",
    createdAt: now,
    updatedAt: now
  }, ...(failedSource ? [{
    id: `shard_wikidata_${input.suffix}`,
    providerCode: "wikidata",
    status: "failed",
    createdAt: now,
    updatedAt: now
  }] : [])];
  const detail = {
    run: {
      id: runId,
      campaignId,
      campaignVersion: 1,
      strategyId,
      ownerId: "u_manager_alex",
      status: input.status,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      executionSnapshot: {
        campaign: {
          id: campaignId,
          name: `闭环搜客 ${input.suffix}`,
          version: 1,
          snapshot: {
            goal: "寻找德国工业照明分销商",
            products: ["工业照明"],
            markets: ["德国"],
            customerTypes: ["distributor"],
            applicationScenarios: ["工业项目"],
            exclusionRules: [],
            sourceProviderIds: failedSource ? ["gleif", "wikidata"] : ["gleif"]
          }
        },
        resolvedQuery: {
          positiveKeywords: ["工业照明"],
          industryTerms: ["工业项目"],
          countries: ["德国"],
          customerTypes: ["distributor"],
          exclusionKeywords: []
        }
      }
    },
    shards,
    events: [{
      id: `event_${input.suffix}`,
      sequence: 1,
      eventType: running ? "started" : "completed",
      actorId: "system",
      fromStatus: running ? "queued" : "running",
      toStatus: input.status,
      reason: running ? "执行器已接管来源任务" : "所有来源均已结算，结果和失败明细已归档",
      createdAt: now
    }],
    diagnostics: {
      phases: [{
        id: "provider_execution",
        name: "来源执行",
        status: failedSource ? "partial" : running ? "running" : "succeeded",
        result: failedSource ? "一个来源返回结果，一个来源失败" : running ? "正在等待来源返回" : "来源执行完成"
      }],
      sources: shards.map((shard) => ({
        shardId: shard.id,
        providerCode: shard.providerCode,
        status: shard.status,
        failure: shard.status === "failed" ? failure : null,
        job: null,
        checkpoint: null,
        attempts: [],
        requests: []
      })),
      cleaningReport: {
        summary: {
          providerRawCount: 3,
          providerInvalidCount: 0,
          providerDuplicateCount: 1,
          pipelineHitCount: 2,
          processedCount: 2,
          pendingCount: 0,
          rejectedCount: 0,
          suppressedCount: 0,
          mergedCount: 1,
          candidateCount: 1
        },
        stages: [],
        reasons: [],
        sources: shards.map((shard) => ({
          providerCode: shard.providerCode,
          rawCount: shard.status === "failed" ? 0 : 3,
          invalidCount: 0,
          duplicateCount: shard.status === "failed" ? 0 : 1,
          processedCount: shard.status === "failed" ? 0 : 2,
          rejectedCount: 0,
          candidateCount: shard.status === "failed" ? 0 : 1
        })),
        records: [{
          hitId: `hit_merged_${input.suffix}`,
          providerCode: "gleif",
          sourceRecordId: `LEI-${input.suffix}`,
          sourceCompany: "Existing Lighting GmbH",
          sourceCountry: "DE",
          sourceDomain: "existing-lighting.example",
          outcome: "merged",
          reasonCode: "IDENTITY_ALREADY_EXISTS",
          reason: "与已有企业身份一致，已归并到现有候选",
          candidateId: `candidate_existing_${input.suffix}`,
          candidateName: "Existing Lighting GmbH",
          processedAt: now
        }]
      },
      summary: {
        rawHits: 3,
        pages: 1,
        accepted: 1,
        rejected: 0,
        succeededSources: 1,
        failedSources: failedSource ? 1 : 0,
        candidateIds: []
      },
      acceptance: {
        outcome: failedSource ? "partial_success" : running ? "running" : "success",
        sourceReturnedCount: 3,
        candidateCount: 1,
        reviewReadyCount: 0,
        vqaCount: 0,
        sourceSuccessCount: 1,
        sourceFailureCount: failedSource ? 1 : 0,
        sourceSkippedCount: 0,
        totalCost: 0,
        currency: "",
        stopReason: running ? "任务仍在执行" : "所有来源均已结算",
        recommendedNextAction: "打开候选池继续企业身份与资格核验"
      }
    }
  };
  const mission = {
    id: `mission_ui_${input.suffix}`,
    status: input.status,
    revision: 1,
    campaignId,
    strategyId,
    currentRunId: runId,
    currentRound: 1,
    maxRounds: 4,
    targetCandidateCount: 300,
    maxDurationMinutes: 480,
    depth: "balanced",
    costLimit: 0,
    currency: "",
    totalCost: 0,
    rawCount: 3,
    uniqueCount: 1,
    candidateCount: 1,
    reviewReadyCount: 0,
    vqaCount: 0,
    pendingCount: 0,
    filteredCount: 2,
    stopReason: "本轮覆盖矩阵已完成",
    webSearchMode: "off",
    mapSearchMode: "off",
    aiDiscoveryMode: "off",
    webProviderIds: [],
    mapProviderIds: [],
    aiDiscoveryProviderIds: [],
    candidateIds: [],
    acceptance: detail.diagnostics.acceptance,
    rounds: [{
      id: `round_ui_${input.suffix}`,
      missionId: `mission_ui_${input.suffix}`,
      roundNo: 1,
      runId,
      queryPlanSnapshot: {
        positiveKeywords: ["工业照明"],
        synonyms: ["industrial lighting"],
        industryTerms: ["工业项目"],
        purchaseScenarioTerms: ["distribution"],
        countries: ["德国"],
        languages: ["de"],
        customerTypes: ["distributor"]
      },
      plannerVersion: "rules-v1",
      planningMode: "rules",
      queryTheme: "baseline",
      queryPlanFingerprint: `fingerprint_${input.suffix}`,
      coverageGaps: [],
      queryCells: [{
        market: "德国",
        language: "de",
        customerType: "distributor",
        queryTheme: "baseline",
        providerId: "gleif",
        queryText: "工业照明 distributor Germany",
        fingerprint: `cell_${input.suffix}`,
        status: "succeeded",
        rawCount: 3,
        invalidCount: 0,
        duplicateCount: 1,
        candidateCount: 1,
        completedAt: now
      }],
      rawCount: 3,
      uniqueCount: 1,
      candidateCount: 1,
      reviewReadyCount: 0,
      vqaCount: 0,
      duplicateCount: 1,
      filteredCount: 2,
      pendingCount: 0,
      duplicateRate: 0.33,
      yieldRate: 0.33,
      decision: "converged",
      decisionReason: "覆盖矩阵已完成",
      createdAt: now,
      completedAt: now
    }]
  };

  await page.route("**/api/prospect-campaigns**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/prospect-campaigns" && request.method() === "POST") {
      campaignCreates += 1;
      if (input.failSecondLaunch && campaignCreates > 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "服务暂时不可用，请稍后重试" })
        });
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ campaign: { id: campaignId, name: `闭环搜客 ${input.suffix}`, status: "draft", currentVersion: 1, revision: 1 } })
      });
      return;
    }
    if (path === `/api/prospect-campaigns/${campaignId}/strategies` && request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ strategies: [{ id: strategyId, campaignId, campaignVersion: 1, name: "默认策略", status: "draft", revision: 1 }] })
      });
      return;
    }
    if (path === `/api/prospect-campaigns/${campaignId}/activate` && request.method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ campaign: { id: campaignId, name: `闭环搜客 ${input.suffix}`, status: "active", currentVersion: 1, revision: 2 } })
      });
      return;
    }
    await route.fallback();
  });

  await page.route("**/api/prospect-strategies/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === `/api/prospect-strategies/${strategyId}` && request.method() === "PATCH") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ strategy: { id: strategyId, campaignId, campaignVersion: 1, name: "自动策略", status: "draft", revision: 2 } })
      });
      return;
    }
    if (path === `/api/prospect-strategies/${strategyId}/approve` && request.method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ strategy: { id: strategyId, campaignId, campaignVersion: 1, name: "自动策略", status: "approved", revision: 3 } })
      });
      return;
    }
    if (path === `/api/prospect-strategies/${strategyId}/runs` && request.method() === "POST") {
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(detail) });
      return;
    }
    await route.fallback();
  });

  if (input.superSearch) {
    await page.route("**/api/prospect-super-search**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/prospect-super-search/preview" && request.method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            preview: {
              maxRounds: 4,
              maximumCells: 4,
              cellsPerRound: 1,
              coverageCombinations: 4,
              providerCount: 1,
              webProviderCount: 0,
              mapProviderCount: 0,
              aiDiscoveryProviderCount: 0,
              targetCandidateCount: 300,
              maxDurationMinutes: 480
            }
          })
        });
        return;
      }
      if (path === "/api/prospect-super-search" && request.method() === "POST") {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ mission, run: detail })
        });
        return;
      }
      await route.fallback();
    });
  }
  return { runId, detail };
}

function buildQuestionWorkbookBuffer() {
  const worksheet = XLSX.utils.json_to_sheet([
    {
      "题干": "Excel导入定制产品：客户询价时第一步确认什么？",
      "类目": "产品知识",
      "选项A": "规格、数量、认证、交期和使用场景",
      "选项B": "客户名片颜色",
      "选项C": "包装偏好",
      "正确答案": "A",
      "解析": "产品报价必须先确认关键需求参数。",
      "难度": "基础"
    },
    {
      "题干": "Excel导入防爆产品：需要优先确认什么？",
      "类目": "产品知识",
      "选项A": "防爆等级、认证体系和使用区域",
      "选项B": "是否需要彩盒",
      "选项C": "客户头像",
      "选项D": "安装区域危险等级",
      "正确答案": "A,D",
      "解析": "防爆类产品必须确认认证和使用区域。",
      "难度": "高阶",
      "题型": "多选"
    }
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "题库");
  return Buffer.from(XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }));
}

function buildCustomerWorkbookBuffer(company: string) {
  const worksheet = XLSX.utils.json_to_sheet([
    {
      "公司名": company,
      "国家": "德国",
      "联系人": "Import Buyer",
      "阶段": "询盘",
      "预计金额": 23000,
      "健康度": 74,
      "下一提醒": "明天 11:00"
    }
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "客户导入");
  return Buffer.from(XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }));
}

test.describe("Keduoduo CRM prototype pages", () => {
  let runId: string;

  test.beforeEach(async ({ page }) => {
    runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await loginAsManager(page);
    await expect(page.locator("#roleSwitcher")).toHaveCount(0);
  });

  test("topbar works as a global command bar with scoped customer actions", async ({ page }) => {
    const topContext = page.locator("#topActionContext");
    const topSearch = page.locator("#topSearchWrap");
    const topPrimary = page.locator("#topPrimaryAction");

    await expect(topSearch).not.toHaveClass(/is-hidden/);
    await expect(page.locator("#topSearchInput")).toHaveAttribute("placeholder", "");
    await expect(page.locator("#topSearchInput")).toHaveAttribute("aria-label", "全局搜索");
    await expect(topContext).toHaveClass(/is-hidden/);
    await expect(page.locator("#topTodoCount")).toHaveText(/\d+/);
    await expect(page.locator("#topOpenTabs [data-tab-view='dashboard']")).toHaveClass(/active/);

    await page.locator("#topSearchInput").fill("考试");
    await page.locator("#topSearchInput").press("Enter");
    await expect(page.locator("#exam")).toHaveClass(/active/);
    await expect(page.locator("#topOpenTabs [data-tab-view='exam']")).toHaveClass(/active/);
    await expect(topSearch).not.toHaveClass(/is-hidden/);
    await expect(topContext).toHaveClass(/is-hidden/);
    await expect(topPrimary).toBeHidden();

    await openView(page, "reports");
    await expect(page.locator("#reports")).toHaveClass(/active/);
    await expect(page.locator("#topOpenTabs [data-tab-view='reports']")).toHaveClass(/active/);
    await expect(topSearch).not.toHaveClass(/is-hidden/);
    await expect(topContext).toHaveClass(/is-hidden/);
    await expect(page.locator("#reports .page-head")).toContainText("导出文本报告");

    await openView(page, "customers");
    await expect(topSearch).not.toHaveClass(/is-hidden/);
    await expect(topContext).not.toHaveClass(/is-hidden/);
    await expect(page.locator("#topSearchInput")).toHaveAttribute("placeholder", "搜索客户、联系人、国家或产品");
    await expect(topPrimary).toContainText("新增客户");
    await expect(page.locator("#customerImportButton")).toBeVisible();
    await expect(page.locator("#customerExportButton")).toBeVisible();

    await openView(page, "exam");
    await expect(topSearch).not.toHaveClass(/is-hidden/);
    await expect(topContext).toHaveClass(/is-hidden/);
    await expect(topPrimary).toBeHidden();
    await expect(page.locator("#customerImportButton")).toBeHidden();
    await expect(page.locator("#customerExportButton")).toBeHidden();
    await expect(page.locator("#exam").getByRole("button", { name: "创建考试" }).first()).toBeVisible();
  });

  test("dashboard todo workflow is interactive", async ({ page }) => {
    const title = `自动化待办-${runId}`;
    await expect(page.locator("#dashboard .task-list")).toBeVisible();
    const periodTabs = page.locator(".dashboard-period-tabs");
    await expect(periodTabs.locator("button")).toHaveCount(3);
    await expect(periodTabs).toContainText("今日");
    await expect(periodTabs).toContainText("本周");
    await expect(periodTabs).toContainText("本月");
    await expect(periodTabs.locator("[data-dashboard-period='today']")).toHaveClass(/active/);
    await expect(page.locator(".focus-metric").nth(2)).toContainText("今日预计成交金额");
    await expect(page.locator(".focus-title h2")).toContainText("今日");
    await expect(page.locator("#briefingBasis")).toContainText("依据");
    await expect(page.locator("#briefingAction")).toContainText("建议动作");
    await expect(page.locator("#briefingImpact")).toContainText("业务影响");
    const leadFunnel = page.locator("#dashboardLeadFunnel");
    await expect(page.locator("#dashboard .section-title", { hasText: "线索漏斗" })).toContainText("02 / PIPELINE");
    await expect(leadFunnel.locator(".lead-funnel-stage-row")).toHaveCount(5);
    await expect(leadFunnel.locator("[data-lead-funnel-chart] svg")).toBeVisible();
    await expect(leadFunnel).toContainText("待清洗");
    await expect(leadFunnel).toContainText("已建商机");
    await expect(leadFunnel.locator(".lead-funnel-filtered")).toContainText("无效 / 重复线索");
    await expect(leadFunnel.locator(".lead-funnel-summary")).toContainText("转商机率");
    const dashboardSummary = await apiFromPage<{
      periods: Record<"today" | "week" | "month", {
        expectedDeals: number;
        expectedAmounts: Array<{ currency: string; amount: number }>;
        highPriorityTodos: number;
        newLeads: number;
        briefing: {
          title: string;
          description: string;
          basis: string;
          action: string;
          impact: string;
        };
      }>;
      leadFunnel: {
        stages: Array<{ key: string; label: string; count: number; conversionRate: number }>;
        todayAdded: number;
        filteredOut: number;
        dealConversionRate: number;
      };
    }>(page, "/api/dashboard/summary");
    await periodTabs.locator("[data-dashboard-period='month']").click();
    await expect(periodTabs.locator("[data-dashboard-period='month']")).toHaveClass(/active/);
    await expect(page.locator(".focus-metric").nth(2)).toContainText("本月预计成交金额");
    await expect(page.locator(".focus-metric").nth(2)).toContainText(`${dashboardSummary.periods.month.expectedDeals} 个预计成交商机`);
    await expect(page.locator(".focus-metric").nth(1)).toContainText(`本月高优先级待办`);
    await expect(page.locator(".focus-metric").nth(1)).toContainText(`${dashboardSummary.periods.month.highPriorityTodos} 项`);
    await expect(page.locator(".focus-metric").nth(3)).toContainText(`本月新增线索`);
    await expect(page.locator(".focus-metric").nth(3)).toContainText(`${dashboardSummary.periods.month.newLeads} 条`);
    await expect(page.locator(".focus-title h2")).toHaveText(dashboardSummary.periods.month.briefing.title);
    await expect(page.locator(".focus-title p")).toHaveText(dashboardSummary.periods.month.briefing.description);
    await expect(page.locator("#briefingBasis")).toHaveText(dashboardSummary.periods.month.briefing.basis);
    await expect(page.locator("#briefingAction")).toHaveText(dashboardSummary.periods.month.briefing.action);
    await expect(page.locator("#briefingImpact")).toHaveText(dashboardSummary.periods.month.briefing.impact);
    const renderedStages = await leadFunnel.locator(".lead-funnel-stage-row").evaluateAll((rows) => rows.map((row) => ({
      key: (row as HTMLElement).dataset.leadFunnelKey,
      count: Number(row.getAttribute("aria-label")?.match(/\s(\d+)\s条/)?.[1] || 0)
    })));
    expect(renderedStages).toEqual(dashboardSummary.leadFunnel.stages.map((stage) => ({
      key: stage.key,
      count: stage.count
    })));
    await expect(leadFunnel.locator(".lead-funnel-filtered")).toContainText(String(dashboardSummary.leadFunnel.filteredOut));
    await leadFunnel.locator("[data-lead-funnel-key='pending']").click();
    await expect(page.locator("#leads")).toHaveClass(/active/);
    await expect(page.locator("#leadStageChips .lead-chip.active")).toContainText("新线索");
    await openView(page, "dashboard");
    await expect(page.locator("#dashboard .section-title", { hasText: "管道健康度" })).toContainText("04 / HEALTH");
    await expect(page.locator("#dashboard .bars")).toContainText("单");
    await expect(page.locator("#dashboard .bars")).toContainText("$");
    const pipelineHealthRows = await page.locator("#dashboard .bars .bar-row").evaluateAll((rows) => rows.map((row) => {
      const fill = row.querySelector<HTMLElement>(".fill");
      return {
        stage: row.querySelector("span")?.textContent || "",
        count: Number(row.getAttribute("data-count") || 0),
        fillWidth: fill ? Number.parseFloat(fill.style.width || "0") : 0
      };
    }));
    expect(pipelineHealthRows.some((row) => row.stage === "丢单")).toBe(false);
    expect(pipelineHealthRows.filter((row) => row.count === 0).every((row) => row.fillWidth === 0)).toBe(true);
    await expect(page.locator("#dashboard .task-list .task").first()).toContainText("分");
    await expect(page.locator("#dashboard .task-list .task").first()).toContainText("金额权重");
    await expect(page.locator("#dashboardPeriodTabs")).toHaveCount(0);
    await expect(page.locator("#businessScopeTag")).toContainText("团队业务");
    await expect(page.locator("#todoScopeTag")).toContainText("本人待办");
    await expect(page.locator("#morningViewButton")).toBeVisible();
    await expect(page.locator("#morningPanel")).not.toHaveClass(/active/);
    await page.locator("#morningViewButton").click();
    await expect(page.locator("#morningPanel")).toHaveClass(/active/);
    await expect(page.locator("#morningRisk")).toContainText("$");
    await expect(page.locator("#dashboard-knowledge-panel")).toHaveCount(0);
    await expect(page.locator("#dashboard-exam-panel")).toHaveCount(0);
    await expect(page.locator("#dashboard-gap-panel")).toHaveCount(0);
    await page.locator("#batchPriorityButton").click();
    await expect(page.locator(".toast").last()).toContainText(/已生成|无需重复生成/);
    await openView(page, "todo");
    const todoInsight = page.locator("#todo .todo-score-card").filter({ hasText: "今日待办" }).locator("b");
    const beforeTodoCount = Number(await todoInsight.textContent());
    const quickTitle = `快速新增待办-${runId}`;

    await page.locator("#todo .quick-add input").fill(quickTitle);
    await page.locator("#todo .quick-add input").press("Enter");
    await expect(page.locator("#appModal")).not.toHaveClass(/active/);
    await expect(page.locator("#todo .quick-add input")).toHaveValue("");
    await expect(page.locator("#todo .todo-list")).toContainText(quickTitle);
    const quickRow = page.locator("#todo .todo-row", { hasText: quickTitle }).first();
    await quickRow.click();
    await expect(page.locator(".toast").last()).not.toContainText("未设置关联对象和目标完成时间");
    await quickRow.dblclick();
    await expect(page.locator("#appModal")).not.toHaveClass(/active/);
    await quickRow.locator(".todo-more").click();
    await quickRow.locator("[data-todo-action='edit']").click();
    await expect(page.locator("#appModal")).toHaveClass(/active/);
    await expect(page.locator("#modalTitle")).toContainText("编辑待办");
    await page.locator("#todoTitleInput").fill(`${quickTitle}-编辑中`);
    await page.locator("#appModal").click({ position: { x: 8, y: 8 } });
    await expect(page.locator("#appModal")).toHaveClass(/active/);
    await expect(page.locator("#todoTitleInput")).toHaveValue(`${quickTitle}-编辑中`);
    await page.locator("[data-modal-close]").first().click();

    await page.getByRole("button", { name: "新增待办" }).click();
    await expect(page.locator("#appModal")).toHaveClass(/active/);
    await expect(page.locator("#todoTypeInput")).toHaveValue("other");
    await expect(page.locator("#modalBody label", { hasText: "目标完成时间" })).toBeVisible();
    await expect(page.locator("#todoDueInput")).toHaveValue("");
    await expect(page.locator("#todoRelatedInput")).toHaveValue("");
    await page.locator("#todoTitleInput").fill(title);
    await page.locator("#todoTitleInput").press("Enter");

    await expect(page.locator("#todo .todo-list")).toContainText(title);
    await expect(page.locator(".toast").last()).toContainText("待办已新增");
    await expect(todoInsight).toHaveText(String(beforeTodoCount + 2));
    const cacheSize = await page.evaluate(() => localStorage.getItem("gj_dashboard_cache")?.length || 0);
    expect(cacheSize).toBeGreaterThan(20);

    const todoRow = page.locator("#todo .todo-row", { hasText: title }).first();
    await expect(todoRow.locator(".todo-more")).toBeVisible();
    await todoRow.locator(".todo-run").click();
    await expect(page.locator("#todo .todo-row.in-progress", { hasText: title }).first()).toBeVisible();
    await expect(todoRow).toContainText("进行中");
    await expect(todoRow.locator(".subtask-bar.running")).toBeVisible();
    await expect(todoRow.locator(".todo-run")).toHaveAttribute("aria-label", "停止执行");
    await todoRow.locator(".todo-run").click();
    await expect(page.locator("#todo .todo-row.in-progress", { hasText: title })).toHaveCount(0);
    await expect(page.locator(".toast").last()).toContainText("已停止执行");
    await todoRow.locator(".todo-run").click();
    await expect(page.locator("#todo .todo-row.in-progress", { hasText: title }).first()).toBeVisible();

    await todoRow.locator(".todo-check").click();
    const doneRow = page.locator("#todo .todo-row.done", { hasText: title }).first();
    await expect(doneRow).toBeVisible();
    await expect(doneRow).not.toContainText("进行中");
    await expect(page.locator("#todo .todo-row.in-progress", { hasText: title })).toHaveCount(0);
    await doneRow.locator(".todo-check").click();
    await expect(page.locator("#todo .todo-row.done", { hasText: title })).toHaveCount(0);
    await expect(page.locator(".toast").last()).toContainText("已撤回未完成");
    await todoRow.locator(".todo-more").click();
    await todoRow.locator("[data-todo-action='edit']").click();
    await expect(page.locator("#appModal")).toHaveClass(/active/);
    await expect(page.locator("#modalTitle")).toContainText("编辑待办");
    const today = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    const todayText = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())} 18:30`;
    await page.locator("#todoDueInput").fill(todayText);
    await page.locator("#todoRelatedInput").fill("菜单编辑验证");
    await page.locator("#saveTodoButton").click();
    await expect(page.locator(".toast").last()).toContainText("待办已更新");
    await expect(page.locator("#todo .todo-row", { hasText: title }).first()).toContainText(todayText);
    await expect(page.locator("#todo .todo-row", { hasText: title }).first()).not.toContainText(/t_\\d{10,}/);
    await page.locator("#todo .todo-row", { hasText: title }).first().locator(".todo-more").click();
    await page.locator("#todo .todo-row", { hasText: title }).first().locator("[data-todo-action='delete']").click();
    await expect(page.locator("#appModal")).toHaveClass(/active/);
    await page.getByRole("button", { name: "永久删除" }).click();
    await expect(page.locator(".toast").last()).toContainText("待办已永久删除");
    await expect(page.locator("#todo .todo-row", { hasText: title })).toHaveCount(0);
    await quickRow.locator(".todo-more").click();
    await quickRow.locator("[data-todo-action='delete']").click();
    await expect(page.locator("#appModal")).toHaveClass(/active/);
    await page.getByRole("button", { name: "永久删除" }).click();
    await expect(page.locator("#todo .todo-row", { hasText: quickTitle })).toHaveCount(0);
    await expect(todoInsight).toHaveText(String(beforeTodoCount));
  });

  test("sales dashboard keeps personal scope and hides manager briefing controls", async ({ page }) => {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await loginAsSales(page);
    await expect(page.locator("#businessScopeTag")).toContainText("本人业务");
    await expect(page.locator("#todoScopeTag")).toContainText("本人待办");
    await expect(page.locator("#scopeText")).toContainText("本人业务数据，本人待办");
    await expect(page.locator("#morningViewButton")).toBeHidden();
    await expect(page.locator("#dashboard .focus-metric").nth(1)).toContainText("高优先级待办");
    await expect(page.locator("#dashboard .focus-metric").nth(1)).toContainText("本人待办");
  });

  test("dashboard remains readable without horizontal overflow on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.locator("#dashboard")).toHaveClass(/active/);
    const layout = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      dashboardRight: document.querySelector("#dashboard")?.getBoundingClientRect().right || 0,
      historyOpen: document.querySelector("#todo .todo-history")?.hasAttribute("open") || false
    }));
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.dashboardRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.historyOpen).toBe(false);
    await expect(page.locator("#dashboard .focus-metrics")).toBeVisible();
    await expect(page.locator("#dashboard .todo-board")).toBeVisible();
    await expect(page.locator("#businessScopeTag")).toContainText(/本人业务|团队业务|全局业务/);
  });

  test("todo menu pins and long-press drag clears pin labels", async ({ page }) => {
    const pinned = `拖拽排序待办-${runId}`;
    const anchor = `拖拽目标待办-${runId}`;

    await openView(page, "todo");
    for (const title of [anchor, pinned]) {
      await page.getByRole("button", { name: "新增待办" }).click();
      await page.locator("#todoTitleInput").fill(title);
      await page.locator("#todoTitleInput").press("Enter");
      await expect(page.locator("#todo .todo-row", { hasText: title })).toBeVisible();
    }

    const currentTodoRows = page.locator("#todo .todo-list > .todo-row");
    const pinnedRow = currentTodoRows.filter({ hasText: pinned }).first();
    await expect(pinnedRow.locator(".todo-more span")).toHaveCount(3);
    await pinnedRow.locator(".todo-more").click();
    await expect(pinnedRow.locator(".todo-menu")).toBeVisible();
    await expect(pinnedRow.locator("[data-todo-action='edit']")).toBeVisible();
    await page.locator("#todo .todo-toolbar").click();
    await expect(pinnedRow.locator(".todo-menu")).toHaveCount(0);
    await pinnedRow.locator(".todo-more").click();
    await pinnedRow.locator("[data-todo-action='top']").click();
    await expect(currentTodoRows.first()).toContainText(pinned);
    await expect(pinnedRow).toContainText("置顶");

    const anchorRow = currentTodoRows.filter({ hasText: anchor }).first();
    await expect(pinnedRow).toBeVisible();
    await expect(anchorRow).toBeVisible();
    const fromBox = await pinnedRow.boundingBox();
    const toBox = await anchorRow.boundingBox();
    if (!fromBox || !toBox) throw new Error("todo drag boxes missing");
    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(360);
    await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator(".toast").last()).toContainText("已按拖拽顺序保存");
    await expect(currentTodoRows.filter({ hasText: pinned }).first()).not.toContainText("置顶");
    await expect(currentTodoRows.filter({ hasText: pinned }).first()).not.toContainText("沉底");

    for (const title of [pinned, anchor]) {
      const row = currentTodoRows.filter({ hasText: title }).first();
      await row.locator(".todo-more").click();
      await row.locator("[data-todo-action='delete']").click();
      await expect(page.locator("#appModal")).toHaveClass(/active/);
      await page.getByRole("button", { name: "永久删除" }).click();
      await expect(currentTodoRows.filter({ hasText: title })).toHaveCount(0);
    }
  });

  test("plan task page restores execution planner and keeps result workflow", async ({ page }) => {
    test.setTimeout(60_000);
    const localDateTime = (date: Date) => {
      const pad = (value: number) => String(value).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };
    const todayDue = new Date();
    todayDue.setSeconds(0, 0);
    const rescheduledDue = new Date(todayDue);
    rescheduledDue.setMinutes(rescheduledDue.getMinutes() + 30);

    await openView(page, "plan-growth");
    await expect(page.locator("#plan-growth")).toContainText("计划任务");
    await expect(page.locator("#plan-growth .plan-task-stats")).toBeVisible();
    await expect(page.locator("#plan-growth")).toContainText("客户画像与搜索入口");
    await expect(page.locator("#plan-growth")).toContainText("首周执行拆解");
    await expect(page.locator("#plan-growth")).toContainText("英文话术与参数确认");
    await expect(page.locator("#knowledgeTemplateList")).toContainText("产品分类地图");
    await expect(page.locator("#executionTemplateList")).toContainText("第 1 天");
    const templateTitle = (await page.locator("#knowledgeTemplateList [data-plan-template-id]").first().locator("b").textContent()) || "";
    await page.locator("#knowledgeTemplateList [data-plan-template-id]").first().locator("[data-plan-template-add]").click();
    await expect(page.locator(".toast").last()).toContainText(/已加入计划任务|已在计划中/);
    await expect(page.locator(".plan-task-table")).toBeVisible();

    const taskTitle = `今日客户动作-${runId}`;
    await page.locator("#planTaskNewButton").click();
    await page.locator("#planTaskTitleInput").fill(taskTitle);
    await page.locator("#planTaskDueInput").fill(localDateTime(todayDue));
    await page.getByText("更多设置", { exact: true }).click();
    await page.locator("#planTaskRelationType").selectOption("customer");
    await page.locator("#planTaskCustomerInput").selectOption({ index: 1 });
    await page.locator("#planTaskPriorityInput").selectOption("high");
    await page.locator("#planTaskStatusInput").selectOption("active");
    await page.locator("#planTaskTargetInput").fill("确认报价反馈并约定下一步");
    await page.locator("#planTaskDescriptionInput").fill("页面级业务闭环自测");
    await page.locator("#savePlanTaskButton").click();
    await expect(page.locator(".toast").last()).toContainText("计划任务已新增");
    await expect(page.locator("#appModal")).not.toHaveClass(/active/);
    const completedRow = page.locator(".plan-task-table tr", { hasText: taskTitle });
    await expect(completedRow).toContainText("客户");
    await completedRow.locator("[data-plan-complete]").click();
    await page.locator("#planTaskCompleteResult").fill("客户确认关键参数，已发送新版报价，周五继续跟进。");
    await page.locator("#confirmPlanTaskComplete").click();
    await expect(page.locator(".toast").last()).toContainText("任务已完成");
    await expect(page.locator(".plan-task-table tr", { hasText: taskTitle })).toContainText("客户确认关键参数");

    const cancelTitle = `改期取消动作-${runId}`;
    await page.locator("#planTaskNewButton").click();
    await page.locator("#planTaskTitleInput").fill(cancelTitle);
    await page.locator("#planTaskDueInput").fill(localDateTime(todayDue));
    await page.locator("#savePlanTaskButton").click();
    await expect(page.locator("#appModal")).not.toHaveClass(/active/);
    const cancelRow = page.locator(".plan-task-table tr", { hasText: cancelTitle });

    const selectedTaskChecks = page.locator("[data-plan-task-check]:checked");
    for (let index = (await selectedTaskChecks.count()) - 1; index >= 0; index -= 1) {
      await selectedTaskChecks.nth(index).uncheck();
    }
    await cancelRow.locator("[data-plan-task-check]").check();
    await page.locator("#planTaskPushSelectedButton").click();
    await expect(page.locator(".toast").last()).toContainText("已推送 1 条计划任务到待办");
    const pushedTodos = await apiFromPage<{ todos: Array<{ id: string; title: string }> }>(page, "/api/todos");
    const pushedTodo = pushedTodos.todos.find((todo) => todo.title === cancelTitle);
    expect(pushedTodo).toBeTruthy();

    const memosBefore = await apiFromPage<{ memos: Array<{
      id: string;
      title: string;
      category: string;
      tags: string;
      content: string;
      pinned: boolean;
      customerId: string;
      dealId: string;
    }> }>(page, "/api/memos");
    const previousPlanMemo = memosBefore.memos.find((memo) => memo.title === "计划任务执行方案");
    await page.locator("#planMemoButton").click();
    await expect(page.locator(".toast").last()).toContainText(/计划任务已写入备忘|计划任务备忘已更新/);
    const memosAfter = await apiFromPage<{ memos: Array<{ id: string; title: string; content: string }> }>(page, "/api/memos");
    const planMemo = memosAfter.memos.find((memo) => memo.title === "计划任务执行方案");
    expect(planMemo?.content).toContain(cancelTitle);

    await cancelRow.locator("[data-plan-reschedule]").click();
    await page.locator("#planTaskRescheduleDue").fill(localDateTime(rescheduledDue));
    await page.locator("#planTaskRescheduleReason").fill("等待客户补充图纸");
    await page.locator("#confirmPlanTaskReschedule").click();
    await expect(page.locator(".toast").last()).toContainText("计划时间已调整");
    await page.locator(".plan-task-table tr", { hasText: cancelTitle }).locator("[data-plan-cancel]").click();
    await page.locator("#planTaskCancelReason").fill("客户项目暂停，暂不继续推进");
    await page.locator("#confirmPlanTaskCancel").click();
    await expect(page.locator(".plan-task-table tr", { hasText: cancelTitle })).toContainText("客户项目暂停");

    const downloadPromise = page.waitForEvent("download");
    await page.locator("#planExportButton").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("计划任务执行表");
    await expect(page.locator(".toast").last()).toContainText("计划任务执行表已导出");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("#plan-growth .plan-task-stats")).toBeVisible();
    await expect(page.locator("#plan-growth .head-actions")).toBeVisible();
    const mobileLayout = await page.evaluate(() => {
      const taskList = document.querySelector<HTMLElement>("#plan-growth .plan-task-list");
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        taskListClientWidth: taskList?.clientWidth || 0,
        taskListScrollWidth: taskList?.scrollWidth || 0
      };
    });
    expect(mobileLayout.documentWidth).toBeLessThanOrEqual(mobileLayout.viewportWidth);
    expect(mobileLayout.taskListScrollWidth).toBeGreaterThan(mobileLayout.taskListClientWidth);

    if (pushedTodo) {
      await apiFromPage(page, `/api/todos/${pushedTodo.id}`, { method: "DELETE" });
    }
    if (planMemo) {
      if (previousPlanMemo) {
        await apiFromPage(page, `/api/memos/${previousPlanMemo.id}`, {
          method: "PATCH",
          body: {
            title: previousPlanMemo.title,
            category: previousPlanMemo.category,
            tags: previousPlanMemo.tags,
            content: previousPlanMemo.content,
            pinned: previousPlanMemo.pinned,
            customerId: previousPlanMemo.customerId,
            dealId: previousPlanMemo.dealId
          }
        });
      } else {
        await apiFromPage(page, `/api/memos/${planMemo.id}`, { method: "DELETE" });
        await apiFromPage(page, `/api/memos/${planMemo.id}/permanent`, { method: "DELETE" });
      }
    }

    for (const title of [taskTitle, cancelTitle, templateTitle ? `训练：${templateTitle}` : ""]) {
      if (!title) continue;
      const row = page.locator(".plan-task-table tr", { hasText: title }).first();
      if (!await row.count()) continue;
      await row.locator("[data-plan-delete]").click();
      await page.locator("#confirmActionButton").click();
      await expect(page.locator(".plan-task-table tr", { hasText: title })).toHaveCount(0);
    }
  });

  test("todo list sorts unfinished first and newest first", async ({ page }) => {
    const older = `排序较早待办-${runId}`;
    const newer = `排序较新待办-${runId}`;

    await openView(page, "todo");
    await page.getByRole("button", { name: "新增待办" }).click();
    await page.locator("#todoTitleInput").fill(older);
    await page.locator("#saveTodoButton").click();
    await expect(page.locator("#todo .todo-list")).toContainText(older);

    await page.waitForTimeout(20);
    await page.getByRole("button", { name: "新增待办" }).click();
    await page.locator("#todoTitleInput").fill(newer);
    await page.locator("#saveTodoButton").click();

    await expect(page.locator("#todo .todo-list .todo-row").first()).toContainText(newer);
    await page.locator("#todo .todo-row", { hasText: newer }).first().locator(".todo-check").click();
    await expect(page.locator("#todo .todo-list .todo-row").first()).toContainText(older);
  });

  test("next-day todos move into history list", async ({ page }) => {
    const title = `历史归档待办-${runId}`;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const pad = (value: number) => String(value).padStart(2, "0");
    const yesterdayText = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())} 09:30`;

    await openView(page, "todo");
    await page.getByRole("button", { name: "新增待办" }).click();
    await page.locator("#todoTitleInput").fill(title);
    await page.locator("#todoDueInput").fill(yesterdayText);
    await page.locator("#saveTodoButton").click();

    await expect(page.locator("#todo .todo-list .todo-row", { hasText: title })).toHaveCount(0);
    await expect(page.locator("#todo .todo-history")).not.toHaveAttribute("open", "");
    await page.locator("#todo .todo-history-head").click();
    await expect(page.locator("#todo .todo-history")).toHaveAttribute("open", "");
    await expect(page.locator("#todo .todo-history-list")).toContainText(title);
    await expect(page.locator("#todo .todo-history-row", { hasText: title })).toContainText("历史归档");
    await expect(page.locator("#todo .todo-history-row", { hasText: title }).locator("[data-todo-restore]")).toBeVisible();
    await expect(page.locator("#todo .todo-history-row", { hasText: title })).not.toContainText("资料/考试");
    const historyChip = page.locator("#todo .todo-chip", { hasText: "历史清单" }).first();
    await expect(historyChip).toContainText("历史清单");
    await expect(historyChip).not.toContainText("资料/考试");
    await historyChip.click();
    await expect(page.locator("#todo .todo-list .todo-row", { hasText: title })).toContainText("历史归档");
    await expect(page.locator("#todo-history-count")).toHaveText(/[1-9]\d* 条/);
    await page.locator("#todo .todo-list .todo-row", { hasText: title }).first().locator("[data-todo-restore]").click();
    await expect(page.locator(".toast").last()).toContainText("已恢复到今日清单");
    await page.locator("#todo .todo-chip").first().click();
    const restoredRow = page.locator("#todo .todo-list .todo-row", { hasText: title }).first();
    await expect(restoredRow.locator(".badge")).toContainText("其它");
    await expect(restoredRow.locator(".badge")).not.toContainText("历史归档");
  });

  test("customer page can create and inspect a customer", async ({ page }) => {
    const company = `示例产品自动化-${runId}`;
    const companyEdited = `${company}-已编辑`;
    const deleteCompanyA = `批量客户A-${runId}`;
    const deleteCompanyB = `批量客户B-${runId}`;
    await openView(page, "customers", '[data-customer-outcome="won"]');
    await expect(page.locator("#customers tbody tr", { hasText: "Evergreen GmbH" }).first()).toBeVisible();

    const wonCustomerRow = page.locator("#customers tbody tr", { hasText: "Evergreen GmbH" }).first();
    await expect(wonCustomerRow.locator(".customer-value-cell")).toContainText("A");
    await expect(wonCustomerRow.locator(".customer-value-cell")).toContainText("已成交 1 次");
    await wonCustomerRow.locator("[data-open-customer-page]").click();
    await expect(page.locator("#customer-detail")).toHaveClass(/active/);
    await expect(page.locator("#customerDetailPage")).toContainText("客户信息");
    await expect(page.locator("#customerDetailPage")).toContainText("Evergreen GmbH 复购订单");
    await expect(page.locator("#customerDetailPage")).toContainText("跟进记录");
    await expect(page.locator("#customerDetailPage")).toContainText("联系中心");
    const whatsappAction = page.locator("#customerDetailPage [data-customer-page-whatsapp]");
    await expect(whatsappAction).toBeDisabled();
    await expect(whatsappAction).toHaveAttribute("title", /未维护/);
    await expect(page.locator("#customerDetailPage")).toContainText("企业微信待接入");
    await page.locator("#customerDetailPage [data-customer-page-back]").click();
    await expect(page.locator("#customers")).toHaveClass(/active/);

    await openView(page, "customers");
    const activeCustomerRow = page.locator("#customers tbody tr", { hasText: "Nordic Tools AB" }).first();
    await expect(activeCustomerRow.locator(".customer-name")).toHaveClass(/has-active-deal/);
    await activeCustomerRow.locator("td").nth(2).click();
    await expect(page.locator("#customerDrawer")).not.toHaveClass(/open/);
    await activeCustomerRow.locator(".customer-name").click();
    await expect(page.locator("#customerDrawer")).toHaveClass(/open/);
    await expect(page.locator("#customerDrawer")).toContainText("相关商机进展");
    await expect(page.locator("#customerDrawer")).toContainText("Nordic Tools 年度采购");
    await expect(page.locator("#customerDrawer")).toContainText("Shirley");
    await page.locator("#customerDrawerClose").click();
    await expect(page.locator("#customerDrawer")).not.toHaveClass(/open/);

    await page.locator("#customers .page-head .btn.primary").click();
    await page.locator("#customerCompanyInput").fill(company);
    await page.locator("#customerContactInput").fill("Test Contact");
    await page.locator("#saveCustomerButton").click();

    await expect(page.locator("#customers tbody")).toContainText(company);
    const createdCustomerRow = page.locator("#customers tbody tr", { hasText: company }).first();
    await expect(createdCustomerRow.locator(".customer-name")).not.toHaveClass(/has-active-deal/);
    await expect(page.locator("#customerDrawer")).not.toHaveClass(/open/);
    await createdCustomerRow.locator(".customer-name").click();
    await expect(page.locator("#customerDrawer")).toContainText(company);
    await expect(page.locator("#customerDrawer")).toContainText("暂无关联商机");
    await expect(page.locator("#customerDrawer")).toContainText("暂无活跃商机");
    await expect(page.locator("#customerDrawer")).toContainText("活跃商机数");
    await expect(page.locator(".toast").last()).toContainText("客户已新增");

    await page.locator("#customerDrawer [data-edit-customer-drawer]").first().click();
    await page.locator("#customerCompanyInput").fill(companyEdited);
    await page.locator("#customerGradeInput").selectOption("B");
    await page.locator("#customerHealthInput").fill("66");
    await page.locator("#customerReminderInput").fill("明天 18:00");
    await page.locator("#saveCustomerButton").click();
    await expect(page.locator(".toast").last()).toContainText("客户已保存");
    await expect(page.locator("#customers tbody")).toContainText(companyEdited);
    await expect(page.locator("#customerDrawer")).toContainText("明天 18:00");
    await expect(page.locator("#customerDrawer")).toContainText("B · 重点");
    await expect(page.locator("#customerDrawer")).toContainText("66%");

    await page.locator("#customerDrawer [data-open-customer-page]").click();
    await expect(page.locator("#customer-detail")).toHaveClass(/active/);
    await expect(page.locator("#customerDetailPage")).toContainText("B · 重点");
    await expect(page.locator("#customerDetailPage")).toContainText("尚未成交");
    await expect(page.locator("#customerDetailPage")).toContainText("人工评分，低于 60 进入风险提醒");

    const followContent = `确认参数与报价-${runId}`;
    await page.locator("#customerDetailPage [data-customer-page-follow]").first().click();
    await page.locator("#customerFollowType").selectOption("email");
    await page.locator("#customerFollowContent").fill(followContent);
    await page.locator("#customerFollowNext").fill("后天 10:30");
    await page.locator("#saveCustomerFollowButton").click();
    await expect(page.locator("#customer-detail")).toHaveClass(/active/);
    await expect(page.locator("#customerDetailPage .customer-page-followups")).toContainText(followContent);
    await expect(page.locator("#customerDetailPage")).toContainText("后天 10:30");
    await page.reload();
    await openView(page, "customers");
    await page.locator("#customers tbody tr", { hasText: companyEdited }).first().locator(".customer-name").click();
    await expect(page.locator("#customerDrawer .timeline")).toContainText(followContent);
    await expect(page.locator("#customerDrawer")).toContainText("B · 重点");
    await expect(page.locator("#customerDrawer")).toContainText("66%");
    await page.locator("#customerDrawerClose").click();

    for (const name of [deleteCompanyA, deleteCompanyB]) {
      await page.locator("#customers .page-head .btn.primary").click();
      await page.locator("#customerCompanyInput").fill(name);
      await page.locator("#customerContactInput").fill("Delete User");
      await page.locator("#saveCustomerButton").click();
      await expect(page.locator("#customers tbody")).toContainText(name);
    }
    for (const name of [deleteCompanyA, deleteCompanyB]) {
      await page.locator("#customers tbody tr", { hasText: name }).first().locator("[data-select-customer]").check();
    }
    await expect(page.locator("#customers .toolbar")).toContainText("已选 2 个客户");
    await page.locator("#customers [data-bulk-delete-customers]").click();
    await expect(page.locator("#appModal")).toHaveClass(/active/);
    await page.locator("#confirmVerificationInput").fill("2");
    await page.locator("#confirmActionButton").click();
    await expect(page.locator(".toast").last()).toContainText("已批量删除 2 个客户");
    await expect(page.locator("#customers tbody")).not.toContainText(deleteCompanyA);
    await expect(page.locator("#customers tbody")).not.toContainText(deleteCompanyB);
  });

  test("customer work queue is responsive and drawer does not block navigation", async ({ page }) => {
    await openView(page, "customers");
    await expect(page.locator("#customerSearchInput")).toBeVisible();
    await page.locator("#customerSearchInput").fill("Nordic Tools");
    await expect(page.locator("#customers tbody tr")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.locator("#customers tbody tr").locator("td").nth(3).click();
    await expect(page.locator("#customerDrawer")).not.toHaveClass(/open/);
    await page.locator("#customers tbody tr").locator(".customer-name").click();
    await expect(page.locator("#customerDrawer")).toHaveClass(/open/);
    await openView(page, "pipeline");
    await expect(page.locator("#customerDrawer")).not.toHaveClass(/open/);

    await page.setViewportSize({ width: 390, height: 844 });
    await openView(page, "customers");
    await page.locator("#customerFilterReset").click();
    await expect(page.locator("#customerMobileList .customer-mobile-card").first()).toBeVisible();
    const mobileCustomerCard = page.locator("#customerMobileList .customer-mobile-card").first();
    await mobileCustomerCard.locator(".customer-mobile-meta").click();
    await expect(page.locator("#customerDrawer")).not.toHaveClass(/open/);
    await mobileCustomerCard.locator(".customer-name").click();
    await expect(page.locator("#customerDrawer")).toHaveClass(/open/);
    const drawerBox = await page.locator("#customerDrawer").boundingBox();
    expect(drawerBox?.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.locator("#customerDrawer [data-open-customer-page]").click();
    await expect(page.locator("#customer-detail")).toHaveClass(/active/);
    await expect(page.locator("#customerDetailPage .customer-page-summary")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test("customer map renders, rotates and opens regional customers", async ({ page }) => {
    await apiFromPage(page, "/api/customers", {
      method: "POST",
      body: {
        company: `Taiwan Region Customer ${runId}`,
        country: "中国台湾",
        contact: "Regional Buyer",
        stage: "询盘",
        amount: 12000,
        health: 76,
        grade: "B"
      }
    });
    await apiFromPage(page, "/api/customers", {
      method: "POST",
      body: {
        company: `German Region Customer ${runId}`,
        country: "德国",
        contact: "Regional Buyer",
        stage: "询盘",
        amount: 9000,
        health: 72,
        grade: "B"
      }
    });
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);
    await openView(page, "customers");
    await page.locator("#customerViewModeSelect").selectOption("map");
    await expect(page.locator("#customerMapWorkspace")).toBeVisible();
    await expect(page.locator("#customerListWorkspace")).toBeHidden();
    const canvas = page.locator("#customerGlobe canvas");
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(async () => (await fetch("/assets/map/earth-blue-marble.jpg")).ok)).toBeTruthy();
    await expect(page.locator("#customerMapSummary")).toContainText("客户");

    const desktopBox = await canvas.boundingBox();
    expect(desktopBox?.width).toBeGreaterThan(500);
    expect(desktopBox?.height).toBeGreaterThan(500);
    const firstFrame = PNG.sync.read(await canvas.screenshot());
    await page.waitForTimeout(900);
    const secondFrame = PNG.sync.read(await canvas.screenshot());
    const colors = new Set<string>();
    let changedPixels = 0;
    for (let index = 0; index < firstFrame.data.length; index += 64) {
      colors.add(`${firstFrame.data[index]}:${firstFrame.data[index + 1]}:${firstFrame.data[index + 2]}`);
      if (Math.abs(firstFrame.data[index] - secondFrame.data[index]) > 4
        || Math.abs(firstFrame.data[index + 1] - secondFrame.data[index + 1]) > 4
        || Math.abs(firstFrame.data[index + 2] - secondFrame.data[index + 2]) > 4) changedPixels += 1;
    }
    expect(colors.size).toBeGreaterThan(25);
    expect(changedPixels).toBeGreaterThan(100);

    await page.locator('[data-map-market-country="德国"]').click();
    await expect(page.locator("#customerMapRegion")).toContainText("德国");
    await expect(page.locator("#customerMapRegion")).toContainText(`German Region Customer ${runId}`);
    await page.locator('#customerMapRegion [data-map-customer-id]').first().click();
    await expect(page.locator("#customer-detail")).toHaveClass(/active/);
    await expect(page.locator("#customerDetailPage")).toContainText(`German Region Customer ${runId}`);
    await page.locator("#customerDetailPage [data-customer-page-back]").click();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("#customerMapWorkspace")).toBeVisible();
    await expect(canvas).toBeVisible();
    const mobileBox = await canvas.boundingBox();
    expect(mobileBox?.width).toBeLessThanOrEqual(390);
    expect(mobileBox?.height).toBeGreaterThanOrEqual(420);
    const mobileFrame = PNG.sync.read(await canvas.screenshot());
    const mobileColors = new Set<string>();
    for (let index = 0; index < mobileFrame.data.length; index += 64) {
      mobileColors.add(`${mobileFrame.data[index]}:${mobileFrame.data[index + 1]}:${mobileFrame.data[index + 2]}`);
    }
    expect(mobileColors.size).toBeGreaterThan(25);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test("AI background research works for leads and customers", async ({ page }) => {
    await openView(page, "leads");
    const leadRow = page.locator("#leadsTableBody tr", { hasText: "Example Lighting GmbH" }).first();
    await leadRow.locator("[data-open-lead]").click();
    await expect(page.locator("#leadDrawer")).toHaveClass(/open/);
    await page.locator("#leadAiResearchButton").click();
    await expect(page.locator("#ai-research")).toHaveClass(/active/);
    await expect(page.locator("#aiResearchPage")).toContainText("Example Lighting GmbH");
    await expect(page.locator("#aiResearchPage .research-verdict")).toBeVisible();
    await expect(page.locator("#aiResearchPage")).toContainText("业务机会");
    await expect(page.locator("#aiResearchPage")).toContainText("风险核验");
    await expect(page.locator("#aiResearchPage")).toContainText("公司事实");
    await expect(page.locator("#aiResearchPage")).toContainText("关键联系人");
    await expect(page.locator("#aiResearchPage")).toContainText("证据来源");
    await expect(page.locator("#aiResearchPage .badge")).toHaveCount(0);
    await page.evaluate(() => (document.querySelector("#aiResearchPage [data-research-back]") as HTMLElement | null)?.click());
    await expect(page.locator("#leads")).toHaveClass(/active/);

    await openView(page, "customers", '[data-customer-outcome="won"]');
    const customerRow = page.locator("#customers tbody tr", { hasText: "Evergreen GmbH" }).first();
    await customerRow.locator("[data-open-customer-page]").click();
    await page.locator("#customerDetailPage [data-customer-page-research]").click();
    await expect(page.locator("#ai-research")).toHaveClass(/active/);
    await expect(page.locator("#aiResearchPage .research-verdict")).toBeVisible();
    await expect(page.locator("#aiResearchPage")).toContainText("Evergreen GmbH");
    await page.evaluate(() => (document.querySelector("#aiResearchPage [data-research-back]") as HTMLElement | null)?.click());
    await expect(page.locator("#aiResearchPage")).toContainText("成交记录");
    await expect(page.locator("#aiResearchPage .badge")).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test("development email studio checks configuration, drafts and sends", async ({ page }) => {
    await openView(page, "leads");
    await page.locator("#leadsTableBody tr", { hasText: "Example Lighting GmbH" }).first().locator("[data-open-lead]").click();
    await page.locator("#leadDevelopmentEmailButton").click();
    await expect(page.locator("#development-email")).toHaveClass(/active/);
    await expect(page.locator("#developmentEmailPage .mail-studio-editor")).toBeVisible();
    await expect(page.locator("#developmentEmailSubject")).not.toHaveValue("");
    await expect(page.locator("#developmentEmailBody")).toContainText("Example Lighting GmbH");
    await expect(page.locator("#developmentEmailPage .mail-readiness.missing")).toHaveCount(3);
    await expect(page.locator("#developmentEmailPage [data-mail-ai]")).toContainText("配置 AI");
    await expect(page.locator("#developmentEmailPage [data-mail-send]")).toBeDisabled();
    await page.locator("#developmentEmailPage [data-mail-config='profile']").click();
    await expect(page.locator("#profile")).toHaveClass(/active/);
    await expect(page.locator("#profileDevelopmentEmailReady")).toHaveClass(/missing/);

    await apiFromPage(page, "/api/auth/logout", { method: "POST" });
    await page.reload();
    await loginAsAdmin(page);
    await apiFromPage(page, "/api/profile/email-binding", {
      method: "PATCH",
      body: {
        outboundEmail: "admin.sender@example.com",
        emailSenderName: "Admin Sales",
        emailSignature: "Best regards,\nAdmin Sales\nKeduoduo Export",
        smtpHost: "smtp.example.com",
        smtpPort: 465,
        smtpSecure: true,
        smtpUser: "admin.sender@example.com",
        smtpPassword: "test-app-password",
        clearSmtpPassword: false
      }
    });
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);
    await openView(page, "settings");
    await page.locator("#companyProfileName").fill("Keduoduo Export Ltd.");
    await page.locator("#companyProfileWebsite").fill("https://keduoduo.example.com");
    await page.locator("#companyProfileEmail").fill("sales@keduoduo.example.com");
    await page.locator("#companyProfileProducts").fill("industrial lighting and export sourcing solutions");
    await page.locator("#companyProfilePhone").fill("+86 755 0000 0000");
    await page.locator("#companyProfileAddress").fill("Shenzhen, China");
    await page.locator("#companyProfileSaveButton").click();
    await expect(page.locator(".toast").last()).toContainText("公司资料已保存");

    await page.locator("#logoutButton").click();
    await loginAsSales(page);
    await apiFromPage(page, "/api/profile/email-binding", {
      method: "PATCH",
      body: {
        outboundEmail: "shirley.sender@example.com",
        emailSenderName: "Shirley",
        emailSignature: "Best regards,\nShirley\nKeduoduo Export",
        smtpHost: "smtp.example.com",
        smtpPort: 465,
        smtpSecure: true,
        smtpUser: "shirley.sender@example.com",
        smtpPassword: "test-app-password",
        clearSmtpPassword: false
      }
    });
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);

    await openView(page, "leads");
    await page.locator("#leadsTableBody tr", { hasText: "Example Lighting GmbH" }).first().locator("[data-open-lead]").click();
    await page.locator("#leadDevelopmentEmailButton").click();
    await expect(page.locator("#developmentEmailPage .mail-readiness.ready")).toHaveCount(2);
    await page.locator("#developmentEmailSubject").fill(`Cooperation proposal ${runId}`);
    await page.locator("#developmentEmailNext").fill("3 天后");
    await expect(page.locator("#developmentEmailPage [data-mail-send]")).toBeEnabled();
    await page.locator("#developmentEmailPage [data-mail-send]").click();
    await page.getByRole("button", { name: "确认发送" }).click();
    await expect(page.locator(".toast").last()).toContainText("开发信已发送");

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test("contacted deal can generate a quotation draft", async ({ page }) => {
    const dealTitle = `报价单入口-${runId}`;
    const nextActionAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const created = await apiFromPage<{ deal: { id: string } }>(page, "/api/deals", {
      method: "POST",
      body: {
        customerId: "c1",
        title: dealTitle,
        product: "Quotation LED Light",
        quantity: 12,
        unitPrice: 88,
        items: [{ product: "Quotation LED Light", model: "Q-88", quantity: 12, unitPrice: 88 }],
        currency: "USD",
        nextAction: "确认报价要求",
        nextActionAt,
        expectedCloseAt: ""
      }
    });
    await apiFromPage(page, `/api/deals/${created.deal.id}/stage`, {
      method: "PATCH",
      body: {
        stage: "已联系",
        result: "客户已确认产品、数量和报价要求",
        nextAction: "发送正式报价单",
        nextActionAt,
        expectedCloseAt: ""
      }
    });
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);
    await openView(page, "pipeline");

    const card = page.locator("#pipeline .deal", { hasText: dealTitle }).first();
    await expect(card).toContainText("已联系");
    await expect(card.getByRole("button", { name: "生成报价单" })).toBeVisible();
    await card.getByText(dealTitle, { exact: true }).click();
    await expect(page.locator("#drawerGenerateQuotationButton")).toBeVisible();
    await page.locator("#closeDealDrawerButton").click();

    await card.getByRole("button", { name: "生成报价单" }).click();
    await expect(page.locator("#documents")).toHaveClass(/active/);
    await expect(page.locator("#documentTypeTabs button[data-doc-type='QUOTATION']")).toHaveClass(/active/);
    await expect(page.locator("#docBuyerInput")).toHaveValue("Nordic Tools AB");
    await expect(page.locator("#documentPreview")).toContainText("Quotation LED Light");
    await expect(page.locator(".toast").last()).toContainText("生成报价单草稿");
  });

  test("pipeline can create and move a deal", async ({ page }) => {
    test.setTimeout(60_000);
    const dealTitle = `自动化商机-${runId}`;
    const blockedDeal = `无客户商机-${runId}`;
    const lostDeal = `丢单商机-${runId}`;
    await page.evaluate(() => {
      window.print = () => document.body.setAttribute("data-print-called", "true");
    });
    await openView(page, "customers");
    await page.locator("#customers tbody tr", { hasText: "Nordic Tools AB" }).first().getByRole("button", { name: "编辑" }).click();
    await page.locator("#customerCompanyFullNameInput").fill(`Nordic Print Buyer ${runId}`);
    await page.locator("#customerBillingAddressInput").fill("Automation Street 18, Stockholm, Sweden");
    await page.locator("#customerDocumentContactInput").fill("Emma / pi-print@example.com");
    await page.locator("#customerPortDischargeInput").fill("Stockholm");
    await page.locator("#customerIncotermInput").fill("FOB");
    await page.locator("#customerPaymentTermInput").fill("40% deposit, 60% before shipment");
    await page.locator("#saveCustomerButton").click();
    await expect(page.locator("#customers .drawer")).toContainText(`Nordic Print Buyer ${runId}`);
    await openView(page, "pipeline");

    await page.locator("#pipeline .page-head .btn.primary").click();
    await expect(page.locator("#dealCustomerInput")).toHaveValue("");
    await page.locator("#dealTitleInput").fill(dealTitle);
    await page.locator("#dealCustomerInput").fill("Nordic");
    await expect(page.locator("#dealCustomerOptions")).toContainText("Nordic Tools AB");
    await page.locator("#dealCustomerOptions [data-deal-customer-id]").first().click();
    await expect(page.locator("#dealCustomerInput")).toHaveValue("Nordic Tools AB");
    await page.locator("#dealItemsList .deal-item-row").first().locator("[data-deal-item-product]").fill("自动化 LED 工程灯");
    await page.locator("#dealItemsList .deal-item-row").first().locator("[data-deal-item-quantity]").fill("14");
    await page.locator("#dealItemsList .deal-item-row").first().locator("[data-deal-item-price]").fill("2000");
    await expect(page.locator("#dealAmountDisplay")).toHaveText("28,000.00");
    await page.locator("#saveDealButton").click();

    await expect(page.locator("#pipeline .pipeline-strip")).toContainText(dealTitle);
    await expect(page.locator("#pipeline .deal", { hasText: dealTitle }).first()).toContainText("自动化 LED 工程灯");
    const dealCard = () => page.locator("#pipeline .deal", { hasText: dealTitle }).first();
    await expect(dealCard().getByRole("button", { name: "记录进展" })).toBeVisible();
    await expect(dealCard().locator(".deal-more")).toHaveCount(0);
    await expect(dealCard().getByRole("button", { name: "推进阶段" })).toBeVisible();
    await expect(dealCard().getByRole("button", { name: "编辑商机" })).toHaveCount(0);
    await expect(dealCard().getByRole("button", { name: "查看详情" })).toHaveCount(0);
    await dealCard().getByText(dealTitle, { exact: true }).click();
    await expect(page.locator("#dealDrawer")).toHaveClass(/open/);
    await page.locator("#drawerEditDealButton").click();
    await page.locator("#dealItemsList .deal-item-row").first().locator("[data-deal-item-product]").fill("自动化 LED 工程灯");
    await page.locator("#dealItemsList .deal-item-row").first().locator("[data-deal-item-quantity]").fill("16");
    await page.locator("#dealItemsList .deal-item-row").first().locator("[data-deal-item-price]").fill("1800");
    await page.locator("#dealNextActionInput").fill("确认修订报价");
    await expect(page.locator("#dealAmountDisplay")).toHaveText("28,800.00");
    await page.locator("#saveDealButton").click();
    await expect(page.locator(".toast").last()).toContainText("商机已更新");
    await expect(dealCard()).toContainText("自动化 LED 工程灯");
    await expect(dealCard()).toContainText("确认修订报价");
    await page.locator("#closeDealDrawerButton").click();
    await expect(page.locator("#dealDrawerBackdrop")).not.toHaveClass(/open/);

    await dealCard().getByRole("button", { name: "记录进展" }).click();
    await page.locator("#dealEventContentInput").fill("客户确认技术参数，允许准备正式报价");
    await page.locator("#dealEventNextActionInput").fill("安排首次联系结果复核");
    await page.locator("#saveDealEventButton").click();
    await expect(page.locator(".toast").last()).toContainText("商机进展已记录");

    const advanceDeal = async (won = false) => {
      await dealCard().locator("[data-move-deal]").click();
      await page.locator("#dealStageResultInput").fill(won ? "客户已确认订单、金额和付款条件" : "自动化阶段推进结果");
      if (won) await page.locator("#dealWonReasonInput").fill("客户已确认 PI、金额、付款条件与订单日期");
      await page.locator("#confirmDealStageButton").click();
      await expect(page.locator(".toast").last()).toContainText("商机已推进到");
    };

    await advanceDeal();
    await expect(dealCard()).toContainText("已联系");
    await expect(dealCard().getByRole("button", { name: "生成报价单" })).toBeVisible();
    await dealCard().getByRole("button", { name: "生成报价单" }).click();
    await expect(page.locator("#documents")).toHaveClass(/active/);
    await expect(page.locator("#documentPreview")).toContainText("QUOTATION");
    await expect(page.locator("#documentPreview")).toContainText(`Nordic Print Buyer ${runId}`);
    await expect(page.locator("#documentPreview")).toContainText("自动化 LED 工程灯");
    await expect(page.locator(".toast").last()).toContainText("生成报价单草稿");
    await openView(page, "pipeline");
    await advanceDeal();
    await expect(dealCard()).toContainText("已报价");
    await expect(dealCard().getByRole("button", { name: "生成 PI" })).toBeVisible();
    await dealCard().getByRole("button", { name: "生成 PI" }).click();
    await expect(page.locator("#documents")).toHaveClass(/active/);
    await expect(page.locator("#documentPreview")).toContainText("Proforma Invoice");
    await expect(page.locator("#documentPreview")).toContainText(`Nordic Print Buyer ${runId}`);
    await expect(page.locator("#documentPreview")).toContainText("自动化 LED 工程灯");
    await page.locator("#docSellerInput").fill("");
    await expect(page.locator("#docSellerInput")).toHaveValue("");
    await expect(page.locator(".toast").last()).toContainText("请补齐卖方和结算资料后保存");
    await openView(page, "pipeline");
    await advanceDeal();
    await advanceDeal();
    await advanceDeal(true);
    await expect(page.locator("#pipeline .pipeline-strip")).not.toContainText(dealTitle);
    await page.locator("#pipelineClosedPanel").evaluate((node: HTMLDetailsElement) => { node.open = true; });
    await expect(page.locator("#pipeline-archived-deals")).toContainText(dealTitle);
    await page.locator("#pipeline-archived-deals tr", { hasText: dealTitle }).click();
    await expect(page.locator("#dealDrawer")).toHaveClass(/open/);
    await expect(page.locator("#dealDrawer")).toContainText("确认成交");
    await expect(page.locator("#dealDrawer")).toContainText("PI");
    await page.locator("#drawerPrintDealButton").click();
    await expect(page.locator("#documents")).toHaveClass(/active/);
    await expect(page.locator("#documentPreview")).toContainText("Commercial Invoice");
    await expect(page.locator("#documentPreview")).toContainText(`Nordic Print Buyer ${runId}`);
    await openView(page, "pipeline");
    await page.locator("#pipelineClosedPanel").evaluate((node: HTMLDetailsElement) => { node.open = true; });
    await page.locator("#pipeline-archived-deals tr", { hasText: dealTitle }).click();
    await page.locator("#drawerArchiveDealButton").click();
    await expect(page.locator(".toast").last()).toContainText("成交商机已归档");

    await page.locator("#pipeline .page-head .btn.primary").click();
    await page.locator("#dealTitleInput").fill(blockedDeal);
    await page.locator("#dealItemsList .deal-item-row").first().locator("[data-deal-item-product]").fill("待确认产品");
    await expect(page.locator("#dealCustomerInput")).toHaveValue("");
    await page.locator("#saveDealButton").click();
    await expect(page.locator(".toast").last()).toContainText("选择关联客户");
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.locator("#pipeline .pipeline-strip")).not.toContainText(blockedDeal);

    await page.locator("#pipeline .page-head .btn.primary").click();
    await page.locator("#dealTitleInput").fill(lostDeal);
    await page.locator("#dealCustomerInput").fill("Atlas");
    await page.locator("#dealCustomerOptions [data-deal-customer-id]").first().click();
    await page.locator("#dealItemsList .deal-item-row").first().locator("[data-deal-item-product]").fill("丢单测试产品");
    await page.locator("#dealItemsList .deal-item-row").first().locator("[data-deal-item-quantity]").fill("9");
    await page.locator("#dealItemsList .deal-item-row").first().locator("[data-deal-item-price]").fill("1000");
    await page.locator("#saveDealButton").click();
    await expect(page.locator("#pipeline .pipeline-strip")).toContainText(lostDeal);
    const lostCard = page.locator("#pipeline .deal", { hasText: lostDeal }).first();
    await lostCard.getByRole("button", { name: "标记丢单" }).click();
    await page.locator("#dealLostCategoryInput").selectOption({ label: "竞争对手" });
    await page.locator("#dealLostReasonInput").fill("客户选择了本地低价竞品，三个月后复访");
    await page.locator("#dealRevisitAtInput").fill("2026-10-01");
    await page.locator("#confirmDealLostButton").click();
    await expect(page.locator(".toast").last()).toContainText("商机已标记丢单");
    await expect(page.locator("#pipeline .pipeline-strip")).not.toContainText(lostDeal);
    await page.locator("#pipelineClosedPanel").evaluate((node: HTMLDetailsElement) => { node.open = true; });
    await page.locator("#pipelineClosedSearch").fill(lostDeal);
    await page.locator("#pipelineClosedSearch").dispatchEvent("change");
    await expect(page.locator("#pipeline-archived-deals")).toContainText(lostDeal);
    await expect(page.locator("#pipeline-archived-deals")).toContainText("丢单");
    await expect(page.locator("#pipeline-archived-deals")).toContainText("竞争对手");
  });

  test("pipeline mobile view shows one stage and keeps actions usable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openView(page, "pipeline");
    await expect(page.locator("#pipelineStageTabs")).toBeVisible();
    await expect(page.locator("#pipeline .stage:visible")).toHaveCount(1);
    await page.locator("#pipelineStageTabs [data-pipeline-stage-tab='已报价']").click();
    await expect(page.locator("#pipeline .stage:visible")).toHaveAttribute("data-pipeline-stage", "已报价");
    const card = page.locator("#pipeline .stage:visible .deal").first();
    await expect(card).toBeVisible();
    const primaryBox = await card.locator("[data-move-deal]").boundingBox();
    expect(primaryBox?.height).toBeGreaterThanOrEqual(44);
    await expect(card.getByRole("button", { name: "记录进展" })).toBeVisible();
    const secondaryBoxes = await card.locator(".deal-secondary-actions .btn").evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height)
    );
    expect(secondaryBoxes.every((height) => height >= 44)).toBeTruthy();
    await expect(card.getByRole("button", { name: "编辑商机" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "查看详情" })).toHaveCount(0);
    await card.locator(":scope > b").click();
    await expect(page.locator("#dealDrawer")).toHaveClass(/open/);
    const drawerBox = await page.locator("#dealDrawer").boundingBox();
    expect(drawerBox?.width).toBeLessThanOrEqual(391);
    await expect(page.locator("#dealDrawer")).toContainText("商机时间线");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test("commission reconciliation explains amounts and keeps mobile records usable", async ({ page }) => {
    await page.locator("#logoutButton").click();
    await loginAsAdmin(page);
    const month = "2099-11";
    const suffix = Date.now();
    const product = await apiFromPage<{ product: { id: string } }>(page, "/api/commission/products", {
      method: "POST",
      body: { name: `E2E 提成产品 ${suffix}`, model: `E2E-${suffix}`, currency: "USD", defaultPrice: 1000, costPrice: 600 }
    });
    await apiFromPage(page, `/api/commission/products/${product.product.id}/rules`, {
      method: "POST",
      body: { ruleType: "rate", rate: 0.03, effectiveFrom: month, remark: "E2E 3%" }
    });
    const record = await apiFromPage<{ record: { id: string } }>(page, "/api/commission/sales-records", {
      method: "POST",
      body: {
        ownerId: "u_sales_shirley",
        month,
        customerName: `E2E 客户 ${suffix}`,
        productId: product.product.id,
        productName: `E2E 提成产品 ${suffix}`,
        quantity: 2,
        unitPrice: 1000,
        currency: "USD",
        exchangeRate: 7.2,
        exchangeRateDate: `${month}-10`,
        exchangeRateSource: "finance",
        settlementCurrency: "CNY",
        basisType: "receipt",
        basisDate: `${month}-10`,
        status: "confirmed"
      }
    });
    await apiFromPage(page, "/api/commission/calculations/recalculate", {
      method: "POST",
      body: { month, ownerId: "u_sales_shirley" }
    });
    await openView(page, "commission");
    const monthRefresh = page.waitForResponse((response) =>
      response.url().includes(`/api/commission/sales-records?month=${month}`)
    );
    await page.locator("#commissionMonthInput").fill(month);
    await page.locator("#commissionMonthInput").press("Tab");
    await monthRefresh;
    await page.locator("#commissionOwnerInput").selectOption("u_sales_shirley");
    await expect(page.locator("#commissionRecordRows")).toContainText(`E2E 客户 ${suffix}`);
    await expect(page.locator("#commissionRecordRows")).toContainText("CNY");
    const commissionRow = page.locator(`#commissionRecordRows tr[data-commission-record-id="${record.record.id}"]`);
    await expect(commissionRow).toContainText("CNY 432.00");
    await expect(commissionRow).toContainText("已计算");
    await page.locator(`#commissionRecordRows tr[data-commission-record-id="${record.record.id}"] [data-view-commission-detail]`).click();
    await expect(page.locator("#appModal")).toContainText("提成额");
    await expect(page.locator("#appModal")).toContainText("CNY 432.00");
    await expect(page.locator("#appModal")).toContainText("计算公式");
    await page.locator("#appModal [data-modal-close]").last().click();
    await expect(page.locator("#commissionCalculationRows")).toContainText("已计算");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("#commissionRecordCards")).toBeVisible();
    await expect(page.locator("#commissionRecordCards")).toContainText(`E2E 客户 ${suffix}`);
    await expect(page.locator(`#commissionRecordCards [data-commission-record-id="${record.record.id}"]`)).toContainText("提成额");
    await expect(page.locator(`#commissionRecordCards [data-commission-record-id="${record.record.id}"]`)).toContainText("CNY 432.00");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  test("commission row confirmation explains missing fields and succeeds after correction", async ({ page }) => {
    await page.locator("#logoutButton").click();
    await loginAsAdmin(page);
    const month = "2099-12";
    const suffix = `${runId}-confirm`;
    const record = await apiFromPage<{ record: { id: string } }>(page, "/api/commission/sales-records", {
      method: "POST",
      body: {
        ownerId: "u_sales_shirley",
        month,
        customerName: `确认测试客户 ${suffix}`,
        productName: `确认测试产品 ${suffix}`,
        quantity: 1,
        unitPrice: 500,
        currency: "USD",
        exchangeRate: 7.2,
        exchangeRateDate: "",
        exchangeRateSource: "pending",
        settlementCurrency: "CNY",
        basisType: "receipt",
        basisDate: "",
        status: "draft"
      }
    });

    await openView(page, "commission");
    const monthRefresh = page.waitForResponse((response) =>
      response.url().includes(`/api/commission/sales-records?month=${month}`)
    );
    await page.locator("#commissionMonthInput").fill(month);
    await page.locator("#commissionMonthInput").press("Tab");
    await monthRefresh;
    await page.locator("#commissionOwnerInput").selectOption("u_sales_shirley");
    const row = page.locator(`#commissionRecordRows tr[data-commission-record-id="${record.record.id}"]`);
    await expect(row.locator("[data-confirm-commission-record]")).toHaveCount(0);
    const completeButton = row.locator("[data-complete-commission-record]");
    await expect(completeButton).toHaveText("补齐资料");
    await completeButton.click();
    await expect(page.locator("#appModal")).toHaveClass(/active/);
    await expect(page.locator("#modalTitle")).toHaveText("编辑售卖记录");

    await page.locator("#commissionRecordExchangeDateInput").fill(`${month}-10`);
    await page.locator("#commissionRecordExchangeSourceInput").selectOption("finance");
    await page.locator("#commissionRecordBasisDateInput").fill(`${month}-10`);
    await page.locator("#commissionRecordEditNoteInput").fill("补齐确认所需的汇率和计提日期");
    await page.locator("#saveCommissionRecordButton").click();
    await expect(page.locator("#appModal")).not.toHaveClass(/active/);

    await row.locator("[data-confirm-commission-record]").click();
    await expect(row).toContainText("已确认");
    await expect(row.locator("[data-confirm-commission-record]")).toHaveCount(0);
    await expect(page.locator(".toast").last()).toContainText("销售记录已确认");
  });

  test("commission locked month disables row edits and rejects confirmation", async ({ page }) => {
    await page.locator("#logoutButton").click();
    await loginAsAdmin(page);
    const month = "2099-10";
    const seedRecord = await apiFromPage<{ record: { id: string } }>(page, "/api/commission/sales-records", {
      method: "POST",
      body: {
        ownerId: "u_sales_shirley",
        month,
        customerName: `锁定测试客户 ${runId}`,
        productName: `锁定测试产品 ${runId}`,
        quantity: 1,
        unitPrice: 100,
        currency: "CNY",
        exchangeRate: 1,
        exchangeRateDate: `${month}-10`,
        exchangeRateSource: "finance",
        settlementCurrency: "CNY",
        basisType: "receipt",
        basisDate: `${month}-10`,
        status: "confirmed"
      }
    });
    const recalculated = await apiFromPage<{ changedCalculations: Array<{ id: string }> }>(page, "/api/commission/calculations/recalculate", {
      method: "POST",
      body: { month, ownerId: "u_sales_shirley" }
    });
    const calculationId = recalculated.changedCalculations[0].id;
    await apiFromPage(page, `/api/commission/calculations/${calculationId}/review`, { method: "POST" });
    await apiFromPage(page, `/api/commission/calculations/${calculationId}/lock`, { method: "POST" });
    const lateRecord = await apiFromPage<{ record: { id: string } }>(page, "/api/commission/sales-records", {
      method: "POST",
      body: {
        ownerId: "u_sales_shirley",
        month,
        customerName: `锁定后新增客户 ${runId}`,
        productName: `锁定后新增产品 ${runId}`,
        quantity: 1,
        unitPrice: 200,
        currency: "CNY",
        exchangeRate: 1,
        exchangeRateDate: `${month}-11`,
        exchangeRateSource: "finance",
        settlementCurrency: "CNY",
        basisType: "receipt",
        basisDate: `${month}-11`,
        status: "draft"
      }
    });

    await openView(page, "commission");
    const monthRefresh = page.waitForResponse((response) =>
      response.url().includes(`/api/commission/sales-records?month=${month}`)
    );
    await page.locator("#commissionMonthInput").fill(month);
    await page.locator("#commissionMonthInput").press("Tab");
    await monthRefresh;
    await page.locator("#commissionOwnerInput").selectOption("u_sales_shirley");
    const row = page.locator(`#commissionRecordRows tr[data-commission-record-id="${lateRecord.record.id}"]`);
    await expect(row.locator("[data-edit-commission-record]")).toHaveCount(0);
    await expect(row.locator("[data-confirm-commission-record]")).toHaveCount(0);
    await expect(row.getByRole("button", { name: "本月已锁定" })).toBeDisabled();

    const rejection = await page.evaluate(async ({ recordId }) => {
      const csrfToken = document.cookie
        .split("; ")
        .find((part) => part.startsWith("gj_csrf="))
        ?.split("=")
        .slice(1)
        .join("=");
      const response = await fetch(`/api/commission/sales-records/${recordId}/confirm`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(csrfToken ? { "x-csrf-token": decodeURIComponent(csrfToken) } : {})
        }
      });
      return { status: response.status, body: await response.json() };
    }, { recordId: lateRecord.record.id });
    expect(rejection.status).toBe(400);
    expect(rejection.body.message).toContain("本月提成单已锁定");
    expect(seedRecord.record.id).toBeTruthy();
  });

  test("reminders and import export modules perform real actions", async ({ page }) => {
    const reminderTitle = `自动化提醒-${runId}`;
    const importedCustomer = `Excel导入客户-${runId}`;
    const reminderCustomer = await apiFromPage<{ customer: { id: string } }>(page, "/api/customers", {
      method: "POST",
      body: {
        company: `提醒规则客户-${runId}`,
        country: "德国",
        contact: "Test Buyer"
      }
    });
    await apiFromPage(page, `/api/customers/${reminderCustomer.customer.id}/activities`, {
      method: "POST",
      body: {
        type: "note",
        content: "用于验证数据库提醒任务生成"
      }
    });
    await openView(page, "reminders");
    await page.locator("#reminders .page-head .btn.primary").click();
    await page.locator("#reminderTitleInput").fill(reminderTitle);
    await page.locator("#reminderRuleTypeInput").selectOption("inactive_customer");
    await page.locator("#reminderStageInput").selectOption("已报价");
    await page.locator("#reminderDaysInput").fill("0");
    await page.locator("#reminderPriorityInput").selectOption("high");
    await page.locator("#reminderGenerateTodoInput").check();
    await page.locator("#saveReminderButton").click();
    await expect(page.locator("#reminders .task-list")).toContainText(reminderTitle);
    await expect(page.locator("#reminders .task", { hasText: reminderTitle }).first()).toContainText("生成待办");
    await page.locator("#reminders .task", { hasText: reminderTitle }).first().getByRole("button", { name: "手工运行" }).click();
    await page.getByRole("button", { name: "运行规则" }).click();
    await expect(page.locator(".toast").last()).toContainText("手工运行完成");
    await expect(page.locator("#reminders .task", { hasText: reminderTitle }).first()).toContainText("最近运行");
    const generatedTodos = await apiFromPage<{ todos: Array<{ title: string; reminderRuleId?: string }> }>(page, "/api/todos");
    expect(generatedTodos.todos.some((todo) => todo.title.includes(reminderTitle))).toBe(true);
    await page.getByRole("tab", { name: "待执行提醒" }).click();
    const reminderTask = page.locator("#reminders .reminder-task-card", { hasText: reminderTitle }).first();
    await expect(reminderTask).toBeVisible();
    await reminderTask.getByRole("button", { name: "记录结果" }).click();
    await page.locator("#reminderResultNote").fill("客户已回复，等待确认数量");
    await page.locator("#saveReminderResult").click();
    await expect(page.locator(".toast").last()).toContainText("跟进结果已记录");

    await openView(page, "tools");
    await page.locator('[data-tool-view="imports"]').click();
    await expect(page.locator("#imports")).toHaveClass(/active/);
    await page.locator("#customerImportInput").setInputFiles({
      name: `customers-${runId}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: buildCustomerWorkbookBuffer(importedCustomer)
    });
    await expect(page.locator("#customerImportFileName")).toContainText(`customers-${runId}.xlsx`);
    await page.locator("#runCustomerImportButton").click();
    await expect(page.locator(".toast").last()).toContainText("导入完成");
    await expect(page.locator("#imports tbody")).toContainText("客户导入");
    await openView(page, "customers");
    await expect(page.locator("#customers tbody")).toContainText(importedCustomer);
    await openView(page, "tools");
    await page.locator('[data-tool-view="imports"]').click();
    await expect(page.locator("#imports")).toHaveClass(/active/);
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#exportCustomersButton").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("Keduoduo客户清单");
    await expect(page.locator("#imports tbody")).toContainText("客户清单导出");
  });

  test("reminders mobile view keeps the action queue readable and touchable", async ({ page }) => {
    const customer = await apiFromPage<{ customer: { id: string } }>(page, "/api/customers", {
      method: "POST",
      body: { company: `移动提醒客户-${runId}`, country: "德国", contact: "Test Buyer" }
    });
    await apiFromPage(page, `/api/customers/${customer.customer.id}/activities`, {
      method: "POST",
      body: { type: "note", content: "用于验证数据库提醒任务生成" }
    });
    const rule = await apiFromPage<{ reminder: { id: string } }>(page, "/api/reminders", {
      method: "POST",
      body: { title: `移动提醒-${runId}`, ruleType: "inactive_customer", targetStage: "已报价", days: 0, dueAt: "按触发日期生成", channel: "站内", priority: "high", generateTodo: true }
    });
    const run = await apiFromPage<{ createdCount: number }>(page, `/api/reminders/${rule.reminder.id}/run`, { method: "POST" });
    expect(run.createdCount).toBeGreaterThan(0);
    await page.reload();
    await page.setViewportSize({ width: 390, height: 844 });
    await openView(page, "reminders");
    await expect(page.getByRole("tab", { name: "待执行提醒" })).toHaveClass(/active/);
    const card = page.locator("#reminders .reminder-task-card", { hasText: `移动提醒-${runId}` }).first();
    await expect(card).toBeVisible();
    const resultButton = card.getByRole("button", { name: "记录结果" });
    const snoozeButton = card.getByRole("button", { name: "延期" });
    expect((await resultButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect((await snoozeButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await snoozeButton.click();
    const expectedSnoozeAt = await page.evaluate(() => {
      const next = new Date();
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
      const pad = (value: number) => String(value).padStart(2, "0");
      return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T09:00`;
    });
    await expect(page.locator("#reminderSnoozeAt")).toHaveValue(expectedSnoozeAt);
    await page.getByRole("button", { name: "取消" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test("document studio creates PI/CI documents and exports PDF task", async ({ page }) => {
    const docTitle = `自动化商业发票-${runId}`;
    await page.evaluate(() => {
      window.print = () => document.body.setAttribute("data-print-called", "true");
    });
    await openView(page, "documents");
    await expect(page.locator("#documents .doc-studio")).toBeVisible();
    await page.locator("#documentTypeTabs button[data-doc-type='CI']").click();
    await page.locator("#newDocumentButton").click();
    await expect(page.locator("#documentPreview")).toContainText(/Proforma Invoice|Commercial Invoice/);

    await page.locator("#docTitleInput").fill(docTitle);
    await page.locator("#docBuyerInput").fill(`发票客户-${runId}`);
    await page.locator("#docSellerInput").fill("Automation Export Test Co., Ltd.");
    await page.locator("#docSellerAddressInput").fill("Shanghai, China");
    await page.locator("#docPortDischargeInput").fill("Hamburg");
    await page.locator("#docTemplateInput").selectOption("classic");
    await page.locator("#documentItemsEditor .doc-item-grid").first().locator("[data-doc-field='product']").fill("LED High Bay Light With Very Long Product Name For Wrapping Test");
    await page.locator("#documentItemsEditor .doc-item-grid").first().locator("[data-doc-field='hsCode']").fill("940511");
    await page.locator("#documentItemsEditor .doc-item-grid").first().locator("[data-doc-field='quantity']").fill("5");
    await page.locator("#documentItemsEditor .doc-item-grid").first().locator("[data-doc-field='unitPrice']").fill("210");
    await page.locator("#addDocumentItemButton").click();
    await page.locator("#documentItemsEditor .doc-item-grid").nth(1).locator("[data-doc-field='product']").fill("LED Linear Light");
    await page.locator("#documentItemsEditor .doc-item-grid").nth(1).locator("[data-doc-field='quantity']").fill("8");
    await page.locator("#documentItemsEditor .doc-item-grid").nth(1).locator("[data-doc-field='unitPrice']").fill("48");

    await expect(page.locator("#documentPreview")).toContainText("Commercial Invoice");
    await expect(page.locator("#documentPreview")).toContainText("Automation Export Test Co., Ltd.");
    await expect(page.locator("#documentPreview")).toContainText("LED High Bay Light");
    await expect(page.locator("#documentPreview")).toContainText("HS Code");
    const tableFitsPaper = await page.locator("#documentPreview").evaluate((paper) => {
      const table = paper.querySelector("table");
      if (!table) return false;
      return table.getBoundingClientRect().right <= paper.getBoundingClientRect().right + 1;
    });
    expect(tableFitsPaper).toBe(true);
    await page.locator("#saveDocumentButton").click();
    await expect(page.locator(".toast").last()).toContainText("单据配置已保存到数据库");
    await expect(page.locator("#documentList")).toContainText(docTitle);

    await page.once("dialog", (dialog) => dialog.accept("确认客户、付款条款和交期"));
    await page.locator("#documentSubmitApprovalButton").click();
    await page.locator("#confirmDocumentApprovalSubmitButton").click();
    await expect(page.locator("#docStatusBadge")).toContainText("待审批");
    await page.locator("#documentApproveButton").click();
    await expect(page.locator("#docStatusBadge")).toContainText("已审批");
    await page.locator("#saveDocumentButton").click();
    await expect(page.locator(".toast").last()).toContainText("不能直接覆盖");
    await page.locator("#documentSendButton").click();
    await page.locator("#documentSendRecipientInput").fill(`buyer-${runId}@example.com`);
    await page.locator("#confirmDocumentSendButton").click();
    await expect(page.locator(".toast").last()).toContainText("发送记录已保存");

    const approvedNumber = await page.locator("#docNumberInput").inputValue();
    const changedBuyer = `修改后的买方-${runId}`;
    await page.locator("#docBuyerInput").fill(changedBuyer);

    const pdfDownloadPromise = page.waitForEvent("download");
    await page.locator("#exportDocumentPdfButton").click();
    await expect(page.locator("#docBuyerInput")).toHaveValue(changedBuyer);
    await expect(page.locator("#documentPreview")).toContainText(changedBuyer);
    await expect(page.locator("#docStatusBadge")).toContainText("已配置 · v2");
    await expect(page.locator("#documentList")).toContainText(`${docTitle} v2`);
    const documentVersions = await apiFromPage<{ documents: Array<{ number: string; status: string; buyer: string }> }>(page, "/api/trade-documents");
    expect(documentVersions.documents.some((document) => document.number === approvedNumber && document.status === "approved" && document.buyer !== changedBuyer)).toBe(true);
    const pdfDownload = await pdfDownloadPromise;
    expect(pdfDownload.suggestedFilename()).toContain("-CI.pdf");
  });

  test("document workflow remains usable on mobile", async ({ page }) => {
    await openView(page, "documents");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("#documents .doc-workflow-bar")).toBeVisible();
    await expect(page.locator("#docCustomerInput")).toBeVisible();
    await expect(page.locator("#documentSubmitApprovalButton")).toBeVisible();
    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      workflowWidth: document.querySelector<HTMLElement>(".doc-workflow-bar")?.getBoundingClientRect().width || 0
    }));
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.workflowWidth).toBeLessThanOrEqual(layout.viewport - 24);
  });

  test("PI can switch to the Longtec template without changing document data", async ({ page }) => {
    await openView(page, "documents");
    await page.locator("#documentTypeTabs button[data-doc-type='PI']").click();
    await page.locator("#newDocumentButton").click();
    await page.locator("#docTitleInput").fill("Longtec PI template test");
    await page.locator("#docNumberInput").fill("PI-LONGTEC-001");
    await page.locator("#docBuyerInput").fill("Cal Tech Automation Pvt Ltd");
    await page.locator("#docBuyerAddressInput").fill("#115, Koskolawatta Pitumpe, Padukka, Sri Lanka");
    await page.locator("#docBuyerContactInput").fill("+94761564916");
    await page.locator("#docSellerInput").fill("HONG KONG NEW LONGTEC CO., LIMITED");
    await page.locator("#docSellerAddressInput").fill("RM917B, BLK A, 9/F., NEW MANDARIN PLAZA, HONG KONG");
    await page.locator("#docIncotermInput").selectOption("DAP");
    await page.locator("#docPaymentInput").fill("100% T/T in advance");
    await page.locator("#docNotesInput").fill("Buyer needs to assume poundage of bank.");
    const item = page.locator("#documentItemsEditor .doc-item-grid").first();
    await item.locator("[data-doc-field='product']").fill("UNI800");
    await item.locator("[data-doc-field='model']").fill("(2016) -BNB");
    await item.locator("[data-doc-field='quantity']").fill("1");
    await item.locator("[data-doc-field='unitPrice']").fill("270");
    await page.locator("#docShippingCostInput").fill("60");

    const before = await page.evaluate(() => ({
      buyer: (document.querySelector<HTMLInputElement>("#docBuyerInput"))?.value,
      seller: (document.querySelector<HTMLInputElement>("#docSellerInput"))?.value,
      product: (document.querySelector<HTMLInputElement>("[data-doc-field='product']"))?.value,
      model: (document.querySelector<HTMLInputElement>("[data-doc-field='model']"))?.value,
      quantity: (document.querySelector<HTMLInputElement>("[data-doc-field='quantity']"))?.value,
      unitPrice: (document.querySelector<HTMLInputElement>("[data-doc-field='unitPrice']"))?.value,
      shippingCost: (document.querySelector<HTMLInputElement>("#docShippingCostInput"))?.value
    }));

    await page.locator("#docTemplateInput").selectOption("longtec");
    await expect(page.locator("#documentPreview")).toHaveClass(/longtec-pi/);
    await expect(page.locator("#documentPreview")).toContainText("PROFORMA INVOICE");
    await expect(page.locator("#documentPreview")).toContainText("Cal Tech Automation Pvt Ltd");
    await expect(page.locator("#documentPreview")).toContainText("UNI800");
    await expect(page.locator("#documentPreview")).toContainText("USD 330");

    await page.locator("#docThemeInput").selectOption("emerald");
    await expect(page.locator("#docTemplateInput")).toHaveValue("longtec");
    const accentColor = await page.locator("#documentPreview").evaluate((node) => getComputedStyle(node).getPropertyValue("--longtec-accent").trim());
    expect(accentColor).toBe("#059669");
    await expect(page.locator(".longtec-pi-table th").first()).toHaveCSS("background-color", "rgb(236, 253, 245)");

    await page.locator("#docLanguageInput").selectOption("ZH");
    await expect(page.locator("#documentPreview")).toContainText("买方");
    await expect(page.locator("#documentPreview")).toContainText("单价");
    await expect(page.locator("#documentPreview")).toContainText("总付款");
    await page.locator("#docLanguageInput").selectOption("EN");

    await page.locator("#docTemplateInput").selectOption("classic");
    await expect(page.locator("#documentPreview")).toHaveClass(/classic/);
    await page.locator("#docTemplateInput").selectOption("longtec");
    const after = await page.evaluate(() => ({
      buyer: (document.querySelector<HTMLInputElement>("#docBuyerInput"))?.value,
      seller: (document.querySelector<HTMLInputElement>("#docSellerInput"))?.value,
      product: (document.querySelector<HTMLInputElement>("[data-doc-field='product']"))?.value,
      model: (document.querySelector<HTMLInputElement>("[data-doc-field='model']"))?.value,
      quantity: (document.querySelector<HTMLInputElement>("[data-doc-field='quantity']"))?.value,
      unitPrice: (document.querySelector<HTMLInputElement>("[data-doc-field='unitPrice']"))?.value,
      shippingCost: (document.querySelector<HTMLInputElement>("#docShippingCostInput"))?.value
    }));
    expect(after).toEqual(before);
    await expect(page.locator("#documentPreview")).toContainText("Total payment");
  });

  test("knowledge and exam pages keep their dense content and key actions", async ({ page }) => {
    test.setTimeout(60_000);
    const assetTitle = `自动化资料-${runId}`;
    const examTitle = `自动化考试-${runId}`;
    const manualQuestion = `${examTitle} 中客户询价产品时第一步确认什么？`;
    await openView(page, "knowledge");
    await expect(page.locator("#knowledge .file-center-layout")).toBeVisible();
    await expect(page.locator("#knowledgeFileList .file-table-row").first()).toBeVisible();

    await page.locator("#knowledgeAddButton").click();
    await page.locator("#assetTitleInput").fill(assetTitle);
    await page.locator("#assetSourceUrlInput").fill(`https://example.test/knowledge/${runId}`);
    await page.locator("#saveAssetButton").click();
    await expect(page.locator("#knowledgeFileList")).toContainText(assetTitle);
    await openView(page, "dashboard");
    await expect(page.locator("#dashboard-knowledge-panel")).toHaveCount(0);

    await openView(page, "exam");
    await expect(page.locator("#examWorkspace")).toBeVisible();
    await expect(page.locator("#examWorkspace .exam-workspace-head")).toContainText("考试管理");
    await page.locator("#examWorkspace [data-exam-bank]").click();
    await expect(page.locator("#question-bank")).toHaveClass(/active/);
    await expect(page.locator("#question-bank h1")).toContainText("基础题库维护");
    await expect(page.locator("#question-bank .question-bank-import-row")).toBeVisible();
    await expect(page.locator("#question-bank .question-bank-list-panel #questionImportInput")).toHaveCount(1);
    await expect(page.locator("#question-bank .question-bank-editor-panel #questionImportInput")).toHaveCount(0);
    await expect(page.locator("#question-bank .question-option-input")).toHaveCount(4);
    await expect(page.locator("#question-bank .question-bank-editor-panel")).not.toContainText("选项 E");
    await expect(page.locator("#question-bank .question-bank-editor-panel")).not.toContainText("选项 F");
    await page.locator("#newQuestionButton").click();
    await page.locator("#questionStemInput").fill(manualQuestion);
    await page.locator("#questionCategoryInput").selectOption("产品知识");
    await page.locator(".question-option-input").nth(0).fill("A选项：确认规格、数量、认证、交期和使用场景");
    await page.locator(".question-option-input").nth(1).fill("B选项：只确认客户公司名称");
    await page.locator(".question-option-input").nth(2).fill("C选项：只确认包装颜色");
    await page.locator(".question-option-input").nth(3).fill("D选项：输出信号、供电和防护等级");
    await page.locator("#questionTypeInput").selectOption("multiple");
    await page.locator("#questionAnswerInput").fill("A,D");
    await page.locator("#questionTagsInput").fill(`产品,自动化,${runId}`);
    await page.locator("#saveQuestionButton").click();
    await expect(page.locator(".toast").last()).toContainText("题目已加入基础题库");
    await expect(page.locator("#questionBankList")).toContainText(manualQuestion);

    await page.locator("#questionImportInput").setInputFiles({
      name: `exam-bank-${runId}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: buildQuestionWorkbookBuffer()
    });
    await page.locator("#importQuestionButton").click();
    await expect(page.locator(".toast").last()).toContainText("题库导入成功：2 道题");
    await expect(page.locator("#questionBankList")).toContainText("Excel导入定制产品");
    await page.locator("#questionBankList .question-bank-row", { hasText: "Excel导入定制产品" }).first().click();
    await page.locator("#deleteQuestionButton").click();
    await page.locator("#confirmActionButton").click();
    await expect(page.locator(".toast").last()).toContainText("题目已删除");
    await page.locator("#exportQuestionButton").click();
    await expect(page.locator(".toast").last()).toContainText("题库已导出");
    await page.locator("#backToExamButton").click();
    await expect(page.locator("#exam")).toHaveClass(/active/);

    await page.locator("#examWorkspace [data-exam-create]").click();
    await page.locator("#examTitleInput").fill(examTitle);
    await page.locator("#examCategoryInput").selectOption("产品知识");
    await page.locator("#selectCategoryQuestionsButton").click();
    await expect(page.locator("#examCreateSelectionSummary")).toContainText(/已选 [1-9]/);
    await page.locator("#saveExamButton").click();
    await expect(page.locator(".toast").last()).toContainText("已组卷");
    await expect(page.locator("#examWorkspaceBody")).toContainText(examTitle);
    await expect(page.locator("#examInspector")).toContainText(examTitle);

    const publishStart = new Date(Date.now() - 60_000).toISOString().slice(0, 16);
    const publishEnd = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
    await page.locator("#examInspector [data-publish-exam]").click();
    await page.locator("#examPublishStart").fill(publishStart);
    await page.locator("#examPublishEnd").fill(publishEnd);
    await page.locator("#confirmPublishExam").click();
    await expect(page.locator(".toast").last()).toContainText("考试已发布");
    await expect(page.locator("#examWorkspaceBody")).toContainText(examTitle);

    await page.locator('[data-exam-mode="mine"]').click();
    await expect(page.locator("#examWorkspaceBody")).toContainText("考试任务");
    await page.locator('[data-exam-mode="results"]').click();
    await expect(page.locator("#examResultDetail")).toContainText(examTitle);
    await page.locator('[data-exam-mode="manage"]').click();

    await page.locator("[data-manage-exam]", { hasText: examTitle }).first().click();
    await page.locator("#examInspector [data-delete-exam]").click();
    await page.locator("#confirmActionButton").click();
    await expect(page.locator(".toast").last()).toContainText("考试已删除");
    await expect(page.locator("#examWorkspaceBody")).not.toContainText(examTitle);
  });

  test("wecom sync and account management are operational", async ({ page }) => {
    const accountName = `Auto Account ${runId}`;
    await openView(page, "wecom");
    await expect(page.locator("#wecom .chat")).toBeVisible();
    await page.locator("#wecom .page-head .btn.primary").click();
    await expect(page.locator("#wecom .chat")).toContainText("已归档");

    await openView(page, "settings");
    await expect(page.locator("#settings tbody")).toContainText("账号管理仅管理员可用");
    await expect(page.locator("#settings .page-head .btn", { hasText: "新增账号" })).toBeDisabled();

    await page.locator("#logoutButton").click();
    await loginWithCredentials(page, "admin@keduoduo.com", "keduoduo123", "Admin");
    await openView(page, "settings");
    await expect(page.locator("#settings tbody")).not.toContainText("Super Admin");
    await page.locator("#settings .page-head .btn", { hasText: "新增账号" }).click();
    await page.locator("#accountNameInput").fill(accountName);
    await page.locator("#accountEmailInput").fill(`auto.account.${runId}@keduoduo.com`);
    await page.locator("#accountPasswordInput").fill(`pw${runId}`);
    await page.locator("#accountRoleInput").selectOption("sales");
    await page.locator("#saveAccountButton").click();
    await expect(page.locator("#settings tbody")).toContainText(accountName);

    await page.locator("#settings tbody tr", { hasText: accountName }).first().getByRole("button", { name: "设密码" }).click();
    await page.locator("#accountNewPasswordInput").fill(`newpw${runId}`);
    await page.locator("#savePasswordButton").click();
    await expect(page.locator(".toast").last()).toContainText("密码已更新");
    await page.locator("#logoutButton").click();
    await loginWithCredentials(page, `auto.account.${runId}@keduoduo.com`, `newpw${runId}`, accountName);
    await expect(page.locator("#settings tbody")).not.toContainText("Super Admin");
    await page.locator("#logoutButton").click();
    await loginWithCredentials(page, "admin@keduoduo.com", "keduoduo123", "Admin");
    await openView(page, "settings");
    await page.locator("#settings tbody tr", { hasText: accountName }).first().getByRole("button", { name: "停用" }).click();
    await expect(page.locator("#settings tbody tr", { hasText: accountName }).first()).toContainText("停用");
    await page.locator("#settings tbody tr", { hasText: accountName }).first().getByRole("button", { name: "删除" }).click();
    await expect(page.locator(".toast").last()).toContainText("账号已删除");
    await expect(page.locator("#settings tbody")).not.toContainText(accountName);
  });

  test("tools OCR recognizes a card and syncs selected fields", async ({ page }) => {
    const company = `Example Trading ${runId} Co., Ltd.`;
    await page.route("**/api/tools/ocr/jobs/current/recognize-image", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          job: {
            id: "ocr_u_sales_shirley",
            status: "recognized",
            confidence: 92,
            fields: {
              company,
              contact: "Test Contact",
              title: "Purchasing Manager",
              email: `buyer.${runId}@example-trading.example`,
              whatsapp: "",
              wechat: "",
              phone: "+49 123 456",
              country: "德国",
              city: "Hamburg"
            },
            ownerId: "u_sales_shirley",
            teamId: "europe",
            hasImage: true,
            imageUrl: "/api/tools/ocr/jobs/current/image"
          }
        })
      });
    });

    await openView(page, "tools");
    await page.locator('[data-tool-view="business-card"]').click();
    await expect(page.locator("#business-card")).toHaveClass(/active/);

    const invalidChooserPromise = page.waitForEvent("filechooser");
    await page.locator("#ocrLoadButton").click();
    const invalidChooser = await invalidChooserPromise;
    await invalidChooser.setFiles({
      name: "not-an-image.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image")
    });
    await expect(page.locator(".toast").last()).toContainText("只支持 PNG、JPG 或 WebP");

    const validPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const validChooserPromise = page.waitForEvent("filechooser");
    await page.locator("#ocrLoadButton").click();
    const validChooser = await validChooserPromise;
    await validChooser.setFiles({
      name: "business-card.png",
      mimeType: "image/png",
      buffer: validPng
    });
    await expect(page.locator("#ocrUploadBadge")).toContainText("名片已安全加载");
    await expect(page.locator("#ocrPreviewCard img")).toBeVisible();
    await page.locator("#ocrRecognizeButton").click();
    await expect(page.locator("#business-card .field-card", { hasText: "公司名" }).locator("input[type='text']")).toHaveValue(company);
    await expect(page.locator("#ocrConfidenceValue")).toHaveText("92%");
    const editedCompany = `OCR 客户-${runId}`;
    await page.locator("#business-card .field-card", { hasText: "公司名" }).locator("input[type='text']").fill(editedCompany);
    await page.locator("#ocrSyncButton").click();

    await expect(page.locator("#business-card .sync-row").nth(2)).toContainText("已同步");
    await expect(page.locator(".toast").last()).toContainText("OCR 线索已同步");
    const leads = await apiFromPage<{ leads: Array<{ company: string }> }>(page, "/api/leads");
    expect(leads.leads.some((lead) => lead.company === editedCompany)).toBe(true);

    await page.locator("#ocrRemoveButton").click();
    await expect(page.locator("#ocrPreviewCard")).toContainText("尚未加载名片");
  });

  test("tools website reference registration stays blocked until authoritative identity resolution", async ({ page }) => {
    await openView(page, "tools");
    await page.locator('[data-tool-view="website-verify"]').click();
    await expect(page.locator("#website-verify")).toHaveClass(/active/);
    const websiteCompany = `example-supplier-${runId}`;
    await page.locator("#websiteUrlInput").fill(`https://example.com/${websiteCompany}`);
    const registrationRequest = page.waitForRequest((request) =>
      request.url().includes("/api/tools/website-scrape/preview")
      && request.method() === "POST"
    );
    await page.locator("#websiteReferenceRegisterButton").click();
    const posted = (await registrationRequest).postDataJSON();
    expect(posted).toEqual({ urls: [`https://example.com/${websiteCompany}`] });
    await expect(page.locator(".toast").last()).toContainText("已登记 1 个官网链接");
    await expect(page.locator("#websiteOpportunityRows")).toContainText("链接登记");
    const websiteRow = page.locator("#websiteOpportunityRows tr[data-website-opportunity-id]").first();
    await expect(
      websiteRow.locator("[data-website-field='website']")
    ).toHaveValue(`https://example.com/${websiteCompany}`);
    const websiteCandidateId = await websiteRow.getAttribute("data-website-opportunity-id");
    expect(websiteCandidateId).toBeTruthy();
    const websiteContactInfo = `buyer.website.${runId}@example.com`;
    await websiteRow.locator("[data-website-field='company']").fill(`官网商机-${runId}`);
    await websiteRow.locator("[data-website-field='business']").fill("LED 工程灯 / 流量产品");
    await websiteRow.locator("[data-website-field='contact']").fill("Website Buyer");
    await websiteRow.locator("[data-website-field='contactInfo']").fill(websiteContactInfo);
    await apiFromPage(page, `/api/prospect-list/${encodeURIComponent(websiteCandidateId!)}/details`, {
      method: "PATCH",
      body: {
        company: `官网商机-${runId}`,
        business: "LED 工程灯 / 流量产品",
        country: await websiteRow.locator("[data-website-field='country']").inputValue(),
        website: await websiteRow.locator("[data-website-field='website']").inputValue(),
        contact: "Website Buyer",
        contactInfo: websiteContactInfo,
        description: await websiteRow.locator("[data-website-field='description']").inputValue()
      }
    });
    await page.locator("#websiteReferenceSyncButton").click();
    await expect(page.locator("#prospect-list")).toHaveClass(/active/);
    await page.locator("#prospectListRows [data-prospect-open]").first().click();
    await expect(page.locator("#prospectDetail")).toContainText("尚未完成正式企业身份归一");
    await expect(page.locator("#prospectResolveIdentityButton")).toBeVisible();
    await openView(page, "leads");
    await expect(page.locator("#leadsTableBody")).not.toContainText(`官网商机-${runId}`);
    await openView(page, "prospect-list");
    await page.locator("#prospectSearchInput").fill(`官网商机-${runId}`);
    await page.locator("#prospectListRows [data-prospect-open]").first().click();
    await expect(page.locator("#prospectDetail")).toContainText("尚未完成正式企业身份归一");
    await expect(page.locator("#prospectResolveIdentityButton")).toBeVisible();
  });

  test("lead management handles structured sources, trash, restore and permanent deletion", async ({ page }) => {
    const company = `线索工作区-${runId}`;
    const externalId = `ALI-RFQ-${runId}`;
    await openView(page, "leads");
    await page.locator("#leadNewButton").click();
    const form = page.locator("#leadCreateForm");
    await form.locator('[name="company"]').fill(company);
    await form.locator('[name="contact"]').fill("Lead Buyer");
    await form.locator('[name="country"]').fill("德国");
    await form.locator('[name="email"]').fill(`lead.${runId}@example.com`);
    await form.locator('[name="phone"]').fill("+49 30 1000 2000");
    await form.locator('[name="source"]').fill("Alibaba RFQ");
    await form.locator('[name="intent"]').selectOption("高");
    await form.locator('[name="estimatedAmount"]').fill("42000");
    await form.locator(".lead-create-advanced summary").click();
    await form.locator('[name="sourceType"]').selectOption("inbound");
    await form.locator('[name="sourceChannel"]').fill("alibaba");
    await form.locator('[name="sourceCampaign"]').fill("2026 Europe RFQ");
    await form.locator('[name="externalId"]').fill(externalId);
    await form.locator('[name="sourceUrl"]').fill(`https://partner.example/rfq/${runId}`);
    await form.locator('[name="nextFollowAt"]').fill("2026-07-12 10:00");
    await form.locator('[name="remark"]').fill("LED 工程灯，首轮确认规格与认证要求");
    await form.getByRole("button", { name: "保存线索" }).click();

    await expect(page.locator(".toast").last()).toContainText("线索已创建");
    await expect(page.locator("#leadDrawer")).not.toHaveClass(/open/);
    const createdRow = page.locator("#leadsTableBody tr", { hasText: company }).first();
    await createdRow.locator(".lead-name").click();
    await expect(page.locator("#leadDrawer")).toHaveClass(/open/);
    await expect(page.locator("#leadDrawer")).toContainText(company);
    await expect(page.locator("#leadDrawer")).toContainText("alibaba");
    await expect(page.locator("#leadDrawer")).toContainText(externalId);
    await expect(page.locator("#leadDrawer")).toContainText("同一业务员");
    await page.locator("#leadDrawer .lead-raw-payload summary").click();
    await expect(page.locator("#leadDrawer .lead-raw-payload")).toContainText("2026 Europe RFQ");

    await page.locator("#leadTrashButton").click();
    await page.locator("#confirmLeadTrashButton").click();
    await expect(page.locator(".toast").last()).toContainText("请填写删除原因");
    await page.locator("#leadDeleteReason").fill("测试垃圾箱审计");
    await page.locator("#confirmLeadTrashButton").click();
    await expect(page.locator(".toast").last()).toContainText("已移入垃圾箱");
    await expect(page.locator("#leadsTableBody")).not.toContainText(company);

    await page.locator("#leadTrashTab").click();
    const trashRow = page.locator("#leadsTableBody tr", { hasText: company }).first();
    await expect(trashRow).toBeVisible();
    await trashRow.locator(".lead-name").click();
    await expect(page.locator("#leadDrawer")).toContainText("测试垃圾箱审计");
    await expect(page.locator("#leadDrawer")).toContainText("计划清理");
    await page.locator("#leadRestoreButton").click();
    await expect(page.locator(".toast").last()).toContainText("已恢复到处理中");

    await page.locator("#leadActiveTab").click();
    const restoredRow = page.locator("#leadsTableBody tr", { hasText: company }).first();
    await expect(restoredRow).toBeVisible();
    await restoredRow.locator(".lead-name").click();
    await page.locator("#leadTrashButton").click();
    await page.locator("#leadDeleteReason").fill("永久删除流程测试");
    await page.locator("#confirmLeadTrashButton").click();
    await page.locator("#leadTrashTab").click();
    await page.locator("#leadsTableBody tr", { hasText: company }).first().locator(".lead-name").click();
    await page.locator("#leadPermanentButton").click();
    await page.locator("#confirmLeadPermanentButton").click();
    await expect(page.locator(".toast").last()).toContainText("请输入“永久删除”");
    await page.locator("#leadPermanentConfirmInput").fill("永久删除");
    await page.locator("#confirmLeadPermanentButton").click();
    await expect(page.locator(".toast").last()).toContainText("来源记录已永久删除");
    await expect(page.locator("#leadsTableBody")).not.toContainText(company);

    const convertedCompany = `已转客户线索-${runId}`;
    await page.locator("#leadActiveTab").click();
    await page.locator("#leadNewButton").click();
    await page.locator('#leadCreateForm [name="company"]').fill(convertedCompany);
    await page.locator('#leadCreateForm [name="source"]').fill("e2e");
    await page.locator("#leadCreateForm").getByRole("button", { name: "保存线索" }).click();
    await expect(page.locator("#leadDrawer")).not.toHaveClass(/open/);
    await page.locator("#leadsTableBody tr", { hasText: convertedCompany }).first().locator(".lead-name").click();
    await page.locator("#leadConvertButton").click();
    await page.locator('input[name="leadCustomerMode"][value="create"]').check();
    await page.locator("#confirmLeadConversionButton").click();
    await expect(page.locator(".toast").last()).toContainText("已入客户");
    await expect(page.locator("#leadDrawer")).toContainText("已转客户");
    await expect(page.locator("#leadTrashButton")).toBeVisible();
  });

  test("lead management uses mobile cards and a full-screen detail drawer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openView(page, "leads");
    await expect(page.locator("#leadMobileList .lead-mobile-card").first()).toBeVisible();
    await expect(page.locator(".lead-desktop-table")).toBeHidden();
    const overflowAudit = await page.evaluate(() => ({
      fits: document.documentElement.scrollWidth <= window.innerWidth,
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      offenders: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.right > window.innerWidth + 1;
        })
        .slice(0, 8)
        .map((element) => ({ tag: element.tagName, id: element.id, className: element.className, right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width) }))
    }));
    expect(overflowAudit.fits, JSON.stringify(overflowAudit)).toBe(true);
    const mobileCard = page.locator("#leadMobileList .lead-mobile-card").first();
    await mobileCard.locator(".lead-mobile-meta").click();
    await expect(page.locator("#leadDrawer")).not.toHaveClass(/open/);
    await mobileCard.locator(".lead-name").click();
    await expect(page.locator("#leadDrawer")).toHaveClass(/open/);
    const drawerBox = await page.locator("#leadDrawer").boundingBox();
    expect(drawerBox?.width).toBe(390);
    expect(drawerBox?.x).toBe(0);
    await page.locator("#leadDrawerClose").click();
    await expect(page.locator("#leadDrawer")).not.toHaveClass(/open/);
  });

  test("lead detail drawer keeps global module navigation available", async ({ page }) => {
    await openView(page, "leads");
    const firstLeadRow = page.locator("#leadsTableBody tr[data-lead-id]").first();
    await firstLeadRow.locator("td").nth(1).click();
    await expect(page.locator("#leadDrawer")).not.toHaveClass(/open/);
    await firstLeadRow.locator(".lead-name").click();
    await expect(page.locator("#leadDrawer")).toHaveClass(/open/);
    await expect(page.locator("#leadDrawerBackdrop")).toHaveClass(/active/);

    await page.locator(".sidebar button[data-view='customers']").first().click();

    await expect(page.locator("#customers")).toHaveClass(/active/);
    await expect(page.locator("#leadDrawer")).not.toHaveClass(/open/);
    await expect(page.locator("#leadDrawerBackdrop")).not.toHaveClass(/active/);
    await expect(page.locator("body")).not.toHaveClass(/lead-drawer-open/);
  });

  test("lead finder distinguishes ready, disabled, and unconfigured sources", async ({ page }) => {
    const providerBase = {
      tier: "free",
      category: "company",
      accessMode: "api",
      requiresKey: false,
      capabilities: ["company"],
      docsUrl: "",
      keyHint: "",
      defaultBaseUrl: "",
      costNote: "测试来源",
      recommended: false,
      hasApiKey: false,
      lastTestStatus: "passed",
      lastTestMessage: "",
      lastTestAt: "",
      usage: ""
    };
    await page.route("**/api/lead-finder/providers", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          providers: [
            {
              ...providerBase,
              id: "ai_search",
              name: "AI 搜索",
              tier: "ai",
              category: "ai",
              ready: false,
              enabled: false
            },
            {
              ...providerBase,
              id: "gleif",
              name: "GLEIF",
              ready: true,
              enabled: false
            },
            {
              ...providerBase,
              id: "wikidata",
              name: "Wikidata",
              ready: true,
              enabled: true,
              recommended: true
            }
          ]
        })
      });
    });
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);
    await openView(page, "lead-finder");
    await page.locator("[data-lead-brief-mode='form']").click();
    await page.locator(".lead-advanced-settings summary").first().click();

    const aiChip = page.locator("[data-lead-provider='ai_search']");
    const disabledChip = page.locator("[data-lead-provider='gleif']");
    const readyChip = page.locator("[data-lead-provider='wikidata']");
    await expect(aiChip).toContainText("未配置");
    await expect(aiChip).toHaveClass(/needkey/);
    await expect(disabledChip).toContainText("已停用");
    await expect(disabledChip).toHaveClass(/disabled/);
    await expect(disabledChip).not.toHaveClass(/active/);
    await expect(readyChip).toContainText("内置");
    await expect(readyChip).toHaveClass(/ready/);

    await disabledChip.evaluate((element) => (element as HTMLElement).click());
    await expect(page.locator(".toast").last()).toContainText("已停用，暂不能用于搜索");
    await expect(disabledChip).not.toHaveClass(/active/);

    await aiChip.evaluate((element) => (element as HTMLElement).click());
    await expect(page.locator("#ai-config")).toHaveClass(/active/);
    await expect(page.locator(".toast").last()).toContainText("启用模型");

    await openView(page, "lead-finder");
    await page.locator("[data-lead-brief-mode='form']").click();
    await expect(readyChip).not.toHaveClass(/active/);
    let searchRequests = 0;
    await page.route("**/api/lead-finder/search", async (route) => {
      searchRequests += 1;
      await route.abort();
    });
    await page.locator("#leadFinderStartButton").click();
    await expect(page.locator(".toast").last()).toContainText("当前没有可执行的数据源");
    expect(searchRequests).toBe(0);
  });

  test("lead finder shows formal run cleaning statistics", async ({ page }) => {
    await page.route("**/api/lead-finder/providers", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          providers: [{
            id: "gleif",
            name: "GLEIF",
            tier: "free",
            category: "company",
            accessMode: "api",
            requiresKey: false,
            capabilities: ["company"],
            docsUrl: "",
            keyHint: "",
            defaultBaseUrl: "",
            costNote: "免费官方来源",
            recommended: true,
            hasApiKey: false,
            ready: true,
            enabled: true,
            lastTestStatus: "passed",
            lastTestMessage: "",
            lastTestAt: "",
            usage: ""
          }]
        })
      });
    });
    await mockFormalLeadFinderRun(page, {
      suffix: `cleaning_${runId}`,
      status: "succeeded"
    });
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);
    await openView(page, "lead-finder");
    await page.locator("[data-lead-brief-mode='form']").click();
    await page.locator(".lead-advanced-settings summary").first().click();
    await page.locator('[data-lead-provider="gleif"]').evaluate((element) => (element as HTMLElement).click());
    await expect(page.locator('[data-lead-provider="gleif"]')).toHaveClass(/active/);
    await page.locator("#leadFinderUrlInput").fill("");
    await page.locator("#leadProductKeywords").fill("工业照明");
    await page.locator("#leadCountries").fill("德国");
    await page.locator("#leadFinderStartButton").click();

    await expect(page.locator(".toast").last()).toContainText("获客任务已创建");
    const liveOverview = page.locator("#leadFinderLiveOverview");
    await expect(liveOverview).toContainText("最近一次执行");
    await expect(liveOverview).toContainText("已结束");
    await expect(liveOverview).toContainText("原始命中");
    await expect(liveOverview).toContainText("候选入池");
    await expect(liveOverview.locator("[role='progressbar']")).toHaveAttribute("aria-valuenow", "100");
    const progressBoard = page.locator("#leadFinderProgressBoard");
    await expect(progressBoard.locator(".lead-progress-facts")).toContainText("来源结束");
    await expect(progressBoard.locator(".lead-progress-facts")).toContainText("原始命中");
    await expect(progressBoard.locator(".lead-progress-facts")).toContainText("清洗去除");
    await expect(progressBoard.locator(".lead-progress-facts")).toContainText("候选入池");
    await expect(progressBoard).toContainText("已结束");
    await expect(progressBoard).not.toContainText("尚未结束");
    const jobCard = page.locator("#leadFinderJobList .lead-job-card").first();
    await expect(jobCard).toContainText("已结束");
    await expect(jobCard).toContainText("候选入池");
    await jobCard.locator("[data-lead-job-toggle]").click();
    await expect(jobCard).toContainText("原始命中 3 条");
    await expect(jobCard).toContainText("进入候选池 1 条");
    await expect(jobCard).toContainText("来源内重复 1 条");
    await expect(jobCard).toContainText("身份合并 1 条");
    await expect(jobCard).not.toContainText("部分完成");
    await page.locator("[data-lead-result-view='cleaning']").click();
    await expect(page.locator("#leadFinderCleaningView")).toBeVisible();
    await expect(page.locator("#leadFinderCleaningView")).toContainText("最多展示 100 条管线处置记录");
    await expect(page.locator("#leadFinderCleaningView")).toContainText("来源解析阶段的数据无效与页内重复仅提供汇总");
    await expect(page.locator("#leadFinderCleaningRows .lead-cleaning-row")).toHaveCount(1);
    await expect(page.locator("#leadFinderCleaningRows")).toContainText("已归并");
    await expect(page.locator("#leadFinderCleaningRows")).toContainText("Existing Lighting GmbH");
    await expect(page.locator("#leadFinderCleaningRows")).toContainText("DE / existing-lighting.example");
    await expect(page.locator("#leadFinderCleaningRows")).toContainText(`来源记录 LEI-cleaning_${runId}`);
  });

  test("lead finder main console consumes live run events without opening details", async ({ page }) => {
    await page.route("**/api/lead-finder/providers", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ providers: [{
          id: "gleif",
          name: "GLEIF",
          tier: "free",
          category: "company",
          accessMode: "api",
          requiresKey: false,
          capabilities: ["company"],
          docsUrl: "",
          keyHint: "",
          defaultBaseUrl: "",
          costNote: "免费官方来源",
          recommended: true,
          hasApiKey: false,
          ready: true,
          enabled: true,
          lastTestStatus: "passed",
          lastTestMessage: "",
          lastTestAt: "",
          usage: ""
        }] })
      });
    });
    const mocked = await mockFormalLeadFinderRun(page, {
      suffix: `live_${runId}`,
      status: "running"
    });
    let streamRequests = 0;
    await page.route("**/api/prospect-runs**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === `/api/prospect-runs/${mocked.runId}/events/stream`) {
        streamRequests += 1;
        const event = {
          id: `live_event_${runId}_${streamRequests}`,
          runId: mocked.runId,
          sequence: streamRequests + 1,
          occurredAt: new Date().toISOString(),
          type: "page.persisted",
          stage: "candidate_persistence",
          entityType: "run",
          entityId: mocked.runId,
          status: "running",
          progress: 73,
          metrics: { providerId: "gleif", rawCount: 12, acceptedCount: 4 },
          failureCode: "",
          retryable: false,
          message: "GLEIF 已完成第一页，4 条候选正在入池"
        };
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: `id: ${event.id}\nevent: prospect\ndata: ${JSON.stringify(event)}\n\n`
        });
        return;
      }
      if (path === `/api/prospect-runs/${mocked.runId}` && request.method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mocked.detail) });
        return;
      }
      if (path === "/api/prospect-runs" && request.method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ runs: [mocked.detail.run] }) });
        return;
      }
      await route.fallback();
    });
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);
    await openView(page, "lead-finder");
    await page.locator("[data-lead-brief-mode='form']").click();
    await page.locator(".lead-advanced-settings summary").first().click();
    await page.locator("#leadFinderUrlInput").fill("");
    await page.locator("#leadProductKeywords").fill("工业照明");
    await page.locator("#leadCountries").fill("德国");
    await page.locator("#leadFinderStartButton").click();

    const overview = page.locator("#leadFinderLiveOverview");
    await expect(page.locator("#lead-finder")).toHaveClass(/active/);
    await expect(overview).toContainText("GLEIF 已完成第一页，4 条候选正在入池");
    await expect(overview.locator("[role='progressbar']")).toHaveAttribute("aria-valuenow", "73");
    const progressBoard = page.locator("#leadFinderProgressBoard");
    await expect(progressBoard).toContainText("尚未结束");
    await expect(progressBoard).toContainText("执行中");
    await expect(progressBoard.locator("[role='progressbar']")).toHaveAttribute("aria-valuenow", "73");
    await expect(progressBoard).not.toContainText("已结束");
    expect(streamRequests).toBeGreaterThan(0);
    await expect(page.locator("#lead-task-detail")).not.toHaveClass(/active/);
    await openView(page, "dashboard");
    const runningQueue = page.locator("#dashboardProspectRuns");
    await expect(runningQueue).toContainText("进行中的搜客");
    await expect(runningQueue).toContainText("尚未结束");
    await runningQueue.locator("[data-dashboard-prospect-open]").click();
    await expect(page.locator("#lead-task-detail")).toHaveClass(/active/);
  });

  test("dashboard lists contactable candidates that still need a development email", async ({ page }) => {
    const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
    const ready = (index: number) => ({
      id: `pending_mail_${runId}_${index}`,
      company: `Ready Letter ${String(index).padStart(2, "0")} GmbH`,
      business: "LED lighting",
      country: "德国",
      website: `https://ready-${runId}-${index}.example`,
      contact: "Alex Buyer",
      contactInfo: `buyer-${index}@ready.example`,
      description: "待写开发信队列",
      ownerId: "u_manager_alex",
      teamId: "europe",
      status: "contactable",
      shortlistedAt: at(index),
      createdAt: at(index),
      parseMode: "rule",
      source: "gleif",
      sourceLabel: "GLEIF",
      sourceEvidence: []
    });
    const opportunities = [
      ...Array.from({ length: 9 }, (_, index) => ready(index + 1)),
      {
        ...ready(20),
        id: `pending_mail_${runId}_no_email`,
        company: "No Email GmbH",
        contactInfo: "+49 30 123456",
        contact: "Purchasing"
      },
      {
        ...ready(21),
        id: `pending_mail_${runId}_preview`,
        company: "Preview Only GmbH",
        status: "preview"
      },
      {
        ...ready(22),
        id: `pending_mail_${runId}_sent`,
        company: "Already Sent GmbH",
        lastDevelopmentEmailAt: at(1),
        lastDevelopmentEmailSubject: "Earlier letter",
        lastDevelopmentEmailTo: "buyer-22@ready.example"
      },
      {
        ...ready(23),
        id: `pending_mail_${runId}_pool`,
        company: "Not Shortlisted GmbH",
        shortlistedAt: ""
      },
      {
        ...ready(24),
        id: `pending_mail_${runId}_contacted`,
        company: "Already Contacted GmbH",
        status: "contacted"
      },
      {
        ...ready(25),
        id: `pending_mail_${runId}_blocked`,
        company: "Blocked Email GmbH",
        emailEligibility: {
          ready: false,
          state: "blocked",
          label: "已抑制",
          code: "PROSPECT_OUTREACH_SUPPRESSED",
          message: "该候选已抑制",
          recipient: ""
        }
      }
    ];
    await page.route("**/api/tools/website-opportunities", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ opportunities })
      });
    });
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);
    await openView(page, "dashboard");
    const queue = page.locator("#dashboardPendingEmails");
    await expect(queue).toContainText("待写开发信");
    await expect(queue.locator("[data-dashboard-pending-email]")).toHaveCount(8);
    await expect(queue).toContainText("共 9 条，这里显示 8 条");
    await expect(queue.locator("[data-dashboard-pending-email]").first()).toContainText("Ready Letter 01 GmbH");
    await expect(queue.locator("[data-dashboard-pending-email]").first()).toContainText("可联系");
    await expect(queue.locator("[data-dashboard-pending-email]").first()).toContainText("有邮箱");
    await expect(queue).not.toContainText("Ready Letter 09 GmbH");
    await expect(queue).not.toContainText("No Email GmbH");
    await expect(queue).not.toContainText("Preview Only GmbH");
    await expect(queue).not.toContainText("Already Sent GmbH");
    await expect(queue).not.toContainText("Not Shortlisted GmbH");
    await expect(queue).not.toContainText("Already Contacted GmbH");
    await expect(queue).not.toContainText("Blocked Email GmbH");

    await openView(page, "prospect-list");
    await page.locator("#prospectSearchInput").fill("Ready Letter 01");
    await expect(page.locator("#prospectListRows .prospect-item", { hasText: "Ready Letter 01 GmbH" })).toContainText("可写开发信");
    await page.locator("#prospectSearchInput").fill("Already Sent");
    await expect(page.locator("#prospectListRows .prospect-item", { hasText: "Already Sent GmbH" })).toContainText("已发开发信");
    await expect(page.locator("#prospectListRows .prospect-item", { hasText: "Already Sent GmbH" })).not.toContainText("可写开发信");
    await page.locator("#prospectSearchInput").fill("No Email");
    await expect(page.locator("#prospectListRows .prospect-item", { hasText: "No Email GmbH" })).not.toContainText("可写开发信");

    await openView(page, "dashboard");
    const recent = page.locator("#dashboardRecentOutreach");
    await expect(recent).toContainText("最近触达");
    await expect(recent.locator("[data-dashboard-recent-outreach]")).toHaveCount(1);
    await expect(recent).toContainText("Already Sent GmbH");
    await expect(recent).toContainText("已发开发信");
    await expect(recent).toContainText("Earlier letter");
    await expect(recent).not.toContainText("Ready Letter 01");
    await expect(recent).not.toContainText("No Email GmbH");
    await recent.locator("[data-dashboard-recent-outreach]").click();
    await expect(page.locator("#prospect-list")).toHaveClass(/active/);
    await expect(page.locator("#prospectDetail")).toContainText("Already Sent GmbH");
    await expect(page.locator("#prospectListRows .prospect-item.active")).toContainText("已发开发信");
    await expect(page.locator("#prospectMailWorkspace")).toHaveJSProperty("open", false);
    await expect(page.locator(".toast").last()).toContainText("不会再次发送");

    await openView(page, "dashboard");
    await queue.locator("[data-dashboard-pending-email]").first().click();
    await expect(page.locator("#prospect-list")).toHaveClass(/active/);
    await expect(page.locator("#prospectMailWorkspace")).toHaveJSProperty("open", true);
    await expect(page.locator("#prospectMailSubject")).toHaveValue(/Ready Letter 01 GmbH/);
    await expect(page.locator("#prospectMailTo")).toHaveValue("buyer-1@ready.example");
    await expect(page.locator("#prospectMailBody")).toHaveValue(/Ready Letter 01 GmbH/);
    await expect(page.locator(".toast").last()).toContainText("发送前仍需确认");
    await expect(page.locator(".toast").last()).not.toContainText("开发信已发送");
  });

  test("dashboard pending development emails stay empty instead of inventing companies", async ({ page }) => {
    await page.route("**/api/tools/website-opportunities", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ opportunities: [] })
      });
    });
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);
    await openView(page, "dashboard");
    const queue = page.locator("#dashboardPendingEmails");
    await expect(queue).toContainText("没有可写开发信的候选");
    await expect(queue).toContainText("去智能获客或搜客清单，补齐可联系状态和邮箱");
    await expect(queue.locator("[data-dashboard-pending-email]")).toHaveCount(0);
    const recent = page.locator("#dashboardRecentOutreach");
    await expect(recent).toContainText("还没有已发开发信");
    await expect(recent).toContainText("去待写开发信或搜客清单写一封");
    await expect(recent.locator("[data-dashboard-recent-outreach]")).toHaveCount(0);
  });

  test("dashboard recent outreach lists only sent letters, newest first", async ({ page }) => {
    const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
    const opportunities = [
      {
        id: `recent_empty_${runId}`,
        company: `Waiting Letter ${runId} GmbH`,
        business: "LED lighting",
        country: "德国",
        website: `https://waiting-${runId}.example`,
        contact: "Alex Buyer",
        contactInfo: `buyer@waiting-${runId}.example`,
        description: "尚未发送",
        ownerId: "u_manager_alex",
        teamId: "europe",
        status: "contactable",
        shortlistedAt: at(1),
        createdAt: at(1),
        parseMode: "rule",
        source: "gleif",
        sourceLabel: "GLEIF",
        sourceEvidence: []
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `recent_sent_${runId}_${index}`,
        company: `Sent ${index} ${runId} GmbH`,
        business: "LED lighting",
        country: "德国",
        website: `https://sent-${runId}-${index}.example`,
        contact: "Alex Buyer",
        contactInfo: `buyer-${index}@sent.example`,
        description: "已发",
        ownerId: "u_manager_alex",
        teamId: "europe",
        status: "contactable",
        shortlistedAt: at(index + 2),
        createdAt: at(index + 2),
        lastDevelopmentEmailAt: at(index),
        lastDevelopmentEmailSubject: `Letter ${index}`,
        lastDevelopmentEmailTo: `buyer-${index}@sent.example`,
        parseMode: "rule",
        source: "gleif",
        sourceLabel: "GLEIF",
        sourceEvidence: []
      }))
    ];
    await page.route("**/api/tools/website-opportunities", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ opportunities })
      });
    });
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);
    await openView(page, "dashboard");
    const queue = page.locator("#dashboardPendingEmails");
    const recent = page.locator("#dashboardRecentOutreach");
    await expect(queue).toContainText(`Waiting Letter ${runId} GmbH`);
    await expect(recent).toContainText("共 6 条，这里显示 5 条");
    await expect(recent.locator("[data-dashboard-recent-outreach]")).toHaveCount(5);
    await expect(recent.locator("[data-dashboard-recent-outreach]").first()).toContainText(`Sent 0 ${runId} GmbH`);
    await expect(recent.locator("[data-dashboard-recent-outreach]").first()).toContainText("已发开发信");
    await expect(recent.locator("[data-dashboard-recent-outreach]").first()).toContainText("Letter 0");
    await expect(recent).not.toContainText(`Sent 5 ${runId} GmbH`);
    await expect(recent).not.toContainText(`Waiting Letter ${runId} GmbH`);
  });

  test("confirming a prospect development email marks it sent and drops it from the pending queue", async ({ page }) => {
    const at = new Date().toISOString();
    const company = `Confirm Send ${runId} GmbH`;
    const recipient = `buyer.${runId}@confirm.example`;
    const candidate = {
      id: `confirm_send_${runId}`,
      company,
      business: "LED lighting",
      country: "德国",
      website: `https://confirm-${runId}.example`,
      contact: "Alex Buyer",
      contactInfo: recipient,
      description: "发送后应离开待写队列",
      ownerId: "u_manager_alex",
      teamId: "europe",
      status: "contactable",
      shortlistedAt: at,
      createdAt: at,
      parseMode: "rule",
      source: "gleif",
      sourceLabel: "GLEIF",
      sourceEvidence: [] as unknown[]
    };
    let opportunities = [candidate];
    let sendCount = 0;
    await apiFromPage(page, "/api/profile/email-binding", {
      method: "PATCH",
      body: {
        outboundEmail: `alex.sender.${runId}@example.com`,
        emailSenderName: "Alex",
        emailSignature: "Best regards,\nAlex",
        smtpHost: "smtp.example.com",
        smtpPort: 465,
        smtpSecure: true,
        smtpUser: `alex.sender.${runId}@example.com`,
        smtpPassword: "test-app-password",
        clearSmtpPassword: false
      }
    });
    const me = await apiFromPage<{ user: { outboundEmail?: string } }>(page, "/api/auth/me");
    await page.route("**/api/tools/website-opportunities", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ opportunities })
      });
    });
    await page.route("**/api/prospect-list/**/send-development-email", async (route) => {
      sendCount += 1;
      const body = route.request().postDataJSON() as { subject?: string; to?: string };
      const sent = {
        ...candidate,
        lastDevelopmentEmailAt: new Date().toISOString(),
        lastDevelopmentEmailSubject: body.subject || "开发信",
        lastDevelopmentEmailTo: body.to || recipient
      };
      opportunities = [sent];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sent: { simulated: true, replayed: false },
          opportunity: sent,
          user: me.user
        })
      });
    });
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);
    await openView(page, "dashboard");
    const queue = page.locator("#dashboardPendingEmails");
    const recent = page.locator("#dashboardRecentOutreach");
    await expect(queue).toContainText(company);
    await expect(recent).toContainText("还没有已发开发信");
    await queue.locator("[data-dashboard-pending-email]").click();
    await expect(page.locator("#prospectMailWorkspace")).toHaveJSProperty("open", true);
    await expect(page.locator("#prospectMailTo")).toHaveValue(recipient);

    await page.locator("#prospectSendMailButton").click();
    await page.locator("#appModal [data-modal-cancel]").click();
    await expect(page.locator("#prospectListRows .prospect-item", { hasText: company })).toContainText("可写开发信");
    await expect(page.locator("#prospectListRows .prospect-item", { hasText: company })).not.toContainText("已发开发信");
    await expect(queue).toContainText(company);
    await expect(recent).not.toContainText(company);
    expect(sendCount).toBe(0);

    await page.locator("#prospectSendMailButton").click();
    await page.locator("#confirmActionButton").click();
    await expect(page.locator(".toast").last()).toContainText("开发信已发送");
    await expect(page.locator("#prospectListRows .prospect-item", { hasText: company })).toContainText("已发开发信");
    await expect(page.locator("#prospectListRows .prospect-item", { hasText: company })).not.toContainText("可写开发信");
    await expect(queue).not.toContainText(company);
    await expect(queue).toContainText("没有可写开发信的候选");
    await expect(recent).toContainText(company);
    await expect(recent).toContainText("已发开发信");
    expect(sendCount).toBe(1);

    await openView(page, "dashboard");
    await recent.locator("[data-dashboard-recent-outreach]").click();
    await expect(page.locator("#prospect-list")).toHaveClass(/active/);
    await expect(page.locator("#prospectDetail")).toContainText(company);
    await expect(page.locator("#prospectMailWorkspace")).toHaveJSProperty("open", false);
    await expect(page.locator(".toast").last()).toContainText("不会再次发送");
    expect(sendCount).toBe(1);
  });

  test("super search previews the matrix and ends as one closed mission", async ({ page }) => {
    await page.route("**/api/lead-finder/providers", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          providers: [{
            id: "gleif",
            name: "GLEIF",
            tier: "free",
            category: "company",
            accessMode: "api",
            requiresKey: false,
            capabilities: ["company"],
            docsUrl: "",
            keyHint: "",
            defaultBaseUrl: "",
            costNote: "免费官方来源",
            recommended: true,
            hasApiKey: false,
            ready: true,
            enabled: true,
            lastTestStatus: "passed",
            lastTestMessage: "",
            lastTestAt: "",
            usage: ""
          }]
        })
      });
    });
    await mockFormalLeadFinderRun(page, {
      suffix: `super_${runId}`,
      status: "succeeded",
      superSearch: true
    });
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);
    await openView(page, "lead-finder");
    await page.locator("[data-lead-brief-mode='form']").click();
    await page.locator("[data-lead-search-mode='super']").click();
    await page.locator("#leadProductKeywords").fill("工业照明");
    await page.locator("#leadCountries").fill("德国");
    await page.locator("#leadCustomerTypes").selectOption("经销商 / Distributor");
    await page.locator(".lead-advanced-settings summary").first().click();
    await page.locator('[data-lead-provider="gleif"]').evaluate((element) => (element as HTMLElement).click());

    await expect(page.locator("#leadSuperPlan")).toContainText("4 个覆盖组合");
    await expect(page.locator("#leadSuperPlan")).toContainText("4 个来源执行单元");
    await page.locator("#leadFinderStartButton").click();

    await expect(page.locator(".toast").last()).toContainText("获客任务已创建");
    const jobCard = page.locator("#leadFinderJobList .lead-job-card").first();
    await expect(jobCard).toContainText("超级搜索");
    await expect(jobCard).toContainText("已结束");
    await expect(jobCard).not.toContainText("部分完成");
    await jobCard.locator("[data-lead-job-toggle]").click();
    await expect(jobCard).toContainText("轮次：1/4");
    await expect(jobCard).toContainText("查询矩阵：1 个执行单元");
  });

  test("lead finder keeps long source labels inside their result column", async ({ page }) => {
    await page.route("**/api/tools/website-opportunities", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          opportunities: [{
            id: `lf_long_source_${runId}`,
            company: "Federal Lighting Distribution Group",
            business: "LED lighting distribution and federal contract supply",
            country: "United States",
            website: "",
            contact: "采购/合同部门",
            contactInfo: "",
            description: "长来源名称布局回归测试",
            ownerId: "u_manager_alex",
            teamId: "europe",
            status: "preview",
            createdAt: new Date().toISOString(),
            parseMode: "rule",
            source: "usaspending_awards",
            sourceLabel: "USAspending 联邦采购官方公开数据来源",
            sourceEvidence: []
          }]
        })
      });
    });
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);
    await openView(page, "lead-finder");
    await page.locator("[data-lead-brief-mode='form']").click();

    const row = page.locator("#leadFinderResultRows tr[data-lead-id]").first();
    const sourceCell = row.locator("td").nth(2);
    const businessCell = row.locator("td").nth(3);
    const sourceTag = sourceCell.locator(".lead-src-tag");
    const [sourceBox, businessBox, tagBox] = await Promise.all([
      sourceCell.boundingBox(),
      businessCell.boundingBox(),
      sourceTag.boundingBox()
    ]);

    expect(sourceBox).not.toBeNull();
    expect(businessBox).not.toBeNull();
    expect(tagBox).not.toBeNull();
    expect(sourceBox!.x + sourceBox!.width).toBeLessThanOrEqual(businessBox!.x + 0.5);
    expect(tagBox!.x + tagBox!.width).toBeLessThanOrEqual(sourceBox!.x + sourceBox!.width + 0.5);
    await expect(sourceTag).toHaveAttribute("title", "USAspending 联邦采购官方公开数据来源");
    const candidateLayout = await page.locator("#lead-finder .lead-table-wrap").evaluate((wrap) => {
      const candidateRow = wrap.querySelector("#leadFinderResultRows tr[data-lead-id]");
      return {
        hasHorizontalOverflow: wrap.scrollWidth > wrap.clientWidth,
        rowHeight: candidateRow?.getBoundingClientRect().height || 0
      };
    });
    expect(candidateLayout.hasHorizontalOverflow).toBeFalsy();
    expect(candidateLayout.rowHeight).toBeGreaterThanOrEqual(96);
  });

  test("lead finder ends the task and keeps source failures in details", async ({ page }) => {
    const providers = ["gleif", "wikidata"].map((id) => ({
      id,
      name: id === "gleif" ? "GLEIF" : "Wikidata",
      tier: "free",
      category: "company",
      accessMode: "api",
      requiresKey: false,
      capabilities: ["company"],
      docsUrl: "",
      keyHint: "",
      defaultBaseUrl: "",
      costNote: "免费官方来源",
      recommended: true,
      hasApiKey: false,
      ready: true,
      enabled: true,
      lastTestStatus: "passed",
      lastTestMessage: "",
      lastTestAt: "",
      usage: ""
    }));
    await page.route("**/api/lead-finder/providers", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ providers })
      });
    });
    await mockFormalLeadFinderRun(page, {
      suffix: `source_failure_${runId}`,
      status: "partial_success",
      failSecondLaunch: true
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);
    await openView(page, "lead-finder");
    await page.locator("[data-lead-brief-mode='form']").click();
    await page.locator("#leadProductKeywords").fill("工业照明");
    await page.locator("#leadCountries").fill("德国");
    const startButton = page.locator("#leadFinderStartButton");

    await startButton.click();
    await expect(page.locator(".toast").last()).toContainText("获客任务已创建");
    let jobCard = page.locator("#leadFinderJobList .lead-job-card").first();
    await expect(jobCard).toContainText("已结束");
    await expect(jobCard).not.toContainText("部分完成");
    await jobCard.locator("[data-lead-job-toggle]").click();
    await expect(jobCard).toContainText("GLEIF");
    await expect(jobCard).toContainText("执行完成");
    await expect(jobCard).toContainText("Wikidata");
    await expect(jobCard).toContainText("请求频率过高");
    await expect(jobCard).toContainText("后可重试");

    await startButton.click();
    await expect(page.locator(".toast").last()).toContainText("搜客任务失败：服务暂时不可用，请稍后重试");
    jobCard = page.locator("#leadFinderJobList .lead-job-card").first();
    await expect(jobCard).toContainText("已结束");
    await expect(startButton).toBeEnabled();
    expect(pageErrors).toEqual([]);
  });

  test("lead finder restores sync controls when adding leads fails", async ({ page }) => {
    await page.route("**/api/tools/website-scrape/preview", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          opportunities: [{
            id: `lf_sync_failure_${runId}`,
            company: "Sync Failure GmbH",
            business: "Industrial lighting",
            country: "德国",
            website: `https://sync-failure-${runId}.example`,
            contact: "Verified Buyer",
            contactInfo: `buyer-${runId}@example.test`,
            description: "用于验证加入线索失败反馈",
            ownerId: "u_manager_alex",
            teamId: "europe",
            status: "contactable",
            createdAt: new Date().toISOString(),
            verifiedAt: new Date().toISOString(),
            statusChangedAt: new Date().toISOString(),
            parseMode: "reference",
            source: "website-reference",
            sourceLabel: "官网链接登记",
            sourceEvidence: [],
            scorecard: {
              version: "prospect-scorecard-v1",
              generatedAt: new Date().toISOString(),
              enterpriseConfidence: { score: 100, status: "verified", reasonCodes: [], evidenceRefs: [] },
              icpMatch: { score: 90, status: "verified", reasonCodes: [], evidenceRefs: [] },
              contactReadiness: { score: 100, status: "verified", reasonCodes: [], evidenceRefs: [] },
              actionPriority: { score: 90, status: "verified", reasonCodes: [], evidenceRefs: [] },
              vqa: { qualified: true, reasonCodes: [] }
            }
          }]
        })
      });
    });
    await page.route(`**/api/prospect-list/lf_sync_failure_${runId}/qualification`, async (route) => {
      const now = new Date().toISOString();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          qualification: {
            candidateId: `lf_sync_failure_${runId}`,
            prospectId: `prospect_sync_failure_${runId}`,
            organizationId: `organization_sync_failure_${runId}`,
            campaign: null,
            blockers: [],
            qualification: null,
            approvedDecision: { id: `decision_${runId}`, channelId: `channel_${runId}`, status: "approved_contactable", approvedAt: now },
            approvedChannel: { id: `channel_${runId}`, channelType: "email", value: `buyer-${runId}@example.test` },
            stageCurrency: { company: true, icp: true, channel: true, contactability: true },
            vqaQualified: true,
            nextStep: "ready"
          }
        })
      });
    });
    await page.route("**/api/tools/website-scrape/sync-opportunities", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "线索服务暂时不可用" })
      });
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await openView(page, "lead-finder");
    await page.locator("[data-lead-brief-mode='form']").click();
    await page.locator("#leadFinderUrlInput").fill(`https://sync-failure-${runId}.example`);
    await page.locator("#leadFinderStartButton").click();
    const row = page.locator(`#leadFinderResultRows tr[data-lead-id="lf_sync_failure_${runId}"]`);
    await expect(row).toBeVisible();
    await row.locator("[data-lead-select]").check();
    await expect(row).toHaveClass(/is-checked/);
    await expect(row).toHaveAttribute("aria-selected", "true");

    page.once("dialog", (dialog) => dialog.accept());
    const syncButton = page.locator("#leadFinderSyncButton");
    await syncButton.click();
    await expect(page.locator(".toast").last()).toContainText("加入线索失败：线索服务暂时不可用");
    await expect(syncButton).toBeEnabled();
    await expect(syncButton).toContainText("加入线索");
    expect(pageErrors).toEqual([]);
  });

  test("provider connection test shows structured retry feedback", async ({ page }) => {
    const provider = {
      id: "serper",
      name: "Serper (Google)",
      tier: "byok_free",
      category: "web",
      accessMode: "api",
      requiresKey: true,
      capabilities: ["web"],
      docsUrl: "",
      keyHint: "测试 Key",
      defaultBaseUrl: "https://google.serper.dev",
      costNote: "自带 Key",
      hasApiKey: true,
      ready: true,
      enabled: true,
      lastTestStatus: "passed",
      lastTestMessage: "此前连接通过",
      lastTestAt: "",
      usage: ""
    };
    await page.route("**/api/lead-finder/providers", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ providers: [provider] })
      });
    });
    await page.route("**/api/lead-finder/source-config/test", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          message: "连接异常：数据源当前限流，可稍后重试",
          usage: "",
          errorCode: "PROVIDER_RATE_LIMITED",
          retryable: true,
          retryAfterAt: "2099-01-01T08:30:00.000Z",
          providers: [{
            ...provider,
            lastTestStatus: "failed",
            lastTestMessage: "连接异常：数据源当前限流，可稍后重试",
            lastTestAt: new Date().toISOString()
          }]
        })
      });
    });
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);
    await openView(page, "lead-finder");
    await page.locator("[data-lead-brief-mode='form']").click();
    await page.locator("#leadSourceCenterButton").click();
    const testButton = page.locator("[data-ls-test='serper']");
    await expect(testButton).toBeVisible();
    await testButton.click();
    await expect(page.locator(".toast").last()).toContainText("数据源当前限流");
    await expect(page.locator(".toast").last()).toContainText("后可重试");
    await expect(testButton).toBeEnabled();
  });

  test("lead finder page sends unresolved references into authoritative qualification", async ({ page }) => {
    const company = `leadfinder-${runId}`;
    await expect(page.locator(".nav button[data-view='dashboard'] + button[data-view='lead-finder']")).toBeVisible();
    await openView(page, "lead-finder");
    await page.locator("[data-lead-brief-mode='form']").click();
    await expect(page.locator("#lead-finder .page-head")).toContainText("自动获客");
    await expect(page.locator("#leadFinderSearchLinks a").first()).toContainText(/product supplier|OEM product/);
    await expect(page.locator(".lead-advanced-settings")).toHaveAttribute("open", "");
    await expect(page.locator(".lead-queue-panel")).toBeVisible();
    await expect(page.locator(".lead-queue-panel")).toContainText("自动更新");
    await expect(page.locator(".lead-support-panel")).not.toHaveAttribute("open", "");

    await page.locator("#leadFinderUrlInput").fill(`https://example.org/${company}`);
    await page.route("**/api/tools/website-scrape/preview", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });
    await page.locator("#leadFinderStartButton").click();
    const jobCard = page.locator("#leadFinderJobList .lead-job-card").first();
    await expect(jobCard).toContainText("执行中");
    await jobCard.locator("[data-lead-job-open]").click();
    await expect(page.locator("#lead-task-detail")).toHaveClass(/active/);
    await expect(page.locator("#leadTaskDetailStatus")).toContainText(/执行中|已结束/);
    await expect(page.locator("#leadTaskStream")).toContainText("客户画像与检索条件已解析");
    await expect(page.locator("[data-lead-stream-mode]")).toHaveCount(0);
    await expect(page.locator("#leadTaskStream")).not.toHaveClass(/is-verbose/);
    await expect(page.locator("#leadTaskStreamState")).toContainText(/事实事件同步|记录已归档/);
    await expect(page.locator("#leadTaskStream")).toContainText("客户画像与检索条件已解析");
    await expect(page.locator("#lead-task-detail")).toContainText("可加入线索的候选");
    await expect(page.locator("#lead-task-detail")).toContainText("清洗去向");
    await expect(page.locator("#leadTaskCandidates")).toContainText("example.org");
    await page.locator("#leadTaskDetailBack").click();
    await expect(page.locator("#lead-finder")).toHaveClass(/active/);
    await jobCard.locator("[data-lead-job-toggle]").click();
    await expect(jobCard).toContainText("检索公开API");
    await expect(page.locator("#leadFinderResultRows")).toContainText("example.org");
    await expect(page.locator("#leadFinderJobList")).toContainText("已结束");
    await expect(jobCard).toContainText("example.org");
    await expect(page.locator("#leadFinderPendingCount")).not.toHaveText("0");

    let firstRow = page.locator("#leadFinderResultRows tr[data-lead-id]").first();
    await expect(firstRow.locator("[data-lead-select]")).toBeDisabled();
    const leadFinderContactInfo = `buyer.leadfinder.${runId}@example.com`;
    const leadFinderCandidateId = await firstRow.getAttribute("data-lead-id");
    expect(leadFinderCandidateId).toBeTruthy();
    await firstRow.locator("[data-lead-field='business']").click();
    await expect(page.locator("#leadFinderVerificationDrawer")).not.toHaveClass(/open/);
    await firstRow.locator("[data-lead-company-open]").click();
    await expect(page.locator("#leadFinderVerificationDrawer")).toHaveClass(/open/);
    await page.locator("#leadFinderDetailCompany").fill(company);
    await page.locator("#leadFinderDetailBusiness").fill("LED 工程灯 / 智能搜客测试");
    await page.locator("#leadFinderDetailCountry").fill("德国");
    await page.locator("#leadFinderDetailContact").fill("Lead Finder Buyer");
    await page.locator("#leadFinderDetailContactInfo").fill(leadFinderContactInfo);
    await expect(page.locator("#leadFinderDetail")).toContainText("来源与外部编号");
    await expect(page.locator("#leadFinderDetail")).toContainText("重复与归属");
    await expect(page.locator("#leadFinderDetail")).toContainText("来源证据");
    await page.locator("#leadFinderDetailSaveButton").click();
    await expect(page.locator(".toast").last()).toContainText("资料已保存；受影响的资格步骤已失效");
    await expect(page.locator("#leadFinderDetailQualificationButton")).toBeVisible();
    await page.locator("#leadFinderDetailQualificationButton").click();
    await expect(page.locator("#prospect-list")).toHaveClass(/active/);
    await expect(page.locator("#prospectDetail")).toContainText("尚未完成正式企业身份归一");
    await expect(page.locator("#prospectResolveIdentityButton")).toBeVisible();
    await page.locator("#prospectResolveIdentityButton").click();
    await expect(page.locator("#prospect-list")).toHaveClass(/active/);
    await expect(page.locator("#prospectIdentityProvider")).toBeFocused();
    await expect(page.locator("#prospectIdentityRegistration")).toBeVisible();
  });

  test("lead finder pagination and mobile layout remain usable", async ({ page }) => {
    await apiFromPage(page, "/api/tools/website-scrape/preview", {
      method: "POST",
      body: {
        urls: Array.from({ length: 12 }, (_, index) => `https://pagination-${runId}-${index + 1}.example.net`),
        useAi: false
      }
    });
    await page.reload();
    await openView(page, "lead-finder");
    await page.locator("[data-lead-brief-mode='form']").click();
    await expect(page.locator("#leadFinderPageSummary")).toContainText(/共 \d+ 条/);
    await expect(page.locator("#leadFinderResultRows tr[data-lead-id]")).toHaveCount(10);
    await page.locator("#leadFinderNextPage").click();
    await expect(page.locator("#leadFinderPageNumber")).toContainText("2 /");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("#leadFinderMobileRows")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBeFalsy();
  });

  test("prospect qualification UI closes the four-step loop and invalidates amended facts", async ({ page }) => {
    test.setTimeout(90_000);
    const candidateId = `qualification_ui_${runId}`;
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 90 * 86400000).toISOString();
    const scorecard = (qualified: boolean) => ({
      version: "prospect-scorecard-v1",
      generatedAt: now,
      enterpriseConfidence: { score: qualified ? 100 : 30, status: qualified ? "verified" : "unverified", reasonCodes: [], evidenceRefs: [] },
      icpMatch: { score: qualified ? 90 : 0, status: qualified ? "verified" : "unverified", reasonCodes: [], evidenceRefs: [] },
      contactReadiness: { score: qualified ? 100 : 0, status: qualified ? "verified" : "unverified", reasonCodes: [], evidenceRefs: [] },
      actionPriority: { score: qualified ? 92 : 10, status: qualified ? "verified" : "partial", reasonCodes: [], evidenceRefs: [] },
      vqa: { qualified, reasonCodes: qualified ? [] : ["CONTACTABILITY_GATE_NOT_PASSED"] }
    });
    const candidate = {
      id: candidateId,
      company: `Qualification UI ${runId} Ltd`,
      business: "Industrial lighting distribution",
      country: "GB",
      website: `https://qualification-${runId}.example`,
      contact: "Sales Team",
      contactInfo: `sales.${runId}@qualification.example`,
      description: "Four-step qualification UI regression",
      ownerId: "u_manager_alex",
      teamId: "europe",
      status: "preview",
      createdAt: now,
      parseMode: "rule",
      source: "companies_house",
      sourceLabel: "Companies House",
      sourceEvidence: [],
      tenantProspectId: `prospect_${runId}`,
      organizationId: `organization_${runId}`,
      scorecard: scorecard(false)
    };
    let stage = 0;
    let forcedCurrency: null | {
      company: boolean;
      icp: boolean;
      channel: boolean;
      contactability: boolean;
      nextStep: string;
    } = null;
    const qualificationView = () => {
      const companyVerification = stage >= 1 ? {
        id: `company_snapshot_${runId}`,
        status: "verified_active",
        reviewStatus: "approved",
        reasonCodes: [],
        validUntil: future,
        createdAt: now
      } : null;
      const assessment = stage >= 2 ? {
        id: `assessment_${runId}`,
        totalScore: 100,
        result: "qualified",
        reviewStatus: stage >= 3 ? "approved" : "pending_review",
        hardGateReasonCodes: [],
        createdAt: now
      } : null;
      const verification = stage >= 4 ? {
        id: `verification_${runId}`,
        channelId: `channel_${runId}`,
        status: "verified",
        providerCode: "human_official_source_review",
        reasonCode: "public_channel_confirmed",
        verifiedAt: now,
        expiresAt: future,
        createdAt: now
      } : null;
      const decision = stage >= 5 ? {
        id: `decision_${runId}`,
        channelId: `channel_${runId}`,
        status: stage >= 6 ? "approved_contactable" : "eligible",
        reasonCodes: [],
        approvedAt: stage >= 6 ? now : "",
        createdAt: now
      } : null;
      const normalNextSteps = ["verify_company", "assess_icp", "approve_icp", "verify_channel", "evaluate_contactability", "approve_contactability", "ready"];
      const currency = forcedCurrency || {
        company: true,
        icp: true,
        channel: true,
        contactability: true,
        nextStep: normalNextSteps[stage]!
      };
      return {
        candidateId,
        prospectId: candidate.tenantProspectId,
        organizationId: candidate.organizationId,
        campaign: {
          runId: `run_${runId}`,
          campaignId: `campaign_${runId}`,
          campaignVersion: 1,
          campaignName: "Industrial lighting UK",
          campaignSnapshot: {
            goal: "Find qualified distributors",
            products: ["industrial lighting"],
            markets: ["GB"],
            customerTypes: ["Distributor"],
            applicationScenarios: ["industrial projects"],
            icpRules: ["qualified distributor"],
            exclusionRules: [],
            sourceProviderIds: ["companies_house"]
          }
        },
        blockers: [],
        qualification: {
          evidence: [],
          companyVerification,
          icpPolicies: [],
          icpAssessments: assessment ? [assessment] : [],
          contacts: verification ? [{ id: `contact_${runId}`, contactType: "department", name: "", department: "Sales", title: "" }] : [],
          channels: verification ? [{ id: `channel_${runId}`, contactId: `contact_${runId}`, channelType: "email", value: candidate.contactInfo, sourceEvidenceId: `evidence_${runId}`, createdAt: now }] : [],
          contactVerifications: verification ? [verification] : [],
          suppressions: [],
          contactabilityDecisions: decision ? [decision] : []
        },
        approvedDecision: stage >= 6 ? decision : null,
        approvedChannel: stage >= 6 ? { id: `channel_${runId}`, channelType: "email", value: candidate.contactInfo } : null,
        scorecard: scorecard(stage >= 6 && !forcedCurrency),
        stageCurrency: {
          company: currency.company,
          icp: currency.icp,
          channel: currency.channel,
          contactability: currency.contactability
        },
        vqaQualified: stage >= 6 && !forcedCurrency,
        nextStep: currency.nextStep
      };
    };
    const qualificationOperations: string[] = [];
    await page.route("**/api/tools/website-opportunities", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ opportunities: [candidate] }) });
    });
    await page.route(`**/api/prospect-list/${candidateId}/qualification**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === "POST") {
        qualificationOperations.push(path);
        forcedCurrency = null;
        if (path.endsWith("/company")) stage = 1;
        else if (/\/icp\/[^/]+\/approve$/u.test(path)) stage = 3;
        else if (path.endsWith("/icp")) stage = 2;
        else if (path.endsWith("/channel")) stage = 4;
        else if (path.endsWith("/contactability/evaluate")) stage = 5;
        else if (/\/contactability\/[^/]+\/approve$/u.test(path)) stage = 6;
        candidate.scorecard = scorecard(stage >= 6);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ qualification: qualificationView(), opportunity: candidate })
      });
    });
    await page.route(`**/api/prospect-list/${candidateId}/details`, async (route) => {
      const body = route.request().postDataJSON() as Record<string, string>;
      const companyChanged = body.company !== candidate.company || body.website !== candidate.website;
      const icpChanged = body.business !== candidate.business || body.country !== candidate.country;
      const channelChanged = body.contact !== candidate.contact || body.contactInfo !== candidate.contactInfo;
      candidate.company = body.company;
      candidate.website = body.website;
      candidate.business = body.business;
      candidate.country = body.country;
      candidate.contact = body.contact;
      candidate.contactInfo = body.contactInfo;
      candidate.description = body.description;
      forcedCurrency = companyChanged
        ? { company: false, icp: false, channel: false, contactability: false, nextStep: "verify_company" }
        : icpChanged
          ? { company: true, icp: false, channel: true, contactability: false, nextStep: "assess_icp" }
          : channelChanged
            ? { company: true, icp: true, channel: false, contactability: false, nextStep: "verify_channel" }
            : null;
      candidate.scorecard = scorecard(false);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          opportunity: candidate,
          qualification: qualificationView(),
          qualificationInvalidated: Boolean(forcedCurrency),
          changedFields: []
        })
      });
    });

    const openCandidate = async () => {
      await openView(page, "prospect-list");
      await page.locator("#prospectSearchInput").fill(candidate.company);
      await page.locator("#prospectListRows [data-prospect-open]").first().click();
    };
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);
    await openCandidate();
    await expect(page.locator("#prospectDetail")).toContainText("1. 企业核验");
    await expect(page.locator("#prospectDetail")).toContainText("VQA 未通过");

    await page.locator("#prospectVerifyCompanyButton").click();
    await page.locator("#prospectCompanyRegistration").fill("01234567");
    await page.locator("#prospectCompanySource").fill("https://find-and-update.company-information.service.gov.uk/company/01234567");
    await page.locator("#prospectCompanySubmit").click();
    await expect(page.locator("#prospectAssessIcpButton")).toBeEnabled();

    await page.locator("#prospectAssessIcpButton").click();
    await page.locator("#prospectIcpEvidence").fill("Official product page confirms industrial lighting distribution");
    for (const [id, value] of [["Product", "30"], ["Customer", "15"], ["Market", "10"], ["Authenticity", "15"], ["Purchase", "15"], ["Contact", "10"], ["Freshness", "5"]]) {
      await page.locator(`#prospectIcp${id}`).fill(value);
    }
    await page.locator("#prospectIcpSubmit").click();
    await expect(page.locator("#prospectApproveIcpButton")).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#prospectApproveIcpButton").click();
    await expect(page.locator("#prospectVerifyChannelButton")).toBeEnabled();

    await page.locator("#prospectVerifyChannelButton").click();
    await page.locator("#prospectChannelConfirmed").check();
    await page.locator("#prospectChannelSubmit").click();
    await expect(page.locator("#prospectEvaluateContactabilityButton")).toBeVisible();
    await page.locator("#prospectEvaluateContactabilityButton").click();
    await expect(page.locator("#prospectApproveContactabilityButton")).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#prospectApproveContactabilityButton").click();
    await expect(page.locator("#prospectDetail")).toContainText("VQA 已通过");
    await expect(page.locator("#prospectDetailSyncButton")).toBeVisible();
    expect(qualificationOperations.map((path) => path.replace(`/api/prospect-list/${candidateId}/qualification`, ""))).toEqual([
      "/company",
      "/icp",
      `/icp/assessment_${runId}/approve`,
      "/channel",
      "/contactability/evaluate",
      `/contactability/decision_${runId}/approve`
    ]);

    await page.locator("#prospectEditBusiness").fill("Industrial automation distribution");
    await page.locator("#prospectSaveButton").click();
    await expect(page.locator("#prospectDetail")).toContainText("ICP 输入已变化，需重新评估");
    await expect(page.locator("#prospectDetailSyncButton")).toHaveCount(0);

    stage = 6;
    forcedCurrency = null;
    candidate.scorecard = scorecard(true);
    await page.reload();
    await openCandidate();
    await page.locator("#prospectEditContactInfo").fill(`new.${runId}@qualification.example`);
    await page.locator("#prospectSaveButton").click();
    await expect(page.locator("#prospectDetail")).toContainText("渠道资料已变化，需重新核验");
    await expect(page.locator("#prospectDetailSyncButton")).toHaveCount(0);

    stage = 6;
    forcedCurrency = null;
    candidate.scorecard = scorecard(true);
    await page.reload();
    await openCandidate();
    await page.locator("#prospectEditCompany").fill(`${candidate.company} Holdings`);
    await page.locator("#prospectSaveButton").click();
    await expect(page.locator("#prospectDetail")).toContainText("企业资料已变化，需重新核验");
    await expect(page.locator("#prospectDetailSyncButton")).toHaveCount(0);
  });

  test("prospect list filters and sorts by local joined time and uses a mobile detail surface", async ({ page }) => {
    const localNoon = (dayOffset: number) => {
      const value = new Date();
      value.setHours(12, 0, 0, 0);
      value.setDate(value.getDate() + dayOffset);
      return value;
    };
    const dateInput = (value: Date) => [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0")
    ].join("-");
    const joinedFixtures = [
      { id: `joined_today_${runId}`, company: "Today Joined GmbH", createdAt: localNoon(0).toISOString() },
      { id: `joined_week_${runId}`, company: "Week Boundary GmbH", createdAt: localNoon(-6).toISOString() },
      { id: `joined_month_${runId}`, company: "Month Window GmbH", createdAt: localNoon(-20).toISOString() },
      { id: `joined_old_${runId}`, company: "Oldest Joined GmbH", createdAt: localNoon(-31).toISOString() }
    ].map((item) => ({
      ...item,
      business: "Industrial distribution",
      country: "德国",
      website: `https://${item.id}.example`,
      contact: "Purchasing",
      contactInfo: "buyer@example.com",
      description: "加入时间筛选测试",
      ownerId: "u_manager_alex",
      teamId: "europe",
      status: "preview",
      parseMode: "rule",
      source: "gleif",
      sourceLabel: "GLEIF",
      sourceEvidence: []
    }));
    await page.route("**/api/tools/website-opportunities", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ opportunities: joinedFixtures })
      });
    });
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);
    await openView(page, "prospect-list");

    await expect(page.locator("#prospectListRows .prospect-item")).toHaveCount(4);
    await expect(page.locator("#prospectListRows .prospect-item").first()).toContainText("加入候选池");
    await page.locator("[data-prospect-date-filter='today']").click();
    await expect(page.locator("#prospectListRows .prospect-item")).toHaveCount(1);
    await expect(page.locator("#prospectListRows")).toContainText("Today Joined GmbH");
    await page.locator("[data-prospect-date-filter='7d']").click();
    await expect(page.locator("#prospectListRows .prospect-item")).toHaveCount(2);
    await page.locator("[data-prospect-date-filter='30d']").click();
    await expect(page.locator("#prospectListRows .prospect-item")).toHaveCount(3);

    await page.locator("[data-prospect-date-filter='custom']").click();
    await page.locator("#prospectJoinedFrom").fill(dateInput(localNoon(-6)));
    await page.locator("#prospectJoinedTo").fill(dateInput(localNoon(0)));
    await expect(page.locator("#prospectListRows .prospect-item")).toHaveCount(2);

    await page.locator("[data-prospect-date-filter='all']").click();
    await page.locator("#prospectSortSelect").selectOption("joined_asc");
    await expect(page.locator("#prospectListRows .prospect-item").first()).toContainText("Oldest Joined GmbH");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#prospectListRows [data-prospect-open]").first().click();
    await expect(page.locator("body")).toHaveClass(/prospect-mobile-detail-open/);
    await expect(page.locator("#prospect-list .prospect-detail-panel")).toBeVisible();
    await expect(page.locator("#prospectDetail")).toContainText("加入候选池");
    await page.locator("#prospectMobileDetailClose").click();
    await expect(page.locator("body")).not.toHaveClass(/prospect-mobile-detail-open/);
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  });

  test("prospect verification queue supports identity gating, pagination and recovery navigation", async ({ page }) => {
    test.setTimeout(90_000);
    const prefix = `搜客清单自测-${runId}`;
    const previewResult = await apiFromPage<{ opportunities: Array<{ id: string }> }>(
      page,
      "/api/tools/website-scrape/preview",
      {
        method: "POST",
        body: {
          urls: Array.from({ length: 12 }, (_, index) => `https://prospect-${runId}-${index + 1}.example`),
          useAi: false
        }
      }
    );
    expect(previewResult.opportunities).toHaveLength(12);

    for (const [index, opportunity] of previewResult.opportunities.entries()) {
      await apiFromPage(page, `/api/prospect-list/${encodeURIComponent(opportunity.id)}/details`, {
        method: "PATCH",
        body: {
          company: `${prefix}-${String(index + 1).padStart(2, "0")}`,
          business: "工业产品分销",
          country: index % 2 ? "德国" : "波兰",
          website: `https://prospect-${runId}-${index + 1}.example`,
          contact: "待核验采购联系人",
          contactInfo: "待维护",
          description: "E2E 搜客清单核验流程"
        }
      });
    }

    await openView(page, "prospect-list");
    await page.locator("#prospectRefreshButton").click();
    await page.locator("#prospectSearchInput").fill(prefix);
    await expect(page.locator("#prospectListRows .prospect-item")).toHaveCount(10);
    await expect(page.locator("#prospectPageNumber")).toHaveText("1 / 2");
    await expect(page.locator("#prospectPageSummary")).toContainText("第 1-10 条，共 12 条");
    await expect(page.locator("[data-prospect-filter]")).toHaveCount(6);
    await expect(page.locator("#prospectPreviewCount")).not.toHaveText("0");

    await page.locator("#prospectSelectPage").check();
    await expect(page.locator("#prospectSelectedCount")).toHaveText("已选 10 条");
    await page.locator("#prospectSelectPage").uncheck();
    await expect(page.locator("#prospectSelectedCount")).toHaveText("已选 0 条");
    await page.locator("#prospectNextPage").click();
    await expect(page.locator("#prospectListRows .prospect-item")).toHaveCount(2);
    await expect(page.locator("#prospectPageNumber")).toHaveText("2 / 2");
    await page.locator("#prospectPrevPage").click();

    const firstCompany = `${prefix}-01`;
    const secondCompany = `${prefix}-02`;
    const excludedCompany = `${prefix}-03`;
    await page.locator("#prospectSearchInput").fill(excludedCompany);
    await page.locator("#prospectListRows .prospect-item", { hasText: excludedCompany }).locator("[data-prospect-select]").check();
    await page.locator("#prospectExcludeButton").click();
    await expect(page.locator("#modalTitle")).toHaveText("排除候选");
    await page.locator("#prospectExcludeReasonInput").fill("非目标行业，E2E 验证排除原因");
    await page.locator("#confirmProspectExcludeButton").click();
    await expect(page.locator(".toast").last()).toContainText("已排除所选候选");
    await page.locator("[data-prospect-filter='excluded']").click();
    await expect(page.locator("#prospectListRows")).toContainText(excludedCompany);
    await page.locator("#prospectListRows .prospect-item", { hasText: excludedCompany }).locator("[data-prospect-open]").click();
    await expect(page.locator("#prospectDetail")).toContainText("非目标行业，E2E 验证排除原因");
    await page.locator("#prospectRestoreButton").click();
    await expect(page.locator(".toast").last()).toContainText("已恢复为待核验");

    await page.locator("[data-prospect-filter='all']").click();
    await page.locator("#prospectSearchInput").fill(firstCompany);
    await page.locator("#prospectListRows .prospect-item", { hasText: firstCompany }).locator("[data-prospect-open]").click();
    await expect(page.locator("#prospectDetail")).toContainText("待核验");
    await expect(page.locator("#prospectTodoButton")).toHaveCount(0);
    await expect(page.locator("#prospectDetailSyncButton")).toHaveCount(0);
    await page.locator("#prospectMailWorkspace").locator("summary").click();
    await page.locator("#prospectGenerateMailButton").click();
    await expect(page.locator("#prospectMailSubject")).not.toHaveValue("");
    await expect(page.locator("#prospectMailTo")).not.toHaveValue("");
    await page.locator("#prospectSendMailButton").click();
    await page.getByRole("button", { name: "确认发送" }).click();
    await expect(page.locator(".toast").last()).toContainText("请先完成 VQA，并批准邮件通道");

    await page.locator("#prospectListRows .prospect-item", { hasText: firstCompany }).locator("[data-prospect-open]").click();
    await page.locator("#prospectEditContact").fill("Anna Buyer");
    await page.locator("#prospectEditContactInfo").fill(`anna.${runId}@example.com`);
    await page.locator("#prospectEditDescription").fill("已核验官网采购邮箱，可进行首轮开发");
    await page.locator("#prospectSaveButton").click();
    await expect(page.locator(".toast").last()).toContainText("资料已保存");
    await expect(page.locator("#prospectDetail")).toContainText("尚未完成正式企业身份归一");
    await expect(page.locator("#prospectResolveIdentityButton")).toBeVisible();
    await expect(page.locator("#prospectDetailSyncButton")).toHaveCount(0);
    await expect(page.locator("#prospectTodoButton")).toHaveCount(0);

    const secondId = previewResult.opportunities[1].id;
    await apiFromPage(page, `/api/prospect-list/${encodeURIComponent(secondId)}/details`, {
      method: "PATCH",
      body: {
        company: secondCompany,
        business: "工业产品分销",
        country: "德国",
        website: `https://prospect-${runId}-2.example`,
        contact: "Mark Buyer",
        contactInfo: `mark.${runId}@example.com`,
        description: "已核验第二联系人"
      }
    });
    await page.locator("#prospectRefreshButton").click();
    await page.locator("#prospectSearchInput").fill(prefix);
    await expect(page.locator("#prospectListRows")).toContainText(firstCompany);
    await expect(page.locator("#prospectListRows")).toContainText(secondCompany);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileLayout = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      listColumns: getComputedStyle(document.querySelector(".prospect-list-layout")!).gridTemplateColumns
    }));
    expect(mobileLayout.documentWidth).toBeLessThanOrEqual(mobileLayout.viewportWidth + 1);
    expect(mobileLayout.listColumns.split(" ")).toHaveLength(1);
    await expect(page.locator("#prospect-list .lead-command-strip")).toBeVisible();
    await expect(page.locator("#prospectDetail")).toBeHidden();
    await page.locator("#prospectListRows [data-prospect-open]").first().click();
    await expect(page.locator("#prospectDetail")).toBeVisible();
    await expect(page.locator("body")).toHaveClass(/prospect-mobile-detail-open/);
  });

  test("controlled website probe streams every stage and ends with detailed outcome", async ({ page }) => {
    const candidateId = `probe_ui_${runId}`;
    const attemptId = `probe_attempt_${runId}`;
    const me = await apiFromPage<{ user: { id: string; teamId: string } }>(page, "/api/auth/me");
    const now = new Date().toISOString();
    const candidate = {
      id: candidateId,
      company: `Probe UI ${runId}`,
      business: "Industrial components",
      country: "GB",
      website: "https://probe-ui.example.com/",
      contact: "Purchasing",
      contactInfo: "",
      description: "Controlled website probe UI test",
      ownerId: me.user.id,
      teamId: me.user.teamId,
      status: "preview",
      createdAt: now,
      outreachState: "uncontacted",
      scorecard: {
        version: "prospect-scorecard-v1",
        generatedAt: now,
        enterpriseConfidence: { score: 0, status: "unverified", reasonCodes: ["COMPANY_EVIDENCE_MISSING"], evidenceRefs: [] },
        icpMatch: { score: 0, status: "unverified", reasonCodes: ["ICP_ASSESSMENT_MISSING"], evidenceRefs: [] },
        contactReadiness: { score: 0, status: "unverified", reasonCodes: ["VERIFIED_CONTACT_CHANNEL_MISSING"], evidenceRefs: [] },
        actionPriority: { score: 0, status: "partial", reasonCodes: ["PURCHASE_SIGNAL_MISSING"], evidenceRefs: [] },
        vqa: { qualified: false, reasonCodes: ["RESOLVED_ORGANIZATION_MISSING"] }
      },
      websiteProbeAttempts: [] as Array<Record<string, unknown>>
    };
    const event = (sequence: number, stage: string, message: string) => ({
      id: `event_${sequence}_${runId}`,
      sequence,
      stage,
      status: "completed",
      message,
      metrics: {},
      createdAt: now
    });
    const queuedAttempt = {
      id: attemptId,
      candidateId,
      domain: "example.com",
      sourceUrl: "https://probe-ui.example.com/",
      purpose: "company_evidence_enrichment",
      accessMode: "controlled_probe",
      policyVersion: "website-probe-policy-v2",
      status: "queued",
      outcome: "pending",
      robotsDecision: "pending",
      httpStatus: 0,
      responseBytes: 0,
      redirected: false,
      evidence: null,
      events: [event(1, "queued", "Website review has been queued")],
      failureCode: "",
      failureMessage: "",
      startedAt: "",
      completedAt: "",
      createdAt: now
    };
    const streamedEvents = [
      event(2, "dns", "Public DNS check passed"),
      event(3, "robots", "The access policy allows homepage review"),
      event(4, "head", "Homepage status and content type check passed"),
      event(5, "body", "The homepage content sample was reviewed. Source text was not retained."),
      event(6, "evidence", "Public contact details or organization evidence was identified"),
      event(7, "completed", "Website review completed")
    ];
    const completedAttempt = {
      ...queuedAttempt,
      status: "completed",
      outcome: "evidence_found",
      robotsDecision: "allowed",
      httpStatus: 200,
      responseBytes: 816,
      evidence: {
        canonicalDomain: "example.com",
        pageTitle: "Probe UI Company",
        language: "en",
        organizationName: "Probe UI Company Limited",
        legalName: "Probe UI Company Limited",
        addressCountry: "GB",
        businessCategory: "Industrial components",
        publicContactEmail: "sales@probe-ui.example.com",
        sourceUrl: "https://probe-ui.example.com/",
        payloadHash: "probe-ui-hash",
        observedAt: now
      },
      events: [queuedAttempt.events[0], ...streamedEvents],
      startedAt: now,
      completedAt: now
    };
    await page.route("**/api/tools/website-opportunities", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ opportunities: [candidate] })
      });
    });
    await page.route(`**/api/prospect-list/${candidateId}/qualification`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          qualification: {
            candidateId,
            prospectId: "",
            organizationId: "",
            campaign: null,
            blockers: ["CANDIDATE_FORMAL_IDENTITY_MISSING"],
            qualification: null,
            approvedDecision: null,
            approvedChannel: null,
            scorecard: candidate.scorecard,
            stageCurrency: { company: false, icp: false, channel: false, contactability: false },
            vqaQualified: false,
            nextStep: "blocked"
          },
          opportunity: candidate
        })
      });
    });
    await page.route(`**/api/prospect-list/${candidateId}/website-probe`, async (route) => {
      candidate.websiteProbeAttempts = [queuedAttempt];
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ attempt: queuedAttempt, replayed: false, opportunity: candidate })
      });
    });
    await page.route(`**/api/prospect-list/${candidateId}/website-probe/${attemptId}/events**`, async (route) => {
      const body = `${streamedEvents.map((row) => `id: ${row.sequence}\nevent: probe_event\ndata: ${JSON.stringify(row)}\n\n`).join("")}event: done\ndata: ${JSON.stringify({ attemptId, status: "completed", outcome: "evidence_found", lastSequence: 7 })}\n\n`;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
        body
      });
    });
    await page.route(`**/api/prospect-list/${candidateId}/website-probe/${attemptId}`, async (route) => {
      candidate.websiteProbeAttempts = [completedAttempt];
      candidate.contactInfo = "sales@probe-ui.example.com";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ attempt: completedAttempt, terminal: true, opportunity: candidate })
      });
    });

    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);
    await openView(page, "prospect-list");
    await page.locator("#prospectSearchInput").fill(candidate.company);
    await page.locator("#prospectListRows [data-prospect-open]").first().click();
    await expect(page.locator(".prospect-probe-panel")).toContainText("受控访问 · 单次首页");
    await page.locator("#prospectWebsiteProbeButton").click();
    await expect(page.locator(".prospect-probe-panel")).toContainText("DNS 安全检查");
    await expect(page.locator(".prospect-probe-panel")).toContainText("robots 规则");
    await expect(page.locator(".prospect-probe-panel")).toContainText("首页预检");
    await expect(page.locator(".prospect-probe-panel")).toContainText("正文样本");
    await expect(page.locator(".prospect-probe-panel")).toContainText("最小证据");
    await expect(page.locator(".prospect-probe-panel")).toContainText("已结束");
    await expect(page.locator(".prospect-probe-panel")).toContainText("取得官网公开证据");
    await expect(page.locator(".prospect-probe-panel")).toContainText("Probe UI Company Limited");
    await expect(page.locator(".prospect-probe-panel")).toContainText("sales@probe-ui.example.com");
    await expect(page.locator("#prospectEditContactInfo")).toHaveValue("sales@probe-ui.example.com");
    await expect(page.locator(".prospect-probe-panel")).not.toContainText("部分完成");
  });

  test("ai config page saves GPT API key and tests connectivity", async ({ page }) => {
    await openView(page, "ai-config");
    await expect(page.locator("#ai-config")).toContainText("OpenAI");
    await expect(page.locator("#gptConfigState")).toBeVisible();

    await page.locator("#gptConfigName").fill(`自动化GPT配置-${runId}`);
    await page.locator("#gptBaseUrlInput").fill("https://example.com/v1");
    await page.locator("#gptModelInput").fill("gpt-4o-mini");
    await page.locator("#gptApiKeyInput").fill(`sk-test-${runId}`);
    await page.locator("#gptEnabledSelect").selectOption("true");
    await page.locator("#gptSaveButton").click();
    await expect(page.locator(".toast").last()).toContainText("已保存并启用");
    await expect(page.locator("#gptApiKeyInput")).toHaveValue(/\\*\\*\\*\\*/);
    await expect(page.locator("#gptConfigState")).toContainText("已启用");
    await expect(page.locator("#aiConfigList")).toContainText(`自动化GPT配置-${runId}`);

    await page.locator("#gptTestButton").click();
    await expect(page.locator("#gptConnectionBadge")).toContainText("连接失败");
    await expect(page.locator(".toast").last()).toContainText("AI 连接失败");

    await page.locator("#topSearchInput").fill("gpt");
    await page.locator("#topSearchInput").press("Enter");
    await expect(page.locator("#ai-config")).toHaveClass(/active/);
  });

  test("whatsapp workspace starts a customer conversation and records messages", async ({ page }) => {
    const company = `WhatsApp Customer ${runId}`;
    await apiFromPage(page, "/api/customers", {
      method: "POST",
      body: {
        company,
        country: "Singapore",
        contact: "Alicia Tan",
        stage: "询盘",
        amount: 18000,
        health: 80,
        grade: "A"
      }
    });
    await page.reload();
    await expect(page.locator("body")).toHaveClass(/is-authenticated/);

    await openView(page, "whatsapp");
    await expect(page.locator("#whatsapp .wa-layout")).toBeVisible();
    await expect(page.locator("#waChannelStatus")).toContainText(/人工同步|官方通道/);
    await page.locator("#waNewChatButton").click();
    await page.locator("#waCustomerPickerSearch").fill(company);
    await page.locator(`[data-wa-pick-customer]`).filter({ hasText: company }).click();
    await expect(page.locator("#waChatCol .wa-chat-title")).toContainText(company);
    await expect(page.locator("#waInfoCol")).toContainText("人工同步");

    await page.locator("#waBindPhone").fill("+6591234567");
    await page.locator("#waBindName").fill("Alicia");
    await page.locator("#waBindButton").click();
    await expect(page.locator(".toast").last()).toContainText("WhatsApp 号码已绑定");
    await page.locator("#waDirection").selectOption("outbound");
    await page.locator("#waContentInput").fill("Thanks Alicia, the quotation is ready.");
    await page.locator("#waSendButton").click();
    await expect(page.locator("#waMessages .wa-msg.out").last()).toContainText("Thanks Alicia, the quotation is ready.");
    await expect(page.locator("#waMessages .wa-msg.out").last()).toContainText("已记录");
    await expect(page.locator("#waThreadList")).toContainText(company);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("#whatsapp .wa-layout")).toHaveClass(/wa-mobile-chat-open/);
    await page.locator("#waMobileInfoButton").click();
    await expect(page.locator("#waInfoCol")).toHaveClass(/is-open/);
    await page.locator("#waInfoCloseButton").click();
    await page.locator("#waMobileBackButton").click();
    await expect(page.locator("#waThreadList")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  });

  test("profile page binds outbound email and signature", async ({ page }) => {
    await page.locator("#profileEntryButton").click();
    await expect(page.locator("#profile")).toHaveClass(/active/);
    await expect(page.locator("#profileNameTitle")).toContainText("Alex");
    await expect(page.locator("#profileOpenWhatsAppButton")).toHaveCount(0);
    await expect(page.locator("#profile")).not.toContainText("沟通渠道");

    const outboundEmail = `alex.sender.${runId}@example.com`;
    await page.locator("#profileOutboundEmail").fill(outboundEmail);
    await page.locator("#profileSenderName").fill("Alex Export");
    await page.locator("#profileEmailSignature").fill("Best regards\\nAlex Export\\nKeduoduo CRM");
    await page.locator("#profileSaveButton").click();
    await expect(page.locator(".toast").last()).toContainText("个人邮箱配置已保存");
    await expect(page.locator("#profileEmailStatus")).toContainText(outboundEmail);

    // 开发信触达已迁移到「搜客清单」页执行；个人主页只负责发件邮箱与签名绑定。
    await page.locator("#topSearchInput").fill("个人设置");
    await page.locator("#topSearchInput").press("Enter");
    await expect(page.locator("#profile")).toHaveClass(/active/);
  });

  test("competitor intelligence can create and update threat level", async ({ page }) => {
    const company = `自动化竞品公司-${runId}`;
    await openView(page, "competitors");
    await expect(page.locator("#competitors .intel-grid")).toBeVisible();
    await expect(page.locator("#competitors .intel-list .intel-card").first()).toBeVisible();

    await page.locator("#competitors .page-head .btn.primary").click();
    await page.locator("#competitorCompanyInput").fill(company);
    await page.locator("#competitorThreatInput").selectOption("high");
    await page.locator("#competitorProductsInput").fill("自动化测试产品");
    await page.locator("#competitorStrengthsInput").fill("本地仓交期快");
    await page.locator("#competitorWeaknessesInput").fill("定制能力弱");
    await page.locator("#competitorStrategyInput").fill("用小批量定制和资料完整度应对");
    await page.locator("#saveCompetitorButton").click();

    await expect(page.locator("#competitors .intel-list")).toContainText(company);
    await expect(page.locator("#competitor-detail-title")).toContainText(company);
    await expect(page.locator("#competitor-products")).toContainText("自动化测试产品");
    await page.locator("#competitorThreatButton").click();
    await expect(page.locator(".toast").last()).toContainText("中威胁");
  });

  test("case study library can create and publish a success case", async ({ page }) => {
    const caseTitle = `自动化成功案例-${runId}`;
    await openView(page, "cases");
    await expect(page.locator("#cases .case-grid")).toBeVisible();
    await expect(page.locator("#cases .case-list .case-card").first()).toBeVisible();

    await page.locator("#cases .page-head .btn.primary").click();
    await page.locator("#caseTitleInput").fill(caseTitle);
    await page.locator("#caseProductInput").fill("自动化工具套装");
    await page.locator("#caseIndustryInput").fill("工具批发");
    await page.locator("#caseResultInput").fill("拿下自动化首单");
    await page.locator("#caseStoryInput").fill("资料齐全后客户快速确认订单。");
    await page.locator("#caseReusableInput").fill("资料先行，报价后 48 小时复盘。");
    await page.locator("#saveCaseButton").click();

    await expect(page.locator("#cases .case-list")).toContainText(caseTitle);
    await expect(page.locator("#case-detail-title")).toContainText(caseTitle);
    await expect(page.locator("#case-product")).toContainText("自动化工具套装");
    await page.locator("#casePublishButton").click();
    await expect(page.locator(".toast").last()).toContainText("成功案例已发布");
    await expect(page.locator("#cases .case-card", { hasText: caseTitle }).first()).toContainText("已发布");
  });

  test("problem list can create and advance a solution workflow", async ({ page }) => {
    const problemTitle = `自动化问题-${runId}`;
    await openView(page, "problems");
    await expect(page.locator("#problems .problem-workspace")).toBeVisible();
    await expect(page.locator("#problems .problem-list .problem-card").first()).toBeVisible();

    await page.locator("#problems .page-head .btn.primary").click();
    await page.locator("#problemTitleInput").fill(problemTitle);
    await page.locator("#problemSeverityInput").selectOption("high");
    await page.locator("#problemCustomerInput").fill("示例产品客户");
    await page.locator("#problemRootInput").fill("客户审批缺少认证资料");
    await page.locator("#problemSolutionInput").fill("补发 CE 证书并同步报价模板");
    await page.locator("#problemNextInput").fill("今天 18:00 前完成二次确认");
    await page.locator("#saveProblemButton").click();

    await expect(page.locator("#problems .problem-list")).toContainText(problemTitle);
    await expect(page.locator("#problem-detail-title")).toContainText(problemTitle);
    await page.locator("#problemStatusButton").click();
    await expect(page.locator(".toast").last()).toContainText("解决中");
    await page.locator("#problemStatusButton").click();
    await expect(page.locator(".toast").last()).toContainText("已解决");
  });

  test("memo page can search autosave relate archive and recover notes", async ({ page }) => {
    const memoTitle = `自动化备忘-${runId}`;
    const switchMemoTitle = `切换目标备忘-${runId}`;
    await openView(page, "memos");
    await expect(page.locator("#memos .memo-grid")).toBeVisible();
    await expect(page.locator("#memos .memo-list .memo-card").first()).toBeVisible();

    await page.locator("#memos .page-head .btn.primary").click();
    await page.locator("#memoTitleInput").fill(memoTitle);
    await page.locator("#memoContentInput").fill("客户要求下次报价拆分认证资料和交期说明。");
    await page.locator(".memo-create-options summary").click();
    await page.locator("#memoCategoryInput").selectOption("客户备忘");
    await page.locator("#memoTagsInput").fill("自动化,客户");
    await page.locator("#memoDealInput").selectOption("d1");
    await page.locator("#saveMemoButton").click();

    await expect(page.locator("#memos .memo-list")).toContainText(memoTitle);
    await expect(page.locator("#memoTitleEditor")).toHaveValue(memoTitle);
    await expect(page.locator("#memoCustomerEditor")).toHaveValue("c1");
    await expect(page.locator("#memoDealEditor")).toHaveValue("d1");
    await page.locator("#memoSearchInput").fill("认证资料");
    await expect(page.locator("#memos .memo-list")).toContainText(memoTitle);
    await page.locator("#memoSearchInput").fill("");
    await page.locator("#memos .page-head .btn.primary").click();
    await page.locator("#memoTitleInput").fill(switchMemoTitle);
    await page.locator("#memoContentInput").fill("用于验证切换时自动保存。");
    await page.locator("#saveMemoButton").click();
    await expect(page.locator("#memos .memo-list")).toContainText(switchMemoTitle);
    await page.locator("#memos .memo-card", { hasText: memoTitle }).first().click();
    await page.locator("#memoContentEditor").fill("自动保存验证：切换左侧备忘前保存当前正文。");
    await expect(page.locator("#memoSaveState")).toContainText(/仅保存在本机|保存中/);
    await expect(page.locator("#memoSaveState")).toContainText("已保存到服务器", { timeout: 5000 });
    await page.locator("#memos .memo-card", { hasText: switchMemoTitle }).first().click();
    await page.locator("#memos .memo-card", { hasText: memoTitle }).first().click();
    await expect(page.locator("#memoContentEditor")).toHaveValue("自动保存验证：切换左侧备忘前保存当前正文。");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("#memos .memo-detail")).toBeVisible();
    await expect(page.locator("#memos .memo-sidebar")).toBeHidden();
    const memoMobileLayout = await page.evaluate(() => ({
      noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      titleWidth: document.querySelector("#memo-detail-title")?.getBoundingClientRect().width || 0,
      actionHeights: ["#memoSaveState", "#memoPinButton", "#memoArchiveButton", "#memoDeleteButton"]
        .map((selector) => document.querySelector(selector)?.getBoundingClientRect().height || 0)
    }));
    expect(memoMobileLayout.noHorizontalOverflow).toBe(true);
    expect(memoMobileLayout.titleWidth).toBeGreaterThan(150);
    expect(memoMobileLayout.actionHeights.every((height) => height >= 44)).toBe(true);
    await page.locator("#memoBackButton").click();
    await expect(page.locator("#memos .memo-sidebar")).toBeVisible();
    await expect(page.locator("#memos .memo-detail")).toBeHidden();
    await page.locator("#memos .memo-card", { hasText: memoTitle }).first().click();
    await expect(page.locator("#memos .memo-detail")).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator("#memoPinButton").click();
    await expect(page.locator("#memos .memo-card", { hasText: memoTitle }).first()).toContainText("置顶");
    await page.locator("#memoArchiveButton").click();
    await expect(page.locator("#memos .memo-card", { hasText: memoTitle }).first()).toContainText("归档");
    await page.locator("#memoDeleteButton").click();
    await page.locator("#confirmActionButton").click();
    await expect(page.locator(".toast").last()).toContainText("已移至已删除");
    await expect(page.locator("#memos .memo-card", { hasText: memoTitle }).first()).toContainText("已删除");
    await page.locator("#memoArchiveButton").click();
    await expect(page.locator(".toast").last()).toContainText("恢复到归档");
    await page.locator("#memoDeleteButton").click();
    await page.locator("#confirmActionButton").click();
    await expect(page.locator(".toast").last()).toContainText("已移至已删除");
    await page.locator("#memoDeleteButton").click();
    await page.locator("#confirmActionButton").click();
    await expect(page.locator(".toast").last()).toContainText("永久删除");
    await expect(page.locator("#memos .memo-card", { hasText: memoTitle })).toHaveCount(0);
  });

  test("executive report exports a presentation-ready file", async ({ page }) => {
    await openView(page, "reports");
    await expect(page.locator("#reports .report-deck")).toBeVisible();
    await expect(page.locator("#reportHeadline")).not.toContainText("正在加载", { timeout: 8_000 });
    await expect(page.locator("#reportPeriod")).toContainText("外贸销售实时经营快照");
    await expect(page.locator("#reportScope")).toContainText("本团队业务");
    await expect(page.locator("#reportAmountBasis")).toContainText("金额口径");
    await expect(page.locator("#reports")).not.toContainText("$428k");
    await expect(page.locator("#reports")).not.toContainText("42 单");
    await expect(page.locator("#reportPerformanceTable")).toBeVisible();
    await expect(page.locator("#reportPerformanceRows")).toContainText("Shirley");
    await expect(page.locator("#reportPerformanceRows")).toContainText("Mia");

    const scopedReports = await page.evaluate(async () => {
      const readReport = async (email: string) => {
        const loginResponse = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password: "keduoduo123" })
        });
        const login = await loginResponse.json();
        const reportResponse = await fetch("/api/reports/executive", {
          headers: { authorization: `Bearer ${login.token}` }
        });
        return reportResponse.json();
      };
      return {
        sales: await readReport("shirley@keduoduo.com"),
        admin: await readReport("admin@keduoduo.com")
      };
    });
    expect(scopedReports.sales.scope.label).toBe("本人业务");
    expect(scopedReports.sales.performance.every((row: { owner: string }) => row.owner === "Shirley")).toBe(true);
    expect(scopedReports.admin.scope.label).toBe("全公司业务");
    await page.evaluate(async () => {
      await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "alex@keduoduo.com", password: "keduoduo123" })
      });
    });

    await page.locator("#reports .page-head .btn", { hasText: "汇报备注" }).click();
    await page.locator("#reportNoteInput").fill("自动化汇报备注：本周聚焦报价逾期客户");
    await page.locator("#saveReportNoteButton").click();
    await expect(page.locator("#reports .report-hero")).toContainText("自动化汇报备注");
    await page.reload();
    await openView(page, "reports");
    await expect(page.locator("#reports .report-hero")).toContainText("自动化汇报备注");

    const downloadPromise = page.waitForEvent("download");
    await page.locator("#reportExportButton").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("Keduoduo-CRM");
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const exportText = await readFile(downloadPath!, "utf8");
    expect(exportText).toContain("本团队业务");
    expect(exportText).toContain("自动化汇报备注");
    expect(exportText).not.toContain("$428k");
    await expect(page.locator(".toast").last()).toContainText("汇报已生成下载");

    const riskButton = page.locator("#reportRiskDetailButton");
    if (await riskButton.isEnabled()) {
      await riskButton.click();
      const riskModal = page.locator(".modal", { hasText: "风险商机明细" });
      await expect(riskModal).toBeVisible();
      await riskModal.locator("[data-modal-close]").last().click();
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileReportLayout = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      performanceCards: getComputedStyle(document.querySelector("#reportPerformanceCards")!).display,
      performanceTable: getComputedStyle(document.querySelector("#reportPerformanceTable")!).display
    }));
    expect(mobileReportLayout.documentWidth).toBeLessThanOrEqual(mobileReportLayout.viewportWidth + 1);
    expect(mobileReportLayout.performanceCards).toBe("grid");
    expect(mobileReportLayout.performanceTable).toBe("none");
  });
});
