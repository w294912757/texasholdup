<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  ChartColumnIncreasing,
  CircleHelp,
  CircleDollarSign,
  List,
  Play,
  RotateCcw,
  ShieldCheck,
  Settings,
  Trophy,
  Users,
} from "@lucide/vue";
import { useAppStore } from "@/stores/app";
import type { GameConfig } from "@/domain/types";
import {
  AI_DIFFICULTY_GROUPS,
  getAiMatchingGuide,
  MAX_AI_TIER,
  MIN_AI_TIER,
} from "@/domain/matching";
import { gameRepository } from "@/persistence/repository";
import type { ProgressionRecord } from "@/persistence/database";

const store = useAppStore();
const router = useRouter();
const downgradeDialogVisible = ref(false);
const progressionDialogVisible = ref(false);
const progressionHelpVisible = ref(false);
const progressionHelpTab = ref("matching");
const progressionRecords = ref<ProgressionRecord[]>([]);
const downgradeTarget = ref(1);
const form = reactive({
  aiCount: 5,
  buyIn: 1_000,
  blinds: "10/20",
});

const maximumBuyIn = computed(() =>
  Math.max(500, store.account?.bankroll ?? 500),
);
const levelOptions = computed(() =>
  Array.from(
    { length: Math.max(0, (store.account?.level ?? 1) - 1) },
    (_, index) => index + 1,
  ),
);
const aiMatchingGuide = computed(() =>
  getAiMatchingGuide(store.account?.level ?? 1),
);

function tierRange(tiers: number[]): string {
  if (!tiers.length) return "当前无可用档位";
  if (tiers.length === 1) return `${tiers[0]} 档`;
  return `${tiers[0]}–${tiers.at(-1)} 档`;
}

function matchingProbability(probability: number): string {
  return `${Math.round(probability * 100)}%`;
}

function openProgressionHelp(): void {
  progressionHelpTab.value = "matching";
  progressionHelpVisible.value = true;
}

async function beginMatch(): Promise<void> {
  const [smallBlind, bigBlind] = form.blinds.split("/").map(Number);
  const config: GameConfig = {
    aiCount: form.aiCount,
    buyIn: form.buyIn,
    smallBlind: smallBlind ?? 10,
    bigBlind: bigBlind ?? 20,
    maxHands: 20,
  };
  try {
    await store.startGame(config);
    await router.push("/game");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "无法开始匹配");
  }
}

async function confirmDowngrade(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `降到 ${downgradeTarget.value} 级会清空当前等级经验，且不能手动恢复。`,
      "确认降级",
      {
        confirmButtonText: "确认降级",
        cancelButtonText: "取消",
        type: "warning",
      },
    );
    await store.downgrade(downgradeTarget.value);
    progressionRecords.value = await gameRepository.listProgression(
      store.account!.id,
    );
    downgradeDialogVisible.value = false;
  } catch (error) {
    if (error !== "cancel")
      ElMessage.error(error instanceof Error ? error.message : "降级失败");
  }
}

async function openProgression(): Promise<void> {
  if (!store.account) return;
  progressionRecords.value = await gameRepository.listProgression(
    store.account.id,
  );
  progressionDialogVisible.value = true;
}
</script>

