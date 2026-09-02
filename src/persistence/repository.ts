import {
  calculateSessionExperience,
  applyExperience,
  BAILOUT_AMOUNT,
  downgradeLevel,
  INITIAL_BANKROLL,
  MINIMUM_BUY_IN,
} from "@/domain/progression";
import { getHumanPlayer } from "@/domain/engine";
import type { AccountProfile, GameSession } from "@/domain/types";
import {
  PokerDatabase,
  pokerDatabase,
  type AccountRecord,
  type ActiveGameRecord,
  type HandHistoryRecord,
  type LedgerEntryType,
  type ProgressionRecord,
} from "./database";
import type { HandState } from "@/domain/types";

const CURRENT_ACCOUNT_KEY = "currentAccountId";
export const ACCOUNT_BACKUP_SCHEMA_VERSION = 1;

export interface AccountBackup {
  kind: "holdup-account-backup";
  schemaVersion: number;
  exportedAt: string;
  account: AccountProfile;
  activeSession: GameSession | null;
  handRecords: HandHistoryRecord[];
  ledger: import("./database").LedgerRecord[];
  progression: ProgressionRecord[];
}

function timestamp(): string {
  return new Date().toISOString();
}

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase("zh-CN");
}

function publicAccount(record: AccountRecord): AccountProfile {
  return {
    id: record.id,
    name: record.name,
    level: record.level,
    currentLevelXp: record.currentLevelXp,
    lifetimeXp: record.lifetimeXp,
    highestLevel: record.highestLevel,
    bankroll: record.bankroll,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function createAccountRecord(name: string): AccountRecord {
  const createdAt = timestamp();
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    nameKey: normalizeName(name),
    level: 1,
    currentLevelXp: 0,
    lifetimeXp: 0,
    highestLevel: 1,
    bankroll: INITIAL_BANKROLL,
    createdAt,
    updatedAt: createdAt,
  };
}

function isAccountBackup(value: unknown): value is AccountBackup {
  if (!value || typeof value !== "object") return false;
  const backup = value as Partial<AccountBackup>;
  const account = backup.account as Partial<AccountProfile> | undefined;
  return (
    backup.kind === "holdup-account-backup" &&
    backup.schemaVersion === ACCOUNT_BACKUP_SCHEMA_VERSION &&
    Boolean(account?.name && account.id) &&
    Number.isInteger(account?.level) &&
    typeof account?.bankroll === "number" &&
    Array.isArray(backup.handRecords) &&
    Array.isArray(backup.ledger) &&
    Array.isArray(backup.progression) &&
    (backup.activeSession === null || typeof backup.activeSession === "object")
  );
}

function remapHand(hand: HandState, accountName: string): HandState {
  const copied = cloneSerializable(hand);
  copied.players = copied.players.map((player) =>
    player.isHuman ? { ...player, name: accountName } : player,
  );
  return copied;
}

function remapSession(
  session: GameSession,
  account: AccountRecord,
): GameSession {
  const copied = cloneSerializable(session);
  copied.accountId = account.id;
  copied.accountName = account.name;
  copied.playerLevel = account.level;
  copied.currentHand = remapHand(copied.currentHand, account.name);
  copied.roster = copied.roster.map((player) =>
    player.isHuman ? { ...player, name: account.name } : player,
  );
  copied.revision = 0;
  copied.updatedAt = timestamp();
  return copied;
}

function activeRecord(
  session: GameSession,
  revision: number,
): ActiveGameRecord {
  const savedSession = cloneSerializable(session);
  savedSession.revision = revision;
  savedSession.updatedAt = timestamp();
  return {
    accountId: session.accountId,
    sessionId: session.id,
    revision,
    session: savedSession,
    updatedAt: savedSession.updatedAt,
  };
}

function handRecord(
  session: GameSession,
  leftTable = false,
): HandHistoryRecord {
  return {
    id: `${session.id}:${session.currentHand.id}`,
    accountId: session.accountId,
    sessionId: session.id,
    handNumber: session.currentHand.number,
    createdAt: session.currentHand.completedAt ?? timestamp(),
    leftTable,
    hand: cloneSerializable(session.currentHand),
  };
}

export class StaleGameError extends Error {
  constructor() {
    super("牌局已在其他页面推进，请重新载入最新现场");
    this.name = "StaleGameError";
  }
}

export class GameRepository {
  constructor(readonly db: PokerDatabase = pokerDatabase) {}

  async initialize(): Promise<AccountProfile> {
    return this.db.transaction(
      "rw",
      this.db.accounts,
      this.db.meta,
      async () => {
        const accounts = await this.db.accounts.toArray();
        if (!accounts.length) {
          const admin = createAccountRecord("admin");
          await this.db.accounts.add(admin);
          await this.db.meta.put({ key: CURRENT_ACCOUNT_KEY, value: admin.id });
          return publicAccount(admin);
        }

        const currentId = (await this.db.meta.get(CURRENT_ACCOUNT_KEY))?.value;
        const current =
          accounts.find((account) => account.id === currentId) ?? accounts[0]!;
        if (current.id !== currentId)
          await this.db.meta.put({
            key: CURRENT_ACCOUNT_KEY,
            value: current.id,
          });
        return publicAccount(current);
      },
    );
  }

  async listAccounts(): Promise<AccountProfile[]> {
    const accounts = await this.db.accounts
      .orderBy("updatedAt")
      .reverse()
      .toArray();
    return accounts.map(publicAccount);
  }

  async getAccount(accountId: string): Promise<AccountProfile> {
    const account = await this.db.accounts.get(accountId);
    if (!account) throw new Error("账号不存在");
    return publicAccount(account);
  }

  async getCurrentAccount(): Promise<AccountProfile> {
    const currentId = (await this.db.meta.get(CURRENT_ACCOUNT_KEY))?.value;
    if (!currentId) return this.initialize();
    return this.getAccount(currentId);
  }

  async createAccount(name: string): Promise<AccountProfile> {
    if (!name.trim()) throw new Error("账号名称不能为空");
    const record = createAccountRecord(name);
    await this.db.transaction(
      "rw",
      this.db.accounts,
      this.db.meta,
      async () => {
        if (
          await this.db.accounts.where("nameKey").equals(record.nameKey).first()
        )
          throw new Error("账号名称已存在");
        await this.db.accounts.add(record);
        await this.db.meta.put({ key: CURRENT_ACCOUNT_KEY, value: record.id });
      },
    );
    return publicAccount(record);
  }

  async switchAccount(accountId: string): Promise<AccountProfile> {
    const account = await this.getAccount(accountId);
    await this.db.meta.put({ key: CURRENT_ACCOUNT_KEY, value: account.id });
    return account;
  }

  async renameAccount(
    accountId: string,
    name: string,
  ): Promise<AccountProfile> {
    const nameKey = normalizeName(name);
    if (!nameKey) throw new Error("账号名称不能为空");

    return this.db.transaction("rw", this.db.accounts, async () => {
      const existing = await this.db.accounts
        .where("nameKey")
        .equals(nameKey)
        .first();
      if (existing && existing.id !== accountId)
        throw new Error("账号名称已存在");
      const account = await this.db.accounts.get(accountId);
      if (!account) throw new Error("账号不存在");
      const updated = {
        ...account,
        name: name.trim(),
        nameKey,
        updatedAt: timestamp(),
      };
      await this.db.accounts.put(updated);
      return publicAccount(updated);
    });
  }

  async downgradeAccount(
    accountId: string,
    targetLevel: number,
  ): Promise<AccountProfile> {
    return this.db.transaction(
      "rw",
      this.db.accounts,
      this.db.progression,
      async () => {
        const account = await this.db.accounts.get(accountId);
        if (!account) throw new Error("账号不存在");
        const downgraded = downgradeLevel(publicAccount(account), targetLevel);
        const updated: AccountRecord = {
          ...account,
          ...downgraded,
          nameKey: account.nameKey,
        };
        await this.db.accounts.put(updated);
        await this.db.progression.add({
          id: crypto.randomUUID(),
          accountId,
          type: "downgrade",
          experience: -account.currentLevelXp,
          levelBefore: account.level,
          levelAfter: targetLevel,
          createdAt: updated.updatedAt,
        });
        return publicAccount(updated);
      },
    );
  }

  async deleteAccount(accountId: string): Promise<AccountProfile> {
    return this.db.transaction(
      "rw",
      [
        this.db.accounts,
        this.db.activeGames,
        this.db.handRecords,
        this.db.ledger,
        this.db.progression,
        this.db.meta,
      ],
      async () => {
        const currentId = (await this.db.meta.get(CURRENT_ACCOUNT_KEY))?.value;
        if (accountId === currentId)
          throw new Error("当前账号不可删除，请先切换账号");
        await this.db.activeGames.delete(accountId);
        await this.db.handRecords.where("accountId").equals(accountId).delete();
        await this.db.ledger.where("accountId").equals(accountId).delete();
        await this.db.progression.where("accountId").equals(accountId).delete();
        await this.db.accounts.delete(accountId);

        const remaining = await this.db.accounts.toArray();
        const next =
          remaining.find((account) => account.id === currentId) ??
          remaining[0] ??
          createAccountRecord("admin");
        if (!remaining.length) await this.db.accounts.add(next);
        await this.db.meta.put({ key: CURRENT_ACCOUNT_KEY, value: next.id });
        return publicAccount(next);
      },
    );
  }

  async loadActiveSession(accountId: string): Promise<GameSession | null> {
    const record = await this.db.activeGames.get(accountId);
    return record ? cloneSerializable(record.session) : null;
  }

  async beginSession(
    session: GameSession,
  ): Promise<{ account: AccountProfile; session: GameSession }> {
    return this.db.transaction(
      "rw",
      this.db.accounts,
      this.db.activeGames,
      this.db.ledger,
      this.db.progression,
      async () => {
        if (await this.db.activeGames.get(session.accountId))
          throw new Error("存在未结束牌局，请先恢复现场");
        let account = await this.db.accounts.get(session.accountId);
        if (!account) throw new Error("账号不存在");

        if (account.bankroll < MINIMUM_BUY_IN) {
          account = await this.updateBalance(
            account,
            BAILOUT_AMOUNT - account.bankroll,
            "bailout",
          );
        }
        if (session.config.buyIn > account.bankroll)
          throw new Error("可用筹码不足以完成买入");

        account = await this.updateBalance(
          account,
          -session.config.buyIn,
          "buy-in",
          session.id,
        );
        const record = activeRecord(session, 1);
        await this.db.activeGames.add(record);
        return {
          account: publicAccount(account),
          session: cloneSerializable(record.session),
        };
      },
    );
  }

  async commitSession(session: GameSession): Promise<GameSession> {
    return this.db.transaction("rw", this.db.activeGames, async () => {
      const current = await this.db.activeGames.get(session.accountId);
      this.assertCurrent(current, session);
      const record = activeRecord(session, current.revision + 1);
      await this.db.activeGames.put(record);
      return cloneSerializable(record.session);
    });
  }

  async commitNextHand(
    previous: GameSession,
    next: GameSession,
  ): Promise<GameSession> {
    return this.db.transaction(
      "rw",
      this.db.activeGames,
      this.db.handRecords,
      async () => {
        const current = await this.db.activeGames.get(previous.accountId);
        this.assertCurrent(current, previous);
        await this.db.handRecords.put(handRecord(previous));
        const record = activeRecord(next, current.revision + 1);
        await this.db.activeGames.put(record);
        return cloneSerializable(record.session);
      },
    );
  }

  async finishSession(session: GameSession): Promise<AccountProfile> {
    return this.db.transaction(
      "rw",
      this.db.accounts,
      this.db.activeGames,
      this.db.handRecords,
      this.db.ledger,
      this.db.progression,
      async () => {
        const current = await this.db.activeGames.get(session.accountId);
        this.assertCurrent(current, session);
        let account = await this.db.accounts.get(session.accountId);
        if (!account) throw new Error("账号不存在");
        const human = getHumanPlayer(session);
        account = await this.updateBalance(
          account,
          human.stack,
          "table-refund",
          session.id,
        );

        const netProfit = human.stack - session.config.buyIn;
        const gained = calculateSessionExperience(
          netProfit,
          session.completedHands,
        );
        const experience = applyExperience(publicAccount(account), gained);
        account = {
          ...account,
          level: experience.levelAfter,
          currentLevelXp: experience.currentLevelXp,
          lifetimeXp: experience.lifetimeXp,
          highestLevel: Math.max(account.highestLevel, experience.levelAfter),
          updatedAt: timestamp(),
        };
        await this.db.accounts.put(account);
        await this.db.progression.add({
          id: crypto.randomUUID(),
          accountId: account.id,
          sessionId: session.id,
          type: "experience",
          experience: experience.gained,
          levelBefore: experience.levelBefore,
          levelAfter: experience.levelAfter,
          createdAt: account.updatedAt,
        });
        await this.db.handRecords.put(handRecord(session));
        await this.db.activeGames.delete(session.accountId);
        return publicAccount(account);
      },
    );
  }

  async replaceAfterLeave(
    abandoned: GameSession,
    replacement: GameSession,
  ): Promise<{
    account: AccountProfile;
    session: GameSession;
  }> {
    return this.db.transaction(
      "rw",
      this.db.accounts,
      this.db.activeGames,
      this.db.handRecords,
      this.db.ledger,
      async () => {
        const current = await this.db.activeGames.get(abandoned.accountId);
        this.assertCurrent(current, abandoned);
        let account = await this.db.accounts.get(abandoned.accountId);
        if (!account) throw new Error("账号不存在");

        const human = getHumanPlayer(abandoned);
        account = await this.updateBalance(
          account,
          human.stack,
          "table-refund",
          abandoned.id,
        );
        if (account.bankroll < MINIMUM_BUY_IN) {
          account = await this.updateBalance(
            account,
            BAILOUT_AMOUNT - account.bankroll,
            "bailout",
          );
        }
        if (replacement.config.buyIn > account.bankroll)
          throw new Error("剩余筹码不足以重新买入");
        account = await this.updateBalance(
          account,
          -replacement.config.buyIn,
          "buy-in",
          replacement.id,
        );

        await this.db.handRecords.put(handRecord(abandoned, true));
        const record = activeRecord(replacement, 1);
        await this.db.activeGames.put(record);
        return {
          account: publicAccount(account),
          session: cloneSerializable(record.session),
        };
      },
    );
  }

  async closeAfterLeave(abandoned: GameSession): Promise<AccountProfile> {
    return this.db.transaction(
      "rw",
      this.db.accounts,
      this.db.activeGames,
      this.db.handRecords,
      this.db.ledger,
      async () => {
        const current = await this.db.activeGames.get(abandoned.accountId);
        this.assertCurrent(current, abandoned);
        let account = await this.db.accounts.get(abandoned.accountId);
        if (!account) throw new Error("账号不存在");
        account = await this.updateBalance(
          account,
          getHumanPlayer(abandoned).stack,
          "table-refund",
          abandoned.id,
        );
        await this.db.handRecords.put(handRecord(abandoned, true));
        await this.db.activeGames.delete(abandoned.accountId);
        return publicAccount(account);
      },
    );
  }

  async listHandRecords(accountId: string): Promise<HandHistoryRecord[]> {
    return this.db.handRecords
      .where("accountId")
      .equals(accountId)
      .reverse()
      .sortBy("createdAt");
  }

  async exportAccount(accountId: string): Promise<string> {
    const account = await this.getAccount(accountId);
    const [activeSession, handRecords, ledger, progression] = await Promise.all(
      [
        this.loadActiveSession(accountId),
        this.db.handRecords.where("accountId").equals(accountId).toArray(),
        this.db.ledger.where("accountId").equals(accountId).toArray(),
        this.db.progression.where("accountId").equals(accountId).toArray(),
      ],
    );
    const backup: AccountBackup = {
      kind: "holdup-account-backup",
      schemaVersion: ACCOUNT_BACKUP_SCHEMA_VERSION,
      exportedAt: timestamp(),
      account,
      activeSession,
      handRecords: cloneSerializable(handRecords),
      ledger: cloneSerializable(ledger),
      progression: cloneSerializable(progression),
    };
    return JSON.stringify(backup, null, 2);
  }

  async importAccountBackup(
    serialized: string,
    nameOverride?: string,
  ): Promise<AccountProfile> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      throw new Error("备份文件不是有效的 JSON");
    }
    if (!isAccountBackup(parsed)) throw new Error("备份文件版本或结构不受支持");

    const sourceName = nameOverride?.trim() || `${parsed.account.name}-导入`;
    const record = createAccountRecord(sourceName);
    const importedAccount: AccountRecord = {
      ...record,
      level: parsed.account.level,
      currentLevelXp: parsed.account.currentLevelXp,
      lifetimeXp: parsed.account.lifetimeXp,
      highestLevel: parsed.account.highestLevel,
      bankroll: parsed.account.bankroll,
      updatedAt: timestamp(),
    };

    await this.db.transaction(
      "rw",
      [
        this.db.accounts,
        this.db.activeGames,
        this.db.handRecords,
        this.db.ledger,
        this.db.progression,
        this.db.meta,
      ],
      async () => {
        if (
          await this.db.accounts
            .where("nameKey")
            .equals(importedAccount.nameKey)
            .first()
        )
          throw new Error("账号名称已存在");

        await this.db.accounts.add(importedAccount);
        const importedSession = parsed.activeSession
          ? remapSession(parsed.activeSession, importedAccount)
          : null;
        if (importedSession)
          await this.db.activeGames.add(activeRecord(importedSession, 1));

        for (const sourceRecord of parsed.handRecords) {
          const copied = cloneSerializable(sourceRecord);
          copied.id = `${importedAccount.id}:${crypto.randomUUID()}`;
          copied.accountId = importedAccount.id;
          copied.hand = remapHand(copied.hand, importedAccount.name);
          await this.db.handRecords.add(copied);
        }
        for (const sourceEntry of parsed.ledger) {
          await this.db.ledger.add({
            ...cloneSerializable(sourceEntry),
            id: crypto.randomUUID(),
            accountId: importedAccount.id,
          });
        }
        for (const sourceEntry of parsed.progression) {
          await this.db.progression.add({
            ...cloneSerializable(sourceEntry),
            id: crypto.randomUUID(),
            accountId: importedAccount.id,
          });
        }
        await this.db.meta.put({
          key: CURRENT_ACCOUNT_KEY,
          value: importedAccount.id,
        });
      },
    );
    return publicAccount(importedAccount);
  }

  async listProgression(accountId: string): Promise<ProgressionRecord[]> {
    return this.db.progression
      .where("accountId")
      .equals(accountId)
      .reverse()
      .sortBy("createdAt");
  }

  private assertCurrent(
    current: ActiveGameRecord | undefined,
    session: GameSession,
  ): asserts current is ActiveGameRecord {
    if (
      !current ||
      current.sessionId !== session.id ||
      current.revision !== session.revision
    )
      throw new StaleGameError();
  }

  private async updateBalance(
    account: AccountRecord,
    amount: number,
    type: LedgerEntryType,
    sessionId?: string,
  ): Promise<AccountRecord> {
    const updated: AccountRecord = {
      ...account,
      bankroll: account.bankroll + amount,
      updatedAt: timestamp(),
    };
    if (updated.bankroll < 0) throw new Error("筹码余额不能为负数");
    await this.db.accounts.put(updated);
    await this.db.ledger.add({
      id: crypto.randomUUID(),
      accountId: account.id,
      sessionId,
      type,
      amount,
      balanceAfter: updated.bankroll,
      createdAt: updated.updatedAt,
    });
    return updated;
  }
}

export const gameRepository = new GameRepository();
