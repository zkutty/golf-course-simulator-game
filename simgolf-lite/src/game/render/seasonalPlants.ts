import type {
  ClimateFoliagePhase,
  LandTheme,
  PlantEcologicalFit,
} from "../models/biomes";
import type {
  PlantSeasonalProfile,
} from "../models/plantRegistry";
import type { PlantId } from "../models/plantTypes";
import type { DecorationKind } from "../models/types";
import type { SeasonalVisualState } from "../presentation/seasonalVisualState";
import type { SeasonName, WeatherKind } from "../seasons/types";

export type SeasonalPlantForm = "canopy" | "shrub" | "flower" | "ground-cover";
export type SeasonalPlantVariant =
  | "base"
  | "leaf-out"
  | "blossom"
  | "mature"
  | "autumn-color"
  | "leaf-fall"
  | "dormant"
  | "evergreen"
  | "wind-exposed"
  | "dry";

export interface SeasonalPlantClimate {
  readonly biome: LandTheme;
  readonly absoluteDay: number;
  readonly season: SeasonName;
  readonly seasonProgress: number;
  readonly foliage: ClimateFoliagePhase;
  readonly foliageFrom: ClimateFoliagePhase;
  readonly foliageTo: ClimateFoliagePhase;
  readonly transitionBlend: number;
  readonly dormancy: number;
  readonly flowering: number;
  readonly dryness: number;
  readonly windMph: number;
  readonly temperatureF: number;
  readonly weatherKind: WeatherKind;
  readonly exposure: "sheltered" | "moderate" | "exposed";
}

export interface SeasonalPlantPresentationInput {
  /** Stable semantic plant id, or the immutable same-biome base frame id. */
  readonly identity: PlantId | string;
  readonly profile: PlantSeasonalProfile;
  readonly form: SeasonalPlantForm;
  readonly x: number;
  readonly y: number;
  readonly cultivated: boolean;
  readonly elevation: number;
  readonly nearWater: boolean;
  readonly ecologicalFit?: PlantEcologicalFit;
  readonly climate?: SeasonalPlantClimate;
}

export interface SeasonalPlantPresentation {
  readonly variant: SeasonalPlantVariant;
  /** Multiplicative RGB tint applied to the immutable same-biome base frame. */
  readonly tint: number;
  readonly alpha: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly shadowScale: number;
  readonly swayScale: number;
  readonly bloomAccent: number;
  readonly leafFallAccent: number;
  readonly signature: string;
}

export function seasonalDecorationPlantForm(
  kind: DecorationKind,
  profile: PlantSeasonalProfile,
): SeasonalPlantForm {
  if (kind === "flower_bed") return "ground-cover";
  if (kind === "planter") return profile === "flowering" ? "flower" : "shrub";
  if (kind === "ornamental_feature") {
    return profile === "deciduous" || profile === "evergreen"
      ? "canopy"
      : "shrub";
  }
  return "shrub";
}

const BASE_PRESENTATION: Omit<SeasonalPlantPresentation, "signature"> = {
  variant: "base",
  tint: 0xffffff,
  alpha: 1,
  scaleX: 1,
  scaleY: 1,
  shadowScale: 1,
  swayScale: 1,
  bloomAccent: 0,
  leafFallAccent: 0,
};

const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

function hashUnit(identity: string, x: number, y: number, salt: number): number {
  let value = 2166136261 ^ salt;
  const text = `${identity}:${Math.floor(x)}:${Math.floor(y)}`;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  value = Math.imul(value ^ (value >>> 16), 2246822519);
  return ((value ^ (value >>> 13)) >>> 0) / 0x100000000;
}

function mixChannel(from: number, to: number, amount: number): number {
  return Math.round(from + (to - from) * clamp(amount));
}

function mixTint(from: number, to: number, amount: number): number {
  return (
    (mixChannel((from >>> 16) & 0xff, (to >>> 16) & 0xff, amount) << 16)
    | (mixChannel((from >>> 8) & 0xff, (to >>> 8) & 0xff, amount) << 8)
    | mixChannel(from & 0xff, to & 0xff, amount)
  );
}

function rounded(value: number): string {
  return clamp(value).toFixed(3);
}

/**
 * Aggregate dependency for sprite caches. It changes for every authoritative
 * input used by seasonal vegetation, including same-mounted day transitions.
 */
