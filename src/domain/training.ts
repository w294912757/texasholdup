import { createRandom } from "./cards";
import { buildEquityTimeline } from "./review";
import type { Card, HandPhase, PlayerActionType } from "./types";
import type { HandHistoryRecord } from "@/persistence/database";

export const TRAINING_VERSION = 1;

export interface TrainingActionOption {
  type: PlayerActionType;
  label: string;
  minTarget?: number;
  maxTarget?: number;
}

export interface TrainingActionMix extends TrainingActionOption {
  frequency: number;
}

export interface TrainingRecommendation {
  actionTypes: PlayerActionType[];
  actionLabels: string[];
  reason: string;
}

export interface TrainingQuestion {
  id: string;
  source: "fixed" | "history";
  sourceRecordId?: string;
  phase: Exclude<HandPhase, "showdown" | "complete">;
  holeCards: Card[];
  board: Card[];
  position: string;
  pot: number;
  callAmount: number;
  effectiveStack: number;
  legalActions: TrainingActionOption[];
  referenceMix: TrainingActionMix[];
  equity: number;
  potOdds: number;
  explanation: string;
  estimated: true;
}

export type TrainingErrorType =
  "none" | "odds-miss" | "too-passive" | "too-aggressive" | "sizing";

export interface TrainingAnswer {
  questionId: string;
  action: PlayerActionType;
  targetAmount?: number;
  correct: boolean;
  errorType: TrainingErrorType;
  elapsedMs: number;
  createdAt: string;
}

