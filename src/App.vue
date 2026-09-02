<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  CircleUserRound,
  Download,
  History,
  House,
  Plus,
  Save,
  Spade,
  Trash2,
  Upload,
} from "@lucide/vue";
import { useAppStore } from "@/stores/app";

const store = useAppStore();
const route = useRoute();
const router = useRouter();
const accountDialogVisible = ref(false);
const accountActionBusy = ref(false);
const newAccountName = ref("");
const backupInput = useTemplateRef<{ click: () => void }>("backupInput");

const saveLabel = computed(() => {
  if (store.saveState === "saving") return "正在保存";
  if (store.saveState === "error") return "保存失败";
  return "现场已保存";
});

onMounted(() => void store.initialize());

function openAccountDialog(): void {
  accountDialogVisible.value = true;
}

async function createAccount(): Promise<void> {
  if (!newAccountName.value.trim()) {
    ElMessage.warning("请输入账号名称");
    return;
  }
  accountActionBusy.value = true;
  try {
    await store.createAccount(newAccountName.value);
    newAccountName.value = "";
    ElMessage.success("账号已创建");
    if (route.name === "game") await router.push("/");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "账号创建失败");
  } finally {
    accountActionBusy.value = false;
  }
}

async function selectAccount(accountId: string): Promise<void> {
  if (accountId === store.account?.id) return;
  accountActionBusy.value = true;
  try {
    await store.switchAccount(accountId);
    accountDialogVisible.value = false;
    await router.push("/");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "账号切换失败");
  } finally {
    accountActionBusy.value = false;
  }
}

async function deleteAccount(accountId: string): Promise<void> {
  const target = store.accounts.find((item) => item.id === accountId);
  if (!target) return;
  if (accountId === store.account?.id) {
    ElMessage.info("当前账号不可删除，请先切换账号");
    return;
  }
  try {
    await ElMessageBox.confirm(
      `删除账号“${target.name}”将同时删除其等级、筹码、牌局记录和未完成牌局，操作不可恢复。`,
      "确认删除账号",
      {
        confirmButtonText: "确认删除",
        cancelButtonText: "取消",
        type: "warning",
      },
    );
    accountActionBusy.value = true;
    await store.deleteAccount(accountId);
    ElMessage.success("账号已删除");
    if (route.name === "game" && !store.session) await router.push("/");
  } catch (error) {
    if (error !== "cancel")
      ElMessage.error(error instanceof Error ? error.message : "账号删除失败");
  } finally {
    accountActionBusy.value = false;
  }
}

async function exportAccount(): Promise<void> {
  if (!store.account) return;
  try {
    const serialized = await store.exportCurrentAccount();
    const blob = new globalThis.Blob([serialized], {
      type: "application/json",
    });
    const url = globalThis.URL.createObjectURL(blob);
    const anchor = globalThis.document.createElement("a");
    anchor.href = url;
    anchor.download = `holdup-${store.account.name}-${Date.now()}.json`;
    anchor.click();
    globalThis.URL.revokeObjectURL(url);
    ElMessage.success("账号备份已导出");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "账号导出失败");
  }
}

function chooseBackupFile(): void {
  backupInput.value?.click();
}

async function importAccount(event: unknown): Promise<void> {
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
    const suggestedName = `${file.name.replace(/\.json$/i, "").slice(0, 14)}-导入`;
    const result = await ElMessageBox.prompt(
      "备份将作为一个新账号导入，不会覆盖现有数据。",
      "导入账号备份",
      {
        confirmButtonText: "导入",
        cancelButtonText: "取消",
        inputValue: suggestedName,
        inputPattern: /\S/,
        inputErrorMessage: "请输入账号名称",
      },
    );
    accountActionBusy.value = true;
    await store.importAccountBackup(serialized, result.value);
    accountDialogVisible.value = false;
    await router.push("/");
    ElMessage.success("账号备份已导入");
  } catch (error) {
    if (error !== "cancel")
      ElMessage.error(error instanceof Error ? error.message : "账号导入失败");
  } finally {
    accountActionBusy.value = false;
  }
}
</script>

