import { describe, expect, it } from "vitest";
import {
  applyPlayerAction,
  createGameSession,
  getCurrentPlayer,
  getLegalActions,
} from "@/domain/engine";
import {
  buildEquityTimeline,
  buildHandReviewSummary,
  findKeyDecisions,
  simulateAlternativeActions,
} from "@/domain/review";
import type { HandHistoryRecord } from "@/persistence/database";

function makeRecord(): HandHistoryRecord {
  let session = createGameSession(
    "account",
    "admin",
    1,
    { aiCount: 2, buyIn: 1_000, smallBlind: 10, bigBlind: 20, maxHands: 20 },
    77,
  );
  while (session.currentHand.phase !== "complete") {
    const player = getCurrentPlayer(session)!;
    const legal = getLegalActions(session, player.id);
    const action = legal.find((item) => item.type === "check") ?? legal.find((item) => item.type === "call") ?? legal[0]!;
    session = applyPlayerAction(session, player.id, { type: action.type });
  }
  return {
    id: "record",
    accountId: "account",
    sessionId: session.id,
    handNumber: 1,
    createdAt: session.currentHand.completedAt ?? new Date().toISOString(),
    leftTable: false,
    playerLevel: 1,
    favorite: false,
    note: "",
    hand: session.currentHand,
  };
}

describe("hand review", () => {
  it("builds deterministic summary and public equity timeline", () => {
    const record = makeRecord();
    const summary = buildHandReviewSummary(record);
    expect(summary.totalInvested).toBeGreaterThan(0);
    expect(summary.maxPot).toBeGreaterThan(0);
    expect(buildEquityTimeline(record)).toEqual(buildEquityTimeline(record));
  });

  it("finds decisions and keeps simulations independent", () => {
    const record = makeRecord();
    const decisions = findKeyDecisions(record);
    expect(decisions.length).toBeGreaterThan(0);
    const result = simulateAlternativeActions(record, decisions[0]!);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((item) => item.estimated)).toBe(true);
    expect(record.hand.events.length).toBeGreaterThan(0);
  });
});
