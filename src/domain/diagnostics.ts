import {
  matchAiProfiles,
  getAiMatchingGuide,
  MIN_AI_TIER,
  MAX_AI_TIER,
} from "./matching";
import { analyzeHandRecord } from "./statistics";
import type { HandHistoryRecord } from "@/persistence/database";
import type { PlayerActionType } from "./types";

const SAMPLE_ROUNDS = 120;
const SAMPLE_TABLE_SIZE = 5;

export interface AiActionBreakdown {
  action: PlayerActionType;
  label: string;
  count: number;
  ratio: number;
}

export interface AiDifficultyDistribution {
  tier: number;
  count: number;
  ratio: number;
}

export interface FairnessDiagnostics {
  sampleCount: number;
  level: number;
  matchingMinTier: number;
  matchingMaxTier: number;
  difficultyDistribution: AiDifficultyDistribution[];
  actionBreakdown: AiActionBreakdown[];
  averageResponseMilliseconds: number | null;
  aiDepartureRate: number;
  analyzedHands: number;
  netProfit: number;
  winRate: number;
}

const ACTIONS: Array<{ action: PlayerActionType; label: string }> = [
  { action: "fold", label: "弃牌" },
  { action: "check", label: "过牌" },
  { action: "call", label: "跟注" },
  { action: "bet", label: "下注" },
  { action: "raise", label: "加注" },
  { action: "all-in", label: "全下" },
];

function responseMilliseconds(records: HandHistoryRecord[]): number | null {
  const durations: number[] = [];
  for (const record of records) {
    const aiIds = new Set(
      record.hand.players
        .filter((player) => !player.isHuman)
        .map((player) => player.id),
    );
    const events = record.hand.events;
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (!event) continue;
      if (
        event.type !== "player-acted" ||
        !event.playerId ||
        !aiIds.has(event.playerId)
      )
        continue;
      const previous = events[index - 1];
      if (!previous) continue;
      const elapsed =
        Date.parse(event.createdAt) - Date.parse(previous.createdAt);
      if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 60_000)
        durations.push(elapsed);
    }
  }
  if (!durations.length) return null;
  return Math.round(
    durations.reduce((sum, value) => sum + value, 0) / durations.length,
  );
}

export function buildFairnessDiagnostics(
  playerLevel: number,
  records: HandHistoryRecord[] = [],
): FairnessDiagnostics {
  const level = Math.max(1, Math.floor(playerLevel));
  const guide = getAiMatchingGuide(level);
  const counts = new Map<number, number>();
  let sampleCount = 0;
  for (let round = 0; round < SAMPLE_ROUNDS; round += 1) {
    const profiles = matchAiProfiles(
      level,
      SAMPLE_TABLE_SIZE,
      `diagnostics:${level}:${round}`,
    );
    for (const profile of profiles) {
      counts.set(profile.tier, (counts.get(profile.tier) ?? 0) + 1);
      sampleCount += 1;
    }
  }
  const difficultyDistribution = Array.from(
    { length: MAX_AI_TIER - MIN_AI_TIER + 1 },
    (_, index) => {
      const tier = MIN_AI_TIER + index;
      const count = counts.get(tier) ?? 0;
      return { tier, count, ratio: sampleCount ? count / sampleCount : 0 };
    },
  );

  const actionCounts = new Map<PlayerActionType, number>();
  let actionTotal = 0;
  let departureHands = 0;
  for (const record of records) {
    const aiIds = new Set(
      record.hand.players
        .filter((player) => !player.isHuman)
        .map((player) => player.id),
    );
    for (const event of record.hand.events) {
      if (
        event.type === "player-acted" &&
        event.playerId &&
        aiIds.has(event.playerId) &&
        event.action &&
        ["fold", "check", "call", "bet", "raise", "all-in"].includes(
          event.action,
        )
      ) {
        const action = event.action as PlayerActionType;
        actionCounts.set(action, (actionCounts.get(action) ?? 0) + 1);
        actionTotal += 1;
      }
    }
    if (record.hand.events.some((event) => event.type === "ai-left"))
      departureHands += 1;
  }
  const actionBreakdown = ACTIONS.map(({ action, label }) => {
    const count = actionCounts.get(action) ?? 0;
    return {
      action,
      label,
      count,
      ratio: actionTotal ? count / actionTotal : 0,
    };
  });
  const analyzed = records.map(analyzeHandRecord);
  return {
    sampleCount,
    level,
    matchingMinTier: guide.minimumTier,
    matchingMaxTier: guide.maximumTier,
    difficultyDistribution,
    actionBreakdown,
    averageResponseMilliseconds: responseMilliseconds(records),
    aiDepartureRate: analyzed.length ? departureHands / analyzed.length : 0,
    analyzedHands: analyzed.length,
    netProfit: analyzed.reduce((sum, hand) => sum + hand.netProfit, 0),
    winRate: analyzed.length
      ? analyzed.filter((hand) => hand.won).length / analyzed.length
      : 0,
  };
}
