import { Hand } from "pokersolver";
import { createShuffledDeck } from "./cards";
import { matchAiProfiles } from "./matching";
import { rotateAiRoster, type AiRosterChange } from "./roster";
import type {
  Card,
  GameConfig,
  GameEvent,
  GameSession,
  HandPhase,
  HandState,
  LegalAction,
  PlayerAction,
  PlayerState,
  PotResult,
  SeatProfile,
} from "./types";

const HUMAN_ID = "human";

function cloneSession(session: GameSession): GameSession {
  return JSON.parse(JSON.stringify(session)) as GameSession;
}

function now(): string {
  return new Date().toISOString();
}

function totalPot(hand: HandState): number {
  return hand.players.reduce((sum, player) => sum + player.committedHand, 0);
}

function playerById(hand: HandState, playerId: string): PlayerState {
  const player = hand.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error(`找不到玩家 ${playerId}`);
  return player;
}

function playerBySeat(hand: HandState, seat: number): PlayerState {
  const player = hand.players.find((candidate) => candidate.seat === seat);
  if (!player) throw new Error(`找不到座位 ${seat}`);
  return player;
}

function activePlayers(hand: HandState): PlayerState[] {
  return hand.players.filter((player) => !player.folded);
}

function actionablePlayers(hand: HandState): PlayerState[] {
  return hand.players.filter(
    (player) => !player.folded && !player.allIn && player.stack > 0,
  );
}

function orderedPlayersAfter(
  players: PlayerState[],
  seat: number,
): PlayerState[] {
  const tableSize = Math.max(...players.map((player) => player.seat)) + 1;
  return [...players].sort((left, right) => {
    const leftDistance =
      (left.seat - seat + tableSize) % tableSize || tableSize;
    const rightDistance =
      (right.seat - seat + tableSize) % tableSize || tableSize;
    return leftDistance - rightDistance;
  });
}

function nextSeat(
  players: PlayerState[],
  seat: number,
  predicate: (player: PlayerState) => boolean,
): number {
  const nextPlayer = orderedPlayersAfter(players, seat).find(predicate);
  if (!nextPlayer) throw new Error("没有可用的下一座位");
  return nextPlayer.seat;
}

function pushEvent(
  hand: HandState,
  event: Omit<GameEvent, "seq" | "pot" | "createdAt">,
): void {
  hand.actionSeq += 1;
  hand.events.push({
    ...event,
    seq: hand.actionSeq,
    pot: totalPot(hand),
    createdAt: now(),
  });
}

function payChips(player: PlayerState, amount: number): number {
  const paid = Math.min(player.stack, Math.max(0, amount));
  player.stack -= paid;
  player.committedRound += paid;
  player.committedHand += paid;
  player.allIn = player.stack === 0;
  return paid;
}

function postBlind(
  hand: HandState,
  seat: number,
  amount: number,
  action: "small-blind" | "big-blind",
): void {
  const player = playerBySeat(hand, seat);
  const paid = payChips(player, amount);
  player.lastAction = action;
  pushEvent(hand, {
    type: "blind-posted",
    phase: "preflop",
    playerId: player.id,
    action,
    amount: paid,
    targetAmount: player.committedRound,
    message: `${player.name} 投入${action === "small-blind" ? "小盲" : "大盲"} ${paid}`,
  });
}

function dealHoleCards(hand: HandState): void {
  const dealOrder = orderedPlayersAfter(hand.players, hand.dealerSeat);
  for (let round = 0; round < 2; round += 1) {
    for (const player of dealOrder) {
      const card = hand.deck.shift();
      if (!card) throw new Error("牌堆不足");
      player.holeCards.push(card);
    }
  }

  pushEvent(hand, {
    type: "cards-dealt",
    phase: "preflop",
    message: "底牌发放完成",
  });
}

function phaseAfter(phase: HandPhase): HandPhase {
  if (phase === "preflop") return "flop";
  if (phase === "flop") return "turn";
  if (phase === "turn") return "river";
  return "showdown";
}

