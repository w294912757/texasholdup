import { describe, expect, it } from "vitest";
import { decideAiAction } from "@/domain/ai";
import {
  applyPlayerAction,
  createGameSession,
  getCurrentPlayer,
  getLegalActions,
  getPlayerHandType,
} from "@/domain/engine";
import type { GameSession, PlayerAction } from "@/domain/types";

const config = {
  aiCount: 3,
  buyIn: 1_000,
  smallBlind: 10,
  bigBlind: 20,
  maxHands: 20,
};

function passiveAction(session: GameSession): PlayerAction {
  const current = getCurrentPlayer(session);
  if (!current) throw new Error("missing current player");
  const legal = getLegalActions(session, current.id);
  if (legal.some((action) => action.type === "check")) return { type: "check" };
  if (legal.some((action) => action.type === "call")) return { type: "call" };
  return { type: "fold" };
}

describe("holdem engine", () => {
  it("completes a hand and conserves chips", () => {
    let session = createGameSession("account", "admin", 1, config, 42);
    let actions = 0;

    while (session.currentHand.phase !== "complete" && actions < 100) {
      const current = getCurrentPlayer(session);
      expect(current).not.toBeNull();
      session = applyPlayerAction(session, current!.id, passiveAction(session));
      actions += 1;
    }

    expect(session.currentHand.phase).toBe("complete");
    expect(actions).toBeLessThan(100);
    expect(
      session.currentHand.players.reduce(
        (sum, player) => sum + player.stack,
        0,
      ),
    ).toBe(config.buyIn * (config.aiCount + 1));
    expect(session.currentHand.events.map((event) => event.seq)).toEqual(
      session.currentHand.events.map((_, index) => index + 1),
    );
  });

  it("repeats an unfinished AI decision deterministically", () => {
    const session = createGameSession("account", "admin", 6, config, 7);
    const current = getCurrentPlayer(session)!;
    if (current.isHuman) {
      const next = applyPlayerAction(
        session,
        current.id,
        passiveAction(session),
      );
      const ai = getCurrentPlayer(next)!;
      expect(decideAiAction(next, ai)).toEqual(
        decideAiAction(structuredClone(next), structuredClone(ai)),
      );
    } else {
      expect(decideAiAction(session, current)).toEqual(
        decideAiAction(structuredClone(session), structuredClone(current)),
      );
    }
  });

  it("rejects replaying a stale action", () => {
    const session = createGameSession("account", "admin", 1, config, 99);
    const current = getCurrentPlayer(session)!;
    const action = passiveAction(session);
    const advanced = applyPlayerAction(session, current.id, action);

    expect(() => applyPlayerAction(advanced, current.id, action)).toThrow();
  });

  it("settles unequal all-ins into side pots without creating chips", () => {
    let session = createGameSession(
      "account",
      "admin",
      5,
      { ...config, aiCount: 2 },
      123,
    );
    const targetTotals = [500, 300, 100];
    session.currentHand.players.forEach((player, index) => {
      player.stack = Math.max(
        0,
        (targetTotals[index] ?? 100) - player.committedHand,
      );
    });
    const totalBefore = session.currentHand.players.reduce(
      (sum, player) => sum + player.stack + player.committedHand,
      0,
    );
    let guard = 0;

    while (session.currentHand.phase !== "complete" && guard < 50) {
      const current = getCurrentPlayer(session)!;
      const legal = getLegalActions(session, current.id);
      const action = legal.some((entry) => entry.type === "all-in")
        ? ({ type: "all-in" } as const)
        : legal.some((entry) => entry.type === "call")
          ? ({ type: "call" } as const)
          : ({ type: "check" } as const);
      session = applyPlayerAction(session, current.id, action);
      guard += 1;
    }

    expect(session.currentHand.phase).toBe("complete");
    expect(session.currentHand.pots.length).toBeGreaterThan(1);
    expect(
      session.currentHand.players.reduce(
        (sum, player) => sum + player.stack,
        0,
      ),
    ).toBe(totalBefore);
  });

  it("splits a tied pot evenly and credits every tied player", () => {
    let session = createGameSession(
      "account",
      "admin",
      1,
      { ...config, aiCount: 2 },
      321,
    );
    const hand = session.currentHand;
    const players = hand.players;
    players.forEach((player) => {
      player.stack = 100;
      player.committedHand = 0;
      player.committedRound = 0;
      player.folded = false;
      player.allIn = false;
      player.holeCards = ["As", "Kd"];
    });
    hand.phase = "river";
    hand.board = ["2c", "3d", "4h", "8s"];
    hand.deck = ["Ah", "6c"];
    hand.currentBet = 0;
    hand.pendingPlayerIds = players.map((player) => player.id);
    hand.currentSeat = players[0]?.seat ?? null;

    let guard = 0;
    while (
      session.currentHand.phase !== "complete" &&
      guard < players.length + 1
    ) {
      const current = getCurrentPlayer(session);
      expect(current).not.toBeNull();
      const legal = getLegalActions(session, current!.id);
      session = applyPlayerAction(
        session,
        current!.id,
        legal.some((action) => action.type === "all-in")
          ? { type: "all-in" }
          : { type: "call" },
      );
      guard += 1;
    }

    expect(session.currentHand.phase).toBe("complete");
    expect(session.currentHand.pots).toHaveLength(1);
    expect(session.currentHand.pots[0]).toEqual(
      expect.objectContaining({
        amount: 300,
        winnerIds: expect.arrayContaining(players.map((player) => player.id)),
      }),
    );
    expect(session.currentHand.pots[0]?.winnerIds).toHaveLength(players.length);
    expect(session.currentHand.players.map((player) => player.stack)).toEqual([
      100, 100, 100,
    ]);
  });

  it("recomputes the player's hand type as community cards arrive", () => {
    const session = createGameSession("account", "admin", 1, config, 654);
    const player = session.currentHand.players[0]!;
    player.holeCards = ["As", "Ad"];

    expect(getPlayerHandType(player, [])).toBe("一对");
    expect(getPlayerHandType(player, ["Ac", "2h", "7s"])).toBe("三条");
    expect(getPlayerHandType(player, ["Ac", "2h", "7s", "7c", "9d"])).toBe(
      "葫芦",
    );
  });
});