<template>
  <div class="home-page">
    <section class="profile-overview" aria-labelledby="profile-title">
      <div class="profile-overview__identity">
        <span class="profile-overview__eyebrow">当前账号</span>
        <h1 id="profile-title" class="profile-overview__name">
          {{ store.account?.name }}
        </h1>
      </div>
      <div class="profile-overview__metrics">
        <div class="profile-metric">
          <Trophy class="profile-metric__icon" :size="19" aria-hidden="true" />
          <span class="profile-metric__label">等级</span>
          <strong class="profile-metric__value"
            >Lv.{{ store.account?.level }}</strong
          >
        </div>
        <div class="profile-metric">
          <CircleDollarSign
            class="profile-metric__icon"
            :size="19"
            aria-hidden="true"
          />
          <span class="profile-metric__label">可用筹码</span>
          <strong class="profile-metric__value">{{
            store.account?.bankroll.toLocaleString()
          }}</strong>
        </div>
        <div class="profile-metric profile-metric--experience">
          <ShieldCheck
            class="profile-metric__icon"
            :size="19"
            aria-hidden="true"
          />
          <span class="profile-metric__label-row">
            <span class="profile-metric__label">升级进度</span>
            <button
              class="profile-metric__help"
              type="button"
              title="经验与升级规则"
              aria-label="查看经验与升级规则"
              @click="openProgressionHelp"
            >
              <CircleHelp
                class="profile-metric__help-icon"
                :size="15"
                aria-hidden="true"
              />
            </button>
          </span>
          <el-progress
            class="profile-metric__progress"
            :percentage="store.levelProgress"
            :show-text="false"
          />
          <strong class="profile-metric__value"
            >{{ store.account?.currentLevelXp }} XP</strong
          >
        </div>
      </div>
      <div class="profile-overview__commands">
        <el-button
          class="profile-overview__command"
          :icon="Settings"
          @click="router.push('/settings')"
        >
          游戏设置
        </el-button>
        <el-button
          class="profile-overview__command"
          :icon="ChartColumnIncreasing"
          @click="router.push('/statistics')"
        >
          牌局统计
        </el-button>
        <el-button
          class="profile-overview__command"
          :icon="List"
          @click="openProgression"
        >
          等级记录
        </el-button>
        <el-button
          class="profile-overview__command"
          :icon="RotateCcw"
          :disabled="(store.account?.level ?? 1) <= 1"
          @click="downgradeDialogVisible = true"
        >
          手动降级
        </el-button>
      </div>
    </section>

    <section
      v-if="store.session"
      class="resume-session"
      aria-labelledby="resume-title"
    >
      <div class="resume-session__content">
        <span class="resume-session__status">已找到自动保存的牌桌</span>
        <h2 id="resume-title" class="resume-session__title">
          第 {{ store.session.currentHand.number }} / 20 手牌
        </h2>
        <p class="resume-session__description">
          现场已恢复到行动序号
          {{ store.session.currentHand.actionSeq }}，不会重新洗牌。
        </p>
      </div>
      <el-button
        class="resume-session__button"
        type="primary"
        :icon="Play"
        @click="router.push('/game')"
      >
        继续牌局
      </el-button>
    </section>

    <section v-else class="match-setup" aria-labelledby="match-title">
      <div class="match-setup__heading">
        <div class="match-setup__heading-copy">
          <span class="match-setup__eyebrow">新牌桌</span>
          <h2 id="match-title" class="match-setup__title">开始匹配</h2>
        </div>
        <span class="match-setup__privacy">对手强度已隐藏</span>
      </div>

      <el-form
        class="match-form"
        label-position="top"
        @submit.prevent="beginMatch"
      >
        <el-form-item class="match-form__field" label="AI 对手数量">
          <el-segmented
            v-model="form.aiCount"
            class="match-form__segmented"
            :options="[1, 2, 3, 4, 5]"
          />
        </el-form-item>
        <el-form-item class="match-form__field" label="入桌买入">
          <el-input-number
            v-model="form.buyIn"
            class="match-form__number"
            :min="500"
            :max="maximumBuyIn"
            :step="100"
            controls-position="right"
          />
        </el-form-item>
        <el-form-item class="match-form__field" label="盲注结构">
          <el-select v-model="form.blinds" class="match-form__select">
            <el-option class="match-form__option" label="5 / 10" value="5/10" />
            <el-option
              class="match-form__option"
              label="10 / 20"
              value="10/20"
            />
            <el-option
              class="match-form__option"
              label="25 / 50"
              value="25/50"
            />
          </el-select>
        </el-form-item>
        <div class="match-form__summary">
          <Users
            class="match-form__summary-icon"
            :size="18"
            aria-hidden="true"
          />
          <span class="match-form__summary-text"
            >{{ form.aiCount + 1 }} 人桌 · 20 手牌 · 自动保存</span
          >
        </div>
        <el-button
          class="match-form__submit"
          type="primary"
          native-type="submit"
          :loading="store.busy"
          :icon="Play"
        >
          匹配入桌
        </el-button>
      </el-form>
    </section>

    <el-dialog
      v-model="downgradeDialogVisible"
      class="downgrade-dialog"
      title="手动降级"
      width="min(420px, 90vw)"
    >
      <el-select v-model="downgradeTarget" class="downgrade-dialog__select">
        <el-option
          v-for="level in levelOptions"
          :key="level"
          class="downgrade-dialog__option"
          :label="`等级 ${level}`"
          :value="level"
        />
      </el-select>
      <p class="downgrade-dialog__notice">
        降级会影响后续 AI 匹配概率，并清空当前等级经验。
      </p>
      <template #footer>
        <div class="downgrade-dialog__commands">
          <el-button
            class="downgrade-dialog__button"
            @click="downgradeDialogVisible = false"
            >取消</el-button
          >
          <el-button
            class="downgrade-dialog__button"
            type="warning"
            @click="confirmDowngrade"
            >确认降级</el-button
          >
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="progressionDialogVisible"
      class="progression-dialog"
      title="等级记录"
      width="min(560px, 92vw)"
    >
      <div v-if="!progressionRecords.length" class="progression-dialog__empty">
        暂无等级变化
      </div>
      <el-table
        v-else
        class="progression-dialog__table"
        :data="progressionRecords"
      >
        <el-table-column label="类型" width="90">
          <template #default="scope">
            <span
              class="progression-dialog__type"
              :class="{
                'progression-dialog__type--downgrade':
                  scope.row.type === 'downgrade',
              }"
            >
              {{ scope.row.type === "experience" ? "经验结算" : "手动降级" }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="经验" width="80">
          <template #default="scope">
            {{
              scope.row.experience > 0
                ? `+${scope.row.experience}`
                : scope.row.experience
            }}
          </template>
        </el-table-column>
        <el-table-column label="等级变化" width="110">
          <template #default="scope">
            Lv.{{ scope.row.levelBefore }} → Lv.{{ scope.row.levelAfter }}
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="时间" min-width="180" />
      </el-table>
    </el-dialog>

    <el-dialog
      v-model="progressionHelpVisible"
      class="progression-help-dialog"
      title="等级与匹配说明"
      width="min(660px, 94vw)"
    >
      <el-tabs
        v-model="progressionHelpTab"
        class="progression-help-dialog__tabs"
      >
        <el-tab-pane label="AI 匹配" name="matching">
          <div class="ai-matching-guide">
            <div class="ai-matching-guide__summary">
              <div class="ai-matching-guide__summary-item">
                <span class="ai-matching-guide__summary-label">当前等级</span>
                <strong class="ai-matching-guide__summary-value">
                  Lv.{{ aiMatchingGuide.playerLevel }}
                </strong>
              </div>
              <div class="ai-matching-guide__summary-item">
                <span class="ai-matching-guide__summary-label"
                  >当前可匹配范围</span
                >
                <strong class="ai-matching-guide__summary-value">
                  {{ aiMatchingGuide.minimumTier }}–{{
                    aiMatchingGuide.maximumTier
                  }}
                  档
                </strong>
              </div>
              <div class="ai-matching-guide__summary-item">
                <span class="ai-matching-guide__summary-label"
                  >完整难度范围</span
                >
                <strong class="ai-matching-guide__summary-value">
                  {{ MIN_AI_TIER }}–{{ MAX_AI_TIER }} 档
                </strong>
              </div>
            </div>

            <p class="ai-matching-guide__explanation">
              当前匹配池会随玩家等级逐步上移，并保留偏弱、接近和少量偏强对手；不会在初始等级直接抽取最高难度。
              多人桌若全部抽中同一相对区间，最后一席会调整到其他可用区间。
              <span
                v-if="
                  aiMatchingGuide.scaleLevel !== aiMatchingGuide.playerLevel
                "
                class="ai-matching-guide__scale-note"
              >
                当前按最高 Lv.{{ aiMatchingGuide.scaleLevel }} 难度标尺计算。
              </span>
            </p>

            <section
              class="ai-matching-guide__section"
              aria-labelledby="matching-distribution-title"
            >
              <h3
                id="matching-distribution-title"
                class="ai-matching-guide__section-title"
              >
                本级基础抽取概率
              </h3>
              <div class="ai-matching-guide__bands">
                <div
                  v-for="band in aiMatchingGuide.bands"
                  :key="band.band"
                  class="ai-matching-guide__band"
                  :class="`ai-matching-guide__band--${band.band}`"
                >
                  <span class="ai-matching-guide__band-label">{{
                    band.label
                  }}</span>
                  <strong class="ai-matching-guide__band-probability">{{
                    matchingProbability(band.probability)
                  }}</strong>
                  <span class="ai-matching-guide__band-range">{{
                    tierRange(band.tiers)
                  }}</span>
                </div>
              </div>
            </section>

            <section
              class="ai-matching-guide__section"
              aria-labelledby="difficulty-scale-title"
            >
              <h3
                id="difficulty-scale-title"
                class="ai-matching-guide__section-title"
              >
                AI 难度说明
              </h3>
              <div class="ai-matching-guide__levels">
                <div
                  v-for="group in AI_DIFFICULTY_GROUPS"
                  :key="group.label"
                  class="ai-matching-guide__level"
                >
                  <span class="ai-matching-guide__level-range">
                    {{ group.minTier }}–{{ group.maxTier }} 档
                  </span>
                  <strong class="ai-matching-guide__level-name">{{
                    group.label
                  }}</strong>
                  <p class="ai-matching-guide__level-description">
                    {{ group.description }}
                  </p>
                </div>
              </div>
            </section>

            <p class="ai-matching-guide__privacy">
              为保持信息公平，牌桌和对局记录不会显示任何 AI 的实际档位。
            </p>
          </div>
        </el-tab-pane>
        <el-tab-pane label="经验规则" name="experience">
          <dl class="progression-help-dialog__rules">
            <div class="progression-help-dialog__rule">
              <dt class="progression-help-dialog__term">结算条件</dt>
              <dd class="progression-help-dialog__description">
                正常完成 20 手牌且本场净盈利大于 0
                时结算经验。中途离桌、零盈利或亏损均不获得经验。
              </dd>
            </div>
            <div class="progression-help-dialog__rule">
              <dt class="progression-help-dialog__term">经验公式</dt>
              <dd class="progression-help-dialog__description">
                经验 = 向下取整（净盈利 ÷ 10）+ 完成手数 ×
                2。满足结算条件时每场最低 25 XP，最高 500 XP。
              </dd>
            </div>
            <div class="progression-help-dialog__rule">
              <dt class="progression-help-dialog__term">升级阈值</dt>
              <dd class="progression-help-dialog__description">
                当前等级所需经验为“当前等级 × 100
                XP”。达到阈值后自动升级，多余经验会继续用于后续等级。
              </dd>
            </div>
            <div class="progression-help-dialog__rule">
              <dt class="progression-help-dialog__term">等级影响</dt>
              <dd class="progression-help-dialog__description">
                等级只调整匹配到不同水平 AI
                的概率，不会直接指定整桌对手强度，界面也不会公开 AI 难度。
              </dd>
            </div>
            <div class="progression-help-dialog__rule">
              <dt class="progression-help-dialog__term">手动降级</dt>
              <dd class="progression-help-dialog__description">
                只能选择低于当前等级的级别。降级会清空当前等级经验，之后只能通过获得经验再次自动升级。
              </dd>
            </div>
          </dl>
        </el-tab-pane>
      </el-tabs>
    </el-dialog>
  </div>
</template>
