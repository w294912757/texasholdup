import { describe, expect, it } from "vitest";
import {
  applyPlayerAction,
  createGameSession,
  getCurrentPlayer,
  getLegalActions,
} from "@/domain/engine";
import { createReplayFrames } from "@/domain/replay";
import type { GameSession, PlayerAction } from "@/domain/types";

function passiveAction(session: GameSession): PlayerAction {
  const current = getCurrentPlayer(session)!;
  const legal = getLegalActions(session, current.id);
  if (legal.some((action) => action.type === "check")) return { type: "check" };
  if (legal.some((action) => action.type === "call")) return { type: "call" };
  return { type: "fold" };
}

describe("hand replay", () => {
  it("reconstructs every event and finishes at the recorded stacks", () => {
    let session = createGameSession(
      "account",
      "admin",
      1,
      {
        aiCount: 2,
        buyIn: 1_000,
        smallBlind: 10,
        bigBlind: 20,
        maxHands: 20,
      },
      501,
    );
    while (session.currentHand.phase !== "complete") {
      const current = getCurrentPlayer(session)!;
      session = applyPlayerAction(session, current.id, passiveAction(session));
    }

    const frames = createReplayFrames(session.currentHand);
    const finalFrame = frames.at(-1)!;

    expect(frames).toHaveLength(session.currentHand.events.length);
    expect(finalFrame.board).toEqual(session.currentHand.board);
    expect(
      finalFrame.players.map((player) => [player.id, player.stack]),
    ).toEqual(
      session.currentHand.players.map((player) => [player.id, player.stack]),
    );
    expect(
      frames
        .find((frame) => frame.phase === "preflop")
        ?.players.filter((player) => !player.isHuman)
        .every((player) => player.holeCards.length === 0),
    ).toBe(true);
    expect(
      frames
        .filter((frame) => frame.phase !== "complete")
        .every((frame) => frame.players.every((player) => !player.winner)),
    ).toBe(true);
    expect(
      finalFrame.players
        .filter((player) => player.winner)
        .map((player) => player.id),
    ).toEqual(session.currentHand.winnerIds);
  });
});