export interface TrainingSession {
  id: string;
  accountId: string;
  mode: "training";
  version: number;
  length: 10 | 20;
  seed: number;
  status: "active" | "complete";
  currentIndex: number;
  questions: TrainingQuestion[];
  answers: TrainingAnswer[];
  questionStartedAt: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

interface FixedQuestionSeed {
  phase: TrainingQuestion["phase"];
  holeCards: Card[];
  board: Card[];
  position: string;
  pot: number;
  callAmount: number;
  effectiveStack: number;
  equity: number;
  explanation: string;
}

const FIXED_QUESTIONS: FixedQuestionSeed[] = [
  {
    phase: "preflop",
    holeCards: ["As", "Kd"],
    board: [],
    position: "关煞位",
    pot: 35,
    callAmount: 20,
    effectiveStack: 1_000,
    equity: 0.64,
    explanation:
      "强势非对子起手牌在后位通常应主动争取底池，同时保留少量跟注频率。",
  },
  {
    phase: "preflop",
    holeCards: ["7c", "2d"],
    board: [],
    position: "枪口位",
    pot: 30,
    callAmount: 20,
    effectiveStack: 980,
    equity: 0.24,
    explanation:
      "弱势且不同花的低连接度起手牌在前位通常无法覆盖继续投入所需权益。",
  },
  {
    phase: "flop",
    holeCards: ["Ah", "Qh"],
    board: ["Jh", "7h", "2c"],
    position: "按钮位",
    pot: 120,
    callAmount: 40,
    effectiveStack: 860,
    equity: 0.58,
    explanation:
      "两张高牌加同花听牌具有充足权益，可在跟注和半诈唬加注之间混合。",
  },
  {
    phase: "flop",
    holeCards: ["9s", "9d"],
    board: ["Ac", "Kh", "7s"],
    position: "大盲",
    pot: 150,
    callAmount: 100,
    effectiveStack: 700,
    equity: 0.21,
    explanation:
      "面对高额下注时，中小口袋对子在双高牌面上的权益通常低于底池赔率要求。",
  },
  {
    phase: "turn",
    holeCards: ["Ks", "Qs"],
    board: ["Js", "Ts", "3d", "2c"],
    position: "劫持位",
    pot: 260,
    callAmount: 80,
    effectiveStack: 640,
    equity: 0.55,
    explanation: "强组合听牌拥有多类补牌，可继续并保留主动加注频率。",
  },
  {
    phase: "river",
    holeCards: ["Ad", "Jc"],
    board: ["As", "8h", "5c", "2d", "Kh"],
    position: "按钮位",
    pot: 420,
    callAmount: 280,
    effectiveStack: 540,
    equity: 0.46,
    explanation:
      "河牌面对大尺度下注时，一对的继续频率应受对手范围和较高底池赔率约束。",
  },
];

function isoNow(now?: string): string {
  return now ?? new Date().toISOString();
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function actionsFor(
  callAmount: number,
  effectiveStack: number,
): TrainingActionOption[] {
  if (callAmount <= 0)
    return [
      { type: "check", label: "过牌" },
      { type: "bet", label: "下注", minTarget: 20, maxTarget: effectiveStack },
      { type: "all-in", label: "全下", maxTarget: effectiveStack },
    ];
  return [
    { type: "fold", label: "弃牌" },
    { type: "call", label: "跟注" },
    {
      type: "raise",
      label: "加注",
      minTarget: Math.min(effectiveStack, Math.max(callAmount * 2, 20)),
      maxTarget: effectiveStack,
    },
    { type: "all-in", label: "全下", maxTarget: effectiveStack },
  ];
}

function buildReferenceMix(
  legalActions: TrainingActionOption[],
  equity: number,
  potOdds: number,
): TrainingActionMix[] {
  const edge = equity - potOdds;
  const weights = legalActions.map((action) => {
    if (action.type === "fold") return Math.max(0.03, 0.52 - edge * 1.4);
    if (action.type === "check") return Math.max(0.08, 0.62 - equity * 0.45);
    if (action.type === "call") return Math.max(0.08, 0.42 + edge * 1.1);
    if (action.type === "all-in") return Math.max(0.01, (equity - 0.72) * 1.2);
    return Math.max(0.04, (equity - 0.38) * 1.1);
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const exact = weights.map((weight) => (weight / total) * 100);
  const frequencies = exact.map(Math.floor);
  let remainder = 100 - frequencies.reduce((sum, value) => sum + value, 0);
  const fractions = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction);
  for (const item of fractions) {
    if (!remainder) break;
    frequencies[item.index] = (frequencies[item.index] ?? 0) + 1;
    remainder -= 1;
  }
  return legalActions.map((action, index) => ({
    ...action,
    frequency: frequencies[index] ?? 0,
  }));
}

function fixedQuestion(
  seed: FixedQuestionSeed,
  index: number,
): TrainingQuestion {
  const potOdds = seed.callAmount / Math.max(1, seed.pot + seed.callAmount);
  const legalActions = actionsFor(seed.callAmount, seed.effectiveStack);
  return {
    id: `fixed-${index}-${seed.phase}`,
    source: "fixed",
    ...seed,
    legalActions,
    referenceMix: buildReferenceMix(legalActions, seed.equity, potOdds),
    potOdds: round(potOdds),
    estimated: true,
  };
}

function boardCount(phase: TrainingQuestion["phase"]): number {
  if (phase === "flop") return 3;
  if (phase === "turn") return 4;
  if (phase === "river") return 5;
  return 0;
}

function historyQuestion(record: HandHistoryRecord): TrainingQuestion | null {
  const human = record.hand.players.find((player) => player.isHuman);
  if (!human) return null;
  const decision = record.hand.events.find(
    (event) => event.type === "player-acted" && event.playerId === human.id,
  );
  if (
    !decision ||
    decision.phase === "showdown" ||
    decision.phase === "complete"
  )
    return null;
  const timeline = buildEquityTimeline(record);
  const point = timeline.find((item) => item.seq === decision.seq);
  let highestTarget = 0;
  let humanTarget = 0;
  for (const event of record.hand.events) {
    if (event.seq >= decision.seq) break;
    if (event.phase !== decision.phase) continue;
    if (event.type === "blind-posted" || event.type === "player-acted")
      highestTarget = Math.max(highestTarget, event.targetAmount ?? 0);
    if (event.playerId === human.id)
      humanTarget = Math.max(humanTarget, event.targetAmount ?? 0);
  }
  const callAmount = Math.max(0, highestTarget - humanTarget);
  const effectiveStack = Math.max(
    record.hand.bigBlind,
    human.stack + human.committedHand,
  );
  const legalActions = actionsFor(callAmount, effectiveStack);
  const equity = point?.equity ?? 0.5;
  const pot = Math.max(
    record.hand.bigBlind,
    decision.pot - (decision.amount ?? 0),
  );
  const potOdds = callAmount / Math.max(1, pot + callAmount);
  const seatOffset =
    (human.seat - record.hand.dealerSeat + record.hand.players.length) %
    record.hand.players.length;
  const position =
    seatOffset === 0
      ? "按钮位"
      : seatOffset === 1
        ? "小盲"
        : seatOffset === 2
          ? "大盲"
          : "中间位";
  return {
    id: `history-${record.id}-${decision.seq}`,
    source: "history",
    sourceRecordId: record.id,
    phase: decision.phase,
    holeCards: [...human.holeCards],
    board: record.hand.board.slice(0, boardCount(decision.phase)),
    position,
    pot,
    callAmount,
    effectiveStack,
    legalActions,
    referenceMix: buildReferenceMix(legalActions, equity, potOdds),
    equity,
    potOdds: round(potOdds),
    explanation:
      "该题取自当前账号的已完成手牌，并仅按当时公开牌面、底池赔率和有效筹码给出近似建议。",
    estimated: true,
  };
}

export function buildTrainingQuestions(
  length: 10 | 20,
  history: HandHistoryRecord[],
  seed: number,
): TrainingQuestion[] {
  const historyQuestions = history
    .map(historyQuestion)
    .filter((item): item is TrainingQuestion => Boolean(item));
  const pool = [
    ...historyQuestions,
    ...Array.from({ length }, (_, index) =>
      fixedQuestion(FIXED_QUESTIONS[index % FIXED_QUESTIONS.length]!, index),
    ),
  ];
  const random = createRandom(`training:${seed}:${length}`);
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [pool[index], pool[target]] = [pool[target]!, pool[index]!];
  }
  return pool.slice(0, length).map((question, index) => ({
    ...question,
    id: `${question.id}-${seed}-${index}`,
  }));
}

export function createTrainingSession(
  accountId: string,
  length: 10 | 20,
  history: HandHistoryRecord[],
  seed = Date.now(),
  now?: string,
): TrainingSession {
  const createdAt = isoNow(now);
  return {
    id: crypto.randomUUID(),
    accountId,
    mode: "training",
    version: TRAINING_VERSION,
    length,
    seed,
    status: "active",
    currentIndex: 0,
    questions: buildTrainingQuestions(length, history, seed),
    answers: [],
    questionStartedAt: createdAt,
    revision: 0,
    createdAt,
    updatedAt: createdAt,
  };
}

function classifyError(
  question: TrainingQuestion,
  action: PlayerActionType,
  targetAmount?: number,
): TrainingErrorType {
  if ((action === "bet" || action === "raise") && targetAmount !== undefined) {
    const option = question.legalActions.find((item) => item.type === action);
    if (
      (option?.minTarget && targetAmount < option.minTarget) ||
      (option?.maxTarget && targetAmount > option.maxTarget)
    )
      return "sizing";
  }
  if (
    (action === "call" || action === "check") &&
    question.equity < question.potOdds
  )
    return "odds-miss";
  if (action === "fold" && question.equity > question.potOdds + 0.15)
    return "too-passive";
  if (
    (action === "raise" || action === "bet" || action === "all-in") &&
    question.equity < question.potOdds
  )
    return "too-aggressive";
  return "none";
}

export function submitTrainingAnswer(
  session: TrainingSession,
  action: PlayerActionType,
  targetAmount?: number,
  now?: string,
): TrainingSession {
  if (session.status !== "active") throw new Error("训练已经结束");
  const question = session.questions[session.currentIndex];
  if (!question) throw new Error("找不到当前训练题目");
  if (session.answers.some((answer) => answer.questionId === question.id))
    throw new Error("当前题目已经提交");
  const option = question.legalActions.find((item) => item.type === action);
  if (!option) throw new Error("该动作在当前局面中不合法");
  if ((action === "bet" || action === "raise") && targetAmount === undefined)
    throw new Error("请输入下注或加注金额");
  if (
    targetAmount !== undefined &&
    (targetAmount < 0 ||
      targetAmount > (option.maxTarget ?? question.effectiveStack))
  )
    throw new Error("下注金额超出有效筹码范围");
  if (option.minTarget !== undefined && (targetAmount ?? 0) < option.minTarget)
    throw new Error(`下注金额不能低于 ${option.minTarget}`);
  const submittedAt = isoNow(now);
  const bestFrequency = Math.max(
    ...question.referenceMix.map((item) => item.frequency),
  );
  const selectedFrequency =
    question.referenceMix.find((item) => item.type === action)?.frequency ?? 0;
  const answer: TrainingAnswer = {
    questionId: question.id,
    action,
    targetAmount,
    correct: selectedFrequency === bestFrequency,
    errorType:
      selectedFrequency === bestFrequency
        ? "none"
        : classifyError(question, action, targetAmount),
    elapsedMs: Math.max(
      0,
      new Date(submittedAt).getTime() -
        new Date(session.questionStartedAt).getTime(),
    ),
    createdAt: submittedAt,
  };
  return {
    ...session,
    answers: [...session.answers, answer],
    updatedAt: submittedAt,
  };
}

export function advanceTrainingSession(
  session: TrainingSession,
  now?: string,
): TrainingSession {
  if (session.status !== "active") throw new Error("训练已经结束");
  const question = session.questions[session.currentIndex];
  if (
    !question ||
    !session.answers.some((answer) => answer.questionId === question.id)
  )
    throw new Error("请先提交当前题目");
  const updatedAt = isoNow(now);
  const nextIndex = session.currentIndex + 1;
  return {
    ...session,
    currentIndex: Math.min(nextIndex, session.questions.length - 1),
    status: nextIndex >= session.questions.length ? "complete" : "active",
    questionStartedAt: updatedAt,
    updatedAt,
  };
}

export function trainingAccuracy(session: TrainingSession): number {
  if (!session.answers.length) return 0;
  return (
    session.answers.filter((answer) => answer.correct).length /
    session.answers.length
  );
}

export function getTrainingRecommendation(
  question: TrainingQuestion,
): TrainingRecommendation {
  const highestFrequency = Math.max(
    ...question.referenceMix.map((item) => item.frequency),
  );
  const preferred = question.referenceMix.filter(
    (item) => item.frequency === highestFrequency,
  );
  const actionTypes = preferred.map((item) => item.type);
  const actionLabels = preferred.map((item) => item.label);
  const edge = question.equity - question.potOdds;
  const primary = preferred[0]?.type;
  let reason: string;

  if (primary === "fold") {
    reason = `估算权益 ${Math.round(question.equity * 100)}% 低于继续所需的底池赔率 ${Math.round(question.potOdds * 100)}%，弃牌可以避免在劣势局面继续投入。`;
  } else if (primary === "check") {
    reason =
      "当前无需投入即可继续看牌，过牌可以保留范围并控制底池，同时不会放弃现有估算权益。";
  } else if (primary === "call") {
    reason = `估算权益比底池赔率高 ${Math.max(0, Math.round(edge * 100))} 个百分点，跟注能够以合理成本继续，同时避免把中等强度范围过度放大。`;
  } else if (primary === "all-in") {
    reason =
      "当前估算权益较高，且有效筹码相对底池较浅，全下可以充分实现价值并减少后续街的困难决策。";
  } else {
    reason = `估算权益 ${Math.round(question.equity * 100)}% 高于底池赔率 ${Math.round(question.potOdds * 100)}%，主动${primary === "bet" ? "下注" : "加注"}可以争取价值，并让部分权益较弱的范围弃牌。`;
  }

  return { actionTypes, actionLabels, reason };
}
