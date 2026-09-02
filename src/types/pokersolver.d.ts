declare module "pokersolver" {
  export class Hand {
    readonly name: string;
    readonly descr: string;
    readonly cards: Array<{ value: string; suit: string }>;
    static solve(cards: string[], game?: string, canDisqualify?: boolean): Hand;
    static winners(hands: Hand[]): Hand[];
  }
}
