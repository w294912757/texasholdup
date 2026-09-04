import { describe, expect, it } from "vitest";
import { createGameSession } from "@/domain/engine";
import { analyzeHandRecord } from "@/domain/statistics";
import {
  handToActionText,
  handToMarkdown,
  statisticsToCsv,
} from "@/domain/export";
import type { HandHistoryRecord } from "@/persistence/database";

const config = {
  aiCount: 1,
  buyIn: 1_000,
  smallBlind: 10,
  bigBlind: 20,
  maxHands: 20,
};

function record(): HandHistoryRecord {
  const session = createGameSession("account-1", "admin", 0, config, 12);
  return {
    id: "hand-1",
    accountId: "account-1",
    sessionId: session.id,
    handNumber: 1,
    createdAt: "2026-09-04T00:00:00.000Z",
    leftTable: false,
    playerLevel: 0,
    favorite: false,
    note: "重点复盘",
    hand: session.currentHand,
  };
}

describe("public data exports", () => {
  it("exports statistics as escaped CSV", () => {
    const stat = analyzeHandRecord(record());
    const csv = statisticsToCsv([
      { ...stat, record: { ...stat.record, note: "a,b" } },
    ]);
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv).toContain('"a,b"');
    expect(csv).toContain("sessionId");
  });

  it("exports a hand and hides opponents' cards in public formats", () => {
    const hand = record();
    const markdown = handToMarkdown(hand);
    const text = handToActionText(hand);
    expect(markdown).toContain("重点复盘");
    expect(markdown).toContain("未公开");
    expect(text).toContain("Hand 1");
    expect(text).toContain("Session");
  });
});
