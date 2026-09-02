import { afterEach, describe, expect, it } from "vitest";
import {
  createGameSession,
  forceHumanLeave,
  getCurrentPlayer,
  getLegalActions,
  applyPlayerAction,
  startNextHand,
} from "@/domain/engine";
import { PokerDatabase } from "@/persistence/database";
import { GameRepository, StaleGameError } from "@/persistence/repository";
import type { GameSession, PlayerAction } from "@/domain/types";

const databases: PokerDatabase[] = [];

function repository(): GameRepository {
  const database = new PokerDatabase(`test-${crypto.randomUUID()}`);
  databases.push(database);
  return new GameRepository(database);
}

function safeAction(session: GameSession): PlayerAction {
  const current = getCurrentPlayer(session)!;
  const legal = getLegalActions(session, current.id);
  if (legal.some((action) => action.type === "check")) return { type: "check" };
  if (legal.some((action) => action.type === "call")) return { type: "call" };
  return { type: "fold" };
}

const config = {
  aiCount: 2,
  buyIn: 1_000,
  smallBlind: 10,
  bigBlind: 20,
  maxHands: 20,
};

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("transactional game repository", () => {
  it("creates and selects the default admin account", async () => {
    const store = repository();
    const account = await store.initialize();

    expect(account.name).toBe("admin");
    expect(account.bankroll).toBe(10_000);
    expect((await store.listAccounts()).map((entry) => entry.name)).toEqual([
      "admin",
    ]);
  });

  it("persists every action and rejects a stale replay", async () => {
    const store = repository();
    const account = await store.initialize();
    const created = createGameSession(
      account.id,
      account.name,
      account.level,
      config,
      41,
    );
    const started = await store.beginSession(created);
    const current = getCurrentPlayer(started.session)!;
    const advanced = applyPlayerAction(
      started.session,
      current.id,
      safeAction(started.session),
    );
    const committed = await store.commitSession(advanced);

    expect(committed.revision).toBe(2);
    expect(
      (await store.loadActiveSession(account.id))?.currentHand.actionSeq,
    ).toBe(committed.currentHand.actionSeq);
    await expect(store.commitSession(advanced)).rejects.toBeInstanceOf(
      StaleGameError,
    );
  });

  it("restores the exact committed deck and action state", async () => {
    const store = repository();
    const account = await store.initialize();
    const started = await store.beginSession(
      createGameSession(account.id, account.name, account.level, config, 77),
    );
    const current = getCurrentPlayer(started.session)!;
    const committed = await store.commitSession(
      applyPlayerAction(
        started.session,
        current.id,
        safeAction(started.session),
      ),
    );
    const restored = await store.loadActiveSession(account.id);

    expect(restored).toEqual(committed);
    expect(restored?.currentHand.deck).toEqual(committed.currentHand.deck);
    expect(restored?.currentHand.currentSeat).toBe(
      committed.currentHand.currentSeat,
    );
  });

  it("archives a hand and saves its replacement roster atomically", async () => {
    const store = repository();
    const account = await store.initialize();
    const started = await store.beginSession(
      createGameSession(account.id, account.name, account.level, config, 79),
    );
    let completed = started.session;
    while (completed.currentHand.phase !== "complete") {
      const current = getCurrentPlayer(completed)!;
      completed = applyPlayerAction(
        completed,
        current.id,
        safeAction(completed),
      );
    }
    completed.currentHand.players.find((player) => !player.isHuman)!.stack = 0;
    const next = startNextHand(completed);
    const saved = await store.commitNextHand(completed, next);

    expect(await store.loadActiveSession(account.id)).toEqual(saved);
    expect(await store.listHandRecords(account.id)).toHaveLength(1);
    expect(saved.currentHand.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["ai-left", "ai-joined"]),
    );
  });

  it("keeps committed chips when leaving and starts a fresh match", async () => {
    const store = repository();
    const account = await store.initialize();
    const started = await store.beginSession(
      createGameSession(account.id, account.name, account.level, config, 90),
    );
    const abandoned = forceHumanLeave(started.session);
    const human = abandoned.currentHand.players.find(
      (player) => player.isHuman,
    )!;
    const replacement = createGameSession(
      account.id,
      account.name,
      account.level,
      config,
      91,
    );
    const result = await store.replaceAfterLeave(abandoned, replacement);

    expect(result.account.bankroll).toBe(
      10_000 - config.buyIn + human.stack - config.buyIn,
    );
    expect(result.session.id).not.toBe(started.session.id);
    expect((await store.listHandRecords(account.id))[0]?.leftTable).toBe(true);
  });

  it("keeps hand history isolated between local accounts", async () => {
    const store = repository();
    const admin = await store.initialize();
    const started = await store.beginSession(
      createGameSession(admin.id, admin.name, admin.level, config, 145),
    );
    let abandoned = forceHumanLeave(started.session);
    while (abandoned.currentHand.phase !== "complete") {
      const current = getCurrentPlayer(abandoned)!;
      abandoned = applyPlayerAction(
        abandoned,
        current.id,
        safeAction(abandoned),
      );
    }
    abandoned = await store.commitSession(abandoned);
    await store.closeAfterLeave(abandoned);

    const second = await store.createAccount("second");
    expect((await store.listHandRecords(admin.id)).length).toBe(1);
    expect(await store.listHandRecords(second.id)).toEqual([]);
  });

  it("keeps favorites and notes account-scoped and includes them in backups", async () => {
    const store = repository();
    const admin = await store.initialize();
    const started = await store.beginSession(
      createGameSession(admin.id, admin.name, admin.level, config, 146),
    );
    let abandoned = forceHumanLeave(started.session);
    while (abandoned.currentHand.phase !== "complete") {
      const current = getCurrentPlayer(abandoned)!;
      abandoned = applyPlayerAction(
        abandoned,
        current.id,
        safeAction(abandoned),
      );
    }
    abandoned = await store.commitSession(abandoned);
    await store.closeAfterLeave(abandoned);
    const history = await store.listHandRecords(admin.id);
    const updated = await store.updateHandAnnotation(admin.id, history[0]!.id, {
      favorite: true,
      note: "复盘这手翻牌前加注",
    });
    const second = await store.createAccount("annotation-second");

    expect(updated).toMatchObject({
      favorite: true,
      note: "复盘这手翻牌前加注",
      playerLevel: 1,
    });
    await expect(
      store.updateHandAnnotation(second.id, updated.id, { favorite: false }),
    ).rejects.toThrow("不属于当前账号");

    const imported = await store.importAccountBackup(
      await store.exportAccount(admin.id),
      "annotation-backup",
    );
    expect(await store.listHandRecords(imported.id)).toMatchObject([
      { favorite: true, note: "复盘这手翻牌前加注", playerLevel: 1 },
    ]);
  });

  it("keeps game settings account-scoped and includes them in backups", async () => {
    const store = repository();
    const admin = await store.initialize();
    await store.saveSettings(admin.id, {
      aiThinkingTime: 0,
      cardStyle: "high-contrast",
      volume: 72,
    });
    const second = await store.createAccount("settings-second");

    expect(await store.loadSettings(admin.id)).toMatchObject({
      aiThinkingTime: 0,
      cardStyle: "high-contrast",
      volume: 72,
    });
    expect(await store.loadSettings(second.id)).toMatchObject({
      aiThinkingTime: 360,
      cardStyle: "classic",
      volume: 35,
    });

    const imported = await store.importAccountBackup(
      await store.exportAccount(admin.id),
      "settings-backup",
    );
    expect(await store.loadSettings(imported.id)).toMatchObject({
      aiThinkingTime: 0,
      cardStyle: "high-contrast",
      volume: 72,
    });
  });

  it("keeps the selected account when deleting another account", async () => {
    const store = repository();
    const admin = await store.initialize();
    const second = await store.createAccount("second");

    await store.switchAccount(admin.id);
    const selected = await store.deleteAccount(second.id);

    expect(selected.id).toBe(admin.id);
    expect((await store.getCurrentAccount()).id).toBe(admin.id);
    expect((await store.listAccounts()).map((entry) => entry.name)).toEqual([
      "admin",
    ]);
  });

  it("rejects deleting the selected account", async () => {
    const store = repository();
    const admin = await store.initialize();

    await expect(store.deleteAccount(admin.id)).rejects.toThrow(
      "当前账号不可删除，请先切换账号",
    );
    expect((await store.listAccounts()).map((entry) => entry.name)).toEqual([
      "admin",
    ]);
  });

  it("exports and imports an account backup without overwriting the source", async () => {
    const store = repository();
    const admin = await store.initialize();
    const started = await store.beginSession(
      createGameSession(admin.id, admin.name, admin.level, config, 314),
    );

    const serialized = await store.exportAccount(admin.id);
    const imported = await store.importAccountBackup(serialized, "backup-user");
    const restored = await store.loadActiveSession(imported.id);

    expect(imported.name).toBe("backup-user");
    expect(imported.id).not.toBe(admin.id);
    expect(
      (await store.listAccounts()).map((entry) => entry.name).sort(),
    ).toEqual(["admin", "backup-user"]);
    expect(restored?.accountId).toBe(imported.id);
    expect(restored?.accountName).toBe("backup-user");
    expect(
      restored?.currentHand.players.find((player) => player.isHuman)?.name,
    ).toBe("backup-user");
    expect(restored?.currentHand.deck).toEqual(
      started.session.currentHand.deck,
    );
  });

  it("rejects malformed account backups without creating an account", async () => {
    const store = repository();
    await store.initialize();

    await expect(
      store.importAccountBackup('{"kind":"unknown"}', "bad"),
    ).rejects.toThrow("备份文件版本或结构不受支持");
    expect((await store.listAccounts()).map((entry) => entry.name)).toEqual([
      "admin",
    ]);
  });

  it("records manual downgrades in the progression ledger", async () => {
    const store = repository();
    const admin = await store.initialize();
    await store.db.accounts.update(admin.id, {
      level: 3,
      highestLevel: 3,
      currentLevelXp: 40,
    });

    const downgraded = await store.downgradeAccount(admin.id, 1);
    const records = await store.listProgression(admin.id);

    expect(downgraded.level).toBe(1);
    expect(records).toMatchObject([
      {
        type: "downgrade",
        experience: -40,
        levelBefore: 3,
        levelAfter: 1,
      },
    ]);
  });

  it("records one experience settlement when a session finishes", async () => {
    const store = repository();
    const admin = await store.initialize();
    const started = await store.beginSession(
      createGameSession(admin.id, admin.name, admin.level, config, 908),
    );
    const completed = structuredClone(started.session);
    completed.status = "complete";
    completed.completedHands = 20;
    completed.currentHand.phase = "complete";
    completed.currentHand.currentSeat = null;
    completed.currentHand.players.find((player) => player.isHuman)!.stack =
      1_500;

    const account = await store.finishSession(completed);
    const records = await store.listProgression(admin.id);

    expect(account.currentLevelXp).toBeGreaterThan(0);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: "experience",
      sessionId: completed.id,
      levelBefore: 1,
    });
  });
});
