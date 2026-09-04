<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  Database,
  Download,
  FileClock,
  RefreshCcw,
  Save,
  Trash2,
  Upload,
} from "@lucide/vue";
import {
  backupRepository,
  type BackupManifest,
  type BackupRestoreScope,
  type CleanupResult,
  type StorageSummary,
} from "@/persistence/backup";
import type { BackupSnapshotRecord } from "@/persistence/database";
import { useAppStore } from "@/stores/app";

const store = useAppStore();
const snapshots = ref<BackupSnapshotRecord[]>([]);
const summary = ref<StorageSummary | null>(null);
const retention = ref<1 | 3 | 5>(3);
const restoreScope = ref<BackupRestoreScope>("full");
const importedFile = ref<{
  name: string;
  serialized: string;
  manifest: BackupManifest;
} | null>(null);
const cleanupAccountId = ref("");
const cleanupBefore = ref("");
const cleanupPreview = ref<CleanupResult | null>(null);
const busy = ref(false);
const quotaUsage = ref<number | null>(null);
const backupInput = useTemplateRef<{ click: () => void }>("backupInput");

const approximateStorage = computed(() => {
  const bytes = summary.value?.approximateBytes ?? 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
});
const quotaWarning = computed(
  () => quotaUsage.value !== null && quotaUsage.value >= 0.8,
);
const quotaLabel = computed(() =>
  quotaUsage.value === null
    ? "不可用"
    : `${Math.round(quotaUsage.value * 100)}%`,
);

function snapshotReason(reason: BackupSnapshotRecord["reason"]): string {
  if (reason === "before-export") return "导出前";
  if (reason === "before-import") return "导入前回滚点";
  if (reason === "before-cleanup") return "清理前";
  return "手动快照";
}

function restoreScopeLabel(scope: BackupRestoreScope): string {
  if (scope === "records") return "只恢复记录";
  if (scope === "settings") return "只恢复设置";
  return "完整恢复";
}

async function refresh(): Promise<void> {
  [snapshots.value, summary.value, retention.value] = await Promise.all([
    backupRepository.listSnapshots(),
    backupRepository.getStorageSummary(),
    backupRepository.getSnapshotRetention(),
  ]);
  if (
    !store.accounts.some((account) => account.id === cleanupAccountId.value)
  ) {
    cleanupAccountId.value = store.account?.id ?? store.accounts[0]?.id ?? "";
    cleanupPreview.value = null;
  }
  if (globalThis.navigator.storage?.estimate) {
    const estimate = await globalThis.navigator.storage.estimate();
    quotaUsage.value =
      typeof estimate.quota === "number" &&
      estimate.quota > 0 &&
      typeof estimate.usage === "number"
        ? estimate.usage / estimate.quota
        : null;
  }
}

async function createSnapshot(): Promise<void> {
  busy.value = true;
  try {
    await backupRepository.createSnapshot("manual");
    await refresh();
    ElMessage.success("本地快照已创建");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "快照创建失败");
  } finally {
    busy.value = false;
  }
}

async function exportBackup(): Promise<void> {
  busy.value = true;
  try {
    const serialized = await backupRepository.exportLocalBackup();
    const blob = new globalThis.Blob([serialized], {
      type: "application/json",
    });
    const url = globalThis.URL.createObjectURL(blob);
    const anchor = globalThis.document.createElement("a");
    anchor.href = url;
    anchor.download = `holdup-local-${Date.now()}.json`;
    anchor.click();
    globalThis.URL.revokeObjectURL(url);
    await refresh();
    ElMessage.success("完整本地备份已导出");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "备份导出失败");
  } finally {
    busy.value = false;
  }
}

function chooseBackupFile(): void {
  backupInput.value?.click();
}

async function inspectBackup(event: unknown): Promise<void> {
  const input = (
    event as {
      target: {
        files?: ArrayLike<{ name: string; text: () => Promise<string> }>;
        value: string;
      };
    }
  ).target;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const serialized = await file.text();
    const { manifest } = backupRepository.inspect(serialized);
    importedFile.value = { name: file.name, serialized, manifest };
  } catch (error) {
    importedFile.value = null;
    ElMessage.error(error instanceof Error ? error.message : "备份读取失败");
  }
}

