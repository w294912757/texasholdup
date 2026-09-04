<script setup lang="ts">
/* global window, document, crypto, PointerEvent, EventTarget, HTMLElement, KeyboardEvent */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  ArrowRight,
  BookOpen,
  ChartNoAxesCombined,
  DoorOpen,
  Save,
  Volume2,
} from "@lucide/vue";
import PlayingCard from "@/components/PlayingCard.vue";
import RuleHelpDialog from "@/components/RuleHelpDialog.vue";
import type { RuleTopicId } from "@/domain/rules";
import { getLegalActions, getPlayerHandType, handPot } from "@/domain/engine";
import { calculateGtoReference } from "@/domain/gto";
import type {
  LegalAction,
  PlayerActionCommand,
  PlayerState,
} from "@/domain/types";
import { useAppStore } from "@/stores/app";

const store = useAppStore();
const router = useRouter();
const betTarget = ref(0);
const gtoDialogOpen = ref(false);
const ruleHelpOpen = ref(false);
const ruleHelpTopic = ref<RuleTopicId>("actions");
const longPressAction = ref<string | null>(null);
const longPressTimer = ref<number | null>(null);
const suppressTouchClick = ref(false);

const hand = computed(() => store.session?.currentHand ?? null);
const sortedPlayers = computed(() =>
  [...(hand.value?.players ?? [])].sort(
    (left, right) => left.seat - right.seat,
  ),
);
const pot = computed(() => (hand.value ? handPot(hand.value) : 0));
const legalActions = computed<LegalAction[]>(() => {
  if (!store.session || !store.currentPlayer?.isHuman) return [];
  return getLegalActions(store.session, store.currentPlayer.id);
});
const aggressiveAction = computed(() =>
  legalActions.value.find(
    (action) => action.type === "bet" || action.type === "raise",
  ),
);
const recentEvents = computed(
  () => hand.value?.events.slice(-8).reverse() ?? [],
);
const phaseLabel = computed(() => {
  const labels = {
    preflop: "翻牌前",
    flop: "翻牌",
    turn: "转牌",
    river: "河牌",
    showdown: "摊牌",
    complete: "已结算",
  };
  return hand.value ? labels[hand.value.phase] : "";
});
const saveLabel = computed(() =>
  store.saveState === "saving"
    ? "保存中"
    : store.saveState === "error"
      ? "保存失败"
      : "已保存",
);
const winnerNames = computed(() => {
  if (!hand.value) return "";
  return hand.value.winnerIds
    .map((id) => hand.value?.players.find((player) => player.id === id)?.name)
    .filter(Boolean)
    .join("、");
});
const isFinalHand = computed(
  () =>
    (hand.value?.number ?? 0) >= (store.session?.config.maxHands ?? 20) ||
    (store.humanPlayer?.stack ?? 0) === 0,
);
const gtoReference = computed(() =>
  store.session ? calculateGtoReference(store.session) : null,
);
const gtoTooltip = computed(() => {
  const reference = gtoReference.value;
  if (!reference?.available || !reference.primaryAction)
    return reference?.status;
  return `${reference.primaryAction.label} ${reference.primaryAction.frequency}%`;
});

watch(
  aggressiveAction,
  (action) => {
    betTarget.value = action?.minTarget ?? 0;
  },
  { immediate: true },
);

