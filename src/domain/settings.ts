export interface GameSettings {
  animationSpeed: "reduced" | "normal" | "fast";
  aiThinkingTime: 0 | 360 | 800;
  soundEnabled: boolean;
  musicEnabled: boolean;
  volume: number;
  cardStyle: "classic" | "high-contrast";
  replaySpeed: "slow" | "normal" | "fast";
  beginnerHints: boolean;
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  animationSpeed: "normal",
  aiThinkingTime: 360,
  soundEnabled: false,
  musicEnabled: false,
  volume: 35,
  cardStyle: "classic",
  replaySpeed: "normal",
  beginnerHints: true,
};

export const REPLAY_SPEED_MILLISECONDS: Record<
  GameSettings["replaySpeed"],
  number
> = {
  slow: 1_400,
  normal: 850,
  fast: 400,
};

export function normalizeGameSettings(
  value: Partial<GameSettings> | null | undefined,
): GameSettings {
  const settings = { ...DEFAULT_GAME_SETTINGS, ...value };
  return {
    animationSpeed: ["reduced", "normal", "fast"].includes(
      settings.animationSpeed,
    )
      ? settings.animationSpeed
      : DEFAULT_GAME_SETTINGS.animationSpeed,
    aiThinkingTime: [0, 360, 800].includes(settings.aiThinkingTime)
      ? settings.aiThinkingTime
      : DEFAULT_GAME_SETTINGS.aiThinkingTime,
    soundEnabled: Boolean(settings.soundEnabled),
    musicEnabled: Boolean(settings.musicEnabled),
    volume: Math.min(100, Math.max(0, Number(settings.volume) || 0)),
    cardStyle: ["classic", "high-contrast"].includes(settings.cardStyle)
      ? settings.cardStyle
      : DEFAULT_GAME_SETTINGS.cardStyle,
    replaySpeed: ["slow", "normal", "fast"].includes(settings.replaySpeed)
      ? settings.replaySpeed
      : DEFAULT_GAME_SETTINGS.replaySpeed,
    beginnerHints: Boolean(settings.beginnerHints),
  };
}
