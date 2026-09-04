import { Hand } from "pokersolver";
import type { Card, PlayerActionType } from "./types";

export interface SandboxPlayerInput {
  id: string;
  name: string;
  seat: number;
  stack: number;
  committedHand: number;
  holeCards: Card[];
  folded: boolean;
}

export interface SandboxActionInput {
  playerId: string;
  action: PlayerActionType;
  amount?: number;
}

export interface SandboxCase {
  id: string;
  name: string;
  board: Card[];
  players: SandboxPlayerInput[];
  dealerSeat: number;
  smallBlind: number;
  bigBlind: number;
  actions: SandboxActionInput[];
  createdAt: string;
  updatedAt: string;
}

export interface SandboxPotResult {
  index: number;
  amount: number;
  eligiblePlayerIds: string[];
  winnerIds: string[];
  awards: Record<string, number>;
}

export interface SandboxPlayerResult extends SandboxPlayerInput {
  handName: string | null;
  handDescription: string | null;
  awarded: number;
  stackAfter: number;
}

export interface SandboxEvaluation {
  valid: boolean;
  errors: string[];
  actionErrors: string[];
  totalPot: number;
  pots: SandboxPotResult[];
  players: SandboxPlayerResult[];
}

const SANDBOX_CASES_KEY = "holdup:sandbox-cases:v1";
const ACTIONS = new Set<PlayerActionType>([
  "fold",
  "check",
  "call",
  "bet",
  "raise",
  "all-in",
]);
const CARD_PATTERN = /^(?:[2-9TJQKA][cdhs])$/;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function orderedIds(players: SandboxPlayerInput[], dealerSeat: number): string[] {
  const ordered = [...players].sort((left, right) => {
    const leftDistance = (left.seat - dealerSeat + 10) % 10 || 10;
    const rightDistance = (right.seat - dealerSeat + 10) % 10 || 10;
    return leftDistance - rightDistance;
  });
  return ordered.map((player) => player.id);
}

function buildPots(players: SandboxPlayerInput[]): Array<{
  amount: number;
  eligiblePlayerIds: string[];
}> {
  const levels = [...new Set(players.map((player) => player.committedHand))]
    .filter((level) => level > 0)
    .sort((left, right) => left - right);
  let previous = 0;
  return levels.map((level) => {
    const contributors = players.filter((player) => player.committedHand >= level);
    const pot = {
      amount: (level - previous) * contributors.length,
      eligiblePlayerIds: contributors
        .filter((player) => !player.folded)
        .map((player) => player.id),
    };
    previous = level;
    return pot;
  });
}

function validateCards(board: Card[], players: SandboxPlayerInput[]): string[] {
  const cards = [...board, ...players.flatMap((player) => player.holeCards)];
  const errors = cards
    .filter((card) => !CARD_PATTERN.test(card))
    .map((card) => `牌面格式无效：${card}`);
  const duplicates = cards.filter((card, index) => cards.indexOf(card) !== index);
  for (const card of new Set(duplicates)) errors.push(`牌面重复：${card}`);
  return errors;
}

function validateActions(
  actions: SandboxActionInput[],
  players: SandboxPlayerInput[],
): string[] {
  const playerMap = new Map(players.map((player) => [player.id, player]));
  const errors: string[] = [];
  actions.forEach((entry, index) => {
    const prefix = `第 ${index + 1} 条行动`;
    const player = playerMap.get(entry.playerId);
    if (!player) {
      errors.push(`${prefix}：玩家不存在`);
      return;
    }
    if (!ACTIONS.has(entry.action)) {
      errors.push(`${prefix}：行动类型无效`);
      return;
    }
    if (entry.amount !== undefined && (!Number.isInteger(entry.amount) || entry.amount < 0))
      errors.push(`${prefix}：金额必须是非负整数`);
    if ((entry.action === "bet" || entry.action === "raise") && entry.amount === undefined)
      errors.push(`${prefix}：下注或加注必须填写金额`);
    if ((entry.action === "fold" || entry.action === "check") && entry.amount !== undefined)
      errors.push(`${prefix}：弃牌或过牌不应填写金额`);
    if (entry.amount !== undefined && entry.amount > player.stack + player.committedHand)
      errors.push(`${prefix}：金额超过玩家可用筹码`);
  });
  return errors;
}

