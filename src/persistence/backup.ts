import type { TrainingSession } from "@/domain/training";
import {
  PokerDatabase,
  pokerDatabase,
  type AccountRecord,
  type ActiveGameRecord,
  type BackupSnapshotRecord,
  type HandHistoryRecord,
  type LedgerRecord,
  type MetaRecord,
  type ProgressionRecord,
  type ReviewSimulationRecord,
} from "./database";

export const LOCAL_BACKUP_SCHEMA_VERSION = 1;
const SNAPSHOT_RETENTION_KEY = "storage:snapshotRetention";
const CURRENT_ACCOUNT_KEY = "currentAccountId";

export type BackupRestoreScope = "full" | "records" | "settings";

export interface LocalBackupPayload {
  kind: "holdup-local-backup";
  schemaVersion: number;
  exportedAt: string;
  checksum: string;
  data: {
    accounts: AccountRecord[];
    activeGames: ActiveGameRecord[];
    handRecords: HandHistoryRecord[];
    ledger: LedgerRecord[];
    progression: ProgressionRecord[];
    reviewSimulations: ReviewSimulationRecord[];
    trainingSessions: TrainingSession[];
    meta: MetaRecord[];
  };
}

export interface BackupManifest {
  schemaVersion: number;
  exportedAt: string;
  checksum: string;
  serializedSize: number;
  accountCount: number;
  activeGameCount: number;
  handCount: number;
  ledgerCount: number;
  progressionCount: number;
  trainingCount: number;
}

export interface StorageSummary {
  accountCount: number;
  activeGameCount: number;
  handCount: number;
  reviewCount: number;
  trainingCount: number;
  snapshotCount: number;
  approximateBytes: number;
}

export interface CleanupResult {
  handRecords: number;
  reviewSimulations: number;
  trainingSessions: number;
}

function timestamp(): string {
  return new Date().toISOString();
}

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function checksum(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function payloadBody(payload: Omit<LocalBackupPayload, "checksum">): string {
  return JSON.stringify(payload);
}

function isLocalBackup(value: unknown): value is LocalBackupPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LocalBackupPayload>;
  const data = candidate.data as
    Partial<LocalBackupPayload["data"]> | undefined;
  return (
    candidate.kind === "holdup-local-backup" &&
    candidate.schemaVersion === LOCAL_BACKUP_SCHEMA_VERSION &&
    typeof candidate.exportedAt === "string" &&
    typeof candidate.checksum === "string" &&
    Boolean(
      data &&
      Array.isArray(data.accounts) &&
      Array.isArray(data.activeGames) &&
      Array.isArray(data.handRecords) &&
      Array.isArray(data.ledger) &&
      Array.isArray(data.progression) &&
      Array.isArray(data.reviewSimulations) &&
      Array.isArray(data.trainingSessions) &&
      Array.isArray(data.meta),
    )
  );
}

function manifest(
  payload: LocalBackupPayload,
  serializedSize: number,
): BackupManifest {
  return {
    schemaVersion: payload.schemaVersion,
    exportedAt: payload.exportedAt,
    checksum: payload.checksum,
    serializedSize,
    accountCount: payload.data.accounts.length,
    activeGameCount: payload.data.activeGames.length,
    handCount: payload.data.handRecords.length,
    ledgerCount: payload.data.ledger.length,
    progressionCount: payload.data.progression.length,
    trainingCount: payload.data.trainingSessions.length,
  };
}

export class BackupRepository {
  constructor(readonly db: PokerDatabase = pokerDatabase) {}

  private dataTables() {
    return [
      this.db.accounts,
      this.db.activeGames,
      this.db.handRecords,
      this.db.ledger,
      this.db.progression,
      this.db.reviewSimulations,
      this.db.trainingSessions,
      this.db.meta,
    ] as const;
  }

  private async buildPayload(
    exportedAt = timestamp(),
  ): Promise<LocalBackupPayload> {
    const [
      accounts,
      activeGames,
      handRecords,
      ledger,
      progression,
      reviewSimulations,
      trainingSessions,
      meta,
    ] = await Promise.all([
      this.db.accounts.toArray(),
      this.db.activeGames.toArray(),
      this.db.handRecords.toArray(),
      this.db.ledger.toArray(),
      this.db.progression.toArray(),
      this.db.reviewSimulations.toArray(),
      this.db.trainingSessions.toArray(),
      this.db.meta.toArray(),
    ]);
    const withoutChecksum: Omit<LocalBackupPayload, "checksum"> = {
      kind: "holdup-local-backup",
      schemaVersion: LOCAL_BACKUP_SCHEMA_VERSION,
      exportedAt,
      data: {
        accounts,
        activeGames,
        handRecords,
        ledger,
        progression,
        reviewSimulations,
        trainingSessions,
        meta,
      },
    };
    return {
      ...withoutChecksum,
      checksum: checksum(payloadBody(withoutChecksum)),
    };
  }

