export type Suit = "c" | "d" | "h" | "s";
export type Rank =
  "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A";
export type Card = `${Rank}${Suit}`;

export type HandPhase =
  "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";
export type SessionStatus = "active" | "complete" | "abandoned";
export type PlayerActionType =
  "fold" | "check" | "call" | "bet" | "raise" | "all-in";

export interface GameConfig {
  aiCount: number;
  buyIn: number;
  smallBlind: number;
  bigBlind: number;
  maxHands: number;
}

export interface AiProfile {
  id: string;
  name: string;
  avatarKey: string;
  tier: number;
  band: "lower" | "peer" | "higher";
}

export interface SeatProfile {
  id: string;
  name: string;
  seat: number;
  isHuman: boolean;
  avatarKey: string;
  aiTier?: number;
  aiBand?: AiProfile["band"];
}

export interface AiTableState {
  playerId: string;
  joinedHand: number;
  handsPlayed: number;
  entryStack: number;
  lastStack: number;
  recentNetResults: number[];
}

export interface AiRotationDetails {
  seat: number;
  reason: "busted" | "voluntary" | "replacement";
  remainingStack: number;
  handsPlayed: number;
  recentNet: number;
  probability?: number;
  roll?: number;
  aiTier?: number;
  aiBand?: AiProfile["band"];
}

export interface PlayerState extends SeatProfile {
  stack: number;
  holeCards: Card[];
  committedRound: number;
  committedHand: number;
  folded: boolean;
  allIn: boolean;
  lastAction: PlayerActionType | "small-blind" | "big-blind" | null;
}

export interface PotResult {
  amount: number;
  eligiblePlayerIds: string[];
  winnerIds: string[];
}

export interface GameEvent {
  seq: number;
  type:
    | "hand-started"
    | "blind-posted"
    | "cards-dealt"
    | "street-started"
    | "player-acted"
    | "player-left"
    | "ai-left"
    | "ai-joined"
    | "pot-awarded"
    | "hand-complete";
  phase: HandPhase;
  playerId?: string;
  action?: PlayerActionType | "small-blind" | "big-blind";
  amount?: number;
  targetAmount?: number;
  pot: number;
  message: string;
  createdAt: string;
  rotation?: AiRotationDetails;
}

export interface HandState {
  id: string;
  number: number;
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  phase: HandPhase;
  deck: Card[];
  board: Card[];
  players: PlayerState[];
  currentSeat: number | null;
  currentBet: number;
  minRaise: number;
  bigBlind: number;
  pendingPlayerIds: string[];
  actedPlayerIds: string[];
  raiseLockedPlayerIds: string[];
  actionSeq: number;
  events: GameEvent[];
  pots: PotResult[];
  winnerIds: string[];
  completedAt: string | null;
}

export interface GameSession {
  id: string;
  accountId: string;
  accountName: string;
  playerLevel: number;
  config: GameConfig;
  seed: number;
  roster: SeatProfile[];
  stacks: Record<string, number>;
  aiStates: Record<string, AiTableState>;
  currentHand: HandState;
  completedHands: number;
  status: SessionStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlayerAction {
  type: PlayerActionType;
  targetAmount?: number;
}

export interface PlayerActionCommand extends PlayerAction {
  id: string;
  sessionId: string;
  actionSeq: number;
}

export interface LegalAction {
  type: PlayerActionType;
  label: string;
  callAmount?: number;
  minTarget?: number;
  maxTarget?: number;
}

export interface AccountProfile {
  id: string;
  name: string;
  level: number;
  currentLevelXp: number;
  lifetimeXp: number;
  highestLevel: number;
  bankroll: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExperienceResult {
  gained: number;
  levelBefore: number;
  levelAfter: number;
  currentLevelXp: number;
  lifetimeXp: number;
}