export function seasonalPlantSceneSignature(
  state: SeasonalVisualState | undefined,
): string {
  if (!state) return "seasonal-plants:base";
  const { climate, weather, renderer } = state;
  return [
    "seasonal-plants:v1",
    climate.biome,
    climate.calendar.absoluteDay,
    climate.calendar.season,
    climate.calendar.seasonProgress.toFixed(4),
    climate.identity.exposure,
    climate.transition.blend.toFixed(4),
    climate.vegetation.foliage.from,
    climate.vegetation.foliage.to,
    climate.vegetation.foliage.dominant,
    climate.vegetation.dormancy.toFixed(4),
    climate.vegetation.flowering.toFixed(4),
    renderer.dryness.toFixed(4),
    weather.kind,
    weather.temperatureF,
    weather.windMph,
  ].join("|");
}

export function seasonalPlantClimate(
  state: SeasonalVisualState | undefined,
): SeasonalPlantClimate | undefined {
  if (!state) return undefined;
  return {
    biome: state.climate.biome,
    absoluteDay: state.climate.calendar.absoluteDay,
    season: state.climate.calendar.season,
    seasonProgress: state.climate.calendar.seasonProgress,
    foliage: state.climate.vegetation.foliage.dominant,
    foliageFrom: state.climate.vegetation.foliage.from,
    foliageTo: state.climate.vegetation.foliage.to,
    transitionBlend: state.climate.transition.blend,
    dormancy: state.climate.vegetation.dormancy,
    flowering: state.climate.vegetation.flowering,
    dryness: state.renderer.dryness,
    windMph: state.weather.windMph,
    temperatureF: state.weather.temperatureF,
    weatherKind: state.weather.kind,
    exposure: state.climate.identity.exposure,
  };
}

/**
 * Resolves an authored, climate-plausible presentation without changing the
 * obstacle/decor gameplay entity or borrowing another biome's frame.
 *
 * The base texture never swaps: continuous tint/scale/accent values blend as
 * phenology advances, while the categorical `variant` is telemetry and test
 * evidence. Positional thresholds stagger bloom/leaf-fall across a stand and
 * are stable for the whole authoritative day.
 */
