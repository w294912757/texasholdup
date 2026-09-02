import type { Card, HandState, Rank } from "./types";
import type { HandHistoryRecord } from "@/persistence/database";

export const STATISTICS_VERSION = 1;

export type TablePosition =
  | "button"
  | "button-small-blind"
  | "small-blind"
  | "big-blind"
  | "under-the-gun"
  | "hijack"
  | "cutoff"
  | "other";

export const POSITION_LABELS: Record<TablePosition, string> = {
  button: "按钮位",
  "button-small-blind": "按钮位 / 小盲",
  "small-blind": "小盲",
  "big-blind": "大盲",
  "under-the-gun": "枪口位",
  hijack: "劫持位",
  cutoff: "关煞位",
  other: "其他",
};

export interface HandStatistic {
  record: HandHistoryRecord;
  date: string;
  position: TablePosition;
  startingHand: string;
  playerLevel: number | null;
  leftTable: boolean;
  won: boolean;
  netProfit: number;
  wentToShowdown: boolean;
  voluntarilyPutMoneyInPot: boolean;
  preflopRaised: boolean;
}

export interface StatisticsFilters {
  dateFrom: string;
  dateTo: string;
  position: TablePosition | "all";
  startingHand: string;
  playerLevel: number | "all" | "unknown";
  tableResult: "all" | "completed" | "left";
  favoriteOnly: boolean;
}

export interface StatisticsSummary {
  totalHands: number;
  wonHands: number;
  netProfit: number;
  winRate: number;
  showdownRate: number;
  showdownWinRate: number;
  vpipRate: number;
  pfrRate: number;
}

export interface StatisticsTrend {
  date: string;
  hands: number;
  netProfit: number;
  cumulativeNet: number;
}

const rankStrength: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const positionsByPlayerCount: Record<number, TablePosition[]> = {
  2: ["button-small-blind", "big-blind"],
  3: ["button", "small-blind", "big-blind"],
  4: ["button", "small-blind", "big-blind", "under-the-gun"],
  5: ["button", "small-blind", "big-blind", "under-the-gun", "cutoff"],
  6: [
    "button",
    "small-blind",
    "big-blind",
    "under-the-gun",
    "hijack",
    "cutoff",
  ],
};

