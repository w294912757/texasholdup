export type DisplayDensity = "standard" | "compact" | "portrait";
export type BlindStructure = "5/10" | "10/20" | "25/50";

export interface GamePresetValues {
  aiCount: number;
  buyIn: number;
  blinds: BlindStructure;
  animationSpeed: GameSettings["animationSpeed"];
  aiThinkingTime: GameSettings["aiThinkingTime"];
  soundEnabled: boolean;
  replaySpeed: GameSettings["replaySpeed"];
  beginnerHints: boolean;
  displayDensity: DisplayDensity;
}

export interface GamePreset extends GamePresetValues {
  id: string;
  name: string;
  builtIn: boolean;
}

export interface CustomGamePreset extends GamePreset {
  builtIn: false;
  createdAt: string;
}

export interface GameSettings {
  animationSpeed: "reduced" | "normal" | "fast";
  aiThinkingTime: 0 | 360 | 800;
  soundEnabled: boolean;
  musicEnabled: boolean;
  volume: number;
  cardStyle: "classic" | "high-contrast";
  replaySpeed: "slow" | "normal" | "fast";
  beginnerHints: boolean;
  displayDensity: DisplayDensity;
  confirmAllIn: boolean;
  confirmLargeBet: boolean;
  confirmLeaveTable: boolean;
  customPresets: CustomGamePreset[];
}

export const MAX_CUSTOM_GAME_PRESETS = 12;

const DEFAULT_PRESET_VALUES: GamePresetValues = {
  aiCount: 5,
  buyIn: 1_000,
  blinds: "10/20",
  animationSpeed: "normal",
  aiThinkingTime: 360,
  soundEnabled: false,
  replaySpeed: "normal",
  beginnerHints: true,
  displayDensity: "standard",
};

export const BUILT_IN_GAME_PRESETS: readonly GamePreset[] = [
  {
    id: "builtin-standard",
    name: "标准",
    builtIn: true,
    ...DEFAULT_PRESET_VALUES,
  },
  {
    id: "builtin-quick",
    name: "快速练习",
    builtIn: true,
    ...DEFAULT_PRESET_VALUES,
    aiCount: 2,
    buyIn: 500,
    animationSpeed: "fast",
    aiThinkingTime: 0,
    soundEnabled: true,
    replaySpeed: "fast",
    displayDensity: "compact",
  },
  {
    id: "builtin-deep",
    name: "深筹码",
    builtIn: true,
    ...DEFAULT_PRESET_VALUES,
    buyIn: 3_000,
    replaySpeed: "slow",
    beginnerHints: false,
  },
  {
    id: "builtin-review",
    name: "复盘",
    builtIn: true,
    ...DEFAULT_PRESET_VALUES,
    aiCount: 1,
    blinds: "5/10",
    animationSpeed: "reduced",
    aiThinkingTime: 0,
    replaySpeed: "slow",
    displayDensity: "compact",
  },
];

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  animationSpeed: "normal",
  aiThinkingTime: 360,
  soundEnabled: false,
  musicEnabled: false,
  volume: 35,
  cardStyle: "classic",
  replaySpeed: "normal",
  beginnerHints: true,
  displayDensity: "standard",
  confirmAllIn: true,
  confirmLargeBet: true,
  confirmLeaveTable: true,
  customPresets: [],
};

export const REPLAY_SPEED_MILLISECONDS: Record<
  GameSettings["replaySpeed"],
  number
