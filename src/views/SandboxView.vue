<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { Download, FlaskConical, Play, Plus, RotateCcw, Save, Trash2 } from "@lucide/vue";
import {
  createSandboxCase,
  deleteSandboxCase,
  evaluateSandboxCase,
  exportSandboxCase,
  loadSandboxCases,
  saveSandboxCase,
  type SandboxActionInput,
  type SandboxCase,
  type SandboxEvaluation,
} from "@/domain/sandbox";
import type { Card, PlayerActionType } from "@/domain/types";

const sandboxCase = ref<SandboxCase>(createSandboxCase());
const savedCases = ref<SandboxCase[]>(loadSandboxCases());
const selectedCaseId = ref("");
const boardInput = ref(sandboxCase.value.board.join(" "));
const actionInput = ref("");
const result = ref<SandboxEvaluation | null>(null);

const canRemovePlayer = computed(() => sandboxCase.value.players.length > 2);

function parseCards(value: string): Card[] {
  return value
    .split(/[\s,，]+/)
    .map((card) => card.trim())
    .filter(Boolean) as Card[];
}

function parseActions(value: string): SandboxActionInput[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [playerId, action, amount] = line.split(/\s+/);
      return {
        playerId: playerId ?? "",
        action: (action ?? "") as PlayerActionType,
        amount: amount === undefined ? undefined : Number(amount),
      };
    });
}

function normalizedCase(): SandboxCase {
  return {
    ...sandboxCase.value,
    board: parseCards(boardInput.value),
    actions: parseActions(actionInput.value),
    players: sandboxCase.value.players.map((player) => ({ ...player, holeCards: [...player.holeCards] })),
  };
}

function syncInputs(next: SandboxCase): void {
  sandboxCase.value = next;
  boardInput.value = next.board.join(" ");
  actionInput.value = next.actions.map((action) => [action.playerId, action.action, action.amount].filter((item) => item !== undefined).join(" ")).join("\n");
  result.value = null;
}

function runEvaluation(): void {
  const next = normalizedCase();
  sandboxCase.value = next;
  result.value = evaluateSandboxCase(next);
}

function addPlayer(): void {
  if (sandboxCase.value.players.length >= 6) return;
  const index = sandboxCase.value.players.length + 1;
  sandboxCase.value.players.push({ id: `p${index}`, name: `玩家 ${index}`, seat: index - 1, stack: 0, committedHand: 100, holeCards: ["2c", "3c"], folded: false });
}

function removePlayer(id: string): void {
  if (!canRemovePlayer.value) return;
  sandboxCase.value.players = sandboxCase.value.players.filter((player) => player.id !== id);
}

function newCase(): void {
  syncInputs(createSandboxCase());
  selectedCaseId.value = "";
}

function saveCase(): void {
  const saved = saveSandboxCase(normalizedCase());
  savedCases.value = saved;
  ElMessage.success("沙盒案例已保存");
}

function loadCase(id: string): void {
  const found = savedCases.value.find((item) => item.id === id);
  if (found) syncInputs(found);
}

function removeCase(): void {
  if (!selectedCaseId.value) return;
  savedCases.value = deleteSandboxCase(selectedCaseId.value);
  newCase();
  ElMessage.success("沙盒案例已删除");
}

function exportCase(): void {
  const blob = new globalThis.Blob([exportSandboxCase(normalizedCase())], { type: "application/json" });
  const url = globalThis.URL.createObjectURL(blob);
  const anchor = globalThis.document.createElement("a");
  anchor.href = url;
  anchor.download = `holdup-sandbox-${Date.now()}.json`;
  anchor.click();
  globalThis.URL.revokeObjectURL(url);
  ElMessage.success("测试案例已导出");
}
</script>

