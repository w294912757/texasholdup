import { describe, expect, it } from "vitest";
import {
  difficultyBandForTier,
  matchAiProfiles,
  matchReplacementAiProfile,
  publicAiProfile,
} from "@/domain/matching";

describe("probability-based matching", () => {
  it("keeps a full table internally diverse", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const profiles = matchAiProfiles(5, 5, seed);
      expect(
        new Set(profiles.map((profile) => profile.band)).size,
      ).toBeGreaterThanOrEqual(2);
      expect(new Set(profiles.map((profile) => profile.name)).size).toBe(5);
    }
  });

  it("lets low-level players encounter stronger opponents", () => {
    const profiles = Array.from(
      { length: 400 },
      (_, seed) => matchAiProfiles(1, 1, seed)[0],
    );
    const stronger = profiles.filter(
      (profile) => profile?.band === "higher",
    ).length;
    expect(stronger).toBeGreaterThan(80);
  });

  it("lets high-level players encounter weaker opponents", () => {
    const profiles = Array.from(
      { length: 400 },
      (_, seed) => matchAiProfiles(10, 1, seed)[0],
    );
    const weaker = profiles.filter(
      (profile) => profile?.band === "lower",
    ).length;
    expect(weaker).toBeGreaterThan(80);
  });

  it("removes difficulty from the public profile", () => {
    const internalProfile = matchAiProfiles(4, 1, "public-view")[0]!;
    const visibleProfile = publicAiProfile(internalProfile);

    expect(visibleProfile).not.toHaveProperty("tier");
    expect(visibleProfile).not.toHaveProperty("band");
  });

  it("matches a replacement inside the current level bands", () => {
    const profile = matchReplacementAiProfile(8, "replacement", "ai-2-h4", [
      "林默",
      "周澈",
      "陈乔",
    ]);

    expect(profile.id).toBe("ai-2-h4");
    expect(["林默", "周澈", "陈乔"]).not.toContain(profile.name);
    expect(profile.band).toBe(difficultyBandForTier(8, profile.tier));
  });

  it("can force a different available band to keep the table diverse", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      expect(
        matchReplacementAiProfile(6, seed, `replacement-${seed}`, [], "peer")
          .band,
      ).not.toBe("peer");
    }
  });
});
