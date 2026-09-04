import { describe, expect, it } from "vitest";
import {
  advanceTrainingSession,
  buildTrainingQuestions,
  createTrainingSession,
  getTrainingRecommendation,
  submitTrainingAnswer,
  trainingAccuracy,
} from "@/domain/training";

describe("training domain", () => {
  it("builds deterministic 10 and 20 question challenges", () => {
    expect(buildTrainingQuestions(10, [], 41)).toEqual(
      buildTrainingQuestions(10, [], 41),
    );
    expect(buildTrainingQuestions(10, [], 41)).toHaveLength(10);
    expect(buildTrainingQuestions(20, [], 41)).toHaveLength(20);
  });

  it("accepts one legal answer and advances without formal rewards", () => {
    const session = createTrainingSession(
      "account",
      10,
      [],
      12,
      "2026-09-04T00:00:00.000Z",
    );
    const question = session.questions[0]!;
    const preferred = [...question.referenceMix].sort(
      (left, right) => right.frequency - left.frequency,
    )[0]!;
    const answered = submitTrainingAnswer(
      session,
      preferred.type,
      preferred.minTarget,
      "2026-09-04T00:00:02.000Z",
    );
    expect(answered.answers).toHaveLength(1);
    expect(answered.answers[0]).toMatchObject({
      correct: true,
      elapsedMs: 2_000,
    });
    expect(trainingAccuracy(answered)).toBe(1);
    const advanced = advanceTrainingSession(
      answered,
      "2026-09-04T00:00:03.000Z",
    );
    expect(advanced.currentIndex).toBe(1);
    expect(advanced.mode).toBe("training");
  });

  it("rejects illegal, undersized and duplicate submissions", () => {
    const session = createTrainingSession("account", 10, [], 22);
    const question = session.questions[0]!;
    const option = question.legalActions[0]!;
    const answered = submitTrainingAnswer(
      session,
      option.type,
      option.minTarget,
    );
    expect(() =>
      submitTrainingAnswer(answered, option.type, option.minTarget),
    ).toThrow("已经提交");
    expect(() => submitTrainingAnswer(session, "bet", 1)).toThrow();
  });

  it("identifies the highest-frequency answer and explains the recommendation", () => {
    const session = createTrainingSession("account", 10, [], 72);
    const question = session.questions[0]!;
    const recommendation = getTrainingRecommendation(question);
    const highestFrequency = Math.max(
      ...question.referenceMix.map((item) => item.frequency),
    );

    expect(recommendation.actionTypes.length).toBeGreaterThan(0);
    expect(
      question.referenceMix
        .filter((item) => recommendation.actionTypes.includes(item.type))
        .every((item) => item.frequency === highestFrequency),
    ).toBe(true);
    expect(recommendation.reason.length).toBeGreaterThan(20);
  });
});
