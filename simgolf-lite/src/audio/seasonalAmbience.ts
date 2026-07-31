import type { SeasonName, WeatherKind } from "../game/seasons/types";

export type ProceduralAmbienceFamily =
  | "birds"
  | "water"
  | "wind"
  | "murmur"
  | "crickets"
  | "rain";

export interface SeasonalAmbienceLayer {
  birds: number;
  wind: number;
  insects: number;
}

export interface WeatherAmbienceLayer {
  birds: number;
  windFloor: number;
  insects: number;
  rain: number;
  activity: number;
}

/**
 * Reusable season profiles. They shape the shared bird, wind, and insect
 * families rather than starting additional sources, so a season transition is
 * a gain crossfade and cannot double an acoustic family.
 */
export const SEASONAL_AMBIENCE_LAYERS: Readonly<Record<SeasonName, Readonly<SeasonalAmbienceLayer>>> = Object.freeze({
  spring: Object.freeze({ birds: 1.15, wind: 0.82, insects: 0.28 }),
  summer: Object.freeze({ birds: 1, wind: 0.72, insects: 1 }),
  autumn: Object.freeze({ birds: 0.58, wind: 1.18, insects: 0.34 }),
  winter: Object.freeze({ birds: 0.16, wind: 1.32, insects: 0 }),
});

/** Exhaustive weather policy used after the season layer. */
export const WEATHER_AMBIENCE_LAYERS: Readonly<Record<WeatherKind, Readonly<WeatherAmbienceLayer>>> = Object.freeze({
  clear: Object.freeze({ birds: 1, windFloor: 0, insects: 1, rain: 0, activity: 1 }),
  cloudy: Object.freeze({ birds: 0.82, windFloor: 0.18, insects: 0.72, rain: 0, activity: 0.9 }),
  rain: Object.freeze({ birds: 0.2, windFloor: 0.28, insects: 0, rain: 0.5, activity: 0.55 }),
  heavy_rain: Object.freeze({ birds: 0.06, windFloor: 0.5, insects: 0, rain: 0.78, activity: 0.25 }),
  storm: Object.freeze({ birds: 0, windFloor: 0.82, insects: 0, rain: 1, activity: 0.08 }),
  heat: Object.freeze({ birds: 0.62, windFloor: 0.08, insects: 0.78, rain: 0, activity: 0.75 }),
  drought: Object.freeze({ birds: 0.38, windFloor: 0.22, insects: 0.48, rain: 0, activity: 0.8 }),
  frost: Object.freeze({ birds: 0.12, windFloor: 0.3, insects: 0, rain: 0, activity: 0.65 }),
});

export const PROCEDURAL_AMBIENCE_PROVENANCE = Object.freeze({
  source: Object.freeze({
    kind: "runtime-synthesis",
    implementation: "src/audio/AudioManager.ts",
    samples: "none",
  }),
  license: Object.freeze({
    status: "project-original",
    expression: "CC0-1.0",
  }),
  mastering: Object.freeze({
    method: "WebAudio filtered brown-noise synthesis",
    signalPath: "one source per acoustic family through the ambience gain bus",
  }),
  loop: Object.freeze({
    mode: "generated-periodic-buffer",
    durationSeconds: 4,
    transition: "gain-ramped",
  }),
  loudness: Object.freeze({
    status: "unmeasured",
    control: "bounded family gains plus master and ambience mixer buses",
  }),
});

export function hasWeatherPriority(weatherKind: WeatherKind): boolean {
  return weatherKind !== "clear";
}
