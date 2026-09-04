<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ChartColumnIncreasing, Download, RotateCcw } from "@lucide/vue";
import { useAppStore } from "@/stores/app";
import { gameRepository } from "@/persistence/repository";
import type { HandHistoryRecord } from "@/persistence/database";
import {
  analyzeHandRecord,
  buildStatisticsTrend,
  filterHandStatistics,
  POSITION_LABELS,
  STATISTICS_VERSION,
  summarizeHandStatistics,
  type StatisticsFilters,
  type TablePosition,
} from "@/domain/statistics";
import { statisticsToCsv } from "@/domain/export";

const store = useAppStore();
const records = ref<HandHistoryRecord[]>([]);
const loading = ref(false);
const dateRange = ref<[string, string] | null>(null);
const filters = reactive<StatisticsFilters>({
  dateFrom: "",
  dateTo: "",
  position: "all",
  startingHand: "",
  playerLevel: "all",
  tableResult: "all",
  favoriteOnly: false,
});

const analyzedHands = computed(() => records.value.map(analyzeHandRecord));
const filteredHands = computed(() =>
  filterHandStatistics(analyzedHands.value, filters),
);
const summary = computed(() => summarizeHandStatistics(filteredHands.value));
const trend = computed(() => buildStatisticsTrend(filteredHands.value));
const trendMaximum = computed(() =>
  Math.max(1, ...trend.value.map((entry) => Math.abs(entry.netProfit))),
);
const availableLevels = computed(() =>
  [...new Set(analyzedHands.value.map((hand) => hand.playerLevel))]
    .filter((level): level is number => level !== null)
    .sort((left, right) => left - right),
);
const positionOptions = computed(() =>
  Object.entries(POSITION_LABELS).map(([value, label]) => ({
    value: value as TablePosition,
    label,
  })),
);
const metricItems = computed(() => [
  { label: "总手数", value: summary.value.totalHands.toLocaleString() },
  { label: "胜率", value: formatRate(summary.value.winRate) },
  {
    label: "净输赢",
    value: formatSigned(summary.value.netProfit),
    tone: summary.value.netProfit >= 0 ? "profit" : "loss",
  },
  { label: "摊牌率", value: formatRate(summary.value.showdownRate) },
  { label: "摊牌胜率", value: formatRate(summary.value.showdownWinRate) },
  { label: "主动入池率", value: formatRate(summary.value.vpipRate) },
  { label: "翻牌前加注率", value: formatRate(summary.value.pfrRate) },
]);

watch(dateRange, (range) => {
  filters.dateFrom = range?.[0] ?? "";
  filters.dateTo = range?.[1] ?? "";
});

async function loadRecords(): Promise<void> {
  if (!store.account) return;
  loading.value = true;
  try {
    records.value = await gameRepository.listHandRecords(store.account.id);
  } finally {
    loading.value = false;
  }
}

