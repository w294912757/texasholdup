<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  GraduationCap,
  Play,
  RotateCcw,
  Target,
  XCircle,
} from "@lucide/vue";
import PlayingCard from "@/components/PlayingCard.vue";
import {
  advanceTrainingSession,
  createTrainingSession,
  getTrainingRecommendation,
  submitTrainingAnswer,
  trainingAccuracy,
  type TrainingErrorType,
  type TrainingSession,
} from "@/domain/training";
import type { PlayerActionType } from "@/domain/types";
import { gameRepository } from "@/persistence/repository";
import { useAppStore } from "@/stores/app";

const store = useAppStore();
const router = useRouter();
const session = ref<TrainingSession | null>(null);
const challengeLength = ref<10 | 20>(10);
const selectedAction = ref<PlayerActionType | null>(null);
const targetAmount = ref<number | undefined>();
const loading = ref(false);

const question = computed(
  () => session.value?.questions[session.value.currentIndex] ?? null,
);
const answer = computed(() => {
  if (!session.value || !question.value) return null;
  return (
    session.value.answers.find(
      (item) => item.questionId === question.value?.id,
    ) ?? null
  );
});
const accuracy = computed(() =>
  session.value ? trainingAccuracy(session.value) : 0,
);
const selectedOption = computed(() =>
  question.value?.legalActions.find(
    (item) => item.type === selectedAction.value,
  ),
);
const requiresTarget = computed(
  () => selectedAction.value === "bet" || selectedAction.value === "raise",
);
const recommendation = computed(() =>
  question.value ? getTrainingRecommendation(question.value) : null,
);

function isRecommendedAction(action: PlayerActionType): boolean {
  return Boolean(
    answer.value && recommendation.value?.actionTypes.includes(action),
  );
}

function isIncorrectSelection(action: PlayerActionType): boolean {
  return Boolean(
    answer.value &&
    answer.value.action === action &&
    !recommendation.value?.actionTypes.includes(action),
  );
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function phaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    preflop: "翻牌前",
    flop: "翻牌",
    turn: "转牌",
    river: "河牌",
  };
  return labels[phase] ?? phase;
}

function errorLabel(errorType: TrainingErrorType): string {
  const labels: Record<TrainingErrorType, string> = {
    none: "选择符合参考策略",
    "odds-miss": "未满足底池赔率",
    "too-passive": "行动偏保守",
    "too-aggressive": "行动偏激进",
    sizing: "下注尺度不合理",
  };
  return labels[errorType];
}

function resetSelection(): void {
  selectedAction.value = null;
  targetAmount.value = undefined;
}

async function loadTraining(): Promise<void> {
  if (!store.account) return;
  loading.value = true;
  try {
    const active = await gameRepository.loadActiveTraining(store.account.id);
    session.value =
      active ??
      (await gameRepository.listTrainingSessions(store.account.id))[0] ??
      null;
    resetSelection();
  } catch (error) {
    ElMessage.error(
      error instanceof Error ? error.message : "训练进度读取失败",
    );
  } finally {
    loading.value = false;
  }
}

async function startChallenge(force = false): Promise<void> {
  if (!store.account || loading.value) return;
  if (session.value?.status === "active" && !force) {
    try {
      await ElMessageBox.confirm(
        "重新开始会放弃当前未完成的训练进度，但不会影响正式筹码和等级。",
        "重新开始训练",
        {
          confirmButtonText: "重新开始",
          cancelButtonText: "继续当前训练",
          type: "warning",
        },
      );
    } catch {
      return;
    }
  }
  loading.value = true;
  try {
    const history = await gameRepository.listHandRecords(store.account.id);
    session.value = await gameRepository.startTrainingSession(
      createTrainingSession(store.account.id, challengeLength.value, history),
    );
    resetSelection();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "无法开始训练");
  } finally {
    loading.value = false;
  }
}

function chooseAction(action: PlayerActionType): void {
  if (answer.value) return;
  selectedAction.value = action;
  const option = question.value?.legalActions.find(
    (item) => item.type === action,
  );
  targetAmount.value =
    action === "bet" || action === "raise" ? option?.minTarget : undefined;
}

async function submitAnswer(): Promise<void> {
  if (!session.value || !selectedAction.value || loading.value) return;
  loading.value = true;
  try {
    const answered = submitTrainingAnswer(
      session.value,
      selectedAction.value,
      targetAmount.value,
    );
    session.value = await gameRepository.saveTrainingSession(answered);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "答案提交失败");
  } finally {
    loading.value = false;
  }
}

async function nextQuestion(): Promise<void> {
  if (!session.value || loading.value) return;
  loading.value = true;
  try {
    session.value = await gameRepository.saveTrainingSession(
      advanceTrainingSession(session.value),
    );
    resetSelection();
  } catch (error) {
    ElMessage.error(
      error instanceof Error ? error.message : "训练进度保存失败",
    );
  } finally {
    loading.value = false;
  }
}

