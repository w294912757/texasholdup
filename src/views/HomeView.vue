<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  CircleDollarSign,
  List,
  Play,
  RotateCcw,
  ShieldCheck,
  Trophy,
  Users,
} from "@lucide/vue";
import { useAppStore } from "@/stores/app";
import type { GameConfig } from "@/domain/types";
import { gameRepository } from "@/persistence/repository";
import type { ProgressionRecord } from "@/persistence/database";

const store = useAppStore();
const router = useRouter();
const downgradeDialogVisible = ref(false);
const progressionDialogVisible = ref(false);
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
          <span class="profile-metric__label">升级进度</span>
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
  </div>
</template>