onMounted(() => void loadRecords());
watch(
  () => store.account?.id,
  () => void loadRecords(),
);

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toLocaleString()}`;
}

function resetFilters(): void {
  dateRange.value = null;
  filters.position = "all";
  filters.startingHand = "";
  filters.playerLevel = "all";
  filters.tableResult = "all";
  filters.favoriteOnly = false;
}

function exportFilteredStatistics(): void {
  if (!store.account) return;
  const content = `\uFEFF${statisticsToCsv(filteredHands.value)}`;
  const blob = new globalThis.Blob([content], {
    type: "text/csv;charset=utf-8",
  });
  const url = globalThis.URL.createObjectURL(blob);
  const anchor = globalThis.document.createElement("a");
  anchor.href = url;
  anchor.download = `holdup-${store.account.name}-statistics-${Date.now()}.csv`;
  anchor.click();
  globalThis.URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="statistics-page">
    <header class="statistics-header">
      <div class="statistics-header__copy">
        <span class="statistics-header__eyebrow">{{
          store.account?.name
        }}</span>
        <div class="statistics-header__title-row">
          <h1 class="statistics-header__title">牌局统计</h1>
          <span class="statistics-header__version"
            >口径 v{{ STATISTICS_VERSION }}</span
          >
        </div>
      </div>
      <span class="statistics-header__sample">
        当前样本 {{ filteredHands.length }} / {{ analyzedHands.length }} 手
      </span>
      <el-button
        class="statistics-header__export"
        :icon="Download"
        :disabled="!filteredHands.length"
        @click="exportFilteredStatistics"
      >
        导出 CSV
      </el-button>
    </header>

    <section class="statistics-filters" aria-label="统计筛选">
      <label class="statistics-filter statistics-filter--date">
        <span class="statistics-filter__label">日期</span>
        <el-date-picker
          v-model="dateRange"
          class="statistics-filter__control statistics-filter__date-picker"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          unlink-panels
        />
      </label>
      <label class="statistics-filter">
        <span class="statistics-filter__label">位置</span>
        <el-select
          v-model="filters.position"
          class="statistics-filter__control"
        >
          <el-option label="全部位置" value="all" />
          <el-option
            v-for="option in positionOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </label>
      <label class="statistics-filter">
        <span class="statistics-filter__label">起手牌</span>
        <el-input
          v-model="filters.startingHand"
          class="statistics-filter__control"
          placeholder="例如 AKo、QQ"
          clearable
        />
      </label>
      <label class="statistics-filter">
        <span class="statistics-filter__label">当时等级</span>
        <el-select
          v-model="filters.playerLevel"
          class="statistics-filter__control"
        >
          <el-option label="全部等级" value="all" />
          <el-option
            v-for="level in availableLevels"
            :key="level"
            :label="`Lv.${level}`"
            :value="level"
          />
          <el-option label="未知（旧记录）" value="unknown" />
        </el-select>
      </label>
      <label class="statistics-filter">
        <span class="statistics-filter__label">离桌状态</span>
        <el-select
          v-model="filters.tableResult"
          class="statistics-filter__control"
        >
          <el-option label="全部" value="all" />
          <el-option label="正常进行" value="completed" />
          <el-option label="中途离桌" value="left" />
        </el-select>
      </label>
      <div class="statistics-filter statistics-filter--commands">
        <span class="statistics-filter__label">范围</span>
        <div class="statistics-filter__commands">
          <el-checkbox
            v-model="filters.favoriteOnly"
            class="statistics-filter__favorite"
          >
            仅收藏
          </el-checkbox>
          <el-button
            class="statistics-filter__reset"
            :icon="RotateCcw"
            title="重置筛选"
            aria-label="重置统计筛选"
            @click="resetFilters"
          />
        </div>
      </div>
    </section>

    <section
      v-loading="loading"
      class="statistics-summary"
      aria-label="关键指标"
      aria-live="polite"
    >
      <div
        v-for="metric in metricItems"
        :key="metric.label"
        class="statistics-metric"
        :class="metric.tone ? `statistics-metric--${metric.tone}` : undefined"
      >
        <span class="statistics-metric__label">{{ metric.label }}</span>
        <strong class="statistics-metric__value">{{ metric.value }}</strong>
      </div>
    </section>

    <section class="statistics-trend" aria-labelledby="statistics-trend-title">
      <header class="statistics-trend__header">
        <div class="statistics-trend__heading">
          <ChartColumnIncreasing
            class="statistics-trend__icon"
            :size="19"
            aria-hidden="true"
          />
          <h2 id="statistics-trend-title" class="statistics-trend__title">
            日期趋势
          </h2>
        </div>
        <span class="statistics-trend__count">{{ trend.length }} 天</span>
      </header>

      <div v-if="!trend.length" class="statistics-empty">
        <ChartColumnIncreasing
          class="statistics-empty__icon"
          :size="28"
          aria-hidden="true"
        />
        <strong class="statistics-empty__title">暂无符合条件的手牌</strong>
      </div>

      <ol v-else class="statistics-trend__list">
        <li
          v-for="entry in trend"
          :key="entry.date"
          class="statistics-trend__item"
        >
          <div class="statistics-trend__day">
            <strong class="statistics-trend__date">{{ entry.date }}</strong>
            <span class="statistics-trend__hands">{{ entry.hands }} 手</span>
          </div>
          <progress
            class="statistics-trend__bar"
            :class="{
              'statistics-trend__bar--profit': entry.netProfit >= 0,
              'statistics-trend__bar--loss': entry.netProfit < 0,
            }"
            :value="Math.abs(entry.netProfit)"
            :max="trendMaximum"
          >
            {{ Math.abs(entry.netProfit) }} / {{ trendMaximum }}
          </progress>
          <span
            class="statistics-trend__net"
            :class="{
              'statistics-trend__net--profit': entry.netProfit >= 0,
              'statistics-trend__net--loss': entry.netProfit < 0,
            }"
          >
            当日 {{ formatSigned(entry.netProfit) }}
          </span>
          <span class="statistics-trend__cumulative">
            累计 {{ formatSigned(entry.cumulativeNet) }}
          </span>
        </li>
      </ol>
    </section>
  </div>
</template>
