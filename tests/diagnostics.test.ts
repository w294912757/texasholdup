import { describe, expect, it } from "vitest";
import { createGameSession } from "@/domain/engine";
import { buildFairnessDiagnostics } from "@/domain/diagnostics";
import type { HandHistoryRecord } from "@/persistence/database";

describe("AI fairness diagnostics", () => {
  it("uses fixed samples and exposes only aggregate difficulty data", () => {
    const first = buildFairnessDiagnostics(1);
    const second = buildFairnessDiagnostics(1);
    expect(first).toEqual(second);
    expect(first.sampleCount).toBe(600);
    expect(first.matchingMinTier).toBe(1);
    expect(first.matchingMaxTier).toBe(3);
    expect(first.difficultyDistribution).toHaveLength(12);
    expect(
      first.difficultyDistribution.reduce((sum, item) => sum + item.count, 0),
    ).toBe(600);
  });

  it("aggregates AI actions, response time, departures and player results", () => {
    const session = createGameSession(
      "account-1",
      "admin",
      2,
      {
        aiCount: 1,
        buyIn: 1_000,
        smallBlind: 10,
        bigBlind: 20,
        maxHands: 20,
      },
      42,
    );
    const ai = session.currentHand.players.find((player) => !player.isHuman)!;
    const human = session.currentHand.players.find((player) => player.isHuman)!;
    const hand = {
      ...session.currentHand,
      winnerIds: [human.id],
      completedAt: "2026-09-04T00:00:03.000Z",
      events: [
        {
          seq: 1,
          type: "player-acted" as const,
          phase: "preflop" as const,
          playerId: ai.id,
          action: "fold" as const,
          amount: 0,
          pot: 30,
          message: "fold",
          createdAt: "2026-09-04T00:00:02.000Z",
        },
        {
          seq: 2,
          type: "ai-left" as const,
          phase: "complete" as const,
          playerId: ai.id,
          pot: 30,
          message: "left",
          createdAt: "2026-09-04T00:00:03.000Z",
        },
      ],
    };
    const record: HandHistoryRecord = {
      id: "record-1",
      accountId: "account-1",
      sessionId: session.id,
      handNumber: 1,
      createdAt: "2026-09-04T00:00:03.000Z",
      leftTable: false,
      playerLevel: 2,
      favorite: false,
      note: "",
      hand,
    };
    const result = buildFairnessDiagnostics(2, [record]);
    expect(
      result.actionBreakdown.find((item) => item.action === "fold"),
    ).toMatchObject({ count: 1, ratio: 1 });
    expect(result.averageResponseMilliseconds).toBeNull();
    expect(result.aiDepartureRate).toBe(1);
    expect(result.analyzedHands).toBe(1);
    expect(result.winRate).toBe(1);
  });
});
