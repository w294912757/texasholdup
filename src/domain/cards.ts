import type { Card, Rank, Suit } from "./types";

const ranks: Rank[] = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "T",
  "J",
  "Q",
  "K",
  "A",
];
const suits: Suit[] = ["c", "d", "h", "s"];

export function hashSeed(value: string | number): number {
  const text = String(value);
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function createRandom(seed: string | number): () => number {
  let state = hashSeed(seed);

  return () => {
    state += 0x6d2b79f5;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function createDeck(): Card[] {
  return suits.flatMap((suit) => ranks.map((rank) => `${rank}${suit}` as Card));
}

export function createShuffledDeck(seed: string | number): Card[] {
  const deck = createDeck();
  const random = createRandom(seed);

  for (let index = deck.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    const currentCard = deck[index];
    const targetCard = deck[target];

    if (currentCard && targetCard) {
      deck[index] = targetCard;
      deck[target] = currentCard;
    }
  }

  return deck;
}

export function cardRank(card: Card): Rank {
  return card[0] as Rank;
}

export function cardSuit(card: Card): Suit {
  return card[1] as Suit;
}
