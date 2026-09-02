import { describe, expect, it } from "vitest";
import { createShuffledDeck } from "@/domain/cards";

describe("deterministic deck", () => {
  it("creates the same unique deck for the same seed", () => {
    const first = createShuffledDeck("saved-game");
    const second = createShuffledDeck("saved-game");

    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(52);
  });

  it("changes the deck when the seed changes", () => {
    expect(createShuffledDeck("one")).not.toEqual(createShuffledDeck("two"));
  });
});
