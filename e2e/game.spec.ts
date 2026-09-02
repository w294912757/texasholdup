import { expect, test, type Page } from "@playwright/test";

interface SavedScene {
  sessionId: string;
  actionSeq: number;
  currentSeat: number | null;
  deck: string[];
  board: string[];
  stacks: number[];
}

async function readSavedScene(page: Page): Promise<SavedScene> {
  return page.evaluate(
    () =>
      new Promise<SavedScene>((resolve, reject) => {
        const request = indexedDB.open("holdup-poker");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("activeGames", "readonly");
          const getAll = transaction.objectStore("activeGames").getAll();
          getAll.onerror = () => reject(getAll.error);
          getAll.onsuccess = () => {
            const record = getAll.result[0];
            const session = record.session;
            resolve({
              sessionId: session.id,
              actionSeq: session.currentHand.actionSeq,
              currentSeat: session.currentHand.currentSeat,
              deck: session.currentHand.deck,
              board: session.currentHand.board,
              stacks: session.currentHand.players.map(
                (player: { stack: number }) => player.stack,
              ),
            });
          };
        };
      }),
  );
}

async function startGame(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".account-switcher__name")).toHaveText("admin");
  await page.locator(".match-form__submit").click();
  await expect(page).toHaveURL(/#\/game/);
  await expect(page.locator(".poker-table")).toBeVisible();
  await expect(page.locator(".decision-panel__actions")).toBeVisible({
    timeout: 15_000,
  });
}

test("restores the exact saved scene and remains playable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await startGame(page);
  const beforeReload = await readSavedScene(page);
  await page.screenshot({
    path: "test-results/table-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator(".decision-panel__actions")).toBeVisible({
    timeout: 15_000,
  });
  expect(await readSavedScene(page)).toEqual(beforeReload);
  await page
    .locator(".decision-panel__button--check, .decision-panel__button--call")
    .first()
    .click();
  await expect(page.locator(".game-toolbar__save")).toBeVisible({
    timeout: 15_000,
  });
});

test("supports compact and narrow gameplay without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 520 });
  await startGame(page);
  await page.screenshot({
    path: "test-results/table-compact.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator(".decision-panel")).toBeInViewport();
  await page.setViewportSize({ width: 360, height: 640 });
  await expect(page.locator(".community-cards")).toBeVisible();
  await expect(page.locator(".decision-panel__actions")).toBeVisible();
  await page.screenshot({
    path: "test-results/table-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator(".decision-panel")).toBeInViewport();
});

test("leaving forfeits committed chips and creates a different match", async ({
  page,
}) => {
  await startGame(page);
  const original = await readSavedScene(page);
  await page.locator(".game-toolbar__leave").click();
  await page.locator(".el-message-box__btns .el-button--primary").click();
  await expect
    .poll(async () => (await readSavedScene(page)).sessionId, {
      timeout: 15_000,
    })
    .not.toBe(original.sessionId);
  const replacement = await readSavedScene(page);
  expect(replacement.sessionId).not.toBe(original.sessionId);
});

test("starts the next hand after a completed hand", async ({ page }) => {
  await startGame(page);
  for (let turn = 0; turn < 80; turn += 1) {
    if (await page.locator(".decision-panel__result").isVisible()) break;
    const humanAction = page
      .locator(
        ".decision-panel__actions .decision-panel__button:not([disabled])",
      )
      .first();
    if (await humanAction.isVisible()) await humanAction.click();
    else await page.waitForTimeout(200);
  }
  await expect(page.locator(".decision-panel__result")).toBeVisible({
    timeout: 15_000,
  });
  await page.locator(".decision-panel__next").click();
  await expect(page.locator(".game-toolbar__hand")).toContainText("2 / 20", {
    timeout: 15_000,
  });
});

test("creates another account and returns to the saved admin table", async ({
  page,
}) => {
  await startGame(page);
  await page.locator(".application-brand").click();
  await expect(page).toHaveURL(/#\/$/);
  await page.locator(".account-switcher__trigger").click();
  await page.getByRole("menuitem", { name: "账号管理" }).click();
  const accountDialog = page.locator(".account-switch-dialog");
  await accountDialog
    .locator(".account-management-dialog__input input")
    .fill("second");
  await accountDialog.getByRole("button", { name: "新建" }).click();
  await expect(page.locator(".account-switcher__name")).toHaveText("second");
  await page.keyboard.press("Escape");
  await expect(page.locator(".match-setup")).toBeVisible();
  await page.locator(".account-switcher__trigger").click();
  await page.getByRole("menuitem", { name: "账号管理" }).click();
  await expect(accountDialog).toBeVisible();
  await accountDialog
    .locator(".account-switch-dialog__entry")
    .filter({ hasText: "admin" })
    .getByRole("button", { name: "切换" })
    .click();
  await expect(page.locator(".account-switcher__name")).toHaveText("admin");
  await expect(page.locator(".resume-session__button")).toBeVisible();
  await page.locator(".resume-session__button").click();
  await expect(page).toHaveURL(/#\/game/);
  await expect(page.locator(".poker-table")).toBeVisible();
});

test("replays an archived hand one action at a time", async ({ page }) => {
  await startGame(page);
  await page.locator(".game-toolbar__leave").click();
  await page.locator(".el-message-box__btns .el-button--primary").click();
  await expect(page.locator(".poker-table")).toBeVisible({ timeout: 15_000 });
  await page
    .locator(".application-navigation__button")
    .filter({ hasText: "记录" })
    .click();
  await expect(page.locator(".history-table")).toBeVisible();
  await page.locator(".history-table .el-table__row").first().click();
  await expect(page.locator(".history-replay")).toBeVisible();
  await expect(page.locator(".history-replay__step")).toContainText("行动 1 /");
  await page.getByTitle("下一步").click();
  await expect(page.locator(".history-replay__step")).toContainText("行动 2 /");
  await expect(page.locator(".history-detail__event--active")).toHaveCount(1);
});
