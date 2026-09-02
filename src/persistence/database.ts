import Dexie, { type EntityTable } from "dexie";
import type { AccountProfile, GameSession, HandState } from "@/domain/types";

export interface AccountRecord extends AccountProfile {
  nameKey: string;
}

export interface ActiveGameRecord {
  accountId: string;
  sessionId: string;
  revision: number;
  session: GameSession;
  updatedAt: string;
}

export interface HandHistoryRecord {
  id: string;
  accountId: string;
  sessionId: string;
  handNumber: number;
  createdAt: string;
  leftTable: boolean;
  hand: HandState;
}

export type LedgerEntryType =
  "bailout" | "buy-in" | "table-refund" | "session-result";

export interface LedgerRecord {
  id: string;
  accountId: string;
  sessionId?: string;
  type: LedgerEntryType;
  amount: number;
  balanceAfter: number;
  createdAt: string;
}

export type ProgressionEntryType = "experience" | "downgrade";

export interface ProgressionRecord {
  id: string;
  accountId: string;
  sessionId?: string;
  type: ProgressionEntryType;
  experience: number;
  levelBefore: number;
  levelAfter: number;
  createdAt: string;
}

export interface MetaRecord {
  key: string;
  value: string;
}

export class PokerDatabase extends Dexie {
  accounts!: EntityTable<AccountRecord, "id">;
  activeGames!: EntityTable<ActiveGameRecord, "accountId">;
  handRecords!: EntityTable<HandHistoryRecord, "id">;
  ledger!: EntityTable<LedgerRecord, "id">;
  progression!: EntityTable<ProgressionRecord, "id">;
  meta!: EntityTable<MetaRecord, "key">;

  constructor(name = "holdup-poker") {
    super(name);
    this.version(1).stores({
      accounts: "id,&nameKey,updatedAt",
      activeGames: "accountId,sessionId,updatedAt",
      handRecords: "id,[accountId+createdAt],accountId,sessionId,handNumber",
      ledger: "id,[accountId+createdAt],accountId,sessionId,type",
      meta: "key",
    });
    this.version(2).stores({
      accounts: "id,&nameKey,updatedAt",
      activeGames: "accountId,sessionId,updatedAt",
      handRecords: "id,[accountId+createdAt],accountId,sessionId,handNumber",
      ledger: "id,[accountId+createdAt],accountId,sessionId,type",
      progression: "id,[accountId+createdAt],accountId,sessionId,type",
      meta: "key",
    });
  }
}

export const pokerDatabase = new PokerDatabase();