export function evaluateSandboxCase(input: SandboxCase): SandboxEvaluation {
  const errors: string[] = [];
  const players = clone(input.players);
  if (players.length < 2 || players.length > 6) errors.push("玩家数量必须在 2 到 6 人之间");
  if (input.board.length !== 5) errors.push("结算测试需要恰好 5 张公共牌");
  if (input.smallBlind <= 0 || input.bigBlind < input.smallBlind * 2)
    errors.push("盲注结构无效");
  const ids = players.map((player) => player.id);
  if (new Set(ids).size !== ids.length) errors.push("玩家 ID 不能重复");
  for (const player of players) {
    if (player.holeCards.length !== 2) errors.push(`${player.name} 必须有 2 张底牌`);
    if (!Number.isInteger(player.stack) || player.stack < 0)
      errors.push(`${player.name} 的剩余筹码无效`);
    if (!Number.isInteger(player.committedHand) || player.committedHand < 0)
      errors.push(`${player.name} 的已投入筹码无效`);
  }
  errors.push(...validateCards(input.board, players));
  const actionErrors = validateActions(input.actions, players);
  if (errors.length || actionErrors.length)
    return { valid: false, errors, actionErrors, totalPot: 0, pots: [], players: [] };

  const solved = new Map<string, Hand>();
  const resultPlayers: SandboxPlayerResult[] = players.map((player) => {
    if (player.folded) return { ...player, handName: null, handDescription: null, awarded: 0, stackAfter: player.stack };
    try {
      const hand = Hand.solve([...player.holeCards, ...input.board]);
      solved.set(player.id, hand);
      return { ...player, handName: hand.name, handDescription: hand.descr, awarded: 0, stackAfter: player.stack };
    } catch {
      errors.push(`${player.name} 的牌面无法计算牌型`);
      return { ...player, handName: null, handDescription: null, awarded: 0, stackAfter: player.stack };
    }
  });
  if (errors.length) return { valid: false, errors, actionErrors, totalPot: 0, pots: [], players: [] };

  const playerById = new Map(resultPlayers.map((player) => [player.id, player]));
  const pots: SandboxPotResult[] = [];
  buildPots(players).forEach((pot, index) => {
    const eligible = pot.eligiblePlayerIds.map((id) => solved.get(id)).filter(Boolean) as Hand[];
    if (!eligible.length) return;
    const winners = Hand.winners(eligible);
    const winnerIds = pot.eligiblePlayerIds.filter((id) => winners.includes(solved.get(id)!));
    const winnerOrder = orderedIds(players, input.dealerSeat).filter((id) => winnerIds.includes(id));
    const share = Math.floor(pot.amount / winnerOrder.length);
    let remainder = pot.amount % winnerOrder.length;
    const awards: Record<string, number> = {};
    for (const winnerId of winnerOrder) {
      const award = share + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      awards[winnerId] = award;
      const winner = playerById.get(winnerId);
      if (winner) {
        winner.awarded += award;
        winner.stackAfter += award;
      }
    }
    pots.push({ index: index + 1, amount: pot.amount, eligiblePlayerIds: pot.eligiblePlayerIds, winnerIds: winnerOrder, awards });
  });
  return {
    valid: true,
    errors: [],
    actionErrors,
    totalPot: pots.reduce((sum, pot) => sum + pot.amount, 0),
    pots,
    players: resultPlayers,
  };
}

export function createSandboxCase(): SandboxCase {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: "未命名案例",
    board: ["As", "Kd", "7c", "4h", "2s"],
    players: [
      { id: "p1", name: "玩家 1", seat: 0, stack: 0, committedHand: 100, holeCards: ["Ah", "Ad"], folded: false },
      { id: "p2", name: "玩家 2", seat: 1, stack: 0, committedHand: 100, holeCards: ["Kc", "Kh"], folded: false },
    ],
    dealerSeat: 0,
    smallBlind: 10,
    bigBlind: 20,
    actions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function loadSandboxCases(): SandboxCase[] {
  try {
    const raw = globalThis.localStorage?.getItem(SANDBOX_CASES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SandboxCase[];
    return Array.isArray(parsed) ? parsed.map((item) => clone(item)) : [];
  } catch {
    return [];
  }
}

export function saveSandboxCase(sandboxCase: SandboxCase): SandboxCase[] {
  const cases = loadSandboxCases().filter((item) => item.id !== sandboxCase.id);
  const saved = { ...clone(sandboxCase), updatedAt: new Date().toISOString() };
  const next = [saved, ...cases].slice(0, 20);
  globalThis.localStorage?.setItem(SANDBOX_CASES_KEY, JSON.stringify(next));
  return next;
}

export function deleteSandboxCase(id: string): SandboxCase[] {
  const next = loadSandboxCases().filter((item) => item.id !== id);
  globalThis.localStorage?.setItem(SANDBOX_CASES_KEY, JSON.stringify(next));
  return next;
}

export function exportSandboxCase(sandboxCase: SandboxCase): string {
  return JSON.stringify({ kind: "holdup-sandbox-case", schemaVersion: 1, exportedAt: new Date().toISOString(), case: sandboxCase }, null, 2);
}
