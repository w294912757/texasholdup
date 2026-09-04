<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Activity, ShieldCheck } from "@lucide/vue";
import { useAppStore } from "@/stores/app";
import { gameRepository } from "@/persistence/repository";
import type { HandHistoryRecord } from "@/persistence/database";
import { buildFairnessDiagnostics } from "@/domain/diagnostics";

const store = useAppStore();
const records = ref<HandHistoryRecord[]>([]);
const loading = ref(false);
const diagnostics = computed(() =>
  buildFairnessDiagnostics(store.account?.level ?? 1, records.value),
);

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

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatProfit(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toLocaleString()}`;
}
</script>

<template>
  <div class="diagnostics-page" v-loading="loading">
    <header class="diagnostics-header">
      <div class="diagnostics-header__copy">
        <span class="diagnostics-header__eyebrow">{{
          store.account?.name
        }}</span>
        <h1 class="diagnostics-header__title">AI 公平性诊断</h1>
      </div>
      <span class="diagnostics-header__status">只读聚合</span>
    </header>

    <section class="diagnostics-notice" aria-label="诊断边界">
      <ShieldCheck
        class="diagnostics-notice__icon"
        :size="18"
        aria-hidden="true"
      />
      <div class="diagnostics-notice__copy">
        <strong class="diagnostics-notice__title">仅用于平衡校准</strong>
        <span class="diagnostics-notice__description"
          >不影响经验、等级、筹码或奖励；数据来自固定种子模拟和当前账号本地记录。</span
        >
      </div>
    </section>

    <section
      class="diagnostics-section"
      aria-labelledby="diagnostics-match-title"
    >
      <header class="diagnostics-section__header">
        <div class="diagnostics-section__heading">
          <Activity
            class="diagnostics-section__icon"
            :size="18"
            aria-hidden="true"
          />
          <h2 id="diagnostics-match-title" class="diagnostics-section__title">
            匹配范围与抽样分布
          </h2>
        </div>
        <span class="diagnostics-section__meta"
          >固定种子 {{ diagnostics.sampleCount }} 个样本</span
        >
      </header>
      <div class="diagnostics-summary">
        <div class="diagnostics-summary__item">
          <span>当前等级</span><strong>Lv.{{ diagnostics.level }}</strong>
        </div>
        <div class="diagnostics-summary__item">
          <span>匹配范围</span
          ><strong
            >{{ diagnostics.matchingMinTier }} -
            {{ diagnostics.matchingMaxTier }} 档</strong
          >
        </div>
        <div class="diagnostics-summary__item">
          <span>总范围</span><strong>1 - 12 档</strong>
        </div>
      </div>
      <div class="diagnostics-distribution" aria-label="AI 难度抽样分布">
        <div
          v-for="item in diagnostics.difficultyDistribution"
          :key="item.tier"
          class="diagnostics-distribution__row"
        >
          <span class="diagnostics-distribution__tier">{{ item.tier }} 档</span>
          <progress
            class="diagnostics-distribution__bar"
            :value="item.ratio * 100"
            max="100"
          />
          <span class="diagnostics-distribution__value"
            >{{ item.count }} · {{ formatRate(item.ratio) }}</span
          >
        </div>
      </div>
    </section>

    <section
      class="diagnostics-section"
      aria-labelledby="diagnostics-behavior-title"
    >
      <header class="diagnostics-section__header">
        <h2 id="diagnostics-behavior-title" class="diagnostics-section__title">
          本地记录中的 AI 行为
        </h2>
        <span class="diagnostics-section__meta"
          >{{ diagnostics.analyzedHands }} 手</span
        >
      </header>
      <div v-if="!diagnostics.analyzedHands" class="diagnostics-empty">
        暂无足够本地记录
      </div>
      <div v-else class="diagnostics-behavior">
        <div class="diagnostics-action-list">
          <div
            v-for="item in diagnostics.actionBreakdown"
            :key="item.action"
            class="diagnostics-action-list__row"
          >
            <span class="diagnostics-action-list__label">{{ item.label }}</span>
            <progress
              class="diagnostics-action-list__bar"
              :value="item.ratio * 100"
              max="100"
            />
            <span class="diagnostics-action-list__value"
              >{{ item.count }} · {{ formatRate(item.ratio) }}</span
            >
          </div>
        </div>
        <dl class="diagnostics-metrics">
          <div class="diagnostics-metric">
            <dt>平均响应时间</dt>
            <dd>
              {{
                diagnostics.averageResponseMilliseconds === null
                  ? "暂无数据"
                  : `${diagnostics.averageResponseMilliseconds} ms（近似）`
              }}
            </dd>
          </div>
          <div class="diagnostics-metric">
            <dt>AI 离场率</dt>
            <dd>{{ formatRate(diagnostics.aiDepartureRate) }}</dd>
          </div>
          <div class="diagnostics-metric">
            <dt>长期净盈利</dt>
            <dd>{{ formatProfit(diagnostics.netProfit) }}</dd>
          </div>
          <div class="diagnostics-metric">
            <dt>玩家胜率</dt>
            <dd>{{ formatRate(diagnostics.winRate) }}</dd>
          </div>
        </dl>
      </div>
    </section>
  </div>
</template>
