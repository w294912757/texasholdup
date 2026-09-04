<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { Activity } from "@lucide/vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { useAppStore } from "@/stores/app";
import type { GameSettings } from "@/domain/settings";

const store = useAppStore();
const router = useRouter();
const saving = ref(false);
const form = reactive<GameSettings>({ ...store.settings });

watch(
  () => store.settings,
  (settings) => Object.assign(form, settings),
  { deep: true },
);

onMounted(() => Object.assign(form, store.settings));

async function saveSettings<K extends keyof GameSettings>(
  key: K,
  value: GameSettings[K],
): Promise<void> {
  saving.value = true;
  try {
    await store.updateSettings({ [key]: value });
    ElMessage.success("设置已保存");
  } catch (error) {
    Object.assign(form, store.settings);
    ElMessage.error(error instanceof Error ? error.message : "设置保存失败");
  } finally {
    saving.value = false;
  }
}

function updateAnimationSpeed(value: GameSettings["animationSpeed"]): void {
  void saveSettings("animationSpeed", value);
}

function updateThinkingTime(value: GameSettings["aiThinkingTime"]): void {
  void saveSettings("aiThinkingTime", value);
}

function updateReplaySpeed(value: GameSettings["replaySpeed"]): void {
  void saveSettings("replaySpeed", value);
}

function updateBoolean(
  key: "soundEnabled" | "musicEnabled" | "beginnerHints",
  value: boolean,
): void {
  void saveSettings(key, value);
}

function updateVolume(value: number): void {
  void saveSettings("volume", value);
}

function updateCardStyle(value: GameSettings["cardStyle"]): void {
  void saveSettings("cardStyle", value);
}

function updateDisplayDensity(value: GameSettings["displayDensity"]): void {
  void saveSettings("displayDensity", value);
}

function updateSafetyBoolean(
  key: "confirmAllIn" | "confirmLargeBet" | "confirmLeaveTable",
  value: boolean,
): void {
  void saveSettings(key, value);
}
</script>

