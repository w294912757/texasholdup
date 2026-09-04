import { expect, test } from "@playwright/test";

test("runs an isolated rules sandbox case", async ({ page }) => {
  await page.goto("/#/sandbox");
  await expect(page.locator(".sandbox-header__title")).toContainText(
    "测试沙盒",
  );
  await page.locator(".sandbox-editor__run").click();
  await expect(page.locator(".sandbox-results__empty")).toHaveCount(0);
  await expect(page.locator(".sandbox-result-players")).toBeVisible();
  await expect(page.locator(".sandbox-pot-list")).toBeVisible();
});

test("keeps sandbox usable in a narrow portrait viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/#/sandbox");
  await expect(page.locator(".sandbox-page")).toBeVisible();
  const overflow = await page.evaluate(() => {
    const offenders = Array.from(document.querySelectorAll<HTMLElement>("*"))
      .filter(
        (element) =>
          element.getBoundingClientRect().right > window.innerWidth + 1,
      )
      .map(
        (element) =>
          `${element.className}:${element.getBoundingClientRect().right}`,
      );
    return {
      value: document.documentElement.scrollWidth > window.innerWidth + 1,
      offenders: offenders.slice(0, 12),
    };
  });
  expect(overflow.value, overflow.offenders.join(" | ")).toBe(false);
});
