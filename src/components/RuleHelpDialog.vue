<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ArrowRight, BookOpen } from "@lucide/vue";
import { getRuleTopic, type RuleTopicId } from "@/domain/rules";

const props = defineProps<{
  modelValue: boolean;
  topicId: RuleTopicId;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

const router = useRouter();
const activeTopicId = ref<RuleTopicId>(props.topicId);
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});
const topic = computed(() => getRuleTopic(activeTopicId.value));

watch(
  () => [props.modelValue, props.topicId] as const,
  ([isOpen, topicId]) => {
    if (isOpen) activeTopicId.value = topicId;
  },
);

function selectRelated(topicId: RuleTopicId): void {
  activeTopicId.value = topicId;
}

async function openRuleCenter(): Promise<void> {
  visible.value = false;
  await router.push({ name: "rules", query: { topic: activeTopicId.value } });
}
</script>

<template>
  <el-dialog
    v-model="visible"
    class="rule-help-dialog"
    aria-label="规则帮助"
    append-to-body
    destroy-on-close
  >
    <template #header>
      <div class="rule-help-dialog__header">
        <BookOpen
          class="rule-help-dialog__header-icon"
          :size="18"
          aria-hidden="true"
        />
        <strong class="rule-help-dialog__title">{{ topic.title }}</strong>
      </div>
    </template>

    <article class="rule-help-dialog__article">
      <p class="rule-help-dialog__summary">{{ topic.summary }}</p>
      <section
        v-for="section in topic.sections"
        :key="section.title"
        class="rule-help-dialog__section"
      >
        <h3 class="rule-help-dialog__section-title">{{ section.title }}</h3>
        <p
          v-for="paragraph in section.paragraphs"
          :key="paragraph"
          class="rule-help-dialog__paragraph"
        >
          {{ paragraph }}
        </p>
        <ul v-if="section.points" class="rule-help-dialog__points">
          <li
            v-for="point in section.points"
            :key="point"
            class="rule-help-dialog__point"
          >
            {{ point }}
          </li>
        </ul>
      </section>
    </article>

    <div class="rule-help-dialog__related">
      <span class="rule-help-dialog__related-label">相关规则</span>
      <div class="rule-help-dialog__related-list">
        <el-button
          v-for="relatedId in topic.related"
          :key="relatedId"
          class="rule-help-dialog__related-button"
          text
          @click="selectRelated(relatedId)"
        >
          {{ getRuleTopic(relatedId).title }}
        </el-button>
      </div>
    </div>

    <template #footer>
      <el-button
        class="rule-help-dialog__open-center"
        type="primary"
        :icon="ArrowRight"
        @click="openRuleCenter"
      >
        在教学中心查看
      </el-button>
    </template>
  </el-dialog>
</template>