  inspect(serialized: string): {
    payload: LocalBackupPayload;
    manifest: BackupManifest;
  } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      throw new Error("备份文件不是有效的 JSON");
    }
    if (!isLocalBackup(parsed)) throw new Error("备份文件版本或结构不受支持");
    const { checksum: savedChecksum, ...withoutChecksum } = parsed;
    if (checksum(payloadBody(withoutChecksum)) !== savedChecksum)
      throw new Error("备份校验失败，文件可能已损坏或被修改");
    return {
      payload: cloneSerializable(parsed),
      manifest: manifest(parsed, new Blob([serialized]).size),
    };
  }

  async getSnapshotRetention(): Promise<1 | 3 | 5> {
    const saved = Number(
      (await this.db.meta.get(SNAPSHOT_RETENTION_KEY))?.value,
    );
    return saved === 1 || saved === 5 ? saved : 3;
  }

  async setSnapshotRetention(value: 1 | 3 | 5): Promise<void> {
    await this.db.meta.put({
      key: SNAPSHOT_RETENTION_KEY,
      value: String(value),
    });
    await this.trimSnapshots(value);
  }

  async createSnapshot(
    reason: BackupSnapshotRecord["reason"] = "manual",
  ): Promise<BackupSnapshotRecord> {
    const payload = await this.buildPayload();
    const serialized = JSON.stringify(payload);
    const record: BackupSnapshotRecord = {
      id: crypto.randomUUID(),
      reason,
      schemaVersion: payload.schemaVersion,
      createdAt: payload.exportedAt,
      accountCount: payload.data.accounts.length,
      handCount: payload.data.handRecords.length,
      activeGameCount: payload.data.activeGames.length,
      checksum: payload.checksum,
      serializedSize: new Blob([serialized]).size,
      payload: serialized,
    };
    await this.db.backupSnapshots.add(record);
    await this.trimSnapshots(await this.getSnapshotRetention());
    return cloneSerializable(record);
  }

  async exportLocalBackup(): Promise<string> {
    return (await this.createSnapshot("before-export")).payload;
  }

  async listSnapshots(): Promise<BackupSnapshotRecord[]> {
    return this.db.backupSnapshots.orderBy("createdAt").reverse().toArray();
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    if (!(await this.db.backupSnapshots.get(snapshotId)))
      throw new Error("本地快照不存在");
    await this.db.backupSnapshots.delete(snapshotId);
  }

  async restoreSnapshot(
    snapshotId: string,
    scope: BackupRestoreScope,
  ): Promise<void> {
    const snapshot = await this.db.backupSnapshots.get(snapshotId);
    if (!snapshot) throw new Error("本地快照不存在");
    await this.restoreSerialized(snapshot.payload, scope, false);
  }

  async importLocalBackup(
    serialized: string,
    scope: BackupRestoreScope,
  ): Promise<void> {
    await this.restoreSerialized(serialized, scope, true);
  }

  private async restoreSerialized(
    serialized: string,
    scope: BackupRestoreScope,
    createRollbackSnapshot: boolean,
  ): Promise<void> {
    const { payload } = this.inspect(serialized);
    if (createRollbackSnapshot) await this.createSnapshot("before-import");
    const tables = this.dataTables();
    await this.db.transaction("rw", [...tables], async () => {
      if (scope === "full") {
        for (const table of tables) await table.clear();
        await this.db.accounts.bulkAdd(payload.data.accounts);
        await this.db.activeGames.bulkAdd(payload.data.activeGames);
        await this.db.handRecords.bulkAdd(payload.data.handRecords);
        await this.db.ledger.bulkAdd(payload.data.ledger);
        await this.db.progression.bulkAdd(payload.data.progression);
        await this.db.reviewSimulations.bulkAdd(payload.data.reviewSimulations);
        await this.db.trainingSessions.bulkAdd(payload.data.trainingSessions);
        await this.db.meta.bulkAdd(payload.data.meta);
        const currentId = payload.data.meta.find(
          (item) => item.key === CURRENT_ACCOUNT_KEY,
        )?.value;
        if (
          !currentId ||
          !payload.data.accounts.some((item) => item.id === currentId)
        )
          throw new Error("完整备份缺少有效的当前账号");
        return;
      }

      const existingAccountIds = new Set(
        (await this.db.accounts.toArray()).map((item) => item.id),
      );
      const requiredAccountIds = new Set(
        payload.data.accounts.map((item) => item.id),
      );
      if (
        [...requiredAccountIds].some(
          (accountId) => !existingAccountIds.has(accountId),
        )
      )
        throw new Error("部分恢复要求本机存在备份中的同一账号");

      if (scope === "records") {
        await this.db.handRecords
          .where("accountId")
          .anyOf([...requiredAccountIds])
          .delete();
        await this.db.reviewSimulations
          .where("accountId")
          .anyOf([...requiredAccountIds])
          .delete();
        await this.db.handRecords.bulkAdd(payload.data.handRecords);
        await this.db.reviewSimulations.bulkAdd(payload.data.reviewSimulations);
      } else {
        const settings = payload.data.meta.filter((item) =>
          item.key.startsWith("settings:"),
        );
        await this.db.meta.bulkDelete(
          [...requiredAccountIds].map((accountId) => `settings:${accountId}`),
        );
        await this.db.meta.bulkPut(settings);
      }
    });
  }

  async getStorageSummary(): Promise<StorageSummary> {
    const [
      accounts,
      activeGames,
      handRecords,
      ledger,
      progression,
      reviewSimulations,
      trainingSessions,
      snapshots,
      meta,
    ] = await Promise.all([
      this.db.accounts.toArray(),
      this.db.activeGames.toArray(),
      this.db.handRecords.toArray(),
      this.db.ledger.toArray(),
      this.db.progression.toArray(),
      this.db.reviewSimulations.toArray(),
      this.db.trainingSessions.toArray(),
      this.db.backupSnapshots.toArray(),
      this.db.meta.toArray(),
    ]);
    return {
      accountCount: accounts.length,
      activeGameCount: activeGames.length,
      handCount: handRecords.length,
      reviewCount: reviewSimulations.length,
      trainingCount: trainingSessions.length,
      snapshotCount: snapshots.length,
      approximateBytes: new Blob([
        JSON.stringify({
          accounts,
          activeGames,
          handRecords,
          ledger,
          progression,
          reviewSimulations,
          trainingSessions,
          snapshots,
          meta,
        }),
      ]).size,
    };
  }

  async cleanupAccountRecords(
    accountId: string,
    before: string,
  ): Promise<CleanupResult> {
    if (!(await this.db.accounts.get(accountId))) throw new Error("账号不存在");
    await this.createSnapshot("before-cleanup");
    return this.db.transaction(
      "rw",
      this.db.handRecords,
      this.db.reviewSimulations,
      this.db.trainingSessions,
      async () => {
        const handRecords = await this.db.handRecords
          .where("accountId")
          .equals(accountId)
          .filter((item) => item.createdAt < before)
          .toArray();
        const handIds = new Set(handRecords.map((item) => item.id));
        const reviews = await this.db.reviewSimulations
          .where("accountId")
          .equals(accountId)
          .filter(
            (item) => item.createdAt < before || handIds.has(item.handRecordId),
          )
          .toArray();
        const training = await this.db.trainingSessions
          .where("accountId")
          .equals(accountId)
          .filter(
            (item) => item.status === "complete" && item.updatedAt < before,
          )
          .toArray();
        await this.db.handRecords.bulkDelete(
          handRecords.map((item) => item.id),
        );
        await this.db.reviewSimulations.bulkDelete(
          reviews.map((item) => item.id),
        );
        await this.db.trainingSessions.bulkDelete(
          training.map((item) => item.id),
        );
        return {
          handRecords: handRecords.length,
          reviewSimulations: reviews.length,
          trainingSessions: training.length,
        };
      },
    );
  }

  async previewCleanupAccountRecords(
    accountId: string,
    before: string,
  ): Promise<CleanupResult> {
    if (!(await this.db.accounts.get(accountId))) throw new Error("账号不存在");
    const handRecords = await this.db.handRecords
      .where("accountId")
      .equals(accountId)
      .filter((item) => item.createdAt < before)
      .toArray();
    const handIds = new Set(handRecords.map((item) => item.id));
    const [reviews, training] = await Promise.all([
      this.db.reviewSimulations
        .where("accountId")
        .equals(accountId)
        .filter(
          (item) => item.createdAt < before || handIds.has(item.handRecordId),
        )
        .toArray(),
      this.db.trainingSessions
        .where("accountId")
        .equals(accountId)
        .filter((item) => item.status === "complete" && item.updatedAt < before)
        .toArray(),
    ]);
    return {
      handRecords: handRecords.length,
      reviewSimulations: reviews.length,
      trainingSessions: training.length,
    };
  }

  private async trimSnapshots(retention: 1 | 3 | 5): Promise<void> {
    const snapshots = await this.listSnapshots();
    const expired = snapshots.slice(retention);
    if (expired.length)
      await this.db.backupSnapshots.bulkDelete(expired.map((item) => item.id));
  }
}

export const backupRepository = new BackupRepository();