> = {
  slow: 1_400,
  normal: 850,
  fast: 400,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizePresetValues(value: unknown): GamePresetValues {
  const preset = isRecord(value) ? value : {};
  const animationSpeed = preset.animationSpeed;
  const aiThinkingTime = Number(preset.aiThinkingTime);
  const replaySpeed = preset.replaySpeed;
  const displayDensity = preset.displayDensity;
  const blinds = preset.blinds;
  return {
    aiCount: Math.min(5, Math.max(1, Math.round(Number(preset.aiCount) || 5))),
    buyIn: Math.min(
      100_000,
      Math.max(500, Math.round((Number(preset.buyIn) || 1_000) / 100) * 100),
    ),
    blinds: ["5/10", "10/20", "25/50"].includes(String(blinds))
      ? (blinds as BlindStructure)
      : DEFAULT_PRESET_VALUES.blinds,
    animationSpeed: ["reduced", "normal", "fast"].includes(
      String(animationSpeed),
    )
      ? (animationSpeed as GameSettings["animationSpeed"])
      : DEFAULT_PRESET_VALUES.animationSpeed,
    aiThinkingTime: [0, 360, 800].includes(aiThinkingTime)
      ? (aiThinkingTime as GameSettings["aiThinkingTime"])
      : DEFAULT_PRESET_VALUES.aiThinkingTime,
    soundEnabled: normalizeBoolean(
      preset.soundEnabled,
      DEFAULT_PRESET_VALUES.soundEnabled,
    ),
    replaySpeed: ["slow", "normal", "fast"].includes(String(replaySpeed))
      ? (replaySpeed as GameSettings["replaySpeed"])
      : DEFAULT_PRESET_VALUES.replaySpeed,
    beginnerHints: normalizeBoolean(
      preset.beginnerHints,
      DEFAULT_PRESET_VALUES.beginnerHints,
    ),
    displayDensity: ["standard", "compact", "portrait"].includes(
      String(displayDensity),
    )
      ? (displayDensity as DisplayDensity)
      : DEFAULT_PRESET_VALUES.displayDensity,
  };
}

export function normalizeCustomGamePresets(value: unknown): CustomGamePreset[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const names = new Set<string>();
  const presets: CustomGamePreset[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const id = String(candidate.id ?? "").trim();
    const name = String(candidate.name ?? "")
      .trim()
      .slice(0, 24);
    const nameKey = name.toLocaleLowerCase();
    if (
      !/^custom-[a-zA-Z0-9-]{4,}$/.test(id) ||
      !name ||
      ids.has(id) ||
      names.has(nameKey)
    )
      continue;
    presets.push({
      id,
      name,
      builtIn: false,
      createdAt:
        typeof candidate.createdAt === "string" ? candidate.createdAt : "",
      ...normalizePresetValues(candidate),
    });
    ids.add(id);
    names.add(nameKey);
    if (presets.length >= MAX_CUSTOM_GAME_PRESETS) break;
  }
  return presets;
}

export function gamePresetValues(preset: GamePreset): GamePresetValues {
  return normalizePresetValues(preset);
}

export function normalizeGameSettings(value: unknown): GameSettings {
  const settings = isRecord(value) ? value : {};
  const animationSpeed = settings.animationSpeed;
  const aiThinkingTime = Number(settings.aiThinkingTime);
  const cardStyle = settings.cardStyle;
  const replaySpeed = settings.replaySpeed;
  const displayDensity = settings.displayDensity;
  const volume = Number(settings.volume);
  return {
    animationSpeed: ["reduced", "normal", "fast"].includes(
      String(animationSpeed),
    )
      ? (animationSpeed as GameSettings["animationSpeed"])
      : DEFAULT_GAME_SETTINGS.animationSpeed,
    aiThinkingTime: [0, 360, 800].includes(aiThinkingTime)
      ? (aiThinkingTime as GameSettings["aiThinkingTime"])
      : DEFAULT_GAME_SETTINGS.aiThinkingTime,
    soundEnabled: normalizeBoolean(
      settings.soundEnabled,
      DEFAULT_GAME_SETTINGS.soundEnabled,
    ),
    musicEnabled: normalizeBoolean(
      settings.musicEnabled,
      DEFAULT_GAME_SETTINGS.musicEnabled,
    ),
    volume: Number.isFinite(volume)
      ? Math.min(100, Math.max(0, volume))
      : DEFAULT_GAME_SETTINGS.volume,
    cardStyle: ["classic", "high-contrast"].includes(String(cardStyle))
      ? (cardStyle as GameSettings["cardStyle"])
      : DEFAULT_GAME_SETTINGS.cardStyle,
    replaySpeed: ["slow", "normal", "fast"].includes(String(replaySpeed))
      ? (replaySpeed as GameSettings["replaySpeed"])
      : DEFAULT_GAME_SETTINGS.replaySpeed,
    beginnerHints: normalizeBoolean(
      settings.beginnerHints,
      DEFAULT_GAME_SETTINGS.beginnerHints,
    ),
    displayDensity: ["standard", "compact", "portrait"].includes(
      String(displayDensity),
    )
      ? (displayDensity as DisplayDensity)
      : DEFAULT_GAME_SETTINGS.displayDensity,
    confirmAllIn: normalizeBoolean(
      settings.confirmAllIn,
      DEFAULT_GAME_SETTINGS.confirmAllIn,
    ),
    confirmLargeBet: normalizeBoolean(
      settings.confirmLargeBet,
      DEFAULT_GAME_SETTINGS.confirmLargeBet,
    ),
    confirmLeaveTable: normalizeBoolean(
      settings.confirmLeaveTable,
      DEFAULT_GAME_SETTINGS.confirmLeaveTable,
    ),
    customPresets: normalizeCustomGamePresets(settings.customPresets),
  };
}
