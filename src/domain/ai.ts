import { Hand } from "pokersolver";
import { cardRank, cardSuit, createRandom } from "./cards";
import { getLegalActions, handPot } from "./engine";
import type { Card, GameSession, PlayerAction, PlayerState } from "./types";

const rankValue: Record<string, number> = {
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

const postflopStrength: Record<string, number> = {
  "High Card": 0.16,
  Pair: 0.34,
  "Two Pair": 0.53,
  "Three of a Kind": 0.66,
  Straight: 0.76,
  Flush: 0.82,
  "Full House": 0.9,
  "Four of a Kind": 0.97,
  "Straight Flush": 1,
  "Royal Flush": 1,
};

function preflopScore(cards: Card[]): number {
  const [first, second] = cards;
  if (!first || !second) return 0;
  const firstValue = rankValue[cardRank(first)] ?? 2;
  const secondValue = rankValue[cardRank(second)] ?? 2;
  const high = Math.max(firstValue, secondValue);
  const low = Math.min(firstValue, secondValue);
  const pairBonus = firstValue === secondValue ? 0.35 + high / 35 : 0;
  const suitedBonus = cardSuit(first) === cardSuit(second) ? 0.08 : 0;
  const connectedBonus = Math.abs(firstValue - secondValue) <= 2 ? 0.07 : 0;
  return Math.min(
    1,
    high / 18 + low / 45 + pairBonus + suitedBonus + connectedBonus,
  );
}

function handStrength(player: PlayerState, board: Card[]): number {
  if (board.length === 0) return preflopScore(player.holeCards);
  const solved = Hand.solve([...player.holeCards, ...board]);
  return postflopStrength[solved.name] ?? 0.2;
}

function boundedTarget(
  minTarget: number,
  maxTarget: number,
  preferred: number,
): number {
  return Math.max(minTarget, Math.min(maxTarget, Math.round(preferred)));
}

export function decideAiAction(
  session: GameSession,
  player: PlayerState,
): PlayerAction {
  const legal = getLegalActions(session, player.id);
  if (!legal.length) throw new Error("AI 当前没有合法行动");

  const random = createRandom(
    `${session.seed}:${session.currentHand.id}:${session.currentHand.actionSeq}:${player.id}`,
  );
  const noise = random();
  const tier = player.aiTier ?? 1;
  const skill = Math.min(1, tier / 12);
  const strength = handStrength(player, session.currentHand.board);
  const adjustedStrength = Math.max(
    0,
    Math.min(
      1,
      strength * (0.72 + skill * 0.35) + (noise - 0.5) * (0.38 - skill * 0.25),
    ),
  );
  const call = legal.find((action) => action.type === "call");
  const check = legal.find((action) => action.type === "check");
  const aggressive = legal.find(
    (action) => action.type === "raise" || action.type === "bet",
  );
  const allIn = legal.find((action) => action.type === "all-in");

  if (adjustedStrength > 0.84 && allIn && noise > 0.72)
    return { type: "all-in" };

  if (aggressive && adjustedStrength > 0.58 && noise < 0.35 + skill * 0.35) {
    const pot = Math.max(session.config.bigBlind, handPot(session.currentHand));
    const preferred =
      session.currentHand.currentBet + pot * (0.35 + adjustedStrength * 0.45);
    return {
      type: aggressive.type,
      targetAmount: boundedTarget(
        aggressive.minTarget ?? 0,
        aggressive.maxTarget ?? 0,
        preferred,
      ),
    };
  }

  if (check) return { type: "check" };

  if (call) {
    const callAmount = Math.min(player.stack, call.callAmount ?? 0);
    const potOdds =
      callAmount / Math.max(1, handPot(session.currentHand) + callAmount);
    const threshold = Math.max(0.15, potOdds - skill * 0.08);
    if (
      adjustedStrength >= threshold ||
      callAmount <= session.config.bigBlind * (1 + skill)
    )
      return { type: "call" };
  }

  return { type: "fold" };
}
