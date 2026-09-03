import { createRandom } from "./cards";
import type { AiProfile } from "./types";

export type DifficultyBand = AiProfile["band"];

export interface AiDifficultyGroup {
  label: string;
  minTier: number;
  maxTier: number;
  description: string;
}

export interface AiMatchingBandGuide {
  band: DifficultyBand;
  label: string;
  tiers: number[];
  probability: number;
}

export interface AiMatchingGuide {
  playerLevel: number;
  scaleLevel: number;
  minimumTier: number;
  maximumTier: number;
  bands: AiMatchingBandGuide[];
}

const names = [
  "林默",
  "周澈",
  "陈乔",
  "许宁",
  "沈川",
  "顾言",
  "江寻",
  "陆遥",
  "苏禾",
  "程野",
];
export const MIN_AI_TIER = 1;
export const MAX_AI_TIER = 12;

export const AI_DIFFICULTY_GROUPS: readonly AiDifficultyGroup[] = [
  {
    label: "基础",
    minTier: 1,
    maxTier: 3,
    description: "决策波动较大，进攻频率较低，更偏向直接地响应牌力。",
  },
  {
    label: "稳健",
    minTier: 4,
    maxTier: 6,
    description: "随机误差开始收窄，会结合牌力、底池赔率选择跟注和加注。",
  },
  {
    label: "进阶",
    minTier: 7,
    maxTier: 9,
    description: "判断更稳定，合理继续范围更宽，也会更主动地进行价值下注。",
  },
  {
    label: "专家",
    minTier: 10,
    maxTier: 12,
    description: "决策随机性最低，对牌力与底池赔率的响应最准确，施压更积极。",
  },
];

const weightsByLevel: Array<{
  maxLevel: number;
  weights: Record<DifficultyBand, number>;
}> = [
  { maxLevel: 1, weights: { lower: 0, peer: 0.85, higher: 0.15 } },
  { maxLevel: 2, weights: { lower: 0, peer: 0.8, higher: 0.2 } },
  { maxLevel: 3, weights: { lower: 0.1, peer: 0.7, higher: 0.2 } },
  { maxLevel: 5, weights: { lower: 0.15, peer: 0.65, higher: 0.2 } },
  { maxLevel: 7, weights: { lower: 0.2, peer: 0.6, higher: 0.2 } },
  { maxLevel: 9, weights: { lower: 0.25, peer: 0.6, higher: 0.15 } },
  { maxLevel: 10, weights: { lower: 0.3, peer: 0.55, higher: 0.15 } },
  {
    maxLevel: Number.POSITIVE_INFINITY,
    weights: { lower: 0.35, peer: 0.65, higher: 0 },
  },
];

function candidateTiers(level: number): Record<DifficultyBand, number[]> {
  const normalizedLevel = Math.max(1, Math.min(MAX_AI_TIER, level));
  // Keep early tables approachable, then move a bounded seven-tier window upward.
  const minimumTier = Math.max(MIN_AI_TIER, normalizedLevel - 4);
  const maximumTier = Math.min(MAX_AI_TIER, normalizedLevel + 2);
  const availableTiers = Array.from(
    { length: maximumTier - minimumTier + 1 },
    (_, index) => minimumTier + index,
  );

  return {
    lower: availableTiers.filter((tier) => tier < normalizedLevel - 1),
    peer: availableTiers.filter(
      (tier) => Math.abs(tier - normalizedLevel) <= 1,
    ),
    higher: availableTiers.filter((tier) => tier > normalizedLevel + 1),
  };
}

function normalizedWeights(
  level: number,
  candidates: Record<DifficultyBand, number[]>,
): Record<DifficultyBand, number> {
  const configured =
    weightsByLevel.find((entry) => level <= entry.maxLevel)?.weights ??
    weightsByLevel.at(-1)!.weights;
  const availableBands = (Object.keys(candidates) as DifficultyBand[]).filter(
    (band) => candidates[band].length > 0,
  );
  const availableWeight = availableBands.reduce(
    (sum, band) => sum + configured[band],
    0,
  );

  return {
    lower: candidates.lower.length ? configured.lower / availableWeight : 0,
    peer: candidates.peer.length ? configured.peer / availableWeight : 0,
    higher: candidates.higher.length ? configured.higher / availableWeight : 0,
  };
}

export function getAiMatchingGuide(playerLevel: number): AiMatchingGuide {
  const normalizedPlayerLevel = Math.max(1, Math.floor(playerLevel));
  const scaleLevel = Math.min(MAX_AI_TIER, normalizedPlayerLevel);
  const candidates = candidateTiers(normalizedPlayerLevel);
  const weights = normalizedWeights(normalizedPlayerLevel, candidates);
  const labels: Record<DifficultyBand, string> = {
    lower: "较低水平",
    peer: "接近当前水平",
    higher: "较高水平",
  };
  const bands = (["lower", "peer", "higher"] as DifficultyBand[]).map(
    (band) => ({
      band,
      label: labels[band],
      tiers: [...candidates[band]],
      probability: weights[band],
    }),
  );
  const availableTiers = bands.flatMap((band) => band.tiers);

  return {
    playerLevel: normalizedPlayerLevel,
    scaleLevel,
    minimumTier: Math.min(...availableTiers),
    maximumTier: Math.max(...availableTiers),
    bands,
  };
}