function dealStreet(hand: HandState, phase: HandPhase): void {
  const burnCard = hand.deck.shift();
  if (!burnCard) throw new Error("牌堆不足以烧牌");
  const count = phase === "flop" ? 3 : 1;

  for (let index = 0; index < count; index += 1) {
    const card = hand.deck.shift();
    if (!card) throw new Error("牌堆不足以发公共牌");
    hand.board.push(card);
  }

  hand.phase = phase;
  hand.currentBet = 0;
  hand.minRaise = hand.bigBlind;
  hand.actedPlayerIds = [];
  hand.raiseLockedPlayerIds = [];
  for (const player of hand.players) player.committedRound = 0;

  pushEvent(hand, {
    type: "street-started",
    phase,
    message: `${phase === "flop" ? "翻牌" : phase === "turn" ? "转牌" : "河牌"}阶段开始`,
  });
}

function bestHands(players: PlayerState[], board: Card[]): Map<string, Hand> {
  return new Map(
    players.map((player) => [
      player.id,
      Hand.solve([...player.holeCards, ...board]),
    ]),
  );
}

const handTypeLabels: Record<string, string> = {
  "Royal Flush": "皇家同花顺",
  "Straight Flush": "同花顺",
  "Four of a Kind": "四条",
  "Full House": "葫芦",
  Flush: "同花",
  Straight: "顺子",
  "Three of a Kind": "三条",
  "Two Pair": "两对",
  Pair: "一对",
  "High Card": "高牌",
};

/** Return the best currently available hand category for a player's visible state. */
export function getPlayerHandType(
  player: PlayerState,
  board: Card[],
): string | null {
  if (player.holeCards.length === 0) return null;
  const solved = Hand.solve([...player.holeCards, ...board]);
  return handTypeLabels[solved.name] ?? solved.name;
}

function buildPots(
  players: PlayerState[],
): Array<{ amount: number; eligiblePlayerIds: string[] }> {
  const levels = [
    ...new Set(
      players
        .map((player) => player.committedHand)
        .filter((amount) => amount > 0),
    ),
  ].sort((left, right) => left - right);
  let previousLevel = 0;

  return levels.map((level) => {
    const contributors = players.filter(
      (player) => player.committedHand >= level,
    );
    const eligiblePlayerIds = contributors
      .filter((player) => !player.folded)
      .map((player) => player.id);
    const amount = (level - previousLevel) * contributors.length;
    previousLevel = level;
    return { amount, eligiblePlayerIds };
  });
}

function winnerOrder(hand: HandState, winnerIds: string[]): string[] {
  return orderedPlayersAfter(hand.players, hand.dealerSeat)
    .map((player) => player.id)
    .filter((playerId) => winnerIds.includes(playerId));
}

function completeHand(hand: HandState, pots: PotResult[]): void {
  hand.pots = pots;
  hand.winnerIds = [...new Set(pots.flatMap((pot) => pot.winnerIds))];
  hand.phase = "complete";
  hand.currentSeat = null;
  hand.pendingPlayerIds = [];
  hand.completedAt = now();
  pushEvent(hand, {
    type: "hand-complete",
    phase: "complete",
    message: "本手牌已结算",
  });
}

function awardUncontested(hand: HandState): void {
  const winner = activePlayers(hand)[0];
  if (!winner) throw new Error("无人可以获得底池");
  const amount = totalPot(hand);
  winner.stack += amount;
  const pot: PotResult = {
    amount,
    eligiblePlayerIds: [winner.id],
    winnerIds: [winner.id],
  };
  pushEvent(hand, {
    type: "pot-awarded",
    phase: hand.phase,
    playerId: winner.id,
    amount,
    message: `${winner.name} 获得底池 ${amount}`,
  });
  completeHand(hand, [pot]);
}

