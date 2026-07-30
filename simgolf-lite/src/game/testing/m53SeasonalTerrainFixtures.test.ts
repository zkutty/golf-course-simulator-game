import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BIOME_KEYS } from "../models/biomes";
import { SEASONS } from "../seasons/types";
import { weatherForDay } from "../seasons/seasons";
import { BIOME_REFERENCE_ROTATIONS } from "./biomeAuthoring";
import {
  M53_SEASONAL_QUALITIES,
  M53_SEASONAL_TERRAIN_FIXTURES,
  m53SeasonalTerrainFixture,
} from "./m53SeasonalTerrainFixtures";

describe("ZK-567 M53 seasonal terrain golden fixture plumbing", () => {
  it("covers three biomes, four seasons/severe weather states, four rotations, and three qualities", () => {
    expect(M53_SEASONAL_TERRAIN_FIXTURES).toHaveLength(3 * 4 * 4 * 3);
    expect(new Set(M53_SEASONAL_TERRAIN_FIXTURES.map((fixture) => fixture.id)).size)
      .toBe(M53_SEASONAL_TERRAIN_FIXTURES.length);
    expect(new Set(M53_SEASONAL_TERRAIN_FIXTURES.map((fixture) => fixture.biome)))
      .toEqual(new Set(BIOME_KEYS));
    expect(new Set(M53_SEASONAL_TERRAIN_FIXTURES.map((fixture) => fixture.season)))
      .toEqual(new Set(SEASONS));
    expect(new Set(M53_SEASONAL_TERRAIN_FIXTURES.map((fixture) => fixture.rotation)))
      .toEqual(new Set(BIOME_REFERENCE_ROTATIONS));
    expect(new Set(M53_SEASONAL_TERRAIN_FIXTURES.map((fixture) => fixture.quality)))
      .toEqual(new Set(M53_SEASONAL_QUALITIES));
    for (const fixture of M53_SEASONAL_TERRAIN_FIXTURES) {
      const weather = weatherForDay(
        fixture.seed,
        fixture.biome,
        fixture.absoluteDay,
      );
      expect(weather.kind).toBe(fixture.weather);
      expect(weather.severity).toBeGreaterThan(.45);
      expect(m53SeasonalTerrainFixture(new URLSearchParams(fixture.query.split("?")[1]))).toEqual(fixture);
    }
  });

  it("pins the canonical machine fixture matrix without storing image duplicates", () => {
    const canonical = M53_SEASONAL_TERRAIN_FIXTURES.map((fixture) => [
      fixture.id,
      fixture.absoluteDay,
      fixture.query,
    ]);
    expect(createHash("sha256").update(JSON.stringify(canonical)).digest("hex"))
      .toBe("79bf4d96de54b1b12b8e09bf68c5907f35ddcef9d1c8460975ba7aaefdd60f0d");
  });
});
