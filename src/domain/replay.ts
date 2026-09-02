import type {
  Card,
  GameEvent,
  HandPhase,
  HandState,
  PlayerActionType,
} from "./types";

export interface ReplayPlayer {
  id: string;
  name: string;
  isHuman: boolean;
  stack: number;
  committed: number;
  folded: boolean;
  winner: boolean;
  holeCards: Card[];
}

export interface ReplayFrame {
  index: number;
  event: GameEvent;
  phase: HandPhase;
  board: Card[];
  pot: number;
  players: ReplayPlayer[];
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

export function createReplayFrames(hand: HandState): ReplayFrame[] {
  const awards = new Map<string, number>();
  for (const event of hand.events) {
    if (event.type === "pot-awarded" && event.playerId)
      awards.set(
        event.playerId,
        (awards.get(event.playerId) ?? 0) + (event.amount ?? 0),
      );
  }

  const players: ReplayPlayer[] = hand.players.map((player) => ({
    id: player.id,
    name: player.name,
    isHuman: player.isHuman,
    stack: player.stack + player.committedHand - (awards.get(player.id) ?? 0),
    committed: 0,
    folded: false,
    winner: false,
    holeCards: [...player.holeCards],
  }));

  return hand.events.map((event, index) => {
    const player = event.playerId
      ? players.find((item) => item.id === event.playerId)
      : undefined;
    if (player && event.action === "fold") player.folded = true;
    if (
      player &&
      event.action &&
      contributionActions.has(event.action) &&
      (event.amount ?? 0) > 0
    ) {
      player.stack -= event.amount ?? 0;
      player.committed += event.amount ?? 0;
    }
    if (player && event.type === "pot-awarded")
      player.stack += event.amount ?? 0;

    return {
      index,
      event,
      phase: event.phase,
      board: hand.board.slice(0, boardCardCount[event.phase]),
      pot: event.pot,
      players: players.map((item) => ({
        ...item,
        winner: event.phase === "complete" && hand.winnerIds.includes(item.id),
        holeCards:
          item.isHuman || (event.phase === "complete" && !item.folded)
            ? [...item.holeCards]
            : [],
      })),
    };
  });
}
