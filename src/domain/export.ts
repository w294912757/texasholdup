import type { HandHistoryRecord } from "@/persistence/database";
import type { HandStatistic } from "@/domain/statistics";

function csvCell(value: string | number | boolean | null): string {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function statisticsToCsv(hands: HandStatistic[]): string {
  const header = [
    "date",
    "sessionId",
    "handNumber",
    "position",
    "startingHand",
    "playerLevel",
    "result",
    "netProfit",
    "wentToShowdown",
    "vpip",
    "pfr",
    "favorite",
    "note",
  ];
  const rows = hands.map((hand) => [
    hand.date,
    hand.record.sessionId,
    hand.record.handNumber,
    hand.position,
    hand.startingHand,
    hand.playerLevel,
    hand.won ? "won" : hand.leftTable ? "left" : "lost",
    hand.netProfit,
    hand.wentToShowdown,
    hand.voluntarilyPutMoneyInPot,
    hand.preflopRaised,
    hand.record.favorite,
    hand.record.note,
  ]);
  return [header, ...rows]
    .map((row) => row.map((value) => csvCell(value)).join(","))
    .join("\n");
}

function publicPlayerLabel(
  record: HandHistoryRecord,
  playerId: string,
): string {
  return (
    record.hand.players.find((player) => player.id === playerId)?.name ??
    playerId
  );
}

export function handToMarkdown(record: HandHistoryRecord): string {
  const human = record.hand.players.find((player) => player.isHuman);
  const publicCards = record.hand.board.length
    ? record.hand.board.join(" ")
    : "暂无";
  const humanCards = human?.holeCards.join(" ") ?? "暂无";
  const players = record.hand.players
    .map(
      (player) =>
        `- ${player.name}${player.isHuman ? `：底牌 ${humanCards}` : "：底牌未公开"}`,
    )
    .join("\n");
  const events = record.hand.events
    .map((event) => `- #${event.seq} ${event.message}`)
    .join("\n");
  return [
    `# 第 ${record.handNumber} 手牌局`,
    "",
    `- 牌局：${record.sessionId}`,
    `- 创建时间：${record.createdAt}`,
    `- 公共牌：${publicCards}`,
    `- 结果：${record.hand.winnerIds.map((id) => publicPlayerLabel(record, id)).join("、") || "未记录"}`,
    "",
    "## 玩家",
    players,
    "",
    "## 行动记录",
    events || "- 暂无行动记录",
    record.note ? `\n\n## 备注\n${record.note}` : "",
    "",
  ].join("\n");
}

export function handToActionText(record: HandHistoryRecord): string {
  const lines = record.hand.events.map(
    (event) => `${event.seq}\t${event.phase}\t${event.message}`,
  );
  return [
    `Hand ${record.handNumber}`,
    `Session ${record.sessionId}`,
    ...lines,
    "",
  ].join("\n");
}
