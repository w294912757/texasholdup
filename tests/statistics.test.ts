import { describe, expect, it } from "vitest";
import type { Card, GameEvent, HandState, PlayerState } from "@/domain/types";
import type { HandHistoryRecord } from "@/persistence/database";
import {
  analyzeHandRecord,
  buildStatisticsTrend,
  filterHandStatistics,
  normalizeStartingHand,
  summarizeHandStatistics,
  type StatisticsFilters,
} from "@/domain/statistics";

interface RecordOptions {
  id: string;
  createdAt: string;
  won?: boolean;
  showdown?: boolean;
  leftTable?: boolean;
  favorite?: boolean;
  level?: number | null;
  cards?: Card[];
}

function player(
  id: string,
  seat: number,
  isHuman: boolean,
  cards: Card[] = [],
): PlayerState {
  return {
    id,
    name: id,
    seat,
    isHuman,
    avatarKey: id,
    stack: 1_000,
    holeCards: cards,
    committedRound: 100,
    committedHand: isHuman ? 100 : 100,
    folded: false,
    allIn: false,
    lastAction: "all-in",
  };
}

function record(options: RecordOptions): HandHistoryRecord {
  const won = options.won ?? true;
  const showdown = options.showdown ?? true;
  const players = [
    player("ai-0", 0, false, ["2c", "3d"]),
    player("ai-1", 1, false),
    player("ai-2", 2, false),
    player("ai-3", 3, false),
    player("ai-4", 4, false),
    player("human", 5, true, options.cards ?? ["As", "Kd"]),
  ];
  const events: GameEvent[] = [
    {
      seq: 1,
      type: "blind-posted",
      phase: "preflop",
      playerId: "ai-0",
      action: "big-blind",
      amount: 20,
      targetAmount: 20,
      pot: 30,
      message: "大盲",
      createdAt: options.createdAt,
    },
    {
      seq: 2,
      type: "player-acted",
      phase: "preflop",
      playerId: "human",
      action: "all-in",
      amount: 100,
      targetAmount: 100,
      pot: 130,
      message: "全下",
      createdAt: options.createdAt,
    },
    {
      seq: 3,
      type: "pot-awarded",
      phase: showdown ? "showdown" : "preflop",
      playerId: won ? "human" : "ai-0",
      amount: 200,
      pot: 200,
      message: "获得底池",
      createdAt: options.createdAt,
    },
    {
      seq: 4,
      type: "hand-complete",
      phase: "complete",
      pot: 200,
      message: "本手牌已结算",
      createdAt: options.createdAt,
    },
  ];
  const hand: HandState = {
    id: options.id,
    number: 1,
    dealerSeat: 0,
    smallBlindSeat: 1,
    bigBlindSeat: 2,
    phase: "complete",
    deck: [],
    board: showdown ? ["2s", "3s", "4d", "5h", "9c"] : [],
    players,
    currentSeat: null,
    currentBet: 100,
    minRaise: 20,
    bigBlind: 20,
    pendingPlayerIds: [],
    actedPlayerIds: [],
    raiseLockedPlayerIds: [],
    actionSeq: 4,
    events,
    pots: [
      {
        amount: 200,
        eligiblePlayerIds: ["human", "ai-0"],
        winnerIds: [won ? "human" : "ai-0"],
      },
    ],
    winnerIds: [won ? "human" : "ai-0"],
    completedAt: options.createdAt,
  };
  return {
    id: options.id,
    accountId: "account",
    sessionId: `session-${options.id}`,
    handNumber: 1,
    createdAt: options.createdAt,
    leftTable: options.leftTable ?? false,
    playerLevel: options.level === undefined ? 3 : options.level,
    favorite: options.favorite ?? false,
    note: "",
    hand,
  };
}

const emptyFilters: StatisticsFilters = {
  dateFrom: "",
  dateTo: "",
  position: "all",
  startingHand: "",
  playerLevel: "all",
  tableResult: "all",
  favoriteOnly: false,
};

describe("statistics v1", () => {
  it("normalizes starting hands and derives stable hand facts", () => {
    expect(normalizeStartingHand(["Kd", "As"])).toBe("AKo");
    expect(normalizeStartingHand(["Ts", "As"])).toBe("ATs");
    expect(normalizeStartingHand(["Qd", "Qs"])).toBe("QQ");

    const hand = analyzeHandRecord(
      record({ id: "one", createdAt: "2026-09-01T10:00:00.000Z" }),
    );
    expect(hand).toMatchObject({
      position: "cutoff",
      startingHand: "AKo",
      won: true,
      netProfit: 100,
      wentToShowdown: true,
      voluntarilyPutMoneyInPot: true,
      preflopRaised: true,
    });
  });

  it("filters the frozen dimensions and calculates rates and trends", () => {
    const hands = [
      analyzeHandRecord(
        record({
          id: "win",
          createdAt: "2026-09-01T10:00:00.000Z",
          favorite: true,
          level: 3,
        }),
      ),
      analyzeHandRecord(
        record({
          id: "loss",
          createdAt: "2026-09-02T10:00:00.000Z",
          won: false,
          showdown: false,
          leftTable: true,
          level: null,
          cards: ["Qh", "Qs"],
        }),
      ),
    ];

    expect(summarizeHandStatistics(hands)).toMatchObject({
      totalHands: 2,
      wonHands: 1,
      netProfit: 0,
      winRate: 0.5,
      showdownRate: 0.5,
      showdownWinRate: 1,
      vpipRate: 1,
      pfrRate: 1,
    });
    expect(
      filterHandStatistics(hands, {
        ...emptyFilters,
        dateFrom: "2026-09-02",
        startingHand: "qq",
        playerLevel: "unknown",
        tableResult: "left",
      }).map((hand) => hand.record.id),
    ).toEqual(["loss"]);
    expect(
      filterHandStatistics(hands, {
        ...emptyFilters,
        favoriteOnly: true,
      }).map((hand) => hand.record.id),
    ).toEqual(["win"]);
    expect(buildStatisticsTrend(hands)).toEqual([
      { date: "2026-09-01", hands: 1, netProfit: 100, cumulativeNet: 100 },
      { date: "2026-09-02", hands: 1, netProfit: -100, cumulativeNet: 0 },
    ]);
  });

  it("processes a large local history without quadratic work", () => {
    const records = Array.from({ length: 5_000 }, (_, index) =>
      record({
        id: String(index),
        createdAt: `2026-09-${String((index % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
        won: index % 2 === 0,
      }),
    );
    const startedAt = performance.now();
    const analyzed = records.map(analyzeHandRecord);
    summarizeHandStatistics(analyzed);
    buildStatisticsTrend(analyzed);
    expect(performance.now() - startedAt).toBeLessThan(500);
  });
});
