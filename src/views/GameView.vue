<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  ArrowRight,
  ChartNoAxesCombined,
  DoorOpen,
  Save,
  Volume2,
} from "@lucide/vue";
import PlayingCard from "@/components/PlayingCard.vue";
import { getLegalActions, getPlayerHandType, handPot } from "@/domain/engine";
import { calculateGtoReference } from "@/domain/gto";
import type { LegalAction, PlayerAction, PlayerState } from "@/domain/types";
import { useAppStore } from "@/stores/app";

const store = useAppStore();
const router = useRouter();
const betTarget = ref(0);
const gtoDialogOpen = ref(false);

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

async function submitAction(action: LegalAction): Promise<void> {
  const payload: PlayerAction =
    action.type === "bet" || action.type === "raise"
      ? { type: action.type, targetAmount: betTarget.value }
      : { type: action.type };
  try {
    await store.performAction(payload);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "行动提交失败");
  }
}

async function leaveAndRematch(): Promise<void> {
  if (!store.session || !store.humanPlayer) return;
  const loss = store.humanPlayer.committedHand;
  try {
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
          :disabled="store.busy"
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
            :disabled="store.busy"
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
            <span class="gto-reference__metric-label">底池赔率</span>
            <strong class="gto-reference__metric-value">{{
              formatPercent(gtoReference.potOdds)
            }}</strong>
          </div>
          <div class="gto-reference__metric">
            <span class="gto-reference__metric-label">SPR</span>
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