async function importBackup(): Promise<void> {
  if (!importedFile.value) return;
  const scopeLabel = restoreScopeLabel(restoreScope.value);
  try {
    await ElMessageBox.confirm(
      `${scopeLabel}将按备份内容修改本机数据。系统会先创建回滚快照，失败时不会保留部分修改。`,
      "确认恢复备份",
      {
        confirmButtonText: scopeLabel,
        cancelButtonText: "取消",
        type: "warning",
      },
    );
    busy.value = true;
    await backupRepository.importLocalBackup(
      importedFile.value.serialized,
      restoreScope.value,
    );
    await store.reloadLocalState();
    importedFile.value = null;
    await refresh();
    ElMessage.success("本地备份已恢复");
  } catch (error) {
    if (error !== "cancel")
      ElMessage.error(error instanceof Error ? error.message : "备份恢复失败");
  } finally {
    busy.value = false;
  }
}

async function restoreSnapshot(snapshot: BackupSnapshotRecord): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `${restoreScopeLabel(restoreScope.value)}将使用 ${snapshot.createdAt} 的本地快照。`,
      "恢复本地快照",
      {
        confirmButtonText: "确认恢复",
        cancelButtonText: "取消",
        type: "warning",
      },
    );
    busy.value = true;
    await backupRepository.restoreSnapshot(snapshot.id, restoreScope.value);
    await store.reloadLocalState();
    await refresh();
    ElMessage.success("快照已恢复");
  } catch (error) {
    if (error !== "cancel")
      ElMessage.error(error instanceof Error ? error.message : "快照恢复失败");
  } finally {
    busy.value = false;
  }
}

async function deleteSnapshot(snapshot: BackupSnapshotRecord): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `删除 ${snapshot.createdAt} 的快照后将无法使用它回滚。`,
      "删除本地快照",
      { confirmButtonText: "删除", cancelButtonText: "取消", type: "warning" },
    );
    await backupRepository.deleteSnapshot(snapshot.id);
    await refresh();
    ElMessage.success("快照已删除");
  } catch (error) {
    if (error !== "cancel")
      ElMessage.error(error instanceof Error ? error.message : "快照删除失败");
  }
}

async function changeRetention(
  value: string | number | boolean | undefined,
): Promise<void> {
  if (value !== 1 && value !== 3 && value !== 5) return;
  await backupRepository.setSnapshotRetention(value);
  retention.value = value;
  await refresh();
  ElMessage.success("快照保留数量已更新");
}

async function previewCleanup(): Promise<void> {
  if (!cleanupAccountId.value || !cleanupBefore.value) return;
  cleanupPreview.value = await backupRepository.previewCleanupAccountRecords(
    cleanupAccountId.value,
    new Date(`${cleanupBefore.value}T00:00:00`).toISOString(),
  );
}

async function cleanupRecords(): Promise<void> {
  if (!cleanupAccountId.value || !cleanupPreview.value || !cleanupBefore.value)
    return;
  const preview = cleanupPreview.value;
  try {
    await ElMessageBox.confirm(
      `将删除 ${preview.handRecords} 条手牌、${preview.reviewSimulations} 条复盘模拟和 ${preview.trainingSessions} 条已完成训练。活动牌局和未完成训练不会删除。`,
      "确认清理本地记录",
      {
        confirmButtonText: "确认清理",
        cancelButtonText: "取消",
        type: "warning",
      },
    );
    busy.value = true;
    await backupRepository.cleanupAccountRecords(
      cleanupAccountId.value,
      new Date(`${cleanupBefore.value}T00:00:00`).toISOString(),
    );
    cleanupPreview.value = null;
    await refresh();
    ElMessage.success("本地记录已清理，操作前快照已保留");
  } catch (error) {
    if (error !== "cancel")
      ElMessage.error(error instanceof Error ? error.message : "记录清理失败");
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  cleanupAccountId.value = store.account?.id ?? "";
  void refresh();
});
</script>