function settleShowdown(hand: HandState): void {
  hand.phase = "showdown";
  const solvedHands = bestHands(activePlayers(hand), hand.board);
  const results: PotResult[] = [];

  for (const pot of buildPots(hand.players)) {
    const eligible = pot.eligiblePlayerIds
      .map((playerId) => ({ playerId, solved: solvedHands.get(playerId) }))
      .filter((entry): entry is { playerId: string; solved: Hand } =>
        Boolean(entry.solved),
      );
    if (!eligible.length) continue;

    const winningHands = Hand.winners(eligible.map((entry) => entry.solved));
    const winnerIds = eligible
      .filter((entry) => winningHands.includes(entry.solved))
      .map((entry) => entry.playerId);
    const orderedWinners = winnerOrder(hand, winnerIds);
    const share = Math.floor(pot.amount / orderedWinners.length);
    let remainder = pot.amount % orderedWinners.length;

    for (const winnerId of orderedWinners) {
      const winner = playerById(hand, winnerId);
      const award = share + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      winner.stack += award;
      pushEvent(hand, {
        type: "pot-awarded",
        phase: "showdown",
        playerId: winner.id,
        amount: award,
        message: `${winner.name} 获得底池 ${award}（${solvedHands.get(winner.id)?.descr ?? "胜出"}）`,
      });
    }

    results.push({
      amount: pot.amount,
      eligiblePlayerIds: pot.eligiblePlayerIds,
      winnerIds: orderedWinners,
    });
  }

  completeHand(hand, results);
}

function resetPendingForStreet(hand: HandState): void {
  const players = actionablePlayers(hand);
  if (players.length <= 1) {
    hand.pendingPlayerIds = [];
    hand.currentSeat = null;
    return;
  }

  const ordered = orderedPlayersAfter(hand.players, hand.dealerSeat).filter(
    (player) => !player.folded && !player.allIn && player.stack > 0,
  );
  hand.pendingPlayerIds = ordered.map((player) => player.id);
  hand.currentSeat = ordered[0]?.seat ?? null;
}

function progressAfterBettingRound(hand: HandState): void {
  if (activePlayers(hand).length === 1) {
    awardUncontested(hand);
    return;
  }

  let nextPhase = phaseAfter(hand.phase);
  while (nextPhase !== "showdown") {
    dealStreet(hand, nextPhase);
    resetPendingForStreet(hand);
    if (hand.pendingPlayerIds.length > 1) return;
    nextPhase = phaseAfter(hand.phase);
  }

  settleShowdown(hand);
}

function moveToNextPendingPlayer(hand: HandState, afterSeat: number): void {
  hand.pendingPlayerIds = hand.pendingPlayerIds.filter((playerId) => {
    const player = playerById(hand, playerId);
    return !player.folded && !player.allIn && player.stack > 0;
  });

  if (!hand.pendingPlayerIds.length) {
    progressAfterBettingRound(hand);
    return;
  }

  const next = orderedPlayersAfter(hand.players, afterSeat).find((player) =>
    hand.pendingPlayerIds.includes(player.id),
  );
  hand.currentSeat = next?.seat ?? null;
}

function createPlayers(
  roster: SeatProfile[],
  stacks: Record<string, number>,
): PlayerState[] {
  return roster
    .filter((profile) => (stacks[profile.id] ?? 0) > 0)
    .map((profile) => ({
      ...profile,
      stack: stacks[profile.id] ?? 0,
      holeCards: [],
      committedRound: 0,
      committedHand: 0,
      folded: false,
      allIn: false,
      lastAction: null,
    }));
}

