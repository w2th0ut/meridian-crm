import { expect, type Page } from "@playwright/test";

/**
 * Navigate to a view regardless of the responsive navigation state.
 * The refactored shell collapses sections into <details> on desktop and
 * moves the whole sidebar off-canvas on mobile, so a plain click on a nav
 * button is not reliable until the matching surface is expanded.
 */
export async function openView(page: Page, view: string, selectorSuffix = "") {
  if (view === "inbox") {
    await page.locator("#notificationBellButton").click();
    await expect(page.locator("#inbox")).toHaveClass(/active/);
    return;
  }

  const button = page.locator(`.sidebar button[data-view="${view}"]${selectorSuffix}`).first();
  if (!(await button.isVisible())) {
    const menuToggle = page.locator("#tradeMenuToggle");
    if (
      (await menuToggle.isVisible()) &&
      !(await page.locator("body").evaluate((body) => body.classList.contains("trade-navigation-open")))
    ) {
      await menuToggle.click();
    }
  }

  if (!(await button.isVisible())) {
    const section = button.locator("xpath=ancestor::details[1]");
    if (await section.count()) {
      await section.evaluate((element) => {
        (element as HTMLDetailsElement).open = true;
      });
    }
  }

  if (await button.isVisible()) {
    await button.click();
  } else {
    // Some entries live in a clipped scroll area inside the sidebar; a DOM click
    // still triggers the same navigation handler without fighting the layout.
    await button.evaluate((element) => (element as HTMLElement).click());
  }
  await expect(page.locator(`#${view}`)).toHaveClass(/active/);
}