<template>
  <div class="sandbox-page">
    <header class="sandbox-header">
      <div class="sandbox-header__copy">
        <span class="sandbox-header__eyebrow">规则回归工具</span>
        <h1 class="sandbox-header__title"><FlaskConical :size="22" aria-hidden="true" /> 测试沙盒</h1>
        <p class="sandbox-header__description">仅调用规则和结算逻辑，不会改变账号筹码、经验、等级、历史记录或活动牌局。</p>
      </div>
      <div class="sandbox-header__actions">
        <el-button class="sandbox-header__button" :icon="RotateCcw" @click="newCase">新建案例</el-button>
        <el-button class="sandbox-header__button" :icon="Save" @click="saveCase">保存案例</el-button>
        <el-button class="sandbox-header__button" :icon="Download" @click="exportCase">导出测试案例</el-button>
      </div>
    </header>

    <section class="sandbox-case-tools" aria-label="案例管理">
      <el-select v-model="selectedCaseId" class="sandbox-case-tools__select" placeholder="加载已保存案例" clearable @change="loadCase">
        <el-option v-for="item in savedCases" :key="item.id" class="sandbox-case-tools__option" :label="item.name" :value="item.id" />
      </el-select>
      <el-button class="sandbox-case-tools__delete" type="danger" text :icon="Trash2" :disabled="!selectedCaseId" @click="removeCase">删除案例</el-button>
    </section>

    <main class="sandbox-workspace">
      <section class="sandbox-editor" aria-labelledby="sandbox-editor-title">
        <header class="sandbox-section__header">
          <h2 id="sandbox-editor-title" class="sandbox-section__title">案例输入</h2>
          <span class="sandbox-section__hint">牌面使用 As、Td 等格式，空格或逗号分隔</span>
        </header>
        <div class="sandbox-form-grid">
          <label class="sandbox-field sandbox-field--wide"><span class="sandbox-field__label">案例名称</span><el-input v-model="sandboxCase.name" class="sandbox-field__input" maxlength="40" /></label>
          <label class="sandbox-field sandbox-field--wide"><span class="sandbox-field__label">公共牌（5 张）</span><el-input v-model="boardInput" class="sandbox-field__input" /></label>
          <label class="sandbox-field"><span class="sandbox-field__label">按钮位座位</span><el-input-number v-model="sandboxCase.dealerSeat" class="sandbox-field__number" :min="0" :max="5" /></label>
          <label class="sandbox-field"><span class="sandbox-field__label">小盲</span><el-input-number v-model="sandboxCase.smallBlind" class="sandbox-field__number" :min="1" /></label>
          <label class="sandbox-field"><span class="sandbox-field__label">大盲</span><el-input-number v-model="sandboxCase.bigBlind" class="sandbox-field__number" :min="2" /></label>
        </div>

        <div class="sandbox-players">
          <div class="sandbox-subsection__header"><h3 class="sandbox-subsection__title">玩家与底牌</h3><el-button class="sandbox-subsection__add" text :icon="Plus" :disabled="sandboxCase.players.length >= 6" @click="addPlayer">增加玩家</el-button></div>
          <div v-for="player in sandboxCase.players" :key="player.id" class="sandbox-player-row">
            <el-input v-model="player.id" class="sandbox-player-row__id" aria-label="玩家 ID" />
            <el-input v-model="player.name" class="sandbox-player-row__name" aria-label="玩家名称" />
            <el-input-number v-model="player.seat" class="sandbox-player-row__number" aria-label="座位" :min="0" :max="5" />
            <el-input-number v-model="player.committedHand" class="sandbox-player-row__number" aria-label="已投入筹码" :min="0" />
            <el-input-number v-model="player.stack" class="sandbox-player-row__number" aria-label="剩余筹码" :min="0" />
            <el-input :model-value="player.holeCards.join(' ')" class="sandbox-player-row__cards" aria-label="底牌" placeholder="As Kd" @update:model-value="(value: string) => player.holeCards = parseCards(value)" />
            <el-checkbox v-model="player.folded" class="sandbox-player-row__folded">已弃牌</el-checkbox>
            <el-button class="sandbox-player-row__remove" text :icon="Trash2" :disabled="!canRemovePlayer" aria-label="删除玩家" @click="removePlayer(player.id)" />
          </div>
          <p class="sandbox-field__help">顺序：ID、名称、座位、已投入、剩余筹码、底牌。已弃牌玩家不会参与分池争夺。</p>
        </div>

        <label class="sandbox-field sandbox-field--wide"><span class="sandbox-field__label">行动序列（每行：玩家ID 行动 金额）</span><el-input v-model="actionInput" class="sandbox-field__textarea" type="textarea" :rows="5" placeholder="p1 bet 40&#10;p2 call 40&#10;p1 check" /></label>
        <div class="sandbox-editor__footer"><el-button class="sandbox-editor__run" type="primary" :icon="Play" @click="runEvaluation">运行结算</el-button><span class="sandbox-editor__note">运行结果只存在于当前页面</span></div>
      </section>

      <section class="sandbox-results" aria-labelledby="sandbox-results-title">
        <header class="sandbox-section__header"><h2 id="sandbox-results-title" class="sandbox-section__title">结算结果</h2><span v-if="result" class="sandbox-section__status" :class="{ 'sandbox-section__status--invalid': !result.valid }">{{ result.valid ? `总底池 ${result.totalPot}` : "输入需要修正" }}</span></header>
        <div v-if="!result" class="sandbox-results__empty">填写案例后运行结算，结果会显示在这里。</div>
        <div v-else-if="!result.valid" class="sandbox-errors"><strong class="sandbox-errors__title">无法结算</strong><p v-for="error in [...result.errors, ...result.actionErrors]" :key="error" class="sandbox-errors__item">{{ error }}</p></div>
        <template v-else>
          <div class="sandbox-result-players"><div v-for="player in result.players" :key="player.id" class="sandbox-result-player" :class="{ 'sandbox-result-player--folded': player.folded }"><div class="sandbox-result-player__identity"><strong>{{ player.name }}</strong><span>{{ player.folded ? "已弃牌" : player.handDescription }}</span></div><span class="sandbox-result-player__hand">{{ player.handName ?? "-" }}</span><span class="sandbox-result-player__award">+{{ player.awarded }} <small>筹码</small></span></div></div>
          <div class="sandbox-pot-list"><h3 class="sandbox-subsection__title">主池与边池</h3><div v-for="pot in result.pots" :key="pot.index" class="sandbox-pot-row"><span>第 {{ pot.index }} 池</span><strong>{{ pot.amount }}</strong><span>赢家：{{ pot.winnerIds.map((id) => result?.players.find((player) => player.id === id)?.name ?? id).join("、") }}</span><span v-if="Object.values(pot.awards).some((amount) => amount > Math.floor(pot.amount / pot.winnerIds.length))" class="sandbox-pot-row__remainder">含余数筹码</span></div></div>
        </template>
      </section>
    </main>
  </div>
</template>
