<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowRight, DoorOpen, Save, Volume2 } from "@lucide/vue";
import PlayingCard from "@/components/PlayingCard.vue";
import { getLegalActions, handPot } from "@/domain/engine";
import type { LegalAction, PlayerAction, PlayerState } from "@/domain/types";
import { useAppStore } from "@/stores/app";

const store = useAppStore();
const router = useRouter();
const betTarget = ref(0);

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

function visualPosition(index: number, total: number): number {
  const positions: Record<number, number[]> = {
    2: [0, 3],
    3: [0, 2, 4],
    4: [0, 2, 3, 4],
    5: [0, 1, 2, 4, 5],
    6: [0, 1, 2, 3, 4, 5],
  };
  return positions[total]?.[index] ?? index;
}

function playerCardsVisible(player: PlayerState): boolean {
  if (player.isHuman) return true;
  return hand.value?.phase === "complete" && !player.folded;
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
      <section class="poker-table" aria-label="德州扑克牌桌">
        <div class="poker-table__felt">
          <div class="poker-table__seats">
            <article
              v-for="(player, index) in sortedPlayers"
              :key="player.id"
              class="poker-seat"
              :class="[
                `poker-seat--position-${visualPosition(index, sortedPlayers.length)}`,
                player.isHuman ? 'poker-seat--human' : 'poker-seat--opponent',
                {
                  'poker-seat--acting': player.seat === hand.currentSeat,
                  'poker-seat--folded': player.folded,
                },
              ]"
            >
              <div class="poker-seat__identity">
                <span class="poker-seat__avatar">{{
                  player.name.slice(0, 1).toUpperCase()
                }}</span>
                <div class="poker-seat__copy">
                  <strong class="poker-seat__name">{{ player.name }}</strong>
                  <span class="poker-seat__stack">{{
                    player.stack.toLocaleString()
                  }}</span>
                </div>
              </div>
              <div class="poker-seat__cards">
                <PlayingCard
                  v-for="cardIndex in 2"
                  :key="cardIndex"
                  class="poker-seat__card"
                  :card="player.holeCards[cardIndex - 1]"
                  :hidden="!playerCardsVisible(player)"
                  compact
                />
              </div>
              <span v-if="player.committedRound > 0" class="poker-seat__bet"
                >下注 {{ player.committedRound }}</span
              >
              <span v-if="player.lastAction" class="poker-seat__action">{{
                player.lastAction
              }}</span>
              <span
                v-if="player.seat === hand.dealerSeat"
                class="poker-seat__dealer"
                >D</span
              >
            </article>
          </div>

          <div class="poker-table__center">
            <div class="poker-table__pot">
              <span class="poker-table__pot-label">底池</span>
              <strong class="poker-table__pot-value">{{
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