onMounted(() => {
  if (!store.session) void router.replace("/");
  window.addEventListener("keydown", handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
  cancelLongPress();
});

function playerCardsVisible(player: PlayerState): boolean {
  if (player.isHuman) return true;
  return hand.value?.phase === "complete" && !player.folded;
}

function formatPercent(value: number | null): string {
  return value === null ? "--" : `${Math.round(value * 100)}%`;
}

function playerHandType(player: PlayerState): string | null {
  if (!hand.value || player.holeCards.length === 0) return null;
  return getPlayerHandType(player, hand.value.board);
}

function playerHandTypeVisible(player: PlayerState): boolean {
  if (player.isHuman) return true;
  return Boolean(
    hand.value &&
    (hand.value.phase === "showdown" || hand.value.phase === "complete") &&
    !player.folded,
  );
}

function actionLabel(action: LegalAction): string {
  return action.label;
}

function openRuleHelp(topicId: RuleTopicId): void {
  gtoDialogOpen.value = false;
  ruleHelpTopic.value = topicId;
  ruleHelpOpen.value = true;
}

function requiresActionConfirmation(action: LegalAction): boolean {
  if (!store.currentPlayer) return false;
  if (action.type === "all-in") return store.settings.confirmAllIn;
  if (action.type !== "bet" && action.type !== "raise") return false;
  const additional = Math.max(
    0,
    betTarget.value - store.currentPlayer.committedRound,
  );
  return (
    store.settings.confirmLargeBet &&
    additional >= store.currentPlayer.stack * 0.5 &&
    additional < store.currentPlayer.stack
  );
}

async function submitAction(
  action: LegalAction,
  fromLongPress = false,
): Promise<void> {
  const payload: PlayerActionCommand =
    action.type === "bet" || action.type === "raise"
      ? {
          type: action.type,
          targetAmount: betTarget.value,
          id: crypto.randomUUID(),
          sessionId: store.session?.id ?? "",
          actionSeq: store.session?.currentHand.actionSeq ?? -1,
        }
      : {
          type: action.type,
          id: crypto.randomUUID(),
          sessionId: store.session?.id ?? "",
          actionSeq: store.session?.currentHand.actionSeq ?? -1,
        };
  if (suppressTouchClick.value && !fromLongPress) {
    suppressTouchClick.value = false;
    return;
  }
  const additional = store.currentPlayer
    ? Math.max(
        0,
        (payload.targetAmount ??
          store.currentPlayer.committedRound + store.currentPlayer.stack) -
          store.currentPlayer.committedRound,
      )
    : 0;
  const requiresConfirm = requiresActionConfirmation(action);
  try {
    if (requiresConfirm) {
      await ElMessageBox.confirm(
        `确认${action.type === "all-in" ? "全下" : "大额下注"}？本次追加 ${additional.toLocaleString()}，操作后剩余 ${Math.max(0, (store.currentPlayer?.stack ?? 0) - additional).toLocaleString()}，预计底池 ${(pot.value + additional).toLocaleString()}。`,
        "确认操作",
        {
          confirmButtonText: "确认提交",
          cancelButtonText: "取消",
          type: "warning",
        },
      );
    }
    await store.performAction(payload);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "行动提交失败");
  }
}

function cancelLongPress(): void {
  if (longPressTimer.value !== null) window.clearTimeout(longPressTimer.value);
  longPressTimer.value = null;
  longPressAction.value = null;
}

function handlePointerDown(action: LegalAction, event: PointerEvent): void {
  if (event.pointerType !== "touch") return;
  if (!requiresActionConfirmation(action)) return;
  longPressAction.value = action.type;
  longPressTimer.value = window.setTimeout(() => {
    suppressTouchClick.value = true;
    void submitAction(action, true);
    cancelLongPress();
  }, 550);
}

function handlePointerUp(action: LegalAction, event: PointerEvent): void {
  if (event.pointerType !== "touch") return;
  if (longPressAction.value === action.type) {
    suppressTouchClick.value = true;
    ElMessage.info("请长按确认高风险操作");
  }
  cancelLongPress();
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(
    element?.matches("input, textarea, select, [contenteditable='true']") ||
    element?.closest(".el-dialog, .el-drawer, .el-popper"),
  );
}

function interactionLayerOpen(): boolean {
  return Boolean(
    document.querySelector(
      ".el-overlay, .el-drawer, .el-popper:not([aria-hidden='true'])",
    ),
  );
}

function handleKeydown(event: KeyboardEvent): void {
  if (
    event.repeat ||
    isTypingTarget(event.target) ||
    interactionLayerOpen() ||
    store.busy ||
    store.storageLocked
  )
    return;
  const key = event.key.toLowerCase();
  if (key === "escape") {
    gtoDialogOpen.value = false;
    ruleHelpOpen.value = false;
    return;
  }
  if (key === "g") {
    gtoDialogOpen.value = true;
    return;
  }
  if (key === " " && hand.value?.phase === "complete") {
    event.preventDefault();
    void proceed();
    return;
  }
  if (!store.isHumanTurn) return;
  const mapped: Record<string, LegalAction["type"]> = {
    f: "fold",
    c: legalActions.value.some((item) => item.type === "check")
      ? "check"
      : "call",
    b: "bet",
    a: "all-in",
  };
  const action = legalActions.value.find((item) => item.type === mapped[key]);
  if (action) {
    event.preventDefault();
    void submitAction(action);
  }
}

