import { Hand } from "pokersolver";
import { createDeck, createRandom } from "./cards";
import type { Card, HandPhase, PlayerActionType } from "./types";
import type { HandHistoryRecord } from "@/persistence/database";

const REVIEW_SAMPLES = 120;

export interface HandReviewSummary {
  totalInvested: number;
  totalWon: number;
  netResult: number;
  maxPot: number;
  maxSingleWin: number;
  vpip: number;
  raiseRate: number;
  callRate: number;
  foldRate: number;
  showdown: boolean;
  showdownWinRate: number;
}

export interface KeyDecision {
  seq: number;
  phase: HandPhase;
  action: PlayerActionType;
  amount: number;
  pot: number;
  reasons: string[];
  estimated: true;
}

export interface EquityTimelinePoint {
  seq: number;
  phase: HandPhase;
  equity: number;
  potOdds: number;
  stackToPot: number;
  estimated: true;
}

export interface AlternativeActionResult {
  decisionSeq: number;
  action: string;
  equity: number;
  expectedValue: number;
  estimated: true;
}

const boardCardCount: Record<HandPhase, number> = {
  preflop: 0,
  flop: 3,
  turn: 4,
  river: 5,
  showdown: 5,
  complete: 5,
};

const contributionActions = new Set<
  PlayerActionType | "small-blind" | "big-blind"
>(["small-blind", "big-blind", "call", "bet", "raise", "all-in"]);

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function visibleBoard(record: HandHistoryRecord, phase: HandPhase): Card[] {
  return record.hand.board.slice(0, boardCardCount[phase]);
}

function publicPlayers(record: HandHistoryRecord, seq: number) {
  const folded = new Set<string>();
  for (const event of record.hand.events) {
    if (event.seq > seq) break;
    if (event.action === "fold" && event.playerId) folded.add(event.playerId);
  }
  return record.hand.players.filter(
    (player) => !player.isHuman && !folded.has(player.id),
  );
}

function estimatePublicEquity(
  record: HandHistoryRecord,
  seq: number,
  phase: HandPhase,
): number {
  const human = record.hand.players.find((player) => player.isHuman);
  if (!human || human.holeCards.length !== 2) return 0;
  const opponents = publicPlayers(record, seq).length;
  if (!opponents) return 1;
  const board = visibleBoard(record, phase);
  const known = new Set<Card>([...human.holeCards, ...board]);
  const unknown = createDeck().filter((card) => !known.has(card));
  const random = createRandom(`${record.hand.id}:review:${seq}:${phase}`);
  const needed = opponents * 2 + (5 - board.length);
  let score = 0;
  for (let sample = 0; sample < REVIEW_SAMPLES; sample += 1) {
    const draw = [...unknown];
    for (let index = 0; index < needed; index += 1) {
      const target = index + Math.floor(random() * (draw.length - index));
      [draw[index], draw[target]] = [draw[target]!, draw[index]!];
    }
    const completedBoard = [...board, ...draw.slice(opponents * 2)];
    const humanHand = Hand.solve([...human.holeCards, ...completedBoard]);
    const opponentHands = Array.from({ length: opponents }, (_, index) =>
      Hand.solve([draw[index * 2]!, draw[index * 2 + 1]!, ...completedBoard]),
    );
    const winners = Hand.winners([humanHand, ...opponentHands]);
    if (winners.includes(humanHand)) score += 1 / winners.length;
  }
  return round(score / REVIEW_SAMPLES);
}

