import { describe, expect, it } from "vitest";
import { matchAiProfiles, publicAiProfile } from "@/domain/matching";

describe("probability-based matching", () => {
  it("keeps a full table internally diverse", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const profiles = matchAiProfiles(5, 5, seed);
      expect(
        new Set(profiles.map((profile) => profile.band)).size,
      ).toBeGreaterThanOrEqual(2);
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
});
