<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ChevronLeft, ChevronRight, History, Search } from "@lucide/vue";
import { useAppStore } from "@/stores/app";
import { gameRepository } from "@/persistence/repository";
import type { HandHistoryRecord } from "@/persistence/database";
import { createReplayFrames } from "@/domain/replay";
import PlayingCard from "@/components/PlayingCard.vue";

const store = useAppStore();
const records = ref<HandHistoryRecord[]>([]);
const searchText = ref("");
const selectedRecord = ref<HandHistoryRecord | null>(null);
const replayIndex = ref(0);
const replayFrames = computed(() =>
  selectedRecord.value ? createReplayFrames(selectedRecord.value.hand) : [],
);
const replayFrame = computed(
  () => replayFrames.value[replayIndex.value] ?? null,
);

const filteredRecords = computed(() => {
  const query = searchText.value.trim().toLocaleLowerCase("zh-CN");
  if (!query) return records.value;
  return records.value.filter(
    (record) =>
      record.sessionId.toLocaleLowerCase().includes(query) ||
      String(record.handNumber).includes(query),
  );
});

async function loadRecords(): Promise<void> {
  if (!store.account) return;
  records.value = await gameRepository.listHandRecords(store.account.id);
}

onMounted(() => void loadRecords());
watch(
  () => store.account?.id,
  () => void loadRecords(),
);

function openRecord(record: HandHistoryRecord): void {
  selectedRecord.value = record;
  replayIndex.value = 0;
}

function moveReplay(offset: number): void {
  replayIndex.value = Math.min(
    Math.max(0, replayIndex.value + offset),
    Math.max(0, replayFrames.value.length - 1),
  );
}
</script>

<template>
  <div class="history-page">
    <header class="history-header">
      <div class="history-header__copy">
        <span class="history-header__eyebrow">{{ store.account?.name }}</span>
        <h1 class="history-header__title">对局记录</h1>
      </div>
      <el-input
        v-model="searchText"
        class="history-header__search"
        placeholder="搜索牌局编号或手数"
        :prefix-icon="Search"
        clearable
      />
    </header>

    <section class="history-content" aria-label="历史手牌">
      <div v-if="!filteredRecords.length" class="history-empty">
        <History class="history-empty__icon" :size="28" aria-hidden="true" />
        <span class="history-empty__title">暂无已归档手牌</span>
        <span class="history-empty__description"
          >完成一手并进入下一手后，记录会出现在这里。</span
        >
      </div>

      <el-table
        v-else
        class="history-table"
        :data="filteredRecords"
        @row-click="openRecord"
      >
        <el-table-column
          class-name="history-table__cell"
          prop="handNumber"
          label="手牌"
          width="90"
        />
        <el-table-column
          class-name="history-table__cell"
          prop="sessionId"
          label="牌局编号"
          min-width="180"
          show-overflow-tooltip
        />
        <el-table-column
          class-name="history-table__cell"
          label="底池"
          width="110"
        >
          <template #default="scope">
            <span class="history-table__pot">{{
              scope.row.hand.pots.reduce(
                (sum: number, pot: { amount: number }) => sum + pot.amount,
                0,
              )
            }}</span>
          </template>
        </el-table-column>
        <el-table-column
          class-name="history-table__cell"
          label="状态"
          width="120"
        >
          <template #default="scope">
            <span
              class="history-table__status"
              :class="{ 'history-table__status--left': scope.row.leftTable }"
            >
              {{ scope.row.leftTable ? "中途离桌" : "已完成" }}
            </span>
          </template>
        </el-table-column>
        <el-table-column
          class-name="history-table__cell"
          prop="createdAt"
          label="时间"
          min-width="180"
        />
      </el-table>
    </section>

    <el-drawer
      v-model="selectedRecord"
      class="history-detail"
      title="行动时间线"
      size="min(720px, 96vw)"
    >
      <div v-if="selectedRecord && replayFrame" class="history-replay">
        <div class="history-replay__status">
          <span class="history-replay__step">
            行动 {{ replayIndex + 1 }} / {{ replayFrames.length }}
          </span>
          <strong class="history-replay__message">
            {{ replayFrame.event.message }}
          </strong>
          <span class="history-replay__pot">底池 {{ replayFrame.pot }}</span>
        </div>
        <div class="history-replay__board" aria-label="回放公共牌">
          <PlayingCard
            v-for="boardIndex in 5"
            :key="boardIndex"
            :card="replayFrame.board[boardIndex - 1]"
            compact
          />
        </div>
        <div class="history-replay__players">
          <div
            v-for="player in replayFrame.players"
            :key="player.id"
            class="history-replay-player"
            :class="{
              'history-replay-player--folded': player.folded,
              'history-replay-player--human': player.isHuman,
            }"
          >
            <div class="history-replay-player__identity">
              <strong class="history-replay-player__name">{{
                player.name
              }}</strong>
              <span class="history-replay-player__stack">
                {{ player.stack }} · 已投 {{ player.committed }}
              </span>
            </div>
            <div class="history-replay-player__cards">
              <PlayingCard
                v-for="cardIndex in 2"
                :key="cardIndex"
                :card="player.holeCards[cardIndex - 1]"
                :hidden="!player.holeCards[cardIndex - 1]"
                compact
              />
            </div>
          </div>
        </div>
        <div class="history-replay__controls">
          <el-button
            class="history-replay__control"
            :icon="ChevronLeft"
            circle
            title="上一步"
            :disabled="replayIndex === 0"
            @click="moveReplay(-1)"
          />
          <el-slider
            v-model="replayIndex"
            class="history-replay__slider"
            :min="0"
            :max="Math.max(0, replayFrames.length - 1)"
            :show-tooltip="false"
          />
          <el-button
            class="history-replay__control"
            :icon="ChevronRight"
            circle
            title="下一步"
            :disabled="replayIndex >= replayFrames.length - 1"
            @click="moveReplay(1)"
          />
        </div>
      </div>

      <ol v-if="selectedRecord" class="history-detail__timeline">
        <li
          v-for="event in selectedRecord.hand.events"
          :key="event.seq"
          class="history-detail__event"
          :class="{
            'history-detail__event--active':
              replayFrame?.event.seq === event.seq,
          }"
        >
          <button
            class="history-detail__event-button"
            type="button"
            @click="replayIndex = selectedRecord.hand.events.indexOf(event)"
          >
            <span class="history-detail__sequence">{{ event.seq }}</span>
            <span class="history-detail__event-copy">
              <strong class="history-detail__message">{{
                event.message
              }}</strong>
              <span class="history-detail__meta">
                {{ event.phase }} · 底池 {{ event.pot }}
              </span>
            </span>
          </button>
        </li>
      </ol>
    </el-drawer>
  </div>
</template>
