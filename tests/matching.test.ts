import { describe, expect, it } from "vitest";
import {
  difficultyBandForTier,
  getAiMatchingGuide,
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
    expect(stronger).toBeGreaterThan(40);
    expect(stronger).toBeLessThan(90);
    expect(Math.max(...profiles.map((profile) => profile?.tier ?? 0))).toBe(3);
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

  it("reports the effective matching guide from the same probability rules", () => {
    const beginnerGuide = getAiMatchingGuide(1);
    expect(beginnerGuide).toMatchObject({
      playerLevel: 1,
      scaleLevel: 1,
      minimumTier: 1,
      maximumTier: 3,
    });
    expect(beginnerGuide.bands.map((band) => band.tiers)).toEqual([
      [],
      [1, 2],
      [3],
    ]);
    expect(beginnerGuide.bands[0]?.probability).toBe(0);
    expect(beginnerGuide.bands[1]?.probability).toBe(0.85);
    expect(beginnerGuide.bands[2]?.probability).toBe(0.15);

    const middleGuide = getAiMatchingGuide(5);
    expect(middleGuide).toMatchObject({
      minimumTier: 1,
      maximumTier: 7,
    });
    expect(middleGuide.bands.map((band) => band.tiers)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7],
    ]);
    expect(middleGuide.bands.map((band) => band.probability)).toEqual([
      0.15, 0.65, 0.2,
    ]);

    const aboveScaleGuide = getAiMatchingGuide(18);
    expect(aboveScaleGuide.scaleLevel).toBe(12);
    expect(aboveScaleGuide.minimumTier).toBe(8);
    expect(aboveScaleGuide.maximumTier).toBe(12);
    expect(aboveScaleGuide.bands[2]?.probability).toBe(0);
  });

  it.each([
    [1, 1, 3, [0, 0.85, 0.15]],
    [2, 1, 4, [0, 0.8, 0.2]],
    [3, 1, 5, [0.1, 0.7, 0.2]],
    [4, 1, 6, [0.15, 0.65, 0.2]],
    [5, 1, 7, [0.15, 0.65, 0.2]],
    [6, 2, 8, [0.2, 0.6, 0.2]],
    [7, 3, 9, [0.2, 0.6, 0.2]],
    [8, 4, 10, [0.25, 0.6, 0.15]],
    [9, 5, 11, [0.25, 0.6, 0.15]],
    [10, 6, 12, [0.3, 0.55, 0.15]],
    [11, 7, 12, [0.35, 0.65, 0]],
    [12, 8, 12, [0.35, 0.65, 0]],
  ])(
    "uses the calibrated window and weights at level %i",
    (level, minimumTier, maximumTier, expectedWeights) => {
      const guide = getAiMatchingGuide(level);
      expect(guide.minimumTier).toBe(minimumTier);
      expect(guide.maximumTier).toBe(maximumTier);
      guide.bands.forEach((band, index) => {
        expect(band.probability).toBeCloseTo(expectedWeights[index] ?? 0);
      });

      const profiles = Array.from(
        { length: 1_200 },
        (_, seed) => matchAiProfiles(level, 1, seed)[0]!,
      );
      expect(Math.min(...profiles.map((profile) => profile.tier))).toBe(
        minimumTier,
      );
      expect(Math.max(...profiles.map((profile) => profile.tier))).toBe(
        maximumTier,
      );
      guide.bands.forEach((band) => {
        const actualProbability =
          profiles.filter((profile) => profile.band === band.band).length /
          profiles.length;
        expect(actualProbability).toBeCloseTo(band.probability, 1);
      });
    },
  );
});
