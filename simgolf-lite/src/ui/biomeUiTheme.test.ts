import { describe, expect, it } from "vitest";
import { BIOME_KEYS } from "../game/models/biomes";
import { biomeUiStyle, biomeUiTheme, contrastRatio } from "./biomeUiTheme";

describe("ZK-623 biome UI contract", () => {
  it("derives a contrast-safe, registry-backed context for every playable biome", () => {
    for (const biome of BIOME_KEYS) {
      const theme = biomeUiTheme(biome);
      expect(theme.biome).toBe(biome);
      expect(theme.fallback).toBe(false);
      expect(contrastRatio(theme.accentOnLight, "#fffdf6")).toBeGreaterThanOrEqual(4.5);
      expect(theme.allowedSurfaces).toContain("course-frame");
      expect(theme.forbiddenSurfaces).toContain("focus-indicator");
    }
  });

  it("uses the registry default for incomplete themes without changing shell tokens", () => {
    const theme = biomeUiTheme("incomplete-biome", { reducedMotion: true, colorVision: "deuteranopia" });
    expect(theme).toMatchObject({ biome: BIOME_KEYS[0], fallback: true, reducedMotion: true });
    expect(contrastRatio(theme.accentOnLight, "#fffdf6")).toBeGreaterThanOrEqual(4.5);
    expect(biomeUiStyle(theme)).toEqual({
      "--biome-accent": theme.accent,
      "--biome-accent-on-light": theme.accentOnLight,
      "--biome-surface": theme.surface,
      "--biome-edge": theme.edge,
      "--biome-motion-duration": "0ms",
    });
  });

  it("keeps weather cues contextual rather than turning them into a full skin", () => {
    const clear = biomeUiTheme("links", { weather: "clear" });
    const storm = biomeUiTheme("links", { weather: "storm" });
    expect(clear.motif).toBe("wind");
    expect(storm.edge).not.toBe(clear.edge);
    expect(storm.accent).toBe(clear.accent);
  });

  it("uses distinct registry presentation cues for the three reference biomes", () => {
    expect(new Set(BIOME_KEYS.map((biome) => biomeUiTheme(biome).accent)).size).toBe(BIOME_KEYS.length);
  });
});
