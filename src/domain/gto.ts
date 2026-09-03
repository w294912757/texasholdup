import { Hand } from "pokersolver";
import { createDeck, createRandom } from "./cards";
import { getLegalActions, getPlayerHandType, handPot } from "./engine";
import type {
  Card,
  GameSession,
  HandPhase,
  LegalAction,
  PlayerActionType,
  PlayerState,
} from "./types";

const EQUITY_SAMPLES = 240;

export interface GtoActionMix {
  type: PlayerActionType;
  label: string;
  frequency: number;
}

export interface GtoReference {
  available: boolean;
  status: string;
  phase: HandPhase;
  handType: string | null;
  equity: number | null;
  potOdds: number | null;
  stackToPot: number | null;
  sampleCount: number;
  actions: GtoActionMix[];
  primaryAction: GtoActionMix | null;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function estimateEquity(session: GameSession, human: PlayerState): number {
  const hand = session.currentHand;
  const opponentCount = hand.players.filter(
    (player) => !player.isHuman && !player.folded,
  ).length;
  if (opponentCount === 0) return 1;

  const known = new Set<Card>([...human.holeCards, ...hand.board]);
  const unknown = createDeck().filter((card) => !known.has(card));
  const random = createRandom(
    `${session.seed}:${hand.id}:${hand.actionSeq}:gto`,
  );
  const requiredCards = opponentCount * 2 + (5 - hand.board.length);
  let equity = 0;

  for (let sample = 0; sample < EQUITY_SAMPLES; sample += 1) {
    const draw = [...unknown];
    for (let index = 0; index < requiredCards; index += 1) {
      const target = index + Math.floor(random() * (draw.length - index));
      [draw[index], draw[target]] = [draw[target]!, draw[index]!];
    }
    const completedBoard = [...hand.board, ...draw.slice(opponentCount * 2)];
    const humanHand = Hand.solve([...human.holeCards, ...completedBoard]);
    const opponentHands = Array.from({ length: opponentCount }, (_, index) =>
      Hand.solve([draw[index * 2]!, draw[index * 2 + 1]!, ...completedBoard]),
    );
    const winners = Hand.winners([humanHand, ...opponentHands]);
    if (winners.includes(humanHand)) equity += 1 / winners.length;
  }

  return equity / EQUITY_SAMPLES;
}

function actionWeight(
  action: LegalAction,
  equity: number,
  potOdds: number,
  stackToPot: number,
): number {
  const edge = equity - potOdds;
  if (action.type === "fold") return clamp(0.5 + potOdds - equity, 0.02, 0.92);
  if (action.type === "call") return clamp(0.38 + edge * 1.15, 0.05, 0.88);
  if (action.type === "check") return clamp(0.82 - equity * 0.48, 0.18, 0.86);
  if (action.type === "all-in") {
    return clamp(
      (equity - 0.7) * 1.5 + (stackToPot <= 1 ? 0.12 : 0.01),
      0.01,
      0.56,
    );
  }
  return clamp((equity - 0.4) * 1.35 + (edge > 0.15 ? 0.1 : 0.04), 0.03, 0.78);
}

function normalizeMix(
  legalActions: LegalAction[],
  equity: number,
  potOdds: number,
  stackToPot: number,
): GtoActionMix[] {
  const weighted = legalActions.map((action) => ({
    action,
    weight: actionWeight(action, equity, potOdds, stackToPot),
  }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const exact = weighted.map((entry) => (entry.weight / total) * 100);
  const frequencies = exact.map(Math.floor);
  let remainder = 100 - frequencies.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction);

  for (const entry of order) {
    if (remainder <= 0) break;
    frequencies[entry.index] = (frequencies[entry.index] ?? 0) + 1;
    remainder -= 1;
  }

  return weighted.map(({ action }, index) => ({
    type: action.type,
    label: action.label,
    frequency: frequencies[index] ?? 0,
  }));
}

export function calculateGtoReference(session: GameSession): GtoReference {
  const hand = session.currentHand;
  const human = hand.players.find((player) => player.isHuman);
  const base = {
    phase: hand.phase,
    handType: human ? getPlayerHandType(human, hand.board) : null,
    sampleCount: EQUITY_SAMPLES,
  };

  if (!human || human.folded || hand.phase === "complete") {
    return {
      ...base,
      available: false,
      status: human?.folded ? "本手已弃牌" : "本手已结束",
      equity: null,
      potOdds: null,
      stackToPot: null,
      actions: [],
      primaryAction: null,
    };
  }

  const legalActions = getLegalActions(session, human.id);
  if (!legalActions.length) {
    return {
      ...base,
      available: false,
      status: "等待你的行动回合",
      equity: null,
      potOdds: null,
      stackToPot: null,
      actions: [],
      primaryAction: null,
    };
  }

  const pot = handPot(hand);
  const callAmount = Math.max(0, hand.currentBet - human.committedRound);
  const potOdds = callAmount / Math.max(1, pot + callAmount);
  const stackToPot = human.stack / Math.max(session.config.bigBlind, pot);
  const equity = estimateEquity(session, human);
  const actions = normalizeMix(legalActions, equity, potOdds, stackToPot);
  const primaryAction =
    [...actions].sort((left, right) => right.frequency - left.frequency)[0] ??
    null;

  return {
    ...base,
    available: true,
    status: "当前决策可用",
    equity,
    potOdds,
    stackToPot,
    actions,
    primaryAction,
  };
}
