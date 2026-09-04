import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { decideAiAction } from "@/domain/ai";
import {
  applyPlayerAction,
  createGameSession,
  forceHumanLeave,
  getCurrentPlayer,
  getHumanPlayer,
  startNextHand,
} from "@/domain/engine";
import { experienceThreshold } from "@/domain/progression";
import type {
  AccountProfile,
  GameConfig,
  GameSession,
  PlayerActionCommand,
} from "@/domain/types";
import { gameRepository } from "@/persistence/repository";
import { DEFAULT_GAME_SETTINGS, type GameSettings } from "@/domain/settings";
import { configureAudio, playDecisionSound } from "@/services/audio";

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function queueTask(task: () => Promise<void>): void {
  window.setTimeout(() => void task(), 0);
}

export const useAppStore = defineStore("app", () => {
  const initialized = ref(false);
  const busy = ref(false);
  const errorMessage = ref("");
  const account = ref<AccountProfile | null>(null);
  const accounts = ref<AccountProfile[]>([]);
  const session = ref<GameSession | null>(null);
  const saveState = ref<"saved" | "saving" | "error">("saved");
  const storageLocked = ref(false);
  const settings = ref<GameSettings>({ ...DEFAULT_GAME_SETTINGS });
  const activeActionCommandId = ref<string | null>(null);
  const completedActionCommandId = ref<string | null>(null);

  const currentPlayer = computed(() =>
    session.value ? getCurrentPlayer(session.value) : null,
  );
  const humanPlayer = computed(() =>
    session.value ? getHumanPlayer(session.value) : null,
  );
  const isHumanTurn = computed(() => Boolean(currentPlayer.value?.isHuman));
  const levelProgress = computed(() => {
    if (!account.value) return 0;
    return Math.round(
      (account.value.currentLevelXp /
        experienceThreshold(account.value.level)) *
        100,
    );
  });

  async function refreshAccounts(): Promise<void> {
    accounts.value = await gameRepository.listAccounts();
  }

  async function initialize(): Promise<void> {
    if (initialized.value) return;
    busy.value = true;
    try {
      account.value = await gameRepository.initialize();
      settings.value = await gameRepository.loadSettings(account.value.id);
      configureAudio(settings.value);
      await refreshAccounts();
      session.value = await gameRepository.loadActiveSession(account.value.id);
      initialized.value = true;
      if (session.value) queueTask(continueAiTurns);
    } catch (error) {
      setError(error);
    } finally {
      busy.value = false;
    }
  }

  async function reloadLocalState(): Promise<void> {
    account.value = await gameRepository.getCurrentAccount();
    settings.value = await gameRepository.loadSettings(account.value.id);
    configureAudio(settings.value);
    session.value = await gameRepository.loadActiveSession(account.value.id);
    await refreshAccounts();
    saveState.value = "saved";
    storageLocked.value = false;
    if (session.value) queueTask(continueAiTurns);
  }

  async function createAccount(name: string): Promise<void> {
    account.value = await gameRepository.createAccount(name);
    settings.value = await gameRepository.loadSettings(account.value.id);
    configureAudio(settings.value);
    session.value = null;
    await refreshAccounts();
  }

  async function switchAccount(accountId: string): Promise<void> {
    if (account.value?.id === accountId) return;
    account.value = await gameRepository.switchAccount(accountId);
    settings.value = await gameRepository.loadSettings(accountId);
    configureAudio(settings.value);
    session.value = await gameRepository.loadActiveSession(accountId);
    await refreshAccounts();
    if (session.value) queueTask(continueAiTurns);
  }

  async function switchAccountAfterLeave(accountId: string): Promise<void> {
    if (session.value) await closeCurrentTable();
    await switchAccount(accountId);
  }

  async function renameAccount(name: string): Promise<void> {
    if (!account.value) return;
    account.value = await gameRepository.renameAccount(account.value.id, name);
    await refreshAccounts();
  }

  async function deleteAccount(accountId: string): Promise<void> {
    const deletingCurrent = account.value?.id === accountId;
    if (deletingCurrent) throw new Error("当前账号不可删除，请先切换账号");
    await gameRepository.deleteAccount(accountId);
    await refreshAccounts();
  }

  async function downgrade(targetLevel: number): Promise<void> {
    if (!account.value) return;
    account.value = await gameRepository.downgradeAccount(
      account.value.id,
      targetLevel,
    );
    await refreshAccounts();
  }

  async function updateSettings(updates: Partial<GameSettings>): Promise<void> {
    if (!account.value) return;
    settings.value = await gameRepository.saveSettings(
      account.value.id,
      updates,
    );
    configureAudio(settings.value);
  }

  async function exportCurrentAccount(): Promise<string> {
    if (!account.value) throw new Error("账号尚未初始化");
    return gameRepository.exportAccount(account.value.id);
  }

  async function importAccountBackup(
    serialized: string,
    name: string,
  ): Promise<void> {
    account.value = await gameRepository.importAccountBackup(serialized, name);
    settings.value = await gameRepository.loadSettings(account.value.id);
    configureAudio(settings.value);
    session.value = await gameRepository.loadActiveSession(account.value.id);
    await refreshAccounts();
    if (session.value) queueTask(continueAiTurns);
  }

  async function startGame(config: GameConfig): Promise<void> {
    if (!account.value) throw new Error("账号尚未初始化");
    if (storageLocked.value)
      throw new Error("存储处于只读保护，请重新载入现场");
    if (session.value) throw new Error("存在未结束牌局，请先继续现场");
    busy.value = true;
    try {
      const created = createGameSession(
        account.value.id,
        account.value.name,
        account.value.level,
        config,
      );
      const started = await gameRepository.beginSession(created);
      account.value = started.account;
      session.value = started.session;
      await refreshAccounts();
      queueTask(continueAiTurns);
    } catch (error) {
      setError(error);
      throw error;
    } finally {
      busy.value = false;
    }
  }

  async function performAction(command: PlayerActionCommand): Promise<void> {
    if (storageLocked.value)
      throw new Error("存储处于只读保护，请重新载入现场");
    if (
      command.id === activeActionCommandId.value ||
      command.id === completedActionCommandId.value
    )
      return;
    if (!session.value || !isHumanTurn.value || busy.value) return;
    if (
      command.sessionId !== session.value.id ||
      command.actionSeq !== session.value.currentHand.actionSeq
    )
      throw new Error("琛屽姩宸茶繃鏈燂紝璇锋寜褰撳墠鐗岄潰閲嶆柊鎿嶄綔");
    activeActionCommandId.value = command.id;
    busy.value = true;
    saveState.value = "saving";
    try {
      const player = getCurrentPlayer(session.value);
      if (!player) return;
      const next = applyPlayerAction(session.value, player.id, {
        type: command.type,
        targetAmount: command.targetAmount,
      });
      session.value = await gameRepository.commitSession(next);
      completedActionCommandId.value = command.id;
      playDecisionSound(true);
      saveState.value = "saved";
    } catch (error) {
      saveState.value = "error";
      storageLocked.value = true;
      setError(error);
      throw error;
    } finally {
      activeActionCommandId.value = null;
      busy.value = false;
    }
    await continueAiTurns();
  }

  async function continueAiTurns(): Promise<void> {
    if (busy.value || storageLocked.value) return;
    let guard = 0;
    while (
      session.value &&
      session.value.currentHand.phase !== "complete" &&
      guard < 100
    ) {
      const player = getCurrentPlayer(session.value);
      if (!player || player.isHuman) return;
      busy.value = true;
      await wait(settings.value.aiThinkingTime);
      saveState.value = "saving";
      try {
        const action = decideAiAction(session.value, player);
        const next = applyPlayerAction(session.value, player.id, action);
        session.value = await gameRepository.commitSession(next);
        playDecisionSound(false);
        saveState.value = "saved";
      } catch (error) {
        saveState.value = "error";
        storageLocked.value = true;
        setError(error);
        return;
      } finally {
        busy.value = false;
      }
      guard += 1;
    }
  }

  async function proceedAfterHand(): Promise<"next" | "finished"> {
    if (storageLocked.value)
      throw new Error("存储处于只读保护，请重新载入现场");
    if (!session.value || session.value.currentHand.phase !== "complete")
      throw new Error("当前手牌尚未结束");
    busy.value = true;
    try {
      const previous = session.value;
      const next = startNextHand(
        previous,
        account.value?.level ?? previous.playerLevel,
      );
      if (next.status === "complete") {
        account.value = await gameRepository.finishSession(next);
        session.value = null;
        await refreshAccounts();
        return "finished";
      }
      session.value = await gameRepository.commitNextHand(previous, next);
      queueTask(continueAiTurns);
      return "next";
    } catch (error) {
      storageLocked.value = true;
      saveState.value = "error";
      setError(error);
      throw error;
    } finally {
      busy.value = false;
    }
  }

  async function leaveAndRematch(): Promise<void> {
    if (storageLocked.value)
      throw new Error("存储处于只读保护，请重新载入现场");
    if (!session.value || !account.value) return;
    busy.value = true;
    try {
      let abandoned = forceHumanLeave(session.value);
      abandoned = await gameRepository.commitSession(abandoned);
      while (abandoned.currentHand.phase !== "complete") {
        const player = getCurrentPlayer(abandoned);
        if (!player || player.isHuman) throw new Error("离桌结算无法继续");
        abandoned = applyPlayerAction(
          abandoned,
          player.id,
          decideAiAction(abandoned, player),
        );
        abandoned = await gameRepository.commitSession(abandoned);
      }

      const replacement = createGameSession(
        account.value.id,
        account.value.name,
        account.value.level,
        abandoned.config,
        Date.now(),
      );
      const result = await gameRepository.replaceAfterLeave(
        abandoned,
        replacement,
      );
      account.value = result.account;
      session.value = result.session;
      await refreshAccounts();
      queueTask(continueAiTurns);
    } catch (error) {
      storageLocked.value = true;
      saveState.value = "error";
      setError(error);
      throw error;
    } finally {
      busy.value = false;
    }
  }

  async function closeCurrentTable(): Promise<void> {
    if (storageLocked.value)
      throw new Error("存储处于只读保护，请重新载入现场");
    if (!session.value) return;
    let abandoned = forceHumanLeave(session.value);
    abandoned = await gameRepository.commitSession(abandoned);
    while (abandoned.currentHand.phase !== "complete") {
      const player = getCurrentPlayer(abandoned);
      if (!player || player.isHuman) throw new Error("离桌结算无法继续");
      abandoned = applyPlayerAction(
        abandoned,
        player.id,
        decideAiAction(abandoned, player),
      );
      abandoned = await gameRepository.commitSession(abandoned);
    }
    account.value = await gameRepository.closeAfterLeave(abandoned);
    session.value = null;
    await refreshAccounts();
  }

  function clearError(): void {
    errorMessage.value = "";
  }

  function setError(error: unknown): void {
    errorMessage.value =
      error instanceof Error ? error.message : "发生未知错误";
  }

  return {
    initialized,
    busy,
    errorMessage,
    account,
    accounts,
    session,
    saveState,
    storageLocked,
    settings,
    currentPlayer,
    humanPlayer,
    isHumanTurn,
    levelProgress,
    initialize,
    reloadLocalState,
    createAccount,
    switchAccount,
    switchAccountAfterLeave,
    renameAccount,
    deleteAccount,
    downgrade,
    updateSettings,
    exportCurrentAccount,
    importAccountBackup,
    startGame,
    performAction,
    proceedAfterHand,
    leaveAndRematch,
    closeCurrentTable,
    clearError,
  };
});
