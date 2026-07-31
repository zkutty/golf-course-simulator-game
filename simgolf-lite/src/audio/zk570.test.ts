import { describe, expect, it } from "vitest";
import type { Course } from "../game/models/types";
import { SEASONS, type SeasonName, type WeatherKind } from "../game/seasons/types";
import { ambientMixFor } from "./environment";
import {
  PROCEDURAL_AMBIENCE_PROVENANCE,
  SEASONAL_AMBIENCE_LAYERS,
  WEATHER_AMBIENCE_LAYERS,
  hasWeatherPriority,
} from "./seasonalAmbience";
import { ALL_SUNO_AUDIO } from "./sunoLibrary";

const WEATHER_KINDS: readonly WeatherKind[] = [
  "clear",
  "cloudy",
  "rain",
  "heavy_rain",
  "storm",
  "heat",
  "drought",
  "frost",
];

function course(): Course {
  const width = 6;
  const height = 4;
  return {
    width,
    height,
    tiles: [
      ...Array(6).fill("deep_rough"),
      ...Array(6).fill("rough"),
      ...Array(6).fill("water"),
      ...Array(6).fill("fairway"),
    ],
    elevations: Array(width * height).fill(0),
    holes: [],
    obstacles: [
      { x: 1, y: 0, type: "tree" },
      { x: 2, y: 0, type: "tree" },
      { x: 3, y: 0, type: "tree" },
    ],
    buildings: [],
    yardsPerTile: 10,
    name: "Seasonal audio policy",
    baseGreenFee: 10,
    condition: 1,
  } as Course;
}

function mix(season: SeasonName, weatherKind: WeatherKind, dayMinute = 780) {
  return ambientMixFor({
    course: course(),
    center: { x: 2, y: 1 },
    dayMinute,
    visibleGolfers: 4,
    paused: false,
    season,
    weatherKind,
    radius: 2,
  });
}

describe("ZK-570 seasonal ambience policy", () => {
  it("is exhaustive and reusable across every season and weather kind", () => {
    expect(Object.keys(SEASONAL_AMBIENCE_LAYERS)).toEqual([...SEASONS]);
    expect(Object.keys(WEATHER_AMBIENCE_LAYERS)).toEqual(WEATHER_KINDS);
    for (const season of SEASONS) {
      const resolved = mix(season, "clear");
      expect(resolved.season).toBe(season);
      expect(resolved.weatherKind).toBe("clear");
      expect([resolved.birds, resolved.water, resolved.wind, resolved.murmur, resolved.crickets, resolved.rain])
        .toEqual(expect.arrayContaining([expect.any(Number)]));
      for (const level of [
        resolved.birds,
        resolved.water,
        resolved.wind,
        resolved.murmur,
        resolved.crickets,
        resolved.rain,
      ]) {
        expect(level).toBeGreaterThanOrEqual(0);
        expect(level).toBeLessThanOrEqual(1);
      }
    }
    for (const weatherKind of WEATHER_KINDS) {
      expect(mix("summer", weatherKind).weatherKind).toBe(weatherKind);
    }
  });

  it("makes weather authoritative without stacking duplicate nature families", () => {
    const clear = mix("summer", "clear");
    const rain = mix("summer", "rain");
    const heavyRain = mix("summer", "heavy_rain");
    const storm = mix("summer", "storm");
    expect(rain.bed).toBe("rain");
    expect(heavyRain.bed).toBe("rain");
    expect(storm.bed).toBe("rain");
    expect(clear.rain).toBe(0);
    expect(rain.rain).toBeGreaterThan(0);
    expect(heavyRain.rain).toBeGreaterThan(rain.rain);
    expect(storm.rain).toBeGreaterThan(heavyRain.rain);
    expect(storm.birds).toBe(0);
    expect(storm.crickets).toBe(0);
    expect(storm.wind).toBeGreaterThan(clear.wind);
    expect(hasWeatherPriority("clear")).toBe(false);
    for (const weatherKind of WEATHER_KINDS.filter((kind) => kind !== "clear")) {
      expect(hasWeatherPriority(weatherKind)).toBe(true);
    }
  });

  it("cross-season profiles keep insects out of winter and shift autumn toward wind", () => {
    const spring = mix("spring", "clear");
    const summer = mix("summer", "clear");
    const autumn = mix("autumn", "clear");
    const winter = mix("winter", "clear");
    expect(spring.birds).toBeGreaterThan(winter.birds);
    expect(summer.crickets).toBeGreaterThan(autumn.crickets);
    expect(winter.crickets).toBe(0);
    expect(autumn.wind).toBeGreaterThan(summer.wind);
    expect(winter.wind).toBeGreaterThan(autumn.wind);
  });

  it("composes operational campus and resort activity without overriding weather", () => {
    const c = course();
    c.property = {
      assets: [
        {
          id: "campus",
          kind: "clubhouse",
          name: "Clubhouse",
          category: "clubhouse",
          x: 2,
          y: 1,
          width: 1,
          height: 1,
          tier: 1,
          capacity: 8,
          condition: 1,
          price: 1,
          enabled: true,
          constructionDaysRemaining: 0,
        },
      ],
    } as Course["property"];
    const input = {
      course: c,
      center: { x: 2, y: 1 },
      dayMinute: 400,
      visibleGolfers: 0,
      paused: false,
      season: "spring" as const,
      radius: 1,
    };
    const clear = ambientMixFor({ ...input, weatherKind: "clear" });
    const storm = ambientMixFor({ ...input, weatherKind: "storm" });
    expect(clear.bed).toBe("campus");
    expect(clear.murmur).toBeGreaterThan(0);
    expect(storm.bed).toBe("rain");
    expect(storm.murmur).toBeLessThan(clear.murmur);
  });

  it("records explicit machine-auditable provenance without perceptual claims", () => {
    expect(PROCEDURAL_AMBIENCE_PROVENANCE.source.samples).toBe("none");
    expect(PROCEDURAL_AMBIENCE_PROVENANCE.loudness.status).toBe("unmeasured");
    for (const asset of ALL_SUNO_AUDIO) {
      expect(asset.provenance.source.kind).toBe("suno-generation");
      expect(asset.provenance.license.status).toBe("pending-release-audit");
      expect(asset.provenance.mastering).toEqual({
        runtimeFormat: "MP3",
        bitrateKbps: 96,
        treatment: "source-export-no-project-remaster-documented",
      });
      expect(asset.provenance.loop).toEqual({
        mode: "sequential-playlist",
        seamless: false,
        overlappingCrossfade: false,
      });
      expect(asset.provenance.loudness).toEqual({
        status: "unmeasured",
        runtimeControl: "master-and-channel-gain",
      });
    }
  });
});