function createHand(
  session: GameSession,
  previousDealerSeat: number | null,
  rosterChanges: AiRosterChange[] = [],
): HandState {
  const players = createPlayers(session.roster, session.stacks);
  if (players.length < 2) throw new Error("至少需要两名有筹码的玩家");

  const dealerSeat =
    previousDealerSeat === null
      ? (players[session.seed % players.length]?.seat ?? players[0]!.seat)
      : nextSeat(players, previousDealerSeat, () => true);
  const smallBlindSeat =
    players.length === 2
      ? dealerSeat
      : nextSeat(players, dealerSeat, () => true);
  const bigBlindSeat = nextSeat(players, smallBlindSeat, () => true);
  const hand: HandState = {
    id: crypto.randomUUID(),
    number: session.completedHands + 1,
    dealerSeat,
    smallBlindSeat,
    bigBlindSeat,
    phase: "preflop",
    deck: createShuffledDeck(
      `${session.seed}:hand:${session.completedHands + 1}`,
    ),
    board: [],
    players,
    currentSeat: null,
    currentBet: 0,
    minRaise: session.config.bigBlind,
    bigBlind: session.config.bigBlind,
    pendingPlayerIds: [],
    actedPlayerIds: [],
    raiseLockedPlayerIds: [],
    actionSeq: 0,
    events: [],
    pots: [],
    winnerIds: [],
    completedAt: null,
  };

  for (const change of rosterChanges) {
    pushEvent(hand, {
      type: change.type === "left" ? "ai-left" : "ai-joined",
      phase: "preflop",
      playerId: change.playerId,
      message:
        change.type === "left"
          ? `${change.name} 离开牌桌`
          : `${change.name} 加入牌桌`,
      rotation: change.details,
    });
  }
  pushEvent(hand, {
    type: "hand-started",
    phase: "preflop",
    message: `第 ${hand.number} 手牌开始`,
  });
  postBlind(hand, smallBlindSeat, session.config.smallBlind, "small-blind");
  postBlind(hand, bigBlindSeat, session.config.bigBlind, "big-blind");
  dealHoleCards(hand);

  hand.currentBet = Math.max(
    ...hand.players.map((player) => player.committedRound),
  );
  const firstToActSeat = nextSeat(hand.players, bigBlindSeat, () => true);
  const ordered = [
    playerBySeat(hand, firstToActSeat),
    ...orderedPlayersAfter(hand.players, firstToActSeat),
  ].filter(
    (player, index, list) =>
      list.findIndex((candidate) => candidate.id === player.id) === index,
  );
  hand.pendingPlayerIds = ordered
    .filter((player) => !player.folded && !player.allIn && player.stack > 0)
    .map((player) => player.id);
  hand.currentSeat =
    ordered.find((player) => hand.pendingPlayerIds.includes(player.id))?.seat ??
    null;

  if (hand.pendingPlayerIds.length <= 1 && actionablePlayers(hand).length <= 1)
    progressAfterBettingRound(hand);
  return hand;
}