function localDate(isoDate: string): string {
  const date = new Date(isoDate);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function tablePosition(hand: HandState, humanSeat: number): TablePosition {
  const orderedSeats = hand.players
    .map((player) => player.seat)
    .sort((a, b) => a - b);
  const dealerIndex = orderedSeats.indexOf(hand.dealerSeat);
  const humanIndex = orderedSeats.indexOf(humanSeat);
  if (dealerIndex < 0 || humanIndex < 0) return "other";
  const offset =
    (humanIndex - dealerIndex + orderedSeats.length) % orderedSeats.length;
  return positionsByPlayerCount[orderedSeats.length]?.[offset] ?? "other";
}

export function normalizeStartingHand(cards: Card[]): string {
  if (cards.length !== 2) return "未知";
  const ordered = [...cards].sort(
    (left, right) =>
      rankStrength[right[0] as Rank] - rankStrength[left[0] as Rank],
  );
  const firstRank = ordered[0]![0] as Rank;
  const secondRank = ordered[1]![0] as Rank;
  if (firstRank === secondRank) return `${firstRank}${secondRank}`;
  return `${firstRank}${secondRank}${ordered[0]![1] === ordered[1]![1] ? "s" : "o"}`;
}

function preflopFlags(
  hand: HandState,
  humanId: string,
): {
  voluntarilyPutMoneyInPot: boolean;
  preflopRaised: boolean;
} {
  let highestTarget = 0;
  let voluntarilyPutMoneyInPot = false;
  let preflopRaised = false;
  for (const event of hand.events) {
    if (event.phase !== "preflop") continue;
    const target = event.targetAmount ?? 0;
    if (event.type === "player-acted" && event.playerId === humanId) {
      if (
        (event.action === "call" ||
          event.action === "bet" ||
          event.action === "raise" ||
          event.action === "all-in") &&
        (event.amount ?? 0) > 0
      )
        voluntarilyPutMoneyInPot = true;
      if (
        (event.action === "bet" ||
          event.action === "raise" ||
          event.action === "all-in") &&
        target > highestTarget
      )
        preflopRaised = true;
    }
    if (event.type === "blind-posted" || event.type === "player-acted")
      highestTarget = Math.max(highestTarget, target);
  }
  return { voluntarilyPutMoneyInPot, preflopRaised };
}

export function analyzeHandRecord(record: HandHistoryRecord): HandStatistic {
  const human = record.hand.players.find((player) => player.isHuman);
  if (!human) throw new Error("手牌记录缺少真人玩家");
  const amountWon = record.hand.events
    .filter(
      (event) => event.type === "pot-awarded" && event.playerId === human.id,
    )
    .reduce((sum, event) => sum + (event.amount ?? 0), 0);
  const preflop = preflopFlags(record.hand, human.id);
  return {
    record,
    date: localDate(record.createdAt),
    position: tablePosition(record.hand, human.seat),
    startingHand: normalizeStartingHand(human.holeCards),
    playerLevel: record.playerLevel,
    leftTable: record.leftTable,
    won: record.hand.winnerIds.includes(human.id),
    netProfit: amountWon - human.committedHand,
    wentToShowdown:
      !human.folded &&
      record.hand.events.some((event) => event.phase === "showdown"),
    ...preflop,
  };
}

export function filterHandStatistics(
  hands: HandStatistic[],
  filters: StatisticsFilters,
): HandStatistic[] {
  const startingHand = filters.startingHand.trim().toLocaleLowerCase("en-US");
  return hands.filter((hand) => {
    if (filters.dateFrom && hand.date < filters.dateFrom) return false;
    if (filters.dateTo && hand.date > filters.dateTo) return false;
    if (filters.position !== "all" && hand.position !== filters.position)
      return false;
    if (
      startingHand &&
      !hand.startingHand.toLocaleLowerCase("en-US").includes(startingHand)
    )
      return false;
    if (
      filters.playerLevel !== "all" &&
      (filters.playerLevel === "unknown"
        ? hand.playerLevel !== null
        : hand.playerLevel !== filters.playerLevel)
    )
      return false;
    if (filters.tableResult === "left" && !hand.leftTable) return false;
    if (filters.tableResult === "completed" && hand.leftTable) return false;
    if (filters.favoriteOnly && !hand.record.favorite) return false;
    return true;
  });
}

export function summarizeHandStatistics(
  hands: HandStatistic[],
): StatisticsSummary {
  const totalHands = hands.length;
  const wonHands = hands.filter((hand) => hand.won).length;
  const showdownHands = hands.filter((hand) => hand.wentToShowdown);
  const showdownWins = showdownHands.filter((hand) => hand.won).length;
  const ratio = (count: number, total = totalHands) =>
    total > 0 ? count / total : 0;
  return {
    totalHands,
    wonHands,
    netProfit: hands.reduce((sum, hand) => sum + hand.netProfit, 0),
    winRate: ratio(wonHands),
    showdownRate: ratio(showdownHands.length),
    showdownWinRate: ratio(showdownWins, showdownHands.length),
    vpipRate: ratio(
      hands.filter((hand) => hand.voluntarilyPutMoneyInPot).length,
    ),
    pfrRate: ratio(hands.filter((hand) => hand.preflopRaised).length),
  };
}

export function buildStatisticsTrend(
  hands: HandStatistic[],
): StatisticsTrend[] {
  const grouped = new Map<string, { hands: number; netProfit: number }>();
  for (const hand of hands) {
    const day = grouped.get(hand.date) ?? { hands: 0, netProfit: 0 };
    day.hands += 1;
    day.netProfit += hand.netProfit;
    grouped.set(hand.date, day);
  }
  let cumulativeNet = 0;
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, day]) => {
      cumulativeNet += day.netProfit;
      return { date, ...day, cumulativeNet };
    });
}
