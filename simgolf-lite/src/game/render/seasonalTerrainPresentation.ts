import { TERRAIN_PALETTES } from "../../accessibility/terrainPalettes";
import type { SeasonalVisualState } from "../presentation/seasonalVisualState";
import type { LandTheme, Terrain } from "../models/types";
import { BIOME_DEFINITIONS } from "../models/biomes";
import type { ColorVisionMode } from "../onboarding/profile";
import type { SeasonName } from "../seasons/types";
import {
  SEASONAL_COVERAGE_CONTRACT,
  seasonalCoverageFor,
  type SeasonalClimateSignal,
} from "./seasonalCoverage";

export type SeasonalTerrainQuality = "low" | "medium" | "high";
export type SeasonalTerrainCue =
  | "puddle"
  | "drought-crack"
  | "frost-crystal"
  | "partial-snow"
  | "leaf-litter"
  | "recovery-sprout"
  | "water-sheen";

export const SEASONAL_TERRAIN_DECAL_BUDGET: Record<SeasonalTerrainQuality, number> = {
  low: 0,
  medium: 220,
  high: 420,
};

interface TreatmentProfile {
  readonly dormancy: number;
  readonly wetness: number;
  readonly drought: number;
  readonly frost: number;
  readonly snow: number;
  readonly leafLitter: number;
  readonly exposure: number;
}

/**
 * These are presentation profiles, not biome branches. Biomes select one
 * declaratively through the ZK-379 coverage contract and M52 phenology
 * registry, so a future biome can inherit an existing treatment rhythm.
 */
const TREATMENT_PROFILES: Record<
  (typeof SEASONAL_COVERAGE_CONTRACT.biomes)[LandTheme]["direction"],
  TreatmentProfile
> = {
  "four-season": {
    dormancy: 1,
    wetness: 1,
    drought: .78,
    frost: 1,
    snow: 1,
    leafLitter: 1,
    exposure: .25,
  },
  "exposed-muted": {
    dormancy: .68,
    wetness: .9,
    drought: .72,
    frost: .72,
    snow: .58,
    leafLitter: .34,
    exposure: 1,
  },
  "drought-heat-led": {
    dormancy: .42,
    wetness: .58,
    drought: 1,
    frost: .22,
    snow: 0,
    leafLitter: .16,
    exposure: .38,
  },
};

interface TerrainResponse {
  readonly turf: number;
  readonly wet: number;
  readonly drought: number;
  readonly frost: number;
  readonly snow: number;
  readonly litter: number;
  readonly recovery: number;
  readonly aquatic: boolean;
}

const TERRAIN_RESPONSE: Record<Terrain, TerrainResponse> = {
  fairway: { turf: 1, wet: .75, drought: .88, frost: .95, snow: .72, litter: .35, recovery: 1, aquatic: false },
  green: { turf: 1, wet: .42, drought: .62, frost: .9, snow: .34, litter: .05, recovery: 1, aquatic: false },
  tee: { turf: 1, wet: .48, drought: .72, frost: .9, snow: .38, litter: .08, recovery: .9, aquatic: false },
  rough: { turf: .9, wet: .8, drought: .92, frost: .82, snow: .84, litter: 1, recovery: .8, aquatic: false },
  deep_rough: { turf: .74, wet: .72, drought: 1, frost: .7, snow: .78, litter: 1, recovery: .62, aquatic: false },
  waste_area: { turf: 0, wet: .5, drought: 1, frost: .32, snow: .48, litter: .16, recovery: .12, aquatic: false },
  sand: { turf: 0, wet: .7, drought: .25, frost: .2, snow: .28, litter: .08, recovery: 0, aquatic: false },
  path: { turf: 0, wet: .88, drought: .7, frost: .45, snow: .42, litter: .48, recovery: 0, aquatic: false },
  wetland: { turf: .25, wet: 1, drought: .38, frost: .5, snow: .16, litter: .32, recovery: .38, aquatic: true },
  water: { turf: 0, wet: 1, drought: 0, frost: .22, snow: 0, litter: 0, recovery: 0, aquatic: true },
};

