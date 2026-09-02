<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ChevronLeft,
  ChevronRight,
  History,
  Pause,
  Play,
  Save,
  Search,
  Star,
} from "@lucide/vue";
import { ElMessage } from "element-plus";
import { useAppStore } from "@/stores/app";
import { gameRepository } from "@/persistence/repository";
import type { HandHistoryRecord } from "@/persistence/database";
import { createReplayFrames } from "@/domain/replay";
import { REPLAY_SPEED_MILLISECONDS } from "@/domain/settings";
import PlayingCard from "@/components/PlayingCard.vue";

const store = useAppStore();
const records = ref<HandHistoryRecord[]>([]);
const searchText = ref("");
const favoriteOnly = ref(false);
const selectedRecord = ref<HandHistoryRecord | null>(null);
const replayIndex = ref(0);
const noteDraft = ref("");
const annotationSaving = ref(false);
const replayPlaying = ref(false);
let replayTimer: ReturnType<typeof globalThis.setInterval> | null = null;
const replayFrames = computed(() =>
  selectedRecord.value ? createReplayFrames(selectedRecord.value.hand) : [],
);
const replayFrame = computed(
  () => replayFrames.value[replayIndex.value] ?? null,
);

const filteredRecords = computed(() => {
  const query = searchText.value.trim().toLocaleLowerCase("zh-CN");
  return records.value.filter((record) => {
    if (favoriteOnly.value && !record.favorite) return false;
    if (!query) return true;
    return (
      record.sessionId.toLocaleLowerCase().includes(query) ||
      String(record.handNumber).includes(query) ||
      record.note.toLocaleLowerCase("zh-CN").includes(query)
    );
  });
});

async function loadRecords(): Promise<void> {
  if (!store.account) return;
  records.value = await gameRepository.listHandRecords(store.account.id);
}

onMounted(() => void loadRecords());
watch(
  () => store.account?.id,
  () => {
    selectedRecord.value = null;
    noteDraft.value = "";
    void loadRecords();
  },
);

function openRecord(record: HandHistoryRecord): void {
  stopReplay();
  selectedRecord.value = record;
  noteDraft.value = record.note;
  replayIndex.value = 0;
}

function replaceRecord(updated: HandHistoryRecord): void {
  records.value = records.value.map((record) =>
    record.id === updated.id ? updated : record,
  );
  if (selectedRecord.value?.id === updated.id) selectedRecord.value = updated;
}

async function toggleFavorite(record: HandHistoryRecord): Promise<void> {
  if (!store.account) return;
  try {
    replaceRecord(
      await gameRepository.updateHandAnnotation(store.account.id, record.id, {
        favorite: !record.favorite,
      }),
    );
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "收藏更新失败");
  }
}

async function saveNote(): Promise<void> {
  if (!store.account || !selectedRecord.value) return;
  annotationSaving.value = true;
  try {
    const updated = await gameRepository.updateHandAnnotation(
      store.account.id,
      selectedRecord.value.id,
      { note: noteDraft.value },
    );
    replaceRecord(updated);
    noteDraft.value = updated.note;
    ElMessage.success("备注已保存");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "备注保存失败");
  } finally {
    annotationSaving.value = false;
  }
}

function moveReplay(offset: number): void {
  replayIndex.value = Math.min(
    Math.max(0, replayIndex.value + offset),
    Math.max(0, replayFrames.value.length - 1),
  );
}

function stopReplay(): void {
  if (replayTimer !== null) globalThis.clearInterval(replayTimer);
  replayTimer = null;
  replayPlaying.value = false;
}

function toggleReplay(): void {
  if (replayPlaying.value) {
    stopReplay();
    return;
  }
  if (replayIndex.value >= replayFrames.value.length - 1) replayIndex.value = 0;
  replayPlaying.value = true;
  replayTimer = globalThis.setInterval(() => {
    if (replayIndex.value >= replayFrames.value.length - 1) {
      stopReplay();
      return;
    }
    replayIndex.value += 1;
  }, REPLAY_SPEED_MILLISECONDS[store.settings.replaySpeed]);
}

watch(selectedRecord, (record) => {
  if (!record) stopReplay();
});
onBeforeUnmount(stopReplay);
</script>

<template>
  <div class="history-page">
    <header class="history-header">
      <div class="history-header__copy">
        <span class="history-header__eyebrow">{{ store.account?.name }}</span>
        <h1 class="history-header__title">对局记录</h1>
      </div>
      <div class="history-header__tools">
        <el-input
          v-model="searchText"
          class="history-header__search"
          placeholder="搜索牌局编号、手数或备注"
          :prefix-icon="Search"
          clearable
        />
        <el-checkbox v-model="favoriteOnly" class="history-header__favorite">
          仅收藏
        </el-checkbox>
      </div>
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
          label="收藏"
          width="64"
          align="center"
        >
          <template #default="scope">
            <button
              class="history-table__favorite"
              :class="{
                'history-table__favorite--active': scope.row.favorite,
              }"
              type="button"
              :title="scope.row.favorite ? '取消收藏' : '收藏手牌'"
              :aria-label="scope.row.favorite ? '取消收藏手牌' : '收藏手牌'"
              @click.stop="toggleFavorite(scope.row)"
            >
              <Star
                class="history-table__favorite-icon"
                :size="17"
                aria-hidden="true"
              />
            </button>
          </template>
        </el-table-column>
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
      <section
        v-if="selectedRecord"
        class="history-annotation"
        aria-label="收藏与备注"
      >
        <header class="history-annotation__header">
          <strong class="history-annotation__title">本地标记</strong>
          <button
            class="history-annotation__favorite"
            :class="{
              'history-annotation__favorite--active': selectedRecord.favorite,
            }"
            type="button"
            :title="selectedRecord.favorite ? '取消收藏' : '收藏手牌'"
            :aria-label="selectedRecord.favorite ? '取消收藏手牌' : '收藏手牌'"
            @click="toggleFavorite(selectedRecord)"
          >
            <Star
              class="history-annotation__favorite-icon"
              :size="17"
              aria-hidden="true"
            />
          </button>
        </header>
        <label class="history-annotation__field">
          <span class="history-annotation__label">备注</span>
          <el-input
            v-model="noteDraft"
            class="history-annotation__input"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="记录这一手的关键判断"
          />
        </label>
        <el-button
          class="history-annotation__save"
          :icon="Save"
          :loading="annotationSaving"
          :disabled="noteDraft.trim() === selectedRecord.note"
          @click="saveNote"
        >
          保存备注
        </el-button>
      </section>

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
              'history-replay-player--winner': player.winner,
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
          <el-button
            class="history-replay__control history-replay__control--play"
            :icon="replayPlaying ? Pause : Play"
            circle
            :title="replayPlaying ? '暂停自动回放' : '自动回放'"
            :aria-label="replayPlaying ? '暂停自动回放' : '自动回放'"
            @click="toggleReplay"
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
