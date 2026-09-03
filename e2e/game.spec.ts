import { expect, test, type Page } from "@playwright/test";

interface SavedScene {
  sessionId: string;
  actionSeq: number;
  currentSeat: number | null;
  deck: string[];
  board: string[];
  stacks: number[];
}

interface SavedRosterChange {
  rosterIds: string[];
  eventTypes: string[];
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

async function forceSavedAiBust(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open("holdup-poker");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("activeGames", "readwrite");
          const store = transaction.objectStore("activeGames");
          const getAll = store.getAll();
          getAll.onerror = () => reject(getAll.error);
          getAll.onsuccess = () => {
            const record = getAll.result[0];
            const player = record.session.currentHand.players.find(
              (candidate: { isHuman: boolean }) => !candidate.isHuman,
            );
            if (!player) {
              reject(new Error("missing AI player"));
              return;
            }
            player.stack = 0;
            store.put(record);
            transaction.oncomplete = () => resolve(player.id);
            transaction.onerror = () => reject(transaction.error);
          };
        };
      }),
  );
}

async function readSavedRosterChange(page: Page): Promise<SavedRosterChange> {
  return page.evaluate(
    () =>
      new Promise<SavedRosterChange>((resolve, reject) => {
        const request = indexedDB.open("holdup-poker");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("activeGames", "readonly");
          const getAll = transaction.objectStore("activeGames").getAll();
          getAll.onerror = () => reject(getAll.error);
          getAll.onsuccess = () => {
            const session = getAll.result[0].session;
            resolve({
              rosterIds: session.roster.map(
                (profile: { id: string }) => profile.id,
              ),
              eventTypes: session.currentHand.events.map(
                (event: { type: string }) => event.type,
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
  await expect(page.locator(".round-overview")).toBeVisible();
  await expect(page.locator(".decision-panel__actions")).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.locator(".player-row--opponent .player-row__hand-type"),
  ).toHaveCount(0);
}

async function expectReadableCards(
  page: Page,
  communitySize: { width: number; height: number },
): Promise<void> {
  const communityCard = page.locator(".community-cards .playing-card").first();
  const holeCard = page.locator(".player-row--human .playing-card").first();
  await expect(communityCard).toHaveCSS("width", `${communitySize.width}px`);
  await expect(communityCard).toHaveCSS("height", `${communitySize.height}px`);
  await expect(holeCard).toHaveCSS("width", "34px");
  await expect(holeCard).toHaveCSS("height", "48px");
  await expect(
    page.locator(".player-row--human .playing-card__rank").first(),
  ).toHaveCSS("font-size", "13px");
  await expect(
    page.locator(".player-row--human .playing-card__suit").first(),
  ).toHaveCSS("font-size", "18px");
}

test("restores the exact saved scene and remains playable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await startGame(page);
  await page.locator(".game-toolbar__gto").hover();
  await expect(
    page.locator(".el-popper").filter({ hasText: "%" }).last(),
  ).toBeVisible();
  const beforeReload = await readSavedScene(page);
  await page.screenshot({
    path: "test-results/table-desktop.png",
    fullPage: true,
  });
  await expectReadableCards(page, { width: 56, height: 80 });
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
  await expectReadableCards(page, { width: 44, height: 64 });
  expect(
    await page.evaluate(() => {
      const betControl = document
        .querySelector(".bet-control")
        ?.getBoundingClientRect();
      const actionButtons = document
        .querySelector(".decision-panel__buttons")
        ?.getBoundingClientRect();
      return Boolean(
        !betControl || !actionButtons || betControl.right <= actionButtons.left,
      );
    }),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator(".decision-panel")).toBeInViewport();
  await page.setViewportSize({ width: 360, height: 640 });
  await expect(page.locator(".community-cards")).toBeVisible();
  await expect(page.locator(".decision-panel__actions")).toBeVisible();
  await expect(page.locator(".player-row")).toHaveCount(6);
  await page.screenshot({
    path: "test-results/table-mobile.png",
    fullPage: true,
  });
  await expectReadableCards(page, { width: 44, height: 64 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator(".decision-panel")).toBeInViewport();
  await page.locator(".game-toolbar__gto").click();
  await expect(page.locator(".gto-dialog")).toBeVisible();
  await expect(page.locator(".gto-reference__action").first()).toBeVisible();
  await page.waitForTimeout(350);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/gto-mobile.png",
    fullPage: true,
  });
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
  const winnerSeats = page.locator(".player-row--winner");
  expect(await winnerSeats.count()).toBeGreaterThan(0);
  expect(
    await winnerSeats
      .first()
      .evaluate((element) =>
        getComputedStyle(element).boxShadow.includes("79, 209, 154"),
      ),
  ).toBe(true);
  expect(
    await page
      .locator(
        ".player-row--opponent:not(.player-row--folded) .player-row__hand-type",
      )
      .count(),
  ).toBe(
    await page
      .locator(".player-row--opponent:not(.player-row--folded)")
      .count(),
  );
  await page.screenshot({
    path: "test-results/table-winner-highlight.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 640, height: 520 });
  await winnerSeats.first().scrollIntoViewIfNeeded();
  await expect(winnerSeats.first()).toBeInViewport();
  await page.screenshot({
    path: "test-results/table-winner-highlight-compact.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 360, height: 640 });
  await expect(winnerSeats.first()).toBeInViewport();
  await page.screenshot({
    path: "test-results/table-winner-highlight-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  const bustedAiId = await forceSavedAiBust(page);
  await page.reload();
  await expect(page.locator(".decision-panel__result")).toBeVisible({
    timeout: 15_000,
  });
  expect(await page.locator(".player-row--winner").count()).toBeGreaterThan(0);
  await page.locator(".decision-panel__next").click();
  await expect(page.locator(".game-toolbar__hand")).toContainText("2 / 20", {
    timeout: 15_000,
  });
  await expect(page.locator(".player-row--winner")).toHaveCount(0);
  await expect(page.locator(".el-message__content")).toContainText("离桌");
  await expect(page.locator(".el-message")).toBeInViewport();
  await page.waitForTimeout(250);
  await page.screenshot({
    path: "test-results/table-roster-change.png",
    fullPage: true,
  });
  await expect(
    page
      .locator(".action-history__message")
      .filter({ hasText: "离开牌桌" })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .locator(".action-history__message")
      .filter({ hasText: "加入牌桌" })
      .first(),
  ).toBeVisible();
  const saved = await readSavedRosterChange(page);
  expect(saved.rosterIds).not.toContain(bustedAiId);
  expect(saved.eventTypes).toEqual(
    expect.arrayContaining(["ai-left", "ai-joined"]),
  );
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
  await expect(page.locator(".round-overview")).toBeVisible();
});

test("replays an archived hand one action at a time", async ({ page }) => {
  await startGame(page);
  await page.locator(".game-toolbar__leave").click();
  await page.locator(".el-message-box__btns .el-button--primary").click();
  await expect(page.locator(".round-overview")).toBeVisible({
    timeout: 15_000,
  });
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
  await expect(page.locator(".history-replay-player--winner")).toHaveCount(0);
  await page.getByRole("slider").press("End");
  expect(
    await page.locator(".history-replay-player--winner").count(),
  ).toBeGreaterThan(0);
});

test("keeps annotations and statistics isolated between accounts", async ({
  page,
}) => {
  await startGame(page);
  await page.locator(".game-toolbar__leave").click();
  await page.locator(".el-message-box__btns .el-button--primary").click();
  await expect(page.locator(".round-overview")).toBeVisible({
    timeout: 15_000,
  });

  await page
    .locator(".application-navigation__button")
    .filter({ hasText: "记录" })
    .click();
  const firstRow = page.locator(".history-table .el-table__row").first();
  await expect(firstRow).toBeVisible();
  await firstRow.locator(".history-table__favorite").click();
  await expect(
    firstRow.locator(".history-table__favorite--active"),
  ).toHaveCount(1);
  await firstRow.click();
  const drawer = page.locator(".history-detail");
  await drawer
    .locator(".history-annotation__input textarea")
    .fill("复盘：注意翻牌前投入");
  await drawer.getByRole("button", { name: "保存备注" }).click();
  await expect(page.locator(".el-message__content")).toContainText(
    "备注已保存",
  );
  await page.keyboard.press("Escape");

  await page
    .locator(".application-navigation__button")
    .filter({ hasText: "统计" })
    .click();
  await expect(page).toHaveURL(/#\/statistics/);
  await expect(page.locator(".statistics-header__title")).toHaveText(
    "牌局统计",
  );
  await expect(
    page
      .locator(".statistics-metric")
      .filter({ hasText: "总手数" })
      .locator(".statistics-metric__value"),
  ).toHaveText("1");
  await page
    .locator(".statistics-filter__favorite .el-checkbox__label")
    .click();
  await expect(page.locator(".statistics-header__sample")).toContainText(
    "1 / 1 手",
  );

  const viewports = [
    { name: "wide", width: 1920, height: 1080 },
    { name: "desktop", width: 1366, height: 768 },
    { name: "tablet", width: 1024, height: 768 },
    { name: "compact", width: 640, height: 520 },
    { name: "mobile", width: 360, height: 640 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".statistics-filters")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/statistics-${viewport.name}.png`,
      fullPage: true,
    });
  }
  expect(
    await page
      .locator(".statistics-page")
      .evaluate(
        (root) =>
          [...root.querySelectorAll("button, input, textarea")].filter(
            (control) =>
              !control.getAttribute("aria-label") &&
              !control.getAttribute("title") &&
              !control.getAttribute("placeholder") &&
              !(control as HTMLInputElement).labels?.length &&
              !control.textContent?.trim(),
          ).length,
      ),
  ).toBe(0);

  await page.locator(".account-switcher__trigger").click();
  await page.getByRole("menuitem", { name: "账号管理" }).click();
  const accountDialog = page.locator(".account-switch-dialog");
  await accountDialog
    .locator(".account-management-dialog__input input")
    .fill("stats-second");
  await accountDialog.getByRole("button", { name: "新建" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".account-switcher__name")).toHaveText(
    "stats-second",
  );
  await expect(
    page
      .locator(".statistics-metric")
      .filter({ hasText: "总手数" })
      .locator(".statistics-metric__value"),
  ).toHaveText("0");

  await page.locator(".account-switcher__trigger").click();
  await page.getByRole("menuitem", { name: "账号管理" }).click();
  await accountDialog
    .locator(".account-switch-dialog__entry")
    .filter({ hasText: "admin" })
    .getByRole("button", { name: "切换" })
    .click();
  await page
    .locator(".application-navigation__button")
    .filter({ hasText: "记录" })
    .click();
  await page.locator(".history-header__search input").fill("翻牌前投入");
  await expect(page.locator(".history-table .el-table__row")).toHaveCount(1);
  await expect(page.locator(".history-table__favorite--active")).toHaveCount(1);
});

test("shows AI matching by default and keeps the upgrade rules", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/");
  await page.getByRole("button", { name: "查看经验与升级规则" }).click();
  const dialog = page.locator(".progression-help-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "AI 匹配" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(dialog).toContainText("当前可匹配范围");
  await expect(dialog).toContainText("1–3 档");
  await expect(dialog).toContainText("1–12 档");
  await expect(dialog).toContainText("85%");
  await expect(dialog).toContainText("15%");
  await expect(dialog).toContainText("基础");
  await expect(dialog).toContainText("专家");
  await expect(dialog).toContainText("不会显示任何 AI 的实际档位");
  await dialog.getByRole("tab", { name: "经验规则" }).click();
  await expect(dialog).toContainText("正常完成 20 手牌");
  await expect(dialog).toContainText("净盈利 ÷ 10");
  await expect(dialog).toContainText("当前等级 × 100 XP");
  await expect(dialog).toContainText("只能选择低于当前等级");
  await expect(dialog).toBeInViewport();
  expect(
    await page.evaluate(() =>
      Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
    ),
  ).toBeLessThanOrEqual(360);
});

test("persists account-scoped game settings and applies card styling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/#/settings");
  await expect(page.locator(".settings-header__title")).toHaveText("游戏设置");
  await page
    .locator(".settings-row")
    .filter({ hasText: "AI 思考时间" })
    .locator(".el-select")
    .click();
  await page.getByRole("option", { name: "即时" }).click();
  await page
    .locator(".settings-row")
    .filter({ hasText: "牌面样式" })
    .getByText("高对比", { exact: true })
    .click();
  await expect(page.locator(".el-message__content").last()).toContainText(
    "设置已保存",
  );
  await page.reload();
  await expect(
    page.locator(".settings-row").filter({ hasText: "AI 思考时间" }),
  ).toContainText("即时");

  await page.locator(".application-brand").click();
  await page.locator(".match-form__submit").click();
  await expect(page).toHaveURL(/#\/game/);
  await expect(page.locator(".application-shell")).toHaveClass(
    /application-shell--cards-high-contrast/,
  );
  await expect(
    page.locator(".player-row--human .playing-card").first(),
  ).toHaveCSS("border-top-width", "2px");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
