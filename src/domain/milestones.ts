import type { HandHistoryRecord } from "@/persistence/database";
import { analyzeHandRecord } from "./statistics";
import type { AccountProfile } from "./types";

export interface StageDefinition {
  id: string;
  label: string;
  minLevel: number;
  maxLevel: number;
  description: string;
}

export interface StageStatistics {
  hands: number;
  wins: number;
  winRate: number;
  netProfit: number;
}

export interface MilestoneDefinition {
  id: string;
  label: string;
  description: string;
  target: number;
  metric: "hands" | "wins" | "netProfit" | "showdowns" | "favorites";
}

export interface MilestoneProgress extends MilestoneDefinition {
  current: number;
  completed: boolean;
  ratio: number;
}

export interface MilestoneOverview {
  stage: StageDefinition;
  stageStatistics: StageStatistics;
  highestLevel: number;
  completedChallenges: number;
  totalChallenges: number;
  challengeCompletion: number;
  challenges: MilestoneProgress[];
}

export const STAGE_DEFINITIONS: readonly StageDefinition[] = [
  {
    id: "novice",
    label: "新手",
    minLevel: 1,
    maxLevel: 2,
    description: "熟悉牌局节奏和基础行动。",
  },
  {
    id: "steady",
    label: "稳定",
    minLevel: 3,
    maxLevel: 5,
    description: "保持稳定决策，建立自己的节奏。",
  },
  {
    id: "advanced",
    label: "进阶",
    minLevel: 6,
    maxLevel: 8,
    description: "开始处理更复杂的底池和对手范围。",
  },
  {
    id: "skilled",
    label: "熟练",
    minLevel: 9,
    maxLevel: 11,
    description: "在不同牌面和筹码深度下保持执行力。",
  },
  {
    id: "expert",
    label: "专家",
    minLevel: 12,
    maxLevel: Number.POSITIVE_INFINITY,
    description: "持续复盘并用长期结果检验决策。",
  },
];

export const MILESTONE_DEFINITIONS: readonly MilestoneDefinition[] = [
  {
    id: "first-hand",
    label: "完成第一手",
    description: "完成至少 1 手正式牌局。",
    target: 1,
    metric: "hands",
  },
  {
    id: "ten-hands",
    label: "熟悉牌桌",
    description: "完成至少 10 手正式牌局。",
    target: 10,
    metric: "hands",
  },
  {
    id: "five-wins",
    label: "赢下五手",
    description: "正式牌局累计获胜 5 手。",
    target: 5,
    metric: "wins",
  },
  {
    id: "profit-1000",
    label: "盈利里程碑",
    description: "正式牌局累计净盈利达到 1,000。",
    target: 1_000,
    metric: "netProfit",
  },
  {
    id: "showdown-three",
    label: "完成三次摊牌",
    description: "完成至少 3 次摊牌。",
    target: 3,
    metric: "showdowns",
  },
  {
    id: "review-three",
    label: "留下三次复盘",
    description: "收藏至少 3 手牌用于复盘。",
    target: 3,
    metric: "favorites",
  },
];

function stageForLevel(level: number): StageDefinition {
  const normalizedLevel = Math.max(1, Math.floor(level));
  return (
    STAGE_DEFINITIONS.find(
      (stage) =>
        normalizedLevel >= stage.minLevel && normalizedLevel <= stage.maxLevel,
    ) ?? STAGE_DEFINITIONS.at(-1)!
  );
}

export function buildMilestoneOverview(
  account: AccountProfile,
  records: HandHistoryRecord[],
): MilestoneOverview {
  const stage = stageForLevel(account.level);
  const analyzed = records.map(analyzeHandRecord);
  const stageHands = analyzed.filter(
    (hand) =>
      hand.playerLevel !== null &&
      hand.playerLevel >= stage.minLevel &&
      hand.playerLevel <= stage.maxLevel,
  );
  const wins = stageHands.filter((hand) => hand.won).length;
  const stageStatistics: StageStatistics = {
    hands: stageHands.length,
    wins,
    winRate: stageHands.length ? wins / stageHands.length : 0,
    netProfit: stageHands.reduce((sum, hand) => sum + hand.netProfit, 0),
  };
  const metricValues: Record<MilestoneDefinition["metric"], number> = {
    hands: analyzed.length,
    wins: analyzed.filter((hand) => hand.won).length,
    netProfit: analyzed.reduce((sum, hand) => sum + hand.netProfit, 0),
    showdowns: analyzed.filter((hand) => hand.wentToShowdown).length,
    favorites: analyzed.filter((hand) => hand.record.favorite).length,
  };
  const challenges = MILESTONE_DEFINITIONS.map((definition) => {
    const current = metricValues[definition.metric];
    const ratio = Math.min(1, Math.max(0, current / definition.target));
    return {
      ...definition,
      current,
      completed: current >= definition.target,
      ratio,
    };
  });
  const completedChallenges = challenges.filter(
    (challenge) => challenge.completed,
  ).length;
  return {
    stage,
    stageStatistics,
    highestLevel: Math.max(account.highestLevel, account.level),
    completedChallenges,
    totalChallenges: challenges.length,
    challengeCompletion: challenges.length
      ? completedChallenges / challenges.length
      : 0,
    challenges,
  };
}
