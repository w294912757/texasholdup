import { describe, expect, it } from "vitest";
import {
  applyPlayerAction,
  createGameSession,
  getCurrentPlayer,
  getLegalActions,
  startNextHand,
} from "@/domain/engine";
import { aiDepartureProbability, rotateAiRoster } from "@/domain/roster";
import type { AiTableState, GameSession, PlayerAction } from "@/domain/types";

const config = {
  aiCount: 5,
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

function completeFirstHand(seed = 42): GameSession {
  let session = createGameSession("account", "admin", 5, config, seed);
  let guard = 0;
  while (session.currentHand.phase !== "complete" && guard < 100) {
    const current = getCurrentPlayer(session);
    if (!current) throw new Error("missing current player");
    session = applyPlayerAction(session, current.id, passiveAction(session));
    guard += 1;
  }
  if (session.currentHand.phase !== "complete")
    throw new Error("hand did not complete");
  return session;
}

describe("AI table rotation", () => {
  it("protects new AI players from voluntary departure", () => {
    const completed = completeFirstHand();
    const previousIds = completed.roster.map((profile) => profile.id);
    const next = startNextHand(completed);

    expect(next.roster.map((profile) => profile.id)).toEqual(previousIds);
    expect(
      next.currentHand.events.filter((event) => event.type === "ai-left"),
    ).toHaveLength(0);
    expect(
      Object.values(next.aiStates).every((state) => state.handsPlayed === 1),
    ).toBe(true);
  });

  it("replaces a busted AI in the same seat before the next hand", () => {
    const completed = completeFirstHand(81);
    const busted = completed.currentHand.players.find(
      (player) => !player.isHuman,
    )!;
    busted.stack = 0;

    const next = startNextHand(completed, 9);
    const replacement = next.roster.find(
      (profile) => profile.seat === busted.seat,
    )!;
    const rotationEvents = next.currentHand.events.filter(
      (event) => event.type === "ai-left" || event.type === "ai-joined",
    );

    expect(replacement.id).not.toBe(busted.id);
    expect(replacement.id).toBe(`ai-${busted.seat}-h2`);
    expect(replacement.aiTier).toBeTypeOf("number");
    expect(replacement.aiBand).toMatch(/lower|peer|higher/);
    expect(next.roster).toHaveLength(config.aiCount + 1);
    expect(next.stacks[replacement.id]).toBe(config.buyIn);
    expect(next.aiStates[replacement.id]).toMatchObject({
      handsPlayed: 0,
      joinedHand: 2,
      entryStack: config.buyIn,
    });
    expect(rotationEvents.map((event) => event.type)).toEqual([
      "ai-left",
      "ai-joined",
    ]);
    expect(rotationEvents.map((event) => event.message).join(" ")).not.toMatch(
      /tier|lower|peer|higher|难度/i,
    );
  });

  it("repeats a committed rotation decision from the same seed", () => {
    const completed = completeFirstHand(205);
    completed.currentHand.players.find((player) => !player.isHuman)!.stack = 0;

    const first = startNextHand(completed, 7);
    const second = startNextHand(structuredClone(completed), 7);
    const rotationSummary = (session: GameSession) => ({
      roster: session.roster,
      stacks: session.stacks,
      aiStates: session.aiStates,
      deck: session.currentHand.deck,
      events: session.currentHand.events
        .filter(
          (event) => event.type === "ai-left" || event.type === "ai-joined",
        )
        .map((event) => ({
          type: event.type,
          playerId: event.playerId,
          message: event.message,
          rotation: event.rotation,
        })),
    });

    expect(rotationSummary(second)).toEqual(rotationSummary(first));
  });

  it("caps voluntary departures while allowing no departure", () => {
    const protectedSession = createGameSession(
      "account",
      "admin",
      5,
      config,
      12,
    );
    expect(rotateAiRoster(protectedSession, 5).changes).toEqual([]);

    const stressed = structuredClone(protectedSession);
    stressed.completedHands = 12;
    for (const profile of stressed.roster.filter(
      (candidate) => !candidate.isHuman,
    )) {
      stressed.stacks[profile.id] = 100;
      stressed.aiStates[profile.id] = {
        playerId: profile.id,
        joinedHand: 1,
        handsPlayed: 12,
        entryStack: 1_000,
        lastStack: 400,
        recentNetResults: [-100, -100, -100, -100, -100],
      };
    }

    let observedTwoDepartures = false;
    for (let seed = 0; seed < 40; seed += 1) {
      stressed.seed = seed;
      const rotation = rotateAiRoster(stressed, 5);
      const voluntary = rotation.changes.filter(
        (change) =>
          change.type === "left" && change.details.reason === "voluntary",
      );
      expect(voluntary.length).toBeLessThanOrEqual(2);
      observedTwoDepartures ||= voluntary.length === 2;
    }
    expect(observedTwoDepartures).toBe(true);
  });

  it("uses stack, recent performance and table tenure in the probability", () => {
    const protectedState: AiTableState = {
      playerId: "ai-1",
      joinedHand: 1,
      handsPlayed: 2,
      entryStack: 1_000,
      lastStack: 200,
      recentNetResults: [-300, -200],
    };
    const strugglingState: AiTableState = {
      ...protectedState,
      handsPlayed: 12,
      recentNetResults: [-100, -100, -100, -100, -100],
    };

    expect(aiDepartureProbability(protectedState, 200)).toBe(0);
    expect(aiDepartureProbability(strugglingState, 200)).toBeGreaterThan(0.8);
    expect(aiDepartureProbability(strugglingState, 0)).toBe(1);
  });

  it("upgrades an old active session that has no AI performance state", () => {
    const completed = completeFirstHand(507);
    delete (completed as Partial<GameSession>).aiStates;

    const next = startNextHand(completed);

    expect(Object.keys(next.aiStates)).toHaveLength(config.aiCount);
    expect(next.currentHand.number).toBe(2);
  });

  it("keeps identities, seats and performance state consistent across hands", () => {
    let session = createGameSession(
      "account",
      "admin",
      6,
      { ...config, buyIn: 10_000, maxHands: 8 },
      610,
    );

    for (let handNumber = 1; handNumber <= 8; handNumber += 1) {
      let guard = 0;
      while (session.currentHand.phase !== "complete" && guard < 120) {
        const current = getCurrentPlayer(session);
        if (!current) throw new Error("missing current player");
        session = applyPlayerAction(
          session,
          current.id,
          passiveAction(session),
        );
        guard += 1;
      }
      expect(session.currentHand.phase).toBe("complete");
      if (handNumber === 8) break;

      session = startNextHand(session);
      const aiProfiles = session.roster.filter((profile) => !profile.isHuman);
      const leftCount = session.currentHand.events.filter(
        (event) => event.type === "ai-left",
      ).length;
      const joinedCount = session.currentHand.events.filter(
        (event) => event.type === "ai-joined",
      ).length;

      expect(aiProfiles).toHaveLength(config.aiCount);
      expect(new Set(aiProfiles.map((profile) => profile.id)).size).toBe(
        config.aiCount,
      );
      expect(new Set(aiProfiles.map((profile) => profile.name)).size).toBe(
        config.aiCount,
      );
      expect(Object.keys(session.aiStates).sort()).toEqual(
        aiProfiles.map((profile) => profile.id).sort(),
      );
      expect(joinedCount).toBe(leftCount);
    }
  });
});