<template>
  <div class="storage-page">
    <header class="storage-header">
      <div class="storage-header__copy">
        <span class="storage-header__eyebrow">本机数据</span>
        <h1 class="storage-header__title">备份与存储管理</h1>
      </div>
      <span class="storage-header__status">数据版本 1</span>
    </header>

    <section class="storage-summary" aria-label="存储概览">
      <div class="storage-summary__metric">
        <Database class="storage-summary__icon" :size="18" aria-hidden="true" />
        <span class="storage-summary__label">估算占用</span>
        <strong class="storage-summary__value">{{ approximateStorage }}</strong>
      </div>
      <div class="storage-summary__metric">
        <span class="storage-summary__label">账号</span>
        <strong class="storage-summary__value">{{
          summary?.accountCount ?? 0
        }}</strong>
      </div>
      <div class="storage-summary__metric">
        <span class="storage-summary__label">活动牌局</span>
        <strong class="storage-summary__value">{{
          summary?.activeGameCount ?? 0
        }}</strong>
      </div>
      <div class="storage-summary__metric">
        <span class="storage-summary__label">手牌记录</span>
        <strong class="storage-summary__value">{{
          summary?.handCount ?? 0
        }}</strong>
      </div>
      <div class="storage-summary__metric">
        <span class="storage-summary__label">训练记录</span>
        <strong class="storage-summary__value">{{
          summary?.trainingCount ?? 0
        }}</strong>
      </div>
      <div class="storage-summary__metric">
        <span class="storage-summary__label">浏览器配额</span>
        <strong class="storage-summary__value">{{ quotaLabel }}</strong>
      </div>
    </section>
    <el-alert
      v-if="quotaWarning"
      class="storage-quota-warning"
      title="浏览器存储空间使用率已超过 80%，建议先导出备份并清理旧记录。"
      type="warning"
      show-icon
      :closable="false"
    />
    <el-alert
      v-if="store.storageLocked"
      class="storage-readonly-warning"
      title="存储写入失败后已进入只读保护。重新载入最后成功保存的现场后才能继续牌局。"
      type="error"
      show-icon
      :closable="false"
    >
      <template #default>
        <el-button
          class="storage-readonly-warning__reload"
          size="small"
          @click="store.reloadLocalState"
        >
          重新载入现场
        </el-button>
      </template>
    </el-alert>

    <section class="storage-section" aria-labelledby="storage-backup-title">
      <header class="storage-section__header">
        <div class="storage-section__heading">
          <h2 id="storage-backup-title" class="storage-section__title">
            完整本地备份
          </h2>
          <span class="storage-section__description"
            >恢复型 JSON，包含账号、牌局、记录、设置和训练数据</span
          >
        </div>
        <div class="storage-section__commands">
          <el-button
            class="storage-section__button"
            :icon="Save"
            :loading="busy"
            @click="createSnapshot"
            >创建快照</el-button
          >
          <el-button
            class="storage-section__button"
            type="primary"
            :icon="Download"
            :loading="busy"
            @click="exportBackup"
            >导出 JSON</el-button
          >
        </div>
      </header>

      <div class="storage-import">
        <input
          ref="backupInput"
          class="storage-import__input"
          type="file"
          accept="application/json,.json"
          @change="inspectBackup"
        />
        <div class="storage-import__controls">
          <el-button
            class="storage-import__select"
            :icon="Upload"
            @click="chooseBackupFile"
            >选择备份文件</el-button
          >
          <el-segmented
            v-model="restoreScope"
            class="storage-import__scope"
            :options="[
              { label: '完整恢复', value: 'full' },
              { label: '只恢复记录', value: 'records' },
              { label: '只恢复设置', value: 'settings' },
            ]"
          />
        </div>
        <div v-if="importedFile" class="storage-import__manifest">
          <FileClock
            class="storage-import__manifest-icon"
            :size="18"
            aria-hidden="true"
          />
          <div class="storage-import__manifest-copy">
            <strong class="storage-import__manifest-name">{{
              importedFile.name
            }}</strong>
            <span class="storage-import__manifest-meta">
              {{ importedFile.manifest.exportedAt }} ·
              {{ importedFile.manifest.accountCount }} 个账号 ·
              {{ importedFile.manifest.handCount }} 手牌 ·
              {{ importedFile.manifest.activeGameCount }} 个活动牌局
            </span>
          </div>
          <el-button
            class="storage-import__restore"
            type="warning"
            :icon="RefreshCcw"
            :loading="busy"
            @click="importBackup"
            >执行恢复</el-button
          >
        </div>
      </div>
    </section>

    <section class="storage-section" aria-labelledby="storage-snapshot-title">
      <header class="storage-section__header">
        <div class="storage-section__heading">
          <h2 id="storage-snapshot-title" class="storage-section__title">
            本地回滚快照
          </h2>
          <span class="storage-section__description"
            >导出、导入和清理前自动保留</span
          >
        </div>
        <label class="storage-retention">
          <span class="storage-retention__label">保留数量</span>
          <el-segmented
            v-model="retention"
            class="storage-retention__control"
            :options="[1, 3, 5]"
            @change="changeRetention"
          />
        </label>
      </header>
      <div v-if="!snapshots.length" class="storage-empty">暂无本地快照</div>
      <div v-else class="storage-snapshots">
        <div
          v-for="snapshot in snapshots"
          :key="snapshot.id"
          class="storage-snapshot"
        >
          <div class="storage-snapshot__copy">
            <strong class="storage-snapshot__title">{{
              snapshotReason(snapshot.reason)
            }}</strong>
            <span class="storage-snapshot__meta"
              >{{ snapshot.createdAt }} · {{ snapshot.accountCount }} 个账号 ·
              {{ snapshot.handCount }} 手牌</span
            >
          </div>
          <div class="storage-snapshot__commands">
            <el-button
              class="storage-snapshot__restore"
              size="small"
              :icon="RefreshCcw"
              :disabled="busy"
              @click="restoreSnapshot(snapshot)"
              >恢复</el-button
            >
            <el-button
              class="storage-snapshot__delete"
              size="small"
              text
              type="danger"
              :icon="Trash2"
              :disabled="busy"
              @click="deleteSnapshot(snapshot)"
              >删除</el-button
            >
          </div>
        </div>
      </div>
    </section>

    <section class="storage-section" aria-labelledby="storage-cleanup-title">
      <header class="storage-section__header">
        <div class="storage-section__heading">
          <h2 id="storage-cleanup-title" class="storage-section__title">
            清理账号记录
          </h2>
          <span class="storage-section__description"
            >不会删除活动牌局、未完成训练、账号、筹码、经验或最近快照</span
          >
        </div>
      </header>
      <div class="storage-cleanup">
        <el-select
          v-model="cleanupAccountId"
          class="storage-cleanup__account"
          placeholder="选择账号"
          @change="cleanupPreview = null"
        >
          <el-option
            v-for="account in store.accounts"
            :key="account.id"
            class="storage-cleanup__account-option"
            :label="account.name"
            :value="account.id"
          />
        </el-select>
        <el-date-picker
          v-model="cleanupBefore"
          class="storage-cleanup__date"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="删除此日期之前"
          @change="cleanupPreview = null"
        />
        <el-button
          class="storage-cleanup__preview"
          :disabled="busy || !cleanupAccountId || !cleanupBefore"
          @click="previewCleanup"
          >查看影响范围</el-button
        >
        <span v-if="cleanupPreview" class="storage-cleanup__impact">
          {{ cleanupPreview.handRecords }} 手牌 ·
          {{ cleanupPreview.reviewSimulations }} 复盘模拟 ·
          {{ cleanupPreview.trainingSessions }} 已完成训练
        </span>
        <el-button
          v-if="cleanupPreview"
          class="storage-cleanup__submit"
          type="danger"
          :icon="Trash2"
          :disabled="busy"
          @click="cleanupRecords"
          >确认清理</el-button
        >
      </div>
      <p class="storage-cleanup__cache-note">
        牌局统计由历史记录实时计算，当前没有独立统计缓存需要清理。
      </p>
    </section>
  </div>
</template>