<template>
  <div class="settings-page">
    <header class="settings-header">
      <div class="settings-header__copy">
        <span class="settings-header__eyebrow">{{ store.account?.name }}</span>
        <h1 class="settings-header__title">游戏设置</h1>
      </div>
      <span v-if="saving" class="settings-header__status">正在保存</span>
      <span v-else class="settings-header__status">自动保存</span>
    </header>

    <section class="settings-section" aria-labelledby="settings-play-title">
      <header class="settings-section__header">
        <h2 id="settings-play-title" class="settings-section__title">
          对局体验
        </h2>
        <span class="settings-section__description"
          >仅影响当前账号和本机体验</span
        >
      </header>
      <div class="settings-list">
        <div class="settings-row">
          <div class="settings-row__copy">
            <strong class="settings-row__label">动画速度</strong>
            <span class="settings-row__description"
              >控制牌桌状态切换的动效节奏。</span
            >
          </div>
          <el-segmented
            v-model="form.animationSpeed"
            class="settings-row__control"
            :options="[
              { label: '减少', value: 'reduced' },
              { label: '标准', value: 'normal' },
              { label: '快速', value: 'fast' },
            ]"
            @change="updateAnimationSpeed"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row__copy">
            <strong class="settings-row__label">AI 思考时间</strong>
            <span class="settings-row__description"
              >控制 AI 每次决策前的等待时间。</span
            >
          </div>
          <el-select
            v-model="form.aiThinkingTime"
            class="settings-row__control"
            @change="updateThinkingTime"
          >
            <el-option label="即时" :value="0" />
            <el-option label="标准" :value="360" />
            <el-option label="从容" :value="800" />
          </el-select>
        </div>
        <div class="settings-row">
          <div class="settings-row__copy">
            <strong class="settings-row__label">回放默认速度</strong>
            <span class="settings-row__description"
              >保留给逐行动回放自动播放的默认节奏。</span
            >
          </div>
          <el-select
            v-model="form.replaySpeed"
            class="settings-row__control"
            @change="updateReplaySpeed"
          >
            <el-option label="慢速" value="slow" />
            <el-option label="标准" value="normal" />
            <el-option label="快速" value="fast" />
          </el-select>
        </div>
        <div class="settings-row">
          <div class="settings-row__copy">
            <strong class="settings-row__label">牌面样式</strong>
            <span class="settings-row__description"
              >高对比样式会增强牌面边界和颜色区分。</span
            >
          </div>
          <el-segmented
            v-model="form.cardStyle"
            class="settings-row__control"
            :options="[
              { label: '经典', value: 'classic' },
              { label: '高对比', value: 'high-contrast' },
            ]"
            @change="updateCardStyle"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row__copy">
            <strong class="settings-row__label">显示密度</strong>
            <span class="settings-row__description"
              >标准保留完整信息，紧凑减少留白，竖屏将牌局改为纵向阅读。</span
            >
          </div>
          <el-segmented
            v-model="form.displayDensity"
            class="settings-row__control settings-row__density"
            :options="[
              { label: '标准', value: 'standard' },
              { label: '紧凑', value: 'compact' },
              { label: '竖屏', value: 'portrait' },
            ]"
            @change="updateDisplayDensity"
          />
        </div>
      </div>
    </section>

    <section class="settings-section" aria-labelledby="settings-safety-title">
      <header class="settings-section__header">
        <h2 id="settings-safety-title" class="settings-section__title">
          操作保护
        </h2>
        <span class="settings-section__description">高风险操作二次确认</span>
      </header>
      <div class="settings-list">
        <div class="settings-row">
          <div class="settings-row__copy">
            <strong class="settings-row__label">全下确认</strong>
            <span class="settings-row__description"
              >提交全下前显示筹码影响</span
            >
          </div>
          <el-switch
            v-model="form.confirmAllIn"
            class="settings-row__control"
            aria-label="全下确认"
            @change="updateSafetyBoolean('confirmAllIn', Boolean($event))"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row__copy">
            <strong class="settings-row__label">大额下注确认</strong>
            <span class="settings-row__description"
              >新增投入达到可用筹码一半时确认</span
            >
          </div>
          <el-switch
            v-model="form.confirmLargeBet"
            class="settings-row__control"
            aria-label="大额下注确认"
            @change="updateSafetyBoolean('confirmLargeBet', Boolean($event))"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row__copy">
            <strong class="settings-row__label">离桌确认</strong>
            <span class="settings-row__description"
              >离桌重匹配前确认放弃本手投入</span
            >
          </div>
          <el-switch
            v-model="form.confirmLeaveTable"
            class="settings-row__control"
            aria-label="离桌确认"
            @change="updateSafetyBoolean('confirmLeaveTable', Boolean($event))"
          />
        </div>
      </div>
    </section>

    <section class="settings-section" aria-labelledby="settings-audio-title">
      <header class="settings-section__header">
        <h2 id="settings-audio-title" class="settings-section__title">
          声音与提示
        </h2>
        <span class="settings-section__description"
          >浏览器可能要求先进行一次点击才能播放声音</span
        >
      </header>
      <div class="settings-list">
        <div class="settings-row">
          <div class="settings-row__copy">
            <strong class="settings-row__label">行动音效</strong>
            <span class="settings-row__description"
              >真人和 AI 决策使用不同的短提示音。</span
            >
          </div>
          <el-switch
            v-model="form.soundEnabled"
            class="settings-row__control"
            aria-label="行动音效"
            @change="updateBoolean('soundEnabled', Boolean($event))"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row__copy">
            <strong class="settings-row__label">背景音乐</strong>
            <span class="settings-row__description"
              >使用低音量的本机循环音，不联网加载资源。</span
            >
          </div>
          <el-switch
            v-model="form.musicEnabled"
            class="settings-row__control"
            aria-label="背景音乐"
            @change="updateBoolean('musicEnabled', Boolean($event))"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row__copy">
            <strong class="settings-row__label">音量</strong>
            <span class="settings-row__description"
              >统一控制行动音效和背景音乐音量。</span
            >
          </div>
          <el-slider
            v-model="form.volume"
            class="settings-row__control settings-row__volume"
            :min="0"
            :max="100"
            :show-tooltip="true"
            @change="updateVolume(Number($event))"
          />
        </div>
        <div class="settings-row">
          <div class="settings-row__copy">
            <strong class="settings-row__label">新手提示</strong>
            <span class="settings-row__description"
              >显示规则和控件提示，不代替玩家决策。</span
            >
          </div>
          <el-switch
            v-model="form.beginnerHints"
            class="settings-row__control"
            aria-label="新手提示"
            @change="updateBoolean('beginnerHints', Boolean($event))"
          />
        </div>
      </div>
    </section>

    <section
      class="settings-section settings-diagnostics"
      aria-labelledby="settings-diagnostics-title"
    >
      <header class="settings-section__header">
        <div class="settings-diagnostics__heading">
          <h2 id="settings-diagnostics-title" class="settings-section__title">
            开发工具
          </h2>
          <span class="settings-section__description"
            >仅展示本地聚合数据，不影响正式对局</span
          >
        </div>
        <el-button
          class="settings-diagnostics__button"
          :icon="Activity"
          @click="router.push('/diagnostics')"
        >
          开发诊断
        </el-button>
      </header>
    </section>

    <p class="settings-page__notice">
      无密码账号只用于同一浏览器内的数据分区，不提供身份验证或隐私隔离。
    </p>
  </div>
</template>
