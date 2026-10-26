import { expect, test } from "@playwright/test";
import { openView } from "./navigation";

async function login(
  page: import("@playwright/test").Page,
  email: string,
  expectedName: string
) {
  await page.goto("/");
  await page.locator("#loginEmail").fill(email);
  await page.locator("#loginPassword").fill("keduoduo123");
  await page.locator("#loginButton").click();
  await expect(page.locator("body")).toHaveClass(/is-authenticated/);
  await expect(page.locator("#scopeUser")).toContainText(expectedName);
}

async function logout(page: import("@playwright/test").Page) {
  await page.locator("#logoutButton").click();
  await expect(page.locator("body")).not.toHaveClass(/is-authenticated/);
}

test("daily report and internal message collaboration flow", async ({ page }) => {
  const marker = `${Date.now()}`;
  const completedWork = `日报端到端测试 ${marker}`;
  const updatedWork = `${completedWork} 已更新`;
  const managerComment = `主管反馈 ${marker}`;
  const salespersonReply = `业务回复 ${marker}`;

  await login(page, "shirley@keduoduo.com", "Shirley");
  await openView(page, "daily-reports");
  await page.locator("#newDailyReportButton").click();
  await page.locator("#dailyReportCompletedInput").fill(completedWork);
  await page.locator("#dailyReportCustomerInput").fill("客户已确认产品参数，等待正式报价。");
  await page.locator("#dailyReportResultsInput").fill("新增 2 个有效触点");
  await page.locator("#dailyReportNextPlanInput").fill("次日上午发送报价");
  await page.locator("#saveDailyReportButton").click();
  await expect(page.locator("#appModal")).not.toHaveClass(/active/);
  await expect(page.locator("#dailyReportDetail")).toContainText(completedWork);

  await page.locator("#editDailyReportButton").click();
  await page.locator("#dailyReportCompletedInput").fill(updatedWork);
  await page.locator("#saveDailyReportButton").click();
  await expect(page.locator("#dailyReportList .daily-report-row")).toHaveCount(1);
  await expect(page.locator("#dailyReportDetail")).toContainText(updatedWork);

  await logout(page);
  await login(page, "alex@keduoduo.com", "Alex");
  await openView(page, "daily-reports");
  await expect(page.locator("#dailyReportDetail")).toContainText(updatedWork);
  await page.locator("#dailyReportCommentInput").fill(managerComment);
  await page.locator("#submitDailyReportCommentButton").click();
  await expect(page.locator("#dailyReportDetail")).toContainText(managerComment);

  await logout(page);
  await login(page, "shirley@keduoduo.com", "Shirley");
  await expect(page.locator("#notificationBellBadge")).toBeVisible();
  await expect(page.locator("#notificationBellBadge")).not.toHaveAttribute("hidden", "");
  await openView(page, "inbox");
  const commentNotification = page.locator("#inboxMessageList .notification-message-row", {
    hasText: "评论了你的日报"
  }).first();
  await expect(commentNotification).toBeVisible();
  await commentNotification.click();
  await expect(page.locator("#daily-reports")).toHaveClass(/active/);
  await expect(page.locator("#dailyReportDetail")).toContainText(managerComment);
  await page.locator("[data-reply-daily-comment]").first().click();
  await page.locator("#dailyReportReplyInput").fill(salespersonReply);
  await page.locator("#sendDailyReportReplyButton").click();
  await expect(page.locator("#dailyReportDetail")).toContainText(salespersonReply);

  await logout(page);
  await login(page, "alex@keduoduo.com", "Alex");
  await openView(page, "inbox");
  const replyNotification = page.locator("#inboxMessageList .notification-message-row", {
    hasText: "回复了你的日报评论"
  }).first();
  await expect(replyNotification).toBeVisible();
  await replyNotification.click();
});

test("collaboration pages fit a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "shirley@keduoduo.com", "Shirley");

  for (const view of ["daily-reports", "inbox"]) {
    await openView(page, view);
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    expect(hasHorizontalOverflow).toBe(false);
    await expect(page.locator(`#${view} .collab-page-head .head-actions .btn`).first()).toBeVisible();
  }
});
