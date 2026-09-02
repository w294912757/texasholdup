import type { AccountProfile, ExperienceResult } from "./types";

export const INITIAL_BANKROLL = 10_000;
export const STANDARD_BUY_IN = 1_000;
export const MINIMUM_BUY_IN = 500;
export const BAILOUT_AMOUNT = 1_000;

export function experienceThreshold(level: number): number {
  return level * 100;
}

export function calculateSessionExperience(
  netProfit: number,
  completedHands: number,
): number {
  if (netProfit <= 0 || completedHands <= 0) return 0;

  const profitScore = Math.floor(netProfit / 10);
  const handScore = completedHands * 2;
  return Math.min(500, Math.max(25, profitScore + handScore));
}

export function applyExperience(
  account: AccountProfile,
  gained: number,
): ExperienceResult {
  const levelBefore = account.level;
  let level = account.level;
  let currentLevelXp = account.currentLevelXp + Math.max(0, gained);

  while (currentLevelXp >= experienceThreshold(level)) {
    currentLevelXp -= experienceThreshold(level);
    level += 1;
  }

  return {
    gained: Math.max(0, gained),
    levelBefore,
    levelAfter: level,
    currentLevelXp,
    lifetimeXp: account.lifetimeXp + Math.max(0, gained),
  };
}

export function downgradeLevel(
  account: AccountProfile,
  targetLevel: number,
): AccountProfile {
  if (
    !Number.isInteger(targetLevel) ||
    targetLevel < 1 ||
    targetLevel >= account.level
  ) {
    throw new Error("只能降到低于当前等级的有效等级");
  }

  return {
    ...account,
    level: targetLevel,
    currentLevelXp: 0,
    updatedAt: new Date().toISOString(),
  };
}