export function seasonalPlantPresentation(
  input: SeasonalPlantPresentationInput,
): SeasonalPlantPresentation {
  const climate = input.climate;
  if (!climate) {
    return {
      ...BASE_PRESENTATION,
      signature: `${input.identity}:base`,
    };
  }

  const distribution = hashUnit(input.identity, input.x, input.y, 0x568);
  const accentDistribution = hashUnit(input.identity, input.x, input.y, 0x6c8);
  const elevationCooling = clamp(input.elevation / 8) * 0.16;
  const shelter = (input.cultivated ? 0.16 : 0)
    + (input.nearWater ? 0.14 : 0);
  const weatherDry = climate.weatherKind === "drought"
    ? 0.28
    : climate.weatherKind === "heat" ? 0.16 : 0;
  const fitStress = input.ecologicalFit === "imported"
    ? 0.18
    : input.ecologicalFit === "adapted" ? 0.07 : 0;
  const effectiveDryness = clamp(
    climate.dryness + weatherDry + elevationCooling * 0.1 + fitStress - shelter,
  );
  const effectiveDormancy = clamp(
    climate.dormancy + elevationCooling - (input.cultivated ? 0.08 : 0),
  );
  const windExposure = clamp(
    climate.windMph / 32
    + (climate.exposure === "exposed" ? 0.28 : climate.exposure === "moderate" ? 0.1 : 0)
    + elevationCooling
    - (input.cultivated ? 0.08 : 0),
  );
  const bloom = clamp(
    climate.flowering
    + (input.cultivated ? 0.16 : 0)
    + (input.nearWater ? 0.08 : 0)
    - effectiveDryness * 0.42,
  );
  const bloomAccent = clamp((bloom - distribution * 0.62) * 1.8);
  const foliageWeight = (phase: ClimateFoliagePhase): number => {
    if (climate.foliageFrom === climate.foliageTo) {
      return climate.foliageFrom === phase ? 1 : 0;
    }
    return (climate.foliageFrom === phase ? 1 - climate.transitionBlend : 0)
      + (climate.foliageTo === phase ? climate.transitionBlend : 0);
  };

  let variant: SeasonalPlantVariant = "mature";
  let tint = 0xffffff;
  let alpha = 1;
  let scaleX = 1;
  let scaleY = 1;
  let shadowScale = 1;
  let swayScale = 1 + windExposure * 0.28;
  let leafFallAccent = 0;

  if (input.profile === "evergreen") {
    variant = windExposure > 0.62 ? "wind-exposed" : "evergreen";
    tint = mixTint(0xffffff, windExposure > 0.62 ? 0xb8b694 : 0xd6e4d0, 0.28 + windExposure * 0.25);
    scaleX = 1 - windExposure * 0.055;
    alpha = 1 - effectiveDryness * 0.06;
  } else if (input.profile === "coastal-heath") {
    variant = bloomAccent > 0.28
      ? "blossom"
      : windExposure > 0.48 ? "wind-exposed" : effectiveDryness > 0.72 ? "dry" : "mature";
    tint = variant === "blossom"
      ? mixTint(0xffffff, 0xd9b9d8, bloomAccent * 0.46)
      : mixTint(0xffffff, variant === "dry" ? 0xb49b6c : 0xc5bf92, 0.2 + windExposure * 0.26);
    scaleX = 1 - windExposure * 0.08;
    scaleY = 1 - windExposure * 0.025;
    alpha = 1 - effectiveDryness * 0.1;
  } else if (input.profile === "succulent") {
    variant = bloomAccent > 0.42
      ? "blossom"
      : effectiveDryness > 0.78 ? "dry" : "mature";
    tint = variant === "blossom"
      ? mixTint(0xffffff, 0xf0bcba, bloomAccent * 0.42)
      : mixTint(0xffffff, variant === "dry" ? 0xb99a68 : 0xc9d6bf, variant === "dry" ? 0.42 : 0.18);
    alpha = 1 - effectiveDryness * 0.045;
    swayScale = input.form === "ground-cover" ? 1 + windExposure * 0.2 : 0;
  } else if (input.profile === "drought-deciduous") {
    const recovering = effectiveDryness < 0.48
      && (climate.foliage === "emerging" || bloom > 0.38);
    variant = effectiveDryness > 0.66
      ? "dry"
      : recovering ? "leaf-out" : bloomAccent > 0.44 ? "blossom" : "mature";
    const response = effectiveDryness > 0.66
      ? clamp((effectiveDryness - 0.48) * 1.6)
      : clamp((0.54 - effectiveDryness) * 1.4);
    tint = variant === "blossom"
      ? mixTint(0xffffff, 0xe8cf9c, bloomAccent * 0.4)
      : mixTint(0xffffff, variant === "dry" ? 0xaa895f : 0xc9dfb0, response * 0.46);
    alpha = 1 - effectiveDryness * 0.14;
    scaleX = 1 - effectiveDryness * 0.055;
  } else {
    const leafFall = clamp(
      (climate.foliage === "turning" || climate.foliage === "sparse"
        ? climate.seasonProgress * 0.72 + effectiveDormancy * 0.52
        : 0)
      - distribution * 0.32,
    );
    leafFallAccent = clamp((leafFall - accentDistribution * 0.46) * 1.7);
    if (effectiveDormancy > 0.72 || climate.foliage === "dormant") {
      variant = "dormant";
      tint = mixTint(0xffffff, 0x9d927f, effectiveDormancy * 0.58);
      alpha = 1 - effectiveDormancy * (input.form === "canopy" ? 0.24 : 0.16);
      scaleX = 1 - effectiveDormancy * (input.form === "canopy" ? 0.11 : 0.06);
      scaleY = 1 - effectiveDormancy * 0.025;
    } else if (climate.foliage === "turning") {
      variant = leafFall > 0.62 ? "leaf-fall" : "autumn-color";
      tint = mixTint(0xffffff, leafFall > 0.62 ? 0xa98359 : 0xd19a54, 0.38 + leafFall * 0.36);
      alpha = 1 - leafFall * 0.16;
      scaleX = 1 - leafFall * 0.075;
    } else if (climate.foliage === "sparse") {
      variant = "leaf-fall";
      tint = mixTint(0xffffff, 0xa88a66, 0.46 + leafFall * 0.28);
      alpha = 1 - Math.max(leafFall, effectiveDormancy) * 0.2;
      scaleX = 1 - leafFall * 0.095;
    } else if (
      bloomAccent > 0.4
      && (
        input.profile === "flowering"
        || input.profile === "coastal-deciduous"
      )
    ) {
      variant = "blossom";
      tint = mixTint(0xffffff, 0xf1c4ce, bloomAccent * 0.48);
    } else if (climate.foliage === "emerging") {
      variant = "leaf-out";
      tint = mixTint(0xffffff, 0xaed892, 0.34 + (1 - effectiveDormancy) * 0.2);
      alpha = 0.9 + (1 - effectiveDormancy) * 0.1;
      scaleX = 0.94 + (1 - effectiveDormancy) * 0.06;
    } else if (effectiveDryness > 0.78) {
      variant = "dry";
      tint = mixTint(0xffffff, 0xb89b6d, (effectiveDryness - 0.55) * 0.88);
      alpha = 1 - effectiveDryness * 0.1;
    }
  }

  // Rendering follows continuous from/to phenology weights rather than the
  // categorical telemetry label above. A daily transition therefore remains
  // blended even when `dominant` changes at its midpoint.
  if (input.profile === "evergreen") {
    tint = mixTint(
      mixTint(0xffffff, 0xd6e4d0, 0.28),
      effectiveDryness > 0.55 ? 0xb8a477 : 0xb8b694,
      clamp(effectiveDryness * 0.32 + windExposure * 0.24),
    );
    alpha = 1 - effectiveDryness * 0.06;
    scaleX = 1 - windExposure * 0.055;
  } else if (input.profile === "coastal-heath") {
    tint = mixTint(
      mixTint(0xffffff, 0xc5bf92, 0.2 + windExposure * 0.24),
      0xd9b9d8,
      bloomAccent * 0.46,
    );
    tint = mixTint(tint, 0xb49b6c, effectiveDryness * 0.22);
    scaleX = 1 - windExposure * 0.08;
    scaleY = 1 - windExposure * 0.025;
    alpha = 1 - effectiveDryness * 0.1;
  } else if (input.profile === "succulent") {
    tint = mixTint(0xffffff, 0xb99a68, effectiveDryness * 0.34);
    tint = mixTint(tint, 0xf0bcba, bloomAccent * 0.42);
    alpha = 1 - effectiveDryness * 0.045;
  } else if (input.profile === "drought-deciduous") {
    tint = mixTint(
      0xffffff,
      effectiveDryness > 0.5 ? 0xaa895f : 0xc9dfb0,
      effectiveDryness > 0.5
        ? clamp((effectiveDryness - 0.38) * 0.74)
        : clamp((0.52 - effectiveDryness) * 0.5),
    );
    tint = mixTint(tint, 0xe8cf9c, bloomAccent * 0.36);
    alpha = 1 - effectiveDryness * 0.14;
    scaleX = 1 - effectiveDryness * 0.055;
  } else {
    const emergingWeight = foliageWeight("emerging");
    const turningWeight = foliageWeight("turning");
    const sparseWeight = foliageWeight("sparse");
    const dormantWeight = foliageWeight("dormant");
    tint = mixTint(0xffffff, 0xaed892, emergingWeight * 0.48);
    tint = mixTint(tint, 0xd19a54, turningWeight * 0.64);
    tint = mixTint(tint, 0xa88a66, sparseWeight * 0.68);
    tint = mixTint(
      tint,
      0x9d927f,
      clamp(Math.max(dormantWeight * 0.7, effectiveDormancy * 0.56)),
    );
    if (
      input.profile === "flowering"
      || input.profile === "coastal-deciduous"
    ) {
      tint = mixTint(tint, 0xf1c4ce, bloomAccent * 0.48);
    }
    tint = mixTint(
      tint,
      0xb89b6d,
      Math.max(0, effectiveDryness - 0.62) * 0.58,
    );
    const canopyLoss = clamp(
      sparseWeight * 0.52
      + dormantWeight * 0.7
      + effectiveDormancy * 0.3,
    );
    alpha = 1 - canopyLoss * (input.form === "canopy" ? 0.24 : 0.16);
    scaleX = 1 - canopyLoss * (input.form === "canopy" ? 0.11 : 0.065);
    scaleY = 1 - canopyLoss * 0.025;
    if (input.profile === "coastal-deciduous") {
      tint = mixTint(tint, 0xc5bf92, windExposure * 0.2);
      scaleX *= 1 - windExposure * 0.05;
      scaleY *= 1 - windExposure * 0.015;
    }
  }

  if (input.form === "ground-cover") {
    scaleY *= 0.98;
    shadowScale *= 0.82;
  } else if (input.form === "flower") {
    shadowScale *= 0.9;
  }
  shadowScale *= Math.max(0.72, scaleX * alpha);

  const presentation = {
    variant,
    tint,
    alpha: clamp(alpha, 0.68, 1),
    scaleX: clamp(scaleX, 0.78, 1.04),
    scaleY: clamp(scaleY, 0.9, 1.04),
    shadowScale: clamp(shadowScale, 0.62, 1),
    swayScale: clamp(swayScale, 0, 1.5),
    bloomAccent,
    leafFallAccent,
  };
  return {
    ...presentation,
    signature: [
      input.identity,
      input.ecologicalFit ?? "native",
      climate.absoluteDay,
      variant,
      presentation.tint.toString(16),
      rounded(presentation.alpha),
      rounded(presentation.scaleX),
      rounded(presentation.scaleY),
      rounded(presentation.shadowScale),
      rounded(presentation.swayScale),
      rounded(presentation.bloomAccent),
      rounded(presentation.leafFallAccent),
    ].join(":"),
  };
}
