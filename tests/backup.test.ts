import { afterEach, describe, expect, it } from "vitest";
import { createGameSession } from "@/domain/engine";
import { BackupRepository } from "@/persistence/backup";
import { PokerDatabase } from "@/persistence/database";
import { GameRepository } from "@/persistence/repository";

const databases: PokerDatabase[] = [];

function repositories(): {
  database: PokerDatabase;
  game: GameRepository;
  backup: BackupRepository;
} {
  const database = new PokerDatabase(`backup-test-${crypto.randomUUID()}`);
  databases.push(database);
  return {
    database,
    game: new GameRepository(database),
    backup: new BackupRepository(database),
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("local backup repository", () => {
  it("exports a verified manifest and keeps the configured snapshots", async () => {
    const { game, backup } = repositories();
    await game.initialize();
    await backup.setSnapshotRetention(1);
    const serialized = await backup.exportLocalBackup();
    await backup.createSnapshot("manual");

    const inspected = backup.inspect(serialized);
    expect(inspected.manifest).toMatchObject({
      schemaVersion: 1,
      accountCount: 1,
      handCount: 0,
    });
    expect(await backup.listSnapshots()).toHaveLength(1);
  });

  it("creates a rollback snapshot and restores complete data atomically", async () => {
    const { game, backup } = repositories();
    const admin = await game.initialize();
    await game.createAccount("second");
    const serialized = await backup.exportLocalBackup();
    await game.renameAccount(admin.id, "changed");
    await game.createAccount("third");

    await backup.importLocalBackup(serialized, "full");

    expect((await game.listAccounts()).map((item) => item.name).sort()).toEqual(
      ["admin", "second"],
    );
    expect(
      (await backup.listSnapshots()).some(
        (snapshot) => snapshot.reason === "before-import",
      ),
    ).toBe(true);
  });

  it("restores settings without replacing accounts or records", async () => {
    const { game, backup } = repositories();
    const admin = await game.initialize();
    await game.saveSettings(admin.id, { volume: 72 });
    const serialized = await backup.exportLocalBackup();
    await game.saveSettings(admin.id, { volume: 12 });
    const laterAccount = await game.createAccount("keep-me");
    await game.saveSettings(laterAccount.id, { volume: 33 });

    await backup.importLocalBackup(serialized, "settings");

    expect((await game.loadSettings(admin.id)).volume).toBe(72);
    expect((await game.loadSettings(laterAccount.id)).volume).toBe(33);
    expect((await game.listAccounts()).map((item) => item.name)).toContain(
      "keep-me",
    );
  });

  it("restores records only for accounts present in the backup", async () => {
    const { database, game, backup } = repositories();
    const admin = await game.initialize();
    const adminSession = createGameSession(
      admin.id,
      admin.name,
      admin.level,
      { aiCount: 1, buyIn: 1_000, smallBlind: 10, bigBlind: 20, maxHands: 20 },
      92,
    );
    await database.handRecords.add({
      id: "admin-hand",
      accountId: admin.id,
      sessionId: adminSession.id,
      handNumber: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      leftTable: false,
      playerLevel: 1,
      favorite: false,
      note: "",
      hand: adminSession.currentHand,
    });
    const serialized = await backup.exportLocalBackup();
    await database.handRecords.delete("admin-hand");

    const laterAccount = await game.createAccount("later-account");
    const laterSession = createGameSession(
      laterAccount.id,
      laterAccount.name,
      laterAccount.level,
      { aiCount: 1, buyIn: 1_000, smallBlind: 10, bigBlind: 20, maxHands: 20 },
      93,
    );
    await database.handRecords.add({
      id: "later-hand",
      accountId: laterAccount.id,
      sessionId: laterSession.id,
      handNumber: 0,
      createdAt: "2025-02-01T00:00:00.000Z",
      leftTable: false,
      playerLevel: 1,
      favorite: false,
      note: "",
      hand: laterSession.currentHand,
    });

    await backup.importLocalBackup(serialized, "records");

    expect(
      (await database.handRecords.toArray()).map((item) => item.id).sort(),
    ).toEqual(["admin-hand", "later-hand"]);
  });

  it("rejects a modified backup before changing local data", async () => {
    const { game, backup } = repositories();
    await game.initialize();
    const serialized = await backup.exportLocalBackup();
    const modified = serialized.replace('"bankroll":10000', '"bankroll":1');

    expect(() => backup.inspect(modified)).toThrow("备份校验失败");
    await expect(backup.importLocalBackup(modified, "full")).rejects.toThrow(
      "备份校验失败",
    );
    expect((await game.listAccounts())[0]?.bankroll).toBe(10_000);
  });

  it("cleans old archived data without touching an active cash game", async () => {
    const { database, game, backup } = repositories();
    const admin = await game.initialize();
    const cashGame = createGameSession(
      admin.id,
      admin.name,
      admin.level,
      { aiCount: 1, buyIn: 1_000, smallBlind: 10, bigBlind: 20, maxHands: 20 },
      91,
    );
    await game.beginSession(cashGame);
    await database.handRecords.add({
      id: "old-hand",
      accountId: admin.id,
      sessionId: cashGame.id,
      handNumber: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
      leftTable: false,
      playerLevel: 1,
      favorite: false,
      note: "",
      hand: cashGame.currentHand,
    });

    const result = await backup.cleanupAccountRecords(
      admin.id,
      "2026-01-01T00:00:00.000Z",
    );

    expect(result.handRecords).toBe(1);
    expect(await game.loadActiveSession(admin.id)).not.toBeNull();
    expect((await backup.listSnapshots())[0]?.reason).toBe("before-cleanup");
  });
});
