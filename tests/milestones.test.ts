import { describe, expect, it } from "vitest";
import { createGameSession } from "@/domain/engine";
import {
  buildMilestoneOverview,
  MILESTONE_DEFINITIONS,
  STAGE_DEFINITIONS,
} from "@/domain/milestones";
import type { HandHistoryRecord } from "@/persistence/database";
import type { AccountProfile } from "@/domain/types";

const account: AccountProfile = {
  id: "account-1",
  name: "admin",
  level: 4,
  currentLevelXp: 20,
  lifetimeXp: 520,
  highestLevel: 6,
  bankroll: 10_000,
  createdAt: "2026-09-04T00:00:00.000Z",
  updatedAt: "2026-09-04T00:00:00.000Z",
};

function record(
  number: number,
  level: number,
  won: boolean,
): HandHistoryRecord {
  const session = createGameSession(
    "account-1",
    "admin",
    level,
    {
      aiCount: 1,
      buyIn: 1_000,
      smallBlind: 10,
      bigBlind: 20,
      maxHands: 20,
    },
    number,
  );
  const human = session.currentHand.players.find((player) => player.isHuman)!;
  const events = won
    ? [
        {
          seq: 1,
          type: "pot-awarded" as const,
          phase: "complete" as const,
          playerId: human.id,
          amount: 1_500,
          pot: 1_500,
          message: "won",
          createdAt: "2026-09-04T00:00:01.000Z",
        },
      ]
    : [];
  return {
    id: `record-${number}`,
    accountId: account.id,
    sessionId: session.id,
    handNumber: number,
    createdAt: "2026-09-04T00:00:01.000Z",
    leftTable: false,
    playerLevel: level,
    favorite: number === 1,
    note: "",
    hand: { ...session.currentHand, winnerIds: won ? [human.id] : [], events },
  };
}

describe("local stages and milestones", () => {
  it("maps levels to the five local stages", () => {
    expect(STAGE_DEFINITIONS).toHaveLength(5);
    expect(
      buildMilestoneOverview({ ...account, level: 1 }, []).stage.label,
    ).toBe("新手");
    expect(
      buildMilestoneOverview({ ...account, level: 12 }, []).stage.label,
    ).toBe("专家");
  });

  it("derives stage statistics and idempotent challenge progress from records", () => {
    const overview = buildMilestoneOverview(account, [
      record(1, 4, true),
      record(2, 4, false),
      record(3, 2, true),
    ]);
    expect(overview.stageStatistics).toMatchObject({
      hands: 2,
      wins: 1,
      winRate: 0.5,
      netProfit: 1470,
    });
    expect(overview.highestLevel).toBe(6);
    expect(overview.challenges).toHaveLength(MILESTONE_DEFINITIONS.length);
    expect(
      overview.challenges.find((challenge) => challenge.id === "first-hand"),
    ).toMatchObject({ current: 3, completed: true });
    expect(
      overview.challenges.find((challenge) => challenge.id === "review-three"),
    ).toMatchObject({ current: 1, completed: false });
  });
});