export interface SeasonalTerrainChannels {
  readonly dormancy: number;
  readonly wetness: number;
  readonly puddling: number;
  readonly drought: number;
  readonly frost: number;
  readonly snow: number;
  readonly leafLitter: number;
  readonly recovery: number;
}

export interface SeasonalTerrainTreatment {
  readonly terrain: Terrain;
  readonly quality: SeasonalTerrainQuality;
  readonly color: number;
  /** Multiplicative tint for authored atlas/material-field textures. */
  readonly textureTint: number;
  readonly channels: SeasonalTerrainChannels;
  readonly supportedCues: readonly SeasonalTerrainCue[];
  readonly aquatic: boolean;
  /** Opaque seasonal coverage is forbidden; snow is always a partial decal. */
  readonly opaqueCoverage: 0;
  readonly signature: string;
}

export interface SeasonalTerrainTreatmentInput {
  readonly state: SeasonalVisualState;
  readonly terrain: Terrain;
  readonly quality: SeasonalTerrainQuality;
  readonly colorVision: ColorVisionMode;
  readonly baseColor?: number;
  readonly reducedMotion?: boolean;
}

export interface SeasonalTerrainDecal {
  readonly cue: SeasonalTerrainCue;
  readonly terrain: Terrain;
  readonly x: number;
  readonly y: number;
  readonly alpha: number;
  readonly scale: number;
  readonly rotation: number;
  readonly color: number;
  readonly opaque: false;
}

export interface SeasonalTerrainDecalInput {
  readonly state: SeasonalVisualState;
  readonly tiles: readonly Terrain[];
  readonly width: number;
  readonly height: number;
  readonly quality: SeasonalTerrainQuality;
  readonly colorVision: ColorVisionMode;
  readonly seed: number;
  readonly reducedMotion?: boolean;
  readonly protectedCells?: ReadonlySet<number>;
}

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const round = (value: number) => Number(clamp(value).toFixed(4));

