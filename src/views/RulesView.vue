<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { BookOpen, Search } from "@lucide/vue";
import {
  getRuleTopic,
  RULE_CATEGORIES,
  RULE_TOPICS,
  searchRuleTopics,
  type RuleCategoryId,
  type RuleTopicId,
} from "@/domain/rules";

type CategoryFilter = RuleCategoryId | "all";

const route = useRoute();
const router = useRouter();
const searchText = ref("");
const category = ref<CategoryFilter>("all");
const selectedTopicId = ref<RuleTopicId>("game-flow");

const categoryOptions = [
  { label: "全部", value: "all" as const },
  ...RULE_CATEGORIES.map((item) => ({ label: item.label, value: item.id })),
];
const filteredTopics = computed(() =>
  searchRuleTopics(searchText.value, category.value),
);
const selectedTopic = computed(() => getRuleTopic(selectedTopicId.value));

function topicFromQuery(): RuleTopicId {
  const query = Array.isArray(route.query.topic)
    ? route.query.topic[0]
    : route.query.topic;
  return RULE_TOPICS.some((topic) => topic.id === query)
    ? (query as RuleTopicId)
    : "game-flow";
}

function selectTopic(topicId: RuleTopicId): void {
  selectedTopicId.value = topicId;
  void router.replace({ query: { ...route.query, topic: topicId } });
}

watch(
  () => route.query.topic,
  () => {
    selectedTopicId.value = topicFromQuery();
  },
  { immediate: true },
);

watch([searchText, category], () => {
  if (
    filteredTopics.value.length &&
    !filteredTopics.value.some((topic) => topic.id === selectedTopicId.value)
  ) {
    selectTopic(filteredTopics.value[0]!.id);
  }
});
</script>

<template>
  <div class="rules-page">
    <header class="rules-header">
      <div class="rules-header__copy">
        <span class="rules-header__eyebrow">离线知识库</span>
        <h1 class="rules-header__title">德州扑克规则</h1>
      </div>
      <span class="rules-header__count">{{ RULE_TOPICS.length }} 个主题</span>
    </header>

    <section class="rules-controls" aria-label="规则筛选">
      <el-input
        v-model="searchText"
        class="rules-controls__search"
        :prefix-icon="Search"
        placeholder="搜索规则或术语"
        clearable
      />
      <el-segmented
        v-model="category"
        class="rules-controls__categories"
        :options="categoryOptions"
      />
      <el-select
        v-model="category"
        class="rules-controls__category-select"
        aria-label="规则分类"
      >
        <el-option
          v-for="option in categoryOptions"
          :key="option.value"
          class="rules-controls__category-option"
          :label="option.label"
          :value="option.value"
        />
      </el-select>
    </section>

    <div v-if="filteredTopics.length" class="rules-workspace">
      <aside class="rules-index" aria-label="规则主题">
        <button
          v-for="topic in filteredTopics"
          :key="topic.id"
          class="rules-index__topic"
          :class="{
            'rules-index__topic--active': topic.id === selectedTopic.id,
          }"
          type="button"
          @click="selectTopic(topic.id)"
        >
          <span class="rules-index__topic-title">{{ topic.title }}</span>
          <span class="rules-index__topic-summary">{{ topic.summary }}</span>
        </button>
      </aside>

      <article class="rules-article">
        <header class="rules-article__header">
          <BookOpen class="rules-article__icon" :size="20" aria-hidden="true" />
          <div class="rules-article__heading">
            <span class="rules-article__category">
              {{
                RULE_CATEGORIES.find(
                  (item) => item.id === selectedTopic.category,
                )?.label
              }}
            </span>
            <h2 class="rules-article__title">{{ selectedTopic.title }}</h2>
          </div>
        </header>
        <p class="rules-article__summary">{{ selectedTopic.summary }}</p>

        <section
          v-for="section in selectedTopic.sections"
          :key="section.title"
          class="rules-article__section"
        >
          <h3 class="rules-article__section-title">{{ section.title }}</h3>
          <p
            v-for="paragraph in section.paragraphs"
            :key="paragraph"
            class="rules-article__paragraph"
          >
            {{ paragraph }}
          </p>
          <ul v-if="section.points" class="rules-article__points">
            <li
              v-for="point in section.points"
              :key="point"
              class="rules-article__point"
            >
              {{ point }}
            </li>
          </ul>
        </section>

        <footer class="rules-article__related">
          <span class="rules-article__related-label">相关主题</span>
          <div class="rules-article__related-list">
            <el-button
              v-for="relatedId in selectedTopic.related"
              :key="relatedId"
              class="rules-article__related-button"
              text
              @click="selectTopic(relatedId)"
            >
              {{ getRuleTopic(relatedId).title }}
            </el-button>
          </div>
        </footer>
      </article>
    </div>

    <div v-else class="rules-empty">
      <Search class="rules-empty__icon" :size="24" aria-hidden="true" />
      <strong class="rules-empty__title">没有匹配的规则</strong>
      <span class="rules-empty__description">请更换关键词或分类</span>
    </div>
  </div>
</template>