function pickBand(
  randomValue: number,
  weights: Record<DifficultyBand, number>,
): DifficultyBand {
  if (randomValue < weights.lower) return "lower";
  if (randomValue < weights.lower + weights.peer) return "peer";
  return "higher";
}

function pickDifferentBand(
  currentBand: DifficultyBand,
  candidates: Record<DifficultyBand, number[]>,
  weights: Record<DifficultyBand, number>,
): DifficultyBand {
  return (
    (Object.keys(candidates) as DifficultyBand[])
      .filter((band) => band !== currentBand && candidates[band].length > 0)
      .sort((left, right) => weights[right] - weights[left])[0] ?? currentBand
  );
}

export function difficultyBandForTier(
  playerLevel: number,
  tier: number,
): DifficultyBand {
  const normalizedLevel = Math.max(1, Math.min(MAX_AI_TIER, playerLevel));
  if (tier < normalizedLevel - 1) return "lower";
  if (tier > normalizedLevel + 1) return "higher";
  return "peer";
}

export function matchReplacementAiProfile(
  playerLevel: number,
  seed: string | number,
  id: string,
  excludedNames: Iterable<string> = [],
  excludedBand?: DifficultyBand,
): AiProfile {
  const random = createRandom(seed);
  const candidates = candidateTiers(playerLevel);
  if (excludedBand) {
    const availableBandCount = (
      Object.keys(candidates) as DifficultyBand[]
    ).filter((band) => candidates[band].length > 0).length;
    if (availableBandCount > 1) candidates[excludedBand] = [];
  }
  const weights = normalizedWeights(playerLevel, candidates);
  const band = pickBand(random(), weights);
  const tiers = candidates[band];
  const tier =
    tiers[Math.floor(random() * tiers.length)] ??
    Math.max(1, Math.min(MAX_AI_TIER, playerLevel));
  const excluded = new Set(excludedNames);
  const availableNames = names.filter((name) => !excluded.has(name));
  const namePool = availableNames.length ? availableNames : names;
  const nameIndex = Math.floor(random() * namePool.length);
  const name = namePool[nameIndex] ?? `对手 ${id}`;
  const avatarIndex = Math.max(0, names.indexOf(name));

  return {
    id,
    name,
    avatarKey: `avatar-${(avatarIndex % 6) + 1}`,
    tier,
    band,
  };
}

export function matchAiProfiles(
  playerLevel: number,
  count: number,
  seed: string | number,
): AiProfile[] {
  if (count < 1 || count > 5) throw new Error("AI 数量必须在 1 到 5 之间");

  const random = createRandom(seed);
  const candidates = candidateTiers(playerLevel);
  const weights = normalizedWeights(playerLevel, candidates);
  const usedNames = new Set<string>();
  const profiles = Array.from({ length: count }, (_, index) => {
    const band = pickBand(random(), weights);
    const tiers = candidates[band];
    const tier =
      tiers[Math.floor(random() * tiers.length)] ??
      Math.max(1, Math.min(MAX_AI_TIER, playerLevel));
    const availableNames = names.filter((name) => !usedNames.has(name));
    const name =
      availableNames[Math.floor(random() * availableNames.length)] ??
      `对手 ${index + 1}`;
    usedNames.add(name);
    const nameIndex = Math.max(0, names.indexOf(name));

    return {
      id: `ai-${index + 1}`,
      name,
      avatarKey: `avatar-${(nameIndex % 6) + 1}`,
      tier,
      band,
    };
  });

  const availableBandCount = (
    Object.keys(candidates) as DifficultyBand[]
  ).filter((band) => candidates[band].length > 0).length;
  const usedBands = new Set(profiles.map((profile) => profile.band));

  if (count > 1 && availableBandCount > 1 && usedBands.size === 1) {
    const lastProfile = profiles.at(-1);
    if (lastProfile) {
      const replacementBand = pickDifferentBand(
        lastProfile.band,
        candidates,
        weights,
      );
      const tiers = candidates[replacementBand];
      lastProfile.band = replacementBand;
      lastProfile.tier =
        tiers[Math.floor(random() * tiers.length)] ?? lastProfile.tier;
    }
  }

  return profiles;
}

export function publicAiProfile(
  profile: AiProfile,
): Omit<AiProfile, "tier" | "band"> {
  return {
    id: profile.id,
    name: profile.name,
    avatarKey: profile.avatarKey,
  };
}