export function buildHandReviewSummary(
  record: HandHistoryRecord,
): HandReviewSummary {
  const humanId = record.hand.players.find((player) => player.isHuman)?.id;
  const events = record.hand.events;
  const humanActions = events.filter(
    (event) => event.playerId === humanId && event.type === "player-acted",
  );
  const preflopActions = humanActions.filter(
    (event) => event.phase === "preflop",
  );
  const voluntary = preflopActions.filter(
    (event) => event.action !== "fold" && (event.amount ?? 0) > 0,
  );
  const raises = humanActions.filter(
    (event) =>
      event.action === "raise" ||
      event.action === "bet" ||
      event.action === "all-in",
  );
  const calls = humanActions.filter((event) => event.action === "call");
  const folds = humanActions.filter((event) => event.action === "fold");
  const totalInvested = events
    .filter(
      (event) =>
        event.playerId === humanId && contributionActions.has(event.action!),
    )
    .reduce((sum, event) => sum + (event.amount ?? 0), 0);
  const totalWon = events
    .filter(
      (event) => event.type === "pot-awarded" && event.playerId === humanId,
    )
    .reduce((sum, event) => sum + (event.amount ?? 0), 0);
  const showdown = events.some((event) => event.phase === "showdown");
  const showdownWins =
    showdown && record.hand.winnerIds.includes(humanId ?? "") ? 1 : 0;
  return {
    totalInvested,
    totalWon,
    netResult: totalWon - totalInvested,
    maxPot: Math.max(0, ...events.map((event) => event.pot)),
    maxSingleWin: Math.max(
      0,
      ...events
        .filter(
          (event) => event.type === "pot-awarded" && event.playerId === humanId,
        )
        .map((event) => event.amount ?? 0),
    ),
    vpip: preflopActions.length ? voluntary.length / preflopActions.length : 0,
    raiseRate: humanActions.length ? raises.length / humanActions.length : 0,
    callRate: humanActions.length ? calls.length / humanActions.length : 0,
    foldRate: humanActions.length ? folds.length / humanActions.length : 0,
    showdown,
    showdownWinRate: showdown ? showdownWins : 0,
  };
}

export function findKeyDecisions(record: HandHistoryRecord): KeyDecision[] {
  const humanId = record.hand.players.find((player) => player.isHuman)?.id;
  const bigBlind = record.hand.bigBlind;
  return record.hand.events
    .filter(
      (event) =>
        event.type === "player-acted" &&
        event.playerId === humanId &&
        Boolean(event.action),
    )
    .map((event) => {
      const amount = event.amount ?? 0;
      const reasons: string[] = [];
      if (event.action === "all-in") reasons.push("全下");
      if (event.pot >= bigBlind * 10 && amount >= event.pot * 0.5)
        reasons.push("大额底池行动");
      if (event.phase === "river" && amount >= bigBlind * 3)
        reasons.push("河牌高额下注");
      if (event.action === "call" && amount / Math.max(1, event.pot) >= 0.25)
        reasons.push("赔率极限跟注");
      if (!reasons.length) reasons.push("可能改变结果的决策");
      return {
        seq: event.seq,
        phase: event.phase,
        action: event.action as PlayerActionType,
        amount,
        pot: event.pot,
        reasons,
        estimated: true as const,
      };
    })
    .filter((decision) => decision.reasons.length > 0);
}

export function buildEquityTimeline(
  record: HandHistoryRecord,
): EquityTimelinePoint[] {
  const humanId = record.hand.players.find((player) => player.isHuman)?.id;
  return record.hand.events
    .filter(
      (event) => event.playerId === humanId && event.type === "player-acted",
    )
    .map((event) => {
      const equity = estimatePublicEquity(record, event.seq, event.phase);
      const amount = event.action === "call" ? (event.amount ?? 0) : 0;
      return {
        seq: event.seq,
        phase: event.phase,
        equity,
        potOdds: round(amount / Math.max(1, event.pot)),
        stackToPot: round(
          (record.hand.players.find((player) => player.id === humanId)?.stack ??
            0) / Math.max(1, event.pot),
        ),
        estimated: true as const,
      };
    });
}

export function simulateAlternativeActions(
  record: HandHistoryRecord,
  decision: KeyDecision,
): AlternativeActionResult[] {
  const equity = estimatePublicEquity(record, decision.seq, decision.phase);
  const alternatives = ["弃牌", "过牌/跟注", "下注/加注", "全下"].filter(
    (action) => action !== actionLabel(decision.action),
  );
  return alternatives.map((action) => ({
    decisionSeq: decision.seq,
    action,
    equity,
    expectedValue: round(
      equity * decision.pot - (1 - equity) * decision.amount,
    ),
    estimated: true as const,
  }));
}

function actionLabel(action: PlayerActionType): string {
  if (action === "fold") return "弃牌";
  if (action === "check" || action === "call") return "过牌/跟注";
  if (action === "all-in") return "全下";
  return "下注/加注";
}