async function leaveAndRematch(): Promise<void> {
  if (!store.session || !store.humanPlayer) return;
  const loss = store.humanPlayer.committedHand;
  try {
    if (store.settings.confirmLeaveTable)
      await ElMessageBox.confirm(
        `离桌后将放弃本手已投入的 ${loss} 筹码，未投入的 ${store.humanPlayer.stack} 筹码会退回账号。`,
        "离桌并重新匹配",
        {
          confirmButtonText: "确认离桌",
          cancelButtonText: "继续游戏",
          type: "warning",
        },
      );
    await store.leaveAndRematch();
    ElMessage.success("已离桌并完成重新匹配");
  } catch (error) {
    if (error !== "cancel")
      ElMessage.error(error instanceof Error ? error.message : "重新匹配失败");
  }
}

async function proceed(): Promise<void> {
  try {
    const result = await store.proceedAfterHand();
    if (result === "finished") {
      ElMessage.success("本场牌局已完成并结算");
      await router.push("/");
      return;
    }

    const rosterEvents =
      store.session?.currentHand.events.filter(
        (event) => event.type === "ai-left" || event.type === "ai-joined",
      ) ?? [];
    const departed = rosterEvents.filter((event) => event.type === "ai-left");
    const joined = rosterEvents.filter((event) => event.type === "ai-joined");
    if (departed.length) {
      ElMessage.info({
        message:
          departed.length === 1 && joined.length === 1
            ? `${departed[0]?.message.replace("离开牌桌", "离桌")}，${joined[0]?.message}`
            : `${departed.length} 名对手离桌，${joined.length} 名新对手入座`,
        duration: 1_600,
      });
    }
  } catch (error) {
    ElMessage.error(
      error instanceof Error ? error.message : "无法进入下一手牌",
    );
  }
}
</script>

