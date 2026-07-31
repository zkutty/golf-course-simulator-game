import { describe, expect, it } from "vitest";
import { BIOME_KEYS } from "../game/models/biomes";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../game/models/defaults";
import { activeWeather, createSeasonalState, seasonalState } from "../game/seasons/seasons";
import {
  BIOME_CONTEXT_PROFILES,
  BIOME_UI_ALLOWED_SURFACES,
  biomeContextAttributes,
  biomeUiStyle,
  biomeUiTheme,
  contrastRatio,
} from "./biomeUiTheme";
import {
  neutralLoadingBiomeContext,
  savedLoadingBiomeContext,
} from "./loadingBiomeContext";

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
      "--biome-season-surface": theme.seasonSurface,
      "--biome-edge": theme.edge,
      "--biome-weather-edge": theme.weatherEdge,
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

  it("resolves every biome and season through one exhaustive contextual profile", () => {
    for (const biome of BIOME_KEYS) {
      for (const season of ["spring", "summer", "autumn", "winter"] as const) {
        const theme = biomeUiTheme(biome, { season, weather: "clear" });
        expect(theme).toMatchObject({
          biome,
          season,
          character: BIOME_CONTEXT_PROFILES[biome].character,
          motif: BIOME_CONTEXT_PROFILES[biome].motif,
          illustration: BIOME_CONTEXT_PROFILES[biome].illustration,
        });
        expect(contrastRatio(theme.accentOnLight, "#fffdf6"))
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("makes every allowed contextual surface self-identifying without changing semantics", () => {
    const theme = biomeUiTheme("desert", {
      season: "autumn",
      weather: "drought",
    });
    for (const surface of BIOME_UI_ALLOWED_SURFACES) {
      expect(biomeContextAttributes(theme, surface, "warning")).toEqual({
        "data-biome-context": surface,
        "data-biome": "desert",
        "data-biome-character": "mineral",
        "data-biome-motif": "sun",
        "data-biome-illustration": "irrigation-rings",
        "data-season": "autumn",
        "data-weather": "drought",
        "data-status-tone": "warning",
      });
    }
  });

  it("uses a canonical neutral destination when loading metadata is incomplete", () => {
    expect(neutralLoadingBiomeContext(undefined)).toEqual({
      theme: BIOME_KEYS[0],
      season: "summer",
      weather: "clear",
    });
    expect(neutralLoadingBiomeContext("desert")).toEqual({
      theme: "desert",
      season: "summer",
      weather: "clear",
    });
  });

  it("derives parsed-save season and weather from the destination day", () => {
    const course = { ...DEFAULT_COURSE, theme: "links" as const };
    const world = {
      ...DEFAULT_WORLD,
      week: 30,
      seasonal: createSeasonalState({
        runSeed: DEFAULT_WORLD.runSeed,
        theme: "links",
        week: 30,
        day: 0,
      }),
    };
    expect(savedLoadingBiomeContext({ course, world })).toEqual({
      theme: "links",
      season: seasonalState(world, course, 0).calendar.season,
      weather: activeWeather(world, course, 0).kind,
    });
  });
});
