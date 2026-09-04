import { describe, expect, it } from "vitest";
import {
  BUILT_IN_GAME_PRESETS,
  MAX_CUSTOM_GAME_PRESETS,
  normalizeGameSettings,
} from "@/domain/settings";

describe("game settings and presets", () => {
  it("keeps legacy settings compatible with the standard density", () => {
    expect(
      normalizeGameSettings({
        aiThinkingTime: 0,
        cardStyle: "high-contrast",
      }),
    ).toMatchObject({
      aiThinkingTime: 0,
      cardStyle: "high-contrast",
      displayDensity: "standard",
      confirmAllIn: true,
      confirmLargeBet: true,
      confirmLeaveTable: true,
      customPresets: [],
    });
  });

  it("defines four immutable built-in presets with valid table settings", () => {
    expect(BUILT_IN_GAME_PRESETS.map((preset) => preset.name)).toEqual([
      "标准",
      "快速练习",
      "深筹码",
      "复盘",
    ]);
    expect(new Set(BUILT_IN_GAME_PRESETS.map((preset) => preset.id)).size).toBe(
      4,
    );
    for (const preset of BUILT_IN_GAME_PRESETS) {
      expect(preset.builtIn).toBe(true);
      expect(preset.aiCount).toBeGreaterThanOrEqual(1);
      expect(preset.aiCount).toBeLessThanOrEqual(5);
      expect(preset.buyIn).toBeGreaterThanOrEqual(500);
    }
  });

  it("sanitizes, deduplicates and limits imported custom presets", () => {
    const candidate = (index: number) => ({
      id: `custom-preset-${index}`,
      name: `预设 ${index}`,
      builtIn: false,
      createdAt: "2026-09-04T00:00:00.000Z",
      aiCount: index === 0 ? 20 : 2,
      buyIn: index === 0 ? 777 : 1_200,
      blinds: "25/50",
      animationSpeed: "fast",
      aiThinkingTime: 0,
      soundEnabled: true,
      replaySpeed: "fast",
      beginnerHints: false,
      displayDensity: "portrait",
    });
    const normalized = normalizeGameSettings({
      customPresets: [
        ...Array.from({ length: 14 }, (_, index) => candidate(index)),
        candidate(0),
        { id: "builtin-standard", name: "非法覆盖" },
      ],
    });

    expect(normalized.customPresets).toHaveLength(MAX_CUSTOM_GAME_PRESETS);
    expect(normalized.customPresets[0]).toMatchObject({
      aiCount: 5,
      buyIn: 800,
      blinds: "25/50",
      displayDensity: "portrait",
    });
    expect(
      new Set(normalized.customPresets.map((preset) => preset.id)).size,
    ).toBe(MAX_CUSTOM_GAME_PRESETS);
  });
});
