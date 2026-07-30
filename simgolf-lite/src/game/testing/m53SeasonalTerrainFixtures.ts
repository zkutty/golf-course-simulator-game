import { BIOME_KEYS, type LandTheme } from "../models/biomes";
import { SEASONS, type SeasonName, type WeatherKind } from "../seasons/types";
import type { SeasonalTerrainQuality } from "../render/seasonalTerrainPresentation";
import { BIOME_REFERENCE_ROTATIONS, type BiomeReferenceRotation } from "./biomeAuthoring";

export const M53_SEASONAL_QUALITIES: readonly SeasonalTerrainQuality[] = [
  "low",
  "medium",
  "high",
];

interface SevereWeatherFixture {
  readonly seed: number;
  readonly absoluteDay: number;
  readonly weather: WeatherKind;
}

/**
 * Small precomputed seed/day pairs found by a bounded deterministic search.
 * `weatherForDay(seed, biome, absoluteDay)` is asserted in the fixture test;
 * the application does not bypass the authoritative weather projection.
 */
export const M53_SEVERE_WEATHER_FIXTURES: Record<
  LandTheme,
  Record<SeasonName, SevereWeatherFixture>
> = {
  parkland: {
    spring: { seed: 3, absoluteDay: 2, weather: "storm" },
    summer: { seed: 2, absoluteDay: 58, weather: "drought" },
    autumn: { seed: 2, absoluteDay: 112, weather: "storm" },
    winter: { seed: 2, absoluteDay: 204, weather: "heavy_rain" },
  },
  links: {
    spring: { seed: 3, absoluteDay: 2, weather: "storm" },
    summer: { seed: 2, absoluteDay: 70, weather: "storm" },
    autumn: { seed: 2, absoluteDay: 112, weather: "storm" },
    winter: { seed: 2, absoluteDay: 204, weather: "frost" },
  },
  desert: {
    spring: { seed: 3, absoluteDay: 15, weather: "storm" },
    summer: { seed: 1, absoluteDay: 78, weather: "drought" },
    autumn: { seed: 2, absoluteDay: 118, weather: "storm" },
    winter: { seed: 1, absoluteDay: 203, weather: "storm" },
  },
};

export interface M53SeasonalTerrainFixture {
  readonly id: string;
  readonly biome: LandTheme;
  readonly seed: number;
  readonly season: SeasonName;
  readonly weather: WeatherKind;
  readonly absoluteDay: number;
  readonly rotation: BiomeReferenceRotation;
  readonly quality: SeasonalTerrainQuality;
  readonly query: string;
}

export const M53_SEASONAL_TERRAIN_FIXTURES: readonly M53SeasonalTerrainFixture[] =
  Object.freeze(BIOME_KEYS.flatMap((biome) =>
    SEASONS.flatMap((season) =>
      BIOME_REFERENCE_ROTATIONS.flatMap((rotation) =>
        M53_SEASONAL_QUALITIES.map((quality) => {
          const severe = M53_SEVERE_WEATHER_FIXTURES[biome][season];
          const weather = severe.weather;
          const id = `${biome}-${season}-${weather}-r${rotation}-${quality}`;
          const params = new URLSearchParams({
            m53Fixture: "1",
            m53Theme: biome,
            m53Seed: String(severe.seed),
            m53Season: season,
            m53Weather: weather,
            m53Rotation: String(rotation),
            m53Quality: quality,
          });
          return Object.freeze({
            id,
            biome,
            seed: severe.seed,
            season,
            weather,
            absoluteDay: severe.absoluteDay,
            rotation,
            quality,
            query: `/?${params.toString()}`,
          });
        }),
      ),
    ),
  ));

export function m53SeasonalTerrainFixture(
  params: URLSearchParams,
): M53SeasonalTerrainFixture {
  const biome = BIOME_KEYS.includes(params.get("m53Theme") as LandTheme)
    ? params.get("m53Theme") as LandTheme
    : BIOME_KEYS[0];
  const season = SEASONS.includes(params.get("m53Season") as SeasonName)
    ? params.get("m53Season") as SeasonName
    : "winter";
  const parsedRotation = Number(params.get("m53Rotation") ?? 0);
  const rotation = BIOME_REFERENCE_ROTATIONS.includes(parsedRotation as BiomeReferenceRotation)
    ? parsedRotation as BiomeReferenceRotation
    : 0;
  const quality = M53_SEASONAL_QUALITIES.includes(params.get("m53Quality") as SeasonalTerrainQuality)
    ? params.get("m53Quality") as SeasonalTerrainQuality
    : "high";
  const requestedWeather = params.get("m53Weather") as WeatherKind | null;
  const severe = M53_SEVERE_WEATHER_FIXTURES[biome][season];
  const weather = requestedWeather ?? severe.weather;
  return M53_SEASONAL_TERRAIN_FIXTURES.find((fixture) =>
    fixture.biome === biome
    && fixture.season === season
    && fixture.rotation === rotation
    && fixture.quality === quality
    && fixture.weather === weather
  ) ?? {
    id: `${biome}-${season}-${weather}-r${rotation}-${quality}`,
    biome,
    seed: severe.seed,
    season,
    weather,
    absoluteDay: severe.absoluteDay,
    rotation,
    quality,
    query: `/?${params.toString()}`,
  };
}
