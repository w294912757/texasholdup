import { describe, expect, it } from "vitest";
import { calculateGtoReference } from "@/domain/gto";
import { createGameSession, getCurrentPlayer } from "@/domain/engine";

const config = {
  aiCount: 3,
  buyIn: 1_000,
  smallBlind: 10,
  bigBlind: 20,
  maxHands: 20,
};

describe("GTO reference", () => {
  it("returns a normalized legal action mix on the human turn", () => {
    const session = createGameSession("account", "admin", 1, config, 42);
    const human = session.currentHand.players.find((player) => player.isHuman)!;
    session.currentHand.currentSeat = human.seat;
    session.currentHand.pendingPlayerIds = [human.id];

    const reference = calculateGtoReference(session);

    expect(reference.available).toBe(true);
    expect(reference.actions.length).toBeGreaterThan(0);
    expect(
      reference.actions.reduce((sum, action) => sum + action.frequency, 0),
    ).toBe(100);
    expect(reference.primaryAction).toEqual(
      expect.objectContaining({
        frequency: Math.max(
          ...reference.actions.map((action) => action.frequency),
        ),
      }),
    );
  });

  it("does not use hidden AI cards", () => {
    const session = createGameSession("account", "admin", 1, config, 91);
    const human = session.currentHand.players.find((player) => player.isHuman)!;
    session.currentHand.currentSeat = human.seat;
    session.currentHand.pendingPlayerIds = [human.id];
    const changed = structuredClone(session);
    changed.currentHand.players
      .filter((player) => !player.isHuman)
      .forEach((player, index) => {
        player.holeCards = index % 2 === 0 ? ["As", "Ah"] : ["2c", "3c"];
      });

    expect(calculateGtoReference(changed)).toEqual(
      calculateGtoReference(session),
    );
  });

  it("waits when another player is acting", () => {
    const session = createGameSession("account", "admin", 1, config, 7);
    const current = getCurrentPlayer(session)!;
    if (current.isHuman) {
      session.currentHand.currentSeat = session.currentHand.players.find(
        (player) => !player.isHuman,
      )!.seat;
    }

    const reference = calculateGtoReference(session);

    expect(reference.available).toBe(false);
    expect(reference.actions).toEqual([]);
  });
});
