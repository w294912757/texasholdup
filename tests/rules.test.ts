import { describe, expect, it } from "vitest";
import {
  getRuleTopic,
  RULE_CATEGORIES,
  RULE_TOPICS,
  searchRuleTopics,
  type RuleTopicId,
} from "@/domain/rules";

describe("local rules knowledge base", () => {
  it("contains every required topic with valid related links", () => {
    const required: RuleTopicId[] = [
      "game-flow",
      "positions",
      "actions",
      "main-side-pots",
      "all-in",
      "incomplete-raise",
      "pot-odds",
      "effective-stack",
      "showdown",
      "odd-chips",
    ];
    const ids = new Set(RULE_TOPICS.map((topic) => topic.id));

    expect(ids).toEqual(new Set(required));
    expect(new Set(RULE_CATEGORIES.map((category) => category.id))).toEqual(
      new Set(RULE_TOPICS.map((topic) => topic.category)),
    );
    for (const topic of RULE_TOPICS) {
      expect(topic.sections.length).toBeGreaterThan(0);
      expect(topic.related.every((relatedId) => ids.has(relatedId))).toBe(true);
      expect(topic.related).not.toContain(topic.id);
    }
  });

  it("searches titles, aliases and body text within a category", () => {
    expect(searchRuleTopics("SPR").map((topic) => topic.id)).toContain(
      "effective-stack",
    );
    expect(searchRuleTopics("101 筹码").map((topic) => topic.id)).toEqual([
      "odd-chips",
    ]);
    expect(
      searchRuleTopics("全下", "settlement").map((topic) => topic.id),
    ).toEqual([]);
  });

  it("falls back to the game flow for an invalid deep link", () => {
    expect(getRuleTopic("missing").id).toBe("game-flow");
    expect(getRuleTopic("pot-odds").title).toBe("底池赔率");
  });
});