onMounted(() => void loadTraining());
watch(
  () => store.account?.id,
  () => void loadTraining(),
);
</script>

<template>
  <div class="training-page">
    <header class="training-header">
      <div class="training-header__copy">
        <span class="training-header__eyebrow">本地训练</span>
        <h1 class="training-header__title">决策训练</h1>
      </div>
      <div class="training-header__commands">
        <span v-if="store.session" class="training-header__saved"
          >正式牌局现场已保存</span
        >
        <el-button
          v-if="store.session"
          class="training-header__game"
          :icon="Play"
          @click="router.push('/game')"
        >
          返回牌局
        </el-button>
      </div>
    </header>

    <section
      v-if="!session"
      class="training-setup"
      aria-labelledby="training-setup-title"
    >
      <div class="training-setup__copy">
        <GraduationCap
          class="training-setup__icon"
          :size="28"
          aria-hidden="true"
        />
        <div class="training-setup__heading">
          <h2 id="training-setup-title" class="training-setup__title">
            选择挑战长度
          </h2>
          <p class="training-setup__description">
            题目来自固定题库和当前账号已完成牌局，不产生筹码、经验或等级变化。
          </p>
        </div>
      </div>
      <el-segmented
        v-model="challengeLength"
        class="training-setup__length"
        :options="[
          { label: '10 题', value: 10 },
          { label: '20 题', value: 20 },
        ]"
      />
      <el-button
        class="training-setup__start"
        type="primary"
        :icon="Play"
        :loading="loading"
        @click="startChallenge(true)"
      >
        开始训练
      </el-button>
    </section>

    <section
      v-else-if="session.status === 'complete'"
      class="training-complete"
      aria-labelledby="training-complete-title"
    >
      <CheckCircle2
        class="training-complete__icon"
        :size="34"
        aria-hidden="true"
      />
      <h2 id="training-complete-title" class="training-complete__title">
        本次训练完成
      </h2>
      <div class="training-complete__metrics">
        <div class="training-complete__metric">
          <span class="training-complete__label">完成题数</span>
          <strong class="training-complete__value">{{
            session.answers.length
          }}</strong>
        </div>
        <div class="training-complete__metric">
          <span class="training-complete__label">正确率</span>
          <strong class="training-complete__value">{{
            formatPercent(accuracy)
          }}</strong>
        </div>
        <div class="training-complete__metric">
          <span class="training-complete__label">平均用时</span>
          <strong class="training-complete__value">
            {{
              Math.round(
                session.answers.reduce((sum, item) => sum + item.elapsedMs, 0) /
                  Math.max(1, session.answers.length) /
                  1000,
              )
            }}
            秒
          </strong>
        </div>
      </div>
      <div class="training-complete__commands">
        <el-segmented
          v-model="challengeLength"
          class="training-complete__length"
          :options="[
            { label: '10 题', value: 10 },
            { label: '20 题', value: 20 },
          ]"
        />
        <el-button
          class="training-complete__restart"
          type="primary"
          :icon="RotateCcw"
          :loading="loading"
          @click="startChallenge(true)"
        >
          新的挑战
        </el-button>
      </div>
    </section>

    <template v-else-if="question">
      <section class="training-progress" aria-label="训练进度">
        <div class="training-progress__heading">
          <strong class="training-progress__step"
            >第 {{ session.currentIndex + 1 }} / {{ session.length }} 题</strong
          >
          <span class="training-progress__source">{{
            question.source === "history" ? "历史局面" : "固定题库"
          }}</span>
        </div>
        <el-progress
          class="training-progress__bar"
          :percentage="
            Math.round((session.answers.length / session.length) * 100)
          "
          :show-text="false"
        />
      </section>

      <main class="training-workspace">
        <section
          class="training-scenario"
          aria-labelledby="training-scenario-title"
        >
          <header class="training-scenario__header">
            <div class="training-scenario__title-row">
              <Target
                class="training-scenario__title-icon"
                :size="18"
                aria-hidden="true"
              />
              <h2 id="training-scenario-title" class="training-scenario__title">
                {{ phaseLabel(question.phase) }}决策
              </h2>
            </div>
            <span class="training-scenario__position">{{
              question.position
            }}</span>
          </header>

          <div class="training-scenario__cards">
            <div class="training-scenario__card-group">
              <span class="training-scenario__card-label">你的底牌</span>
              <div class="training-scenario__hole-cards">
                <PlayingCard
                  v-for="card in question.holeCards"
                  :key="card"
                  :card="card"
                />
              </div>
            </div>
            <div
              class="training-scenario__card-group training-scenario__card-group--board"
            >
              <span class="training-scenario__card-label">公共牌</span>
              <div
                v-if="question.board.length"
                class="training-scenario__board"
              >
                <PlayingCard
                  v-for="card in question.board"
                  :key="card"
                  :card="card"
                  compact
                />
              </div>
              <span v-else class="training-scenario__preflop">翻牌前</span>
            </div>
          </div>

          <dl class="training-scenario__facts">
            <div class="training-scenario__fact">
              <dt class="training-scenario__fact-label">当前底池</dt>
              <dd class="training-scenario__fact-value">{{ question.pot }}</dd>
            </div>
            <div class="training-scenario__fact">
              <dt class="training-scenario__fact-label">需要跟注</dt>
              <dd class="training-scenario__fact-value">
                {{ question.callAmount }}
              </dd>
            </div>
            <div class="training-scenario__fact">
              <dt class="training-scenario__fact-label">有效筹码</dt>
              <dd class="training-scenario__fact-value">
                {{ question.effectiveStack }}
              </dd>
            </div>
          </dl>
        </section>

        <section
          class="training-decision"
          aria-labelledby="training-decision-title"
        >
          <h2 id="training-decision-title" class="training-decision__title">
            选择行动
          </h2>
          <div class="training-decision__actions">
            <el-button
              v-for="option in question.legalActions"
              :key="option.type"
              class="training-decision__action"
              :class="{
                'training-decision__action--selected':
                  (selectedAction ?? answer?.action) === option.type,
                'training-decision__action--correct': isRecommendedAction(
                  option.type,
                ),
                'training-decision__action--incorrect': isIncorrectSelection(
                  option.type,
                ),
              }"
              :disabled="Boolean(answer)"
              @click="chooseAction(option.type)"
            >
              {{ option.label }}
              <span
                v-if="isRecommendedAction(option.type)"
                class="training-decision__answer-label"
              >
                正确答案
              </span>
              <span
                v-else-if="isIncorrectSelection(option.type)"
                class="training-decision__answer-label training-decision__answer-label--incorrect"
              >
                你的选择
              </span>
            </el-button>
          </div>
          <label v-if="requiresTarget" class="training-decision__sizing">
            <span class="training-decision__sizing-label">目标投入</span>
            <el-input-number
              v-model="targetAmount"
              class="training-decision__sizing-input"
              :min="selectedOption?.minTarget"
              :max="selectedOption?.maxTarget"
              :disabled="Boolean(answer)"
              controls-position="right"
            />
          </label>
          <el-button
            class="training-decision__submit"
            type="primary"
            :loading="loading"
            :disabled="!selectedAction || Boolean(answer)"
            @click="submitAnswer"
          >
            提交答案
          </el-button>

          <section
            v-if="answer"
            class="training-feedback"
            aria-labelledby="training-feedback-title"
          >
            <header
              class="training-feedback__header"
              :class="{
                'training-feedback__header--incorrect': !answer.correct,
              }"
            >
              <CheckCircle2
                v-if="answer.correct"
                class="training-feedback__status-icon"
                :size="20"
                aria-hidden="true"
              />
              <XCircle
                v-else
                class="training-feedback__status-icon"
                :size="20"
                aria-hidden="true"
              />
              <div class="training-feedback__status-copy">
                <h3
                  id="training-feedback-title"
                  class="training-feedback__title"
                >
                  {{ answer.correct ? "符合参考策略" : "建议复盘这个选择" }}
                </h3>
                <span class="training-feedback__error">{{
                  errorLabel(answer.errorType)
                }}</span>
              </div>
              <span class="training-feedback__time">
                <Clock
                  class="training-feedback__time-icon"
                  :size="14"
                  aria-hidden="true"
                />
                {{ Math.round(answer.elapsedMs / 1000) }} 秒
              </span>
            </header>
            <div class="training-feedback__metrics">
              <span class="training-feedback__metric"
                >估算权益
                <strong>{{ formatPercent(question.equity) }}</strong></span
              >
              <span class="training-feedback__metric"
                >底池赔率
                <strong>{{ formatPercent(question.potOdds) }}</strong></span
              >
            </div>
            <div class="training-feedback__mix">
              <span
                v-for="item in question.referenceMix"
                :key="item.type"
                class="training-feedback__mix-item"
              >
                {{ item.label }} {{ item.frequency }}%
              </span>
            </div>
            <p class="training-feedback__explanation">
              {{ question.explanation }}
            </p>
            <div v-if="recommendation" class="training-feedback__reason">
              <strong class="training-feedback__reason-title">
                为什么推荐{{ recommendation.actionLabels.join("或") }}
              </strong>
              <p class="training-feedback__reason-copy">
                {{ recommendation.reason }}
              </p>
            </div>
            <el-button
              class="training-feedback__next"
              type="primary"
              :icon="ArrowRight"
              :loading="loading"
              @click="nextQuestion"
            >
              {{
                session.currentIndex + 1 >= session.length
                  ? "查看结果"
                  : "下一题"
              }}
            </el-button>
          </section>
        </section>
      </main>

      <el-button
        class="training-restart"
        text
        :icon="RotateCcw"
        @click="startChallenge()"
      >
        重新开始训练
      </el-button>
    </template>
  </div>
</template>