<template>
  <el-config-provider :message="{ duration: 1600 }">
    <div class="application-shell">
      <header class="application-header">
        <button
          class="application-brand"
          type="button"
          title="返回首页"
          @click="router.push('/')"
        >
          <Spade
            class="application-brand__icon"
            :size="20"
            aria-hidden="true"
          />
          <span class="application-brand__name">HoldUp</span>
        </button>

        <nav class="application-navigation" aria-label="主导航">
          <button
            class="application-navigation__button"
            :class="{
              'application-navigation__button--active': route.name === 'home',
            }"
            type="button"
            title="首页"
            @click="router.push('/')"
          >
            <House
              class="application-navigation__icon"
              :size="18"
              aria-hidden="true"
            />
            <span class="application-navigation__label">首页</span>
          </button>
          <button
            class="application-navigation__button"
            :class="{
              'application-navigation__button--active':
                route.name === 'history',
            }"
            type="button"
            title="对局记录"
            @click="router.push('/history')"
          >
            <History
              class="application-navigation__icon"
              :size="18"
              aria-hidden="true"
            />
            <span class="application-navigation__label">记录</span>
          </button>
        </nav>

        <div class="application-status">
          <span
            v-if="store.session"
            class="application-status__save"
            :class="`application-status__save--${store.saveState}`"
          >
            <Save
              class="application-status__save-icon"
              :size="15"
              aria-hidden="true"
            />
            <span class="application-status__save-label">{{ saveLabel }}</span>
          </span>
          <el-dropdown
            class="account-switcher"
            trigger="click"
            @command="openAccountDialog"
          >
            <button class="account-switcher__trigger" type="button">
              <CircleUserRound
                class="account-switcher__icon"
                :size="18"
                aria-hidden="true"
              />
              <span class="account-switcher__name">{{
                store.account?.name ?? "载入中"
              }}</span>
            </button>
            <template #dropdown>
              <el-dropdown-menu class="account-switcher__menu">
                <el-dropdown-item
                  class="account-switcher__item"
                  command="manage"
                >
                  账号管理
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <main class="application-content">
        <div v-if="!store.initialized" class="application-loading">
          <span class="application-loading__spinner" aria-hidden="true"></span>
          <span class="application-loading__label">正在恢复本地现场</span>
        </div>
        <router-view v-else class="application-view" />
      </main>

      <el-alert
        v-if="store.errorMessage"
        class="application-error"
        :title="store.errorMessage"
        type="error"
        show-icon
        closable
        @close="store.clearError"
      />

      <el-dialog
        v-model="accountDialogVisible"
        class="account-switch-dialog"
        title="账号管理"
        width="min(520px, 92vw)"
      >
        <div class="account-switch-dialog__list">
          <div
            v-for="accountItem in store.accounts"
            :key="accountItem.id"
            class="account-switch-dialog__entry"
            :class="{
              'account-switch-dialog__entry--current':
                accountItem.id === store.account?.id,
            }"
          >
            <div class="account-switch-dialog__identity">
              <strong class="account-switch-dialog__name">
                {{ accountItem.name }}
              </strong>
              <span
                v-if="accountItem.id === store.account?.id"
                class="account-switch-dialog__current"
              >
                当前账号
              </span>
              <span class="account-switch-dialog__summary">
                Lv.{{ accountItem.level }} ·
                {{ accountItem.bankroll.toLocaleString() }} 筹码
              </span>
            </div>
            <div class="account-switch-dialog__commands">
              <el-button
                class="account-switch-dialog__switch"
                :disabled="
                  accountActionBusy ||
                  store.busy ||
                  accountItem.id === store.account?.id
                "
                @click="selectAccount(accountItem.id)"
              >
                {{ accountItem.id === store.account?.id ? "已选择" : "切换" }}
              </el-button>
              <el-button
                class="account-switch-dialog__delete"
                type="danger"
                text
                :icon="Trash2"
                :disabled="
                  accountActionBusy ||
                  store.busy ||
                  accountItem.id === store.account?.id
                "
                @click="deleteAccount(accountItem.id)"
              >
                删除
              </el-button>
            </div>
          </div>
        </div>
        <div class="account-management-dialog__create">
          <div class="account-management-dialog__heading">
            <Plus
              class="account-management-dialog__icon"
              :size="17"
              aria-hidden="true"
            />
            <span class="account-management-dialog__title">新建本地账号</span>
          </div>
          <div class="account-management-dialog__form">
            <el-input
              v-model="newAccountName"
              class="account-management-dialog__input"
              maxlength="20"
              placeholder="账号名称"
              :disabled="accountActionBusy || store.busy"
              @keyup.enter="createAccount"
            />
            <el-button
              class="account-management-dialog__button"
              type="primary"
              :icon="Plus"
              :loading="accountActionBusy"
              :disabled="store.busy"
              @click="createAccount"
            >
              新建
            </el-button>
          </div>
        </div>
        <div class="account-management-dialog__backup">
          <input
            ref="backupInput"
            class="account-management-dialog__file-input"
            type="file"
            accept="application/json,.json"
            @change="importAccount"
          />
          <el-button
            class="account-management-dialog__backup-button"
            :icon="Download"
            :disabled="accountActionBusy || store.busy"
            @click="exportAccount"
          >
            导出当前账号
          </el-button>
          <el-button
            class="account-management-dialog__backup-button"
            :icon="Upload"
            :disabled="accountActionBusy || store.busy"
            @click="chooseBackupFile"
          >
            导入为新账号
          </el-button>
        </div>
      </el-dialog>
    </div>
  </el-config-provider>
</template>