function mixColor(from: number, to: number, amount: number): number {
  const t = clamp(amount);
  const channel = (shift: number) => Math.round(
    ((from >> shift) & 0xff) + (((to >> shift) & 0xff) - ((from >> shift) & 0xff)) * t,
  );
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

function multiplyColor(...colors: number[]): number {
  const channel = (shift: number) => Math.round(
    colors.reduce((value, color) => value * ((color >> shift) & 0xff) / 255, 255),
  );
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

function seasonSignalWeight(
  biome: LandTheme,
  state: SeasonalVisualState,
  signal: SeasonalClimateSignal,
): number {
  const hasSignal = (season: SeasonName) => {
    const families = [
      "terrain-material-fields",
      "terrain-details-ground-cover",
      "condition-wear",
      "weather-dressing",
    ] as const;
    return families.some((family) => seasonalCoverageFor(biome, season, family).signals.includes(signal));
  };
  const { fromSeason, toSeason, blend } = state.climate.transition;
  const from = hasSignal(fromSeason) ? 1 : 0;
  const to = hasSignal(toSeason) ? 1 : 0;
  const transitionWeight = from + (to - from) * blend;
  // A small, symmetric maturity curve makes the middle of a season the
  // fullest expression while preserving equal values on either boundary.
  const maturity = .82 + Math.sin(Math.PI * state.climate.calendar.seasonProgress) * .18;
  return clamp(transitionWeight * maturity);
}

function phaseWeight(state: SeasonalVisualState, phase: string): number {
  const { from, to } = state.climate.vegetation.foliage;
  const blend = state.climate.transition.blend;
  return (from === phase ? 1 - blend : 0) + (to === phase ? blend : 0);
}

function textureAdjustment(channels: SeasonalTerrainChannels, aquatic: boolean): number {
  if (aquatic) {
    return mixColor(
      0xffffff,
      0xc5dce4,
      channels.wetness * .14 + channels.frost * .12,
    );
  }
  let tint = 0xffffff;
  tint = mixColor(tint, 0xd6c68c, channels.dormancy * .32);
  tint = multiplyColor(tint, mixColor(0xffffff, 0xc8d7d4, channels.wetness * .16));
  tint = multiplyColor(tint, mixColor(0xffffff, 0xe0b56c, channels.drought * .22));
  tint = mixColor(tint, 0xe7eef1, channels.frost * .22);
  tint = mixColor(tint, 0xe8f0f2, channels.snow * .14);
  return tint;
}

export function seasonalTerrainTreatment(
  input: SeasonalTerrainTreatmentInput,
): SeasonalTerrainTreatment {
  const { state, terrain, quality, colorVision } = input;
  const biome = state.climate.biome;
  const profile = TREATMENT_PROFILES[SEASONAL_COVERAGE_CONTRACT.biomes[biome].direction];
  const response = TERRAIN_RESPONSE[terrain];
  const severity = clamp(state.weather.severity);
  const wetWeather = ["rain", "heavy_rain", "storm"].includes(state.weather.kind)
    ? .55 + severity * .45
    : state.weather.kind === "frost" ? .35 : .18;
  const dryWeather = state.weather.kind === "drought" || state.weather.kind === "heat"
    ? .58 + severity * .42
    : .18;
  const dormancy = state.renderer.vegetationDormancy
    * seasonSignalWeight(biome, state, "dormancy")
    * profile.dormancy
    * response.turf;
  const wetness = clamp((state.renderer.wetness - .42) / .58)
    * seasonSignalWeight(biome, state, "moisture")
    * profile.wetness
    * response.wet
    * wetWeather;
  const puddling = clamp((state.renderer.wetness - .64) / .36)
    * response.wet
    * (response.aquatic ? 0 : 1)
    * severity;
  const droughtSignal = Math.max(
    seasonSignalWeight(biome, state, "drought"),
    seasonSignalWeight(biome, state, "heat") * .72,
  );
  const drought = clamp((state.renderer.dryness - .48) / .52)
    * droughtSignal
    * profile.drought
    * response.drought
    * dryWeather;
  const frost = (state.climate.frost.enabled && state.weather.kind === "frost" ? severity : 0)
    * seasonSignalWeight(biome, state, "frost")
    * profile.frost
    * response.frost;
  const snowTemperature = clamp(
    (state.climate.snow.maximumTemperatureF - state.weather.temperatureF + 5) / 12,
  );
  const coldSnowEligible = state.climate.snow.enabled
    && state.weather.temperatureF <= state.climate.snow.maximumTemperatureF;
  const snowWeatherStrength = state.weather.kind === "frost"
    ? Math.max(.55, severity)
    : coldSnowEligible ? Math.max(.24, severity) : 0;
  const snow = (coldSnowEligible
    ? state.climate.snow.chance * snowWeatherStrength * snowTemperature
    : 0)
    * seasonSignalWeight(biome, state, "snow")
    * profile.snow
    * response.snow
    * (response.aquatic ? 0 : 1);
  const leafLitter = phaseWeight(state, "turning")
    * seasonSignalWeight(biome, state, "foliage")
    * profile.leafLitter
    * response.litter;
  const recovery = clamp((state.modifiers.turfRecoveryMultiplier - 1) / .18)
    * seasonSignalWeight(biome, state, "moisture")
    * response.recovery
    * (1 - dormancy)
    * (1 - drought);
  const channels = Object.freeze({
    dormancy: round(dormancy),
    wetness: round(wetness),
    puddling: round(puddling),
    drought: round(drought),
    frost: round(frost),
    snow: round(snow),
    leafLitter: round(leafLitter),
    recovery: round(recovery),
  });

  const sourceColor = input.baseColor
    ?? (colorVision === "standard"
      ? { ...TERRAIN_PALETTES.standard, ...BIOME_DEFINITIONS[biome].presentation.tileTints }[terrain]
      : TERRAIN_PALETTES[colorVision][terrain]);
  const textureTint = textureAdjustment(channels, response.aquatic);
  let color = multiplyColor(sourceColor, textureTint);
  let resolvedTextureTint = textureTint;
  if (colorVision !== "standard") {
    // Preserve the established ten-color accessibility palette. Seasonal
    // state changes luminance only; shape channels below carry the same data.
    const luminanceTint = mixColor(
      0xffffff,
      channels.frost + channels.snow > channels.drought ? 0xe8e8e8 : 0xc8c8c8,
      clamp(channels.dormancy * .12 + channels.drought * .12 + channels.frost * .08),
    );
    color = multiplyColor(sourceColor, luminanceTint);
    // Medium/High accessibility textures are generated from sourceColor
    // already. Return only the luminance adjustment so the palette is not
    // multiplied into itself; Low authored diamonds use `color` directly.
    resolvedTextureTint = luminanceTint;
  }
  const supportedCues: SeasonalTerrainCue[] = response.aquatic
    ? ["water-sheen"]
    : ["puddle", "drought-crack", "frost-crystal", "partial-snow", "leaf-litter", "recovery-sprout"];
  return Object.freeze({
    terrain,
    quality,
    color,
    textureTint: resolvedTextureTint,
    channels,
    supportedCues: Object.freeze(supportedCues),
    aquatic: response.aquatic,
    opaqueCoverage: 0,
    signature: [
      biome,
      SEASONAL_COVERAGE_CONTRACT.biomes[biome].direction,
      state.climate.transition.fromSeason,
      state.climate.transition.toSeason,
      state.climate.transition.blend.toFixed(4),
      state.climate.calendar.seasonProgress.toFixed(4),
      state.weather.kind,
      state.weather.severity.toFixed(4),
      terrain,
      quality,
      colorVision,
      input.reducedMotion ? "still" : "motion",
      Object.values(channels).join(","),
    ].join(":"),
  });
}

function hashUnit(x: number, y: number, seed: number, salt: number): number {
  let hash = Math.imul(x + 0x9e37, 0x85ebca6b)
    ^ Math.imul(y + 0x7f4a, 0xc2b2ae35)
    ^ Math.imul(seed, 0x27d4eb2d)
    ^ salt;
  hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x1_0000_0000;
}

const CUE_COLOR: Record<SeasonalTerrainCue, number> = {
  puddle: 0x9bc4cd,
  "drought-crack": 0x5d4937,
  "frost-crystal": 0xe2f0f3,
  "partial-snow": 0xf1f4f2,
  "leaf-litter": 0x8f542f,
  "recovery-sprout": 0x5f9a50,
  "water-sheen": 0xd4edf2,
};

function cueIntensity(cue: SeasonalTerrainCue, channels: SeasonalTerrainChannels): number {
  if (cue === "puddle" || cue === "water-sheen") return Math.max(channels.puddling, channels.wetness);
  if (cue === "drought-crack") return channels.drought;
  if (cue === "frost-crystal") return channels.frost;
  if (cue === "partial-snow") return channels.snow;
  if (cue === "leaf-litter") return channels.leafLitter;
  return channels.recovery;
}

/**
 * Produces at most one pooled drawing command per sampled lattice cell. The
 * sampling lattice is world-anchored and independent of day, camera, rotation,
 * and reload; only alpha changes as continuous climate inputs blend.
 */
export function seasonalTerrainDecals(
  input: SeasonalTerrainDecalInput,
): readonly SeasonalTerrainDecal[] {
  const budget = SEASONAL_TERRAIN_DECAL_BUDGET[input.quality];
  if (budget === 0 || input.width <= 0 || input.height <= 0) return Object.freeze([]);
  const area = input.width * input.height;
  const step = Math.max(1, Math.ceil(Math.sqrt(area / budget)));
  const startX = Math.floor(hashUnit(0, 0, input.seed, 0x37) * step);
  const startY = Math.floor(hashUnit(0, 0, input.seed, 0x91) * step);
  const decals: SeasonalTerrainDecal[] = [];
  for (let y = startY; y < input.height && decals.length < budget; y += step) {
    for (let x = startX; x < input.width && decals.length < budget; x += step) {
      const cell = y * input.width + x;
      if (input.protectedCells?.has(cell)) continue;
      const terrain = input.tiles[cell];
      if (!terrain) continue;
      const treatment = seasonalTerrainTreatment({
        state: input.state,
        terrain,
        quality: input.quality,
        colorVision: input.colorVision,
        reducedMotion: input.reducedMotion,
      });
      let selected: SeasonalTerrainCue | null = null;
      let selectedScore = .01;
      for (const [cueIndex, cue] of treatment.supportedCues.entries()) {
        const intensity = cueIntensity(cue, treatment.channels);
        const variation = .72 + hashUnit(x, y, input.seed, 0x200 + cueIndex * 31) * .28;
        const score = intensity * variation;
        if (score > selectedScore) {
          selected = cue;
          selectedScore = score;
        }
      }
      if (!selected) continue;
      // Aquatic cells can only receive a translucent sheen. In particular,
      // water can never enter the partial-snow or land-dressing paths.
      if (treatment.aquatic && selected !== "water-sheen") continue;
      const alphaCap = selected === "partial-snow" ? .34 : selected === "water-sheen" ? .38 : .48;
      const alpha = round(Math.min(alphaCap, .08 + selectedScore * alphaCap));
      decals.push(Object.freeze({
        cue: selected,
        terrain,
        x: x + .18 + hashUnit(x, y, input.seed, 0x411) * .64,
        y: y + .18 + hashUnit(x, y, input.seed, 0x513) * .64,
        alpha,
        scale: Number((.72 + hashUnit(x, y, input.seed, 0x619) * .56).toFixed(4)),
        rotation: Number((hashUnit(x, y, input.seed, 0x71b) * Math.PI * 2).toFixed(4)),
        color: input.colorVision === "standard"
          ? CUE_COLOR[selected]
          : selected === "drought-crack" || selected === "leaf-litter" ? 0x3f4244 : 0xf2f3f3,
        opaque: false,
      }));
    }
  }
  return Object.freeze(decals);
}

export function seasonalTerrainSummary(
  state: SeasonalVisualState,
  quality: SeasonalTerrainQuality,
  colorVision: ColorVisionMode,
  reducedMotion: boolean,
): Readonly<{
  profile: string;
  quality: SeasonalTerrainQuality;
  colorVision: ColorVisionMode;
  reducedMotion: boolean;
  decalBudget: number;
  terrains: Readonly<Record<Terrain, Pick<SeasonalTerrainTreatment, "channels" | "supportedCues" | "aquatic" | "opaqueCoverage">>>;
}> {
  const terrains = Object.fromEntries(Object.keys(TERRAIN_RESPONSE).map((terrain) => {
    const treatment = seasonalTerrainTreatment({
      state,
      terrain: terrain as Terrain,
      quality,
      colorVision,
      reducedMotion,
    });
    return [terrain, {
      channels: treatment.channels,
      supportedCues: treatment.supportedCues,
      aquatic: treatment.aquatic,
      opaqueCoverage: treatment.opaqueCoverage,
    }];
  })) as Record<Terrain, Pick<SeasonalTerrainTreatment, "channels" | "supportedCues" | "aquatic" | "opaqueCoverage">>;
  return Object.freeze({
    profile: SEASONAL_COVERAGE_CONTRACT.biomes[state.climate.biome].direction,
    quality,
    colorVision,
    reducedMotion,
    decalBudget: SEASONAL_TERRAIN_DECAL_BUDGET[quality],
    terrains: Object.freeze(terrains),
  });
}