<template>
  <div v-if="store.session && hand" class="game-page">
    <div class="game-toolbar">
      <div class="game-toolbar__session">
        <span class="game-toolbar__hand"
          >第 {{ hand.number }} / {{ store.session.config.maxHands }} 手</span
        >
        <span class="game-toolbar__phase">{{ phaseLabel }}</span>
      </div>
      <div class="game-toolbar__commands">
        <span
          class="game-toolbar__save"
          :class="`game-toolbar__save--${store.saveState}`"
        >
          <Save class="game-toolbar__save-icon" :size="15" aria-hidden="true" />
          <span class="game-toolbar__save-label">{{ saveLabel }}</span>
        </span>
        <button
          class="game-toolbar__icon-button"
          type="button"
          title="声音设置"
        >
          <Volume2 class="game-toolbar__icon" :size="18" aria-hidden="true" />
        </button>
        <el-tooltip :content="gtoTooltip" placement="bottom">
          <el-button
            class="game-toolbar__gto"
            :icon="ChartNoAxesCombined"
            @click="gtoDialogOpen = true"
          >
            <span class="game-toolbar__gto-label">GTO 参考</span>
          </el-button>
        </el-tooltip>
        <el-button
          class="game-toolbar__leave"
          :icon="DoorOpen"
          :disabled="store.busy || store.storageLocked"
          @click="leaveAndRematch"
        >
          离桌重匹配
        </el-button>
      </div>
    </div>

    <div class="game-layout">
      <section class="round-overview" aria-label="当前牌局信息">
        <div class="round-overview__board">
          <div class="round-overview__pot">
            <span class="round-overview__pot-label">底池</span>
            <strong class="round-overview__pot-value">{{
              pot.toLocaleString()
            }}</strong>
          </div>
          <div class="community-cards" aria-label="公共牌">
            <PlayingCard
              v-for="cardIndex in 5"
              :key="cardIndex"
              class="community-cards__card"
              :card="hand.board[cardIndex - 1]"
            />
          </div>
        </div>

        <div class="player-list" role="list" aria-label="玩家列表">
          <div class="player-list__header" aria-hidden="true">
            <span class="player-list__header-player">玩家</span>
            <span class="player-list__header-stack">筹码</span>
            <span class="player-list__header-cards">手牌</span>
            <span class="player-list__header-state">状态</span>
          </div>
          <article
            v-for="player in sortedPlayers"
            :key="player.id"
            class="player-row"
            :class="[
              player.isHuman ? 'player-row--human' : 'player-row--opponent',
              {
                'player-row--acting': player.seat === hand.currentSeat,
                'player-row--folded': player.folded,
                'player-row--winner':
                  hand.phase === 'complete' &&
                  hand.winnerIds.includes(player.id),
              },
            ]"
            role="listitem"
          >
            <div class="player-row__identity">
              <span class="player-row__avatar">{{
                player.name.slice(0, 1).toUpperCase()
              }}</span>
              <div class="player-row__identity-copy">
                <strong class="player-row__name">{{ player.name }}</strong>
                <span class="player-row__position">
                  座位 {{ player.seat + 1 }}
                  <span
                    v-if="player.seat === hand.dealerSeat"
                    class="player-row__dealer"
                    >D</span
                  >
                </span>
              </div>
            </div>
            <strong class="player-row__stack">{{
              player.stack.toLocaleString()
            }}</strong>
            <div class="player-row__cards">
              <PlayingCard
                v-for="cardIndex in 2"
                :key="cardIndex"
                class="player-row__card"
                :card="player.holeCards[cardIndex - 1]"
                :hidden="!playerCardsVisible(player)"
                compact
              />
            </div>
            <div class="player-row__state">
              <span
                v-if="playerHandTypeVisible(player) && playerHandType(player)"
                class="player-row__hand-type"
              >
                {{ playerHandType(player) }}
              </span>
              <span v-if="player.committedRound > 0" class="player-row__bet">
                下注 {{ player.committedRound }}
              </span>
              <span v-if="player.lastAction" class="player-row__action">
                {{ player.lastAction }}
              </span>
            </div>
          </article>
        </div>
      </section>

      <aside class="action-history" aria-label="本手行动记录">
        <div class="action-history__heading">
          <h2 class="action-history__title">本手行动</h2>
          <span class="action-history__count">{{ hand.events.length }}</span>
        </div>
        <ol class="action-history__list">
          <li
            v-for="event in recentEvents"
            :key="event.seq"
            class="action-history__item"
          >
            <span class="action-history__sequence">{{ event.seq }}</span>
            <span class="action-history__message">{{ event.message }}</span>
          </li>
        </ol>
      </aside>
    </div>

    <section class="decision-panel" aria-label="玩家操作区">
      <div v-if="hand.phase === 'complete'" class="decision-panel__result">
        <div class="decision-panel__result-copy">
          <span class="decision-panel__status">本手已结算</span>
          <strong class="decision-panel__winner">
            {{ winnerNames }} 获胜
          </strong>
        </div>
        <el-button
          class="decision-panel__next"
          type="primary"
          :icon="ArrowRight"
          :loading="store.busy"
          :disabled="store.storageLocked"
          @click="proceed"
        >
          {{ isFinalHand ? "结算本场" : "下一手" }}
        </el-button>
      </div>

      <div v-else-if="store.isHumanTurn" class="decision-panel__actions">
        <div v-if="aggressiveAction" class="bet-control">
          <el-slider
            v-model="betTarget"
            class="bet-control__slider"
            :min="aggressiveAction.minTarget"
            :max="aggressiveAction.maxTarget"
            :step="store.session.config.bigBlind"
            :show-tooltip="false"
          />
          <el-input-number
            v-model="betTarget"
            class="bet-control__number"
            :min="aggressiveAction.minTarget"
            :max="aggressiveAction.maxTarget"
            :step="store.session.config.bigBlind"
            controls-position="right"
          />
          <span v-if="store.settings.beginnerHints" class="bet-control__hint">
            输入总下注额，范围 {{ aggressiveAction.minTarget }} 至
            {{ aggressiveAction.maxTarget }}
          </span>
        </div>
        <div class="decision-panel__buttons">
          <el-button
            class="decision-panel__rule-help"
            :icon="BookOpen"
            title="查看行动规则"
            @click="openRuleHelp('actions')"
          >
            规则
          </el-button>
          <el-button
            v-for="action in legalActions"
            :key="action.type"
            class="decision-panel__button"
            :class="`decision-panel__button--${action.type}`"
            :type="
              action.type === 'call' || action.type === 'check'
                ? 'primary'
                : action.type === 'fold'
                  ? 'danger'
                  : 'success'
            "
            :disabled="store.busy || store.storageLocked"
            @pointerdown="handlePointerDown(action, $event)"
            @pointerup="handlePointerUp(action, $event)"
            @pointercancel="cancelLongPress"
            @click="submitAction(action)"
          >
            {{ actionLabel(action) }}
          </el-button>
        </div>
      </div>

      <div v-else class="decision-panel__waiting">
        <span
          class="decision-panel__waiting-indicator"
          aria-hidden="true"
        ></span>
        <span class="decision-panel__waiting-label"
          >{{ store.currentPlayer?.name ?? "牌桌" }} 正在行动</span
        >
      </div>
    </section>

    <el-dialog
      v-model="gtoDialogOpen"
      class="gto-dialog"
      title="GTO 参考"
      append-to-body
    >
      <div v-if="gtoReference" class="gto-reference">
        <div class="gto-reference__summary">
          <div class="gto-reference__metric">
            <span class="gto-reference__metric-label">当前牌型</span>
            <strong class="gto-reference__metric-value">{{
              gtoReference.handType ?? "--"
            }}</strong>
          </div>
          <div class="gto-reference__metric">
            <span class="gto-reference__metric-label">估算权益</span>
            <strong class="gto-reference__metric-value">{{
              formatPercent(gtoReference.equity)
            }}</strong>
          </div>
          <div class="gto-reference__metric">
            <button
              class="gto-reference__metric-help"
              type="button"
              @click="openRuleHelp('pot-odds')"
            >
              底池赔率
            </button>
            <strong class="gto-reference__metric-value">{{
              formatPercent(gtoReference.potOdds)
            }}</strong>
          </div>
          <div class="gto-reference__metric">
            <button
              class="gto-reference__metric-help"
              type="button"
              @click="openRuleHelp('effective-stack')"
            >
              SPR
            </button>
            <strong class="gto-reference__metric-value">{{
              gtoReference.stackToPot?.toFixed(1) ?? "--"
            }}</strong>
          </div>
        </div>

        <div v-if="gtoReference.available" class="gto-reference__mix">
          <div
            v-for="action in gtoReference.actions"
            :key="action.type"
            class="gto-reference__action"
          >
            <div class="gto-reference__action-heading">
              <span class="gto-reference__action-label">{{
                action.label
              }}</span>
              <strong class="gto-reference__action-frequency"
                >{{ action.frequency }}%</strong
              >
            </div>
            <progress
              class="gto-reference__action-progress"
              :class="`gto-reference__action-progress--${action.type}`"
              :value="action.frequency"
              max="100"
              :aria-label="`${action.label} ${action.frequency}%`"
            ></progress>
          </div>
        </div>
        <div v-else class="gto-reference__empty">
          {{ gtoReference.status }}
        </div>

        <p class="gto-reference__notice">
          本地近似策略，使用未知牌随机模拟 {{ gtoReference.sampleCount }}
          次并结合底池赔率与 SPR 计算，不等同于完整 GTO 求解器结果。
        </p>
      </div>
    </el-dialog>
    <RuleHelpDialog v-model="ruleHelpOpen" :topic-id="ruleHelpTopic" />
  </div>

  <div v-else class="game-empty">
    <span class="game-empty__label">没有可恢复的牌局</span>
    <el-button
      class="game-empty__button"
      type="primary"
      @click="router.push('/')"
      >返回首页</el-button
    >
  </div>
</template>