export function createGameSession(
  accountId: string,
  accountName: string,
  playerLevel: number,
  config: GameConfig,
  seed = Date.now(),
): GameSession {
  if (config.aiCount < 1 || config.aiCount > 5)
    throw new Error("AI 数量必须在 1 到 5 之间");
  if (config.buyIn < 500) throw new Error("买入不能低于 500");
  if (config.smallBlind <= 0 || config.bigBlind < config.smallBlind * 2)
    throw new Error("盲注结构无效");

  const aiProfiles = matchAiProfiles(
    playerLevel,
    config.aiCount,
    `${seed}:match`,
  );
  const roster: SeatProfile[] = [
    {
      id: HUMAN_ID,
      name: accountName,
      seat: 0,
      isHuman: true,
      avatarKey: "avatar-human",
    },
    ...aiProfiles.map((profile, index) => ({
      id: profile.id,
      name: profile.name,
      seat: index + 1,
      isHuman: false,
      avatarKey: profile.avatarKey,
      aiTier: profile.tier,
      aiBand: profile.band,
    })),
  ];
  const timestamp = now();
  const session = {
    id: crypto.randomUUID(),
    accountId,
    accountName,
    playerLevel,
    config,
    seed,
    roster,
    stacks: Object.fromEntries(
      roster.map((profile) => [profile.id, config.buyIn]),
    ),
    aiStates: Object.fromEntries(
      aiProfiles.map((profile) => [
        profile.id,
        {
          playerId: profile.id,
          joinedHand: 1,
          handsPlayed: 0,
          entryStack: config.buyIn,
          lastStack: config.buyIn,
          recentNetResults: [],
        },
      ]),
    ),
    currentHand: {} as HandState,
    completedHands: 0,
    status: "active" as const,
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  session.currentHand = createHand(session, null);
  return session;
}

export function getHumanPlayer(session: GameSession): PlayerState {
  return playerById(session.currentHand, HUMAN_ID);
}

export function getCurrentPlayer(session: GameSession): PlayerState | null {
  const seat = session.currentHand.currentSeat;
  return seat === null ? null : playerBySeat(session.currentHand, seat);
}

export function getLegalActions(
  session: GameSession,
  playerId: string,
): LegalAction[] {
  const hand = session.currentHand;
  const player = playerById(hand, playerId);
  if (
    hand.phase === "complete" ||
    player.seat !== hand.currentSeat ||
    player.folded ||
    player.allIn
  )
    return [];

  const callAmount = Math.max(0, hand.currentBet - player.committedRound);
  const maxTarget = player.committedRound + player.stack;
  const actions: LegalAction[] = [];

  if (callAmount > 0) {
    actions.push({ type: "fold", label: "弃牌" });
    actions.push({
      type: "call",
      label:
        player.stack <= callAmount
          ? `跟注 ${player.stack}（全下）`
          : `跟注 ${callAmount}`,
      callAmount,
    });
  } else {
    actions.push({ type: "check", label: "过牌" });
  }

  if (
    player.stack > callAmount &&
    !hand.raiseLockedPlayerIds.includes(player.id)
  ) {
    const minimumRaise =
      hand.currentBet === 0 ? session.config.bigBlind : hand.minRaise;
    const minTarget =
      hand.currentBet === 0 ? minimumRaise : hand.currentBet + minimumRaise;
    if (maxTarget >= minTarget) {
      actions.push({
        type: hand.currentBet === 0 ? "bet" : "raise",
        label: hand.currentBet === 0 ? "下注" : "加注",
        minTarget,
        maxTarget,
      });
    }
    actions.push({
      type: "all-in",
      label: `全下 ${maxTarget}`,
      minTarget: maxTarget,
      maxTarget,
    });
  }

  return actions;
}

export function applyPlayerAction(
  session: GameSession,
  playerId: string,
  action: PlayerAction,
): GameSession {
  const next = cloneSession(session);
  const hand = next.currentHand;
  const player = playerById(hand, playerId);
  const legal = getLegalActions(next, playerId);
  const legalAction = legal.find((candidate) => candidate.type === action.type);
  if (!legalAction) throw new Error("当前行动不合法或已经失效");

  const oldCurrentBet = hand.currentBet;
  hand.pendingPlayerIds = hand.pendingPlayerIds.filter(
    (id) => id !== player.id,
  );
  if (!hand.actedPlayerIds.includes(player.id))
    hand.actedPlayerIds.push(player.id);
  let paid = 0;
  let targetAmount = player.committedRound;
  let fullRaise = false;

  if (action.type === "fold") {
    player.folded = true;
  } else if (action.type === "check") {
    if (hand.currentBet !== player.committedRound)
      throw new Error("当前不能过牌");
  } else if (action.type === "call") {
    paid = payChips(player, hand.currentBet - player.committedRound);
    targetAmount = player.committedRound;
  } else {
    const target =
      action.type === "all-in"
        ? player.committedRound + player.stack
        : action.targetAmount;
    if (
      target === undefined ||
      target <= player.committedRound ||
      target > player.committedRound + player.stack
    ) {
      throw new Error("下注金额无效");
    }
    if (
      legalAction.minTarget !== undefined &&
      action.type !== "all-in" &&
      target < legalAction.minTarget
    ) {
      throw new Error("下注金额低于最小值");
    }
    paid = payChips(player, target - player.committedRound);
    targetAmount = player.committedRound;
    if (targetAmount > oldCurrentBet) {
      const raiseSize = targetAmount - oldCurrentBet;
      fullRaise = raiseSize >= hand.minRaise;
      hand.currentBet = targetAmount;
      if (fullRaise) hand.minRaise = raiseSize;
    }
  }

  player.lastAction = action.type;

  if (targetAmount > oldCurrentBet) {
    const otherActionable = actionablePlayers(hand).filter(
      (candidate) => candidate.id !== player.id,
    );
    if (fullRaise) {
      hand.pendingPlayerIds = otherActionable.map((candidate) => candidate.id);
      hand.actedPlayerIds = [player.id];
      hand.raiseLockedPlayerIds = [];
    } else {
      const alreadyActed = hand.actedPlayerIds.filter((id) => id !== player.id);
      hand.raiseLockedPlayerIds = [
        ...new Set([...hand.raiseLockedPlayerIds, ...alreadyActed]),
      ];
      for (const candidate of otherActionable) {
        if (
          candidate.committedRound < hand.currentBet &&
          !hand.pendingPlayerIds.includes(candidate.id)
        ) {
          hand.pendingPlayerIds.push(candidate.id);
        }
      }
    }
  }

  pushEvent(hand, {
    type: "player-acted",
    phase: hand.phase,
    playerId: player.id,
    action: action.type,
    amount: paid,
    targetAmount,
    message: `${player.name} ${legalAction.label}${paid > 0 ? `，投入 ${paid}` : ""}`,
  });

  if (activePlayers(hand).length === 1) {
    awardUncontested(hand);
  } else {
    moveToNextPendingPlayer(hand, player.seat);
  }

  if (hand.phase === "complete") {
    next.completedHands = hand.number;
    next.stacks = Object.fromEntries(
      hand.players.map((candidate) => [candidate.id, candidate.stack]),
    );
  }
  next.updatedAt = now();
  return next;
}

export function forceHumanLeave(session: GameSession): GameSession {
  const next = cloneSession(session);
  const hand = next.currentHand;
  if (hand.phase === "complete") {
    next.status = "abandoned";
    return next;
  }

  const human = playerById(hand, HUMAN_ID);
  human.folded = true;
  human.lastAction = "fold";
  hand.pendingPlayerIds = hand.pendingPlayerIds.filter(
    (playerId) => playerId !== HUMAN_ID,
  );
  pushEvent(hand, {
    type: "player-left",
    phase: hand.phase,
    playerId: HUMAN_ID,
    action: "fold",
    amount: human.committedHand,
    message: `${human.name} 离桌，放弃已投入筹码 ${human.committedHand}`,
  });

  if (activePlayers(hand).length === 1) awardUncontested(hand);
  else if (
    hand.currentSeat === human.seat ||
    hand.pendingPlayerIds.length === 0
  )
    moveToNextPendingPlayer(hand, human.seat);

  next.status = "abandoned";
  next.updatedAt = now();
  return next;
}

export function startNextHand(
  session: GameSession,
  playerLevel = session.playerLevel,
): GameSession {
  if (session.currentHand.phase !== "complete")
    throw new Error("当前手牌尚未结束");

  const next = cloneSession(session);
  next.completedHands = next.currentHand.number;
  next.stacks = Object.fromEntries(
    next.currentHand.players.map((player) => [player.id, player.stack]),
  );
  const humanStack = next.stacks[HUMAN_ID] ?? 0;

  if (next.completedHands >= next.config.maxHands || humanStack <= 0) {
    next.status = "complete";
    next.updatedAt = now();
    return next;
  }

  next.playerLevel = playerLevel;
  const rotation = rotateAiRoster(next, playerLevel);
  next.roster = rotation.roster;
  next.stacks = rotation.stacks;
  next.aiStates = rotation.aiStates;
  next.currentHand = createHand(
    next,
    session.currentHand.dealerSeat,
    rotation.changes,
  );
  next.updatedAt = now();
  return next;
}

export function handPot(hand: HandState): number {
  return totalPot(hand);
}

export function humanId(): string {
  return HUMAN_ID;
}
