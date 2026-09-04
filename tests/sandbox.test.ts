import { describe, expect, it } from "vitest";
import {
  createSandboxCase,
  evaluateSandboxCase,
  loadSandboxCases,
  saveSandboxCase,
} from "@/domain/sandbox";

function baseCase() {
  const value = createSandboxCase();
  value.players = [
    { id: "p1", name: "A", seat: 0, stack: 0, committedHand: 100, holeCards: ["Ah", "Ad"], folded: false },
    { id: "p2", name: "B", seat: 1, stack: 0, committedHand: 100, holeCards: ["Kc", "Kh"], folded: false },
  ];
  value.board = ["As", "Kd", "7c", "4h", "2s"];
  return value;
}

describe("rules sandbox", () => {
  it("settles a main pot and multiple side pots by eligibility", () => {
    const value = baseCase();
    value.players.push({ id: "p3", name: "C", seat: 2, stack: 0, committedHand: 300, holeCards: ["Qc", "Qh"], folded: false });
    value.players[0]!.committedHand = 100;
    value.players[1]!.committedHand = 200;
    const result = evaluateSandboxCase(value);
    expect(result.valid).toBe(true);
    expect(result.pots.map((pot) => pot.amount)).toEqual([300, 200, 100]);
    expect(result.pots[0]?.eligiblePlayerIds).toEqual(["p1", "p2", "p3"]);
    expect(result.pots[1]?.eligiblePlayerIds).toEqual(["p2", "p3"]);
    expect(result.pots[2]?.eligiblePlayerIds).toEqual(["p3"]);
    expect(result.players.reduce((sum, player) => sum + player.awarded, 0)).toBe(600);
  });

  it("splits a tied odd chip according to button order", () => {
    const value = baseCase();
    value.board = ["As", "Ks", "Qs", "Js", "Ts"];
    value.players[0]!.committedHand = 101;
    value.players[1]!.committedHand = 101;
    value.players.push({ id: "p3", name: "Folded", seat: 2, stack: 0, committedHand: 1, holeCards: ["2c", "3c"], folded: true });
    const result = evaluateSandboxCase(value);
    expect(result.valid).toBe(true);
    expect(result.pots[0]?.winnerIds).toEqual(["p2", "p1"]);
    expect(result.pots[0]?.awards).toEqual({ p2: 2, p1: 1 });
    expect(result.players.find((player) => player.id === "p3")?.awarded).toBe(0);
  });

  it("rejects duplicate cards and illegal action amounts", () => {
    const value = baseCase();
    value.players[1]!.holeCards = ["Ah", "Kd"];
    value.actions = [
      { playerId: "p1", action: "bet", amount: 9999 },
      { playerId: "missing", action: "check" },
    ];
    const result = evaluateSandboxCase(value);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("牌面重复"))).toBe(true);
    expect(result.actionErrors).toHaveLength(2);
  });

  it("keeps saved cases in an isolated local namespace", () => {
    const value = baseCase();
    saveSandboxCase(value);
    expect(loadSandboxCases().some((item) => item.id === value.id)).toBe(true);
  });
});
