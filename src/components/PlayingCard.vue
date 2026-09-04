<script setup lang="ts">
import { computed } from "vue";
import { Spade } from "@lucide/vue";
import type { Card } from "@/domain/types";

const props = defineProps<{
  card?: Card;
  hidden?: boolean;
  compact?: boolean;
}>();

const rank = computed(() => props.card?.[0] ?? "");
const suitCode = computed(() => props.card?.[1] ?? "");
const suit = computed(
  () => ({ c: "♣", d: "♦", h: "♥", s: "♠" })[suitCode.value] ?? "",
);
const isRed = computed(() => suitCode.value === "d" || suitCode.value === "h");
</script>

<template>
  <span
    class="playing-card"
    role="img"
    :class="{
      'playing-card--hidden': hidden,
      'playing-card--red': isRed,
      'playing-card--compact': compact,
      'playing-card--empty': !card,
    }"
    :aria-label="hidden ? '未公开的牌' : card ? `${rank}${suit}` : '空牌位'"
  >
    <span v-if="!hidden && card" class="playing-card__rank">{{ rank }}</span>
    <span v-if="!hidden && card" class="playing-card__suit">{{ suit }}</span>
    <Spade
      v-if="hidden"
      class="playing-card__back-mark"
      :size="18"
      aria-hidden="true"
    />
  </span>
</template>
